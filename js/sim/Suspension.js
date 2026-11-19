import { clamp } from "../core/Utils.js";
import { ROAD as KV_ROAD, TRACK as KV_TRACK } from "../data/models/KV1Spec.js";
import { ROAD as RATTE_ROAD, TRACK as RATTE_TRACK } from "../data/models/RatteSpec.js";

// Игровая настройка упругости (рад/с) и доли критического демпфирования.
const SPRINGS = {
    christie: [6.4, 0.42], kv: [7.1, 0.49], small: [7.8, 0.55],
    interleaved: [6.9, 0.48], boss: [4.2, 0.60],
};

export function roadWheelRadius(def) {
    const { type, wheels } = def.susp;
    return def.dims.th * ({ christie: 0.47, kv: 0.33, interleaved: 0.44,
        small: wheels >= 8 ? 0.26 : wheels === 5 ? 0.36 : 0.31 }[type] || 0.3);
}

export const BELT_SUBDIVISIONS = 4;

function suspensionLayout(def) {
    const { L, W, th, tw } = def.dims;
    let first, last, offsets, count = def.susp.wheels;
    if (def.model === "kv1") {
        first = KV_ROAD.z[0]; last = KV_ROAD.z.at(-1); count = KV_ROAD.z.length;
        offsets = [-KV_TRACK.x, KV_TRACK.x];
    } else if (def.model === "ratte") {
        first = RATTE_ROAD.z0; last = RATTE_ROAD.z1; count = RATTE_ROAD.n;
        offsets = [...RATTE_TRACK.xs.map(x => -x), ...RATTE_TRACK.xs];
    } else {
        if (def.susp.type === "interleaved") count = count * 2 - 1;
        last = L * (def.susp.type === "christie" ? 0.4 : 0.38) - roadWheelRadius(def) * 0.55;
        first = -last;
        offsets = [-(W - tw) / 2, (W - tw) / 2];
    }
    const spacing = (last - first) / (count - 1);
    const [omega, damping] = SPRINGS[def.susp.type];
    return { first, spacing, count, offsets, travel: Math.min(0.62, th * 0.32),
        stiffness: omega * omega, damping: 2 * damping * omega,
        heights: offsets.map(() => new Float64Array(count)),
        beltY: offsets.map(() => new Float32Array((count - 1) * BELT_SUBDIVISIONS + 1)),
        groundRates: offsets.map(() => new Float32Array(count)),
        travelY: offsets.map(() => new Float32Array(count)) };
}

export function wheelTravel(state, lane, x) {
    const pos = clamp((x - state.first) / state.spacing, 0, state.count - 1);
    const i = Math.min(Math.floor(pos), state.count - 2);
    const ys = state.travelY[lane];
    return ys[i] + (ys[i + 1] - ys[i]) * (pos - i);
}

export function beltTravel(state, lane, x) {
    const ys = state.beltY[lane];
    const pos = clamp((x - state.first) * BELT_SUBDIVISIONS / state.spacing, 0, ys.length - 1);
    const i = Math.min(Math.floor(pos), ys.length - 2);
    return ys[i] + (ys[i + 1] - ys[i]) * (pos - i);
}

export function canMountRock(v, o) {
    return o.h <= v.def.dims.th * 0.85 || !!v.def.boss;
}

// Подбираем поверхность опоры один раз для всех катков машины за шаг.
function supports(v, world, reach) {
    const result = [];
    for (const { type, o } of world.query(v.x, v.z, reach + 12)) {
        if (type === "tree" && o.fallen && o.alive) {
            const length = o.h * ({ pine: 0.25, palm: 0.85 }[world.biome.treeKind] || 0.42);
            if (Math.hypot(v.x - o.x, v.z - o.z) > reach + length + 1) continue;
            const c = Math.cos(o.fallA), s = Math.sin(o.fallA);
            result.push((x, z) => {
                const dx = x - o.x, dz = z - o.z;
                const along = clamp(dx * c + dz * s, 0, length);
                const r = 0.34 - 0.12 * along / length;
                const d2 = (dx - along * c) ** 2 + (dz - along * s) ** 2;
                return d2 < r * r ? o.y - 0.15 + along * 0.094 + Math.sqrt(r * r - d2) : -Infinity;
            });
        } else if (type === "rock" && canMountRock(v, o)) {
            if (Math.hypot(v.x - o.x, v.z - o.z) > reach + o.r * 1.2) continue;
            const c = Math.cos(o.rot), s = Math.sin(o.rot);
            result.push((x, z) => {
                const dx = x - o.x, dz = z - o.z;
                const k = 1 - ((dx * c - dz * s) / (o.r * o.sx)) ** 2 - ((dx * s + dz * c) / (o.r * o.sz)) ** 2;
                return k > 0 ? o.y + o.h * (0.3 + 0.68 * Math.sqrt(k)) : -Infinity;
            });
        }
    }
    return result;
}

