import { Config } from "../core/Config.js";
import { Events } from "../core/Events.js";
import { uid, segCircle, segObb } from "../core/Utils.js";
import { shellSpeed, SHELL_TYPES } from "../data/Shells.js";
import { raycastVehicle, traceShot } from "./Armor.js";
import { applyShellHit, heSplash } from "./Damage.js";

export class Shot {
    constructor(owner, def, p, dir) {
        this.id = uid();
        this.owner = owner;
        this.team = owner ? owner.team : -1;
        this.def = def;
        this.type = SHELL_TYPES[def.type];
        this.x = p[0]; this.y = p[1]; this.z = p[2];
        this.ox = p[0]; this.oz = p[2];
        this.d = dir;
        this.speed = shellSpeed(def);
        this.traveled = 0;
        this.alive = true;
        this.harmless = false;
        this.life = Infinity;
        this.ignore = owner;
    }
}

const SUB = 2.5;

export function updateShots(battle, dt) {
    const shots = battle.shots;
    for (let i = shots.length - 1; i >= 0; i--) {
        const s = shots[i];
        stepShot(battle, s, dt);
        if (!s.alive) shots.splice(i, 1);
    }
}

function stepShot(battle, s, dt) {
    s.life -= dt;
    if (s.life <= 0) { s.alive = false; return; }
    let remain = s.speed * dt;
    while (remain > 0 && s.alive) {
        const L = Math.min(SUB, remain);
        remain -= L;
        const p0 = [s.x, s.y, s.z];
        const p1 = [s.x + s.d[0] * L, s.y + s.d[1] * L, s.z + s.d[2] * L];
        const hit = firstHit(battle, s, p0, p1, L);
        if (hit) {
            s.alive = false;
            const wp = [p0[0] + s.d[0] * hit.t, p0[1] + s.d[1] * hit.t, p0[2] + s.d[2] * hit.t];
            s.traveled += hit.t;
            resolveHit(battle, s, hit, wp);
            return;
        }
        s.x = p1[0]; s.y = p1[1]; s.z = p1[2];
        s.traveled += L;
        if (s.traveled > Config.SHELL_MAX_RANGE) { s.alive = false; return; }
        const S = battle.world.S;
        if (s.x < -60 || s.z < -60 || s.x > S + 60 || s.z > S + 60) { s.alive = false; return; }
    }
}

function firstHit(battle, s, p0, p1, L) {
    let best = null;
    // земля
    if (p1[1] <= 0.02) {
        const t = (p0[1] - 0.02) / Math.max(1e-6, p0[1] - p1[1]) * L;
        best = { t: Math.max(0, t), kind: "ground" };
    }
    // машины
    if (!s.harmless) {
        for (const v of battle.vehicles) {
            if (v.dead || v === s.ignore) continue;
            const R = v.def.radius + 0.5;
            if (segCircle(p0[0], p0[2], p1[0], p1[2], v.x, v.z, R) < 0) continue;
            const h = raycastVehicle(v, p0, s.d, L);
            if (h && (!best || h.t < best.t)) best = { t: h.t, kind: "vehicle", v };
        }
    }
    // препятствия
    for (const e of battle.world.querySeg(p0[0], p0[2], p1[0], p1[2], 3)) {
        const o = e.o;
        let t = -1;
        if (e.type === "building" || e.type === "wreck") {
            if (e.type === "wreck" && o.v === s.ignore) continue;
            t = segObb(p0[0], p0[2], p1[0], p1[2], o);
        } else if (e.type === "rock") {
            t = segCircle(p0[0], p0[2], p1[0], p1[2], o.x, o.z, o.r * 0.85);
        } else continue;
        if (t < 0) continue;
        const tt = t * L;
        const y = p0[1] + s.d[1] * tt;
        if (y > o.h) continue;
        if (!best || tt < best.t) best = { t: tt, kind: e.type, o };
    }
    return best;
}

function resolveHit(battle, s, hit, wp) {
    const isHE = s.def.type === "HE";
    if (hit.kind === "vehicle") {
        const v = hit.v;
        const trace = traceShot(s.def, v, [wp[0] - s.d[0] * 0.05, wp[1] - s.d[1] * 0.05, wp[2] - s.d[2] * 0.05], s.d, 14, s.traveled);
        const res = applyShellHit(battle, s, v, trace);
        battle.onShellHit(s, v, res, wp);
        if (res.kind === "rico" && res.rico) spawnRicochet(battle, s, wp, res.rico, v);
        if (isHE || res.blast) Events.emit("explosion", { x: wp[0], y: wp[1], z: wp[2], size: blastSize(s.def), inside: res.kind === "he-pen" });
        return;
    }
    if (s.harmless) {
        Events.emit("impact", { kind: hit.kind, x: wp[0], y: wp[1], z: wp[2], shell: s.def, harmless: true });
        return;
    }
    Events.emit("impact", { kind: hit.kind, x: wp[0], y: wp[1], z: wp[2], shell: s.def, owner: s.owner });
    if (isHE) {
        Events.emit("explosion", { x: wp[0], y: Math.max(0.1, wp[1]), z: wp[2], size: blastSize(s.def), ground: hit.kind === "ground" });
        heSplash(battle, wp, s.def, s.owner, null);
    }
}

function blastSize(def) {
    if (def.type === "HE") return 0.6 + Math.pow((def.filler || 0) / 1000, 0.4) * 1.3;
    return 0.5 + def.cal / 200;
}

function spawnRicochet(battle, s, wp, dir, from) {
    const r = new Shot(s.owner, s.def, wp, dir);
    r.speed = s.speed * 0.55;
    r.harmless = true;
    r.life = 0.55;
    r.ignore = from;
    r.rico = true;
    battle.shots.push(r);
}
