import * as THREE from "three";
import { camoTexture, trackTexture, runningGearTexture } from "./Textures.js";
import { turretSlopeRing } from "../data/VehicleBuild.js";

const geoCache = new Map();
const matCache = new Map();

const BURNT = new THREE.MeshStandardMaterial({ color: 0x1b1a17, roughness: 1, metalness: 0.05 });
const DARK = new THREE.MeshStandardMaterial({ color: 0x2a2a24, roughness: 0.9, metalness: 0.2 });
const STEEL = new THREE.MeshStandardMaterial({ color: 0x3c3d36, roughness: 0.7, metalness: 0.4 });
const HEAD = new THREE.MeshStandardMaterial({ color: 0x6b5a45, roughness: 0.9 });
const INTERIOR = new THREE.MeshStandardMaterial({ color: 0x2d2c26, roughness: 1 });

/** Профили скругления стенок по высоте: [доля высоты, сжатие сечения] */
const ROUNDING = {
    cast: [[0, 1], [0.42, 0.995], [0.7, 0.97], [0.88, 0.91], [1, 0.77]],
    round: [[0, 1], [0.42, 0.995], [0.7, 0.97], [0.88, 0.91], [1, 0.78]],
    hex: [[0, 1], [0.66, 0.99], [0.9, 0.95], [1, 0.87]],
    casemate: [[0, 1], [0.88, 1], [1, 0.95]],
    welded: [[0, 1], [0.85, 1], [1, 0.93]],
};
const FLAT = { box: true, tiger: true, panther: true, kingtiger: true, casemate: true, hex: true };

export function burntMaterial() { return BURNT; }

function camoMat(paint, biome) {
    const key = paint + ":" + biome;
    if (matCache.has(key)) return matCache.get(key);
    const m = new THREE.MeshStandardMaterial({ map: camoTexture(paint, biome), roughness: 0.82, metalness: 0.18 });
    matCache.set(key, m);
    return m;
}

function hullGeometry(def) {
    const key = def.id + ":hull";
    if (geoCache.has(key)) return geoCache.get(key);
    const { W, tw } = def.dims;
    const iw = W - 2 * tw + 0.12;
    const shape = new THREE.Shape(def.profile.pts.map(([x, y]) => new THREE.Vector2(x, y)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: iw, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 1, steps: 1 });
    g.translate(0, 0, -iw / 2);
    g.computeVertexNormals();
    g.userData.shared = true;
    geoCache.set(key, g);
    return g;
}

const centroidOf = (pts) => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
const shrink = (pts, k) => {
    const [cx, cz] = centroidOf(pts);
    return pts.map(([x, z]) => [cx + (x - cx) * k, cz + (z - cz) * k]);
};

/**
 * «Лофт» по сечениям одинаковой топологии: боковые стенки + (опционально) крышка.
 * rings: [{pts:[[x,z],...], y}], invert — нормали внутрь (внутренние стенки)
 */
