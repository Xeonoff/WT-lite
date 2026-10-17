import { Config } from "../core/Config.js";
import { Events } from "../core/Events.js";
import { rnd, clamp, coneDir, randomDir3, rayAabb, raySphere } from "../core/Utils.js";
import { SHELL_TYPES, bodyDamage, fragParams, blastParams, fuseArms, fuseDelay } from "../data/Shells.js";
import { MODULE_NAMES } from "../data/Vehicles.js";
import {
    frameToHull, dirFrameToHull, hullToFrame, dirHullToFrame, worldToHull, dirHullToWorld,
} from "./Armor.js";
import { modState } from "./Vehicle.js";

const ABSORB = { crew: 0.16, engine: 0.55, transmission: 0.5, fuel: 0.25, ammo: 0.3, breech: 0.6, drive: 0.3 };
const EXPLOSIVE_SRC = { blast: true };

/* ─────────── Внутренние цели (модули + экипаж) в системах координат ─────────── */
function interiorTargets(v) {
    const list = [];
    for (const id in v.mods) {
        const m = v.mods[id];
        const d = m.def;
        if (d.type === "track" || d.type === "barrel") continue;
        list.push({ kind: "mod", id, m, frame: d.frame, min: d.min, max: d.max, c: d.c, size: Math.hypot(d.max[0] - d.min[0], d.max[1] - d.min[1], d.max[2] - d.min[2]) * 0.3 });
    }
    for (const s in v.seats) {
        const seat = v.seats[s];
        if (!seat.occupant) continue;
        list.push({ kind: "crew", id: s, seat, member: seat.occupant, frame: seat.def.frame, c: seat.def.c, r: seat.def.r, size: seat.def.r });
    }
    for (const t of list) t.hc = frameToHull(v, t.frame, t.c);
    return list;
}

function rayTargets(v, targets, o, d, len) {
    const fr = {
        hull: [o, d],
        turret: [hullToFrame(v, "turret", o), dirHullToFrame(v, "turret", d)],
        gun: [hullToFrame(v, "gun", o), dirHullToFrame(v, "gun", d)],
    };
    const hits = [];
    for (const t of targets) {
        const [oo, dd] = fr[t.frame];
        const r = t.kind === "crew" ? raySphere(oo, dd, t.c, t.r) : rayAabb(oo, dd, t.min, t.max, len);
        if (r && r.t0 <= len && r.t1 >= 0) hits.push({ t: Math.max(0, r.t0), target: t });
    }
    hits.sort((a, b) => a.t - b.t);
    return hits;
}

/* ─────────── Контекст одного попадания ─────────── */
function makeCtx(battle, v, shooter, shellDef) {
    return {
        battle, v, shooter, shell: shellDef,
        res: {
            kind: "", plate: "", thick: 0, angle: 0, eff: 0, pen: 0, layers: [],
            entry: null, dir: null, path: null, frags: [], blast: null, dmg: [], events: [],
            killed: false, cause: null, crit: false, fire: false, det: false,
        },
        fireCand: 0, detonate: false, ammoHits: {},
    };
}

function hurtModule(ctx, m, dmg, src) {
    if (dmg <= 0.5) return;
    const v = ctx.v;
    const before = m.hp;
    const stB = modState(m);
    m.hp = Math.max(0, m.hp - dmg);
    const stA = modState(m);
    ctx.res.dmg.push({ id: m.id, kind: "mod", type: m.type, name: MODULE_NAMES[m.type], before, after: m.hp, max: m.maxHp });
    if (stA >= 2 && stB < 2) ctx.res.crit = true;
    if (stA === 3 && stB < 3) {
        ctx.res.events.push("mod:" + m.type);
        Events.emit("modDestroyed", { v, id: m.id, type: m.type, by: ctx.shooter });
    }
    if (m.type === "ammo") {
        // шанс детонации бросается один раз на стеллаж за попадание (см. finalize)
        const a = ctx.ammoHits[m.id] || (ctx.ammoHits[m.id] = { m, dmg: 0, body: false, blast: false, wasAlive: before > 0 });
        a.dmg += dmg;
        if (src === "body") a.body = true;
        if (src === "blast") a.blast = true;
    }
    // Пожар — только при критическом состоянии двигателя или топливного бака
    if ((m.type === "fuel" || m.type === "engine") && stA >= 2) {
        const C = Config.FIRE;
        let p = m.type === "fuel" ? C.CHANCE_FUEL : C.CHANCE_ENGINE;
        p *= v.def.engine.type === "diesel" ? 0.65 : 1.25;
        if (EXPLOSIVE_SRC[src]) p *= 1.2;
        if (stB < 2) p *= 1.15;              // только что стал критическим
        if (p > ctx.fireCand) { ctx.fireCand = p; ctx.fireSrc = m; }
    }
}

