import * as THREE from "three";
import { camoTexture, trackTexture, runningGearTexture } from "./Textures.js";
import { turretSlopeRing, hullHalfWidth, skirtSpan } from "../data/VehicleBuild.js";
import { createKV1, layoutTrack as layoutKV1Track, mergeGeometries as mergeModel } from "./models/KV1Model.js";

/** Детальные модели (иначе машина строится процедурно по описанию) */
const DETAILED = { kv1: { create: createKV1, layoutTrack: layoutKV1Track } };
const detailedTemplates = new Map();

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

/** Профиль корпуса сбоку одним многоугольником (против часовой стрелки) */
function profilePoly(def) {
    return [...def.profile.front.slice().reverse(), ...def.profile.rear];
}

/** Отсечь многоугольник профиля ниже y0 */
function clipAbove(poly, y0) {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        const ina = a[1] >= y0, inb = b[1] >= y0;
        if (ina) out.push(a);
        if (ina !== inb) {
            const t = (y0 - a[1]) / (b[1] - a[1]);
            out.push([a[0] + (b[0] - a[0]) * t, y0]);
        }
    }
    return out;
}

/** Выдавливание профиля на ширину, зависящую от высоты (наклонные борта ниш) */
function extrudeProfile(pts, bevel, halfWidthAt) {
    const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, steps: 1 });
    g.translate(0, 0, -1);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
        const z = p.getZ(i), az = Math.abs(z), sg = Math.sign(z) || 1;
        const hw = halfWidthAt(p.getY(i));
        p.setZ(i, az >= 1 ? sg * (hw + az - 1) : z * hw);
    }
    g.computeVertexNormals();
    return g;
}

function hullGeometry(def) {
    const key = def.id + ":hull";
    if (geoCache.has(key)) return geoCache.get(key);
    const F = def.form;
    const poly = profilePoly(def);
    // нижняя часть — между гусеницами; надгусеничные ниши — отдельным, более широким телом
    let g = extrudeProfile(poly, 0.05, () => F.iw / 2 + 0.01);
    if (F.has) {
        const up = extrudeProfile(clipAbove(poly, F.yf), 0.035, (y) => hullHalfWidth(def, Math.max(F.yf, y)) - 0.035);
        g = mergeGeometries([g, up]);
    }
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
export function buildVehicleMesh(def, biomeKey, opts = {}) {
    if (def.model && DETAILED[def.model]) return buildDetailed(def, biomeKey, !!opts.full);
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
    // надгусеничные полки по всей длине с отогнутыми передним и задним щитками;
    // если полка выступает из-под корпуса — с отбортовкой по внешнему краю
    const flen = Lt * 0.93;
    const fGeo = new THREE.BoxGeometry(flen, 0.06, tw + 0.1);
    const flapGeo = new THREE.BoxGeometry(0.42, 0.06, tw + 0.1);
    const openShelf = W / 2 - (def.form.has ? def.form.sw : def.form.iw / 2) > 0.15;
    const lipGeo = openShelf ? new THREE.BoxGeometry(flen, 0.09, 0.035) : null;
    for (const s of [-1, 1]) {
        const z = s * (W / 2 - tw / 2);
        const f = add(root, new THREE.Mesh(fGeo, camo));
        f.position.set(0, th + 0.03, z);
        for (const fx of [1, -1]) {
            const fl = add(root, new THREE.Mesh(flapGeo, camo));
            fl.rotation.z = -fx * 0.5;
            fl.position.set(fx * (flen / 2 + 0.185), th + 0.03 - 0.1, z);
        }
        if (lipGeo) {
            const lip = add(root, new THREE.Mesh(lipGeo, camo));
            lip.position.set(0, th + 0.045, s * (W / 2 + 0.035));
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
    // ящики ЗИП: на открытой части полки, а если её закрывают ниши — на крыше у борта
    const F = def.form;
    const shelf = W / 2 - (F.has ? F.sw : F.iw / 2) - 0.04;
    for (const [s, fx] of [[-1, 0.06], [1, -0.14]]) {
        if (shelf >= 0.2) {
            const bx = add(root, new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.2, shelf * 0.9), DARK));
            bx.position.set(L * fx, th + 0.16, s * (W / 2 - shelf * 0.5 - 0.02));
        } else {
            const bx = add(root, new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.14, 0.3), DARK));
            bx.position.set(-L * 0.12 + L * fx, H + 0.07, s * (hullHalfWidth(def, H) - 0.22));
        }
    }
    // бочки (советские) — на корме, снаружи бортов
    if (det.drums) {
        for (const s of [-1, 1]) {
            const d = add(root, new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.7, 10), DARK));
            d.rotation.z = Math.PI / 2;
            const y = (F.has ? F.yf : th) + 0.22;
            const z = shelf >= 0.36 ? W / 2 - shelf / 2 : Math.min(W / 2 - 0.05, hullHalfWidth(def, y) + 0.12);
            d.position.set(-L * 0.36, y, s * z);
        }
    }
    // противокумулятивные экраны — на кронштейнах вдоль борта
    if (det.skirts) {
        const { y0, y1 } = skirtSpan(def);
        for (const s of [-1, 1]) {
            const sk = add(root, new THREE.Mesh(new THREE.BoxGeometry(L * 0.76, y1 - y0, 0.05), camo));
            sk.position.set(L * 0.02, (y0 + y1) / 2, s * (W / 2 + 0.05));
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
            if (o.isInstancedMesh) o.dispose();
        });
    }
    if (vm.disposeExtra) vm.disposeExtra();
    for (const t of vm.tracks) {
        t.tex.dispose();
        for (const m of t.mats) m.dispose();
    }
}

