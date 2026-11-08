import { Events } from "../core/Events.js";
import { DEG, clamp, rnd, angDiff } from "../core/Utils.js";
import { SHELLS, shellSpeed } from "../data/Shells.js";
import { modState, TRANS_F, DRIVE_F, RACK_RELOAD, BREECH_RELOAD } from "./Vehicle.js";
import { Shot } from "./Projectiles.js";
import { hullToWorld, worldToHull, frameToHull, dirFrameToHull, dirHullToWorld } from "./Armor.js";

/**
 * «Ратте»: системы сверхтяжёлой машины.
 *
 * Каждая функция держится на живом расчёте и исправных агрегатах:
 *  - ход — хотя бы один мехвод, работающие двигатели (из восьми), трансмиссия и хотя бы одна гусеница на борт;
 *    скорость падает с каждым выбитым двигателем и гусеницей, без радиаторов двигатели перегреваются;
 *  - главный калибр — каждый ствол стреляет, пока цел его ствол, казённик и жив его наводчик; заряжающие и
 *    элеваторы задают темп, дальномер и командир — точность; поворот башни — от привода и генераторов;
 *  - кормовая башня 128 мм, две зенитки и два носовых пулемёта — свои расчёты и модули;
 *  - радисты вызывают подкрепление, мотористы чинят двигатели и тушат пожар, лазарет лечит раненых.
 * Выбывших заменяют пересадкой: заряжающий встаёт к прицелу, радист — за рычаги, дальномерщик — на место командира.
 */

const MAIN = [
    { barrel: "barrel", breech: "breech", gunlayer: "gunlayer_l", loader: "loader_l" },
    { barrel: "barrel_r", breech: "breech_r", gunlayer: "gunlayer_r", loader: "loader_r" },
];
const ENGINES = ["engine", "engine_2", "engine_3", "engine_4", "engine_5", "engine_6", "engine_7", "engine_8"];
const TRACKS = { L: ["trackL", "trackL2", "trackL3"], R: ["trackR", "trackR2", "trackR3"] };
const MECHANICS = ["mech_1", "mech_2", "mech_3"];
const HOIST_F = [1, 1.25, 1.6, 2.8];
const MOD_RU = { transmission: "трансмиссию", radiator: "радиаторы", generator: "генераторы", drive: "привод башни" };

/** Пересадки: [место, доноры по приоритету, нужно ли место сейчас] */
const SWAPS = [
    ["driver_l", ["radio_1", "radio_2", "mg_l", "mg_r", "mech_1", "mech_2", "mech_3"], (S) => S.drivers() === 0],
    ["gunlayer_l", ["loader_l", "loader_r"], (S) => S.alive("barrel") && S.alive("breech")],
    ["gunlayer_r", ["loader_r", "loader_l"], (S) => S.alive("barrel_r") && S.alive("breech_r")],
    ["commander", ["rangefinder"], () => true],
    ["t2_gunner", ["t2_loader", "t2_cmd"], (S) => S.alive("barrel2") && S.alive("breech2")],
    ["driver_r", ["radio_2", "radio_1"], (S) => S.drivers() === 1],
];
const SWAP_DUR = { same: 6, "hull:turret": 14, "hull:turret2": 9, "turret:turret2": 16 };

