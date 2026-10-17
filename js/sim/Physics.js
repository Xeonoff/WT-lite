import { obbObb, clamp } from "../core/Utils.js";
import { collideStatic } from "./World.js";

export function vehicleObb(v) {
    return { x: v.x, z: v.z, a: v.a, hl: v.def.dims.L / 2, hw: v.def.dims.W / 2 };
}

/** Интеграция движения машины по её вводу (throttle / steer) */
export function driveVehicle(v, dt) {
    if (v.static) { v.v = 0; v.w = 0; return; }
    const inp = v.input;
    const can = v.canDrive();
    let target = 0;
    if (can) {
        if (inp.throttle > 0) target = inp.throttle * v.maxSpeed();
        else if (inp.throttle < 0) target = inp.throttle * v.maxReverse();
    }
    const acc = v.accel();
    const brake = 7.5;
    if (!can) v.v *= Math.max(0, 1 - dt * 2.8);
    else if (target !== 0 && Math.sign(target) !== Math.sign(v.v) && Math.abs(v.v) > 0.15) v.v += clamp(target - v.v, -brake * dt, brake * dt);
    else if (Math.abs(target) > Math.abs(v.v)) v.v += clamp(target - v.v, -acc * dt, acc * dt);
    else v.v += clamp(target - v.v, -brake * 0.55 * dt, brake * 0.55 * dt);

    // продирание через изгородь
    if (v.inHedge > 0) {
        v.inHedge--;
        const lim = (v.def.mob.speed / 3.6) * 0.3;
        if (Math.abs(v.v) > lim) v.v = Math.sign(v.v) * lim;
    }
    const tr = v.turnRate();
    const vmax = v.def.mob.speed / 3.6;
    const steerEff = 1 - 0.32 * Math.min(1, Math.abs(v.v) / vmax);
    const dirSign = v.v < -0.4 ? -1 : 1;
    const wTarget = can ? inp.steer * tr * steerEff * dirSign : 0;
    v.w += clamp(wTarget - v.w, -tr * 5 * dt - 0.01, tr * 5 * dt + 0.01);
    if (!can) v.w *= Math.max(0, 1 - dt * 6);
    v.a += v.w * dt;
    v.x += Math.cos(v.a) * v.v * dt;
    v.z += Math.sin(v.a) * v.v * dt;
    const hw = v.def.dims.W / 2;
    v.trackPhase[0] += (v.v + v.w * hw) * dt;
    v.trackPhase[1] += (v.v - v.w * hw) * dt;
}

/** Столкновения с миром и между машинами */
export function resolveCollisions(battle) {
    const vs = battle.vehicles;
    const S = battle.world.S;
    for (const v of vs) {
        if (v.dead) continue;
        const m = collideStatic(battle.world, v, vehicleObb(v), battle.lastDt);
        if (m) {
            v.x += m.x; v.z += m.z;
            const l = Math.hypot(m.x, m.z) || 1;
            const dot = (Math.cos(v.a) * m.x + Math.sin(v.a) * m.z) / l;
            if (v.v * dot < 0) { v.v *= 1 - 0.85 * Math.abs(dot); v.bumpT = battle.time; }
        }
        const pad = 6;
        if (v.x < pad || v.x > S - pad || v.z < pad || v.z > S - pad) {
            v.x = clamp(v.x, pad, S - pad);
            v.z = clamp(v.z, pad, S - pad);
            v.v *= 0.6;
        }
    }
    for (let i = 0; i < vs.length; i++) {
        const A = vs[i];
        if (A.dead) continue;
        for (let j = i + 1; j < vs.length; j++) {
            const B = vs[j];
            if (B.dead) continue;
            const rr = A.def.bodyRadius + B.def.bodyRadius;
            const dx = A.x - B.x, dz = A.z - B.z;
            if (dx * dx + dz * dz > rr * rr) continue;
            const m = obbObb(vehicleObb(A), vehicleObb(B));
            if (!m) continue;
            const ma = A.static ? 1e6 : A.def.mob.mass, mb = B.static ? 1e6 : B.def.mob.mass;
            const ka = mb / (ma + mb), kb = ma / (ma + mb);
            A.x += m.x * ka; A.z += m.z * ka;
            B.x -= m.x * kb; B.z -= m.z * kb;
            for (const [V, sgn] of [[A, 1], [B, -1]]) {
                const dot = Math.cos(V.a) * m.nx * sgn + Math.sin(V.a) * m.nz * sgn;
                if (V.v * dot < 0) V.v *= 1 - 0.7 * Math.abs(dot);
            }
            A.bumpT = B.bumpT = battle.time;
        }
    }
}
