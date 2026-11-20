/**
 * Клиентская реплика онлайн-боя. Мир строится из того же зерна, что и на сервере;
 * машины, снаряды и события приходят с сервера. Для рендера, звука и HUD реплика
 * выглядит как обычный Battle (те же поля и события), но ничего не симулирует сама.
 */
import { Battle } from "../sim/Battle.js";
import { Vehicle } from "../sim/Vehicle.js";
import { Config } from "../core/Config.js";
import { Events } from "../core/Events.js";
import { angDiff, clamp } from "../core/Utils.js";
import { getVehicle } from "../data/VehicleBuild.js";
import { SHELLS, SHELL_TYPES } from "../data/Shells.js";
import { applyOwn, unpackRes, F_DEAD, F_FIRE, F_SPOTTED, F_SMOKE, INPUT_HZ, WORLD_LISTS, STATIONS_NET, r2 } from "./Protocol.js";
import { driveVehicle, resolveWorldContact, settleOnGround } from "../sim/Physics.js";

const INTERP = 0.12;        // задержка интерполяции чужих машин, с
const EXTRAP_MAX = 0.2;     // предел экстраполяции при потере пакетов, с

/** Состояние режима «Превосходство» по снимкам сервера */
class NetMode {
    constructor(b) {
        const C = Config.DOMINATION;
        this.b = b;
        this.tickets = [C.TICKETS, C.TICKETS];
        this.timeLeft = C.TIME;
        this.points = b.world.points.map((p) => ({ ...p, owner: -1, prog: 0, n: [0, 0] }));
        this.kind = b.mode === "duel" ? "duel" : b.mode === "boss" ? "boss" : "domination";
        this.freeSpawns = this.kind === "duel" || this.kind === "boss";
        this.left = [0, 0];
        this.boss = { eff: 1, crew: 20, sys: [2, 1, 2, 2, 8, 1, 1], hq: 0, dist: 0, dead: false };
        this.pickups = [];
        if (this.kind === "boss") for (const p of this.points) { p.owner = p.hq ? b.playerTeam : -1; p.prog = 0; }
    }
    apply(m) {
        if (m.k === "duel") { this.timeLeft = m.tl; this.left = m.left; return; }
        if (m.k === "boss") {
            this.timeLeft = m.tl;
            this.boss = { eff: m.e, crew: m.c, sys: m.s, hq: m.hq, dist: m.d, dead: !!m.x };
            if (this.points[0]) { this.points[0].owner = this.b.playerTeam; this.points[0].prog = -m.hq * 100; }
            (m.p || []).forEach(([owner, prog], i) => { const p = this.points[i + 1]; if (p) { p.owner = owner; p.prog = prog; } });
            this.pickups = (m.pk || []).map(([id, x, z]) => ({ id, x, z }));
            return;
        }
        this.tickets = m.tk;
        this.timeLeft = m.tl;
        m.p.forEach(([owner, prog, n0, n1], i) => {
            const p = this.points[i];
            if (!p) return;
            p.owner = owner; p.prog = prog; p.n = [n0, n1];
        });
    }
    hud() {
        if (this.kind === "duel") return { kind: "duel", time: this.timeLeft, left: this.left };
        if (this.kind === "boss") {
            const B = this.boss;
            const held = this.intelHeld(), enemy = this.intelHeld(1);
            return { kind: "boss", time: this.timeLeft, eff: B.eff, crew: B.crew, crewMax: 20, sys: B.sys, hq: B.hq, dist: B.dist, dead: B.dead,
                intel: held, intelEnemy: enemy, intelMax: this.points.filter((p) => p.intel).length, speedK: 1 + Config.BOSS.SPEED_PER_POINT * enemy,
                artyCd: Config.BOSS.ARTY_COOLDOWN * Math.pow(Config.BOSS.INTEL_K, held) };
        }
        return { kind: "domination", tickets: this.tickets, points: this.points, time: this.timeLeft, max: Config.DOMINATION.TICKETS };
    }
    update() {}
    onDestroyed() {}
    /* артудар в битве с боссом — те же правила, что на сервере (для подсказок и проверки дальности) */
    intelHeld(team = 0) { return this.points.filter((p) => p.intel && p.owner === team).length; }
    artyCooldown(v) { return this.kind === "boss" && v.team === 0 ? Config.BOSS.ARTY_COOLDOWN * Math.pow(Config.BOSS.INTEL_K, this.intelHeld()) : null; }
    artyRange(v) { return this.kind === "boss" && v.team === 0 ? Config.BOSS.ARTY_RANGE : null; }
}

