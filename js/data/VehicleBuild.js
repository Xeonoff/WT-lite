import { VEHICLES, CREW_SEATS, MODULE_NAMES } from "./Vehicles.js";
import { SHELLS } from "./Shells.js";
import { Config } from "../core/Config.js";
import { DEG } from "../core/Utils.js";

export const CLEARANCE = 0.38;

/** Подвеска: тип и число опорных катков на борт */
const SUSP = {
    bt7: ["christie", 4], t34_41: ["christie", 5], t34_85: ["christie", 5], su100: ["christie", 5], t44: ["christie", 5],
    kv1: ["kv", 6], is1: ["kv", 6], is2: ["kv", 6], isu152: ["kv", 6],
    su76m: ["small", 6], pz2f: ["small", 5], pz3j: ["small", 6], stug3f: ["small", 6], pz4f2: ["small", 8], nashorn: ["small", 8],
    tiger_h1: ["interleaved", 8], panther_d: ["interleaved", 8], panther_g: ["interleaved", 8], tiger2: ["interleaved", 9], jagdpanther: ["interleaved", 8],
};

/**
 * Сечение башни/рубки на доле высоты fy с учётом наклона стенок из данных брони:
 * лоб, корма и борта «уходят внутрь» на h·tg(наклона).
 */
export function turretSlopeRing(def, fy) {
    const T = def.turret, A = def.armor.turret;
    const y = fy * T.h;
    const tg = (a) => Math.tan(Math.min(a || 0, 62) * DEG);
    const kF = Math.max(0.55, 1 - y * tg(A.front[1]) / T.hl);
    const kR = Math.max(0.55, 1 - y * tg(A.rear[1]) / T.hl);
    const kS = Math.max(0.55, 1 - y * tg(A.side[1]) / T.hw);
    return def.turretPoly.map(([x, z]) => [x * (x > 0 ? kF : kR), z * kS]);
}

/* ───────────── Формы башен (в плане, x — вперёд, z — вправо, нормированные) ───────────── */
function superEllipse(n, p, frontFlat = 1) {
    const pts = [];
    for (let i = 0; i < n; i++) {
        const t = (i / n) * Math.PI * 2;
        const c = Math.cos(t), s = Math.sin(t);
        let x = Math.sign(c) * Math.pow(Math.abs(c), 2 / p);
        const z = Math.sign(s) * Math.pow(Math.abs(s), 2 / p);
        if (x > frontFlat) x = frontFlat;
        pts.push([x / frontFlat, z]);
    }
    return pts;
}

const TURRET_SHAPES = {
    hex: () => [[1, 0.52], [0.62, 1], [-0.72, 1], [-1, 0.58], [-1, -0.58], [-0.72, -1], [0.62, -1], [1, -0.52]],
    round: () => superEllipse(14, 2.2),
    cast: () => superEllipse(16, 2.8, 0.94),
    box: () => [[1, 0.6], [0.72, 1], [-1, 0.9], [-1, -0.9], [0.72, -1], [1, -0.6]],
    tiger: () => {
        // «подкова»: плоский лоб, скруглённые борта и корма
        const pts = [[1, 0.94], [1, -0.94]];
        for (let i = 0; i <= 10; i++) {
            const t = (i / 10) * Math.PI;
            pts.push([0.3 - 1.3 * Math.sin(t), Math.cos(t)]);
        }
        return pts;
    },
    panther: () => [[1, 0.5], [0.55, 0.86], [-0.82, 1], [-1, 0.78], [-1, -0.78], [-0.82, -1], [0.55, -0.86], [1, -0.5]],
    kingtiger: () => [[1, 0.42], [0.5, 0.94], [-1, 0.94], [-1, -0.94], [0.5, -0.94], [1, -0.42]],
    casemate: () => [[1, 0.78], [-1, 1], [-1, -1], [1, -0.78]],
};