function hurtCrew(ctx, t, dmg) {
    const member = t.member;
    if (!member.alive || dmg <= 0.5) return;  // погибшие поглощают осколки
    const before = member.hp;
    member.hp = Math.max(0, member.hp - dmg);
    ctx.res.dmg.push({ id: t.id, kind: "crew", name: ctx.v.def.crewTitles[t.id], before, after: member.hp, max: member.maxHp });
    if (member.hp <= 0) {
        member.alive = false;
        ctx.res.crit = true;
        ctx.res.events.push("ko:" + t.id);
        Events.emit("crewKO", { v: ctx.v, seat: t.id, member, by: ctx.shooter });
    }
}

function hurtTarget(ctx, t, dmg, src) {
    if (t.kind === "crew") hurtCrew(ctx, t, dmg);
    else hurtModule(ctx, t.m, dmg, src);
}

/** Осколки по лучам из точки p (система корпуса) */
function fragments(ctx, targets, p, dirs, len, dmg, kind) {
    for (const d of dirs) {
        const L = len * rnd(0.55, 1.1);
        const hits = rayTargets(ctx.v, targets, p, d, L);
        const h = hits[0];
        const end = h ? h.t : L;
        if (ctx.res.frags.length < 48) {
            ctx.res.frags.push({ from: p, to: [p[0] + d[0] * end, p[1] + d[1] * end, p[2] + d[2] * end], hit: !!h, kind });
        }
        if (h) hurtTarget(ctx, h.target, dmg * rnd(0.6, 1.3) * (1 - 0.4 * (h.t / L)), "frag");
    }
}

/** Тело снаряда / кумулятивная струя: проходит через модули, теряя энергию */
function bodyPath(ctx, targets, p, d, len, dmg) {
    const hits = rayTargets(ctx.v, targets, p, d, len);
    let energy = 1;
    let end = len;
    for (const h of hits) {
        hurtTarget(ctx, h.target, dmg * energy, "body");
        energy -= h.target.kind === "crew" ? ABSORB.crew : ABSORB[h.target.m.type] || 0.3;
        if (energy <= 0.05) { end = h.t; break; }
    }
    ctx.res.path = { from: p, to: [p[0] + d[0] * end, p[1] + d[1] * end, p[2] + d[2] * end] };
}

/** Взрыв внутри машины: осколки во все стороны + фугасное действие */
function explodeInside(ctx, targets, p, bp, scale = 1) {
    const n = Math.max(3, Math.round(bp.n * scale));
    const dirs = [];
    for (let i = 0; i < n; i++) dirs.push(randomDir3());
    fragments(ctx, targets, p, dirs, bp.len, bp.dmg * (0.6 + 0.4 * scale), "blast");
    const R = bp.radius * (0.5 + 0.5 * scale);
    for (const t of targets) {
        const dd = Math.hypot(t.hc[0] - p[0], t.hc[1] - p[1], t.hc[2] - p[2]) - t.size;
        if (dd < R) hurtTarget(ctx, t, bp.blastDmg * scale * (1 - Math.max(0, dd) / R), "blast");
    }
    ctx.res.blast = { at: p, r: R };
}

