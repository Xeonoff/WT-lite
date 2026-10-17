import { Events } from "../core/Events.js";
import { seeded, clamp, segObb, segCircle, circleObb, ptInObb, TAU } from "../core/Utils.js";
import { MAPS, BIOMES } from "../data/Maps.js";

const CELL = 4;          // клетка навигационной сетки, м
const BUCKET = 16;       // ячейка пространственного хеша, м

export class World {
    constructor(mapId, seed, modeId) {
        this.mapId = mapId;
        this.map = MAPS[mapId];
        this.biome = BIOMES[this.map.biome];
        this.mode = modeId;
        this.S = modeId === "range" ? 320 : modeId === "waves" ? Math.round(this.map.size * 0.86) : this.map.size;
        this.seed = seed;
        this.rng = seeded(seed);

        this.buildings = [];
        this.rocks = [];
        this.trees = [];
        this.bushes = [];
        this.fences = [];
        this.hay = [];
        this.roads = [];
        this.fields = [];
        this.points = [];
        this.spawns = [];
        this.enemyEdges = [];
        this.wrecks = [];
        this.hedges = [];
        this.river = null;
        this.water = [];
        this.bridges = [];

        this.genLayout();
        const gen = this.map.gen;
        if (modeId === "range") this.genRange();
        else if (gen === "village") this.genVillage();
        else if (gen === "town") this.genTown();
        else if (gen === "bocage") this.genBocage();
        else this.genDesert();

        this.buildSpatial();
        this.buildNav();
    }

    /* ───────────────────── Общая разметка ───────────────────── */
    genLayout() {
        const S = this.S, r = this.rng;
        if (this.mode === "domination") {
            const j = () => r.range(-0.05, 0.05) * S;
            this.points = [
                { id: "A", x: S * 0.2, z: S * 0.5 + j(), r: 15 },
                { id: "B", x: S * 0.5, z: S * 0.5 + j() * 0.4, r: 15 },
                { id: "C", x: S * 0.8, z: S * 0.5 + j(), r: 15 },
            ];
            this.spawns = [
                { x: S * 0.5, z: S - 34, a: -Math.PI / 2, spread: S * 0.22 },
                { x: S * 0.5, z: 34, a: Math.PI / 2, spread: S * 0.22 },
            ];
        } else if (this.mode === "waves") {
            this.points = [{ id: "★", x: S * 0.5, z: S * 0.5, r: 19 }];
            this.spawns = [
                { x: S * 0.5, z: S * 0.5 + 34, a: -Math.PI / 2, spread: 18 },
                { x: S * 0.5, z: 30, a: Math.PI / 2, spread: S * 0.3 },
            ];
            this.enemyEdges = [
                { x: S * 0.5, z: 26, a: Math.PI / 2 },
                { x: 26, z: S * 0.5, a: 0 },
                { x: S - 26, z: S * 0.5, a: Math.PI },
                { x: S * 0.25, z: 26, a: Math.PI / 2 },
                { x: S * 0.75, z: 26, a: Math.PI / 2 },
            ];
        } else {
            this.points = [];
            this.spawns = [
                { x: S * 0.5, z: S - 40, a: -Math.PI / 2, spread: 4 },
                { x: S * 0.5, z: 60, a: Math.PI / 2, spread: 60 },
            ];
        }
    }

    /** Свободно ли место (r — радиус объекта); kind влияет на запретные зоны */
    canPlace(x, z, r, kind = "solid") {
        const S = this.S;
        if (x < r + 6 || z < r + 6 || x > S - r - 6 || z > S - r - 6) return false;
        for (const sp of this.spawns) {
            const half = sp.spread + 12;
            if (Math.abs(x - sp.x) < half && Math.abs(z - sp.z) < 26 && kind !== "bush") return false;
        }
        for (const p of this.points) {
            const d = Math.hypot(x - p.x, z - p.z);
            if (kind === "solid" && d < p.r + 9 + r) return false;
            if (kind === "tree" && d < p.r + 2 + r) return false;
            if (kind === "bush" && d < p.r * 0.55) return false;
        }
        if (kind !== "bush" && this.nearRoad(x, z, r + 1.5)) return false;
        if (this.river) {
            const n = this.riverNearest(x, z);
            if (n && n.d < this.river.w / 2 + r + (kind === "bush" ? 0.5 : 3)) return false;
        }
        for (const b of this.buildings) if (ptInObb(x, z, b, r + 3)) return false;
        if (kind !== "bush") for (const hg of this.hedges) if (Math.abs(hg.x - x) < 8 && Math.abs(hg.z - z) < 8 && ptInObb(x, z, hg, r + 1)) return false;
        for (const o of this.rocks) if (Math.hypot(x - o.x, z - o.z) < o.r + r + 2) return false;
        if (kind !== "bush") {
            for (const t of this.trees) if (Math.hypot(x - t.x, z - t.z) < r + 3.2) return false;
            for (const hy of this.hay) if (Math.hypot(x - hy.x, z - hy.z) < r + hy.r + 2) return false;
        }
        return true;
    }