/** Перекрасить в «сгоревший» вид */
export function burnMesh(vm) {
    for (const m of vm.meshes) m.material = BURNT;
}

/* ─────────── Детальные модели (js/render/models) ───────────
 * Модель строится в своих осях (+Z нос, +X левый борт) и вкладывается в игровой корень,
 * повёрнутый на 90°. В бою используется «запечённая» копия: неподвижные детали слиты
 * по материалам (несколько вызовов отрисовки вместо сотен), катки и гусеницы — отдельно.
 */
function paintDarkOf(camo) {
    const key = camo.uuid + ":dark";
    if (matCache.has(key)) return matCache.get(key);
    const m = camo.clone();
    m.color.setHex(0xa8a8a8);
    matCache.set(key, m);
    return m;
}

function bakeDetailed(kv) {
    // внутреннее устройство в бою не показывается
    for (const g of [...kv.modules, ...kv.crew, ...kv.zones]) g.parent.remove(g);
    kv.root.updateMatrixWorld(true);
    const buckets = [kv.hull, kv.turret, kv.gun];
    const keep = new Set([...kv.wheels, ...kv.tracks]);
    const groups = new Map();
    const remove = [];
    kv.root.traverse((o) => {
        if (o.isLineSegments) { remove.push(o); return; }
        if (!o.isMesh || o.isInstancedMesh || keep.has(o) || o.userData.recoil) return;
        let b = o.parent;
        while (b && !buckets.includes(b)) b = b.parent;
        if (!b) return;
        const key = b.name + "|" + o.material.uuid;
        if (!groups.has(key)) groups.set(key, { bucket: b, material: o.material, geos: [] });
        const g = o.geometry.clone();
        g.applyMatrix4(new THREE.Matrix4().copy(b.matrixWorld).invert().multiply(o.matrixWorld));
        groups.get(key).geos.push(g);
        remove.push(o);
    });
    for (const o of remove) if (o.parent) o.parent.remove(o);
    for (const { bucket, material, geos } of groups.values()) {
        const m = new THREE.Mesh(mergeModel(geos), material);
        m.castShadow = m.receiveShadow = true;
        bucket.add(m);
    }
    kv.root.traverse((o) => { if (o.geometry) o.geometry.userData.shared = true; });
    return kv;
}

function wrapDetailed(def, model, camo, kv) {
    const layoutTrack = DETAILED[def.model].layoutTrack;
    const root = new THREE.Group();
    const frame = new THREE.Group();
    frame.rotation.y = Math.PI / 2;          // +Z модели → +X игры
    root.add(frame);
    frame.add(model);
    const turret = model.getObjectByName("turret");
    const gun = model.getObjectByName("gun");
    const barrel = model.getObjectByName("barrel");
    const tracks = [model.getObjectByName("track_L"), model.getObjectByName("track_R")];
    const wheels = [];
    model.traverse((o) => { if (o.name.startsWith("wheel:")) wheels.push(o); });
    const meshes = [];
    model.traverse((o) => { if (o.isMesh && o.userData.kind !== "module" && !o.userData.moduleId && !o.userData.crewId && o.userData.kind !== "zone" && o.userData.kind !== "rounds") meshes.push(o); });
    for (const m of meshes) { m.castShadow = true; m.receiveShadow = true; }
    let phase = [NaN, NaN];
    const vm = {
        root, turret, gun, tracks: [], meshes, camo, def, detailed: true, model: kv || null,
        // откат ствола: в игре — вдоль +X, в модели — вдоль +Z
        barrel: { position: { set x(v) { if (barrel) barrel.position.z = v; }, get x() { return barrel ? barrel.position.z : 0; } } },
        setTrackPhase(ph) {
            if (kv) { kv.setTrackPhase(ph[0], ph[1]); return; }
            if (ph[0] === phase[0] && ph[1] === phase[1]) return;
            phase = [ph[0], ph[1]];
            for (const tr of tracks) if (tr) layoutTrack(tr, -(tr.userData.side > 0 ? ph[0] : ph[1]));
            for (const w of wheels) w.rotation.x = (w.userData.side > 0 ? ph[0] : ph[1]) / w.userData.radius;
        },
    };
    if (kv) {
        // полная модель (ангар): материалы этого экземпляра освобождаем вместе с ним
        vm.disposeExtra = () => kv.root.traverse((o) => {
            const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
            for (const m of ms) if (m !== camo && !matCacheHas(m)) m.dispose();
        });
    }
    return vm;
}

const matCacheHas = (m) => { for (const v of matCache.values()) if (v === m) return true; return false; };

function buildDetailed(def, biome, full) {
    const camo = camoMat(def.paint, biome);
    const paintDark = paintDarkOf(camo);
    const create = DETAILED[def.model].create;
    if (full) {
        const kv = create({ paint: camo, paintDark });
        return wrapDetailed(def, kv.root, camo, kv);
    }
    const key = def.id + ":" + biome;
    let tpl = detailedTemplates.get(key);
    if (!tpl) {
        tpl = bakeDetailed(create({ paint: camo, paintDark }));
        detailedTemplates.set(key, tpl);
    }
    return wrapDetailed(def, tpl.root.clone(true), camo, null);
}