/** Станции вторичного вооружения: o — точка (корпус, игра), arc — разрешённый курс или dead — мёртвый сектор вперёд */
const STATIONS = {
    t2: { name: "Башня 128 мм", kind: "turret", crew: "t2_gunner", needs: ["barrel2", "breech2"], drive: "drive2",
        yawRate: 11, pitchRate: 6, dead: 35, range: 520, reload: 8.5, shells: ["pzgr43_128", "sprgr128"], ammo: { pzgr43_128: 24, sprgr128: 20 } },
    flak_l: { name: "Зенитка (левая)", kind: "flak", crew: "flak_l", needs: ["flak_l"], o: [-14.0, 8.25, -4.8], elev: [-10, 80],
        yawRate: 55, pitchRate: 40, dead: 42, range: 330, burst: 8, gap: 0.09, pause: 2.6, shells: ["pzgr20", "sprgr20"], ammo: { pzgr20: 400, sprgr20: 240 } },
    flak_r: { name: "Зенитка (правая)", kind: "flak", crew: "flak_r", needs: ["flak_r"], o: [-14.0, 8.25, 4.8], elev: [-10, 80],
        yawRate: 55, pitchRate: 40, dead: 42, range: 330, burst: 8, gap: 0.09, pause: 2.6, shells: ["pzgr20", "sprgr20"], ammo: { pzgr20: 400, sprgr20: 240 } },
    mg_l: { name: "Пулемёт (левый)", kind: "mg", crew: "mg_l", needs: ["mg_l"], o: [15.8, 5.6, -3.4], elev: [-12, 15],
        yawRate: 40, pitchRate: 30, arc: 30, range: 260, burst: 5, gap: 0.11, pause: 1.6, shells: ["pzgr15"], ammo: { pzgr15: 900 } },
    mg_r: { name: "Пулемёт (правый)", kind: "mg", crew: "mg_r", needs: ["mg_r"], o: [15.8, 5.6, 3.4], elev: [-12, 15],
        yawRate: 40, pitchRate: 30, arc: 30, range: 260, burst: 5, gap: 0.11, pause: 1.6, shells: ["pzgr15"], ammo: { pzgr15: 900 } },
};
export const STATION_IDS = Object.keys(STATIONS);

export class RatteSystems {
    constructor(v, battle) {
        this.v = v;
        this.b = battle;
        this.repairT = 18;
        this.radioT = 55;
        this.healAcc = 0;
        this.t2Gone = false;
        this.stations = {};
        for (const id of STATION_IDS) {
            const D = STATIONS[id];
            this.stations[id] = { id, D, s: v.stn[id], target: null, think: rnd(0.5), reload: rnd(1, 3), burst: 0, gapT: 0, err: [0, 0, 0], errT: 0, ammo: { ...D.ammo }, aligned: false };
        }
    }

    /* ─────────── Состояние ─────────── */
    ok(seat) { return this.v.seatOk(seat); }
    alive(id) { const m = this.v.mods[id]; return !!m && m.hp > 0; }
    st(id) { return modState(this.v.mods[id]); }
    drivers() { return (this.ok("driver_l") ? 1 : 0) + (this.ok("driver_r") ? 1 : 0); }
    enginesUp() { let n = 0; for (const id of ENGINES) n += this.alive(id) ? (this.st(id) >= 2 ? 0.5 : 1) : 0; return n; }
    tracksUp(side) { return TRACKS[side].reduce((n, id) => n + (this.alive(id) ? 1 : 0), 0); }
    tracksOk() { return this.tracksUp("L") > 0 && this.tracksUp("R") > 0; }

    canDrive() {
        const v = this.v;
        return !v.dead && !v.static && this.drivers() > 0 && this.enginesUp() > 0 && this.alive("transmission") && this.tracksOk();
    }
    mobilityF() {
        if (!this.canDrive()) return 0;
        let f = Math.pow(this.enginesUp() / ENGINES.length, 0.7) * TRANS_F[this.st("transmission")];
        if (!this.alive("radiators")) f *= 0.75;
        if (this.drivers() === 1) f *= 0.85;
        f *= 0.5 + 0.5 * Math.min(this.tracksUp("L"), this.tracksUp("R")) / 3;
        if (this.v.fire) f *= 0.85;
        return f;
    }
    /** Режим может ускорять «Ратте» (точки разведданных у сопровождения в битве с боссом) */
    modeSpeedK() { const mc = this.b.modeCtl; return mc && mc.bossSpeedK ? mc.bossSpeedK() : 1; }
    maxSpeed() { return (this.v.def.mob.speed / 3.6) * this.mobilityF() * this.modeSpeedK(); }
    maxReverse() { return (this.v.def.mob.reverse / 3.6) * this.mobilityF(); }
    accel() { return 0.5 * Math.max(0.3, this.mobilityF()); }
    turnRate() {
        if (!this.canDrive()) return 0;
        const tk = Math.min(this.tracksUp("L"), this.tracksUp("R")) / 3;
        return this.v.def.mob.hull * DEG * (this.drivers() === 2 ? 1 : 0.75) * (0.55 + 0.45 * tk) * TRANS_F[this.st("transmission")];
    }

