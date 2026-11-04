/**
 * Перенос детальной модели (spec из js/data/models/*Spec.js) в игровое описание машины:
 * броневые листы → выпуклые детали попадания, модули → коробки повреждений, экипаж → места.
 *
 * Модель: +Z нос, +Y верх, +X левый борт. Игра: +X нос, +Y верх, +Z правый борт.
 * Каждый лист становится призмой (наружная грань, внутренняя, торцы) со своей толщиной;
 * вогнутые листы разбиваются на треугольники.
 */
const toGame = ([x, y, z]) => [z, y, -x];

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const neg = (a) => [-a[0], -a[1], -a[2]];
const centroid = (pts) => pts.reduce((s, p) => [s[0] + p[0] / pts.length, s[1] + p[1] / pts.length, s[2] + p[2] / pts.length], [0, 0, 0]);

/** Нормаль многоугольника по Ньюэллу, направленная от точки interior наружу */
function outerNormal(pts, interior) {
    let n = [0, 0, 0];
    for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        n[0] += (a[1] - b[1]) * (a[2] + b[2]);
        n[1] += (a[2] - b[2]) * (a[0] + b[0]);
        n[2] += (a[0] - b[0]) * (a[1] + b[1]);
    }
    n = norm(n);
    if (dot(n, sub(centroid(pts), interior)) < 0) n = neg(n);
    return n;
}

const area2 = (p) => { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return s; };
const turn = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

function isConvex(p) {
    let sign = 0;
    for (let i = 0; i < p.length; i++) {
        const t = turn(p[i], p[(i + 1) % p.length], p[(i + 2) % p.length]);
        if (Math.abs(t) < 1e-9) continue;
        if (sign && Math.sign(t) !== sign) return false;
        sign = Math.sign(t);
    }
    return true;
}

/** Разбиение простого многоугольника на треугольники «отрезанием ушей» (индексы вершин) */
function earClip(p) {
    const idx = p.map((_, i) => i);
    if (area2(p) < 0) idx.reverse();
    const out = [];
    const inside = (q, a, b, c) => turn(a, b, q) >= -1e-12 && turn(b, c, q) >= -1e-12 && turn(c, a, q) >= -1e-12;
    let guard = 0;
    while (idx.length > 3 && guard++ < 500) {
        let cut = false;
        for (let k = 0; k < idx.length; k++) {
            const i0 = idx[(k + idx.length - 1) % idx.length], i1 = idx[k], i2 = idx[(k + 1) % idx.length];
            const a = p[i0], b = p[i1], c = p[i2];
            if (turn(a, b, c) <= 1e-12) continue;
            if (idx.some((j) => j !== i0 && j !== i1 && j !== i2 && inside(p[j], a, b, c))) continue;
            out.push([i0, i1, i2]);
            idx.splice(k, 1);
            cut = true;
            break;
        }
        if (!cut) break;
    }
    if (idx.length === 3) out.push(idx.slice());
    return out;
}

/** Плоскости призмы листа: наружная грань (main), внутренняя (inner), торцы (edge) */
function prismPlanes(poly, n, t, zone) {
    const d0 = dot(n, poly[0]);
    const planes = [
        { n, d: d0, face: zone, main: true },
        { n: neg(n), d: -(d0 - t), face: "inner" },
    ];
    const cen = centroid(poly);
    for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        let en = norm(cross(sub(b, a), n));
        if (dot(en, sub(cen, a)) > 0) en = neg(en);
        planes.push({ n: en, d: dot(en, a), face: zone, edge: true });
    }
    return planes;
}

/** Лист (координаты игры) → список наборов плоскостей выпуклых кусков */
export function platePieces(pts, t, interior, zone) {
    const n = outerNormal(pts, interior);
    const o = pts[0];
    let u = sub(pts[1], o);
    u = norm(sub(u, n.map((x) => x * dot(u, n))));
    const w = cross(n, u);
    const p2 = pts.map((p) => [dot(sub(p, o), u), dot(sub(p, o), w)]);
    const pieces = isConvex(p2) ? [pts.map((_, i) => i)] : earClip(p2);
    return pieces.map((ids) => prismPlanes(ids.map((i) => pts[i]), n, t, zone));
}