function loftGeometry(rings, { cap = true, flat = false, invert = false } = {}) {
    const p0 = rings[0].pts, n = p0.length;
    let area = 0;
    for (let i = 0; i < n; i++) { const [x1, z1] = p0[i], [x2, z2] = p0[(i + 1) % n]; area += x1 * z2 - x2 * z1; }
    let ccw = area > 0;
    if (invert) ccw = !ccw;
    const per = [0];
    for (let i = 1; i <= n; i++) { const a = p0[i - 1], b = p0[i % n]; per.push(per[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
    const pos = [], uv = [], idx = [];
    for (const r of rings) {
        for (let i = 0; i <= n; i++) {
            const [x, z] = r.pts[i % n];
            pos.push(x, r.y, z);
            uv.push(per[i], r.y);
        }
    }
    const row = n + 1;
    for (let r = 0; r < rings.length - 1; r++) {
        for (let i = 0; i < n; i++) {
            const a = r * row + i, b = a + 1, c = a + row, d = c + 1;
            if (ccw) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
        }
    }
    if (cap) {
        const top = rings[rings.length - 1];
        const base = pos.length / 3;
        const [cx, cz] = centroidOf(top.pts);
        pos.push(cx, top.y, cz);
        uv.push(cx, cz);
        for (const [x, z] of top.pts) { pos.push(x, top.y, z); uv.push(x, z); }
        for (let i = 0; i < n; i++) {
            const a = base + 1 + i, b = base + 1 + (i + 1) % n;
            if (ccw) idx.push(base, b, a); else idx.push(base, a, b);
        }
    }
    let g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    if (flat) g = g.toNonIndexed();
    g.computeVertexNormals();
    return g;
}

function mergeGeometries(list) {
    const pos = [], nrm = [], uv = [];
    for (let g of list) {
        if (g.index) g = g.toNonIndexed();
        pos.push(...g.attributes.position.array);
        nrm.push(...g.attributes.normal.array);
        uv.push(...g.attributes.uv.array);
    }
    const m = new THREE.BufferGeometry();
    m.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    m.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
    m.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    return m;
}

/** Башня / рубка: стенки сужаются кверху по наклонам брони, литые — со скруглённым верхом */
function turretGeometry(def) {
    const key = def.id + ":turret";
    if (geoCache.has(key)) return geoCache.get(key);
    const T = def.turret;
    let g;
    if (T.open) {
        const outer = [{ pts: turretSlopeRing(def, 0), y: 0 }, { pts: turretSlopeRing(def, 1), y: T.h }];
        const inner = outer.map((r, i) => ({ pts: shrink(r.pts, 0.88), y: i ? T.h : 0.05 }));
        const rim = [outer[1], { pts: inner[1].pts, y: T.h }];
        g = mergeGeometries([
            loftGeometry(outer, { cap: false, flat: true }),
            loftGeometry(inner, { cap: false, flat: true, invert: true }),
            loftGeometry(rim, { cap: false, flat: true }),
        ]);
    } else {
        const prof = ROUNDING[T.shape] || (T.casemate ? ROUNDING.casemate : ROUNDING.welded);
        const rings = prof.map(([fy, k]) => ({ pts: shrink(turretSlopeRing(def, fy), k), y: fy * T.h }));
        g = loftGeometry(rings, { cap: true, flat: !!FLAT[T.shape] });
    }
    g.userData.shared = true;
    geoCache.set(key, g);
    return g;
}

/**
 * Гусеница в профиль — скруглённая трапеция: опорная ветвь короче верхней,
 * ведущее колесо и ленивец приподняты над землёй.
 */
function trackGeometry(def) {
    const key = def.id + ":track";
    if (geoCache.has(key)) return geoCache.get(key);
    const { L, th, tw } = def.dims;
    const rS = th * 0.46;
    const Lt = L * 0.99;
    const Lb = L * (def.susp.type === "christie" ? 0.8 : 0.76);
    const cy = th - rS, cxF = Lt / 2 - rS, cxR = -Lt / 2 + rS;
    const a0 = -1.05;
    const shape = new THREE.Shape();
    shape.moveTo(-Lb / 2, 0);
    shape.lineTo(Lb / 2, 0);
    shape.lineTo(cxF + rS * Math.cos(a0), cy + rS * Math.sin(a0));
    shape.absarc(cxF, cy, rS, a0, Math.PI / 2, false);
    shape.lineTo(cxR, th);
    shape.absarc(cxR, cy, rS, Math.PI / 2, Math.PI - a0, false);
    shape.lineTo(-Lb / 2, 0);
    const g = new THREE.ExtrudeGeometry(shape, { depth: tw, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.025, bevelSegments: 1, curveSegments: 10 });
    g.translate(0, 0, -tw / 2);
    g.computeVertexNormals();
    g.userData.shared = true;
    g.userData.dims = { Lt, Lb, rS };
    geoCache.set(key, g);
    return g;
}

/**
 * Модель машины. Структура:
 * root (позиция/курс) → hull, tracks, details, turret (поворот) → gun (поворот в рубке) → barrel (откат)
 */
export function buildVehicleMesh(def, biomeKey) {
    const { L, W, H, tw, th } = def.dims;
    const T = def.turret;
    const camo = camoMat(def.paint, biomeKey);
    const root = new THREE.Group();
    const meshes = [];
    const add = (parent, mesh) => {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        parent.add(mesh);
        meshes.push(mesh);
        return mesh;
    };

    add(root, new THREE.Mesh(hullGeometry(def), camo));

    // гусеницы: лента со скроллом траков, на борту — ходовая по типу подвески
    const tg = trackGeometry(def);
    const { Lt, Lb, rS } = tg.userData.dims;
    const gear = runningGearTexture(def, Lt, Lb, rS);
    gear.repeat.set(1 / Lt, 1 / th);
    gear.offset.set(0.5, 0);
    const tracks = [];
    for (let s = 0; s < 2; s++) {
        const belt = trackTexture().clone();
        belt.needsUpdate = true;
        belt.repeat.set(1 / 0.7, 1 / tw);
        const beltMat = new THREE.MeshStandardMaterial({ map: belt, roughness: 0.95, metalness: 0.25 });
        const sideMat = new THREE.MeshStandardMaterial({ map: gear, roughness: 0.9, metalness: 0.2 });
        const m = add(root, new THREE.Mesh(tg, [sideMat, beltMat]));
        m.position.set(0, 0, (s === 0 ? -1 : 1) * (W / 2 - tw / 2));
        tracks.push({ mesh: m, tex: belt, mats: [beltMat, sideMat] });
    }
    // надгусеничные полки по всей длине с отогнутыми передним и задним щитками
    const flen = Lt * 0.93;
    const fGeo = new THREE.BoxGeometry(flen, 0.05, tw + 0.1);
    const flapGeo = new THREE.BoxGeometry(0.42, 0.05, tw + 0.1);
    for (const s of [-1, 1]) {
        const z = s * (W / 2 - tw / 2);
        const f = add(root, new THREE.Mesh(fGeo, camo));
        f.position.set(0, th + 0.035, z);
        for (const fx of [1, -1]) {
            const fl = add(root, new THREE.Mesh(flapGeo, camo));
            fl.rotation.z = -fx * 0.5;
            fl.position.set(fx * (flen / 2 + 0.185), th + 0.035 - 0.1, z);
        }
    }

    const det = def.details || {};
    // выхлоп
    for (let i = 0; i < (det.exhaust || 0); i++) {
        const e = add(root, new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.42, 8), DARK));
        e.rotation.z = Math.PI / 2;
        e.position.set(-L / 2 - 0.05, H * 0.62, (i - (det.exhaust - 1) / 2) * W * 0.32);
    }
    // решётки МТО
    const grille = add(root, new THREE.Mesh(new THREE.BoxGeometry(L * 0.2, 0.04, (W - 2 * tw) * 0.62), DARK));
    grille.position.set(-L * 0.3, H + 0.02, 0);
    // люк мехвода
    const hatch = add(root, new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.08, 0.5), STEEL));
    const frontTopX = L / 2 - def.profile.ft;
    hatch.position.set(Math.min(frontTopX + 0.1, L * 0.33), H - 0.02, -(W - 2 * tw) * 0.22);
    // ящики ЗИП на полках
    for (const [s, fx] of [[-1, 0.06], [1, -0.14]]) {
        const bx = add(root, new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.2, tw * 0.72), DARK));
        bx.position.set(L * fx, th + 0.16, s * (W / 2 - tw / 2));
    }
    // бочки (советские) — на корме полок
    if (det.drums) {
        for (const s of [-1, 1]) {
            const d = add(root, new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.7, 10), DARK));
            d.rotation.z = Math.PI / 2;
            d.position.set(-L * 0.36, th + 0.25, s * (W / 2 - tw / 2));
        }
    }
    // противокумулятивные экраны — подвешены к полкам
    if (det.skirts) {
        const skH = th * 0.78;
        for (const s of [-1, 1]) {
            const sk = add(root, new THREE.Mesh(new THREE.BoxGeometry(flen * 0.86, skH, 0.05), camo));
            sk.position.set(L * 0.02, th + 0.04 - skH / 2, s * (W / 2 + 0.06));
        }
    }

    // Башня / рубка
    const turret = new THREE.Group();
    turret.position.set(T.x, H, 0);
    root.add(turret);
    add(turret, new THREE.Mesh(turretGeometry(def), camo));
    if (T.open) {
        const fl = shrink(turretSlopeRing(def, 0), 0.86);
        const xs = fl.map((p) => p[0]), zs = fl.map((p) => p[1]);
        const floor = add(turret, new THREE.Mesh(new THREE.BoxGeometry(Math.max(...xs) - Math.min(...xs), 0.04, Math.max(...zs) - Math.min(...zs)), INTERIOR));
        floor.position.set((Math.max(...xs) + Math.min(...xs)) / 2, 0.04, 0);
        // головы экипажа в открытой рубке
        for (const s of def.crew) {
            const seat = def.seats[s];
            if (!seat || seat.frame !== "turret") continue;
            const hd = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), HEAD);
            hd.position.set(seat.c[0], 0.55, seat.c[2]);
            turret.add(hd);
        }
    }
    if (det.cupola && !T.open) {
        const cs = def.seats.commander;
        const cp = add(turret, new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.33, 0.22, 14), camo));
        cp.position.set(cs ? cs.c[0] * 0.9 : -T.hl * 0.45, T.h + 0.08, cs ? cs.c[2] * 0.9 : -T.hw * 0.27);
        const lid = add(turret, new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.05, 14), STEEL));
        lid.position.set(cp.position.x, T.h + 0.21, cp.position.z);
    } else if (!T.open) {
        const ht = add(turret, new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.06, 12), STEEL));
        ht.position.set(-T.hl * 0.32, T.h + 0.03, T.hw * 0.22);
    }

    // Орудие: цилиндрическая маска и ствол
    const gun = new THREE.Group();
    gun.position.set(def.gunPivot[0], def.gunPivot[1], 0);
    turret.add(gun);
    const cal = def.gun.cal / 1000;
    const mantW = Math.min(T.hw * 0.95, 0.4 + cal * 4);
    const mantR = Math.min(T.h * 0.4, 0.15 + cal * 1.4);
    const mGeo = T.casemate ? new THREE.SphereGeometry(mantR * 1.05, 14, 10) : new THREE.CylinderGeometry(mantR, mantR, mantW, 16);
    if (!T.casemate) mGeo.rotateX(Math.PI / 2);
    const mant = add(gun, new THREE.Mesh(mGeo, camo));
    if (T.casemate) mant.scale.set(0.8, 1, 1.25);
    mant.position.set(0.02, 0, 0);
    const barrel = new THREE.Group();
    gun.add(barrel);
    const r0 = Math.max(0.045, cal * 0.95), r1 = Math.max(0.04, cal * 0.72);
    const len = def.gun.len;
    const bm = add(barrel, new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, len, 10), camo));
    bm.rotation.z = -Math.PI / 2;
    bm.position.x = len / 2 + 0.15;
    if (def.gun.brake) {
        const mb = add(barrel, new THREE.Mesh(new THREE.CylinderGeometry(r1 * 1.7, r1 * 1.7, Math.max(0.22, cal * 4), 10), DARK));
        mb.rotation.z = -Math.PI / 2;
        mb.position.x = len + 0.05;
    }
    if (def.gun.mag > 1) {
        const mg = add(gun, new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.12), DARK));
        mg.position.set(-0.1, 0.12, 0.14);
    }

    return { root, turret, gun, barrel, tracks, meshes, camo, def };
}

/** Освободить GPU-ресурсы модели (кроме общих геометрий и материалов) */
export function disposeVehicleMesh(vm) {
    const roots = [vm.root];
    if (vm.turret && vm.turret.parent !== vm.root) roots.push(vm.turret);
    for (const r of roots) {
        r.traverse((o) => {
            if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
        });
    }
    for (const t of vm.tracks) {
        t.tex.dispose();
        for (const m of t.mats) m.dispose();
    }
}

/** Перекрасить в «сгоревший» вид */
export function burnMesh(vm) {
    for (const m of vm.meshes) m.material = BURNT;
}
