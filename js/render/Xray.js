import { clamp } from "../core/Utils.js";
import { Config } from "../core/Config.js";
import { CREW_SEATS } from "../data/Vehicles.js";
import { frameToHull } from "../sim/Armor.js";

export const STATE_COL = ["#b9c6d2", "#ffd23f", "#ff8a2a", "#ff4136"];

function stateOf(hp, max) {
    if (hp <= 0) return 3;
    const f = hp / max;
    return f >= Config.MOD_DMG ? 0 : f >= Config.MOD_CRIT ? 1 : 2;
}

/** Снимок состояния живой машины для схемы */
export function liveSnap(v) {
    const mods = {};
    for (const id in v.mods) mods[id] = { hp: v.mods[id].hp, max: v.mods[id].maxHp };
    const crew = {};
    for (const s in v.seats) {
        const o = v.seats[s].occupant;
        crew[s] = o ? { hp: o.hp, max: o.maxHp, alive: o.alive, present: !o.transit, home: o.home } : { hp: 0, max: 100, alive: false, present: false };
    }
    return { mods, crew, turretRel: v.turretRel(), gunRel: v.gunRel(), fills: v.rackFills(), fire: v.fire ? v.fire.pos : null, swap: v.swap };
}

export function freshSnap(def) {
    const mods = {};
    for (const m of def.modules) mods[m.id] = { hp: m.maxHp, max: m.maxHp };
    const crew = {};
    for (const s of def.crew) crew[s] = { hp: 100, max: 100, alive: true, present: true, home: s };
    const fills = {};
    for (const id of def.rackOrder) fills[id] = def.modules.find((m) => m.id === id).cap;
    return { mods, crew, turretRel: 0, gunRel: 0, fills };
}

/**
 * Рисует схему машины.
 * o: { def, snap, res, prog, x, y, w, h, labels, compact, highlight }
 */
