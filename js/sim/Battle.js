import { Config } from "../core/Config.js";
import { Events } from "../core/Events.js";
import { rnd, clamp, angDiff, TAU, DEG } from "../core/Utils.js";
import { SHELLS } from "../data/Shells.js";
import { getVehicle } from "../data/VehicleBuild.js";
import { WEATHER, BIOME_WEATHER } from "../data/Maps.js";
import { World } from "./World.js";
import { readLoadout, rollDrop } from "../data/Archive.js";
import { Vehicle } from "./Vehicle.js";
import { archiveShell, cardEvent } from "./ArchiveEffects.js";
import { Brain } from "./AI.js";
import { driveVehicle, resolveCollisions, settleOnGround } from "./Physics.js";
import { Shot, updateShots } from "./Projectiles.js";
import { hullToWorld, worldToHull, hullToFrame, frameToHull, dirFrameToHull, dirHullToWorld } from "./Armor.js";
import { fireTick } from "./Damage.js";
import { DominationMode } from "./modes/Domination.js";
import { WavesMode } from "./modes/Waves.js";
import { RangeMode } from "./modes/Range.js";
import { DuelMode } from "./modes/Duel.js";
import { BossMode } from "./modes/Boss.js";
import { RatteSystems, RatteBrain } from "./Ratte.js";

const CALLSIGNS = [
    ["Сокол", "Беркут", "Ястреб", "Кречет", "Орлан", "Сапсан"],
    ["Волк", "Рысь", "Барс", "Шакал", "Вепрь", "Лис", "Гюрза", "Кобра", "Варан", "Тур"],
];

const freshStats = () => ({ kills: 0, assists: 0, hits: 0, pens: 0, crits: 0, caps: 0, shots: 0, deaths: 0, rp: Config.RP.BASE, wave: 0, dmgDone: 0 });

export class Battle {
    /**
     * Одиночная игра: { mode, mapId, nation, lineup:[ids], seed, weather, difficulty }
     * Сетевой бой (сервер): { mode, mapId, seed, weather, nations:[n0, n1], pilots:[{id, name, team, lineup}], teamSize }
     * Реплика на клиенте: { replica: true, ... } — только мир, без ботов и режима (см. js/net/NetBattle.js)
     */
    constructor(opts) {
        this.opts = opts;
        this.mode = opts.mode;
        this.time = 0;
        this.seed = opts.seed || Math.floor(Math.random() * 1e9);
        this.world = new World(opts.mapId, this.seed, opts.mode);
        const pool = BIOME_WEATHER[this.world.map.biome];
        let wid = opts.weather && opts.weather !== "random" ? opts.weather : pool[Math.floor(Math.random() * pool.length)];
        if (!pool.includes(wid) && !opts.replica) wid = pool[0];
        if (opts.mode === "range") wid = "clear";
        this.weatherId = wid;
        this.weather = WEATHER[wid];
        this.difficulty = { easy: 0.68, normal: 1, hard: 1.22 }[opts.difficulty || "normal"] || 1;
        this.vehicles = [];
        this.shots = [];
        this.strikes = [];
        // нации команд: в одиночной игре — нация игрока против второй
        this.teamNation = opts.nations || [opts.nation, opts.mode === "boss" ? "germany" : opts.nation === "ussr" ? "germany" : "ussr"];
        this.nation = this.teamNation[0];
        this.enemyNation = this.teamNation[1];
        // «пилоты» — живые игроки; у одиночной игры один локальный пилот
        this.pilots = [];
        this.local = null;
        if (opts.pilots) {
            for (const p of opts.pilots) this.addPilot(p);
            this.local = this.pilots.find((p) => p.local) || null;
        } else if (opts.lineup) this.local = this.addPilot({ id: "local", name: "Вы", team: 0, lineup: opts.lineup, equipment: opts.equipment, local: true });
        this.playerTeam = this.local ? this.local.team : opts.viewTeam || 0;
        this.ended = false;
        this.result = null;
        this.spotAcc = 0;
        this.callIdx = [0, 0];
        const ids = this.pilots.flatMap((p) => p.lineup.map((l) => l.id));
        this.lineupBR = ids.length ? Math.max(...ids.map((id) => getVehicle(id).br)) : opts.br || 3;
        if (opts.replica) return;
        if (this.mode === "domination") this.modeCtl = new DominationMode(this);
        else if (this.mode === "waves") this.modeCtl = new WavesMode(this);
        else if (this.mode === "duel") this.modeCtl = new DuelMode(this);
        else if (this.mode === "boss") this.modeCtl = new BossMode(this);
        else this.modeCtl = new RangeMode(this);
        this.modeCtl.start();
    }