export class NetBattle extends Battle {
    /** start — сообщение сервера { b: параметры боя, me: { pid, name, team, lineup }, full: состояние } */
    constructor(start, net) {
        const me = start.me;
        super({ replica: true, ...start.b, pilots: [{ id: me.pid, name: me.name, team: me.team, nation: me.nation, lineup: me.lineup, local: true }] });
        this.net = net;
        this.online = true;
        // нация пилота (в битве с боссом у игроков одной команды могут быть разные нации)
        this.nation = me.nation || this.teamNation[me.team];
        this.enemyNation = this.teamNation[1 - me.team];
        this.modeCtl = new NetMode(this);
        this.byId = new Map();
        this.offset = null;
        this.sendAcc = 0;
        this.fireHeld = false;
        this.syncClock(start.full.tm);
        this.time = start.full.tm;
        for (const o of start.full.veh) this.addVehicle(o, true);
        for (const e of start.full.wc) this.worldChange(e);
        start.full.pts.forEach(([owner, prog], i) => { if (this.modeCtl.points[i]) Object.assign(this.modeCtl.points[i], { owner, prog }); });
    }

    /* ─────────── Время сервера ─────────── */
    /**
     * Часы сервера. Пакет не может прийти раньше, чем его отправили, а опоздать может (кадр, сеть),
     * поэтому «ранние» пакеты сдвигают часы быстро, а запоздавшие — едва-едва.
     */
    syncClock(tm) {
        const est = tm - performance.now() / 1000;
        if (this.offset === null || est - this.offset > 0.25 || est - this.offset < -1) this.offset = est;
        else this.offset += (est - this.offset) * (est > this.offset ? 0.3 : 0.03);
    }
    serverNow() { return performance.now() / 1000 + this.offset; }

    /* ─────────── Машины ─────────── */
    addVehicle(o, quiet) {
        let v = this.byId.get(o.id);
        if (v) return v;
        const def = getVehicle(o.def);
        if (!def) return null;
        const mine = o.pid && o.pid === this.local.id;
        v = new Vehicle(def, o.team, o.x, o.z, o.a, { isPlayer: mine, static: o.st, equipment: o.equipment });
        v.id = o.id;
        v.callsign = mine ? "Вы" : o.cs;
        v.pilot = o.pid ? { id: o.pid } : null;
        v.tr = o.tr || 0;
        v.spawnT = this.time;
        v.buf = [];
        v.visible[v.team] = true;
        settleOnGround(v, this.world);
        if (o.dead) {
            v.kill(o.cause);
            v.deathT = this.time - 60;
            v.visible = [true, true];
            this.world.addWreck(v);
        }
        this.vehicles.push(v);
        this.byId.set(v.id, v);
        if (mine && !v.dead) this.local.vehicle = v;
        if (!quiet) Events.emit("spawn", { v });
        return v;
    }

    removeVehicle(v) {
        const i = this.vehicles.indexOf(v);
        if (i >= 0) this.vehicles.splice(i, 1);
        this.byId.delete(v.id);
        this.world.removeWreckOf(v);
        Events.emit("vehicleRemoved", { v });
    }

    firePos(v) {
        const m = v.mods.engine || Object.values(v.mods)[0];
        return m.def.c.slice();
    }