/** Выпуклая оболочка (на случай неаккуратных форм) — монотонная цепь Эндрю */
function convexHull(pts) {
    const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [], upper = [];
    for (const q of p) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
        lower.push(q);
    }
    for (let i = p.length - 1; i >= 0; i--) {
        const q = p[i];
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
        upper.push(q);
    }
    upper.pop(); lower.pop();
    return lower.concat(upper);
}

/** Плоскости выпуклой призмы из многоугольника в плоскости (a,b) и плиты по третьей оси */
function prismPlanes(poly, labelFn, axA, axB, axS, sMin, sMax, labS) {
    const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
    const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
    const planes = [];
    for (let i = 0; i < poly.length; i++) {
        const p = poly[i], q = poly[(i + 1) % poly.length];
        const ex = q[0] - p[0], ey = q[1] - p[1];
        let nx = ey, ny = -ex;
        const l = Math.hypot(nx, ny) || 1;
        nx /= l; ny /= l;
        const mx = (p[0] + q[0]) / 2 - cx, my = (p[1] + q[1]) / 2 - cy;
        if (nx * mx + ny * my < 0) { nx = -nx; ny = -ny; }
        const n = [0, 0, 0];
        n[axA] = nx; n[axB] = ny;
        planes.push({ n, d: nx * p[0] + ny * p[1], face: labelFn(nx, ny, i) });
    }
    const top = [0, 0, 0], bot = [0, 0, 0];
    top[axS] = 1; bot[axS] = -1;
    planes.push({ n: top, d: sMax, face: labS[1] });
    planes.push({ n: bot, d: -sMin, face: labS[0] });
    return planes;
}

/** Профиль корпуса сбоку (x, y), против часовой стрелки, + метки граней */
function hullProfile(def) {
    const { L, H } = def.dims;
    const a = def.armor.hull;
    const c = CLEARANCE;
    const ys = c + (H - c) * 0.42;      // излом ВЛД/НЛД
    const yr = c + (H - c) * 0.55;      // излом кормы
    let ft = (H - ys) * Math.tan(a.front[1] * DEG);
    let fb = (ys - c) * Math.tan((a.lower ? a.lower[1] : 45) * DEG);
    let rt = (H - yr) * Math.tan((a.rear[1] || 0) * DEG);
    const rb = (yr - c) * Math.tan(35 * DEG);
    const maxSlope = L * 0.62 - rt;
    if (ft > maxSlope) ft = maxSlope;
    if (fb > L * 0.22) fb = L * 0.22;
    if (rt > L * 0.2) rt = L * 0.2;
    const pts = [
        [-L / 2 + rb, c],      // корма-низ
        [L / 2 - fb, c],       // нос-низ
        [L / 2, ys],           // нос (излом)
        [L / 2 - ft, H],       // ВЛД-верх
        [-L / 2 + rt, H],      // корма-верх
        [-L / 2, yr],          // корма-излом
    ];
    const labels = ["bottom", "lower", "front", "roof", "rear", "rear"];
    return { pts, labels, ys, yr, ft, fb, rt, rb };
}

/* ───────────── Раскладка экипажа и модулей ───────────── */
function boxAt(c, half) {
    return { shape: "box", min: [c[0] - half[0], c[1] - half[1], c[2] - half[2]], max: [c[0] + half[0], c[1] + half[1], c[2] + half[2]], c };
}

