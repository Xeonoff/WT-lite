/**
 * КВ-1 обр. 1941 г. (сварная башня, 76-мм пушка ЗИС-5) — детальная процедурная модель для three.js.
 * Геометрия брони, модулей и экипажа берётся из js/data/models/KV1Spec.js — того же описания,
 * по которому симуляция считает попадания.
 *
 * Система координат: 1 ед. = 1 м; +Z — нос, +Y — вверх, +X — левый борт; начало — центр танка на грунте.
 * Иерархия:  KV-1 › hull › turret (поворот вокруг Y) › gun (качание вокруг X)
 * Слои (userData.kind): armor | detail | running | module | crew
 */
import * as THREE from "three";
import {
    KV1_DIMENSIONS, ARMOR_ZONES, MODULE_CATEGORIES, CREW_ROLES, COMPARTMENTS, H, TRACK, ROAD, IDLER, SPROCKET, RETURN,
    GUN_PIVOT, TURRET_PROFILE, turretHalfWidth, armorPlates, MODULES, CREW, POSES,
} from "../../data/models/KV1Spec.js";

export { KV1_DIMENSIONS, ARMOR_ZONES, MODULE_CATEGORIES, CREW_ROLES, COMPARTMENTS };

const DEG = Math.PI / 180;
const MM = 0.001;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const V3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);

const ARMOR_RAMP = [[20, "#3b5ba5"], [30, "#3a8bc0"], [40, "#35ab9a"], [60, "#a9c23c"], [75, "#f0a02e"], [90, "#dc5236"], [100, "#9e1f3c"]];
export const ARMOR_RAMP_STOPS = ARMOR_RAMP;

/** Цвет листа по толщине (мм) */
export function armorColor(mm) {
    const r = ARMOR_RAMP;
    if (mm <= r[0][0]) return new THREE.Color(r[0][1]);
    for (let i = 1; i < r.length; i++) {
        if (mm <= r[i][0]) {
            const t = (mm - r[i - 1][0]) / (r[i][0] - r[i - 1][0]);
            return new THREE.Color(r[i - 1][1]).lerp(new THREE.Color(r[i][1]), t);
        }
    }
    return new THREE.Color(r[r.length - 1][1]);
}

/* ───────────────────────── Геометрические утилиты ───────────────────────── */

function planeFrame(pts, interior) {
    const n = new THREE.Vector3();
    for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        n.x += (a.y - b.y) * (a.z + b.z);
        n.y += (a.z - b.z) * (a.x + b.x);
        n.z += (a.x - b.x) * (a.y + b.y);
    }
    n.normalize();
    const c = pts.reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(1 / pts.length);
    if (n.dot(c.clone().sub(interior)) < 0) n.negate();
    const o = pts[0].clone();
    const u = pts[1].clone().sub(o);
    u.sub(n.clone().multiplyScalar(u.dot(n))).normalize();
    const v = new THREE.Vector3().crossVectors(n, u);
    return { o, u, v, n, c };
}

const to2D = (p, f) => { const d = p.clone().sub(f.o); return new THREE.Vector2(d.dot(f.u), d.dot(f.v)); };

/** Плоский лист: внешняя грань — полигон pts, толщина t уходит внутрь (к точке interior). */
function plateGeometry(pts, t, interior, holes = []) {
    const f = planeFrame(pts, interior);
    const shape = new THREE.Shape(pts.map((p) => to2D(p, f)));
    for (const h of holes) shape.holes.push(new THREE.Path(h.map((p) => to2D(p, f))));
    const g = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: 1 });
    g.translate(0, 0, -t);
    g.applyMatrix4(new THREE.Matrix4().makeBasis(f.u, f.v, f.n).setPosition(f.o));
    return { geometry: g, frame: f };
}

function circle3D(cx, y, cz, r, n = 48) {
    const out = [];
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; out.push(V(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r)); }
    return out;
}

/** Слияние геометрий (без индексов; position / normal / uv / color) */
export function mergeGeometries(list) {
    const prepared = list.map((g) => {
        const n = g.index ? g.toNonIndexed() : g;
        if (!n.attributes.normal) n.computeVertexNormals();
        if (!n.attributes.uv) n.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
        return n;
    });
    const withColor = prepared.some((g) => g.attributes.color);
    const names = ["position", "normal", "uv"].concat(withColor ? ["color"] : []);
    const out = new THREE.BufferGeometry();
    for (const name of names) {
        const size = name === "uv" ? 2 : 3;
        let total = 0;
        for (const g of prepared) total += g.attributes.position.count * size;
        const arr = new Float32Array(total);
        let off = 0;
        for (const g of prepared) {
            const a = g.attributes[name];
            const cnt = g.attributes.position.count * size;
            if (a) arr.set(a.array.subarray(0, cnt), off);
            else if (name === "color") arr.fill(1, off, off + cnt);
            off += cnt;
        }
        out.setAttribute(name, new THREE.BufferAttribute(arr, size));
    }
    return out;
}
const merge = mergeGeometries;

function cylGeo(r, len, axis = "y", seg = 20, r2 = r, open = false) {
    const g = new THREE.CylinderGeometry(r2, r, len, seg, 1, open);
    if (axis === "x") g.rotateZ(-Math.PI / 2);
    if (axis === "z") g.rotateX(Math.PI / 2);
    return g;
}

function colorize(g, hex) {
    const c = new THREE.Color(hex);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
    g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
    return g;
}

/** Капсула между двумя точками (для фигур экипажа). */
function limb(a, b, r, mat) {
    const d = b.clone().sub(a);
    const len = Math.max(0.001, d.length() - 2 * r);
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), mat);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(V(0, 1, 0), d.normalize());
    return m;
}

/* ───────────────────────── Ходовая часть: геометрия ───────────────────────── */