/** AABB фигур модуля в координатах игры */
function shapesBox(shapes) {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    const grow = (p) => { const g = toGame(p); for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], g[k]); max[k] = Math.max(max[k], g[k]); } };
    for (const s of shapes) {
        if (s[0] === "box") {
            const [, w, h, d, x, y, z, rx, ry, rz] = s;
            for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
                let p = [sx * w / 2, sy * h / 2, sz * d / 2];
                // Euler «XYZ» в three.js: вектор поворачивается сначала вокруг Z, затем Y, затем X
                p = rotZ(p, rz); p = rotY(p, ry); p = rotX(p, rx);
                grow([p[0] + x, p[1] + y, p[2] + z]);
            }
        } else {
            const [, r, len, axis, x, y, z] = s;
            const e = { x: [len / 2, r, r], y: [r, len / 2, r], z: [r, r, len / 2] }[axis];
            for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) grow([x + sx * e[0], y + sy * e[1], z + sz * e[2]]);
        }
    }
    return { min, max, c: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2] };
}
const rotX = ([x, y, z], a) => (a ? [x, y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)] : [x, y, z]);
const rotY = ([x, y, z], a) => (a ? [x * Math.cos(a) + z * Math.sin(a), y, -x * Math.sin(a) + z * Math.cos(a)] : [x, y, z]);
const rotZ = ([x, y, z], a) => (a ? [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a), z] : [x, y, z]);

/**
 * Заполняет def.parts / def.modules / def.seats и размеры орудия по детальной модели.
 * moduleNames — игровые названия типов модулей (MODULE_NAMES).
 */
export function applyModel(def, spec, moduleNames) {
    const Z = spec.zones, H = spec.H, T = spec.TRACK;
    const plateOf = (zone) => ({ zone, mm: Z[zone].mm, name: Z[zone].g, est: !!Z[zone].est });

    /* детали попадания */
    const parts = [];
    for (const P of spec.plates()) {
        if (P.spaced) continue;
        const plate = plateOf(P.zone);
        const id = P.parent === "hull" ? "hull" : "turret";
        for (const planes of platePieces(P.pts.map(toGame), P.mm / 1000, toGame(P.interior), P.zone)) {
            parts.push({ id, frame: P.parent, kind: "convex", plate, planes });
        }
    }
    // днище с ходовой между гусеницами — снаряд не проходит под корпусом
    parts.push({
        id: "hull", frame: "hull", kind: "box", min: [H.rearBottomZ, 0.04, -H.halfLow], max: [H.noseBottomZ, H.bottom, H.halfLow],
        plates: { side: plateOf("hull.side.lower"), front: plateOf("hull.front.lower"), rear: plateOf("hull.rear.lower"), bottom: plateOf("hull.bottom.front"), roof: plateOf("hull.bottom.front") },
    });

    /* модули */
    const mods = [];
    const tx0 = spec.SPROCKET.z - spec.SPROCKET.r - 0.04, tx1 = spec.IDLER.z + spec.IDLER.r + 0.04;
    const z0 = T.x - T.width / 2, z1 = T.x + T.width / 2;
    for (const [id, zmin, zmax] of [["trackL", -z1, -z0], ["trackR", z0, z1]]) {
        const m = { id, type: "track", frame: "hull", shape: "box", min: [tx0, 0, zmin], max: [tx1, T.top, zmax], maxHp: 90 };
        m.c = [(tx0 + tx1) / 2, T.top / 2, (zmin + zmax) / 2];
        mods.push(m);
        parts.push({ id, frame: "hull", kind: "box", min: m.min, max: m.max, module: id, spaced: 20 });
    }
    const B = spec.barrel;
    const barrel = { id: "barrel", type: "barrel", frame: "gun", shape: "box", min: [B.z0, -B.r, -B.r], max: [B.z1, B.r, B.r], c: [(B.z0 + B.z1) / 2, 0, 0], maxHp: 60 };
    mods.push(barrel);
    parts.push({ id: "barrel", frame: "gun", kind: "box", min: barrel.min, max: barrel.max, module: "barrel" });
    for (const M of spec.modules) {
        const g = M.game;
        if (!g) continue;
        const box = shapesBox(M.hitShapes || M.shapes);
        mods.push({
            id: g.id, type: g.type, frame: M.parent, shape: "box", ...box, maxHp: g.hp,
            name: moduleNames[g.type] || M.name, full: M.name, aux: !!g.aux, rounds: g.rounds, order: g.order,
        });
    }

    /* экипаж: центр корпуса на 0,3 м выше таза */
    const seats = {};
    for (const C of spec.crew) {
        if (!def.crew.includes(C.id)) continue;
        seats[C.id] = { frame: C.parent, c: toGame([C.pos[0], C.pos[1] + 0.30, C.pos[2]]), r: 0.3 };
    }

    /* башня в плане (для схем) и орудие */
    const outline = [];
    for (const [z, y] of spec.turretProfile) {
        const hw = spec.turretHalfWidth(y);
        outline.push([z, hw], [z, -hw]);
    }

    def.parts = parts;
    def.modules = mods;
    def.seats = seats;
    def.turretOutline = outline;
    def.gunPivot = toGame(spec.gunPivot);
    def.gun.len = spec.muzzle;
    def.muzzleY = def.dims.H + def.gunPivot[1];
    def.detailed = spec.id;
}