function buildLayout(def) {
    const { L, W, H, tw } = def.dims;
    const iw = W - 2 * tw;
    const T = def.turret;
    const c = CLEARANCE;
    const hh = H - c;
    const seats = {};
    const mods = [];
    const crewY = c + Math.min(0.5, hh * 0.42);

    const seat = (name, frame, pos) => { seats[name] = { frame, c: pos, r: 0.36 }; };
    const mod = (id, type, frame, geo, hp) => mods.push({ id, type, frame, ...geo, maxHp: hp });

    const lay = def.layout;
    if (lay === "rear") {
        seat("driver", "hull", [L * 0.3, crewY, -iw * 0.22]);
        seat("radio", "hull", [L * 0.3, crewY, iw * 0.22]);
        mod("engine", "engine", "hull", boxAt([-L * 0.235, c + hh * 0.46, 0], [L * 0.11, hh * 0.33, iw * 0.3]), 150);
        mod("transmission", "transmission", "hull", boxAt([-L * 0.405, c + hh * 0.36, 0], [L * 0.055, hh * 0.28, iw * 0.36]), 120);
        mod("fuel1", "fuel", "hull", boxAt([-L * 0.1, c + hh * 0.56, -iw * 0.41], [L * 0.1, hh * 0.25, iw * 0.07]), 70);
        mod("fuel2", "fuel", "hull", boxAt([-L * 0.1, c + hh * 0.56, iw * 0.41], [L * 0.1, hh * 0.25, iw * 0.07]), 70);
        mod("ammo1", "ammo", "hull", boxAt([L * 0.03, c + 0.16, -iw * 0.17], [L * 0.09, 0.13, iw * 0.13]), 60);
        mod("ammo2", "ammo", "hull", boxAt([L * 0.03, c + 0.16, iw * 0.17], [L * 0.09, 0.13, iw * 0.13]), 60);
        mod("ammo3", "ammo", "hull", boxAt([L * 0.15, c + hh * 0.62, iw * 0.41], [L * 0.06, hh * 0.18, iw * 0.07]), 60);
    } else if (lay === "front") {
        seat("driver", "hull", [L * 0.28, crewY, -iw * 0.27]);
        seat("radio", "hull", [L * 0.28, crewY, iw * 0.27]);
        mod("transmission", "transmission", "hull", boxAt([L * 0.4, c + hh * 0.38, 0], [L * 0.06, hh * 0.3, iw * 0.17]), 120);
        mod("engine", "engine", "hull", boxAt([-L * 0.31, c + hh * 0.48, 0], [L * 0.12, hh * 0.33, iw * 0.27]), 150);
        mod("fuel1", "fuel", "hull", boxAt([-L * 0.17, c + hh * 0.4, -iw * 0.37], [L * 0.05, hh * 0.28, iw * 0.09]), 70);
        mod("fuel2", "fuel", "hull", boxAt([-L * 0.17, c + hh * 0.4, iw * 0.37], [L * 0.05, hh * 0.28, iw * 0.09]), 70);
        mod("ammo1", "ammo", "hull", boxAt([L * 0.07, c + hh * 0.66, -iw * 0.41], [L * 0.12, hh * 0.17, iw * 0.07]), 60);
        mod("ammo2", "ammo", "hull", boxAt([L * 0.07, c + hh * 0.66, iw * 0.41], [L * 0.12, hh * 0.17, iw * 0.07]), 60);
        mod("ammo3", "ammo", "hull", boxAt([-L * 0.04, c + 0.15, 0], [L * 0.08, 0.12, iw * 0.13]), 60);
    } else { // openRear: двигатель в середине-носу, боевое отделение в корме
        seat("driver", "hull", [L * 0.33, crewY, -iw * 0.26]);
        mod("transmission", "transmission", "hull", boxAt([L * 0.42, c + hh * 0.36, iw * 0.08], [L * 0.05, hh * 0.28, iw * 0.28]), 110);
        mod("engine", "engine", "hull", boxAt([L * 0.1, c + hh * 0.45, iw * 0.12], [L * 0.12, hh * 0.33, iw * 0.28]), 140);
        mod("fuel1", "fuel", "hull", boxAt([L * 0.12, c + hh * 0.45, -iw * 0.34], [L * 0.08, hh * 0.25, iw * 0.08]), 70);
        mod("ammo1", "ammo", "hull", boxAt([-L * 0.3, c + hh * 0.62, -iw * 0.4], [L * 0.1, hh * 0.2, iw * 0.07]), 60);
        mod("ammo2", "ammo", "hull", boxAt([-L * 0.3, c + hh * 0.62, iw * 0.4], [L * 0.1, hh * 0.2, iw * 0.07]), 60);
    }

    // Экипаж в башне / рубке
    const hl = T.hl, hw = T.hw;
    if (T.casemate) {
        seat("gunner", "turret", [hl * 0.12, -0.12, -hw * 0.48]);
        seat("loader", "turret", [-hl * 0.05, -0.12, hw * 0.5]);
        seat("commander", "turret", [-hl * 0.55, -0.12, -hw * 0.22]);
        seat("loader2", "turret", [-hl * 0.58, -0.12, hw * 0.38]);
    } else {
        seat("gunner", "turret", [hl * 0.08, -0.1, -hw * 0.5]);
        seat("loader", "turret", [hl * 0.05, -0.1, hw * 0.5]);
        seat("commander", "turret", [-hl * 0.55, -0.1, -hw * 0.28]);
    }

    // Орудие и механизмы
    const cal = def.gun.cal;
    const br = 0.1 + cal / 800;
    mod("breech", "breech", "gun", boxAt([-(0.32 + cal / 500), 0, 0], [0.32 + cal / 600, br, br * 1.1]), 120);
    const bh = Math.max(0.09, cal * 0.0011);
    mod("barrel", "barrel", "gun", { shape: "box", min: [0.12, -bh, -bh], max: [def.gun.len, bh, bh], c: [def.gun.len / 2, 0, 0] }, 60);
    if (!T.casemate) {
        mod("drive", "drive", "turret", boxAt([hl * 0.3, 0.1, -hw * 0.66], [0.14, 0.1, 0.12]), 70);
    }
    if (def.details && def.details.bustle && !T.casemate) {
        mod("ammo0", "ammo", "turret", boxAt([-hl * 0.82, T.h * 0.45, 0], [hl * 0.13, T.h * 0.2, hw * 0.55]), 55);
    }
    if (T.casemate) {
        // дополнительные стеллажи в рубке
        mod("ammo4", "ammo", "turret", boxAt([-hl * 0.15, T.h * 0.25, -hw * 0.88], [hl * 0.22, T.h * 0.2, hw * 0.08]), 55);
    }

    // Гусеницы (наружные модули)
    mod("trackL", "track", "hull", { shape: "box", min: [-L * 0.49, 0, -W / 2], max: [L * 0.49, def.dims.th, -W / 2 + tw], c: [0, def.dims.th / 2, -W / 2 + tw / 2] }, 90);
    mod("trackR", "track", "hull", { shape: "box", min: [-L * 0.49, 0, W / 2 - tw], max: [L * 0.49, def.dims.th, W / 2], c: [0, def.dims.th / 2, W / 2 - tw / 2] }, 90);

    // Оставляем только места, существующие у машины
    const used = {};
    for (const s of def.crew) used[s] = seats[s];
    for (const m of mods) m.name = MODULE_NAMES[m.type];
    return { seats: used, mods };
}