    nearRoad(x, z, pad) {
        for (const rd of this.roads) {
            const half = rd.w / 2 + pad;
            for (let i = 0; i < rd.pts.length - 1; i++) {
                const [ax, az] = rd.pts[i], [bx, bz] = rd.pts[i + 1];
                const dx = bx - ax, dz = bz - az;
                const l2 = dx * dx + dz * dz || 1;
                const t = clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1);
                if (Math.hypot(x - (ax + dx * t), z - (az + dz * t)) < half) return true;
            }
        }
        return false;
    }

    /** Плавная дорога через контрольные точки (Катмулл–Ром) */
    makeRoad(ctrl, w, kind = "road") {
        const pts = this.smoothLine(ctrl);
        this.roads.push({ pts, w, kind });
        return pts;
    }

    smoothLine(ctrl) {
        const pts = [];
        const P = [ctrl[0], ...ctrl, ctrl[ctrl.length - 1]];
        for (let i = 1; i < P.length - 2; i++) {
            const [p0, p1, p2, p3] = [P[i - 1], P[i], P[i + 1], P[i + 2]];
            const seg = Math.max(2, Math.round(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 8));
            for (let k = 0; k < seg; k++) {
                const t = k / seg, t2 = t * t, t3 = t2 * t;
                const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
                pts.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
            }
        }
        pts.push(ctrl[ctrl.length - 1]);
        return pts;
    }

    /* ───────────────────── Река ───────────────────── */
    /** Ближайшая точка русла: {d, i, x, z, dir} */
    riverNearest(x, z) {
        const R = this.river;
        if (!R) return null;
        let best = null;
        for (let i = 0; i < R.pts.length - 1; i++) {
            const [ax, az] = R.pts[i], [bx, bz] = R.pts[i + 1];
            const dx = bx - ax, dz = bz - az;
            const l2 = dx * dx + dz * dz || 1;
            const t = clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1);
            const px = ax + dx * t, pz = az + dz * t;
            const d = Math.hypot(x - px, z - pz);
            if (!best || d < best.d) best = { d, i, x: px, z: pz, dir: Math.atan2(dz, dx) };
        }
        return best;
    }

    inWater(x, z) {
        const R = this.river;
        if (!R) return false;
        const n = this.riverNearest(x, z);
        return n && n.d < R.w / 2;
    }

    /** Река с переправами. Мосты ставятся там, где русло пересекают дороги */
    addRiver(ctrl, w, frozen) {
        const pts = this.smoothLine(ctrl);
        this.river = { pts, w, frozen };
        const r = this.rng;
        // пересечения с дорогами → мосты
        const cross = [];
        for (const rd of this.roads) {
            for (let i = 0; i < rd.pts.length - 1; i++) {
                const [ax, az] = rd.pts[i], [bx, bz] = rd.pts[i + 1];
                for (let k = 0; k < pts.length - 1; k++) {
                    const hit = segInt(ax, az, bx, bz, pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1]);
                    if (hit && !cross.some((c) => Math.hypot(c.x - hit[0], c.z - hit[1]) < 30)) {
                        cross.push({ x: hit[0], z: hit[1], kind: "bridge", a: Math.atan2(pts[k + 1][1] - pts[k][1], pts[k + 1][0] - pts[k][0]) });
                    }
                }
            }
        }
        // брод в самой длинной части без переправ
        for (let tries = 0; tries < 40 && !frozen; tries++) {
            const k = r.int(2, pts.length - 3);
            const [x, z] = pts[k];
            if (x < 20 || z < 20 || x > this.S - 20 || z > this.S - 20) continue;
            if (cross.some((c) => Math.hypot(c.x - x, c.z - z) < 70)) continue;
            cross.push({ x, z, kind: "ford", a: Math.atan2(pts[k + 1][1] - z, pts[k + 1][0] - x) });
            if (cross.filter((c) => c.kind === "ford").length >= 2) break;
        }
        for (const c of cross) {
            c.hl = w / 2 + 3;
            c.hw = c.kind === "bridge" ? 3.4 : 6;
            this.bridges.push(c);
        }
        if (frozen) return;
        // вода: цепочка окружностей, разорванная на переправах
        const step = 2.5;
        for (let i = 0; i < pts.length - 1; i++) {
            const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
            const L = Math.hypot(bx - ax, bz - az);
            const n = Math.max(1, Math.ceil(L / step));
            for (let k = 0; k < n; k++) {
                const x = ax + (bx - ax) * k / n, z = az + (bz - az) * k / n;
                if (cross.some((c) => Math.hypot(c.x - x, c.z - z) < c.hw + w * 0.25)) continue;
                this.water.push({ x, z, r: w / 2 - 0.4 });
            }
        }
    }

    addBuilding(x, z, a, hl, hw, h, roof, kind = "house") {
        const r = this.rng;
        const b = { x, z, a, hl, hw, h, roof, kind, col: r.int(0, 9), rcol: r.int(0, 9) };
        this.buildings.push(b);
        return b;
    }

    tryBuilding(x, z, a, hl, hw, h, roof, kind) {
        const rad = Math.hypot(hl, hw);
        if (!this.canPlace(x, z, rad * 0.75, "solid")) return null;
        // проверка пересечения с дорогами по углам
        const c = Math.cos(a), s = Math.sin(a);
        for (const [u, w] of [[hl, hw], [-hl, hw], [hl, -hw], [-hl, -hw], [0, 0]]) {
            const px = x + u * c - w * s, pz = z + u * s + w * c;
            if (this.nearRoad(px, pz, 1.2)) return null;
            for (const p of this.points) if (Math.hypot(px - p.x, pz - p.z) < p.r + 7) return null;
        }
        return this.addBuilding(x, z, a, hl, hw, h, roof, kind);
    }

    addTree(x, z, kind) {
        const r = this.rng;
        const t = { x, z, r: r.range(2.4, 3.6), h: r.range(7, 11), trunk: 0.42, alive: true, fallen: false, fallA: 0, kind, idx: this.trees.length, tint: r() };
        if (kind === "pine") { t.r *= 0.8; t.h *= 1.2; }
        if (kind === "palm") { t.r *= 0.95; t.h *= 0.95; }
        this.trees.push(t);
        return t;
    }

    scatterTrees(cx, cz, rad, n, kind) {
        const r = this.rng;
        for (let i = 0; i < n * 3 && n > 0; i++) {
            const a = r() * TAU, d = Math.sqrt(r()) * rad;
            const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
            if (this.canPlace(x, z, 2.2, "tree")) { this.addTree(x, z, kind); n--; }
        }
    }

    scatterBushes(cx, cz, rad, n) {
        const r = this.rng;
        for (let i = 0; i < n * 3 && n > 0; i++) {
            const a = r() * TAU, d = Math.sqrt(r()) * rad;
            const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
            if (this.canPlace(x, z, 1.5, "bush")) { this.bushes.push({ x, z, r: r.range(1.6, 2.6), tint: r() }); n--; }
        }
    }

    treeLine(x1, z1, x2, z2, kind, gap = 0.12) {
        const r = this.rng;
        const L = Math.hypot(x2 - x1, z2 - z1);
        const n = Math.floor(L / r.range(6.5, 9));
        for (let i = 0; i <= n; i++) {
            if (r() < gap) continue;
            const t = i / Math.max(1, n);
            const x = x1 + (x2 - x1) * t + r.range(-1.2, 1.2), z = z1 + (z2 - z1) * t + r.range(-1.2, 1.2);
            if (this.canPlace(x, z, 2, "tree")) this.addTree(x, z, kind);
            if (r() < 0.45) this.scatterBushes(x, z, 4, 1);
        }
    }

    fenceLine(x1, z1, x2, z2) {
        const L = Math.hypot(x2 - x1, z2 - z1);
        const a = Math.atan2(z2 - z1, x2 - x1);
        const n = Math.max(1, Math.round(L / 4));
        for (let i = 0; i < n; i++) {
            const t = (i + 0.5) / n;
            const x = x1 + (x2 - x1) * t, z = z1 + (z2 - z1) * t;
            if (this.nearRoad(x, z, 0.5)) continue;
            let bad = false;
            for (const b of this.buildings) if (ptInObb(x, z, b, 0.6)) { bad = true; break; }
            for (const p of this.points) if (Math.hypot(x - p.x, z - p.z) < p.r + 3) bad = true;
            if (bad) continue;
            this.fences.push({ x, z, a, hl: L / n / 2, hw: 0.12, h: 1.3, alive: true, idx: this.fences.length });
        }
    }

    addRock(x, z, r, h) {
        const rr = this.rng;
        this.rocks.push({ x, z, r, h, rot: rr() * TAU, sx: rr.range(0.85, 1.2), sz: rr.range(0.85, 1.2), tint: rr() });
    }

    addFields(n, avoidR, cx, cz) {
        const r = this.rng, S = this.S;
        for (let i = 0; i < n; i++) {
            const x = r.range(0.08, 0.92) * S, z = r.range(0.08, 0.92) * S;
            if (Math.hypot(x - cx, z - cz) < avoidR) continue;
            this.fields.push({ x, z, a: r.range(-0.3, 0.3) + (r() < 0.5 ? 0 : Math.PI / 2), hl: r.range(25, 60), hw: r.range(18, 40), col: r.int(0, 3), stripes: r() < 0.7 });
        }
    }

    /* ───────────────────── Деревня в полях (лето) ───────────────────── */
    genVillage() {
        const S = this.S, r = this.rng;
        const c = this.points.length ? this.points[Math.min(1, this.points.length - 1)] : { x: S / 2, z: S / 2 };
        const cx = this.mode === "domination" ? this.points[1].x : S / 2;
        const cz = this.mode === "domination" ? this.points[1].z : S / 2;
        this.addFields(26, 70, cx, cz);
        // дороги
        const zW = S * r.range(0.4, 0.6);
        this.makeRoad([[-10, zW], [S * 0.25, (zW + cz) / 2 + r.range(-20, 20)], [cx, cz], [S * 0.75, cz + r.range(-25, 25)], [S + 10, S * r.range(0.4, 0.6)]], 7);
        this.makeRoad([[cx + r.range(-30, 30), S + 10], [cx + r.range(-20, 20), S * 0.72], [cx, cz], [cx + r.range(-25, 25), S * 0.28], [cx + r.range(-30, 30), -10]], 6);
        if (this.mode === "domination") {
            const pa = this.points[0], pc = this.points[2];
            this.makeRoad([[pa.x, pa.z], [pa.x + 30, pa.z + 60], [S * 0.35, S + 10]], 5, "path");
            this.makeRoad([[pc.x, pc.z], [pc.x - 30, pc.z - 60], [S * 0.65, -10]], 5, "path");
        }
        // река отделяет западный фланг: мосты на дорогах + брод
        const rx = cx - S * r.range(0.13, 0.16);
        this.addRiver([[S * 0.1, -20], [rx - 25, S * 0.24], [rx + r.range(-8, 8), S * 0.5], [rx - 20, S * 0.76], [S * 0.1, S + 20]], 10, false);
        // дома вдоль дорог
        for (const rd of this.roads.slice(0, 2)) {
            let side = 1;
            for (let i = 1; i < rd.pts.length - 1; i++) {
                const [x, z] = rd.pts[i];
                const d = Math.hypot(x - cx, z - cz);
                if (d < 20 || d > 105) continue;
                if (r() < 0.25) continue;
                const [nx, nz] = rd.pts[i + 1];
                const ang = Math.atan2(nz - z, nx - x);
                side = -side;
                const off = r.range(10, 13);
                const px = x + Math.cos(ang + Math.PI / 2) * off * side;
                const pz = z + Math.sin(ang + Math.PI / 2) * off * side;
                const big = r() < 0.18;
                const b = this.tryBuilding(px, pz, ang, big ? r.range(7, 9) : r.range(4, 5.2), big ? r.range(4.5, 5.5) : r.range(3, 3.8), big ? r.range(5.5, 6.5) : r.range(3.8, 4.8), "gable", big ? "barn" : "house");
                if (b && r() < 0.6) {
                    // забор вокруг двора
                    const bx = px + Math.cos(ang + Math.PI / 2) * side * (b.hw + 6), bz = pz + Math.sin(ang + Math.PI / 2) * side * (b.hw + 6);
                    const fx = Math.cos(ang) * 9, fz = Math.sin(ang) * 9;
                    this.fenceLine(bx - fx, bz - fz, bx + fx, bz + fz);
                }
                if (b && r() < 0.5) this.scatterTrees(px + Math.cos(ang + Math.PI / 2) * side * 12, pz + Math.sin(ang + Math.PI / 2) * side * 12, 6, 1, "leaf");
            }
        }
        // лесополосы
        for (let i = 0; i < 9; i++) {
            const x = r.range(0.08, 0.92) * S, z = r.range(0.12, 0.88) * S;
            const a = r() < 0.5 ? r.range(-0.3, 0.3) : Math.PI / 2 + r.range(-0.3, 0.3);
            const L = r.range(60, 150);
            this.treeLine(x - Math.cos(a) * L / 2, z - Math.sin(a) * L / 2, x + Math.cos(a) * L / 2, z + Math.sin(a) * L / 2, "leaf");
        }
        // перелески на флангах
        for (const fx of [0.1, 0.9, r.range(0.3, 0.7)]) {
            const x = fx * S, z = r.range(0.3, 0.7) * S;
            this.scatterTrees(x, z, 32, r.int(14, 24), "leaf");
            this.scatterBushes(x, z, 36, 14);
        }
        // кусты, стога, камни
        for (let i = 0; i < 38; i++) this.scatterBushes(r.range(0.05, 0.95) * S, r.range(0.08, 0.92) * S, 7, r.int(2, 4));
        for (let i = 0; i < 22; i++) {
            const x = r.range(0.06, 0.94) * S, z = r.range(0.1, 0.9) * S;
            if (this.canPlace(x, z, 2.2, "solid")) this.hay.push({ x, z, r: r.range(1.5, 2.0), h: r.range(2.2, 2.8), alive: true, idx: this.hay.length });
        }
        for (let i = 0; i < 10; i++) {
            const x = r.range(0.06, 0.94) * S, z = r.range(0.1, 0.9) * S, rr = r.range(1.4, 2.6);
            if (this.canPlace(x, z, rr, "solid")) this.addRock(x, z, rr, rr * 0.9);
        }
        // руины / укрытия у точек флангов
        for (const p of this.points) {
            if (p === c) continue;
            for (let k = 0; k < 3; k++) {
                const a = r() * TAU, d = p.r + r.range(10, 22);
                this.tryBuilding(p.x + Math.cos(a) * d, p.z + Math.sin(a) * d, r() * TAU, r.range(3, 5), r.range(2.5, 3.5), r.range(2.2, 3.2), "none", "ruin");
            }
            this.scatterBushes(p.x, p.z, p.r + 18, 8);
        }
    }

    /* ───────────────────── Бокаж (живые изгороди) ───────────────────── */
    hedgeLine(x1, z1, x2, z2, gapP) {
        const L = Math.hypot(x2 - x1, z2 - z1);
        const a = Math.atan2(z2 - z1, x2 - x1);
        const n = Math.max(1, Math.round(L / 6));
        const r = this.rng;
        for (let i = 0; i < n; i++) {
            if (r() < gapP) continue;
            const t = (i + 0.5) / n;
            const x = x1 + (x2 - x1) * t, z = z1 + (z2 - z1) * t;
            if (x < 8 || z < 8 || x > this.S - 8 || z > this.S - 8) continue;
            if (this.nearRoad(x, z, 2.5)) continue;
            let bad = false;
            for (const p of this.points) if (Math.hypot(x - p.x, z - p.z) < p.r + 4) bad = true;
            for (const sp of this.spawns) if (Math.abs(x - sp.x) < sp.spread + 14 && Math.abs(z - sp.z) < 24) bad = true;
            for (const b of this.buildings) if (ptInObb(x, z, b, 3)) bad = true;
            if (bad) continue;
            this.hedges.push({ x, z, a, hl: L / n / 2 + 0.2, hw: 0.9, h: 2.6, alive: true, wear: 0, idx: this.hedges.length, tint: r() });
        }
    }

    genBocage() {
        const S = this.S, r = this.rng;
        const cx = this.points.length > 1 ? this.points[1].x : S / 2, cz = this.points.length > 1 ? this.points[1].z : S / 2;
        // узкие дороги
        this.makeRoad([[-10, S * r.range(0.35, 0.45)], [S * 0.3, cz + r.range(-25, 25)], [cx, cz], [S * 0.7, cz + r.range(-25, 25)], [S + 10, S * r.range(0.55, 0.65)]], 6);
        this.makeRoad([[cx + r.range(-20, 20), S + 10], [cx + r.range(-30, 30), S * 0.75], [cx, cz], [cx + r.range(-30, 30), S * 0.25], [cx + r.range(-20, 20), -10]], 5);
        // хутор и церковь в центре
        this.tryBuilding(cx + 24, cz - 22, 0, 9, 5, 9, "gable", "church");
        for (let k = 0; k < 14; k++) {
            const a = r() * Math.PI * 2, d = r.range(20, 60);
            this.tryBuilding(cx + Math.cos(a) * d, cz + Math.sin(a) * d, r() < 0.5 ? 0 : Math.PI / 2, r.range(4, 6.5), r.range(3, 4.5), r.range(4, 6), "gable", "house");
        }
        // фермы у флангов
        for (const p of this.points) {
            if (p.x === cx && p.z === cz) continue;
            for (let k = 0; k < 4; k++) {
                const a = r() * Math.PI * 2, d = r.range(p.r + 14, p.r + 32);
                this.tryBuilding(p.x + Math.cos(a) * d, p.z + Math.sin(a) * d, r() < 0.5 ? 0 : Math.PI / 2, r.range(5, 8), r.range(3.5, 5), r.range(4.5, 6), "gable", "barn");
            }
        }
        // сетка полей с изгородями
        const cell = r.range(56, 66);
        const n = Math.ceil(S / cell) + 1;
        const P = [];
        for (let i = 0; i < n; i++) {
            P.push([]);
            for (let j = 0; j < n; j++) P[i].push([i * cell + (i && i < n - 1 ? r.range(-9, 9) : 0), j * cell + (j && j < n - 1 ? r.range(-9, 9) : 0)]);
        }
        for (let i = 0; i < n - 1; i++) {
            for (let j = 0; j < n - 1; j++) {
                const a = P[i][j], b = P[i + 1][j], c = P[i][j + 1];
                if (r() < 0.82) this.hedgeLine(a[0], a[1], b[0], b[1], 0.12);
                if (r() < 0.82) this.hedgeLine(a[0], a[1], c[0], c[1], 0.12);
                const mx = (a[0] + P[i + 1][j + 1][0]) / 2, mz = (a[1] + P[i + 1][j + 1][1]) / 2;
                this.fields.push({ x: mx, z: mz, a: r.range(-0.08, 0.08), hl: cell * 0.46, hw: cell * 0.46, col: r.int(0, 3), stripes: r() < 0.6 });
                // сад в части клеток
                if (r() < 0.14) {
                    for (let u = -2; u <= 2; u++) for (let w = -2; w <= 2; w++) {
                        const x = mx + u * 8 + r.range(-1, 1), z = mz + w * 8 + r.range(-1, 1);
                        if (this.canPlace(x, z, 2, "tree")) this.addTree(x, z, "leaf");
                    }
                }
            }
        }
        // деревья вдоль изгородей и кусты
        for (const hg of this.hedges) {
            const tx = hg.x + Math.sin(hg.a) * 2.5, tz = hg.z - Math.cos(hg.a) * 2.5;
            if (r() < 0.16 && this.canPlace(tx, tz, 1.5, "tree")) this.addTree(tx, tz, "leaf");
        }
        for (let i = 0; i < 26; i++) this.scatterBushes(r.range(0.05, 0.95) * S, r.range(0.05, 0.95) * S, 6, r.int(1, 3));
        for (let i = 0; i < 10; i++) {
            const x = r.range(0.06, 0.94) * S, z = r.range(0.1, 0.9) * S;
            if (this.canPlace(x, z, 2.2, "solid")) this.hay.push({ x, z, r: r.range(1.5, 2.0), h: r.range(2.2, 2.8), alive: true, idx: this.hay.length });
        }
    }

    /* ───────────────────── Город (зима) ───────────────────── */
    genTown() {
        const S = this.S, r = this.rng;
        const x0 = S * 0.16, x1 = S * 0.84, z0 = S * 0.27, z1 = S * 0.73;
        if (this.mode !== "range") this.addRiver([[-20, S * 0.17], [S * 0.3, S * r.range(0.15, 0.2)], [S * 0.7, S * r.range(0.14, 0.2)], [S + 20, S * 0.18]], 12, true);
        const BLK = 40, ST = 15;
        const nx = Math.floor((x1 - x0 + ST) / (BLK + ST)), nz = Math.floor((z1 - z0 + ST) / (BLK + ST));
        const ox = (S - (nx * (BLK + ST) - ST)) / 2, oz = (S - (nz * (BLK + ST) - ST)) / 2;
        // улицы как дороги
        for (let i = 0; i <= nx; i++) {
            const x = ox + i * (BLK + ST) - ST / 2;
            this.makeRoad([[x, oz - 30], [x, oz + nz * (BLK + ST) + 15]], ST * 0.85, "street");
        }
        for (let j = 0; j <= nz; j++) {
            const z = oz + j * (BLK + ST) - ST / 2;
            this.makeRoad([[ox - 30, z], [ox + nx * (BLK + ST) + 15, z]], ST * 0.85, "street");
        }
        this.makeRoad([[S / 2 + r.range(-20, 20), S + 10], [S / 2, oz + nz * (BLK + ST)]], 8);
        this.makeRoad([[S / 2 + r.range(-20, 20), -10], [S / 2, oz - 10]], 8);
        for (let i = 0; i < nx; i++) {
            for (let j = 0; j < nz; j++) {
                const bx = ox + i * (BLK + ST) + BLK / 2, bz = oz + j * (BLK + ST) + BLK / 2;
                const hasPoint = this.points.some((p) => Math.abs(p.x - bx) < BLK * 0.75 && Math.abs(p.z - bz) < BLK * 0.75);
                if (hasPoint) {
                    // площадь: только низкие руины по углам
                    for (const [u, w] of [[-1, -1], [1, 1]]) {
                        this.tryBuilding(bx + u * BLK * 0.36, bz + w * BLK * 0.36, 0, r.range(2.5, 4), r.range(2, 3), 2.4, "none", "ruin");
                    }
                    this.scatterBushes(bx, bz, BLK * 0.5, 3);
                    continue;
                }
                const layout = r.int(0, 3);
                const ruin = () => r() < 0.22;
                if (layout === 0) {
                    const rn = ruin();
                    this.tryBuilding(bx, bz, 0, BLK * 0.36, BLK * 0.3, rn ? r.range(2.2, 3) : r.range(8, 12), rn ? "none" : r() < 0.6 ? "flat" : "gable", rn ? "ruin" : "block");
                } else {
                    const q = BLK * 0.24;
                    for (const [u, w] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
                        if (layout === 1 && r() < 0.35) continue;
                        const rn = ruin();
                        const hl = r.range(q * 0.7, q * 0.95), hw = r.range(q * 0.6, q * 0.9);
                        this.tryBuilding(bx + u * q, bz + w * q, r() < 0.5 ? 0 : Math.PI / 2, hl, hw, rn ? r.range(2, 3) : r.range(6, 10), rn ? "none" : r() < 0.5 ? "gable" : "flat", rn ? "ruin" : "house");
                    }
                }
            }
        }
        // завалы на улицах
        for (let i = 0; i < 12; i++) {
            const x = r.range(x0, x1), z = r.range(z0, z1), rr = r.range(1.3, 2.4);
            if (this.canPlace(x, z, rr, "bush")) this.addRock(x, z, rr, rr * 0.7);
        }
        // хвойные леса и окраины
        for (const [fx, fz] of [[0.07, 0.5], [0.93, 0.5], [0.3, 0.12], [0.7, 0.88], [0.25, 0.85], [0.75, 0.15]]) {
            this.scatterTrees(fx * S, fz * S, 30, r.int(12, 22), "pine");
            this.scatterBushes(fx * S, fz * S, 34, 10);
        }
        for (let i = 0; i < 5; i++) {
            const x = r.range(0.1, 0.9) * S, z = r() < 0.5 ? r.range(0.08, 0.22) * S : r.range(0.78, 0.92) * S;
            const a = r.range(-0.4, 0.4);
            this.treeLine(x - 40 * Math.cos(a), z - 40 * Math.sin(a), x + 40 * Math.cos(a), z + 40 * Math.sin(a), "pine", 0.2);
        }
        for (let i = 0; i < 26; i++) this.scatterBushes(r.range(0.05, 0.95) * S, r.range(0.05, 0.95) * S, 6, r.int(1, 3));
        for (let i = 0; i < 8; i++) {
            const x = r.range(0.1, 0.9) * S, z = r() < 0.5 ? r.range(0.1, 0.25) * S : r.range(0.75, 0.9) * S;
            const a = r() * TAU;
            this.fenceLine(x, z, x + Math.cos(a) * 24, z + Math.sin(a) * 24);
        }
        this.addFields(10, S * 0.32, S / 2, S / 2);
    }

    /* ───────────────────── Пустыня ───────────────────── */
    genDesert() {
        const S = this.S, r = this.rng;
        this.addFields(14, 60, S / 2, S / 2);
        this.makeRoad([[-10, S * r.range(0.35, 0.65)], [S * 0.3, S * r.range(0.4, 0.6)], [S * 0.7, S * r.range(0.4, 0.6)], [S + 10, S * r.range(0.35, 0.65)]], 6, "path");
        this.makeRoad([[S * r.range(0.4, 0.6), -10], [S * 0.5, S * 0.5], [S * r.range(0.4, 0.6), S + 10]], 6, "path");
        // скальные гряды с проходами
        for (let i = 0; i < 9; i++) {
            const x = r.range(0.12, 0.88) * S, z = r.range(0.15, 0.85) * S;
            const a = r() * TAU, L = r.range(40, 90);
            const n = Math.floor(L / 6);
            for (let k = 0; k < n; k++) {
                if (r() < 0.18) continue;
                const t = k / n - 0.5;
                const px = x + Math.cos(a) * L * t + r.range(-2, 2), pz = z + Math.sin(a) * L * t + r.range(-2, 2);
                const rr = r.range(3, 6.5);
                if (this.canPlace(px, pz, rr * 0.9, "solid")) this.addRock(px, pz, rr, r.range(2.5, 6));
            }
        }
        // посёлки
        const villages = this.mode === "domination" ? [this.points[1], this.points[r() < 0.5 ? 0 : 2]] : [{ x: S / 2, z: S / 2, r: 18 }];
        for (const v of villages) {
            for (let k = 0; k < 16; k++) {
                const a = r() * TAU, d = r.range(v.r + 10, v.r + 46);
                const hl = r.range(3.5, 6), hw = r.range(3, 5);
                this.tryBuilding(v.x + Math.cos(a) * d, v.z + Math.sin(a) * d, r() < 0.5 ? 0 : Math.PI / 2, hl, hw, r.range(3.2, 5), "flat", "adobe");
            }
            this.scatterTrees(v.x, v.z, v.r + 40, 10, "palm");
            for (let k = 0; k < 4; k++) {
                const a = r() * TAU, d = r.range(v.r + 8, v.r + 30);
                const x = v.x + Math.cos(a) * d, z = v.z + Math.sin(a) * d;
                this.fenceLine(x, z, x + Math.cos(a + 1.5) * 16, z + Math.sin(a + 1.5) * 16);
            }
        }
        for (let i = 0; i < 40; i++) this.scatterBushes(r.range(0.05, 0.95) * S, r.range(0.05, 0.95) * S, 8, r.int(1, 4));
        for (let i = 0; i < 16; i++) {
            const x = r.range(0.06, 0.94) * S, z = r.range(0.08, 0.92) * S, rr = r.range(1.3, 2.6);
            if (this.canPlace(x, z, rr, "solid")) this.addRock(x, z, rr, rr * 0.8);
        }
        for (const p of this.points) this.scatterBushes(p.x, p.z, p.r + 16, 7);
    }

    /* ───────────────────── Полигон ───────────────────── */
    genRange() {
        const S = this.S, r = this.rng;
        this.makeRoad([[S / 2, S + 10], [S / 2, -10]], 7);
        for (let i = 0; i < 6; i++) this.addRock(r.range(0.1, 0.25) * S, r.range(0.2, 0.8) * S, r.range(2, 4), r.range(2, 3.5));
        for (let i = 0; i < 6; i++) this.addRock(r.range(0.75, 0.9) * S, r.range(0.2, 0.8) * S, r.range(2, 4), r.range(2, 3.5));
        this.treeLine(20, 20, S - 20, 20, this.biome.treeKind, 0.05);
        this.treeLine(15, 30, 15, S - 30, this.biome.treeKind, 0.1);
        this.treeLine(S - 15, 30, S - 15, S - 30, this.biome.treeKind, 0.1);
        for (let i = 0; i < 10; i++) this.scatterBushes(r.range(0.05, 0.95) * S, r.range(0.1, 0.9) * S, 5, 2);
    }

    /* ───────────────────── Пространственный хеш ───────────────────── */
    buildSpatial() {
        this.bn = Math.ceil(this.S / BUCKET) + 1;
        this.buckets = new Array(this.bn * this.bn);
        for (let i = 0; i < this.buckets.length; i++) this.buckets[i] = [];
        const add = (o, type, r) => {
            const i0 = clamp(Math.floor((o.x - r) / BUCKET), 0, this.bn - 1), i1 = clamp(Math.floor((o.x + r) / BUCKET), 0, this.bn - 1);
            const j0 = clamp(Math.floor((o.z - r) / BUCKET), 0, this.bn - 1), j1 = clamp(Math.floor((o.z + r) / BUCKET), 0, this.bn - 1);
            const e = { o, type };
            for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) this.buckets[j * this.bn + i].push(e);
        };
        for (const b of this.buildings) add(b, "building", Math.hypot(b.hl, b.hw));
        for (const o of this.rocks) add(o, "rock", o.r);
        for (const t of this.trees) add(t, "tree", t.r);
        for (const f of this.fences) add(f, "fence", f.hl + 0.5);
        for (const hy of this.hay) add(hy, "hay", hy.r);
        for (const bu of this.bushes) add(bu, "bush", bu.r);
        for (const w of this.water) add(w, "water", w.r);
        for (const hg of this.hedges) add(hg, "hedge", hg.hl + 1);
        this._addSpatial = add;
    }

    addWreck(v) {
        const o = { x: v.x, z: v.z, a: v.a, hl: v.def.dims.L / 2, hw: v.def.dims.W / 2, h: v.def.dims.H + (v.deathCause === "ammo" ? 0 : v.def.turret.h), v };
        this.wrecks.push(o);
        this._addSpatial(o, "wreck", Math.hypot(o.hl, o.hw));
        this.markNavObb(o, 2.4);
    }

    removeWreckOf(v) {
        const i = this.wrecks.findIndex((w) => w.v === v);
        if (i < 0) return;
        const o = this.wrecks[i];
        this.wrecks.splice(i, 1);
        for (const b of this.buckets) {
            const k = b.findIndex((e) => e.o === o);
            if (k >= 0) b.splice(k, 1);
        }
    }

    query(x, z, r) {
        const out = [];
        const i0 = clamp(Math.floor((x - r) / BUCKET), 0, this.bn - 1), i1 = clamp(Math.floor((x + r) / BUCKET), 0, this.bn - 1);
        const j0 = clamp(Math.floor((z - r) / BUCKET), 0, this.bn - 1), j1 = clamp(Math.floor((z + r) / BUCKET), 0, this.bn - 1);
        const seen = new Set();
        for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
            for (const e of this.buckets[j * this.bn + i]) {
                if (seen.has(e.o)) continue;
                seen.add(e.o);
                out.push(e);
            }
        }
        return out;
    }

    /** Объекты в прямоугольнике вокруг отрезка */
    querySeg(x1, z1, x2, z2, pad = 4) {
        const minx = Math.min(x1, x2) - pad, maxx = Math.max(x1, x2) + pad;
        const minz = Math.min(z1, z2) - pad, maxz = Math.max(z1, z2) + pad;
        return this.query((minx + maxx) / 2, (minz + maxz) / 2, Math.max(maxx - minx, maxz - minz) / 2);
    }

    /* ───────────────────── Видимость ───────────────────── */
    /** Прямая видимость между точками (здания, скалы, стога, кроны деревьев) */
    los(x1, z1, x2, z2, ignoreWreckOf) {
        const cand = this.querySeg(x1, z1, x2, z2, 6);
        let trees = 0;
        for (const e of cand) {
            const o = e.o;
            switch (e.type) {
                case "building": if (segObb(x1, z1, x2, z2, o) >= 0) return false; break;
                case "rock": if (o.h > 1.6 && segCircle(x1, z1, x2, z2, o.x, o.z, o.r * 0.85) >= 0) return false; break;
                case "hay": if (o.alive && segCircle(x1, z1, x2, z2, o.x, o.z, o.r) >= 0) return false; break;
                case "hedge": if (o.alive && segObb(x1, z1, x2, z2, o) >= 0) {
                    // изгородь вплотную к наблюдателю не мешает выглянуть
                    const d1 = Math.hypot(o.x - x1, o.z - z1), d2 = Math.hypot(o.x - x2, o.z - z2);
                    if (d1 > o.hl + 3 && d2 > o.hl + 3) return false;
                } break;
                case "tree": if (o.alive && !o.fallen && segCircle(x1, z1, x2, z2, o.x, o.z, o.r * 0.55) >= 0) { trees++; if (trees >= 2) return false; } break;
                case "wreck": if (o.v !== ignoreWreckOf && segObb(x1, z1, x2, z2, o) >= 0 && o.h > 1.7) { /* обломки не мешают видеть */ } break;
            }
        }
        return true;
    }

    /** Насколько машина скрыта растительностью: 0..1 */
    concealment(x, z, r) {
        let c = 0;
        for (const e of this.query(x, z, r + 4)) {
            const o = e.o;
            if (e.type === "bush") {
                if (Math.hypot(o.x - x, o.z - z) < o.r + r * 0.7) c += 0.55;
            } else if (e.type === "tree" && o.alive && !o.fallen) {
                if (Math.hypot(o.x - x, o.z - z) < o.r + r * 0.4) c += 0.45;
            } else if (e.type === "hay" && o.alive) {
                if (Math.hypot(o.x - x, o.z - z) < o.r + r * 0.8) c += 0.35;
            } else if (e.type === "hedge" && o.alive) {
                if (ptInObb(x, z, o, r + 1.2)) c += 0.6;
            }
        }
        return Math.min(1, c);
    }

    /* ───────────────────── Разрушения ───────────────────── */
    knockTree(t, ang) {
        if (!t.alive || t.fallen) return;
        t.fallen = true;
        t.fallA = ang;
        Events.emit("worldChange", { type: "tree", o: t });
    }
    breakFence(f) {
        if (!f.alive) return;
        f.alive = false;
        Events.emit("worldChange", { type: "fence", o: f });
    }
    breakHay(hy) {
        if (!hy.alive) return;
        hy.alive = false;
        Events.emit("worldChange", { type: "hay", o: hy });
    }
    breakHedge(o) {
        if (!o.alive) return;
        o.alive = false;
        this.markNavObbCost(o, 1.5, 0);
        Events.emit("worldChange", { type: "hedge", o });
    }
    blastObstacles(x, z, R) {
        for (const e of this.query(x, z, R + 2)) {
            const o = e.o;
            const d = Math.hypot(o.x - x, o.z - z);
            if (e.type === "hedge" && o.alive && R > 2.6 && d < R * 0.55 + o.hl * 0.5) { this.breakHedge(o); continue; }
            if (e.type === "fence" && o.alive && d < R + o.hl) this.breakFence(o);
            else if (e.type === "hay" && o.alive && d < R + o.r) this.breakHay(o);
            else if (e.type === "tree" && R > 2.4 && d < R * 0.6) this.knockTree(o, Math.atan2(o.z - z, o.x - x));
        }
    }

    /* ───────────────────── Навигация ───────────────────── */
    buildNav() {
        const n = Math.ceil(this.S / CELL);
        this.nn = n;
        this.blocked = new Uint8Array(n * n);
        this.cost = new Float32Array(n * n).fill(1);
        for (const b of this.buildings) this.markNavObb(b, 2.6);
        for (const o of this.rocks) this.markNavCircle(o.x, o.z, o.r + 2.4, true);
        for (const t of this.trees) this.markNavCircle(t.x, t.z, 2.2, false, 3);
        for (const f of this.fences) this.markNavCircle(f.x, f.z, 2.5, false, 1.6);
        for (const hy of this.hay) this.markNavCircle(hy.x, hy.z, hy.r + 1.5, false, 1.4);
        for (const w of this.water) this.markNavCircle(w.x, w.z, w.r + 2.2, true);
        for (const c of this.bridges) if (c.kind === "ford") this.markNavCircle(c.x, c.z, c.hw, false, 1.8);
        for (const hg of this.hedges) this.markNavObbCost(hg, 1.5, 4);
        // края карты
        for (let i = 0; i < n; i++) {
            for (const j of [0, n - 1]) { this.blocked[j * n + i] = 1; this.blocked[i * n + j] = 1; }
        }
    }

    markNavCircle(x, z, r, block, cost = 1) {
        const n = this.nn;
        const i0 = clamp(Math.floor((x - r) / CELL), 0, n - 1), i1 = clamp(Math.floor((x + r) / CELL), 0, n - 1);
        const j0 = clamp(Math.floor((z - r) / CELL), 0, n - 1), j1 = clamp(Math.floor((z + r) / CELL), 0, n - 1);
        for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
            const cx = (i + 0.5) * CELL, cz = (j + 0.5) * CELL;
            if (Math.hypot(cx - x, cz - z) > r) continue;
            if (block) this.blocked[j * n + i] = 1;
            else this.cost[j * n + i] = Math.max(this.cost[j * n + i], cost);
        }
    }

    markNavObb(b, pad) {
        const n = this.nn;
        const R = Math.hypot(b.hl, b.hw) + pad;
        const i0 = clamp(Math.floor((b.x - R) / CELL), 0, n - 1), i1 = clamp(Math.floor((b.x + R) / CELL), 0, n - 1);
        const j0 = clamp(Math.floor((b.z - R) / CELL), 0, n - 1), j1 = clamp(Math.floor((b.z + R) / CELL), 0, n - 1);
        for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
            if (ptInObb((i + 0.5) * CELL, (j + 0.5) * CELL, b, pad)) this.blocked[j * n + i] = 1;
        }
    }

    markNavObbCost(b, pad, cost) {
        const n = this.nn;
        const R = Math.hypot(b.hl, b.hw) + pad;
        const i0 = clamp(Math.floor((b.x - R) / CELL), 0, n - 1), i1 = clamp(Math.floor((b.x + R) / CELL), 0, n - 1);
        const j0 = clamp(Math.floor((b.z - R) / CELL), 0, n - 1), j1 = clamp(Math.floor((b.z + R) / CELL), 0, n - 1);
        for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
            if (ptInObb((i + 0.5) * CELL, (j + 0.5) * CELL, b, pad)) this.cost[j * n + i] = cost > 0 ? Math.max(this.cost[j * n + i], cost) : 1;
        }
    }

    cellOf(x, z) {
        return [clamp(Math.floor(x / CELL), 0, this.nn - 1), clamp(Math.floor(z / CELL), 0, this.nn - 1)];
    }

    isBlocked(x, z) {
        const [i, j] = this.cellOf(x, z);
        return this.blocked[j * this.nn + i] === 1;
    }

    nearestFree(x, z, maxR = 40) {
        if (!this.isBlocked(x, z)) return [x, z];
        for (let r = CELL; r <= maxR; r += CELL) {
            for (let k = 0; k < 16; k++) {
                const a = (k / 16) * TAU;
                const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
                if (px > 5 && pz > 5 && px < this.S - 5 && pz < this.S - 5 && !this.isBlocked(px, pz)) return [px, pz];
            }
        }
        return [x, z];
    }

    /** Проходимость прямой (для сглаживания пути) */
    walkLine(x1, z1, x2, z2) {
        const L = Math.hypot(x2 - x1, z2 - z1);
        const n = Math.ceil(L / (CELL * 0.5));
        for (let k = 0; k <= n; k++) {
            const t = k / Math.max(1, n);
            const [i, j] = this.cellOf(x1 + (x2 - x1) * t, z1 + (z2 - z1) * t);
            const id = j * this.nn + i;
            if (this.blocked[id] || this.cost[id] > 2.5) return false;
        }
        return true;
    }

    /** A* по сетке. Возвращает массив точек [[x,z],...] или null */
    findPath(x1, z1, x2, z2) {
        const n = this.nn;
        let [si, sj] = this.cellOf(x1, z1);
        const [fx, fz] = this.nearestFree(x2, z2);
        const [gi, gj] = this.cellOf(fx, fz);
        if (this.blocked[sj * n + si]) {
            const [ax, az] = this.nearestFree(x1, z1, 16);
            [si, sj] = this.cellOf(ax, az);
        }
        const start = sj * n + si, goal = gj * n + gi;
        if (start === goal) return [[fx, fz]];
        const g = new Float32Array(n * n).fill(Infinity);
        const came = new Int32Array(n * n).fill(-1);
        const closed = new Uint8Array(n * n);
        const heap = new MinHeap();
        g[start] = 0;
        const hf = (id) => {
            const dx = Math.abs((id % n) - gi), dz = Math.abs(Math.floor(id / n) - gj);
            return (dx + dz) + (Math.SQRT2 - 2) * Math.min(dx, dz);
        };
        heap.push(start, hf(start));
        let found = false, iter = 0;
        while (heap.size && iter++ < 30000) {
            const cur = heap.pop();
            if (cur === goal) { found = true; break; }
            if (closed[cur]) continue;
            closed[cur] = 1;
            const ci = cur % n, cj = Math.floor(cur / n);
            for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
                if (!di && !dj) continue;
                const ni = ci + di, nj = cj + dj;
                if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
                const nid = nj * n + ni;
                if (this.blocked[nid] || closed[nid]) continue;
                if (di && dj && (this.blocked[cj * n + ni] || this.blocked[nj * n + ci])) continue;
                const step = (di && dj ? Math.SQRT2 : 1) * this.cost[nid];
                const ng = g[cur] + step;
                if (ng < g[nid]) {
                    g[nid] = ng;
                    came[nid] = cur;
                    heap.push(nid, ng + hf(nid));
                }
            }
        }
        if (!found) return null;
        const cells = [];
        for (let c = goal; c !== -1 && c !== start; c = came[c]) cells.push(c);
        cells.reverse();
        const pts = cells.map((c) => [(c % n + 0.5) * CELL, (Math.floor(c / n) + 0.5) * CELL]);
        pts[pts.length - 1] = [fx, fz];
        // сглаживание «натягиванием нити»
        const out = [];
        let ax = x1, az = z1, k = 0;
        while (k < pts.length) {
            let far = k;
            for (let m = pts.length - 1; m > k; m--) {
                if (this.walkLine(ax, az, pts[m][0], pts[m][1])) { far = m; break; }
            }
            out.push(pts[far]);
            ax = pts[far][0]; az = pts[far][1];
            k = far + 1;
        }
        return out;
    }
}