    /** Главный калибр: какие стволы могут дать залп (ствол, казённик и наводчик на месте) */
    salvo() {
        const out = [];
        MAIN.forEach((g, i) => { if (this.alive(g.barrel) && this.alive(g.breech) && this.ok(g.gunlayer)) out.push(i); });
        return out;
    }
    gunBroken() { return this.salvo().length === 0; }
    canReload() { return MAIN.some((g) => this.ok(g.loader) || this.ok(g.gunlayer)); }
    turretRate() {
        const v = this.v;
        if (v.dead || !(this.ok("gunlayer_l") || this.ok("gunlayer_r") || this.ok("commander"))) return 0;
        let f = DRIVE_F[this.st("drive")];
        if (!this.alive("generators")) f *= 0.35;          // вручную
        if (!this.ok("commander")) f *= 0.85;
        return v.def.mob.turret * DEG * f;
    }
    elevRate() {
        if (this.v.dead || !(this.ok("gunlayer_l") || this.ok("gunlayer_r"))) return 0;
        return this.v.def.gun.elevRate * DEG * (this.alive("generators") ? 1 : 0.5);
    }
    reloadTime() {
        const v = this.v;
        const loaders = MAIN.reduce((n, g) => n + (this.ok(g.loader) ? 1 : 0), 0);
        let m = loaders === 2 ? 1 : loaders === 1 ? 1.6 : 2.8;
        m *= HOIST_F[this.st("hoists")];
        let worst = 0;
        for (const id of v.def.rackOrder) worst = Math.max(worst, this.st(id));
        m *= RACK_RELOAD[worst];
        let br = 0;
        for (const i of this.salvo()) br = Math.max(br, this.st(MAIN[i].breech));
        m *= BREECH_RELOAD[br];
        return v.def.gun.reload * m;
    }
    /** Точность главного калибра: множитель разброса прицеливания (1 — дальномер и командир на месте) */
    aimSpread() {
        let k = this.alive("rangefinder") && this.ok("rangefinder") ? 1 : 2.6;
        if (!this.ok("commander")) k *= 1.3;
        return k;
    }

    stationUp(id) {
        const S = this.stations[id], D = S.D;
        if (this.v.dead || (id === "t2" && this.t2Gone)) return false;
        return this.ok(D.crew) && D.needs.every((m) => this.alive(m));
    }

    /** Боеспособность 0…1 и сводка систем (для панели босса и сети) */
    summary() {
        const v = this.v;
        const main = this.salvo().length;
        const t2 = this.stationUp("t2") ? 1 : 0;
        const flak = (this.stationUp("flak_l") ? 1 : 0) + (this.stationUp("flak_r") ? 1 : 0);
        const mg = (this.stationUp("mg_l") ? 1 : 0) + (this.stationUp("mg_r") ? 1 : 0);
        const mobF = this.mobilityF();
        const crew = v.aliveCrew();
        const radio = this.alive("radio") && (this.ok("radio_1") || this.ok("radio_2"));
        const eff = v.dead ? 0 : 0.3 * main / 2 + 0.12 * t2 + 0.08 * (flak + mg) / 4 + 0.25 * mobF + 0.25 * crew / v.def.crew.length;
        return { main, t2, flak, mg, eng: Math.round(this.enginesUp() * 2) / 2, mob: this.canDrive(), radio, crew, crewMax: v.def.crew.length, eff, disabled: !this.canDrive() && main === 0 };
    }

    note(text, kind = "info") { Events.emit("bossNote", { v: this.v, text, kind }); }

