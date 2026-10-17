import { rayAabb, clamp, DEG } from "../core/Utils.js";
import { SHELL_TYPES, penAt } from "../data/Shells.js";

/* ─────────── Преобразования систем координат ───────────
 * hull   — центр корпуса на земле, x вперёд, y вверх, z вправо
 * turret — центр башни на крыше корпуса, поворачивается вместе с башней
 * gun    — цапфы орудия; в рубке ПТ-САУ поворачивается в секторе наводки
 */
const rot = (p, a) => {
    const c = Math.cos(a), s = Math.sin(a);
    return [p[0] * c - p[2] * s, p[1], p[0] * s + p[2] * c];
};
const irot = (p, a) => {
    const c = Math.cos(a), s = Math.sin(a);
    return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c];
};

export function worldToHull(v, p) { return irot([p[0] - v.x, p[1], p[2] - v.z], v.a); }
export function hullToWorld(v, p) { const r = rot(p, v.a); return [r[0] + v.x, r[1], r[2] + v.z]; }
export function dirWorldToHull(v, d) { return irot(d, v.a); }
export function dirHullToWorld(v, d) { return rot(d, v.a); }

function turretOrigin(v) { return [v.def.turret.x, v.def.dims.H, 0]; }

export function frameToHull(v, frame, p) {
    if (frame === "hull") return p;
    let q = p;
    if (frame === "gun") {
        const piv = v.def.gunPivot;
        const r = rot(q, v.gunRel());
        q = [r[0] + piv[0], r[1] + piv[1], r[2] + piv[2]];
    }
    const r = rot(q, v.turretRel());
    const o = turretOrigin(v);
    return [r[0] + o[0], r[1] + o[1], r[2] + o[2]];
}

export function hullToFrame(v, frame, p) {
    if (frame === "hull") return p;
    const o = turretOrigin(v);
    let q = irot([p[0] - o[0], p[1] - o[1], p[2] - o[2]], v.turretRel());
    if (frame === "gun") {
        const piv = v.def.gunPivot;
        q = irot([q[0] - piv[0], q[1] - piv[1], q[2] - piv[2]], v.gunRel());
    }
    return q;
}

export function dirFrameToHull(v, frame, d) {
    if (frame === "hull") return d;
    let q = d;
    if (frame === "gun") q = rot(q, v.gunRel());
    return rot(q, v.turretRel());
}

export function dirHullToFrame(v, frame, d) {
    if (frame === "hull") return d;
    let q = irot(d, v.turretRel());
    if (frame === "gun") q = irot(q, v.gunRel());
    return q;
}

/** Мировые координаты дульного среза */
export function muzzleWorld(v) {
    return hullToWorld(v, frameToHull(v, "gun", [v.def.gun.len, 0, 0]));
}
export function gunPivotWorld(v) {
    return hullToWorld(v, frameToHull(v, "gun", [0, 0, 0]));
}

/* ─────────── Пересечение луча с выпуклым многогранником (Кируса–Бека) ─────────── */
export function rayConvex(o, d, planes, tMax = Infinity) {
    let tE = -Infinity, tX = Infinity, pE = null;
    for (const p of planes) {
        const den = p.n[0] * d[0] + p.n[1] * d[1] + p.n[2] * d[2];
        const num = p.d - (p.n[0] * o[0] + p.n[1] * o[1] + p.n[2] * o[2]);
        if (Math.abs(den) < 1e-12) {
            if (num < 0) return null;
            continue;
        }
        const t = num / den;
        if (den < 0) { if (t > tE) { tE = t; pE = p; } }
        else if (t < tX) tX = t;
        if (tE > tX) return null;
    }
    if (tX < 0 || tE > tMax || !pE) return null;
    return { t0: tE, t1: tX, plane: pE };
}

/**
 * Первая деталь машины на луче (в мировых координатах).
 * skip — множество id деталей, которые нужно пропустить (уже пройденные экраны).
 */
export function raycastVehicle(v, p0, dir, maxT, skip) {
    const o = worldToHull(v, p0), d = dirWorldToHull(v, dir);
    let best = null;
    for (const part of v.def.parts) {
        if (skip && skip.has(part.id)) continue;
        const o2 = part.frame === "hull" ? o : hullToFrame(v, part.frame, o);
        const d2 = part.frame === "hull" ? d : dirHullToFrame(v, part.frame, d);
        let r, n, face;
        if (part.kind === "convex") {
            r = rayConvex(o2, d2, part.planes, maxT);
            if (!r || r.t0 < 0) continue;
            n = r.plane.n; face = r.plane.face;
        } else {
            r = rayAabb(o2, d2, part.min, part.max, maxT);
            if (!r || r.t0 < 0) continue;
            n = [0, 0, 0]; n[r.axis] = r.sign;
            face = r.axis === 2 ? "side" : r.axis === 1 ? (r.sign > 0 ? "roof" : "bottom") : r.sign > 0 ? "front" : "rear";
        }
        if (!best || r.t0 < best.t) best = { part, t: r.t0, tExit: r.t1, o: o2, d: d2, n, face };
    }
    if (!best) return null;
    const pt = [best.o[0] + best.d[0] * best.t, best.o[1] + best.d[1] * best.t, best.o[2] + best.d[2] * best.t];
    return {
        part: best.part, id: best.part.id, frame: best.part.frame, t: best.t, tExit: best.tExit,
        point: pt, dir: best.d, normal: best.n, face: best.face,
        world: [p0[0] + dir[0] * best.t, p0[1] + dir[1] * best.t, p0[2] + dir[2] * best.t],
    };
}