/** Корпус на пружинах с амортизаторами. Сила каждого катка создаёт подъём и два момента. */
export function settleOnGround(v, world, dt) {
    if (!world.terrain) return;
    const state = v.suspension || (v.suspension = suspensionLayout(v.def));
    const { first, spacing, count, offsets, heights, travelY, travel } = state;
    const cx = first + spacing * (count - 1) / 2;
    const c = Math.cos(v.a), s = Math.sin(v.a);
    const nearby = supports(v, world, v.def.bodyRadius);
    // Появление или сетевая перестановка машины не должны имитировать падение с высоты.
    const reset = dt === undefined || state.lastSpeed === undefined ||
        Math.hypot(v.x - state.lastX, v.z - state.lastZ) > 4;
    if (!reset && dt <= 0) return;
    let total = 0, xx = 0, zz = 0, xy = 0, zy = 0;
    for (let lane = 0; lane < offsets.length; lane++) {
        const z = offsets[lane];
        for (let i = 0; i < count; i++) {
            const x = first + i * spacing;
            const wx = v.x + x * c - z * s, wz = v.z + x * s + z * c;
            let y = world.terrain.height(wx, wz);
            for (const top of nearby) y = Math.max(y, top(wx, wz));
            state.groundRates[lane][i] = reset ? 0 : clamp((y - heights[lane][i]) / dt, -4, 4);
            heights[lane][i] = y;
            total += y; xx += (x - cx) ** 2; zz += z * z;
            xy += (x - cx) * y; zy += z * y;
        }
    }
    const longitudinal = xy / xx, lateral = zy / zz;
    const samples = count * offsets.length;
    state.grade = Math.atan(longitudinal);
    state.groundRoll = -Math.atan(lateral * Math.cos(state.grade));
    state.groundY = total / samples - cx * longitudinal;
    if (reset) {
        state.height = total / samples;
        v.pitch = state.grade;
        v.roll = state.groundRoll;
        state.heaveRate = state.pitchRate = state.rollRate = 0;
    } else {
        const { L, W, H } = v.def.dims;
        const pitchInertia = (L * L + H * H) / 12;
        const rollInertia = (W * W + H * H) / 12;
        const cg = H * 0.82;
        const forwardAccel = clamp((v.v - state.lastSpeed) / dt - v.w * v.slip, -18, 18);
        const sideAccel = clamp((v.slip - state.lastSlip) / dt + v.w * v.v, -14, 14);
        const steps = Math.max(1, Math.ceil(dt * 120)), h = dt / steps;
        for (let step = 0; step < steps; step++) {
            let lift = 0, pitchMoment = 0, rollMoment = 0;
            const slope = Math.tan(v.pitch), bank = -Math.tan(v.roll) / Math.cos(v.pitch);
            for (let lane = 0; lane < offsets.length; lane++) {
                const z = offsets[lane];
                for (let i = 0; i < count; i++) {
                    const x = first + i * spacing - cx;
                    const surfaceRate = state.groundRates[lane][i];
                    const surface = heights[lane][i] - surfaceRate * (steps - step - 1) * h;
                    const compression = surface - (state.height + x * slope + z * bank);
                    if (compression < -travel) continue;
                    const rate = surfaceRate - state.heaveRate - x * state.pitchRate + z * state.rollRate;
                    const bumpStop = Math.max(0, compression - travel * 0.8);
                    // Преднатяг на ровной площадке уравновешивает вес. Вывешенный каток корпус не тянет.
                    const force = Math.max(0, 9.81 + state.stiffness * (compression + 5 * bumpStop) + state.damping * rate);
                    lift += force; pitchMoment += force * x; rollMoment -= force * z;
                }
            }
            state.heaveRate += (lift / samples - 9.81) * h;
            state.pitchRate += (pitchMoment / samples + cg * forwardAccel) / pitchInertia * h;
            state.rollRate += (rollMoment / samples - cg * 0.76 * sideAccel) / rollInertia * h;
            state.height += state.heaveRate * h;
            const nextPitch = v.pitch + state.pitchRate * h, nextRoll = v.roll + state.rollRate * h;
            v.pitch = clamp(nextPitch, state.grade - 0.24, state.grade + 0.24);
            v.roll = clamp(nextRoll, state.groundRoll - 0.28, state.groundRoll + 0.28);
            if (v.pitch !== nextPitch) state.pitchRate = 0;
            if (v.roll !== nextRoll) state.rollRate = 0;
        }
    }
    v.y = state.height - cx * Math.tan(v.pitch);
    state.lastSpeed = v.v; state.lastSlip = v.slip; state.lastX = v.x; state.lastZ = v.z;
    // Та же поза YZX, что у модели. Ищем поверхность вдоль хода балансира.
    const cp = Math.cos(v.pitch), sp = Math.sin(v.pitch), cr = Math.cos(v.roll), sr = Math.sin(v.roll);
    const upY = cp * cr, upX = -c * sp * cr - s * sr, upZ = -s * sp * cr + c * sr;
    function supportTravel(x, z, estimate) {
        const forward = cp * x + sp * sr * z, side = cr * z;
        const wx = v.x + c * forward - s * side, wz = v.z + s * forward + c * side;
        const base = v.y + sp * x - cp * sr * z;
        for (let k = 0; k < 4; k++) {
            const probe = clamp(estimate, -travel, travel);
            const px = wx + upX * probe, pz = wz + upZ * probe;
            let ground = world.terrain.height(px, pz);
            for (const top of nearby) ground = Math.max(ground, top(px, pz));
            const next = (ground - base) / upY;
            if (Math.abs(next - estimate) < 0.0005) return next;
            estimate = next;
        }
        return estimate;
    }
    // В конце хода сжатия опора поднимает весь корпус.
    let bottomOut = 0;
    for (let lane = 0; lane < offsets.length; lane++) {
        for (let i = 0; i < count; i++) {
            const x = first + i * spacing;
            const required = supportTravel(x, offsets[lane], travelY[lane][i]);
            state.beltY[lane][i * BELT_SUBDIVISIONS] = required;
            bottomOut = Math.max(bottomOut, (required - travel) * upY);
        }
    }
    if (bottomOut > 0) { v.y += bottomOut; state.height += bottomOut; }
    let changed = false;
    for (let lane = 0; lane < offsets.length; lane++) {
        const belt = state.beltY[lane];
        for (let i = 0; i < count; i++) {
            const j = i * BELT_SUBDIVISIONS;
            const required = bottomOut > 0 ? supportTravel(first + i * spacing, offsets[lane], belt[j]) : belt[j];
            const y = clamp(required, -travel, travel);
            if (Math.abs(y - travelY[lane][i]) > 0.0005) { travelY[lane][i] = y; changed = true; }
            belt[j] = travelY[lane][i];
        }
        // Между опорами лента натянута; вершина между двумя катками также может её подпереть.
        for (let i = 0; i < count - 1; i++) for (let k = 1; k < BELT_SUBDIVISIONS; k++) {
            const f = k / BELT_SUBDIVISIONS, j = i * BELT_SUBDIVISIONS + k;
            const chord = travelY[lane][i] * (1 - f) + travelY[lane][i + 1] * f;
            const y = Math.max(chord, supportTravel(first + (i + f) * spacing, offsets[lane], chord));
            if (Math.abs(y - belt[j]) > 0.0005) { belt[j] = y; changed = true; }
        }
    }
    if (changed) state.version = (state.version || 0) + 1;
}
