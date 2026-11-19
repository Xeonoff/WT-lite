/**
 * Landkreuzer P. 1000 «Ratte» — процедурная модель для three.js (реконструкция проекта Krupp 1942 г.).
 * Броня, модули, экипаж и станции вооружения берутся из js/data/models/RatteSpec.js —
 * того же описания, по которому симуляция считает попадания.
 *
 * Система координат: 1 ед. = 1 м; +Z — нос, +Y — вверх, +X — левый борт; начало — центр машины на грунте.
 * Иерархия:  Ratte › hull › turret (280 мм) › gun (два ствола) › barrel
 *                        › turret2 (128 мм, корма) › gun2
 *                        › flak:flak_l / flak:flak_r (поворот) › flakgun (качание)
 * Слои (userData.kind): armor | detail | running | module | crew — как у KV1Model.js.
 */
import * as THREE from "three";
import { mergeGeometries } from "./KV1Model.js";
import {
    RATTE_DIMENSIONS, ARMOR_ZONES, MODULE_CATEGORIES, CREW_ROLES, COMPARTMENTS, H, zUp, zLow, zRear, TRACK, GIRDERS,
    ROAD, IDLER, SPROCKET, RETURN, GUN_PIVOT, GUN_X, GUN2_PIVOT, TURRET, TURRET2, FLAK, BOW_MG,
    armorPlates, MODULES, CREW, POSES,
} from "../../data/models/RatteSpec.js";

export { RATTE_DIMENSIONS, ARMOR_ZONES, MODULE_CATEGORIES, CREW_ROLES, COMPARTMENTS };

const DEG = Math.PI / 180;
const MM = 0.001;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const V3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const merge = mergeGeometries;

const ARMOR_RAMP = [[25, "#3b5ba5"], [50, "#3a8bc0"], [100, "#35ab9a"], [150, "#a9c23c"], [200, "#f0a02e"], [300, "#dc5236"], [400, "#9e1f3c"]];
export const ARMOR_RAMP_STOPS = ARMOR_RAMP;

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

function circle3D(cx, y, cz, r, n = 64) {
    const out = [];
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; out.push(V(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r)); }
    return out;
}

function plateGeometry(pts, t, interior, holes = []) {
    const f = planeFrame(pts, interior);
    const shape = new THREE.Shape(pts.map((p) => to2D(p, f)));
    for (const h of holes) shape.holes.push(new THREE.Path(h.map((p) => to2D(p, f))));
    const g = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: 1 });
    g.translate(0, 0, -t);
    g.applyMatrix4(new THREE.Matrix4().makeBasis(f.u, f.v, f.n).setPosition(f.o));
    return { geometry: g, frame: f };
}

function cylGeo(r, len, axis = "y", seg = 20, r2 = r) {
    const g = new THREE.CylinderGeometry(r2, r, len, seg);
    if (axis === "x") g.rotateZ(-Math.PI / 2);
    if (axis === "z") g.rotateX(Math.PI / 2);
    return g;
}

function limb(a, b, r, mat) {
    const d = b.clone().sub(a);
    const len = Math.max(0.001, d.length() - 2 * r);
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), mat);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(V(0, 1, 0), d.normalize());
    return m;
}