function wheelDiscProfile(R, w, dish) {
    const h = w / 2;
    return [
        [0.001, -h * 0.55], [0.07, -h * 0.55], [0.075, -h * 0.25], [R * 0.72, -h * dish], [R * 0.84, -h * 0.85],
        [R * 0.86, -h], [R, -h], [R, h], [R * 0.86, h], [R * 0.84, h * 0.85], [R * 0.72, h * dish],
        [0.075, h * 0.25], [0.07, h * 0.55], [0.001, h * 0.55],
    ].map(([x, y]) => new THREE.Vector2(x, y));
}

function spokedDisc(R, w, spokes, x) {
    const parts = [new THREE.LatheGeometry(wheelDiscProfile(R, w, 0.15), 36)];
    for (let i = 0; i < spokes; i++) {
        const a = (i / spokes) * Math.PI * 2;
        for (const side of [-1, 1]) {
            const s = new THREE.BoxGeometry(0.035, R * 0.62, 0.022);
            s.translate(0, R * 0.44, side * w * 0.2);
            s.rotateZ(a);
            parts.push(s.rotateX(Math.PI / 2));
        }
    }
    const g = merge(parts);
    g.rotateZ(Math.PI / 2);
    g.translate(x, 0, 0);
    return g;
}

function roadWheelGeometry() {
    const discs = [spokedDisc(ROAD.r, 0.12, 8, 0.17), spokedDisc(ROAD.r, 0.12, 8, -0.17)];
    const axle = cylGeo(0.05, 0.42, "x", 14);
    const capL = cylGeo(0.085, 0.05, "x", 16); capL.translate(0.245, 0, 0);
    const capR = cylGeo(0.085, 0.05, "x", 16); capR.translate(-0.245, 0, 0);
    return merge([...discs, axle, capL, capR]);
}

function idlerGeometry() {
    return merge([spokedDisc(IDLER.r, 0.11, 6, 0.17), spokedDisc(IDLER.r, 0.11, 6, -0.17), cylGeo(0.06, 0.46, "x", 14)]);
}

function sprocketGeometry() {
    const parts = [];
    for (const x of [0.13, -0.13]) {
        const disc = new THREE.LatheGeometry(wheelDiscProfile(SPROCKET.r - 0.03, 0.06, 0.4), 32);
        disc.rotateZ(Math.PI / 2); disc.translate(x, 0, 0); parts.push(disc);
        const teeth = 12;
        for (let i = 0; i < teeth; i++) {
            const a = (i / teeth) * Math.PI * 2;
            const t = new THREE.BoxGeometry(0.06, 0.075, 0.07);
            t.translate(0, SPROCKET.r - 0.005, 0);
            t.rotateX(a); t.translate(x, 0, 0);
            parts.push(t);
        }
    }
    const hub = cylGeo(0.16, 0.36, "x", 20);
    const cap = cylGeo(0.11, 0.08, "x", 18); cap.translate(0.22, 0, 0);
    const cap2 = cap.clone(); cap2.translate(-0.44, 0, 0);
    parts.push(hub, cap, cap2);
    return merge(parts);
}

function returnRollerGeometry() {
    return merge([cylGeo(RETURN.r, 0.30, "x", 22), cylGeo(0.06, 0.36, "x", 14)]);
}

function trackLinkGeometry() {
    const plate = new THREE.BoxGeometry(TRACK.width, 0.035, 0.145); plate.translate(0, -0.0175, 0);
    const grouser = new THREE.BoxGeometry(TRACK.width * 0.94, 0.012, 0.035); grouser.translate(0, -0.041, 0.02);
    const horn = new THREE.BoxGeometry(0.05, 0.075, 0.085); horn.translate(0, 0.037, -0.005);
    const pin = cylGeo(0.017, TRACK.width + 0.02, "x", 8); pin.translate(0, -0.017, 0.072);
    const ribL = new THREE.BoxGeometry(0.04, 0.012, 0.14); ribL.translate(0.22, 0.004, 0);
    const ribR = ribL.clone(); ribR.translate(-0.44, 0, 0);
    return merge([plate, grouser, horn, pin, ribL, ribR]);
}

/** Путь ленты вокруг набора окружностей (обход против часовой стрелки в плоскости Z–Y). */
function buildBeltPath(circles) {
    const n = circles.length;
    const tan = [];
    for (let i = 0; i < n; i++) {
        const a = circles[i], b = circles[(i + 1) % n];
        const dz = b.z - a.z, dy = b.y - a.y, L = Math.hypot(dz, dy);
        const phi = Math.atan2(dy, dz);
        const beta = -Math.acos(THREE.MathUtils.clamp((a.r - b.r) / L, -1, 1));
        const nz = Math.cos(phi + beta), ny = Math.sin(phi + beta);
        tan.push({ p1: [a.z + a.r * nz, a.y + a.r * ny], p2: [b.z + b.r * nz, b.y + b.r * ny], ang: Math.atan2(ny, nz) });
    }
    const segs = [];
    let total = 0;
    for (let i = 0; i < n; i++) {
        const t = tan[i];
        const len = Math.hypot(t.p2[0] - t.p1[0], t.p2[1] - t.p1[1]);
        segs.push({ type: "line", a: t.p1, b: t.p2, len, s0: total }); total += len;
        const c = circles[(i + 1) % n];
        const a0 = t.ang, a1 = tan[(i + 1) % n].ang;
        let d = ((a1 - a0) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
        if (d > Math.PI * 2 - 1e-5) d = 0;
        const alen = d * c.r;
        if (alen > 1e-6) { segs.push({ type: "arc", c, a0, d, len: alen, s0: total }); total += alen; }
    }
    function at(s) {
        s = ((s % total) + total) % total;
        let lo = 0, hi = segs.length - 1;
        while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (segs[mid].s0 <= s) lo = mid; else hi = mid - 1; }
        const g = segs[lo], u = (s - g.s0) / g.len;
        if (g.type === "line") {
            const dz = g.b[0] - g.a[0], dy = g.b[1] - g.a[1];
            return { z: g.a[0] + dz * u, y: g.a[1] + dy * u, dz, dy };
        }
        const a = g.a0 + g.d * u;
        return { z: g.c.z + g.c.r * Math.cos(a), y: g.c.y + g.c.r * Math.sin(a), dz: -Math.sin(a), dy: Math.cos(a) };
    }
    return { total, at };
}