/* ─────────── Завершение попадания: пожар, детонация, гибель экипажа ─────────── */
function finalize(ctx) {
    const { v, res, battle, shooter } = ctx;
    if (v.dead) return res;
    const ammoIds = Object.keys(ctx.ammoHits);
    if (ammoIds.length && !ctx.detonate) {
        // один бросок по самому опасному стеллажу
        const fills = v.rackFills();
        let pMax = 0;
        for (const id of ammoIds) {
            const a = ctx.ammoHits[id];
            const fill = fills[id] || 0;
            if (fill <= 0) continue;
            const fillF = 0.15 + 0.85 * Math.min(1, fill / a.m.def.cap);
            let p = a.body ? 0.42 : 0.025 + 0.26 * Math.min(1, a.dmg / a.m.maxHp);
            if (a.blast) p += 0.06;
            pMax = Math.max(pMax, p * fillF);
        }
        if (Math.random() < pMax) ctx.detonate = true;
    }
    if (!ctx.detonate) {
        for (const id of ammoIds) {
            const a = ctx.ammoHits[id];
            if (a.wasAlive && a.m.hp <= 0) {
                const lost = v.loseRack(id);
                if (lost) res.events.push("ammoLost:" + lost);
            }
        }
    }
    if (ctx.detonate) {
        res.det = true;
        res.events.push("det");
        battle.destroyVehicle(v, "ammo", shooter);
        res.killed = true; res.cause = "ammo";
        return res;
    }
    if (ctx.fireCand > 0 && !v.fire && Math.random() < ctx.fireCand) {
        const src = ctx.fireSrc;
        v.fire = {
            t: 0, dur: rnd(Config.FIRE.DUR_MIN, Config.FIRE.DUR_MAX), acc: 0,
            pos: frameToHull(v, src.def.frame, src.def.c), src: src.id, by: shooter,
        };
        res.fire = true;
        res.events.push("fire");
        Events.emit("fireStart", { v, by: shooter });
    }
    if (v.aliveCrew() < Config.CREW.MIN_ALIVE) {
        battle.destroyVehicle(v, "crew", shooter);
        res.killed = true; res.cause = "crew";
    }
    return res;
}

function snapshot(v) {
    const mods = {};
    for (const id in v.mods) mods[id] = { hp: v.mods[id].hp, max: v.mods[id].maxHp };
    const crew = {};
    for (const s in v.seats) {
        const o = v.seats[s].occupant;
        crew[s] = o ? { hp: o.hp, max: o.maxHp, alive: o.alive, present: true } : { hp: 0, max: 100, alive: false, present: false };
    }
    return { mods, crew, turretRel: v.turretRel(), gunRel: v.gunRel(), fills: v.rackFills() };
}