    /* ─────────── Пересадки экипажа ─────────── */
    updateCrewSwap(dt) {
        const v = this.v;
        if (v.swap) {
            const sw = v.swap;
            if (!sw.member.alive) { v.swap = null; return; }
            sw.t += dt;
            if (sw.t >= sw.dur) {
                const target = v.seats[sw.to];
                sw.member.transit = false;
                sw.member.seat = sw.to;
                target.occupant = sw.member;
                v.swap = null;
                Events.emit("crewSwapDone", { v, member: sw.member, to: sw.to });
                this.note(`${v.def.crewTitles[sw.member.home]} занял место: ${v.def.crewTitles[sw.to].toLowerCase()}`, "swap");
            }
            return;
        }
        if (v.dead || v.aliveCrew() < v.minCrew()) return;
        for (const [need, donors, wanted] of SWAPS) {
            const s = v.seats[need];
            if (s.occupant && s.occupant.alive) continue;
            if (!wanted(this)) continue;
            for (const dn of donors) {
                const ds = v.seats[dn];
                if (!ds || !ds.occupant || !ds.occupant.alive || ds.occupant.transit) continue;
                const member = ds.occupant;
                ds.occupant = null;
                member.transit = true;
                const fa = ds.def.frame === "gun" ? "turret" : ds.def.frame, fb = s.def.frame === "gun" ? "turret" : s.def.frame;
                const key = fa === fb ? "same" : [fa, fb].sort().join(":");
                const dur = SWAP_DUR[key] || 12;
                v.swap = { member, from: dn, to: need, t: 0, dur };
                Events.emit("crewSwap", { v, member, from: dn, to: need, dur });
                return;
            }
        }
    }

    /* ─────────── Повреждения: последствия для босса ─────────── */
    onModuleHit(ctx, m, before, src) {
        const v = this.v;
        if (m.hp > 0 || before <= 0) return;
        if (m.type === "ammo2" && !this.t2Gone && Math.random() < 0.6) {
            // детонация укладки 128 мм: расчёт кормовой башни погибает, башня выведена
            this.t2Gone = true;
            ctx.res.events.push("t2det");
            for (const id of ["barrel2", "breech2", "drive2"]) if (v.mods[id]) v.mods[id].hp = 0;
            for (const sname of ["t2_cmd", "t2_gunner", "t2_loader"]) {
                const o = v.seats[sname].occupant;
                if (o && o.alive) { o.hp = 0; o.alive = false; ctx.res.dmg.push({ id: sname, kind: "crew", name: v.def.crewTitles[sname], before: o.maxHp, after: 0, max: o.maxHp }); Events.emit("crewKO", { v, seat: sname, member: o, by: ctx.shooter }); }
            }
            const p = hullToWorld(v, frameToHull(v, "turret2", [0, 1.2, 0]));
            Events.emit("explosion", { x: p[0], y: p[1], z: p[2], size: 2.2, ground: false });
            this.note("Детонация боеукладки кормовой башни! Башня 128 мм выведена", "good");
        } else if (m.type === "flak") this.note(`Зенитная установка выведена (${m.id === "flak_l" ? "левая" : "правая"})`, "good");
        else if (m.type === "barrel" || m.type === "breech") {
            if (m.id === "barrel2" || m.id === "breech2") this.note("Орудие кормовой башни выведено", "good");
            else this.note(`Главный калибр: ${m.id.endsWith("_r") ? "правое" : "левое"} орудие выведено`, "good");
        } else if (m.type === "engine") this.note(`Двигатель выведен — работают ${this.enginesUp()} из ${ENGINES.length}`, "good");
        else if (m.type === "track") {
            const side = m.id.startsWith("trackL") ? "L" : "R", n = this.tracksUp(side);
            if (n <= 1) this.note(`Сбита гусеница: на ${side === "L" ? "левом" : "правом"} борту ${n ? "осталась одна" : "не осталось ни одной"}`, "good");
        }
        else if (m.type === "radio") this.note("Радиорубка разбита — подкреплений не будет", "good");
        else if (m.type === "hoist") this.note("Элеваторы подачи выведены — главный калибр заряжает вручную", "good");
        else if (m.type === "generator") this.note("Генераторы выведены — башни крутят вручную", "good");
        else if (m.id === "rangefinder") this.note("Дальномер разбит — главный калибр мажет", "good");
    }

    /* ─────────── Обновление ─────────── */
    update(dt) {
        const v = this.v;
        if (v.dead) return;
        this.updateMechanics(dt);
        this.updateInfirmary(dt);
        this.updateRadio(dt);
        for (const id of STATION_IDS) this.updateStation(this.stations[id], dt);
    }

