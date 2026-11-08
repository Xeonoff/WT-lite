import { Config } from "../../core/Config.js";
import { Events } from "../../core/Events.js";
import { rnd, clamp, uid } from "../../core/Utils.js";
import { pickBotVehicle } from "./Domination.js";

/** Сопровождение «Ратте»: средние машины и не больше одного «Тигра» одновременно */
const ESCORT_POOL = [["pz4f2", 3], ["pz3j", 3], ["stug3f", 2]];
const ESCORT_HEAVY = "tiger_h1";

/**
 * Битва с боссом: сухопутный крейсер «Ратте» с эскортом идёт с севера к штабу у южного края карты.
 * Игроки (и союзные боты, если игроков мало) выезжают с юга; каждая машина сетапа — один раз, бесплатно.
 *
 * Точки разведданных (Р1–Р3) поначалу ничьи, за них спорят игроки и сопровождение. Удержанные командой —
 * передают разведданные: артудар (203-мм гаубицы Б-4, пробивают крышу «Ратте») доступен чаще и дальше.
 * Удержанные противником — передают «Ратте» обстановку: за каждую он идёт быстрее.
 * С подбитого сопровождения остаётся ящик трофейных кумулятивных снарядов.
 *
 * Победа — «Ратте» уничтожен (детонация погребов, пожар, гибель экипажа) или обезврежен: обездвижен
 * и без главного калибра — тогда экипаж покидает машину. Поражение — «Ратте» дошёл до штаба,
 * у команды кончилась техника или вышло время.
 */
export class BossMode {
    constructor(b) {
        this.b = b;
        const C = Config.BOSS;
        this.timeLeft = C.TIME;
        this.freeSpawns = true;
        this.hq = b.world.points.find((p) => p.hq);
        // для отрисовки: штаб (прогресс прорыва) и точки разведданных (прогресс захвата: + — команда 0)
        this.points = b.world.points.map((p) => (p.hq ? { ...p, owner: 0, prog: 0 } : { ...p, owner: -1, prog: 0, n: [0, 0] }));
        this.intel = this.points.filter((p) => p.intel);
        this.hqT = 0;
        this.escorts = [];
        this.allies = [];
        this.pickups = [];
        this.boss = null;
        this.route = null;
    }

    start() {
        const b = this.b, S = b.world.S, C = Config.BOSS;
        const sp = b.world.spawns[1];
        this.boss = b.spawnVehicle("ratte", 1, sp.x, sp.z, sp.a, { callsign: "«Ратте»" });
        // маршрут: три изгиба по карте и штаб; на изгибах «Ратте» останавливается
        const r = (k) => S * (0.5 + rnd(-k, k));
        this.route = [[r(0.16), S * 0.27], [r(0.22), S * 0.47], [r(0.2), S * 0.67], [this.hq.x, this.hq.z]];
        const players = Math.max(1, b.pilots.filter((P) => P.team === 0).length);
        this.br = b.lineupBR;
        const n = Math.min(C.ESCORT_MAX, C.ESCORT_BASE + Math.round(players * C.ESCORT_PER_PLAYER));
        for (let i = 0; i < n; i++) this.spawnEscort();
        // союзники — если игроков меньше, чем нужно для боя
        const allies = Math.max(0, C.TEAM_MIN - players);
        for (let i = 0; i < allies; i++) {
            const id = pickBotVehicle(b.teamNation[0], Math.max(3, this.br - 0.5), i === 0 ? "heavy" : null);
            const spp = b.world.spawns[0];
            const v = b.spawnVehicle(id, 0, spp.x + rnd(-spp.spread, spp.spread), spp.z + rnd(-6, 6), spp.a, { skill: C.ALLY_SKILL });
            v.flank = i % 2 ? 1 : -1;
            v.intelGoal = i < this.intel.length ? this.intel[i] : null;
            this.allies.push(v);
        }
    }

