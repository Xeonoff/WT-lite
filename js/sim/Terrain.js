import { clamp } from "../core/Utils.js";

/**
 * Рельеф карты: детерминированная карта высот по сиду (одинаковая на сервере и у клиентов,
 * по сети не передаётся). Сетка с шагом CELL, между узлами — билинейная интерполяция.
 *
 * Основа — несколько октав сглаженного шума, затем правки по разметке мира:
 *  - площадки под зданиями и точками захвата выравниваются;
 *  - река лежит в долине: русло ниже уровня воды, берега плавно поднимаются к холмам;
 *  - мосты — насыпь на уровне берега, броды — мелководье.
 * За границей карты рельеф затухает к нулю (на краю видимой земли).
 */
const CELL = 2;
const MARGIN = 160;

/** Уровень воды рек и высота берега над ним */
export const WATER_Y = -1.1;
const BANK = 0.75;

const smooth01 = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** Значение решётки шума в узле (ix, iz): −1…1 */
function lattice(ix, iz, seed) {
    let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 2147483647)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return ((h >>> 0) / 4294967295) * 2 - 1;
}

function valueNoise(x, z, seed) {
    const ix = Math.floor(x), iz = Math.floor(z);
    const fx = x - ix, fz = z - iz;
    const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
    const a = lattice(ix, iz, seed), b = lattice(ix + 1, iz, seed);
    const c = lattice(ix, iz + 1, seed), d = lattice(ix + 1, iz + 1, seed);
    return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sz;
}

/** Параметры рельефа карты: amp — высота холмов, м; scale — характерный размер, м; ridge — доля гребней */
const DEFAULT_RELIEF = { amp: 4, scale: 150, ridge: 0 };

export class Terrain {
    constructor(world) {
        const S = world.S;
        this.S = S;
        this.cell = CELL;
        this.x0 = -MARGIN;
        this.n = Math.ceil((S + MARGIN * 2) / CELL) + 1;
        this.waterY = WATER_Y;
        this.relief = { ...DEFAULT_RELIEF, ...(world.mode === "range" ? { amp: 1.2 } : world.map.relief || {}) };
        this.seed = (world.seed * 7919 + 17) | 0;
        this.h = new Float32Array(this.n * this.n);
        this.build(world);
        this.course = world.course;
        for (const ramp of this.course || []) ramp.base = this.groundHeight(ramp.x, ramp.z);
    }

    /** Исходный рельеф без правок (холмы, гряды) */
    base(x, z) {
        const R = this.relief, k = 1 / R.scale;
        let h = valueNoise(x * k, z * k, this.seed) * 1.0
            + valueNoise(x * k * 2.1 + 31.7, z * k * 2.1 - 12.3, this.seed + 1) * 0.42
            + valueNoise(x * k * 4.3 - 7.1, z * k * 4.3 + 3.9, this.seed + 2) * 0.16;
        if (R.ridge) {
            // гряды: «сложенный» шум даёт острые хребты
            const r = 1 - Math.abs(valueNoise(x * k * 0.8 + 101, z * k * 0.8 - 57, this.seed + 3));
            h = h * (1 - R.ridge) + (r * r * 2 - 0.7) * R.ridge * 1.6;
        }
        let y = h * R.amp;
        // за краем карты — затухание к нулю
        const out = Math.max(-x, -z, x - this.S, z - this.S, 0);
        if (out > 0) y *= 1 - smooth01(out / (MARGIN * 0.8));
        return y;
    }

    build(world) {
        const n = this.n, S = this.S;
        const H = this.h;
        for (let j = 0; j < n; j++) {
            const z = this.x0 + j * CELL;
            for (let i = 0; i < n; i++) H[j * n + i] = this.base(this.x0 + i * CELL, z);
        }
        // площадки: { x, z, a, hl, hw — прямоугольник, или r — круг; blend — ширина перехода; y — высота }
        const pads = [];
        for (const b of world.buildings) pads.push({ x: b.x, z: b.z, a: b.a, hl: b.hl + 1.2, hw: b.hw + 1.2, blend: 7 });
        for (const p of world.points) pads.push({ x: p.x, z: p.z, r: p.r + 5, blend: 16 });
        for (const pd of world.terrainPads || []) pads.push(pd);
        // река: долина и русло
        const R = world.river;
        if (R) {
            this.waterPts = R.pts;
            const half = R.w / 2;
            const valley = 34;
            for (let j = 0; j < n; j++) {
                const z = this.x0 + j * CELL;
                for (let i = 0; i < n; i++) {
                    const x = this.x0 + i * CELL;
                    const d = this.riverDist(x, z);
                    if (d > half + valley) continue;
                    const k = j * n + i;
                    const bank = WATER_Y + BANK;
                    if (d < half) {
                        const t = d / half;
                        H[k] = R.frozen ? WATER_Y - 0.02 : WATER_Y - 0.35 - 1.3 * (1 - t * t);
                    } else {
                        const s = smooth01((d - half) / valley);
                        // берег не выше окрестных холмов и не ниже уровня берега
                        H[k] = bank + (Math.max(bank, H[k]) - bank) * s;
                    }
                }
            }
            for (const c of world.bridges) {
                if (c.kind === "bridge") pads.push({ x: c.x, z: c.z, a: c.a + Math.PI / 2, hl: c.hl + 4, hw: c.hw + 1, blend: 10, y: WATER_Y + BANK, causeway: true });
                else pads.push({ x: c.x, z: c.z, a: c.a + Math.PI / 2, hl: c.hl + 2, hw: c.hw, blend: 9, y: R.frozen ? WATER_Y - 0.02 : WATER_Y - 0.28, ford: true });
            }
        }
        // высота площадки — по уже прорезанному рельефу (здания у реки не встают на холм)
        for (const pd of pads) if (pd.y === undefined) pd.y = this.height(pd.x, pd.z);
        for (const pd of pads) this.applyPad(pd);
        this.pads = pads;
    }