    addPilot(o) {
        const equipment = {}, used = new Set();
        for (const id of o.lineup) equipment[id] = readLoadout(getVehicle(id), o.equipment?.[id], used);
        const p = {
            equipment,
            id: o.id, name: o.name, team: o.team, nation: o.nation || this.teamNation[o.team], local: !!o.local,
            lineup: o.lineup.map((id) => ({ id, used: false, deaths: 0 })),
            sp: 0, spawns: 0, deathAt: -1, stats: freshStats(), vstats: {}, vehicle: null, left: false,
        };
        this.pilots.push(p);
        return p;
    }

    /* Совместимость с одиночной игрой: поля локального пилота */
    get player() { return this.local ? this.local.vehicle : null; }
    get lineup() { return this.local ? this.local.lineup : []; }
    get sp() { return this.local ? this.local.sp : 0; }
    get spawns() { return this.local ? this.local.spawns : 0; }
    get deathAt() { return this.local ? this.local.deathAt : -1; }
    get stats() { return this.local ? this.local.stats : freshStats(); }
    get vstats() { return this.local ? this.local.vstats : {}; }

    callsign(team) {
        const list = CALLSIGNS[team === this.playerTeam ? 0 : 1];
        const i = this.callIdx[team]++;
        return list[i % list.length] + (i >= list.length ? "-" + (Math.floor(i / list.length) + 1) : "");
    }

    /* ─────────── Спавн ─────────── */
    spawnVehicle(defId, team, x, z, a, opts = {}) {
        const def = getVehicle(defId);
        const [fx, fz] = this.world.nearestFree(x, z, 30);
        const v = new Vehicle(def, team, fx, fz, a, opts);
        v.spawnT = this.time;
        v.pilot = opts.pilot || null;
        v.callsign = opts.callsign || (opts.isPlayer ? "Вы" : opts.pilot ? opts.pilot.name : this.callsign(team));
        if (def.boss) {
            // босс: свои системы (экипаж-роли, станции вооружения) и свой ИИ
            v.boss = new RatteSystems(v, this);
            if (!v.rangeTarget) v.brain = new RatteBrain(v, this);
        } else if (!opts.pilot && !opts.static && !v.rangeTarget) {
            let skill = opts.skill ?? 0.55;
            if (team !== this.playerTeam) skill = clamp(skill * this.difficulty, 0.2, 0.95);
            v.brain = new Brain(v, this, skill);
        }
        // не спавнимся друг в друге
        for (let k = 0; k < (def.boss ? 0 : 24); k++) {
            const clash = this.vehicles.some((o) => Math.hypot(o.x - v.x, o.z - v.z) < o.def.bodyRadius + def.bodyRadius + (o.dead ? 2.5 : 1)) || this.world.isBlocked(v.x, v.z);
            if (!clash) break;
            const r = 6 + k * 1.5, ang = rnd(0, Math.PI * 2);
            v.x = fx + Math.cos(ang) * r; v.z = fz + Math.sin(ang) * r;
        }
        settleOnGround(v, this.world);
        this.vehicles.push(v);
        Events.emit("spawn", { v });
        return v;
    }

    spawnPoint(team) {
        const sp = this.world.spawns[team];
        return { x: sp.x + rnd(-sp.spread, sp.spread), z: sp.z + rnd(-6, 6), a: sp.a };
    }

    spawnCost(id, P = this.local) {
        if (this.modeCtl && this.modeCtl.freeSpawns) return 0;
        return P.spawns === 0 ? 0 : getVehicle(id).spCost;
    }

    canSpawn(id, P = this.local) {
        const e = P.lineup.find((l) => l.id === id);
        if (!e) return { ok: false, reason: "нет в сетапе" };
        if (this.mode !== "range" && e.used) return { ok: false, reason: "уже использована" };
        const cost = this.spawnCost(id, P);
        if (this.mode !== "range" && P.sp < cost) {
            // резервный выезд: если очков не хватает, неиспользованная машина становится доступна через время
            const wait = Config.SP.RESERVE_WAIT - (this.time - P.deathAt);
            if (P.deathAt >= 0 && wait <= 0) return { ok: true, cost: 0, reserve: true };
            return { ok: false, reason: "нужно " + cost + " ОВ" + (P.deathAt >= 0 ? " · резерв через " + Math.ceil(wait) + " с" : ""), cost, wait };
        }
        return { ok: true, cost };
    }