    escortId() {
        const heavyAlive = this.escorts.some((v) => !v.dead && v.def.id === ESCORT_HEAVY);
        if (!heavyAlive && rnd() < 0.25) return ESCORT_HEAVY;
        let s = rnd(0, ESCORT_POOL.reduce((a, [, w]) => a + w, 0));
        for (const [id, w] of ESCORT_POOL) { s -= w; if (s <= 0) return id; }
        return ESCORT_POOL[0][0];
    }

    spawnEscort() {
        const b = this.b, B = this.boss;
        const id = this.escortId();
        // за кормой и по бортам «Ратте»
        const side = rnd() < 0.5 ? -1 : 1;
        const back = rnd(30, 45), off = side * rnd(18, 30);
        const x = B.x - Math.cos(B.a) * back - Math.sin(B.a) * off, z = B.z - Math.sin(B.a) * back + Math.cos(B.a) * off;
        const v = b.spawnVehicle(id, 1, clamp(x, 20, b.world.S - 20), clamp(z, 20, b.world.S - 20), B.a, { skill: Config.BOSS.ESCORT_SKILL });
        v.escortSide = side;
        // каждый второй (начиная с первого) — на захват точек разведданных, остальные — охрана «Ратте»
        v.duty = this.escorts.length % 2 === 0 ? "capture" : "guard";
        this.escorts.push(v);
        return v;
    }

    /** Радио «Ратте»: подкрепление, если сопровождение поредело */
    onBossRadio() {
        const alive = this.escorts.filter((v) => !v.dead).length;
        const n = Math.min(Config.BOSS.REINFORCE, Config.BOSS.ESCORT_MAX - alive);
        if (n <= 0) return false;
        for (let i = 0; i < n; i++) this.spawnEscort();
        return true;
    }

    playerSpawnPoint(P) {
        const sp = this.b.world.spawns[0];
        return { x: sp.x + rnd(-sp.spread, sp.spread), z: sp.z + rnd(-5, 5), a: sp.a };
    }

    /* ─────────── Артиллерия по разведданным ─────────── */
    intelHeld(team = 0) { return this.intel.filter((p) => p.owner === team).length; }
    /** Множитель скорости «Ратте»: точки разведданных у противника (сопровождения) */
    bossSpeedK() { return 1 + Config.BOSS.SPEED_PER_POINT * this.intelHeld(1); }
    artyCooldown(v) {
        if (v.team !== 0) return null;
        return Config.BOSS.ARTY_COOLDOWN * Math.pow(Config.BOSS.INTEL_K, this.intelHeld());
    }
    artyRange(v) { return v.team === 0 ? Config.BOSS.ARTY_RANGE : null; }
    artyShell(v) { return v.team === 0 ? "arty203" : null; }

    update(dt) {
        const b = this.b, B = this.boss;
        this.timeLeft -= dt;
        if (!B || b.ended) return;
        this.updateIntel(dt);
        this.updatePickups();
        if (B.dead) return;
        const sm = B.boss.summary();
        // обезврежен: не двигается и главный калибр молчит — экипаж покидает машину
        if (sm.disabled) {
            this.disT = (this.disT || 0) + dt;
            if (this.disT > 4) {
                Events.emit("bossNote", { v: B, text: "обездвижен и обезоружен — экипаж покидает машину", kind: "good" });
                b.destroyVehicle(B, "crew", this.lastHitter());
                return;
            }
        } else this.disT = 0;
        // прорыв к штабу
        const d = Math.hypot(B.x - this.hq.x, B.z - this.hq.z);
        if (d < this.hq.r + 18) this.hqT += dt; else this.hqT = Math.max(0, this.hqT - dt * 0.5);
        this.points[0].prog = -Math.min(100, (this.hqT / Config.BOSS.HQ_TIME) * 100);
        if (this.hqT >= Config.BOSS.HQ_TIME) { b.end(1, "«Ратте» прорвался к штабу"); return; }
        if (this.timeLeft <= 0) { b.end(1, "время вышло — «Ратте» не остановлен"); return; }
        // у команды кончилась техника
        const alive0 = b.vehicles.some((v) => !v.dead && v.team === 0 && !v.static);
        const spare = b.pilots.some((P) => P.team === 0 && !P.left && P.lineup.some((l) => !l.used));
        if (!alive0 && !spare && b.time > 5) b.end(1, "у команды не осталось техники");
    }

