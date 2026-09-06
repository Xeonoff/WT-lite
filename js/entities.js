import { G } from "./state.js";
import { CLASSES, WORLD } from "./data.js";
import { TAU, rnd, clamp, dist } from "./utils.js";
import { breakCrate } from "./world.js";

export function mkMods(cls) {
    const m = {};
    cls.schema.mods.forEach((d) => {
        m[d.t] = { hp: d.hp ?? 100, max: d.max ?? 100 };
    });
    return m;
}

export function mkTank(clsName, x, y, isPlayer) {
    const cls = CLASSES[clsName];
    return {
        cls,
        clsName,
        x,
        y,
        a: rnd(TAU),
        ta: isPlayer ? -Math.PI / 2 : rnd(TAU),
        v: 0,
        trackDist: 0,
        trackAcc: 0,
        recoil: 0,
        reload: isPlayer ? 2 : rnd(2, 5),
        mods: mkMods(cls),
        burning: 0,
        burnTick: 0,
        isPlayer,
        dead: false,
        repair: null,
        fext: 0,
        mark: rnd(10),
        ai: { side: rnd() < 0.5 ? -1 : 1, aimErr: 0, errT: 0, wanderT: 0 },
    };
}

export function crewAlive(t) {
    return t.cls.schema.mods
        .filter((m) => ["driver", "gunner", "loader", "commander"].includes(m.t))
        .every((m) => {
            const mm = t.mods[m.t];
            return mm && mm.hp > 0;
        });
}

export function tankSpeed(t) {
    const eng =
        t.mods.engine.hp <= 0
            ? 0
            : t.mods.engine.hp < t.mods.engine.max * 0.6
                ? 0.55
                : 1;
    const driv = t.mods.driver.hp > 0 ? 1 : 0;
    const burn = t.burning > 0 ? 0.9 : 1;
    return t.cls.speed * eng * driv * burn;
}

export function tankTurretSpd(t) {
    const ring =
        t.mods.ring.hp <= 0 ? 0.25 : t.mods.ring.hp < t.mods.ring.max * 0.6 ? 0.6 : 1;
    const cmd = t.mods.commander.hp > 0 ? 1 : 0.5;
    const gun = t.mods.gunner.hp > 0 ? 1 : 0.7;
    return t.cls.turret * ring * cmd * gun;
}
export function getCurrentShell(t) {
    if (t.isPlayer) {
        const idx = clamp(G.curShell, 0, t.cls.shells.length - 1);
        return t.cls.shells[idx];
    }
    return t.cls.shells[0];
}
export function reloadTime(t) {
    const shell = getCurrentShell(t);
    const l = t.mods.loader;
    return shell.reload * (l && l.hp <= 0 ? 2.2 : 1);
}

export function dispersion(t) {
    let d = t.isPlayer ? 0.01 : 0.022;
    if (t.mods.gunner.hp <= 0) d += t.isPlayer ? 0.05 : 0.04;
    return d;
}

export function toLocal(t, x, y) {
    const dx = x - t.x;
    const dy = y - t.y;
    const c = Math.cos(-t.a);
    const s = Math.sin(-t.a);
    return { x: dx * c - dy * s, y: dx * s + dy * c };
}

export function turretPos(t) {
    return {
        x: t.x + Math.cos(t.a) * t.cls.tOff,
        y: t.y + Math.sin(t.a) * t.cls.tOff,
    };
}

export function tankRadius(t) {
    return Math.max(t.cls.L, t.cls.W) * 0.44;
}

export function moveTank(t, dt) {
    const nx = t.x + Math.cos(t.a) * t.v * dt;
    const ny = t.y + Math.sin(t.a) * t.v * dt;
    let bx = nx;
    let by = ny;
    const myR = tankRadius(t);

    for (const o of G.obstacles) {
        const dx = bx - o.x;
        const dy = by - o.y;
        const d = Math.hypot(dx, dy);
        const rr = o.r + myR;
        if (d < rr) {
            if (d < 0.001) bx += rr;
            else {
                bx = o.x + (dx / d) * rr;
                by = o.y + (dy / d) * rr;
            }
            t.v *= 0.85;
        }
    }

    for (let ci = G.crates.length - 1; ci >= 0; ci--) {
        const c = G.crates[ci];
        if (dist(bx, by, c.x, c.y) < c.r + 16) breakCrate(ci);
    }

    const all = [G.player, ...G.enemies];
    for (const o of all) {
        if (!o || o === t || o.dead) continue;
        const dx = bx - o.x;
        const dy = by - o.y;
        const d = Math.hypot(dx, dy);
        const rr = myR + tankRadius(o);
        if (d < rr) {
            if (d < 0.001) bx += rr;
            else {
                bx = o.x + (dx / d) * rr;
                by = o.y + (dy / d) * rr;
            }
            t.v *= 0.9;
        }
    }

    t.x = clamp(bx, 60, WORLD - 60);
    t.y = clamp(by, 60, WORLD - 60);

    if (Math.abs(t.v) > 10) {
        t.trackDist += Math.abs(t.v) * dt;
        t.trackAcc += Math.abs(t.v) * dt;
        while (t.trackAcc >= 11) {
            t.trackAcc -= 11;
            const p = t.cls.W / 2 - t.cls.tread / 2;
            const ca = Math.cos(t.a);
            const sa = Math.sin(t.a);
            const w = t.cls.tread * 0.75;
            G.tracks.push({
                x: t.x - sa * p, y: t.y + ca * p,
                ang: t.a, t: 0, life: rnd(6, 9), w,
            });
            G.tracks.push({
                x: t.x + sa * p, y: t.y - ca * p,
                ang: t.a, t: 0, life: rnd(6, 9), w,
            });
            if (G.tracks.length > 1100) G.tracks.splice(0, G.tracks.length - 1100);
        }
    }
}