    anySpawnAvailable(P = this.local) {
        if (this.mode === "range") return true;
        return P.lineup.some((l) => this.canSpawn(l.id, P).ok);
    }

    /** Остались ли неиспользованные машины (с учётом будущего резервного выезда) */
    hasSpawnsLeft(P = this.local) {
        if (this.mode === "range") return true;
        return P.lineup.some((l) => !l.used);
    }

    spawnPlayer(id, P = this.local) {
        if (!P || this.ended) return null;
        const c = this.canSpawn(id, P);
        if (!c.ok || (P.vehicle && !P.vehicle.dead && this.mode !== "range")) return null;
        if (this.mode !== "range") {
            P.sp -= c.cost;
            P.lineup.find((l) => l.id === id).used = true;
        }
        if (P.vehicle && this.mode === "range") this.removeVehicle(P.vehicle);
        const p = this.modeCtl.playerSpawnPoint ? this.modeCtl.playerSpawnPoint(P) : this.spawnPoint(P.team);
        const v = this.spawnVehicle(id, P.team, p.x, p.z, p.a, { isPlayer: P.local, pilot: P, equipment: P.equipment[id] });
        P.vehicle = v;
        (P.vstats[id] = P.vstats[id] || { spawns: 0, kills: 0 }).spawns++;
        P.spawns++;
        Events.emit("playerSpawn", { v, pilot: P });
        return v;
    }

    removeVehicle(v) {
        const i = this.vehicles.indexOf(v);
        if (i >= 0) this.vehicles.splice(i, 1);
        this.world.removeWreckOf(v);
        Events.emit("vehicleRemoved", { v });
    }

    /* ─────────── Главный шаг ─────────── */
    update(dt) {
        if (this.ended && this.endT !== undefined) this.endT += dt;
        this.time += dt;
        this.lastDt = dt;
        for (const v of this.vehicles) if (v.brain && !v.dead) v.brain.update(dt);
        for (const v of this.vehicles) {
            if (v.dead) continue;
            if (v.cards) { v.cards.startX = v.x; v.cards.startZ = v.z; v.cards.startA = v.a; }
            driveVehicle(v, dt);
            this.aimTurret(v, dt);
            v.update(dt, this.time);
            if (v.fire) fireTick(this, v, dt);
        }
        resolveCollisions(this);
        for (const v of this.vehicles) {
            if (!v.cards || v.dead || v.cards.startX === undefined) continue;
            const dx = v.x - v.cards.startX, dz = v.z - v.cards.startZ;
            const distance = Math.hypot(dx,dz);
            const speed = Math.abs(v.v);
            if (speed < .3) {
                cardEvent(v,"still",dt);
                if (v.cards.wasMoving) cardEvent(v,"stop");
                v.cards.countedStart = false;
            } else if (speed >= 11/3.6 && !v.cards.countedStart) {
                cardEvent(v,"start");
                v.cards.countedStart = true;
            }
            v.cards.wasMoving = speed >= .3;
            cardEvent(v,"turn",Math.abs(angDiff(v.a,v.cards.startA))/DEG);
            if (!distance) continue;
            cardEvent(v,"travel",distance,this.time);
            if (speed >= 5) cardEvent(v,"fast",distance);
            const rise = this.world.h(v.x,v.z) - this.world.h(v.cards.startX,v.cards.startZ);
            if (rise > 0) cardEvent(v,"climb",rise);
            const back = -(dx*Math.cos(v.a) + dz*Math.sin(v.a));
            if (back > 0) cardEvent(v,"back",back,this.time);
            if (back < -.001) cardEvent(v,"forward");
        }
        for (const v of this.vehicles) if (!v.dead) settleOnGround(v, this.world, dt);
        this.updateStrikes(dt);
        updateShots(this, dt);
        this.spotAcc -= dt;
        if (this.spotAcc <= 0) { this.spotAcc = 0.25; this.updateSpotting(); }
        if (!this.ended) this.modeCtl.update(dt);
    }