/* ─────────── Основная функция: попадание снаряда в машину ─────────── */
export function applyShellHit(battle, shot, v, trace) {
    const s = shot.def;
    const T = SHELL_TYPES[s.type];
    const shooter = shot.owner;
    const ctx = makeCtx(battle, v, shooter, s);
    const res = ctx.res;
    res.shell = s;
    res.pen = trace.pen;
    res.dist = shot.traveled;
    if (shooter) v.damagers.set(shooter.id, battle.time);

    // Разнесённая броня: гусеницы и экраны
    for (const L of trace.layers) {
        res.layers.push({ name: L.ev.info.name, thick: L.ev.info.thick, eff: L.ev.eff });
        const mod = L.hit.part.module ? v.mods[L.hit.part.module] : null;
        if (mod) {
            const dmg = s.type === "HE" ? 20 + Math.sqrt(s.filler || 0) * 4.2 : 18 + s.cal * 0.95;
            hurtModule(ctx, mod, dmg, "body");
            if (!res.entry) {
                res.entry = frameToHull(v, L.hit.frame, L.hit.point);
                res.dir = dirFrameToHull(v, L.hit.frame, L.hit.dir);
            }
        }
    }

    if (!trace.main) {
        res.kind = trace.layers.length ? "stopped" : "miss";
        if (s.type === "HE" && trace.stoppedBy) {
            heSplash(battle, trace.stoppedBy.world, s, shooter, v);
            res.kind = "he";
        }
        res.snap = snapshot(v);
        return finalize(ctx);
    }

    const { hit, ev } = trace.main;
    res.plate = ev.info.name;
    res.thick = ev.info.thick;
    res.angle = ev.theta;
    res.eff = ev.eff;
    res.pen = trace.pen;
    res.entry = frameToHull(v, hit.frame, hit.point);
    res.dir = dirFrameToHull(v, hit.frame, hit.dir);
    res.world = hit.world;
    const entry = res.entry, dir = res.dir;

    if (hit.id === "barrel") {
        res.kind = "barrel";
        hurtModule(ctx, v.mods.barrel, s.type === "HE" ? 120 : 30 + s.cal * 1.2, "body");
        if (s.type === "HE") heSplash(battle, hit.world, s, shooter, v);
        res.snap = snapshot(v);
        return finalize(ctx);
    }

    const targets = interiorTargets(v);

    if (s.type === "HE") {
        if (ev.canPen) {
            res.kind = "he-pen";
            const p = [entry[0] + dir[0] * 0.3, entry[1] + dir[1] * 0.3, entry[2] + dir[2] * 0.3];
            explodeInside(ctx, targets, p, blastParams(s), 1);
        } else {
            res.kind = "he";
            heDirect(ctx, targets, hit, ev, s);
            heSplash(battle, hit.world, s, shooter, v);
        }
        res.snap = snapshot(v);
        return finalize(ctx);
    }

    // Рикошет
    if (Math.random() < ev.ricoP) {
        res.kind = "rico";
        const n = dirFrameToHull(v, hit.frame, ev.normal);
        const dn = dir[0] * n[0] + dir[1] * n[1] + dir[2] * n[2];
        res.ricoHull = [dir[0] - 2 * dn * n[0], 0, dir[2] - 2 * dn * n[2]];
        res.rico = dirHullToWorld(v, [res.ricoHull[0], Math.abs(dir[1] - 2 * dn * n[1]) * 0.3 + 0.05, res.ricoHull[2]]);
        res.snap = snapshot(v);
        return finalize(ctx);
    }
    if (!ev.canPen) {
        res.kind = "nopen";
        res.snap = snapshot(v);
        return finalize(ctx);
    }

    // Пробитие: вторичные осколки брони
    res.kind = "pen";
    const resid = trace.pen - ev.eff;
    const fp = fragParams(s, ev.info.thick);
    const dirs = [];
    for (let i = 0; i < fp.n; i++) dirs.push(coneDir(dir, fp.cone));
    const startP = [entry[0] + dir[0] * 0.05, entry[1] + dir[1] * 0.05, entry[2] + dir[2] * 0.05];
    fragments(ctx, targets, startP, dirs, fp.len, fp.dmg, "spall");

    const bd = bodyDamage(s) * (0.75 + Math.min(0.5, resid / 120));
    if (s.type === "APHE" && fuseArms(s, ev.eff)) {
        const fd = fuseDelay(s);
        bodyPath(ctx, targets, startP, dir, fd, bd);
        const ep = [startP[0] + dir[0] * fd, startP[1] + dir[1] * fd, startP[2] + dir[2] * fd];
        explodeInside(ctx, targets, ep, blastParams(s), 1);
        res.events.push("fuse");
    } else {
        if (s.type === "APHE") res.events.push("nofuse");
        const len = s.type === "HEAT" ? clamp(1.1 + resid / 28, 0.9, 4.5) : clamp(1.6 + resid / 22, 1.4, 7);
        bodyPath(ctx, targets, startP, dir, len, bd);
    }
    res.snap = snapshot(v);
    return finalize(ctx);
}

/** Непробивший фугас: избыточное давление через тонкую броню */
function heDirect(ctx, targets, hit, ev, s) {
    const heP = s.pen[0];
    const thin = Math.min(ev.info.thick, ctx.v.def.turret.open ? 0 : 999);
    if (heP * 1.15 > thin && thin < 30) {
        const frac = clamp((heP * 1.15 - thin) / (heP + 1), 0.15, 0.7);
        const p = [ctx.res.entry[0] + ctx.res.dir[0] * 0.2, ctx.res.entry[1] + ctx.res.dir[1] * 0.2, ctx.res.entry[2] + ctx.res.dir[2] * 0.2];
        explodeInside(ctx, targets, p, blastParams(s), frac);
    }
}

/**
 * Наружное фугасное действие (взрыв на броне, гусенице, земле, препятствии).
 * Повреждает гусеницы, стволы, открытые рубки и тонкие крыши.
 */