    /** Мотористы: тушат пожар и понемногу восстанавливают двигатели, ходовую и агрегаты */
    updateMechanics(dt) {
        const v = this.v;
        const mechs = MECHANICS.filter((s) => this.ok(s)).length;
        if (v.fire && mechs) {
            if (Math.random() < dt * 0.05 * mechs) {
                v.fire = null;
                Events.emit("fireOut", { v, ext: true });
                this.note("Мотористы потушили пожар");
            }
        }
        this.repairT -= dt;
        if (this.repairT > 0) return;
        this.repairT = 18;
        for (let k = 0; k < mechs; k++) {
            const list = [...ENGINES, "transmission", ...TRACKS.L, ...TRACKS.R, "radiators", "generators", "drive"]
                .map((id) => v.mods[id]).filter((m) => m && m.hp < m.maxHp * 0.7)
                .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp);
            const m = list[0];
            if (!m) break;
            const was = m.hp;
            m.hp = Math.min(m.maxHp * 0.7, Math.max(m.maxHp * 0.3, m.hp + m.maxHp * 0.3));
            if (was <= 0 && m.type !== "track") this.note(`Мотористы восстановили: ${m.type === "engine" ? "двигатель" : MOD_RU[m.type] || m.id}`, "bad");
        }
    }

    /** Лазарет: пока цел, раненые понемногу выздоравливают */
    updateInfirmary(dt) {
        if (!this.alive("infirmary")) return;
        this.healAcc += dt;
        if (this.healAcc < 1) return;
        this.healAcc -= 1;
        for (const c of this.v.crew) if (c.alive && c.hp < c.maxHp) c.hp = Math.min(c.maxHp, c.hp + 0.8);
    }

    /** Радисты: вызов подкрепления сопровождения через режим */
    updateRadio(dt) {
        this.radioT -= dt;
        if (this.radioT > 0) return;
        this.radioT = 80;
        if (!this.alive("radio") || !(this.ok("radio_1") || this.ok("radio_2"))) return;
        const mc = this.b.modeCtl;
        if (mc && mc.onBossRadio && mc.onBossRadio(this.v)) this.note("«Ратте» вызвал подкрепление по радио", "bad");
    }

    /* ─────────── Станции вторичного вооружения ─────────── */
    /** Точка станции и её ось в осях корпуса */
    stationPose(S) {
        const v = this.v;
        if (S.id === "t2") {
            const piv = frameToHull(v, "gun2", [0, 0, 0]);
            return { o: piv, muzzle: () => hullToWorld(v, frameToHull(v, "gun2", [v.def.turret2.muzzle, 0, 0])), dir: () => dirHullToWorld(v, dirFrameToHull(v, "gun2", [1, 0, 0])) };
        }
        const o = S.D.o;
        const dirH = () => { const s = S.s; return [Math.cos(s.pitch) * Math.cos(s.yaw), Math.sin(s.pitch), Math.cos(s.pitch) * Math.sin(s.yaw)]; };
        return {
            o,
            muzzle: () => { const d = dirH(); return hullToWorld(v, [o[0] + d[0] * 1.3, o[1] + d[1] * 1.3, o[2] + d[2] * 1.3]); },
            dir: () => dirHullToWorld(v, dirH()),
        };
    }

    yawAllowed(D, yaw) {
        if (D.arc) return Math.abs(angDiff(0, yaw)) <= D.arc * DEG;
        if (D.dead) return Math.abs(angDiff(0, yaw)) >= D.dead * DEG;
        return true;
    }

    stationAim(S, t, pose) {
        const v = this.v, D = S.D;
        const c = hullToWorld(t, [0, t.def.dims.H * 0.6, 0]);
        const sid = D.shells[0];
        const dist = Math.hypot(c[0] - v.x, c[2] - v.z);
        const tof = dist / shellSpeed(SHELLS[sid]);
        const k = D.kind === "turret" ? 0.006 * (this.ok("t2_cmd") ? 1 : 1.6) : D.kind === "flak" ? 0.011 : 0.014;
        S.errT -= 0.4;
        if (S.errT <= 0) { S.errT = 1.2; const r = dist * k + 0.3; S.err = [rnd(-r, r), rnd(-r, r) * 0.3, rnd(-r, r)]; }
        const w = [c[0] + Math.cos(t.a) * t.v * tof * 0.85 + S.err[0], c[1] + S.err[1], c[2] + Math.sin(t.a) * t.v * tof * 0.85 + S.err[2]];
        const loc = worldToHull(v, w);
        const o = pose.o;
        const dx = loc[0] - o[0], dy = loc[1] - o[1], dz = loc[2] - o[2];
        return { yaw: Math.atan2(dz, dx), pitch: Math.atan2(dy, Math.hypot(dx, dz)), dist };
    }

    pickStationTarget(S, pose) {
        const v = this.v, b = this.b, D = S.D;
        const ow = hullToWorld(v, pose.o);
        let best = null, bestS = Infinity;
        for (const e of b.vehicles) {
            if (e.dead || e.team === v.team || !e.visible[v.team]) continue;
            const d = Math.hypot(e.x - v.x, e.z - v.z);
            if (d > D.range) continue;
            const loc = worldToHull(v, [e.x, e.y + e.def.dims.H * 0.6, e.z]);
            const yaw = Math.atan2(loc[2] - pose.o[2], loc[0] - pose.o[0]);
            if (!this.yawAllowed(D, yaw)) continue;
            if (!b.world.los(ow[0], ow[2], e.x, e.z, v, ow[1], e.y + e.def.dims.H * 0.7)) continue;
            const light = e.def.role === "light" || e.def.turret.open || e.def.armor.hull.side[0] <= 30;
            let s = d / 100;
            if (D.kind === "flak" && light) s -= 1.6;
            if (D.kind === "turret" && (e.def.role === "heavy" || e.def.role === "td")) s -= 0.4;
            if (e.pilot) s -= 0.4;
            if (e === S.target) s -= 0.5;
            if (s < bestS) { bestS = s; best = e; }
        }
        S.target = best;
    }

    updateStation(S, dt) {
        const v = this.v, D = S.D;
        if (!this.stationUp(S.id)) { S.target = null; S.burst = 0; return; }
        const pose = this.stationPose(S);
        S.think -= dt;
        if (S.think <= 0) { S.think = 0.45; this.pickStationTarget(S, pose); }
        if (S.reload > 0) {
            // кормовая башня перезаряжается заряжающим, без него — командиром, втрое медленнее
            let k = 1;
            if (S.id === "t2") k = this.ok("t2_loader") ? 1 : this.ok("t2_cmd") ? 0.55 : 0.35;
            S.reload -= dt * k;
        }
        const t = S.target;
        if (!t || t.dead) { S.aligned = false; S.burst = 0; return; }
        const want = this.stationAim(S, t, pose);
        // наведение с ограниченной скоростью; без генераторов и с битым приводом — медленнее
        let rf = this.alive("generators") ? 1 : 0.5;
        if (D.drive) rf *= DRIVE_F[this.st(D.drive)];
        if (S.id === "t2" && !this.ok("t2_cmd")) rf *= 0.85;
        const yr = D.yawRate * DEG * rf * dt, pr = D.pitchRate * DEG * rf * dt;
        let ty = want.yaw;
        if (!this.yawAllowed(D, ty)) ty = S.s.yaw;
        const dy = angDiff(S.s.yaw, ty);
        S.s.yaw = angDiff(0, S.s.yaw + clamp(dy, -yr, yr));
        const E = D.kind === "turret" ? v.def.turret2.elev : D.elev;
        const tp = clamp(want.pitch, E[0] * DEG, E[1] * DEG);
        S.s.pitch += clamp(tp - S.s.pitch, -pr, pr);
        const tol = Math.atan2(t.def.dims.W * 0.45, want.dist) + 0.004, tolP = Math.atan2(t.def.dims.H * 0.4, want.dist) + 0.004;
        S.aligned = Math.abs(angDiff(S.s.yaw, want.yaw)) < tol && Math.abs(tp - S.s.pitch) < tolP;
        if (!S.aligned) { if (S.burst > 0) S.burst = 0; return; }
        if (D.kind === "turret") {
            if (S.reload > 0) return;
            const light = t.def.role === "light" || t.def.turret.open || t.def.armor.hull.side[0] <= 30;
            const sid = light && S.ammo.sprgr128 > 0 ? "sprgr128" : S.ammo.pzgr43_128 > 0 ? "pzgr43_128" : "sprgr128";
            if (!S.ammo[sid]) return;
            S.ammo[sid]--;
            this.fireStation(S, sid, pose);
            let r = D.reload * BREECH_RELOAD[this.st("breech2")];
            S.reload = r;
            return;
        }
        // очереди зениток и пулемётов
        if (S.burst <= 0) {
            if (S.reload > 0) return;
            S.burst = D.burst;
            S.gapT = 0;
        }
        S.gapT -= dt;
        while (S.burst > 0 && S.gapT <= 0) {
            const light = t.def.turret.open;
            const sid = D.shells.length > 1 && light && S.burst % 2 === 0 && S.ammo[D.shells[1]] > 0 ? D.shells[1] : D.shells[0];
            if (!S.ammo[sid]) { S.burst = 0; break; }
            S.ammo[sid]--;
            this.fireStation(S, sid, pose);
            S.burst--;
            S.gapT += D.gap;
            if (S.burst <= 0) S.reload = D.pause;
        }
    }

    fireStation(S, sid, pose) {
        const v = this.v, def = SHELLS[sid];
        const m = pose.muzzle(), dir = pose.dir();
        const shot = new Shot(v, def, m, dir);
        shot.station = S.id;
        this.b.shots.push(shot);
        v.lastShot = this.b.time;
        Events.emit("shot", { v, def, pos: m, dir, st: S.id });
    }
}