    /** Поворот башни (или орудия в рубке) к точке прицеливания — в осях корпуса, стоящего на склоне */
    aimTurret(v, dt) {
        if (!v.aimPoint) { v.trRate = 0; return; }
        const T = v.def.turret;
        const loc = worldToHull(v, v.aimPoint);
        let want;
        if (T.casemate) {
            const piv = frameToHull(v, "gun", [0, 0, 0]);
            want = Math.atan2(loc[2] - piv[2], loc[0] - piv[0]);
            const arc = T.arc * Math.PI / 180;
            want = clamp(want, -arc, arc);
        } else {
            // относительный угол башни: от центра башни на точку
            want = Math.atan2(loc[2], loc[0] - T.x);
        }
        const rate = v.turretRate();
        const d = angDiff(v.tr, want);
        const step = clamp(d, -rate * dt, rate * dt);
        v.tr += step;
        if (!T.casemate) v.tr = angDiff(0, v.tr);
        v.trRate = step / Math.max(dt, 1e-4);
        // вертикальная наводка: ось ствола на точку прицеливания, в пределах УНН/УВН
        const er = v.elevRate();
        const dp = clamp(this.wantPitch(v) - v.gp, -er * dt, er * dt);
        v.gp += dp;
        if (v.cards && !this.net) {
            cardEvent(v,"slew",Math.abs(step)/DEG);
            cardEvent(v,"pitch",Math.abs(dp)/DEG);
        }
    }

    /** Нужный угол возвышения орудия относительно башни (в пределах его углов наводки), рад */
    wantPitch(v) {
        const E = v.def.gun.elev;
        return clamp(this.wantPitchRaw(v), E[0] * DEG, E[1] * DEG);
    }

    /** То же без ограничения углами наводки */
    wantPitchRaw(v) {
        if (!v.aimPoint) return 0;
        // точка в осях башни; от оси цапф — с учётом доворота орудия в рубке
        const q = hullToFrame(v, "turret", worldToHull(v, v.aimPoint));
        const piv = v.def.gunPivot, gr = v.gunRel();
        const dx = q[0] - piv[0], dz = q[2] - piv[2];
        const fx = dx * Math.cos(gr) + dz * Math.sin(gr);
        return Math.atan2(q[1] - piv[1], Math.max(3, Math.abs(fx) > 0.5 ? fx : Math.hypot(dx, dz)));
    }

    /** Линия выстрела — фактическая ось ствола (с наклоном корпуса на склоне) */
    fireLine(v, barrel = 0) {
        const off = v.def.gun.barrels ? v.def.gun.barrels[barrel] || 0 : 0;
        const m = hullToWorld(v, frameToHull(v, "gun", [v.def.gun.len, 0, off]));
        const dir = dirHullToWorld(v, dirFrameToHull(v, "gun", [1, 0, 0]));
        const yaw = Math.atan2(dir[2], dir[0]);
        const pitch = Math.asin(clamp(dir[1], -1, 1));
        return { m, yaw, pitch, dir };
    }

    /** Выстрел строго по оси ствола (у босса — залп из всех исправных стволов главного калибра) */
    fire(v) {
        if (!v.canFire()) return false;
        const def = archiveShell(v,SHELLS[v.loaded]);
        const barrels = v.boss ? v.boss.salvo().slice(0,v.ammo[v.loaded]) : [0];
        const sid = v.consumeShot(barrels.length);
        if (!sid) return false;
        let m, dir;
        for (const i of barrels) {
            ({ m, dir } = this.fireLine(v, i));
            this.shots.push(new Shot(v, def, m, dir));
            if (barrels.length > 1) Events.emit("shot", { v, def, pos: m, dir, barrel: i });
        }
        if (barrels.length > 1) {
            v.lastShot = this.time;
            v.recoil = 1;
            return true;
        }
        v.lastShot = this.time;
        v.bloom += def.cal >= 40 ? 1.6 : 0.35;
        v.recoil = 1;
        if (v.pilot) v.pilot.stats.shots++;
        Events.emit("shot", { v, def, pos: m, dir });
        return true;
    }

    /* ─────────── Артиллерийский удар ─────────── */
    artyLeft(v) {
        const ready = v.artyT !== undefined ? v.artyT : v.spawnT + Config.ARTY.FIRST;
        return Math.max(0, ready - this.time);
    }

    /** Перерыв между артударами машины, с (режим может сокращать — разведданные в битве с боссом) */
    artyCooldown(v) {
        const A = Config.ARTY;
        if (this.mode === "range") return 5 * v.cardFactor("arty");
        const m = this.modeCtl && this.modeCtl.artyCooldown ? this.modeCtl.artyCooldown(v) : null;
        return (m || A.COOLDOWN * (v.pilot ? 1 : A.BOT_MULT)) * v.cardFactor("arty");
    }
    artyRange(v) { return ((this.modeCtl && this.modeCtl.artyRange && this.modeCtl.artyRange(v)) || Config.ARTY.RANGE) * v.cardFactor("radioRange"); }