const BELT_CIRCLES = [
    { z: SPROCKET.z, y: SPROCKET.y, r: SPROCKET.r },
    ...ROAD.z.map((z) => ({ z, y: ROAD.y, r: ROAD.r })),
    { z: IDLER.z, y: IDLER.y, r: IDLER.r },
    ...[...RETURN.z].reverse().map((z) => ({ z, y: RETURN.y, r: RETURN.r })),
];
export const BELT = buildBeltPath(BELT_CIRCLES);
export const LINK_COUNT = Math.round(BELT.total / TRACK.pitch);
const LINK_PITCH = BELT.total / LINK_COUNT;

const _dummy = new THREE.Object3D();
/** Раскладка траков гусеницы по ленте со сдвигом offset (м) */
export function layoutTrack(tr, offset) {
    const x = tr.userData.side * TRACK.x;
    for (let i = 0; i < LINK_COUNT; i++) {
        const p = BELT.at(i * LINK_PITCH + offset);
        _dummy.position.set(x, p.y, p.z);
        _dummy.rotation.set(Math.atan2(-p.dy, p.dz), 0, 0);
        _dummy.updateMatrix();
        tr.setMatrixAt(i, _dummy.matrix);
    }
    tr.instanceMatrix.needsUpdate = true;
}

/* ───────────────────────── Сборка модели ───────────────────────── */

/**
 * options.paint / options.paintDark — материалы окраски (в игре — камуфляж текущего биома).
 */
