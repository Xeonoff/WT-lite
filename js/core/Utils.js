export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const rnd = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
export const rndi = (a, b) => Math.floor(rnd(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => t * t * (3 - 2 * t);
export const dist2 = (x1, z1, x2, z2) => Math.hypot(x2 - x1, z2 - z1);

/** Кратчайшая разница углов b - a в диапазоне [-PI, PI] */
export function angDiff(a, b) {
    let d = (b - a) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return d;
}
export const wrapAng = (a) => angDiff(0, a);

/** Экспоненциальное сглаживание, не зависящее от FPS */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

/** Детерминированный генератор случайных чисел (mulberry32) */
export function seeded(seed) {
    let s = seed >>> 0;
    const f = () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    f.range = (a, b) => a + f() * (b - a);
    f.int = (a, b) => Math.floor(a + f() * (b - a + 1));
    f.pick = (arr) => arr[Math.floor(f() * arr.length)];
    f.chance = (p) => f() < p;
    return f;
}

/** Случайное направление внутри конуса вокруг d (единичный вектор), half — половина угла */
export function coneDir(d, half) {
    // базис, перпендикулярный d
    let ux = 0, uy = 1, uz = 0;
    if (Math.abs(d[1]) > 0.9) { ux = 1; uy = 0; }
    // e1 = normalize(u x d)
    let e1x = uy * d[2] - uz * d[1], e1y = uz * d[0] - ux * d[2], e1z = ux * d[1] - uy * d[0];
    const l1 = Math.hypot(e1x, e1y, e1z) || 1;
    e1x /= l1; e1y /= l1; e1z /= l1;
    // e2 = d x e1
    const e2x = d[1] * e1z - d[2] * e1y, e2y = d[2] * e1x - d[0] * e1z, e2z = d[0] * e1y - d[1] * e1x;
    const cosMax = Math.cos(half);
    const c = 1 - Math.random() * (1 - cosMax);
    const s = Math.sqrt(1 - c * c);
    const ph = Math.random() * TAU;
    const a = Math.cos(ph) * s, b = Math.sin(ph) * s;
    return [d[0] * c + e1x * a + e2x * b, d[1] * c + e1y * a + e2y * b, d[2] * c + e1z * a + e2z * b];
}

export function randomDir3() {
    const z = rnd(-1, 1), ph = rnd(TAU), r = Math.sqrt(1 - z * z);
    return [Math.cos(ph) * r, z, Math.sin(ph) * r];
}

/**
 * Пересечение луча с AABB (метод плит).
 * Возвращает {t0, t1, axis, sign} — t0 входа, ось и знак грани входа, или null.
 */
export function rayAabb(o, d, min, max, tMax = Infinity) {
    let t0 = -Infinity, t1 = Infinity, axis = -1, sign = 0;
    for (let i = 0; i < 3; i++) {
        if (Math.abs(d[i]) < 1e-9) {
            if (o[i] < min[i] || o[i] > max[i]) return null;
            continue;
        }
        const inv = 1 / d[i];
        let ta = (min[i] - o[i]) * inv, tb = (max[i] - o[i]) * inv;
        let s = -1;
        if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; s = 1; }
        if (ta > t0) { t0 = ta; axis = i; sign = s; }
        if (tb < t1) t1 = tb;
        if (t0 > t1) return null;
    }
    if (t1 < 0 || t0 > tMax) return null;
    return { t0, t1, axis, sign };
}

export function raySphere(o, d, c, r) {
    const ox = o[0] - c[0], oy = o[1] - c[1], oz = o[2] - c[2];
    const b = ox * d[0] + oy * d[1] + oz * d[2];
    const cc = ox * ox + oy * oy + oz * oz - r * r;
    const disc = b * b - cc;
    if (disc < 0) return null;
    const s = Math.sqrt(disc);
    const t0 = -b - s, t1 = -b + s;
    if (t1 < 0) return null;
    return { t0: Math.max(0, t0), t1 };
}

/** 2D: пересечение отрезка с окружностью — параметр t входа или -1 */
export function segCircle(x1, z1, x2, z2, cx, cz, r) {
    const dx = x2 - x1, dz = z2 - z1;
    const fx = x1 - cx, fz = z1 - cz;
    const a = dx * dx + dz * dz;
    if (a < 1e-12) return fx * fx + fz * fz <= r * r ? 0 : -1;
    const b = 2 * (fx * dx + fz * dz);
    const c = fx * fx + fz * fz - r * r;
    if (c <= 0) return 0;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return -1;
    const t = (-b - Math.sqrt(disc)) / (2 * a);
    return t >= 0 && t <= 1 ? t : -1;
}

/** 2D: пересечение отрезка с повёрнутым прямоугольником {x,z,a,hl,hw} — t или -1 */
export function segObb(x1, z1, x2, z2, b) {
    const c = Math.cos(-b.a), s = Math.sin(-b.a);
    const lx1 = (x1 - b.x) * c - (z1 - b.z) * s, lz1 = (x1 - b.x) * s + (z1 - b.z) * c;
    const lx2 = (x2 - b.x) * c - (z2 - b.z) * s, lz2 = (x2 - b.x) * s + (z2 - b.z) * c;
    const r = rayAabb([lx1, 0, lz1], [lx2 - lx1, 0, lz2 - lz1], [-b.hl, -1, -b.hw], [b.hl, 1, b.hw], 1);
    if (!r) return -1;
    return Math.max(0, r.t0);
}

/** 2D: точка внутри повёрнутого прямоугольника */
export function ptInObb(x, z, b, pad = 0) {
    const c = Math.cos(-b.a), s = Math.sin(-b.a);
    const lx = (x - b.x) * c - (z - b.z) * s, lz = (x - b.x) * s + (z - b.z) * c;
    return Math.abs(lx) <= b.hl + pad && Math.abs(lz) <= b.hw + pad;
}

/** SAT для двух повёрнутых прямоугольников. Возвращает вектор выталкивания A из B или null */
export function obbObb(A, B) {
    const axes = [
        [Math.cos(A.a), Math.sin(A.a)], [-Math.sin(A.a), Math.cos(A.a)],
        [Math.cos(B.a), Math.sin(B.a)], [-Math.sin(B.a), Math.cos(B.a)],
    ];
    const dx = A.x - B.x, dz = A.z - B.z;
    let best = Infinity, bx = 0, bz = 0;
    for (const [ax, az] of axes) {
        const ra = A.hl * Math.abs(Math.cos(A.a) * ax + Math.sin(A.a) * az) + A.hw * Math.abs(-Math.sin(A.a) * ax + Math.cos(A.a) * az);
        const rb = B.hl * Math.abs(Math.cos(B.a) * ax + Math.sin(B.a) * az) + B.hw * Math.abs(-Math.sin(B.a) * ax + Math.cos(B.a) * az);
        const p = dx * ax + dz * az;
        const ov = ra + rb - Math.abs(p);
        if (ov <= 0) return null;
        if (ov < best) { best = ov; const sg = p < 0 ? -1 : 1; bx = ax * sg; bz = az * sg; }
    }
    return { x: bx * best, z: bz * best, depth: best, nx: bx, nz: bz };
}

/** Окружность против повёрнутого прямоугольника: вектор выталкивания окружности или null */
export function circleObb(cx, cz, r, b) {
    const c = Math.cos(-b.a), s = Math.sin(-b.a);
    const lx = (cx - b.x) * c - (cz - b.z) * s, lz = (cx - b.x) * s + (cz - b.z) * c;
    const qx = clamp(lx, -b.hl, b.hl), qz = clamp(lz, -b.hw, b.hw);
    let ddx = lx - qx, ddz = lz - qz;
    let d = Math.hypot(ddx, ddz);
    if (d >= r) return null;
    let nx, nz, depth;
    if (d < 1e-6) {
        // центр внутри: выталкиваем по ближайшей грани
        const px = b.hl - Math.abs(lx), pz = b.hw - Math.abs(lz);
        if (px < pz) { nx = Math.sign(lx) || 1; nz = 0; depth = px + r; }
        else { nx = 0; nz = Math.sign(lz) || 1; depth = pz + r; }
    } else { nx = ddx / d; nz = ddz / d; depth = r - d; }
    const cw = Math.cos(b.a), sw = Math.sin(b.a);
    const wx = nx * cw - nz * sw, wz = nx * sw + nz * cw;
    return { x: wx * depth, z: wz * depth, nx: wx, nz: wz, depth };
}

export const $ = (id) => document.getElementById(id);

export function h(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
}

export function mkCanvas(w, hgt) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = hgt;
    return c;
}

export const fmtTime = (s) => {
    s = Math.max(0, Math.floor(s));
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
};

let _uid = 1;
export const uid = () => _uid++;