    callArtillery(v, x, z) {
        const A = Config.ARTY;
        if (!v || v.dead || this.ended) return { ok: false, reason: "недоступно" };
        const left = this.artyLeft(v);
        if (left > 0) return { ok: false, reason: "перезарядка " + Math.ceil(left) + " с" };
        if (Math.hypot(x - v.x, z - v.z) > this.artyRange(v)) return { ok: false, reason: "слишком далеко" };
        if (!v.pilot) {
            // ботам — один удар на команду за раз и общий перерыв (десятки разрывов разом тормозили игру)
            this.botArtyT = this.botArtyT || [0, 0];
            if (this.time < this.botArtyT[v.team] || this.strikes.some((s) => s.team === v.team && !s.done)) return { ok: false, reason: "занято" };
            this.botArtyT[v.team] = this.time + A.BOT_TEAM_GAP;
        }
        const S = this.world.S;
        x = clamp(x, 4, S - 4); z = clamp(z, 4, S - 4);
        v.artyT = this.time + this.artyCooldown(v);
        cardEvent(v,"arty",1,this.time);
        const sid = this.modeCtl && this.modeCtl.artyShell ? this.modeCtl.artyShell(v) : null;
        const def = SHELLS[sid || (v.def.nation === "ussr" ? "arty122" : "arty105")];
        const s = { x, z, team: v.team, by: v, def, t: 0, n: 0, total: A.SHELLS, r: A.SPREAD, next: A.DELAY, done: false };
        this.strikes.push(s);
        Events.emit("artyCalled", { strike: s, v });
        return { ok: true };
    }

    updateStrikes(dt) {
        for (const s of this.strikes) {
            s.t += dt;
            while (s.n < s.total && s.t >= s.next) {
                s.n++;
                s.next += rnd(0.22, 0.5);
                const a = rnd(0, TAU), r = Math.sqrt(Math.random()) * s.r;
                const px = s.x + Math.cos(a) * r, pz = s.z + Math.sin(a) * r;
                const dx = rnd(-0.06, 0.06), dz = rnd(-0.06, 0.06);
                const L = Math.hypot(dx, 1, dz);
                const gy = this.world.h(px, pz);
                const shot = new Shot(s.by, s.def, [px - dx * 70, gy + 70, pz - dz * 70], [dx / L, -1 / L, dz / L]);
                shot.ignore = null;
                shot.arty = true;
                this.shots.push(shot);
                Events.emit("artyShell", { x: px, z: pz, strike: s });
            }
            if (s.n >= s.total && s.t > s.next + 1.5) s.done = true;
        }
        if (this.strikes.length && this.strikes.some((s) => s.done)) this.strikes = this.strikes.filter((s) => !s.done);
    }

    /* ─────────── Засвет ─────────── */
    updateSpotting() {
        const observing = new Set();
        const C = Config.SPOT;
        const now = this.time;
        const wk = this.weather.spotK;
        for (const v of this.vehicles) {
            if (v.dead) continue;
            v.concealed = this.world.concealment(v.x, v.z, v.def.dims.W / 2);
        }
        for (const e of this.vehicles) {
            if (e.dead) { e.visible = [true, true]; continue; }
            e.visible[e.team] = true;
            const t = 1 - e.team;
            // босс виден всегда: 11 м высоты не спрятать
            const alwaysVisible = e.rangeTarget || e.static || e.def.boss;
            let seen = false;
            let memory = 0;
            const fired = now - e.lastShot < C.FIRED_REVEAL;
            for (const o of this.vehicles) {
                if (o.dead || o.team !== t) continue;
                const d = Math.hypot(o.x - e.x, o.z - e.z);
                if (seen && memory >= 1 && !o.cards) continue;
                let R = C.RANGE * wk * (o.hasSeat("commander") && !o.seatOk("commander") ? 0.8 : 1) * (o.def.boss ? 1.6 : 1);
                if (fired) R = 380 * Math.max(0.6, wk);
                else if (e.concealed > 0.3) {
                    const moving = Math.abs(e.v) > 1.2;
                    R = Math.min(R, (moving ? C.BUSH_MOVING : C.BUSH_STILL) * (1.25 - e.concealed * 0.45));
                }
                // глаза — на крыше башни наблюдателя, цель — верх корпуса и башня (из-за гребня видна башня)
                R *= o.cardFactor("spot");
                if (d < C.PROXIMITY || (d < R && this.world.los(o.x, o.z, e.x, e.z, null, o.y + o.def.dims.H + o.def.turret.h, e.y + e.def.dims.H + e.def.turret.h * 0.6))) {
                    seen = true;
                    memory = Math.max(memory,o.cardFactor("memory"));
                    if (o.cards) {
                        observing.add(o);
                        const contacts = o.cards.contacts ??= new Set();
                        if (!contacts.has(e.id)) {
                            contacts.add(e.id);
                            cardEvent(o,"discover");
                        }
                    }
                }
            }
            if (seen) e.spotT[t] = Math.max(e.spotT[t],now + C.MEMORY * memory);
            e.visible[t] = alwaysVisible || now < e.spotT[t];
        }
        for (const v of observing) cardEvent(v,"observe",.25);
    }