export function drawScheme(g, o) {
    const def = o.def, snap = o.snap;
    const { L, W, tw } = def.dims;
    const iw = W - 2 * tw;
    const T = def.turret;
    const proxy = { def, turretRel: () => snap.turretRel, gunRel: () => snap.gunRel };
    const front = Math.max(L / 2, T.x + T.hl + def.gun.len * (o.compact ? 0.35 : 1));
    const x0 = -L / 2 - 0.4, x1 = front + 0.3;
    const pad = o.compact ? 4 : 18;
    const s = Math.min((o.w - pad * 2) / (x1 - x0), (o.h - pad * 2) / (W + 0.8));
    const cx = o.x + o.w / 2 - ((x0 + x1) / 2) * s, cy = o.y + o.h / 2;
    const X = (x) => cx + x * s, Y = (z) => cy + z * s;
    const P = (frame, p) => { const q = frameToHull(proxy, frame, p); return [X(q[0]), Y(q[2])]; };

    g.save();
    g.lineJoin = "round";
    // гусеницы
    g.strokeStyle = "rgba(150,170,190,.55)";
    g.fillStyle = "rgba(120,140,160,.08)";
    g.lineWidth = 1.2;
    for (const id of ["trackL", "trackR"]) {
        const m = def.modules.find((q) => q.id === id);
        const st = stateOf(snap.mods[id].hp, snap.mods[id].max);
        g.fillStyle = st ? hexA(STATE_COL[st], 0.35) : "rgba(120,140,160,.1)";
        g.fillRect(X(m.min[0]), Y(m.min[2]), (m.max[0] - m.min[0]) * s, (m.max[2] - m.min[2]) * s);
        g.strokeRect(X(m.min[0]), Y(m.min[2]), (m.max[0] - m.min[0]) * s, (m.max[2] - m.min[2]) * s);
    }
    // корпус
    g.fillStyle = "rgba(150,175,200,.07)";
    g.strokeStyle = "#a9bccd";
    g.lineWidth = 1.6;
    g.fillRect(X(-L / 2), Y(-iw / 2), L * s, iw * s);
    g.strokeRect(X(-L / 2), Y(-iw / 2), L * s, iw * s);
    // зона ВЛД
    const ft = def.profile.ft;
    g.fillStyle = "rgba(150,175,200,.12)";
    g.fillRect(X(L / 2 - ft), Y(-iw / 2), ft * s, iw * s);
    g.strokeStyle = "rgba(169,188,205,.35)";
    g.beginPath(); g.moveTo(X(L / 2 - ft), Y(-iw / 2)); g.lineTo(X(L / 2 - ft), Y(iw / 2)); g.stroke();

    // модули корпуса и башни
    const drawMod = (m) => {
        const sm = snap.mods[m.id];
        if (!sm) return;
        const st = stateOf(sm.hp, sm.max);
        const col = STATE_COL[st];
        const corners = [[m.min[0], m.min[2]], [m.max[0], m.min[2]], [m.max[0], m.max[2]], [m.min[0], m.max[2]]]
            .map(([x, z]) => P(m.frame, [x, m.c[1], z]));
        g.beginPath();
        corners.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py)));
        g.closePath();
        g.fillStyle = hexA(col, m.type === "ammo" ? 0.55 : 0.42);
        g.fill();
        g.strokeStyle = hexA(col, 0.95);
        g.lineWidth = 1.1;
        g.stroke();
        if (m.type === "ammo" && snap.fills) {
            const f = (snap.fills[m.id] || 0) / m.cap;
            // штриховка заполненности
            const [ax, ay] = corners[0], [bx, by] = corners[1], [dx, dy] = corners[3];
            const n = Math.max(1, Math.round(f * 6));
            g.strokeStyle = "rgba(20,24,30,.7)";
            g.lineWidth = 1;
            for (let k = 1; k <= n; k++) {
                const t = k / 7;
                g.beginPath();
                g.moveTo(ax + (bx - ax) * t, ay + (by - ay) * t);
                g.lineTo(dx + (bx - ax) * t, dy + (by - ay) * t);
                g.stroke();
            }
        }
        if (st === 3) cross(g, (corners[0][0] + corners[2][0]) / 2, (corners[0][1] + corners[2][1]) / 2, 4);
        if (!o.compact && o.labels && m.type !== "ammo") {
            const c = P(m.frame, m.c);
            g.fillStyle = "rgba(220,230,240,.55)";
            g.font = "9px Rubik, sans-serif";
            g.textAlign = "center";
            g.fillText(shortMod(m.type), c[0], c[1] + 3);
        }
    };
    for (const m of def.modules) if (m.frame === "hull" && m.type !== "track") drawMod(m);

    // башня
    const tp = def.turretPoly.map(([x, z]) => P("turret", [x, 0, z]));
    g.beginPath();
    tp.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py)));
    g.closePath();
    g.fillStyle = "rgba(150,175,200,.09)";
    g.fill();
    g.strokeStyle = "#c6d4e0";
    g.lineWidth = 1.6;
    if (T.open) g.setLineDash([4, 3]);
    g.stroke();
    g.setLineDash([]);
    // ствол
    const b0 = P("gun", [0.1, 0, 0]), b1 = P("gun", [def.gun.len * (o.compact ? 0.35 : 1), 0, 0]);
    const bst = stateOf(snap.mods.barrel.hp, snap.mods.barrel.max);
    g.strokeStyle = bst ? STATE_COL[bst] : "#c6d4e0";
    g.lineWidth = Math.max(2, def.gun.cal / 1000 * 1.6 * s);
    g.beginPath(); g.moveTo(b0[0], b0[1]); g.lineTo(b1[0], b1[1]); g.stroke();
    for (const m of def.modules) if (m.frame !== "hull" && m.type !== "barrel") drawMod(m);

    // экипаж
    for (const sname of def.crew) {
        const seat = def.seats[sname];
        const c = snap.crew[sname];
        const [px, py] = P(seat.frame, seat.c);
        const r = Math.max(4, seat.r * s * 0.95);
        if (!c.present && !c.alive) {
            g.strokeStyle = "rgba(180,190,200,.4)";
            g.setLineDash([2, 2]);
            g.beginPath(); g.arc(px, py, r, 0, 6.283); g.stroke();
            g.setLineDash([]);
            continue;
        }
        const st = c.alive ? stateOf(c.hp, c.max) : 3;
        const col = c.alive ? (st === 0 ? "#86d98f" : STATE_COL[st]) : "#ff4136";
        g.fillStyle = hexA(col, c.present ? 0.85 : 0.35);
        g.beginPath(); g.arc(px, py, r, 0, 6.283); g.fill();
        g.strokeStyle = "rgba(10,14,18,.75)";
        g.lineWidth = 1;
        g.stroke();
        // «голова»
        g.strokeStyle = "rgba(10,14,18,.6)";
        g.beginPath(); g.arc(px, py - r * 0.18, r * 0.42, Math.PI, 0); g.stroke();
        if (!c.alive) cross(g, px, py, r * 0.8, "#3b0806");
        if (!o.compact && o.labels) {
            g.fillStyle = "rgba(230,236,242,.8)";
            g.font = "600 9px Rubik, sans-serif";
            g.textAlign = "center";
            g.fillText(CREW_SEATS[sname].short, px, py + r + 10);
        }
    }
    // очаг пожара
    if (snap.fire) {
        const [fx, fy] = [X(snap.fire[0]), Y(snap.fire[2])];
        g.fillStyle = "rgba(255,120,30,.35)";
        g.beginPath(); g.arc(fx, fy, Config.FIRE.RADIUS * s, 0, 6.283); g.fill();
    }

    // попадание
    if (o.res) drawHit(g, o.res, o.prog ?? 1, X, Y, s);

    if (o.labels && !o.compact) {
        g.fillStyle = "rgba(160,180,200,.7)";
        g.font = "10px Rubik, sans-serif";
        g.textAlign = "left";
        g.fillText("НОС ▸", X(L / 2) + 6, Y(-iw / 2) - 6);
    }
    g.restore();
}