const PLATE_NAMES = {
    hull: { front: "ВЛД", lower: "НЛД", side: "борт корпуса", rear: "корма корпуса", roof: "крыша корпуса", bottom: "днище" },
    turret: { front: "лоб башни", side: "борт башни", rear: "корма башни", roof: "крыша башни", bottom: "погон" },
    casemate: { front: "лоб рубки", side: "борт рубки", rear: "корма рубки", roof: "крыша рубки", bottom: "погон" },
};

/** Толщина и наклон бронелиста в точке попадания */
export function plateInfo(v, hit) {
    const A = v.def.armor;
    const id = hit.id;
    if (hit.part.spaced) {
        return { thick: hit.part.spaced, vslope: 0, name: hit.part.skirt ? "противокумулятивный экран" : "гусеница", spaced: true };
    }
    if (id === "barrel") return { thick: 25, vslope: 0, name: "ствол орудия", barrel: true };
    let src, names;
    if (id === "hull") { src = A.hull; names = PLATE_NAMES.hull; }
    else { src = A.turret; names = v.def.turret.casemate ? PLATE_NAMES.casemate : PLATE_NAMES.turret; }
    let face = hit.face;
    if (face === "bottom") face = id === "hull" ? "bottom" : "front";
    let thick, vslope = 0;
    if (face === "bottom") thick = 20;
    else {
        const a = src[face] || src.side;
        thick = a[0];
        // наклон бортов корпуса и стенок башни — аналитически
        if ((id !== "hull" || face === "side") && face !== "roof") vslope = a[1] || 0;
    }
    if (id === "turret" && face === "roof" && v.def.turret.open) thick = 0;
    return { thick, vslope, name: names[face] || face, face };
}

/** Нормаль с учётом наклона листа от вертикали */
function tiltedNormal(n, vslope) {
    if (!vslope || Math.abs(n[1]) > 0.3) return n;
    const hl = Math.hypot(n[0], n[2]) || 1;
    const c = Math.cos(vslope * DEG), s = Math.sin(vslope * DEG);
    return [(n[0] / hl) * c, s, (n[2] / hl) * c];
}

/**
 * Детерминированная оценка: приведённая броня, угол, шанс рикошета.
 * pen0 — пробитие снаряда в этой точке (с учётом дистанции и экранов)
 */
export function evalPlate(shell, v, hit, pen0) {
    const info = plateInfo(v, hit);
    const T = SHELL_TYPES[shell.type];
    const n = tiltedNormal(hit.normal, info.vslope);
    const d = hit.dir;
    const cosT = clamp(-(d[0] * n[0] + d[1] * n[1] + d[2] * n[2]), 0, 1);
    const theta = Math.acos(cosT) / DEG;
    const overmatch = shell.type !== "HEAT" && shell.type !== "HE" && info.thick > 0 && shell.cal > info.thick * 2.6;
    const norm = shell.type === "HE" ? 0 : overmatch ? Math.max(T.norm, theta * 0.35) : T.norm;
    const thetaN = Math.max(0, theta - norm);
    const eff = info.thick / Math.max(0.14, Math.cos(thetaN * DEG));
    const ricoP = shell.type === "HE" || overmatch || info.thick === 0 ? 0 :
        clamp((theta - T.ricoStart) / (T.ricoFull - T.ricoStart), 0, 1);
    return { info, theta, eff, pen: pen0, ricoP, overmatch, canPen: pen0 >= eff, normal: n };
}

/** Потеря пробития на разнесённой броне (гусеница / экран) */
export function spacedLoss(shell, ev) {
    if (shell.type === "HEAT") return ev.info.skirt ? 0.5 : 0.35;   // доля потери кумулятивной струи
    return ev.eff;                                              // мм для кинетики
}

/**
 * Трассировка выстрела до первой «основной» детали (корпус / башня / ствол)
 * через гусеницы и экраны. Не меняет состояние машины.
 * Возвращает { layers:[{hit, ev}], main:{hit, ev}|null, pen }
 */
export function traceShot(shell, v, p0, dir, maxT, distance) {
    let pen = penAt(shell, distance);
    const skip = new Set();
    const layers = [];
    let origin = p0;
    let tAcc = 0;
    for (let i = 0; i < 4; i++) {
        const hit = raycastVehicle(v, origin, dir, maxT - tAcc, skip);
        if (!hit) return { layers, main: null, pen };
        hit.t += tAcc;
        const ev = evalPlate(shell, v, hit, pen);
        if (hit.part.spaced) {
            layers.push({ hit, ev });
            skip.add(hit.id);
            if (shell.type === "HE") return { layers, main: null, pen, stoppedBy: hit };
            const loss = spacedLoss(shell, ev);
            pen = shell.type === "HEAT" ? pen * (1 - loss) - ev.info.thick : pen - loss;
            if (pen <= 0) return { layers, main: null, pen: 0, stoppedBy: hit };
            // продолжаем от точки выхода из экрана
            const tt = Math.max(hit.tExit - (hit.t - tAcc), 0) + (hit.t - tAcc) + 0.01;
            origin = [origin[0] + dir[0] * tt, origin[1] + dir[1] * tt, origin[2] + dir[2] * tt];
            tAcc += tt;
            continue;
        }
        return { layers, main: { hit, ev: evalPlate(shell, v, hit, pen) }, pen };
    }
    return { layers, main: null, pen };
}