function buildParts(def, prof) {
    const { L, W, H, tw, th } = def.dims;
    const iw = W - 2 * tw;
    const T = def.turret;
    const parts = [];
    parts.push({
        id: "hull", frame: "hull", kind: "convex",
        planes: prismPlanes(prof.pts, (nx, ny, i) => prof.labels[i], 0, 1, 2, -iw / 2, iw / 2, ["side", "side"]),
    });
    const tPoly = turretSlopeRing(def, 0.5);
    parts.push({
        id: "turret", frame: "turret", kind: "convex",
        planes: prismPlanes(tPoly, (nx) => (nx > 0.62 ? "front" : nx < -0.62 ? "rear" : "side"), 0, 2, 1, 0, T.h, ["bottom", "roof"]),
    });
    for (const m of def.modules) {
        if (m.type === "track") parts.push({ id: m.id, frame: "hull", kind: "box", min: m.min, max: m.max, module: m.id, spaced: 20 });
        if (m.type === "barrel") parts.push({ id: "barrel", frame: "gun", kind: "box", min: m.min, max: m.max, module: "barrel" });
    }
    if (def.details && def.details.skirts) {
        const y0 = 0.42, y1 = Math.min(H - 0.1, th + 0.45);
        parts.push({ id: "skirtL", frame: "hull", kind: "box", min: [-L * 0.36, y0, -W / 2 - 0.08], max: [L * 0.4, y1, -W / 2 - 0.02], spaced: def.details.skirts, skirt: true });
        parts.push({ id: "skirtR", frame: "hull", kind: "box", min: [-L * 0.36, y0, W / 2 + 0.02], max: [L * 0.4, y1, W / 2 + 0.08], spaced: def.details.skirts, skirt: true });
    }
    return parts;
}