/**
 * ИИ «Ратте»: идёт по маршруту к цели режима, главным калибром бьёт по самым опасным целям.
 * Залп — с остановки: башня доворачивается, наводчики выверяют прицел (время — от дальномера и командира),
 * и тот, на кого наведены орудия, получает предупреждение.
 */
export class RatteBrain {
    constructor(v, battle) {
        this.v = v;
        this.b = battle;
        this.target = null;
        this.think = 0;
        this.layT = 0;
        this.err = [0, 0, 0];
        this.errGoal = [0, 0, 0];
        this.errT = 0;
        this.warned = null;
        this.seenT = 0;
        this.wp = 0;
        this.haltT = 0;
        this.artyT = 120;
    }

    update(dt) {
        const v = this.v;
        if (v.dead) return;
        this.think -= dt;
        if (this.think <= 0) { this.think = 1.2; this.pickTarget(); }
        this.aimMain(dt);
        this.drive(dt);
        this.support(dt);
    }

    pickTarget() {
        const v = this.v, b = this.b;
        const eyeY = v.y + v.def.dims.H + v.def.turret.h + 0.4;
        const sees = (e) => !e.dead && e.visible[v.team] && b.world.los(v.x, v.z, e.x, e.z, v, eyeY, e.y + e.def.dims.H);
        // башня поворачивается медленно — цель не меняем, пока её видно (или потеряли совсем недавно)
        const cur = this.target;
        if (cur && !cur.dead) {
            if (sees(cur)) this.seenT = b.time;
            else if (b.time - this.seenT > 5) this.target = null;
        }
        let best = null, bestS = Infinity;
        for (const e of b.vehicles) {
            if (e.dead || e.team === v.team) continue;
            const d = Math.hypot(e.x - v.x, e.z - v.z);
            if (d > 620 || d < 22) continue;
            if (e !== this.target && !sees(e)) continue;
            let s = d / 120;
            if (e.pilot) s -= 1.2;
            if (e.def.role === "heavy" || e.def.role === "td") s -= 0.5;
            // доворот башни на новую цель стоит времени
            const bear = Math.atan2(e.z - v.z, e.x - v.x);
            s += Math.abs(angDiff(v.a + v.tr, bear)) * 1.6;
            if (e === this.target) s -= 2.5;
            if (s < bestS) { bestS = s; best = e; }
        }
        if (best !== this.target) { this.target = best; this.layT = 0; this.warned = null; this.seenT = b.time; }
        // фугас бьёт всё; бронебойный — по тяжёлым вблизи
        if (best) {
            const sid = (best.def.role === "heavy" || best.def.role === "td") && Math.hypot(best.x - v.x, best.z - v.z) < 260 && v.ammo.psgr28 > 0 ? "psgr28" : "sprgr28";
            if (v.ammo[sid] > 0 && sid !== v.shell && (!v.loaded || v.reload > v.reloadTotal * 0.3)) v.selectShell(sid);
        }
    }