    /* ─────────── Снимок состояния ─────────── */
    onSnapshot(s) {
        this.syncClock(s.tm);
        if (s.ev) this.onEvents(s.ev);
        const T = this.playerTeam;
        const seen = new Set();
        for (const a of s.v) {
            const v = this.byId.get(a[0]);
            if (!v) continue;
            seen.add(v);
            const st = { tm: s.tm, x: a[1], z: a[2], a: a[3], v: a[4], w: a[5], tr: a[6], gp: a[10] || 0 };
            if (a[11] && v.stn) v.stTarget = a[11];
            st.slip = a[12] || 0;
            if (v.isPlayer && s.me?.impact !== undefined && v.impactSeq !== s.me.impact) {
                v.impactSeq = s.me.impact;
                v.v = st.v; v.w = st.w; v.slip = st.slip;
            }
            // машина снова появилась из засвета — старые точки буфера не годятся для интерполяции
            if (!v.visible[T]) v.buf.length = 0;
            if (!v.buf.length) {
                v.x = st.x; v.z = st.z; v.a = st.a; v.tr = st.tr; v.gp = st.gp;
                v.v = st.v; v.w = st.w; v.slip = st.slip;
                settleOnGround(v, this.world);
            }
            v.buf.push(st);
            if (v.buf.length > 10) v.buf.shift();
            const f = a[7];
            if ((f & F_DEAD) && !v.dead) { v.kill("crew"); this.world.addWreck(v); }
            if (v.team === T) v.visible[1 - T] = !!(f & F_SPOTTED);
            if (!v.isPlayer) {
                v.input.throttle = a[8];
                v.input.steer = a[9];
                if (f & F_FIRE) { if (!v.fire) v.fire = { pos: this.firePos(v) }; }
                else v.fire = null;
                const eng = v.mods.engine;
                if (eng) eng.hp = f & F_SMOKE ? eng.maxHp * 0.2 : eng.maxHp;
            }
        }
        for (const v of this.vehicles) {
            if (v.team !== T && !v.dead) v.visible[T] = seen.has(v);
        }
        const p = this.local.vehicle;
        if (s.me && p && !p.dead) applyOwn(p, s.me);
        const P = this.local;
        P.sp = s.P.sp;
        P.spawns = s.P.n;
        P.deathAt = s.P.da;
        P.stats.rp = s.P.rp;
        for (const l of P.lineup) l.used = s.P.u.includes(l.id);
        this.modeCtl.apply(s.m);
        this.strikes = s.st.map(([x, z, team, n, total, r]) => ({ x, z, team, n, total, r }));
    }

    onScores(rows) {
        for (const [id, kills, assists, caps, dmg] of rows) {
            const v = this.byId.get(id);
            if (v) Object.assign(v.stats, { kills, assists, caps, dmg });
        }
    }