/* ───────────────────────── Ходовая часть ───────────────────────── */
function dishProfile(R, w, dish) {
    const h = w / 2, hub = R * 0.18;
    return [
        [0.001, -h * 0.6], [hub, -h * 0.6], [hub * 1.05, -h * 0.25], [R * 0.75, -h * dish], [R * 0.9, -h * 0.8], [R, -h * 0.8],
        [R, h * 0.8], [R * 0.9, h * 0.8], [R * 0.75, h * dish], [hub * 1.05, h * 0.25], [hub, h * 0.6], [0.001, h * 0.6],
    ].map(([x, y]) => new THREE.Vector2(x, y));
}
function ribbedDisc(R, w, ribs, x) {
    const parts = [new THREE.LatheGeometry(dishProfile(R, w, 0.2), 24)];
    for (let i = 0; i < ribs; i++) {
        const a = (i / ribs) * Math.PI * 2;
        for (const side of [-1, 1]) {
            const s = new THREE.BoxGeometry(R * 0.1, R * 0.55, w * 0.16);
            s.translate(0, R * 0.48, side * w * 0.22);
            s.rotateZ(a);
            parts.push(s.rotateX(Math.PI / 2));
        }
    }
    const g = merge(parts);
    g.rotateZ(Math.PI / 2);
    g.translate(x, 0, 0);
    return g;
}
function wheelGeometry(R, gap, w) {
    return merge([ribbedDisc(R, w, 8, gap), ribbedDisc(R, w, 8, -gap), cylGeo(R * 0.14, gap * 2 + w, "x", 14)]);
}
function sprocketGeometry() {
    const R = SPROCKET.r, parts = [];
    for (const x of [0.36, -0.36]) {
        const d = new THREE.LatheGeometry(dishProfile(R * 0.92, 0.12, 0.4), 24);
        d.rotateZ(Math.PI / 2); d.translate(x, 0, 0); parts.push(d);
        for (let i = 0; i < 14; i++) {
            const t = new THREE.BoxGeometry(0.14, 0.2, 0.18);
            t.translate(0, R * 0.98, 0);
            t.rotateX((i / 14) * Math.PI * 2); t.translate(x, 0, 0);
            parts.push(t);
        }
    }
    parts.push(cylGeo(0.36, 0.9, "x", 20));
    return merge(parts);
}
function trackLinkGeometry() {
    const W = TRACK.width, parts = [];
    const plate = new THREE.BoxGeometry(W, 0.09, 0.38); plate.translate(0, -0.045, 0); parts.push(plate);
    for (const x of [-0.4, 0, 0.4]) { const c = new THREE.BoxGeometry(0.32, 0.03, 0.07); c.translate(x, -0.105, 0.06); parts.push(c); }
    const horn = new THREE.BoxGeometry(0.14, 0.22, 0.22); horn.translate(0, 0.11, 0); parts.push(horn);
    const pin = cylGeo(0.035, W + 0.04, "x", 8); pin.translate(0, -0.045, 0.18); parts.push(pin);
    return merge(parts);
}

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
        if (d > Math.PI * 1.5) d = 0;
        if (d * c.r > 1e-6) { segs.push({ type: "arc", c, a0, d, len: d * c.r, s0: total }); total += d * c.r; }
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

const ROAD_Z = Array.from({ length: ROAD.n }, (_, i) => ROAD.z0 + (i * (ROAD.z1 - ROAD.z0)) / (ROAD.n - 1));
export const BELT = buildBeltPath([
    { z: SPROCKET.z, y: SPROCKET.y, r: SPROCKET.r },
    ...ROAD_Z.map((z) => ({ z, y: ROAD.y, r: ROAD.r })),
    { z: IDLER.z, y: IDLER.y, r: IDLER.r },
    ...RETURN.z.map((z) => ({ z, y: RETURN.y, r: RETURN.r })),
]);
export const LINK_COUNT = Math.round(BELT.total / TRACK.pitch);
const LINK_PITCH = BELT.total / LINK_COUNT;

const _dummy = new THREE.Object3D();
/** Раскладка траков гусеницы по ленте со сдвигом offset (м); x — из userData гусеницы */
export function layoutTrack(tr, offset, lift) {
    const x = tr.userData.x;
    for (let i = 0; i < LINK_COUNT; i++) {
        const p = BELT.at(i * LINK_PITCH + offset);
        const dy = lift ? lift(p.z, p.y) : 0;
        const slope = lift ? (lift(p.z + 0.05, p.y) - dy) / 0.05 : 0;
        _dummy.position.set(x, p.y + dy, p.z);
        _dummy.rotation.set(Math.atan2(-p.dy - slope * p.dz, p.dz), 0, 0);
        _dummy.updateMatrix();
        tr.setMatrixAt(i, _dummy.matrix);
    }
    tr.instanceMatrix.needsUpdate = true;
}