    /** Захват точек разведданных: машины одной стороны внутри круга двигают прогресс */
    updateIntel(dt) {
        const b = this.b, rate = 100 / Config.BOSS.INTEL_CAP;
        for (const p of this.intel) {
            const n = [0, 0];
            for (const v of b.vehicles) {
                if (v.dead || v.static || v.def.boss) continue;
                if (Math.hypot(v.x - p.x, v.z - p.z) < p.r) n[v.team]++;
            }
            p.n = n;
            if (n[0] && n[1]) continue;
            const prev = p.owner;
            if (n[0]) p.prog = Math.min(100, p.prog + rate * dt * Math.min(2, n[0]));
            else if (n[1]) p.prog = Math.max(-100, p.prog - rate * dt * Math.min(2, n[1]));
            else continue;
            if (p.prog >= 100) p.owner = 0;
            else if (p.prog <= -100) p.owner = 1;
            else if ((prev === 0 && p.prog < 0) || (prev === 1 && p.prog > 0)) p.owner = -1;
            if (p.owner !== prev) {
                Events.emit("pointChange", { p, owner: p.owner, prev });
                if (p.owner === 1 || prev === 1) {
                    const k = this.bossSpeedK();
                    Events.emit("bossNote", { v: this.boss, text: p.owner === 1 ? `сопровождение взяло точку ${p.id} — «Ратте» ускоряется (×${k.toFixed(1)})` : `точка ${p.id} отбита — «Ратте» замедляется (×${k.toFixed(1)})`, kind: p.owner === 1 ? "bad" : "good" });
                }
                if (p.owner === 0) for (const P of b.pilots) if (P.team === 0 && P.vehicle && !P.vehicle.dead && Math.hypot(P.vehicle.x - p.x, P.vehicle.z - p.z) < p.r) b.award("CAPTURE", 1, P);
            }
        }
    }

    /** Ящики с трофеями: подбирает первая машина команды, проехавшая рядом */
    updatePickups() {
        const b = this.b;
        if (!this.pickups.length) return;
        for (const pk of this.pickups) {
            if (b.time > pk.t) { pk.gone = true; continue; }
            for (const v of b.vehicles) {
                if (v.dead || v.team !== 0 || v.static || v.def.boss) continue;
                if (Math.hypot(v.x - pk.x, v.z - pk.z) > v.def.bodyRadius + 2.5) continue;
                const id = v.addTrophy(pk.n);
                if (!id) continue;
                pk.gone = true;
                Events.emit("pickup", { v, id, n: pk.n });
                break;
            }
        }
        this.pickups = this.pickups.filter((pk) => !pk.gone);
    }

    lastHitter() {
        const B = this.boss;
        let best = null, bt = -1;
        for (const [id, t] of B.damagers) if (t > bt) { const v = this.b.vehicles.find((o) => o.id === id); if (v) { best = v; bt = t; } }
        return best;
    }

    onDestroyed(v, killer) {
        if (v === this.boss) {
            this.b.end(0, v.deathCause === "ammo" ? "«Ратте» уничтожен: детонация погребов" : v.deathCause === "fire" ? "«Ратте» сгорел" : "«Ратте» уничтожен");
            return;
        }
        // с подбитого сопровождения — ящик трофейных кумулятивных снарядов
        if (v.team === 1) this.pickups.push({ id: uid(), x: v.x, z: v.z, t: this.b.time + Config.BOSS.TROPHY_LIFE, n: Config.BOSS.TROPHY_ROUNDS });
    }