    /* ─────────── События сервера → локальная шина событий ─────────── */
    onEvents(list) {
        const V = (id) => (id ? this.byId.get(id) || null : null);
        for (const e of list) {
            switch (e.e) {
                case "spawn": this.addVehicle(e); break;
                case "rm": { const v = V(e.id); if (v) this.removeVehicle(v); break; }
                case "pspawn": {
                    const v = V(e.id);
                    if (!v) break;
                    v.isPlayer = true;
                    v.callsign = "Вы";
                    this.local.vehicle = v;
                    Events.emit("playerSpawn", { v });
                    break;
                }
                case "shot": {
                    const v = V(e.v);
                    if (!v) break;
                    v.recoil = 1;
                    v.lastShot = this.time;
                    if (e.st) v.recoil = 0;
                    Events.emit("shot", { v, def: SHELLS[e.s], pos: e.p, dir: e.d, st: e.st });
                    break;
                }
                case "sh+": this.addShot(e.s); break;
                case "sh-": { const s = this.shots.find((q) => q.id === e.id); if (s) s.alive = false; break; }
                case "hit": {
                    const tg = V(e.tg);
                    if (tg) Events.emit("hit", { shooter: V(e.sh), target: tg, res: unpackRes(e.res), shell: SHELLS[e.s], world: e.w, dir: e.d });
                    break;
                }
                case "splash": {
                    const v = V(e.v);
                    if (v) Events.emit("splashDamage", { v, shooter: V(e.sh), res: unpackRes(e.res), direct: e.direct });
                    break;
                }
                case "imp": Events.emit("impact", { kind: e.k, x: e.p[0], y: e.p[1], z: e.p[2], shell: SHELLS[e.s], harmless: !!e.h, owner: V(e.o) }); break;
                case "exp": Events.emit("explosion", { x: e.p[0], y: e.p[1], z: e.p[2], size: e.sz, inside: !!e.in, ground: !!e.gr }); break;
                case "dead": {
                    const v = V(e.id);
                    if (!v || v.dead) break;
                    v.x = e.x; v.z = e.z; v.a = e.a;
                    v.buf.length = 0;
                    v.kill(e.c);
                    v.deathT = this.time;
                    v.killer = V(e.k);
                    v.visible = [true, true];
                    this.world.addWreck(v);
                    if (v.isPlayer) this.local.deathAt = this.time;
                    Events.emit("destroyed", { v, cause: e.c, killer: v.killer });
                    break;
                }
                case "mod": { const v = V(e.v); if (v) Events.emit("modDestroyed", { v, id: e.id, type: e.ty }); break; }
                case "collision": { const v = V(e.v); if (v) Events.emit("collisionDamage", { v, severe: e.severe }); break; }
                case "ko": { const v = V(e.v); if (v) Events.emit("crewKO", { v, seat: e.s }); break; }
                case "swap": { const v = V(e.v); if (v) Events.emit("crewSwap", { v, member: { home: e.h }, from: e.f, to: e.to, dur: e.d }); break; }
                case "swapd": { const v = V(e.v); if (v) Events.emit("crewSwapDone", { v, member: { home: e.h }, to: e.to }); break; }
                case "fire": {
                    const v = V(e.v);
                    if (!v) break;
                    if (!v.fire) v.fire = { pos: this.firePos(v) };
                    Events.emit("fireStart", { v, by: V(e.by) });
                    break;
                }
                case "fout": { const v = V(e.v); if (v) { v.fire = null; Events.emit("fireOut", { v, ext: !!e.x }); } break; }
                case "rep": { const v = V(e.v); if (v) Events.emit("repairStart", { v, dur: e.d }); break; }
                case "archive": { const v = V(e.v); if (v) Events.emit("archiveProc",{v,id:e.id}); break; }
                case "repd": { const v = V(e.v); if (v) Events.emit("repairDone", { v }); break; }
                case "repc": { const v = V(e.v); if (v) Events.emit("repairCancel", { v }); break; }
                case "med": { const v = V(e.v); if (v) Events.emit("medkit", { v, healed: e.n }); break; }
                case "rel": { const v = V(e.v); if (v) Events.emit("reloaded", { v }); break; }
                case "sup": { const v = V(e.v); if (v) Events.emit("resupply", { v, crew: e.c, ammo: e.a }); break; }
                case "pt": {
                    const p = this.modeCtl.points[e.i];
                    if (!p) break;
                    p.owner = e.o;
                    Events.emit("pointChange", { p, owner: e.o, prev: e.p });
                    break;
                }
                case "arty": {
                    const v = V(e.v) || { team: e.team, x: e.x, z: e.z, isPlayer: false };
                    Events.emit("artyCalled", { strike: { x: e.x, z: e.z, team: e.team, r: e.r }, v });
                    break;
                }
                case "ashell": Events.emit("artyShell", { x: e.x, z: e.z }); break;
                case "wc": this.worldChange(e); break;
                case "bn": Events.emit("bossNote", { v: V(e.v), text: e.t, kind: e.k }); break;
                case "pick": { const v = V(e.v); if (v) Events.emit("pickup", { v, id: e.id, n: e.n }); break; }
                case "baim": { const tg = V(e.tg); if (tg) Events.emit("bossAim", { v: V(e.v), target: tg, t: e.t }); break; }
            }
        }
    }

    worldChange(e) {
        const list = this.world[WORLD_LISTS[e.ty]];
        const o = list && list[e.i];
        if (!o) return;
        if (e.ty === "tree") {
            if (o.fallen && o.fallA !== e.a) {
                o.fallA = e.a;
                Events.emit("worldChange", { type: "tree", o });
            } else this.world.knockTree(o, e.a);
        }
        else if (e.ty === "fence") this.world.breakFence(o);
        else if (e.ty === "hay") this.world.breakHay(o);
        else if (e.ty === "hedge") this.world.breakHedge(o);
        else if (e.ty === "building") this.world.crushBuilding(o);
    }

    addShot([id, sid, p, d, speed, owner, flags, life]) {
        const def = SHELLS[sid];
        if (!def) return;
        this.shots.push({
            id, def, type: SHELL_TYPES[def.type], x: p[0], y: p[1], z: p[2], d, speed, traveled: 0,
            owner: this.byId.get(owner) || null, harmless: !!(flags & 1), rico: !!(flags & 2), arty: !!(flags & 4),
            life: life < 0 ? Infinity : life, alive: true,
        });
    }