function drawHit(g, res, q, X, Y, s) {
    if (!res.entry) return;
    const e = res.entry, d = res.dir;
    const ex = X(e[0]), ey = Y(e[2]);
    // траектория до брони
    const inLen = 5;
    g.strokeStyle = res.kind === "rico" ? "#ffd23f" : "#f0f4f8";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(X(e[0] - d[0] * inLen), Y(e[2] - d[2] * inLen));
    g.lineTo(ex, ey);
    g.stroke();
    if (res.kind === "rico" && res.ricoHull) {
        const r = res.ricoHull, t = clamp(q / 0.4, 0, 1) * 5;
        g.strokeStyle = "#ffd23f";
        g.setLineDash([4, 3]);
        g.beginPath(); g.moveTo(ex, ey); g.lineTo(X(e[0] + r[0] * t), Y(e[2] + r[2] * t)); g.stroke();
        g.setLineDash([]);
    }
    // путь тела снаряда
    if (res.path) {
        const t = clamp(q / 0.45, 0, 1);
        const a = res.path.from, b = res.path.to;
        g.strokeStyle = "#ff3b30";
        g.lineWidth = 2.6;
        g.shadowColor = "#ff3b30";
        g.shadowBlur = 6;
        g.beginPath();
        g.moveTo(X(a[0]), Y(a[2]));
        g.lineTo(X(a[0] + (b[0] - a[0]) * t), Y(a[2] + (b[2] - a[2]) * t));
        g.stroke();
        g.shadowBlur = 0;
    }
    // осколки
    if (res.frags && res.frags.length) {
        const t = clamp((q - 0.12) / 0.5, 0, 1);
        for (const f of res.frags) {
            g.strokeStyle = f.kind === "blast" ? "rgba(255,150,40,.75)" : "rgba(255,90,60,.7)";
            g.lineWidth = 1;
            g.beginPath();
            g.moveTo(X(f.from[0]), Y(f.from[2]));
            g.lineTo(X(f.from[0] + (f.to[0] - f.from[0]) * t), Y(f.from[2] + (f.to[2] - f.from[2]) * t));
            g.stroke();
            if (t >= 1 && f.hit) {
                g.fillStyle = "#ffb37a";
                g.fillRect(X(f.to[0]) - 1.5, Y(f.to[2]) - 1.5, 3, 3);
            }
        }
    }
    if (res.blast) {
        const t = clamp((q - 0.3) / 0.4, 0, 1);
        if (t > 0) {
            g.strokeStyle = "rgba(255,150,40,.9)";
            g.fillStyle = "rgba(255,150,40,.15)";
            g.lineWidth = 1.5;
            g.beginPath();
            g.arc(X(res.blast.at[0]), Y(res.blast.at[2]), res.blast.r * s * t, 0, 6.283);
            g.fill(); g.stroke();
        }
    }
    // точка входа
    const col = res.kind === "pen" || res.kind === "he-pen" ? "#ff3b30" : res.kind === "rico" ? "#ffd23f" : res.kind === "he" || res.kind === "splash" ? "#ff8c42" : "#c7d2dc";
    g.fillStyle = col;
    g.beginPath(); g.arc(ex, ey, 3.5, 0, 6.283); g.fill();
    if (res.kind === "nopen") cross(g, ex, ey, 6, "#ff5147");
}

function cross(g, x, y, r, col = "#2b0705") {
    g.strokeStyle = col;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x - r, y - r); g.lineTo(x + r, y + r);
    g.moveTo(x + r, y - r); g.lineTo(x - r, y + r);
    g.stroke();
}

function shortMod(t) {
    return { engine: "ДВ", transmission: "ТР", fuel: "ТБ", breech: "КЗ", drive: "ПМ" }[t] || "";
}

function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
}