    /** Цели ИИ: сопровождение держится у бортов «Ратте», союзники берут точки разведданных и заходят с флангов к корме */
    goalFor(v, brain) {
        const B = this.boss, S = this.b.world.S;
        if (!B) return null;
        if (v.team === 1) {
            if (B.dead) return { x: this.hq.x, z: this.hq.z, r: 30 };
            if (v.duty === "capture") {
                const p = this.captureTarget(v, brain);
                if (p) return { x: p.x + rnd(-p.r * 0.5, p.r * 0.5), z: p.z + rnd(-p.r * 0.5, p.r * 0.5), r: p.r * 0.45, cx: p.x, cz: p.z, wander: p.r * 0.55 };
            }
            const side = v.escortSide || 1;
            const ahead = 25, off = side * 32;
            return { x: B.x + Math.cos(B.a) * ahead - Math.sin(B.a) * off, z: B.z + Math.sin(B.a) * ahead + Math.cos(B.a) * off, r: 14 };
        }
        // трофей поблизости — за ним
        const pk = this.pickups.find((q) => Math.hypot(q.x - v.x, q.z - v.z) < 90);
        if (pk) return { x: pk.x, z: pk.z, r: 2, pickup: true };
        if (v.intelGoal && v.intelGoal.owner !== 0) return { x: v.intelGoal.x, z: v.intelGoal.z, r: 6 };
        const side = v.flank || 1;
        // фланг и корма: там тоньше броня
        const back = 70, off = side * 110;
        const x = B.x - Math.cos(B.a) * back - Math.sin(B.a) * off, z = B.z - Math.sin(B.a) * back + Math.cos(B.a) * off;
        return { x: clamp(x, 25, S - 25), z: clamp(z, 25, S - 25), r: 20 };
    }

    /**
     * Точка для сопровождения на захвате: не своя или которую отбивают; если все свои — держит ту,
     * к которой ближе всего игроки. Цель пересматривается раз в 10–18 с.
     */
    captureTarget(v, brain) {
        const b = this.b;
        if (brain.assign && b.time < brain.assignT && !(brain.assign.owner === 1 && brain.assign.prog <= -99 && !(brain.assign.n && brain.assign.n[0]))) return brain.assign;
        brain.assignT = b.time + rnd(10, 18);
        let best = null, bestS = Infinity;
        for (const p of this.intel) {
            const d = Math.hypot(p.x - v.x, p.z - v.z);
            let s = d / 120 + rnd(0, 0.8);
            if (p.owner === 1 && p.prog <= -99) s += 3;          // уже наша и спокойно
            if (p.n && p.n[0]) s -= 1;                          // отбивают — на помощь
            if (s < bestS) { bestS = s; best = p; }
        }
        brain.assign = best;
        return best;
    }

    hud() {
        const B = this.boss;
        const sm = B && B.boss ? B.boss.summary() : null;
        const held = this.intelHeld();
        return {
            kind: "boss", time: this.timeLeft, dead: !B || B.dead,
            eff: sm ? sm.eff : 0, crew: sm ? sm.crew : 0, crewMax: sm ? sm.crewMax : 20,
            sys: sm ? [sm.main, sm.t2, sm.flak, sm.mg, sm.eng, sm.mob ? 1 : 0, sm.radio ? 1 : 0] : [0, 0, 0, 0, 0, 0, 0],
            hq: this.hqT / Config.BOSS.HQ_TIME, dist: B ? Math.max(0, Math.round(Math.hypot(B.x - this.hq.x, B.z - this.hq.z) - this.hq.r)) : 0,
            intel: held, intelEnemy: this.intelHeld(1), intelMax: this.intel.length, speedK: this.bossSpeedK(), artyCd: Config.BOSS.ARTY_COOLDOWN * Math.pow(Config.BOSS.INTEL_K, held),
        };
    }

    netState() {
        const h = this.hud(), r2 = (x) => Math.round(x * 100) / 100;
        return {
            k: "boss", tl: r2(h.time), e: r2(h.eff), c: h.crew, s: h.sys, hq: r2(h.hq), d: h.dist, x: h.dead ? 1 : 0,
            p: this.intel.map((p) => [p.owner, Math.round(p.prog)]),
            pk: this.pickups.map((q) => [q.id, Math.round(q.x * 10) / 10, Math.round(q.z * 10) / 10]),
        };
    }
}