function prepare(id, def) {
    def.id = id;
    const T = def.turret;
    T.arc = T.arc || 0;
    const raw = TURRET_SHAPES[T.shape] ? TURRET_SHAPES[T.shape]() : TURRET_SHAPES.box();
    def.turretPoly = convexHull(raw.map(([x, z]) => [x * T.hl, z * T.hw]));
    const sp = SUSP[id] || ["small", 6];
    def.susp = { type: sp[0], wheels: sp[1], driveFront: def.layout !== "rear" };
    const prof = hullProfile(def);
    def.profile = prof;
    const lay = buildLayout(def);
    def.seats = lay.seats;
    def.modules = lay.mods;
    def.parts = buildParts(def, prof);
    // Орудие
    def.gunPivot = [T.hl * 0.95, T.h * 0.5, 0];
    def.muzzleY = def.dims.H + T.h * 0.5;
    def.gun.mag = def.gun.mag || 1;
    def.gun.rof = def.gun.rof || 0;
    // Боекомплект и стеллажи
    def.ammoTotal = def.shells.reduce((s, [, n]) => s + n, 0);
    const racks = def.modules.filter((m) => m.type === "ammo");
    const vol = (m) => (m.max[0] - m.min[0]) * (m.max[1] - m.min[1]) * (m.max[2] - m.min[2]);
    const vSum = racks.reduce((s, m) => s + vol(m), 0) || 1;
    // порядок расхода: ниша башни и борта — первыми, пол — последним
    racks.sort((a, b) => rackOrder(a) - rackOrder(b));
    racks.forEach((m, i) => { m.cap = Math.max(1, Math.round((vol(m) / vSum) * def.ammoTotal)); m.order = i; });
    def.rackOrder = racks.map((m) => m.id);
    def.spCost = Config.SP.COST[def.rank] || 150;
    def.crewTitles = {};
    for (const s of def.crew) def.crewTitles[s] = (def.titles && def.titles[s]) || CREW_SEATS[s].name;
    // радиус для широкой фазы
    def.radius = Math.hypot(def.dims.L / 2 + Math.max(0, T.x + T.hl + def.gun.len - def.dims.L / 2), def.dims.W / 2) + 0.3;
    def.bodyRadius = Math.hypot(def.dims.L / 2, def.dims.W / 2);
    def.shellIds = def.shells.map(([sid]) => sid);
    for (const sid of def.shellIds) if (!SHELLS[sid]) console.warn("Unknown shell", sid, "in", id);
    return def;
}

function rackOrder(m) {
    if (m.id === "ammo0") return 0;       // ниша башни
    if (m.id === "ammo4") return 1;
    if (m.id === "ammo3" && m.c[1] > 0.6) return 2;
    if (m.id === "ammo1" || m.id === "ammo2") return 3;
    return 4;                             // пол
}

for (const id in VEHICLES) prepare(id, VEHICLES[id]);

export function getVehicle(id) { return VEHICLES[id]; }

export function vehiclesOf(nation) {
    return Object.values(VEHICLES).filter((v) => v.nation === nation);
}

export const ALL_VEHICLES = Object.values(VEHICLES);