    /* ─────────── Начисления ─────────── */
    award(kind, mult = 1, P = this.local) {
        if (!P) return;
        const sp = Config.SP[kind] || 0, rp = Config.RP[kind] || 0;
        P.sp += Math.round(sp * mult);
        P.stats.rp += Math.round(rp * mult);
    }

    creditDamage(shooter, target, res) {
        if (!shooter || shooter.team === target.team) return;
        if (!res.dmg.length) return;
        shooter.stats.dmg += res.dmg.length;
        if (res.crit) shooter.stats.crits++;
        const P = shooter.pilot;
        if (P) {
            P.stats.dmgDone += res.dmg.length;
            if (res.crit) { P.stats.crits++; this.award("CRIT", 0.5 + target.def.rank * 0.5, P); }
            else this.award("HIT", 1, P);
        }
    }

    onShellHit(shot, v, res, wp) {
        const sh = shot.owner;
        if (sh && sh.team !== v.team) {
            if (!shot.arty && !shot.harmless && !sh.dead && res.kind !== "miss") {
                cardEvent(sh,"hit");
                if (res.kind === "pen" || res.kind === "he-pen") cardEvent(sh,"pen");
                if (res.kind === "nopen" || res.kind === "rico") cardEvent(sh,"blocked");
            }
            sh.stats.hits++;
            if (res.kind === "pen" || res.kind === "he-pen") sh.stats.pens++;
            const P = sh.pilot;
            if (P) {
                P.stats.hits++;
                if (res.kind === "pen" || res.kind === "he-pen") P.stats.pens++;
            }
            this.creditDamage(sh, v, res);
        }
        Events.emit("hit", { shooter: sh, target: v, res, shell: shot.def, world: wp, dir: shot.d });
    }

    destroyVehicle(v, cause, killer) {
        if (v.dead) return;
        v.kill(cause);
        v.deathT = this.time;
        v.killer = killer || null;
        this.world.addWreck(v);
        if (killer && killer !== v && killer.team !== v.team) {
            killer.stats.kills++;
            const P = killer.pilot;
            if (P) {
                P.stats.kills++;
                (P.vstats[killer.def.id] = P.vstats[killer.def.id] || { spawns: 0, kills: 0 }).kills++;
                this.award("KILL", 0.6 + v.def.rank * 0.4, P);
            }
        }
        // помощь
        for (const [id, t] of v.damagers) {
            if (killer && id === killer.id) continue;
            if (this.time - t > 30) continue;
            const a = this.vehicles.find((o) => o.id === id);
            if (!a || a.team === v.team) continue;
            a.stats.assists++;
            if (a.pilot) { a.pilot.stats.assists++; this.award("ASSIST", 1, a.pilot); }
        }
        if (v.pilot) { v.pilot.stats.deaths++; v.pilot.deathAt = this.time; }
        Events.emit("destroyed", { v, cause, killer });
        this.modeCtl.onDestroyed(v, killer);
    }

    end(winner, reason) {
        if (this.ended) return;
        this.ended = true;
        this.endT = 0;
        for (const P of this.pilots) if (P.team === winner) P.stats.rp = Math.round(P.stats.rp * Config.RP.WIN_MULT);
        const L = this.local;
        this.result = {
            rewardId: Date.now().toString(36) + "-" + this.seed,
            drop: L && rollDrop(false, this.mode === "boss" && winner === L.team, L.spawns),
            win: L ? winner === L.team : false, draw: winner === -1, winner, reason, mode: this.mode,
            stats: L ? { ...L.stats } : null,
            pilots: this.pilots.map((P) => ({ id: P.id, name: P.name, team: P.team, stats: { ...P.stats }, vstats: P.vstats })),
        };
        Events.emit("battleEnd", this.result);
    }
}