function segInt(ax, az, bx, bz, cx, cz, dx, dz) {
    const r1x = bx - ax, r1z = bz - az, r2x = dx - cx, r2z = dz - cz;
    const den = r1x * r2z - r1z * r2x;
    if (Math.abs(den) < 1e-9) return null;
    const t = ((cx - ax) * r2z - (cz - az) * r2x) / den;
    const u = ((cx - ax) * r1z - (cz - az) * r1x) / den;
    if (t < 0 || t > 1 || u < 0 || u > 1) return null;
    return [ax + r1x * t, az + r1z * t];
}

class MinHeap {
    constructor() { this.ids = []; this.pr = []; }
    get size() { return this.ids.length; }
    push(id, p) {
        const a = this.ids, q = this.pr;
        a.push(id); q.push(p);
        let i = a.length - 1;
        while (i > 0) {
            const par = (i - 1) >> 1;
            if (q[par] <= q[i]) break;
            [a[par], a[i]] = [a[i], a[par]];
            [q[par], q[i]] = [q[i], q[par]];
            i = par;
        }
    }
    pop() {
        const a = this.ids, q = this.pr;
        const top = a[0];
        const lastId = a.pop(), lastP = q.pop();
        if (a.length) {
            a[0] = lastId; q[0] = lastP;
            let i = 0;
            for (;;) {
                const l = 2 * i + 1, r = l + 1;
                let m = i;
                if (l < a.length && q[l] < q[m]) m = l;
                if (r < a.length && q[r] < q[m]) m = r;
                if (m === i) break;
                [a[m], a[i]] = [a[i], a[m]];
                [q[m], q[i]] = [q[i], q[m]];
                i = m;
            }
        }
        return top;
    }
}