export function heSplash(battle, wp, s, shooter, directTarget) {
    const bp = blastParams(s);
    const R = bp.splash;
    battle.world.blastObstacles(wp[0], wp[2], R * 0.7);
    if (bp.splash < 1.2) return;
    for (const v of battle.vehicles) {
        if (v.dead) continue;
        const dx = v.x - wp[0], dz = v.z - wp[2];
        const reach = R + v.def.bodyRadius;
        if (dx * dx + dz * dz > reach * reach) continue;
        const pl = worldToHull(v, wp);
        const ctx = makeCtx(battle, v, shooter, s);
        ctx.res.kind = "splash";
        ctx.res.entry = pl;
        ctx.res.dir = [0, -1, 0];
        // гусеницы
        for (const id of ["trackL", "trackR"]) {
            const m = v.mods[id];
            const d = distToBox(pl, m.def.min, m.def.max);
            if (d < R * 0.6) hurtModule(ctx, m, (20 + Math.sqrt(s.filler || 0) * 3.2) * (1 - d / (R * 0.6)), "blast");
        }
        // ствол
        const bm = v.mods.barrel;
        const bpos = frameToHull(v, "gun", [v.def.gun.len * 0.6, 0, 0]);
        const db = Math.hypot(bpos[0] - pl[0], bpos[1] - pl[1], bpos[2] - pl[2]);
        if (db < R * 0.45) hurtModule(ctx, bm, 70 * (1 - db / (R * 0.45)), "blast");
        // избыточное давление через крышу / открытую рубку
        const hullD = distToHull(v, pl);
        if (hullD < R) {
            const fall = 1 - hullD / R;
            const heP = s.pen[0] * fall;
            const roof = v.def.turret.open ? 0 : Math.min(v.def.armor.hull.roof[0], v.def.armor.turret.roof[0]);
            if (heP > roof * 0.9 || (v.def.turret.open && fall > 0.25)) {
                const frac = clamp(((heP - roof * 0.9) / Math.max(8, s.pen[0])) + (v.def.turret.open ? 0.35 : 0), 0.12, 0.85);
                const targets = interiorTargets(v);
                const p = [clamp(pl[0], -v.def.dims.L / 2 + 0.3, v.def.dims.L / 2 - 0.3), v.def.dims.H - 0.15, clamp(pl[2], -v.def.dims.W / 2 + 0.6, v.def.dims.W / 2 - 0.6)];
                explodeInside(ctx, targets, p, bp, frac * fall);
            }
        }
        if (!ctx.res.dmg.length) continue;
        if (shooter) v.damagers.set(shooter.id, battle.time);
        ctx.res.snap = snapshot(v);
        finalize(ctx);
        Events.emit("splashDamage", { v, shooter, res: ctx.res, direct: v === directTarget });
        battle.creditDamage(shooter, v, ctx.res);
    }
}

function distToBox(p, min, max) {
    const dx = Math.max(min[0] - p[0], 0, p[0] - max[0]);
    const dy = Math.max(min[1] - p[1], 0, p[1] - max[1]);
    const dz = Math.max(min[2] - p[2], 0, p[2] - max[2]);
    return Math.hypot(dx, dy, dz);
}

function distToHull(v, p) {
    const { L, W, H } = v.def.dims;
    return distToBox(p, [-L / 2, 0.3, -W / 2], [L / 2, H + v.def.turret.h, W / 2]);
}

/* ─────────── Пожар ─────────── */
export function fireTick(battle, v, dt) {
    const f = v.fire;
    if (!f || v.dead) return;
    f.t += dt;
    f.acc += dt;
    if (f.acc >= 0.5) {
        f.acc -= 0.5;
        const C = Config.FIRE;
        const ctx = makeCtx(battle, v, f.by, null);
        const targets = interiorTargets(v);
        for (const t of targets) {
            const d = Math.hypot(t.hc[0] - f.pos[0], t.hc[1] - f.pos[1], t.hc[2] - f.pos[2]);
            if (t.kind === "crew") {
                if (d < C.RADIUS * 1.3) hurtCrew(ctx, t, C.CREW_DPS * 0.5 * (1 - d / (C.RADIUS * 1.3) * 0.5));
            } else if (d < C.RADIUS) {
                const m = t.m;
                if (m.type === "ammo") {
                    const fill = v.rackFills()[m.id] || 0;
                    if (fill > 0 && Math.random() < C.AMMO_CHANCE_PS * 0.5 * (0.3 + 0.7 * fill / m.def.cap)) ctx.detonate = true;
                }
                if (m.hp > 0) {
                    m.hp = Math.max(0, m.hp - C.MOD_DPS * 0.5);
                    if (m.hp <= 0 && m.type === "ammo") v.loseRack(m.id);
                }
            }
        }
        if (ctx.detonate) {
            battle.destroyVehicle(v, "ammo", f.by);
            Events.emit("fireDetonation", { v });
            return;
        }
        if (v.aliveCrew() < Config.CREW.MIN_ALIVE) {
            battle.destroyVehicle(v, "fire", f.by);
            return;
        }
    }
    if (f.t >= f.dur) {
        v.fire = null;
        Events.emit("fireOut", { v, ext: false });
    }
}

