import * as THREE from "three";
import { plateInfo } from "../sim/Armor.js";

/* ─────────── Модель зон брони для ангара ───────────
 * Строится прямо из деталей попадания (def.parts), поэтому показывает ровно то,
 * во что попадают снаряды: каждая грань — отдельный меш с толщиной своего листа.
 */

/** Шкала цвета по толщине листа, мм */
export const ARMOR_SCALE = [
    [0, "#3d7bd9"], [15, "#3fb6d6"], [30, "#3fcf8e"], [50, "#a6dc3c"],
    [80, "#f2d03b"], [110, "#f39a2e"], [150, "#e8483a"], [220, "#b0205a"],
];
const SCALE = ARMOR_SCALE.map(([t, c]) => [t, new THREE.Color(c)]);

export function armorColor(mm) {
    if (mm <= SCALE[0][0]) return SCALE[0][1].clone();
    for (let i = 1; i < SCALE.length; i++) {
        if (mm <= SCALE[i][0]) {
            const [t0, c0] = SCALE[i - 1], [t1, c1] = SCALE[i];
            return c0.clone().lerp(c1, (mm - t0) / (t1 - t0));
        }
    }
    return SCALE[SCALE.length - 1][1].clone();
}

/** Плоскости коробки в формате выпуклой детали + названия граней, как в raycastVehicle */
function boxPlanes(part) {
    const { min, max } = part;
    const fm = part.faceMap || {};
    const f = (k) => fm[k] || k;
    return [
        { n: [1, 0, 0], d: max[0], face: f("front") }, { n: [-1, 0, 0], d: -min[0], face: f("rear") },
        { n: [0, 1, 0], d: max[1], face: f("roof") }, { n: [0, -1, 0], d: -min[1], face: f("bottom") },
        { n: [0, 0, 1], d: max[2], face: "side" }, { n: [0, 0, -1], d: -min[2], face: "side" },
    ];
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Многоугольник грани выпуклого тела: большой квадрат в плоскости, отсечённый остальными плоскостями */
function facePolygon(planes, i) {
    const P = planes[i], n = P.n;
    const ref = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let u = [n[1] * ref[2] - n[2] * ref[1], n[2] * ref[0] - n[0] * ref[2], n[0] * ref[1] - n[1] * ref[0]];
    const ul = Math.hypot(...u); u = u.map((x) => x / ul);
    const v = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
    const c = n.map((x) => x * P.d), R = 50;
    let poly = [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([a, b]) => [0, 1, 2].map((k) => c[k] + (u[k] * a + v[k] * b) * R));
    for (let j = 0; j < planes.length && poly.length; j++) {
        if (j === i) continue;
        const Q = planes[j];
        const out = [];
        for (let k = 0; k < poly.length; k++) {
            const a = poly[k], b = poly[(k + 1) % poly.length];
            const da = dot(Q.n, a) - Q.d, db = dot(Q.n, b) - Q.d;
            if (da <= 1e-7) out.push(a);
            if ((da < -1e-7 && db > 1e-7) || (da > 1e-7 && db < -1e-7)) {
                const t = da / (da - db);
                out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
            }
        }
        poly = out;
    }
    return poly.length >= 3 ? poly : null;
}

function polyGeometry(poly) {
    const pos = [];
    for (let k = 1; k < poly.length - 1; k++) pos.push(...poly[0], ...poly[k], ...poly[k + 1]);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
}

function edgeGeometry(poly) {
    const pos = [];
    for (let k = 0; k < poly.length; k++) pos.push(...poly[k], ...poly[(k + 1) % poly.length]);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    return g;
}

const MODULE_COL = {
    ammo: 0xff4d3d, fuel: 0xff9a2e, engine: 0x9aa7b4, transmission: 0x7d8a96, breech: 0xc9b07a,
    barrel: 0x8c8a80, drive: 0xb48cff, track: 0x50565c,
};

/**
 * Модель брони. mode: "armor" — непрозрачные зоны брони; "modules" — броня полупрозрачная,
 * внутри видны модули и экипаж.
 */
export function buildArmorModel(def) {
    const fake = { def, turretRel: () => 0, gunRel: () => 0 };
    const root = new THREE.Group();
    const frames = {
        hull: root,
        turret: new THREE.Group(),
        gun: new THREE.Group(),
    };
    frames.turret.position.set(def.turret.x, def.dims.H, 0);
    frames.gun.position.set(def.gunPivot[0], def.gunPivot[1], def.gunPivot[2]);
    root.add(frames.turret);
    frames.turret.add(frames.gun);
    const faces = [];
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x0b0e12, transparent: true, opacity: 0.55 });
    for (const part of def.parts) {
        const planes = part.kind === "convex" ? part.planes : boxPlanes(part);
        for (let i = 0; i < planes.length; i++) {
            if (planes[i].face === "inner") continue;
            const poly = facePolygon(planes, i);
            if (!poly) continue;
            const info = plateInfo(fake, { id: part.id, part, face: planes[i].face });
            const col = part.spaced ? new THREE.Color(0x5a6068) : armorColor(info.thick);
            const mat = new THREE.MeshStandardMaterial({
                color: col, roughness: 0.75, metalness: 0.05, side: THREE.DoubleSide,
                transparent: true, opacity: part.spaced ? 0.55 : 1,
                polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
            });
            const m = new THREE.Mesh(polyGeometry(poly), mat);
            m.userData = { part, normal: planes[i].n, base: col.clone(), spaced: !!part.spaced };
            frames[part.frame].add(m);
            frames[part.frame].add(new THREE.LineSegments(edgeGeometry(poly), edgeMat));
            faces.push(m);
        }
    }
    // модули и экипаж (видны в режиме «модули»)
    const inner = new THREE.Group();
    const innerFrames = { hull: inner, turret: new THREE.Group(), gun: new THREE.Group() };
    innerFrames.turret.position.copy(frames.turret.position);
    innerFrames.gun.position.copy(frames.gun.position);
    inner.add(innerFrames.turret);
    innerFrames.turret.add(innerFrames.gun);
    for (const m of def.modules) {
        if (m.type === "track") continue;
        const sx = m.max[0] - m.min[0], sy = m.max[1] - m.min[1], sz = m.max[2] - m.min[2];
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz),
            new THREE.MeshStandardMaterial({ color: MODULE_COL[m.type] || 0x999999, roughness: 0.6, emissive: MODULE_COL[m.type] || 0, emissiveIntensity: 0.18 }));
        mesh.position.set((m.min[0] + m.max[0]) / 2, (m.min[1] + m.max[1]) / 2, (m.min[2] + m.max[2]) / 2);
        innerFrames[m.frame].add(mesh);
    }
    for (const s of Object.values(def.seats)) {
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(s.r * 0.75, 14, 10),
            new THREE.MeshStandardMaterial({ color: 0x59b4ff, roughness: 0.5, emissive: 0x2a6fbf, emissiveIntensity: 0.35 }));
        mesh.position.set(...s.c);
        innerFrames[s.frame].add(mesh);
    }
    inner.visible = false;
    root.add(inner);

    let lit = null;
    return {
        root, faces, fake,
        setMode(mode) {
            const xr = mode === "modules";
            inner.visible = xr;
            for (const f of faces) {
                f.material.opacity = xr ? (f.userData.spaced ? 0.08 : 0.16) : f.userData.spaced ? 0.55 : 1;
                f.material.depthWrite = !xr && !f.userData.spaced;
            }
            edgeMat.opacity = xr ? 0.25 : 0.55;
        },
        /** Подсветка грани, в которую смотрит курсор */
        highlight(hit) {
            const match = hit ? faces.filter((f) => f.userData.part === hit.part && dot(f.userData.normal, hit.normal) > 0.995) : [];
            if (lit) for (const f of lit) f.material.emissive.setHex(0);
            lit = match;
            for (const f of match) f.material.emissive.setHex(0x5a5a5a);
        },
        dispose() {
            root.traverse((o) => {
                if (o.geometry) o.geometry.dispose();
                if (o.material) o.material.dispose();
            });
        },
    };
}