export function createKV1(options = {}) {
    const root = new THREE.Group(); root.name = "KV-1";
    const hull = new THREE.Group(); hull.name = "hull"; root.add(hull);
    const turret = new THREE.Group(); turret.name = "turret";
    turret.position.set(0, H.roof, H.turretZ); hull.add(turret);
    const gun = new THREE.Group(); gun.name = "gun"; gun.position.set(...GUN_PIVOT); turret.add(gun);
    const frames = { hull, turret, gun };

    const reg = { armor: [], screens: [], details: [], running: [], tracks: [], modules: [], crew: [], zones: [], wheels: [] };

    const std = (color, rough = 0.7, metal = 0.2, extra = {}) =>
        new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });

    const mats = {
        paint: options.paint || std("#46532f", 0.8, 0.15),
        paintDark: options.paintDark || std("#38432a", 0.82, 0.18),
        steel: std("#5e5b53", 0.55, 0.55),
        darkSteel: std("#33312d", 0.6, 0.5),
        track: std("#3b3833", 0.72, 0.55),
        rubber: std("#1f1f1d", 0.92, 0.0),
        glass: std("#6f8fa3", 0.15, 0.3),
        lamp: std("#d9dcc8", 0.2, 0.4, { emissive: "#353520" }),
        ghost: std("#7d8a6c", 0.8, 0, { transparent: true, opacity: 0.07, depthWrite: false }),
        ghostRunning: std("#5e5b53", 0.7, 0.3, { transparent: true, opacity: 0.22, depthWrite: false }),
        edgeDark: new THREE.LineBasicMaterial({ color: "#1b1f18", transparent: true, opacity: 0.55 }),
        edgeFaint: new THREE.LineBasicMaterial({ color: "#566052", transparent: true, opacity: 0.45, depthWrite: false }),
        rounds: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.8 }),
        skin: new THREE.MeshStandardMaterial({ color: "#c8a084", roughness: 0.8 }),
        helmet: new THREE.MeshStandardMaterial({ color: "#2c2621", roughness: 0.9 }),
    };
    const armorMats = new Map();
    const armorMat = (mm) => {
        if (!armorMats.has(mm)) armorMats.set(mm, std(armorColor(mm), 0.62, 0.05));
        return armorMats.get(mm);
    };
    const modMats = {}, modDim = {};
    for (const [k, c] of Object.entries(MODULE_CATEGORIES)) {
        modMats[k] = new THREE.MeshStandardMaterial({ color: c.color, roughness: 0.5, metalness: 0.15, emissive: c.color, emissiveIntensity: 0.18 });
        modDim[k] = new THREE.MeshStandardMaterial({ color: c.color, roughness: 0.6, transparent: true, opacity: 0.16, depthWrite: false });
    }

    /* ── регистрация объектов ── */
    function plate(parent, zone, pts, mm, interior, opts = {}) {
        const { geometry, frame } = plateGeometry(pts, mm * MM, interior, opts.holes);
        const mesh = new THREE.Mesh(geometry, mats.paint);
        mesh.name = zone;
        mesh.castShadow = mesh.receiveShadow = true;
        const angle = Math.round(Math.asin(Math.min(1, Math.abs(frame.n.y))) / DEG);
        mesh.userData = { kind: "armor", zone, thickness: mm, angle, spaced: !!opts.spaced, baseMat: mats.paint };
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 20), mats.edgeFaint);
        edges.raycast = () => {};
        edges.visible = false;
        edges.userData.kind = "edge";
        mesh.add(edges);
        parent.add(mesh);
        (opts.spaced ? reg.screens : reg.armor).push(mesh);
        return mesh;
    }

    function detail(parent, mesh, label, mat = mats.paint, xray = "hide") {
        mesh.material = mat;
        mesh.castShadow = true; mesh.receiveShadow = true;
        mesh.userData = { ...mesh.userData, kind: "detail", label, baseMat: mat, xray };
        parent.add(mesh);
        reg.details.push(mesh);
        return mesh;
    }
    const dmesh = (geo, x, y, z) => { const m = new THREE.Mesh(geo); m.position.set(x, y, z); return m; };

    function running(parent, mesh, label, mat) {
        mesh.material = mat;
        mesh.castShadow = true; mesh.receiveShadow = true;
        mesh.userData = { kind: "running", label, baseMat: mat };
        parent.add(mesh);
        reg.running.push(mesh);
        return mesh;
    }

    function module(parent, id, cat, name, desc, meshes, placement = "source") {
        const g = new THREE.Group();
        g.name = "module:" + id;
        g.userData = { kind: "module", id, cat, name, desc, placement };
        for (const m of meshes) {
            if (!m.isInstancedMesh) m.material = modMats[cat];
            m.userData.moduleId = id;
            m.userData.baseMat = m.material;
            m.castShadow = false;
            g.add(m);
        }
        g.visible = false;
        parent.add(g);
        reg.modules.push(g);
        return g;
    }
    const shapeMesh = (s) => {
        if (s[0] === "box") {
            const [, w, h, d, x, y, z, rx, ry, rz] = s;
            const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d)); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); return m;
        }
        const [, r, len, axis, x, y, z, seg] = s;
        const m = new THREE.Mesh(cylGeo(r, len, axis, seg)); m.position.set(x, y, z); return m;
    };

    /* ══════════════ БРОНЯ: корпус и башня (общее описание с симуляцией) ══════════════ */
    for (const P of armorPlates()) {
        if (P.mantlet) continue;                 // маску строим гладкой — ниже
        const holes = P.hole ? [circle3D(P.hole.x, H.roof, P.hole.z, P.hole.r, 56)] : [];
        plate(frames[P.parent], P.zone, P.pts.map(V3), P.mm, V3(P.interior), { holes });
    }

    // Маска орудия: сегмент гнутой плиты 90 мм вокруг оси цапф
    {
        const R = 0.30, r = R - 0.09, a0 = -55 * DEG, a1 = 55 * DEG;
        const sh = new THREE.Shape();
        sh.absarc(0, 0, R, a0, a1, false);
        sh.lineTo(Math.cos(a1) * r, Math.sin(a1) * r);
        sh.absarc(0, 0, r, a1, a0, true);
        sh.closePath();
        const g = new THREE.ExtrudeGeometry(sh, { depth: 0.92, bevelEnabled: false, curveSegments: 20 });
        g.applyMatrix4(new THREE.Matrix4().makeBasis(V(0, 0, 1), V(0, 1, 0), V(-1, 0, 0)));
        g.translate(0.46, 0, 0);
        const m = new THREE.Mesh(g, mats.paint);
        m.castShadow = true;
        m.userData = { kind: "armor", zone: "turret.mantlet", thickness: 90, angle: 0, baseMat: mats.paint };
        const e = new THREE.LineSegments(new THREE.EdgesGeometry(g, 20), mats.edgeFaint); e.raycast = () => {}; e.visible = false; e.userData.kind = "edge"; m.add(e);
        gun.add(m); reg.armor.push(m);
    }

    /* ══════════════ ВНЕШНИЕ ДЕТАЛИ КОРПУСА ══════════════ */
    const upperZ = (y) => H.upperBottomZ - (y - H.sponson) * ((H.upperBottomZ - H.roofFrontZ) / (H.roof - H.sponson));
    const nUpper = V(0, Math.sin(30 * DEG), Math.cos(30 * DEG));
    const onUpper = (m, x, y, out = 0) => { m.position.set(x, y, upperZ(y)).addScaledVector(nUpper, out); m.rotation.x = -30 * DEG; return m; };

    // Смотровой прибор механика-водителя
    detail(hull, onUpper(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.15, 0.08)), 0, 1.46, 0.04), "Смотровой прибор механика-водителя", mats.paintDark);
    detail(hull, onUpper(new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.025, 0.02)), 0, 1.46, 0.085), "Смотровая щель", mats.glass);
    // Курсовой пулемёт ДТ в шаровой установке
    {
        detail(hull, onUpper(new THREE.Mesh(new THREE.SphereGeometry(0.1, 20, 14)), 0.40, 1.44, 0.01), "Шаровая установка курсового ДТ", mats.paintDark);
        detail(hull, onUpper(new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.03, 10, 24)), 0.40, 1.44, 0.01), "Броневой обвод шаровой установки", mats.paint);
        const barrel = cylGeo(0.012, 0.36, "z", 8); barrel.translate(0, 0, 0.2);
        const shroud = cylGeo(0.026, 0.14, "z", 12); shroud.translate(0, 0, 0.12);
        detail(hull, dmesh(merge([barrel, shroud]), 0.40, 1.44, upperZ(1.44) + 0.02), "Курсовой пулемёт ДТ-29", mats.darkSteel);
    }
    // Фара и сигнал
    detail(hull, onUpper(new THREE.Mesh(cylGeo(0.085, 0.12, "z", 18)), -0.86, 1.50, 0.07), "Фара", mats.paintDark);
    detail(hull, onUpper(new THREE.Mesh(cylGeo(0.07, 0.01, "z", 18)), -0.86, 1.50, 0.135), "Фара", mats.lamp);
    detail(hull, onUpper(new THREE.Mesh(cylGeo(0.05, 0.10, "z", 14, 0.035)), 0.86, 1.50, 0.06), "Звуковой сигнал", mats.paintDark);
    // Буксирные крюки (нос и корма)
    for (const x of [0.52, -0.52]) {
        const hook = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.026, 8, 16, Math.PI));
        hook.position.set(x, 0.68, 3.16); hook.rotation.set(0, Math.PI / 2, -Math.PI / 2 + 25 * DEG);
        detail(hull, hook, "Буксирный крюк", mats.paintDark);
        const hookR = hook.clone(); hookR.position.set(x, 1.0, H.rearZ - 0.03); hookR.rotation.set(0, Math.PI / 2, -Math.PI / 2);
        detail(hull, hookR, "Буксирный крюк", mats.paintDark);
    }
    // Люк стрелка-радиста и перископы механика-водителя
    detail(hull, dmesh(cylGeo(0.27, 0.05, "y", 28), 0.45, H.roof + 0.025, 1.93), "Люк стрелка-радиста", mats.paint);
    detail(hull, dmesh(cylGeo(0.03, 0.30, "x", 10), 0.45, H.roof + 0.04, 1.66), "Петля люка", mats.paintDark);
    detail(hull, dmesh(new THREE.TorusGeometry(0.06, 0.012, 6, 12, Math.PI), 0.45, H.roof + 0.05, 2.05), "Рукоятка люка", mats.darkSteel);
    for (const x of [-0.16, 0.12]) {
        detail(hull, dmesh(new THREE.BoxGeometry(0.11, 0.09, 0.15), x, H.roof + 0.045, 2.18), "Перископ механика-водителя", mats.paintDark);
        detail(hull, dmesh(new THREE.BoxGeometry(0.09, 0.05, 0.01), x, H.roof + 0.05, 2.256), "Призма перископа", mats.glass);
    }
    // Антенна радиостанции
    detail(hull, dmesh(cylGeo(0.05, 0.08, "y", 14), 1.02, H.roof + 0.04, 1.95), "Ввод антенны", mats.paintDark);
    detail(hull, dmesh(cylGeo(0.005, 1.6, "y", 6), 1.02, H.roof + 0.88, 1.95), "Антенна", mats.darkSteel);
    // Рымы
    for (const [x, z] of [[1.12, 2.2], [-1.12, 2.2], [1.12, -2.85], [-1.12, -2.85]]) {
        const eye = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.014, 6, 12, Math.PI));
        eye.position.set(x, H.roof, z); eye.rotation.y = Math.PI / 2;
        detail(hull, eye, "Рым для подъёма корпуса", mats.paintDark);
    }

    // Крыша МТО: люк над двигателем, жалюзи, крышки
    detail(hull, dmesh(new THREE.BoxGeometry(0.86, 0.04, 1.15), 0, H.roof + 0.02, -1.55), "Люк доступа к двигателю", mats.paint);
    for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        detail(hull, dmesh(cylGeo(0.018, 0.02, "y", 8), Math.cos(a) * 0.33, H.roof + 0.05, -1.55 + Math.sin(a) * 0.45), "Болт крышки люка", mats.darkSteel);
    }
    for (const s of [1, -1]) {
        detail(hull, dmesh(new THREE.BoxGeometry(0.40, 0.03, 1.42), s * 0.83, H.roof + 0.015, -1.62), "Рамка жалюзи воздухозабора", mats.paintDark);
        for (let i = 0; i < 12; i++) {
            const slat = dmesh(new THREE.BoxGeometry(0.36, 0.012, 0.075), s * 0.83, H.roof + 0.045, -1.0 - i * 0.112);
            slat.rotation.x = 30 * DEG;
            detail(hull, slat, "Жалюзи радиаторов", mats.paint);
        }
    }
    detail(hull, dmesh(new THREE.BoxGeometry(1.15, 0.035, 0.48), 0, H.roof + 0.018, -2.62), "Люк над трансмиссией", mats.paint);
    for (const x of [0.34, -0.34]) detail(hull, dmesh(cylGeo(0.09, 0.03, "y", 16), x, H.roof + 0.05, -2.62), "Крышка заливной горловины", mats.paintDark);
    // Выхлопные патрубки в верхнем кормовом листе
    for (const s of [1, -1]) {
        const y = 1.42, z = H.roofRearZ - (H.roof - y) * Math.tan(50 * DEG);
        detail(hull, dmesh(cylGeo(0.055, 0.28, "z", 14), s * 0.62, y, z - 0.08), "Выхлопной патрубок", mats.darkSteel);
        const hood = dmesh(new THREE.BoxGeometry(0.22, 0.14, 0.2), s * 0.62, y + 0.08, z - 0.07);
        hood.rotation.x = 15 * DEG;
        detail(hull, hood, "Броневой колпак выхлопа", mats.paint);
    }

    // Крылья, надгусеничные полки, ящики ЗИП
    const thin = (pts, interior) => plateGeometry(pts, 0.006, interior).geometry;
    for (const s of [1, -1]) {
        const shelfIn = V(s * 1.45, 1.0, 0);
        detail(hull, new THREE.Mesh(thin([V(s * H.halfUp, 1.29, 2.54), V(s * 1.67, 1.29, 2.54), V(s * 1.67, 1.29, -3.22), V(s * H.halfUp, 1.29, -3.22)], shelfIn)), "Надгусеничная полка", mats.paint, "ghost");
        detail(hull, new THREE.Mesh(thin([V(s * 0.93, 1.29, 2.54), V(s * 1.67, 1.29, 2.54), V(s * 1.67, 1.02, 3.32), V(s * 0.93, 1.02, 3.32)], V(s * 1.3, 0.9, 2.6))), "Переднее крыло", mats.paint, "ghost");
        detail(hull, new THREE.Mesh(thin([V(s * H.halfUp, 1.29, -3.22), V(s * 1.67, 1.29, -3.22), V(s * 1.67, 1.12, -3.47), V(s * H.halfUp, 1.12, -3.47)], V(s * 1.45, 0.9, -3.0))), "Заднее крыло", mats.paint, "ghost");
        detail(hull, new THREE.Mesh(thin([V(s * 1.67, 1.29, 2.54), V(s * 1.67, 1.21, 2.54), V(s * 1.67, 1.21, -3.22), V(s * 1.67, 1.29, -3.22)], V(0, 1.25, 0))), "Отбортовка полки", mats.paint, "ghost");
        const boxes = s > 0 ? [[1.25, 0.95], [-1.55, 0.95]] : [[0.65, 0.95], [-2.05, 0.75]];
        for (const [z, len] of boxes) {
            detail(hull, dmesh(new THREE.BoxGeometry(0.34, 0.25, len), s * 1.47, 1.29 + 0.125, z), "Ящик ЗИП", mats.paint);
            detail(hull, dmesh(new THREE.BoxGeometry(0.36, 0.02, len + 0.02), s * 1.47, 1.29 + 0.255, z), "Крышка ящика ЗИП", mats.paintDark);
            for (const dz of [-len * 0.3, len * 0.3]) detail(hull, dmesh(new THREE.BoxGeometry(0.02, 0.06, 0.05), s * 1.645, 1.36, z + dz), "Замок ящика", mats.darkSteel);
        }
        // Запасные траки на правой полке
        if (s < 0) for (let i = 0; i < 3; i++) detail(hull, dmesh(new THREE.BoxGeometry(0.30, 0.035, 0.15), s * 1.47, 1.31, 1.9 + i * 0.17), "Запасной трак", mats.track);
    }

    /* ══════════════ ДЕТАЛИ БАШНИ ══════════════ */
    const tw = turretHalfWidth;
    {
        const nF = V(0, Math.sin(20 * DEG), Math.cos(20 * DEG));
        const y = 0.45, z = TURRET_PROFILE[0][0] - (y - 0.02) * Math.tan(20 * DEG);
        const cast = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.66, 0.06));
        cast.position.set(0, y, z).addScaledVector(nF, 0.03);
        cast.rotation.x = -20 * DEG;
        detail(turret, cast, "Литая лобовая деталь башни", mats.paint);
    }
    detail(turret, dmesh(cylGeo(0.27, 0.055, "y", 28), -0.36, 0.885, -0.45), "Люк командира", mats.paint);
    detail(turret, dmesh(cylGeo(0.03, 0.32, "z", 10), -0.62, 0.89, -0.45), "Петля люка командира", mats.paintDark);
    detail(turret, dmesh(new THREE.BoxGeometry(0.12, 0.17, 0.16), 0.34, 0.94, 0.30), "Перископический прицел ПТ-6", mats.paintDark);
    detail(turret, dmesh(new THREE.BoxGeometry(0.10, 0.06, 0.01), 0.34, 0.97, 0.385), "Головка ПТ-6", mats.glass);
    detail(turret, dmesh(new THREE.BoxGeometry(0.12, 0.13, 0.16), -0.30, 0.92, 0.22), "Перископ командира", mats.paintDark);
    detail(turret, dmesh(new THREE.BoxGeometry(0.10, 0.05, 0.01), -0.30, 0.95, 0.305), "Призма перископа", mats.glass);
    detail(turret, dmesh(cylGeo(0.13, 0.07, "y", 20, 0.09), 0.05, 0.895, -0.05), "Броневой колпак вентилятора", mats.paint);
    for (const [x, z] of [[0.62, 0.45], [-0.62, 0.45], [0.62, -1.05], [-0.62, -1.05]]) {
        const eye = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.016, 6, 12, Math.PI));
        eye.position.set(x, 0.86, z);
        detail(turret, eye, "Рым башни", mats.paintDark);
    }
    for (const s of [1, -1]) {
        const y = 0.56;
        const slit = dmesh(new THREE.BoxGeometry(0.05, 0.085, 0.24), s * (tw(y) + 0.02), y, 0.05);
        slit.rotation.z = s * 15 * DEG;
        detail(turret, slit, "Бортовой смотровой прибор", mats.paintDark);
        const port = dmesh(cylGeo(0.045, 0.05, "x", 14), s * (tw(0.42) + 0.02), 0.42, -0.72);
        port.rotation.z = s * 15 * DEG;
        detail(turret, port, "Пистолетный порт", mats.paintDark);
    }
    {
        const y = 0.60, z = -1.155 - ((y - 0.32) / 0.54) * 0.145;
        detail(turret, dmesh(new THREE.SphereGeometry(0.085, 18, 12), 0, y, z - 0.01), "Шаровая установка кормового ДТ", mats.paintDark);
        const b = cylGeo(0.012, 0.32, "z", 8); b.translate(0, 0, -0.2);
        detail(turret, dmesh(b, 0, y, z), "Кормовой пулемёт ДТ-29", mats.darkSteel);
    }

    /* ══════════════ ОРУДИЕ ЗИС-5 ══════════════ */
    {
        const parts = [];
        const sleeve = cylGeo(0.082, 0.34, "z", 20); sleeve.translate(0, 0, 0.40); parts.push(sleeve);
        const tube = new THREE.CylinderGeometry(0.046, 0.058, 1.80, 20); tube.rotateX(Math.PI / 2); tube.translate(0, 0, 0.57 + 0.90); parts.push(tube);
        const muzzle = cylGeo(0.054, 0.08, "z", 20); muzzle.translate(0, 0, 2.40); parts.push(muzzle);
        const bar = detail(gun, dmesh(merge(parts), 0, 0, 0), "Ствол 76-мм пушки ЗИС-5", mats.paint, "ghost");
        bar.name = "barrel";
        bar.userData.recoil = true;
        const coax = cylGeo(0.013, 0.12, "z", 8); coax.translate(0, 0, 0.33);
        detail(gun, dmesh(coax, -0.19, -0.02, 0), "Спаренный пулемёт ДТ", mats.darkSteel);
        detail(gun, dmesh(cylGeo(0.03, 0.03, "z", 12), 0.18, 0.04, 0.30), "Окно прицела ТОД-6", mats.glass);
    }

    /* ══════════════ ХОДОВАЯ ЧАСТЬ ══════════════ */
    const geoRoad = roadWheelGeometry(), geoIdler = idlerGeometry(), geoSprocket = sprocketGeometry(), geoReturn = returnRollerGeometry();
    const linkGeo = trackLinkGeometry();
    for (const s of [1, -1]) {
        const x = s * TRACK.x;
        const sideName = s > 0 ? "левый" : "правый";
        const wheel = (mesh, r, i) => { mesh.userData.radius = r; mesh.userData.side = s; mesh.name = `wheel:${s}:${i}`; reg.wheels.push(mesh); return mesh; };
        ROAD.z.forEach((z, i) => {
            wheel(running(hull, dmesh(geoRoad, x, ROAD.y, z), `Опорный каток ${i + 1} (${sideName} борт), Ø600 мм`, mats.steel), ROAD.r, i);
            const pivot = V(s * 0.99, 0.60, z + 0.36), hub = V(s * 0.99, ROAD.y, z);
            running(hull, limb(pivot, hub, 0.045, mats.darkSteel), "Балансир подвески", mats.darkSteel);
            running(hull, dmesh(cylGeo(0.075, 0.10, "x", 14), s * 0.95, 0.60, z + 0.36), "Кронштейн балансира", mats.paintDark);
            running(hull, dmesh(new THREE.BoxGeometry(0.08, 0.08, 0.14), s * 0.94, 0.80, z + 0.12), "Ограничитель хода балансира", mats.paintDark);
        });
        wheel(running(hull, dmesh(geoIdler, x, IDLER.y, IDLER.z), `Направляющее колесо — ленивец (${sideName})`, mats.steel), IDLER.r, 6);
        running(hull, dmesh(cylGeo(0.10, 0.16, "x", 16), s * 0.98, IDLER.y, IDLER.z), "Кривошип натяжного механизма", mats.paintDark);
        wheel(running(hull, dmesh(geoSprocket, x, SPROCKET.y, SPROCKET.z), `Ведущее колесо (${sideName})`, mats.steel), SPROCKET.r, 7);
        running(hull, dmesh(cylGeo(0.21, 0.22, "x", 22), s * 1.0, SPROCKET.y, SPROCKET.z), "Картер бортового редуктора", mats.paintDark);
        RETURN.z.forEach((z, i) => {
            wheel(running(hull, dmesh(geoReturn, x, RETURN.y, z), `Поддерживающий каток ${i + 1} (${sideName})`, mats.rubber), RETURN.r, 8 + i);
            running(hull, dmesh(new THREE.BoxGeometry(0.22, 0.09, 0.10), s * 1.01, RETURN.y, z), "Кронштейн поддерживающего катка", mats.paintDark);
        });
        const tr = new THREE.InstancedMesh(linkGeo, mats.track, LINK_COUNT);
        tr.name = "track_" + (s > 0 ? "L" : "R");
        tr.castShadow = tr.receiveShadow = true;
        tr.frustumCulled = false;
        tr.userData = { kind: "running", label: `Гусеница (${sideName}): ${LINK_COUNT} траков, 700 мм, шаг 160 мм`, baseMat: mats.track, side: s, offset: 0 };
        hull.add(tr);
        reg.running.push(tr); reg.tracks.push(tr);
        layoutTrack(tr, 0);
    }

    /* ══════════════ ВНУТРЕННИЕ МОДУЛИ ══════════════ */
    const roundGeo = (() => {
        const caseG = colorize(cylGeo(0.043, 0.56, "z", 12), "#b8913a"); caseG.translate(0, 0, -0.14);
        const rim = colorize(cylGeo(0.048, 0.015, "z", 12), "#a07c30"); rim.translate(0, 0, -0.42);
        const shell = colorize(new THREE.CylinderGeometry(0.012, 0.038, 0.30, 12).rotateX(Math.PI / 2), "#4e544a"); shell.translate(0, 0, 0.29);
        const band = colorize(cylGeo(0.040, 0.02, "z", 12), "#c27a3e"); band.translate(0, 0, 0.15);
        return merge([caseG, rim, shell, band]);
    })();
    function roundsMesh(transforms) {
        const im = new THREE.InstancedMesh(roundGeo, mats.rounds, transforms.length);
        transforms.forEach(([x, y, z, rx, ry], i) => { _dummy.position.set(x, y, z); _dummy.rotation.set(rx, ry, 0); _dummy.updateMatrix(); im.setMatrixAt(i, _dummy.matrix); });
        im.userData.kind = "rounds";
        return im;
    }
    const ROUNDS = {
        ammo_driver: () => { const tf = []; for (let c = 0; c < 4; c++) for (let r = 0; r < 7; r++) if (tf.length < 25) tf.push([-0.77 + c * 0.09, 0.56 + r * 0.095, 2.17, 0, 0]); return tf; },
        ammo_niche: () => { const tf = []; for (let l = 0; l < 2; l++) for (let k = 0; k < 5; k++) tf.push([0, 0.41 + l * 0.095, -0.86 - k * 0.088, 0, Math.PI / 2]); return tf; },
    };
    for (const M of MODULES) {
        const meshes = M.shapes.map(shapeMesh);
        if (ROUNDS[M.id]) meshes.push(roundsMesh(ROUNDS[M.id]()));
        const g = module(frames[M.parent], M.id, M.cat, M.name, M.desc, meshes, M.placement || "source");
        if (M.rack) {
            // каркас стеллажа полупрозрачный — видны выстрелы внутри
            g.children[0].material = new THREE.MeshStandardMaterial({ color: MODULE_CATEGORIES.ammo.color, transparent: true, opacity: 0.22, depthWrite: false });
            g.children[0].userData.baseMat = g.children[0].material;
        }
        g.userData.noLabel = !!M.noLabel;
    }

    // Подсветка отделений на полу
    for (const c of COMPARTMENTS) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(1.76, 0.012, c.z[1] - c.z[0] - 0.04),
            new THREE.MeshBasicMaterial({ color: c.color, transparent: true, opacity: 0.22, depthWrite: false }));
        m.position.set(0, H.bottom + 0.05, (c.z[0] + c.z[1]) / 2);
        m.raycast = () => {};
        m.userData = { kind: "zone", id: c.id, name: c.name };
        m.visible = false;
        hull.add(m); reg.zones.push(m);
    }

    /* ══════════════ ЭКИПАЖ ══════════════ */
    function crewman(id, role, parent, pos, rotY, pose) {
        const g = new THREE.Group();
        g.name = "crew:" + id;
        g.position.copy(pos); g.rotation.y = rotY;
        const suit = new THREE.MeshStandardMaterial({ color: CREW_ROLES[role].color, roughness: 0.85 });
        const hip = V(0, 0, 0), neck = V(0, 0.50, -0.02);
        const parts = [
            limb(hip.clone().add(V(0, 0.04, 0)), neck, 0.14, suit),
            new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), mats.skin),
            new THREE.Mesh(new THREE.SphereGeometry(0.112, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), mats.helmet),
        ];
        parts[1].position.set(0, 0.66, 0.01);
        parts[2].position.set(0, 0.67, 0.0);
        for (const sx of [1, -1]) {
            const h = V(sx * 0.1, 0, 0.02);
            const knee = V(sx * 0.12, pose.kneeY, pose.kneeZ);
            const foot = V(sx * 0.13, pose.footY, pose.footZ);
            parts.push(limb(h, knee, 0.07, suit), limb(knee, foot, 0.055, suit));
            const sh = V(sx * 0.2, 0.44, -0.02), el = V(sx * 0.24, 0.2, 0.14), hand = V(sx * pose.handX, pose.handY, pose.handZ);
            parts.push(limb(sh, el, 0.05, suit), limb(el, hand, 0.045, suit));
        }
        for (const p of parts) { p.userData.crewId = id; p.castShadow = true; g.add(p); }
        g.userData = { kind: "crew", id, role, name: CREW_ROLES[role].name, place: CREW_ROLES[role].place };
        g.visible = false;
        parent.add(g);
        reg.crew.push(g);
        return g;
    }
    for (const C of CREW) crewman(C.id, C.role, frames[C.parent], V3(C.pos), C.rotY, POSES[C.pose]);

    /* ══════════════ API ══════════════ */
    let mode = "exterior", screensOn = false;

    function setMode(m) {
        mode = m;
        const xr = m !== "exterior";
        for (const p of [...reg.armor, ...reg.screens]) {
            p.material = m === "exterior" ? p.userData.baseMat : m === "armor" ? armorMat(p.userData.thickness) : mats.ghost;
            const e = p.children.find((c) => c.userData.kind === "edge");
            if (e) { e.visible = xr; e.material = m === "armor" ? mats.edgeDark : mats.edgeFaint; }
        }
        for (const s of reg.screens) s.visible = screensOn;
        for (const d of reg.details) {
            if (!xr) { d.visible = true; d.material = d.userData.baseMat; }
            else if (d.userData.xray === "ghost") { d.visible = true; d.material = mats.ghost; }
            else d.visible = false;
        }
        for (const r of reg.running) r.material = xr ? mats.ghostRunning : r.userData.baseMat;
        for (const g of reg.modules) {
            g.visible = m === "modules" || m === "crew";
            g.traverse((o) => {
                if (!o.isMesh || o.isInstancedMesh) return;
                o.material = m === "crew" ? modDim[g.userData.cat] : o.userData.baseMat;
            });
            g.children.filter((c) => c.isInstancedMesh).forEach((c) => { c.visible = m === "modules"; });
        }
        for (const c of reg.crew) c.visible = m === "crew" || m === "modules";
        for (const c of reg.crew) c.traverse((o) => { if (o.isMesh) { o.material.transparent = m === "modules"; o.material.opacity = m === "modules" ? 0.35 : 1; o.material.depthWrite = m !== "modules"; } });
        for (const z of reg.zones) z.visible = m === "modules" || m === "crew";
    }

    function setTurretYaw(rad) { turret.rotation.y = rad; }
    function setGunPitch(rad) {
        gun.rotation.x = -THREE.MathUtils.clamp(rad, KV1_DIMENSIONS.gun.elevation[0] * DEG, KV1_DIMENSIONS.gun.elevation[1] * DEG);
    }

    /** Анимация хода. vLeft/vRight — скорость гусениц, м/с (вперёд > 0). */
    function update(dt, vLeft = 0, vRight = 0) {
        for (const tr of reg.tracks) {
            const v = tr.userData.side > 0 ? vLeft : vRight;
            if (!v) continue;
            tr.userData.offset -= v * dt;
            layoutTrack(tr, tr.userData.offset);
        }
        for (const w of reg.wheels) {
            const v = w.userData.side > 0 ? vLeft : vRight;
            if (v) w.rotation.x += (v * dt) / w.userData.radius;
        }
    }

    /** Абсолютный путь гусениц (м), как trackPhase в симуляции: [левая, правая] */
    function setTrackPhase(left, right) {
        for (const tr of reg.tracks) {
            const ph = tr.userData.side > 0 ? left : right;
            if (Math.abs(ph + tr.userData.offset) < 1e-4) continue;
            tr.userData.offset = -ph;
            layoutTrack(tr, -ph);
        }
        for (const w of reg.wheels) w.rotation.x = (w.userData.side > 0 ? left : right) / w.userData.radius;
    }

    setMode("exterior");
    setGunPitch(options.gunPitch ?? 0);

    return {
        root, hull, turret, gun, materials: mats,
        armor: reg.armor, screens: reg.screens, details: reg.details, running: reg.running,
        tracks: reg.tracks, wheels: reg.wheels, modules: reg.modules, crew: reg.crew, zones: reg.zones,
        linkCount: LINK_COUNT,
        setMode, setTurretYaw, setGunPitch, update, setTrackPhase,
        setScreens(on) { screensOn = on; for (const s of reg.screens) s.visible = on; },
        get mode() { return mode; },
    };
}