/* ───────────────────────── Сборка модели ───────────────────────── */
/** options.paint / options.paintDark — материалы окраски (в игре — камуфляж текущего биома) */
export function createRatte(options = {}) {
    const root = new THREE.Group(); root.name = "Ratte";
    const hull = new THREE.Group(); hull.name = "hull"; root.add(hull);
    const turret = new THREE.Group(); turret.name = "turret";
    turret.position.set(0, H.deck, H.turretZ); hull.add(turret);
    const gun = new THREE.Group(); gun.name = "gun"; gun.position.set(...GUN_PIVOT); turret.add(gun);
    const barrels = new THREE.Group(); barrels.name = "barrel"; gun.add(barrels);
    const turret2 = new THREE.Group(); turret2.name = "turret2";
    turret2.position.set(0, H.deck, H.turret2Z); hull.add(turret2);
    const gun2 = new THREE.Group(); gun2.name = "gun2"; gun2.position.set(...GUN2_PIVOT); turret2.add(gun2);
    const frames = { hull, turret, gun, turret2, gun2 };
    const flakGroups = {};

    const reg = { armor: [], screens: [], details: [], running: [], tracks: [], modules: [], crew: [], zones: [], wheels: [] };
    const std = (color, rough = 0.7, metal = 0.2, extra = {}) =>
        new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
    const mats = {
        paint: options.paint || std("#4a5054", 0.8, 0.15),       // Panzergrau, RAL 7021
        paintDark: options.paintDark || std("#363b3e", 0.82, 0.18),
        steel: std("#5e5b53", 0.55, 0.55),
        darkSteel: std("#33312d", 0.6, 0.5),
        track: std("#3b3833", 0.72, 0.55),
        glass: std("#6f8fa3", 0.15, 0.3),
        lamp: std("#d9dcc8", 0.2, 0.4, { emissive: "#353520" }),
        ghost: std("#7d858a", 0.8, 0, { transparent: true, opacity: 0.06, depthWrite: false }),
        ghostRunning: std("#5e5b53", 0.7, 0.3, { transparent: true, opacity: 0.18, depthWrite: false }),
        edgeDark: new THREE.LineBasicMaterial({ color: "#1b1f18", transparent: true, opacity: 0.55 }),
        edgeFaint: new THREE.LineBasicMaterial({ color: "#5c5a4c", transparent: true, opacity: 0.45, depthWrite: false }),
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
    modMats.structure.transparent = true; modMats.structure.opacity = 0.35; modMats.structure.depthWrite = false;

    /* ── регистрация объектов ── */
    function addEdges(mesh, geometry) {
        const e = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 20), mats.edgeFaint);
        e.raycast = () => {}; e.visible = false; e.userData.kind = "edge";
        mesh.add(e);
    }
    function armorMesh(parent, zone, geometry, mm, angle, spaced = false) {
        const mesh = new THREE.Mesh(geometry, mats.paint);
        mesh.name = zone;
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.userData = { kind: "armor", zone, thickness: mm, angle, spaced, baseMat: mats.paint };
        addEdges(mesh, geometry);
        parent.add(mesh);
        reg.armor.push(mesh);
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
    const bx = (w, h, d, x, y, z) => dmesh(new THREE.BoxGeometry(w, h, d), x, y, z);
    function running(parent, mesh, label, mat) {
        mesh.material = mat;
        mesh.castShadow = true; mesh.receiveShadow = true;
        mesh.userData = { kind: "running", label, baseMat: mat };
        parent.add(mesh);
        reg.running.push(mesh);
        return mesh;
    }
    function module(parent, id, cat, name, desc, meshes, placement = "estimate") {
        const g = new THREE.Group();
        g.name = "module:" + id;
        g.userData = { kind: "module", id, cat, name, desc, placement };
        for (const m of meshes) {
            m.material = modMats[cat];
            m.userData.moduleId = id;
            m.userData.baseMat = m.material;
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
        const m = new THREE.Mesh(cylGeo(r, len, axis, seg || 20)); m.position.set(x, y, z); return m;
    };

    /* ══════════════ БРОНЯ (из спецификации) ══════════════ */
    for (const P of armorPlates()) {
        const holes = (P.holes || []).map((h) => (Array.isArray(h) ? h.map(V3) : circle3D(h.x, P.pts[0][1], h.z, h.r, 64)));
        const { geometry, frame } = plateGeometry(P.pts.map(V3), P.mm * MM, V3(P.interior), holes);
        const angle = Math.round(Math.asin(Math.min(1, Math.abs(frame.n.y))) / DEG);
        armorMesh(frames[P.parent], P.zone, geometry, P.mm, angle, !!P.spaced);
    }

    /* ══════════════ ДЕТАЛИ БАШНИ ГК ══════════════ */
    {
        const y1 = TURRET.y1;
        // орудия 28 cm SK C/34: ствол 15,26 м (≈13,2 м впереди цапф)
        const barrelGeo = (() => {
            const tube = new THREE.CylinderGeometry(0.30, 0.55, 12.7, 28); tube.rotateX(Math.PI / 2); tube.translate(0, 0, 0.3 + 6.35);
            const sleeve = cylGeo(0.56, 1.2, "z", 28); sleeve.translate(0, 0, 0.9);
            const muzzle = cylGeo(0.36, 0.18, "z", 28); muzzle.translate(0, 0, 13.1);
            return merge([tube, sleeve, muzzle]);
        })();
        for (const sx of [GUN_X, -GUN_X]) {
            const b = detail(barrels, dmesh(barrelGeo, sx, 0, 0), "Ствол 28 cm SK C/34 (54,5 клб)", mats.paint, "ghost");
            b.userData.recoil = true;
        }
        const rfZ = -3.8, rfY = y1 + 0.3;
        detail(turret, dmesh(cylGeo(0.38, 11.6, "x", 24), 0, rfY, rfZ), "Дальномер 10,5 м", mats.paint);
        for (const s of [1, -1]) {
            detail(turret, bx(0.7, 0.76, 1.2, s * 6.0, rfY, rfZ), "Бронированный колпак окуляра дальномера", mats.paint);
            detail(turret, bx(0.05, 0.3, 0.5, s * 6.36, rfY + 0.05, rfZ), "Окно дальномера", mats.glass);
        }
        detail(turret, bx(1.6, 0.3, 1.6, 0, y1 + 0.15, rfZ), "Опора дальномера", mats.paintDark);
        for (const sx of [3.9, -3.9]) {
            detail(turret, dmesh(cylGeo(0.42, 0.45, "y", 20, 0.36), sx, y1 + 0.22, 1.6), "Колпак прицела наводчика", mats.paint);
            detail(turret, bx(0.34, 0.08, 0.04, sx, y1 + 0.34, 1.98), "Смотровая щель", mats.glass);
        }
        detail(turret, dmesh(cylGeo(0.7, 0.7, "y", 24, 0.62), 1.6, y1 + 0.35, -0.6), "Командирская башенка", mats.paint);
        for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            const slit = bx(0.24, 0.08, 0.04, 1.6 + Math.sin(a) * 0.66, y1 + 0.47, -0.6 + Math.cos(a) * 0.66);
            slit.rotation.y = a;
            detail(turret, slit, "Смотровой прибор башенки", mats.glass);
        }
        for (const [x, z] of [[-2.2, -0.6], [3.4, -4.6], [-3.4, -4.6]]) detail(turret, dmesh(cylGeo(0.55, 0.08, "y", 24), x, y1 + 0.04, z), "Люк крыши башни", mats.paintDark);
        for (const [x, z] of [[4.2, 3.2], [-4.2, 3.2], [4.9, -4.9], [-4.9, -4.9]]) {
            const eye = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.05, 6, 12, Math.PI)); eye.position.set(x, y1, z);
            detail(turret, eye, "Рым башни", mats.paintDark);
        }
        detail(hull, dmesh(cylGeo(H.ringR + 0.15, 0.35, "y", 72), 0, H.deck + 0.17, H.turretZ), "Погонный броневой обвод башни ГК", mats.paintDark);
    }

    /* ══════════════ КОРМОВАЯ БАШНЯ 128 мм ══════════════ */
    {
        const tube = new THREE.CylinderGeometry(0.10, 0.15, 6.0, 20); tube.rotateX(Math.PI / 2); tube.translate(0, 0, 1.2 + 3.0);
        const muzzle = cylGeo(0.13, 0.25, "z", 20); muzzle.translate(0, 0, 7.25);
        detail(gun2, dmesh(merge([tube, muzzle]), 0, 0, 0), "Ствол 12,8 cm KwK 44 L/55", mats.paint, "ghost");
        detail(turret2, dmesh(cylGeo(0.42, 0.45, "y", 20, 0.36), 0.7, TURRET2.y1 + 0.22, -0.9), "Командирская башенка 128 мм", mats.paint);
        detail(turret2, bx(0.3, 0.2, 0.25, -0.6, TURRET2.y1 + 0.1, 0.6), "Перископический прицел", mats.paintDark);
        detail(hull, dmesh(cylGeo(H.ring2R + 0.12, 0.25, "y", 40), 0, H.deck + 0.12, H.turret2Z), "Погонный обвод кормовой башни", mats.paintDark);
    }

    /* ══════════════ ВНЕШНИЕ ДЕТАЛИ КОРПУСА ══════════════ */
    const nGl = V(0, Math.sin(31 * DEG), Math.cos(31 * DEG));
    const onGlacis = (m, x, y, out = 0) => { m.position.set(x, y, zUp(y)).addScaledVector(nGl, out); m.rotation.x = -59 * DEG; return m; };
    for (const x of [1.4, -1.4]) {
        detail(hull, onGlacis(bx(1.0, 0.45, 0.35, 0, 0, 0), x, 6.6, 0.15), "Бронированный смотровой прибор водителя", mats.paintDark);
        detail(hull, onGlacis(bx(0.7, 0.07, 0.05, 0, 0, 0), x, 6.6, 0.34), "Смотровая щель", mats.glass);
    }
    for (const m of BOW_MG) {
        detail(hull, onGlacis(dmesh(new THREE.SphereGeometry(0.45, 20, 14), 0, 0, 0), m.x, m.y, 0.1), "Шаровая установка MG 151/15", mats.paintDark);
        const b = cylGeo(0.05, 1.4, "z", 10); b.translate(0, 0, 0.7);
        detail(hull, dmesh(b, m.x, m.y + 0.45 * nGl.y, zUp(m.y) + 0.45 * nGl.z), "Ствол MG 151/15", mats.darkSteel);
    }
    for (const x of [5.6, -5.6]) {
        detail(hull, onGlacis(dmesh(cylGeo(0.35, 0.4, "z", 20), 0, 0, 0), x, 6.7, 0.25), "Фара", mats.paintDark);
        detail(hull, onGlacis(dmesh(cylGeo(0.3, 0.03, "z", 20), 0, 0, 0), x, 6.7, 0.46), "Стекло фары", mats.lamp);
    }
    for (const x of [2.2, -2.2]) {
        const hook = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.12, 8, 16, Math.PI));
        hook.position.set(x, 3.6, zLow(3.6) + 0.15); hook.rotation.set(0, Math.PI / 2, -Math.PI / 2 + 44 * DEG);
        detail(hull, hook, "Буксирная проушина", mats.paintDark);
        const hr = hook.clone(); hr.position.set(x, 3.4, zRear(3.4) - 0.2); hr.rotation.set(0, Math.PI / 2, -Math.PI / 2);
        detail(hull, hr, "Буксирная проушина", mats.paintDark);
    }
    for (const [x, z] of [[1.8, 11.4], [-1.8, 11.4], [5.4, 9.5], [-5.4, 9.5], [5.4, -2.6], [-5.4, -2.6], [0, -4.0]]) {
        detail(hull, dmesh(cylGeo(0.6, 0.12, "y", 24), x, H.deck + 0.06, z), "Люк крыши корпуса", mats.paintDark);
    }
    for (const zc of [-15.5, -11.5]) for (const s of [1, -1]) {
        detail(hull, bx(2.6, 0.12, 1.8, s * 3.4, H.deck + 0.06, zc), "Рамка решётки радиаторов", mats.paintDark);
        for (let i = 0; i < 9; i++) {
            const slat = bx(2.4, 0.04, 0.16, s * 3.4, H.deck + 0.14, zc - 0.8 + i * 0.2);
            slat.rotation.x = 30 * DEG;
            detail(hull, slat, "Жалюзи радиаторов", mats.paint);
        }
    }
    for (const s of [1, -1]) {
        detail(hull, dmesh(cylGeo(0.32, 3.0, "y", 16), s * 5.3, H.deck + 1.5, -15.6), "Шноркель воздухозабора (по образцу подводных лодок)", mats.paintDark);
        detail(hull, dmesh(cylGeo(0.5, 0.5, "y", 16, 0.34), s * 5.3, H.deck + 3.25, -15.6), "Колпак шноркеля", mats.paintDark);
    }
    for (let i = 0; i < 8; i++) {
        const x = -5.25 + i * 1.5, y = 5.6;
        detail(hull, dmesh(cylGeo(0.2, 0.7, "z", 14), x, y, zRear(y) - 0.3), "Выхлопной патрубок", mats.darkSteel);
    }
    detail(hull, bx(0.06, 2.4, 3.0, H.halfWide + 0.03, 5.2, -2.7), "Ворота гаража мотоциклов BMW R12", mats.paintDark);
    detail(hull, bx(0.06, 2.0, 1.0, -H.halfWide - 0.03, 5.0, -3.0), "Дверь лазарета", mats.paintDark);
    for (const s of [1, -1]) for (let i = 0; i < 5; i++) {
        detail(hull, bx(0.08, 0.06, 0.7, s * (H.halfWide + 0.12), 4.2 + i * 0.42, 10.6), "Скоба трапа", mats.darkSteel);
    }
    // зенитные установки Flakvierling 38: тумба на корпусе, люлька и стволы поворачиваются (щит — броня корпуса)
    for (const f of FLAK) {
        const base = new THREE.Group(); base.position.set(f.x, H.deck, f.z); hull.add(base);
        detail(base, dmesh(cylGeo(1.1, 0.35, "y", 24), 0, 0.18, 0), "Тумба Flakvierling 38", mats.paintDark);
        const yawG = new THREE.Group(); yawG.name = "flak:" + f.id; yawG.position.set(0, 0.4, 0); base.add(yawG);
        detail(yawG, bx(1.4, 0.7, 1.2, 0, 0.35, 0), "Люлька Flakvierling 38", mats.paint);
        const pitchG = new THREE.Group(); pitchG.name = "flakgun"; pitchG.position.set(0, 0.6, 0.2); yawG.add(pitchG);
        for (const [dx, dy] of [[0.35, 0.3], [-0.35, 0.3], [0.35, -0.05], [-0.35, -0.05]]) {
            const b = cylGeo(0.04, 2.3, "z", 8); b.translate(0, 0, 1.15);
            detail(pitchG, dmesh(b, dx, dy, 0), "20-мм ствол Flak 38", mats.darkSteel);
        }
        flakGroups[f.id] = { yaw: yawG, pitch: pitchG };
        frames["flak_" + f.id] = yawG;
        frames["flakgun_" + f.id] = pitchG;
    }
    for (let i = 0; i < 4; i++) {
        const y = 4.2 + i * 0.42;
        const tr = bx(1.2, 0.09, 0.38, 0, y, zRear(y) - 0.1); tr.rotation.x = -Math.PI / 2 + 10 * DEG;
        detail(hull, tr, "Запасной трак", mats.track);
    }

    /* ══════════════ ХОДОВАЯ ЧАСТЬ: 3 гусеницы на борт ══════════════ */
    // катки не вращаются (крейсер ползёт медленно) — сливаются в общую модель; траки бегут по ленте
    const geoRoad = wheelGeometry(ROAD.r, 0.3, 0.4);
    const geoIdler = wheelGeometry(IDLER.r, 0.3, 0.38);
    const geoSprocket = sprocketGeometry();
    const geoReturn = merge([cylGeo(RETURN.r, 0.9, "x", 20), cylGeo(0.12, 1.1, "x", 12)]);
    const linkGeo = trackLinkGeometry();
    const trackNames = ["внутренняя", "средняя", "наружная"];
    for (const s of [1, -1]) {
        const side = s > 0 ? "левый" : "правый";
        TRACK.xs.forEach((tx, k) => {
            const x = s * tx;
            const roads = new THREE.InstancedMesh(geoRoad, mats.steel, ROAD_Z.length);
            running(hull, roads, `Опорные катки, ${trackNames[k]} гусеница (${side} борт)`, mats.steel);
            roads.name = "roadWheels";
            roads.userData.lane = (s > 0 ? 0 : TRACK.xs.length) + k;
            roads.userData.centers = ROAD_Z;
            roads.userData.x = x; roads.userData.y = ROAD.y;
            roads.userData.radius = ROAD.r;
            ROAD_Z.forEach((z, i) => roads.setMatrixAt(i, new THREE.Matrix4().makeTranslation(x, ROAD.y, z)));
            running(hull, dmesh(geoIdler, x, IDLER.y, IDLER.z), `Ленивец, ${trackNames[k]} гусеница (${side})`, mats.steel);
            running(hull, dmesh(geoSprocket, x, SPROCKET.y, SPROCKET.z), `Ведущее колесо, ${trackNames[k]} гусеница (${side})`, mats.steel);
            RETURN.z.forEach((z) => running(hull, dmesh(geoReturn, x, RETURN.y, z), `Поддерживающий каток, ${trackNames[k]} гусеница`, mats.steel));
            const tr = new THREE.InstancedMesh(linkGeo, mats.track, LINK_COUNT);
            tr.name = `track_${s > 0 ? "L" : "R"}${k + 1}`;
            tr.castShadow = tr.receiveShadow = true;
            tr.frustumCulled = false;
            tr.userData = { kind: "running", label: `Гусеница ${trackNames[k]} (${side}): ${LINK_COUNT} траков, 1,2 м`, baseMat: mats.track, side: s, x, offset: 0 };
            hull.add(tr);
            tr.userData.lane = roads.userData.lane;
            reg.running.push(tr); reg.tracks.push(tr);
            layoutTrack(tr, 0);
        });
        const axleLen = TRACK.xs[2] + TRACK.width / 2 - GIRDERS[0], axleX = s * (GIRDERS[0] + axleLen / 2);
        const girderLo = ROAD.y - 0.2;
        GIRDERS.forEach((gx, i) => {
            const top = i === 0 ? H.bottom : H.sponson;
            running(hull, bx(0.2, top - girderLo, IDLER.z - SPROCKET.z, s * gx, (top + girderLo) / 2, (IDLER.z + SPROCKET.z) / 2),
                i === 0 ? "Внутренняя балка подвески (под днищем)" : "Продольная балка подвески между гусеницами", mats.paintDark);
        });
        ROAD_Z.forEach((z) => running(hull, dmesh(cylGeo(0.18, axleLen, "x", 12), axleX, ROAD.y, z), "Ось опорных катков", mats.darkSteel));
        RETURN.z.forEach((z) => running(hull, dmesh(cylGeo(0.12, GIRDERS[2] - GIRDERS[0] + 1.4, "x", 10), s * (GIRDERS[0] + GIRDERS[2] + 1.4) / 2, RETURN.y, z), "Ось поддерживающих катков", mats.darkSteel));
        running(hull, dmesh(cylGeo(0.3, axleLen, "x", 14), axleX, SPROCKET.y, SPROCKET.z), "Вал ведущих колёс", mats.darkSteel);
        running(hull, dmesh(cylGeo(0.3, axleLen, "x", 14), axleX, IDLER.y, IDLER.z), "Ось ленивцев", mats.darkSteel);
    }

    /* ══════════════ ВНУТРЕННИЕ МОДУЛИ ══════════════ */
    for (const M of MODULES) module(frames[M.parent], M.id, M.cat, M.name, M.desc, M.shapes.map(shapeMesh), M.placement || "estimate");
    for (const c of COMPARTMENTS) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(5.3, 0.03, c.z[1] - c.z[0] - 0.1),
            new THREE.MeshBasicMaterial({ color: c.color, transparent: true, opacity: 0.22, depthWrite: false }));
        m.position.set(0, H.bottom + 0.08, (c.z[0] + c.z[1]) / 2);
        m.raycast = () => {};
        m.userData = { kind: "zone", id: c.id, name: c.name };
        m.visible = false;
        hull.add(m); reg.zones.push(m);
    }

    /* ══════════════ ЭКИПАЖ (20 человек) ══════════════ */
    function crewman(id, role, parent, pos, rotY, pose) {
        const g = new THREE.Group();
        g.name = "crew:" + id;
        g.position.copy(pos); g.rotation.y = rotY;
        const suit = new THREE.MeshStandardMaterial({ color: CREW_ROLES[role].color, roughness: 0.85 });
        const parts = [
            limb(V(0, 0.04, 0), V(0, 0.50, -0.02), 0.14, suit),
            new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), mats.skin),
            new THREE.Mesh(new THREE.SphereGeometry(0.112, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), mats.helmet),
        ];
        parts[1].position.set(0, 0.66, 0.01);
        parts[2].position.set(0, 0.67, 0.0);
        for (const sx of [1, -1]) {
            const knee = V(sx * 0.12, pose.kneeY, pose.kneeZ);
            const foot = V(sx * 0.13, pose.footY, pose.footZ);
            parts.push(limb(V(sx * 0.1, 0, 0.02), knee, 0.07, suit), limb(knee, foot, 0.055, suit));
            const el = V(sx * 0.24, 0.2, 0.14);
            parts.push(limb(V(sx * 0.2, 0.44, -0.02), el, 0.05, suit), limb(el, V(sx * pose.handX, pose.handY, pose.handZ), 0.045, suit));
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
    let mode = "exterior";
    function setMode(m) {
        mode = m;
        const xr = m !== "exterior";
        for (const p of reg.armor) {
            p.material = m === "exterior" ? p.userData.baseMat : m === "armor" ? armorMat(p.userData.thickness) : mats.ghost;
            const e = p.children.find((c) => c.userData.kind === "edge");
            if (e) { e.visible = xr; e.material = m === "armor" ? mats.edgeDark : mats.edgeFaint; }
        }
        for (const d of reg.details) {
            if (!xr) { d.visible = true; d.material = d.userData.baseMat; }
            else if (d.userData.xray === "ghost") { d.visible = true; d.material = mats.ghost; }
            else d.visible = false;
        }
        for (const r of reg.running) r.material = xr ? mats.ghostRunning : r.userData.baseMat;
        for (const g of reg.modules) {
            g.visible = m === "modules" || m === "crew";
            g.traverse((o) => { if (o.isMesh && !o.isInstancedMesh) o.material = m === "crew" ? modDim[g.userData.cat] : o.userData.baseMat; });
        }
        for (const c of reg.crew) {
            c.visible = m === "crew" || m === "modules";
            c.traverse((o) => { if (o.isMesh) { o.material.transparent = m === "modules"; o.material.opacity = m === "modules" ? 0.35 : 1; o.material.depthWrite = m !== "modules"; } });
        }
        for (const z of reg.zones) z.visible = m === "modules" || m === "crew";
    }
    function setTurretYaw(rad) { turret.rotation.y = rad; }
    function setGunPitch(rad) { gun.rotation.x = -THREE.MathUtils.clamp(rad, RATTE_DIMENSIONS.gun.elevation[0] * DEG, RATTE_DIMENSIONS.gun.elevation[1] * DEG); }
    function setTurret2Yaw(rad) { turret2.rotation.y = rad; }
    function setGun2Pitch(rad) { gun2.rotation.x = -THREE.MathUtils.clamp(rad, RATTE_DIMENSIONS.gun2.elevation[0] * DEG, RATTE_DIMENSIONS.gun2.elevation[1] * DEG); }
    /** Абсолютный путь гусениц (м), как trackPhase в симуляции: [левая, правая] */
    function setTrackPhase(left, right) {
        for (const tr of reg.tracks) {
            const ph = tr.userData.side > 0 ? left : right;
            if (Math.abs(ph + tr.userData.offset) < 1e-4) continue;
            tr.userData.offset = -ph;
            layoutTrack(tr, -ph);
        }
    }
    function update(dt, vLeft = 0, vRight = 0) {
        for (const tr of reg.tracks) {
            const v = tr.userData.side > 0 ? vLeft : vRight;
            if (!v) continue;
            tr.userData.offset -= v * dt;
            layoutTrack(tr, tr.userData.offset);
        }
    }

    setMode("exterior");
    setTurret2Yaw(Math.PI);
    for (const f of FLAK) flakGroups[f.id].yaw.rotation.y = Math.PI;
    setGunPitch(options.gunPitch ?? 0);

    return {
        root, hull, turret, gun, turret2, gun2, flak: flakGroups, frames, materials: mats,
        armor: reg.armor, screens: reg.screens, details: reg.details, running: reg.running,
        tracks: reg.tracks, wheels: reg.wheels, modules: reg.modules, crew: reg.crew, zones: reg.zones,
        linkCount: LINK_COUNT,
        setMode, setTurretYaw, setGunPitch, setTurret2Yaw, setGun2Pitch, update, setTrackPhase,
        setScreens() {},
        get mode() { return mode; },
    };
}