    aimMain(dt) {
        const v = this.v, b = this.b, t = this.target;
        if (!t || t.dead) { v.aimPoint = null; this.layT = 0; return; }
        const c = hullToWorld(t, [0, t.def.dims.H * 0.55, 0]);
        const dist = Math.hypot(c[0] - v.x, c[2] - v.z);
        // ошибка выверки прицела: новая цель каждые 3 с, переход к ней плавный
        this.errT -= dt;
        if (this.errT <= 0) {
            this.errT = 3;
            const r = dist * 0.006 * v.boss.aimSpread() + 0.6;
            this.errGoal = [rnd(-r, r), rnd(-r, r) * 0.25, rnd(-r, r)];
        }
        for (let k = 0; k < 3; k++) this.err[k] += (this.errGoal[k] - this.err[k]) * Math.min(1, dt * 0.6);
        const tof = dist / shellSpeed(SHELLS[v.shell]);
        v.aimPoint = [c[0] + Math.cos(t.a) * t.v * tof * 0.7 + this.err[0], c[1] + this.err[1], c[2] + Math.sin(t.a) * t.v * tof * 0.7 + this.err[2]];
        // орудия наведены? (стволы параллельны, ±2,8 м от оси — сверяем по оси цапф между ними)
        const fl = b.fireLine(v);
        const piv = hullToWorld(v, frameToHull(v, "gun", [0, 0, 0]));
        const wantYaw = Math.atan2(v.aimPoint[2] - piv[2], v.aimPoint[0] - piv[0]);
        const aligned = Math.abs(angDiff(fl.yaw, wantYaw)) < Math.atan2(3, dist) && Math.abs(b.wantPitch(v) - v.gp) < Math.atan2(t.def.dims.H * 0.5, dist) + 0.004;
        if (!aligned || !v.canFire()) { this.layT = Math.max(0, this.layT - dt * 2); return; }
        const need = 2.4 * (v.boss.aimSpread() > 1.5 ? 1.6 : 1);
        if (this.warned !== t) {
            this.warned = t;
            Events.emit("bossAim", { v, target: t, t: need - this.layT });
        }
        this.layT += dt;
        if (this.layT < need) return;
        this.layT = 0;
        this.warned = null;
        if (b.fire(v)) this.haltT = 2.5;
    }

