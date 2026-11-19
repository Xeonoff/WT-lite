import { obbObb, clamp } from "../core/Utils.js";
import { collideStatic } from "./World.js";
import { collisionDamage } from "./Damage.js";

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
        // склон: в гору медленнее, под гору — чуть быстрее
        const up = Math.sin(v.suspension?.grade || 0) * Math.sign(target);
        target *= clamp(1 - up * 2.6, 0.3, 1.15);
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
    v.slip *= Math.exp(-4 * dt);
    const c = Math.cos(v.a), s = Math.sin(v.a);
    v.x += (c * v.v - s * v.slip) * dt;
    v.z += (s * v.v + c * v.slip) * dt;
    const hw = v.def.dims.W / 2;
    v.trackPhase[0] += (v.v + v.w * hw) * dt;
    v.trackPhase[1] += (v.v - v.w * hw) * dt;
}

export { settleOnGround } from "./Suspension.js";

// Проекция опорной грани (или угла) прямоугольника на нормаль и касательную.
function support(box, nx, nz, sign) {
    const c = Math.cos(box.a), s = Math.sin(box.a);
    const f = nx * c + nz * s, r = nz * c - nx * s;
    const n = box.x * nx + box.z * nz + sign * (box.hl * Math.abs(f) + box.hw * Math.abs(r));
    let t = -box.x * nz + box.z * nx, span = 0;
    if (Math.abs(f) < 0.001) span += box.hl * Math.abs(r);
    else t -= sign * Math.sign(f) * box.hl * r;
    if (Math.abs(r) < 0.001) span += box.hw * Math.abs(f);
    else t += sign * Math.sign(r) * box.hw * f;
    return { n, lo: t - span, hi: t + span };
}

function contactBody(v, x, z, nx, nz) {
    const c = Math.cos(v.a), s = Math.sin(v.a);
    const forward = c * nx + s * nz, side = c * nz - s * nx;
    const arm = (x - v.x) * nz - (z - v.z) * nx;
    const invMass = v.static ? 0 : 1 / v.def.mob.mass;
    const { L, W } = v.def.dims;
    const invInertia = 12 * invMass / (L * L + W * W);
    return {
        speed: v.v * forward + v.slip * side + v.w * arm,
        response: invMass + arm * arm * invInertia,
        apply(j) {
            v.v += j * invMass * forward;
            v.slip += j * invMass * side;
            v.w += j * invInertia * arm;
        },
    };
}

function impact(a, b, obstacle, nx, nz, battle) {
    const face = support(vehicleObb(a), nx, nz, -1);
    const other = b ? vehicleObb(b) : obstacle;
    const t = -other.x * nz + other.z * nx;
    const edge = other.hl !== undefined ? support(other, nx, nz, 1) : { lo: t, hi: t };
    const mid = clamp((Math.max(face.lo, edge.lo) + Math.min(face.hi, edge.hi)) / 2, face.lo, face.hi);
    const x = face.n * nx - mid * nz, z = face.n * nz + mid * nx;
    const A = contactBody(a, x, z, nx, nz), B = b && contactBody(b, x, z, nx, nz);
    const closing = (B?.speed || 0) - A.speed;
    const response = A.response + (B?.response || 0);
    if (closing <= 0 || response <= 0) return;
    const impulse = closing / response; // неупругий контакт; единицы массы игры — тонны
    A.apply(impulse);
    B?.apply(-impulse);
    if (battle) {
        if (closing > 1) {
            a.impactSeq = (a.impactSeq || 0) + 1;
            if (b) b.impactSeq = (b.impactSeq || 0) + 1;
        }
        collisionDamage(battle, a, b, x, z, impulse);
        if (b) collisionDamage(battle, b, a, x, z, impulse);
    }
}

export function resolveWorldContact(world, v, dt, battle) {
    if (v.static) return;
    const push = collideStatic(world, v, vehicleObb(v), dt);
    if (!push) return;
    v.x += push.x; v.z += push.z;
    if (battle) v.bumpT = battle.time;
    for (const { nx, nz, o, soft } of push.contacts) {
        if (v.dead) break;
        impact(v, null, o, nx, nz, soft ? null : battle);
    }
}

/** Столкновения с миром и между машинами */
export function resolveCollisions(battle) {
    const vs = battle.vehicles;
    const S = battle.world.S;
    for (const v of vs) {
        if (v.dead) continue;
        resolveWorldContact(battle.world, v, battle.lastDt, battle);
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
            if (A.dead) break;
            if (B.dead || (A.static && B.static)) continue;
            const rr = A.def.bodyRadius + B.def.bodyRadius;
            const dx = A.x - B.x, dz = A.z - B.z;
            if (dx * dx + dz * dz > rr * rr) continue;
            const m = obbObb(vehicleObb(A), vehicleObb(B));
            if (!m) continue;
            const ia = A.static ? 0 : 1 / A.def.mob.mass, ib = B.static ? 0 : 1 / B.def.mob.mass;
            const ka = ia / (ia + ib), kb = ib / (ia + ib);
            A.x += m.x * ka; A.z += m.z * ka;
            B.x -= m.x * kb; B.z -= m.z * kb;
            impact(A, B, null, m.nx, m.nz, battle);
            A.bumpT = B.bumpT = battle.time;
        }
    }
}