    /* ─────────── Кадр клиента ─────────── */
    update(dt) {
        // кадровый шаг игры ограничен 0.05 с; своя машина считается по реальному времени,
        // иначе при просадке FPS она отстаёт от сервера и коррекция дёргает её назад
        const now = performance.now() / 1000;
        const rdt = this.frameAt ? clamp(now - this.frameAt, 0, 0.25) : dt;
        this.frameAt = now;
        this.time = this.serverNow();
        if (this.ended) this.endT = (this.endT || 0) + dt;
        const rt = this.time - INTERP;
        for (const v of this.vehicles) {
            if (v.dead || !v.buf.length) continue;
            if (v.isPlayer) { if (dt > 0) this.predictOwn(v, rdt); continue; }
            const ox = v.x, oz = v.z, otr = v.tr;
            const st = this.sample(v.buf, rt);
            v.x = st.x; v.z = st.z; v.a = st.a; v.tr = st.tr; v.v = st.v; v.w = st.w; v.gp = st.gp;
            v.slip = st.slip;
            settleOnGround(v, this.world, dt);
            // станции босса — плавно к углам из снимка
            if (v.stTarget && dt > 0) STATIONS_NET.forEach((k, i) => {
                const S = v.stn[k], T = v.stTarget[i];
                if (!S || !T) return;
                const kk = Math.min(1, dt * 8);
                S.yaw += angDiff(S.yaw, T[0]) * kk;
                S.pitch += (T[1] - S.pitch) * kk;
            });
            if (dt > 0) {
                const hw = v.def.dims.W / 2;
                // гусеницы крутятся по фактическому смещению, без скачков после телепортации
                const moved = Math.hypot(v.x - ox, v.z - oz) < 6;
                if (moved) {
                    v.trackPhase[0] += (v.v + v.w * hw) * dt;
                    v.trackPhase[1] += (v.v - v.w * hw) * dt;
                }
                v.trRate = angDiff(otr, v.tr) / dt;
            }
        }
        // снаряды летят по прямой до сообщения сервера о попадании
        for (const s of this.shots) {
            const L = s.speed * dt;
            s.x += s.d[0] * L; s.y += s.d[1] * L; s.z += s.d[2] * L;
            s.traveled += L;
            s.life -= dt;
            if (s.life <= 0 || s.traveled > Config.SHELL_MAX_RANGE || s.y < -1) s.alive = false;
        }
        if (this.shots.some((s) => !s.alive)) this.shots = this.shots.filter((s) => s.alive);
        // ввод игрока
        this.sendAcc += dt;
        if (this.sendAcc >= 1 / INPUT_HZ) {
            this.sendAcc = 0;
            this.sendInput();
        }
    }

    /**
     * Своя машина — с предсказанием: ход, башня и орудие считаются локально по своему же вводу
     * (та же физика, что на сервере), а расхождение с сервером плавно гасится.
     */
    predictOwn(p, dt) {
        if (dt <= 0) return;
        // та же физика, что на сервере, шагами не длиннее серверного тика
        for (let left = dt; left > 1e-4;) {
            const h = Math.min(left, 1 / 30);
            driveVehicle(p, h);
            resolveWorldContact(this.world, p, h);
            settleOnGround(p, this.world, h);
            this.aimTurret(p, h);
            left -= h;
        }
        // состояние сервера, продлённое до «сейчас» (с учётом пути пакета) по его же скоростям
        const s = p.buf[p.buf.length - 1];
        const e = clamp(this.time + (this.net.rtt || 0) / 2000 - s.tm, 0, 0.3);
        const ta = s.a + s.w * e;
        const slide = s.slip * (1 - Math.exp(-4 * e)) / 4;
        const tx = s.x + Math.cos(ta) * s.v * e - Math.sin(ta) * slide;
        const tz = s.z + Math.sin(ta) * s.v * e + Math.cos(ta) * slide;
        const err = Math.hypot(tx - p.x, tz - p.z), errA = Math.abs(angDiff(p.a, ta));
        // сервер видит наш ввод с запаздыванием: такая разница — норма, её гасим медленно,
        // а всё, что сверх неё, — быстро
        const lag = (this.net.rtt || 0) / 2000 + 1 / INPUT_HZ + 0.06;
        const kSlow = 1 - Math.exp(-dt * 0.8), kFast = 1 - Math.exp(-dt * 6);
        const fix = (diff, slack) => {
            const a = Math.abs(diff);
            return a > slack ? diff * kSlow + Math.sign(diff) * (a - slack) * kFast : diff * kSlow;
        };
        if (err > 4 || errA > 0.6) {
            // сильное расхождение (столкновение, рывок сервера) — сразу к серверу
            p.x = tx; p.z = tz; p.a = ta; p.v = s.v; p.w = s.w; p.slip = s.slip * Math.exp(-4 * e);
        } else if (err > 1e-4) {
            const f = fix(err, 0.2 + Math.abs(s.v) * lag) / err;
            p.x += (tx - p.x) * f;
            p.z += (tz - p.z) * f;
            p.a += fix(angDiff(p.a, ta), 0.01 + Math.abs(s.w) * lag);
        }
        p.tr += fix(angDiff(p.tr, s.tr), 0.01 + p.turretRate() * lag);
        p.gp += fix(s.gp - p.gp, 0.003 + p.elevRate() * lag);
    }