/** Столкновение машины с препятствиями мира. Возвращает суммарный вектор выталкивания */
export function collideStatic(world, v, obb, dt) {
    let px = 0, pz = 0, hit = false;
    for (const e of world.query(obb.x, obb.z, Math.hypot(obb.hl, obb.hw) + 4)) {
        const o = e.o;
        if (e.type === "building" || (e.type === "wreck" && o.v !== v)) {
            const box = { x: obb.x + px, z: obb.z + pz, a: obb.a, hl: obb.hl, hw: obb.hw };
            const m = obbObbLocal(box, o);
            if (m) { px += m.x; pz += m.z; hit = true; }
        } else if (e.type === "rock" || e.type === "water") {
            const m = circleObb(o.x, o.z, e.type === "water" ? o.r : o.r * 0.9, { x: obb.x + px, z: obb.z + pz, a: obb.a, hl: obb.hl, hw: obb.hw });
            if (m) { px -= m.x; pz -= m.z; hit = true; }
        } else if (e.type === "tree" && o.alive && !o.fallen) {
            const m = circleObb(o.x, o.z, o.trunk + 0.2, { x: obb.x + px, z: obb.z + pz, a: obb.a, hl: obb.hl, hw: obb.hw });
            if (m) {
                if (v.def.mob.mass > 8 && Math.abs(v.v) > 1.2) world.knockTree(o, v.a + (v.v < 0 ? Math.PI : 0));
                else { px -= m.x; pz -= m.z; hit = true; }
            }
        } else if (e.type === "fence" && o.alive) {
            if (ptInObb(o.x, o.z, { x: obb.x, z: obb.z, a: obb.a, hl: obb.hl + 0.3, hw: obb.hw + 0.3 })) world.breakFence(o);
        } else if (e.type === "hay" && o.alive) {
            if (circleObb(o.x, o.z, o.r * 0.8, obb)) world.breakHay(o);
        } else if (e.type === "hedge" && o.alive) {
            if (obbObbLocal(obb, o)) {
                v.inHedge = 2;
                if (Math.abs(v.v) > 0.4) {
                    o.wear += (dt || 1 / 60) * (0.6 + v.def.mob.mass / 40);
                    if (o.wear > 1.4) world.breakHedge(o);
                }
            }
        }
    }
    return hit ? { x: px, z: pz } : null;
}

import { obbObb as obbObbLocal } from "../core/Utils.js";