    riverDist(x, z) {
        const P = this.waterPts;
        let best = Infinity;
        for (let i = 0; i < P.length - 1; i++) {
            const ax = P[i][0], az = P[i][1], bx = P[i + 1][0], bz = P[i + 1][1];
            const dx = bx - ax, dz = bz - az;
            const l2 = dx * dx + dz * dz || 1;
            const t = clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1);
            const ex = ax + dx * t - x, ez = az + dz * t - z;
            const d2 = ex * ex + ez * ez;
            if (d2 < best) best = d2;
        }
        return Math.sqrt(best);
    }

    /** Выравнивание площадки: внутри — высота pad.y, в полосе blend — плавный переход */
    applyPad(pd) {
        const n = this.n, H = this.h;
        const ext = (pd.r || Math.hypot(pd.hl, pd.hw)) + pd.blend;
        const i0 = Math.max(0, Math.floor((pd.x - ext - this.x0) / CELL)), i1 = Math.min(n - 1, Math.ceil((pd.x + ext - this.x0) / CELL));
        const j0 = Math.max(0, Math.floor((pd.z - ext - this.x0) / CELL)), j1 = Math.min(n - 1, Math.ceil((pd.z + ext - this.x0) / CELL));
        const c = Math.cos(-(pd.a || 0)), s = Math.sin(-(pd.a || 0));
        for (let j = j0; j <= j1; j++) {
            const z = this.x0 + j * CELL;
            for (let i = i0; i <= i1; i++) {
                const x = this.x0 + i * CELL;
                let d;
                if (pd.r) d = Math.hypot(x - pd.x, z - pd.z) - pd.r;
                else {
                    const lx = (x - pd.x) * c - (z - pd.z) * s, lz = (x - pd.x) * s + (z - pd.z) * c;
                    d = Math.hypot(Math.max(0, Math.abs(lx) - pd.hl), Math.max(0, Math.abs(lz) - pd.hw));
                }
                if (d >= pd.blend) continue;
                const w = d <= 0 ? 1 : 1 - smooth01(d / pd.blend);
                const k = j * n + i;
                H[k] += (pd.y - H[k]) * w;
            }
        }
    }

    /** Высота земли в точке, м */
    height(x, z) {
        const ground = this.groundHeight(x, z);
        if (!this.course) return ground;
        for (const ramp of this.course) {
            const dx = x - ramp.x;
            if (Math.abs(dx) >= ramp.hw) continue;
            const dz = Math.abs(z - ramp.z - ramp.skew * dx);
            if (dz >= ramp.run) continue;
            const k = Math.min(1, (ramp.run - dz) / (ramp.run - ramp.flat), (ramp.hw - Math.abs(dx)) / 1.5);
            return Math.max(ground, ramp.base + ramp.rise * k);
        }
        return ground;
    }

    groundHeight(x, z) {
        const n = this.n;
        let fx = (x - this.x0) / CELL, fz = (z - this.x0) / CELL;
        if (fx < 0) fx = 0; else if (fx > n - 1.001) fx = n - 1.001;
        if (fz < 0) fz = 0; else if (fz > n - 1.001) fz = n - 1.001;
        const i = fx | 0, j = fz | 0;
        const tx = fx - i, tz = fz - j;
        const H = this.h, k = j * n + i;
        const a = H[k], b = H[k + 1], c = H[k + n], d = H[k + n + 1];
        return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
    }

    /** Нормаль поверхности (единичная) */
    normal(x, z) {
        const e = CELL;
        const dx = this.height(x + e, z) - this.height(x - e, z);
        const dz = this.height(x, z + e) - this.height(x, z - e);
        const l = Math.hypot(dx, 2 * e, dz);
        return [-dx / l, (2 * e) / l, -dz / l];
    }

    /**
     * Первое пересечение луча с землёй на длине L: t (м от p0) или −1.
     * Шаг грубый, затем уточнение делением пополам.
     */
    ray(p0, d, L, step = 2) {
        let prevT = 0;
        let prevGap = p0[1] - this.height(p0[0], p0[2]);
        if (prevGap < 0) return 0;
        for (let t = step; ; t += step) {
            const tt = Math.min(t, L);
            const x = p0[0] + d[0] * tt, y = p0[1] + d[1] * tt, z = p0[2] + d[2] * tt;
            const gap = y - this.height(x, z);
            if (gap < 0) {
                let a = prevT, b = tt;
                for (let k = 0; k < 10; k++) {
                    const m = (a + b) / 2;
                    if (p0[1] + d[1] * m - this.height(p0[0] + d[0] * m, p0[2] + d[2] * m) < 0) b = m; else a = m;
                }
                return b;
            }
            prevT = tt;
            prevGap = gap;
            if (tt >= L) return -1;
        }
    }

    /** Есть ли гребень между двумя точками (прямая видимость через рельеф) */
    blocks(x1, y1, z1, x2, y2, z2) {
        const L = Math.hypot(x2 - x1, z2 - z1);
        if (L < 4) return false;
        const n = Math.ceil(L / 4);
        for (let i = 1; i < n; i++) {
            const t = i / n;
            const y = y1 + (y2 - y1) * t;
            if (this.height(x1 + (x2 - x1) * t, z1 + (z2 - z1) * t) > y) return true;
        }
        return false;
    }
}