    sample(buf, rt) {
        if (rt <= buf[0].tm) return buf[0];
        for (let i = 0; i < buf.length - 1; i++) {
            const a = buf[i], b = buf[i + 1];
            if (rt >= a.tm && rt <= b.tm) {
                const k = (rt - a.tm) / Math.max(1e-4, b.tm - a.tm);
                return {
                    x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k,
                    a: a.a + angDiff(a.a, b.a) * k, tr: a.tr + angDiff(a.tr, b.tr) * k, gp: a.gp + (b.gp - a.gp) * k,
                    v: a.v + (b.v - a.v) * k, w: a.w + (b.w - a.w) * k,
                    slip: a.slip + (b.slip - a.slip) * k,
                };
            }
        }
        return this.extrapolate(buf[buf.length - 1], rt);
    }

    extrapolate(s, t) {
        const e = clamp(t - s.tm, 0, EXTRAP_MAX);
        const a = s.a + s.w * e;
        const slide = s.slip * (1 - Math.exp(-4 * e)) / 4;
        return { x: s.x + Math.cos(a) * s.v * e - Math.sin(a) * slide, z: s.z + Math.sin(a) * s.v * e + Math.cos(a) * slide, a, tr: s.tr, gp: s.gp, v: s.v, w: s.w, slip: s.slip * Math.exp(-4 * e) };
    }

    sendInput() {
        const p = this.local.vehicle;
        if (!p || p.dead) { this.fireHeld = false; return; }
        const aim = p.aimPoint ? [r2(p.aimPoint[0]), r2(p.aimPoint[1]), r2(p.aimPoint[2])] : null;
        this.net.send({ t: "in", th: p.input.throttle, st: p.input.steer, aim, f: this.fireHeld ? 1 : 0 });
        this.fireHeld = false;
    }

    /* ─────────── Действия игрока уходят на сервер ─────────── */
    act(a, extra = {}) { this.net.send({ t: "act", a, ...extra }); }

    fire(v) {
        if (v === this.local.vehicle && v.canFire()) this.fireHeld = true;
        return false;
    }

    spawnPlayer(id) {
        const c = this.canSpawn(id);
        if (!c.ok) return null;
        this.act("spawn", { id });
        return null;
    }

    callArtillery(v, x, z) {
        if (!v || v.dead || this.ended) return { ok: false, reason: "недоступно" };
        const left = this.artyLeft(v);
        if (left > 0) return { ok: false, reason: "перезарядка " + Math.ceil(left) + " с" };
        if (Math.hypot(x - v.x, z - v.z) > this.artyRange(v)) return { ok: false, reason: "слишком далеко" };
        this.act("arty", { x: r2(x), z: r2(z) });
        return { ok: true };
    }

    leave() { this.net.send({ t: "leaveBattle" }); }

    /** Конец боя приходит с сервера */
    finish(r) {
        if (this.ended) return;
        this.ended = true;
        this.endT = 0;
        Object.assign(this.local.stats, r.stats);
        this.local.vstats = r.vstats || {};
        this.result = r;
        Events.emit("battleEnd", r);
    }

    end() {}
}