    /** Движение по маршруту; на время наводки главного калибра — остановка */
    drive(dt) {
        const v = this.v, inp = v.input;
        inp.throttle = 0; inp.steer = 0;
        const route = this.b.modeCtl.route;
        if (!route || !v.canDrive()) return;
        this.haltT -= dt;
        // на каждом изгибе маршрута — остановка: «Ратте» обстреливает всё вокруг
        while (this.wp < route.length - 1 && Math.hypot(route[this.wp][0] - v.x, route[this.wp][1] - v.z) < 26) {
            this.wp++;
            this.haltT = Math.max(this.haltT, 25);
            Events.emit("bossNote", { v, text: "«Ратте» остановился и ведёт огонь с места", kind: "info" });
        }
        const [gx, gz] = route[this.wp];
        const d = Math.hypot(gx - v.x, gz - v.z);
        if (this.wp === route.length - 1 && d < 10) return;
        const da = angDiff(v.a, Math.atan2(gz - v.z, gx - v.x));
        inp.steer = clamp(da * 1.6, -1, 1);
        const halt = this.haltT > 0 || this.layT > 0.4;
        inp.throttle = halt ? 0 : Math.abs(da) > 0.6 ? 0.25 : 1;
    }

    /** Поддержка: когда «Ратте» серьёзно повреждён, радисты вызывают артиллерию по скоплению противника */
    support(dt) {
        const v = this.v, b = this.b;
        this.artyT -= dt;
        if (this.artyT > 0 || !this.target) return;
        this.artyT = 70;
        const sm = v.boss.summary();
        if (sm.eff > 0.6 || !sm.radio) return;
        const t = this.target;
        b.callArtillery(v, t.x + rnd(-6, 6), t.z + rnd(-6, 6));
    }
}
