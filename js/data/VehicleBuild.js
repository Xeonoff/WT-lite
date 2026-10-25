import { VEHICLES, CREW_SEATS, MODULE_NAMES } from "./Vehicles.js";
import { SHELLS } from "./Shells.js";
import { Config } from "../core/Config.js";
import { DEG } from "../core/Utils.js";

export const CLEARANCE = 0.3;
/** Нижняя граница «блока днища» (катки, торсионы) — снаряд не пролетает под корпусом */
export const BELLY = 0.04;

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

/** Надгусеничные ниши: высота низа ниш, полуширина и наклон бортов верхней части */
function hullFormOf(def) {
    const { W, tw, th, H } = def.dims;
    const iw = W - 2 * tw;
    const f = def.hullForm || {};
    const yf = Math.min(H - 0.15, th + 0.06);
    let sw = iw / 2;
    if (f.sponson === "full") sw = W / 2 - 0.03;
    else if (typeof f.sponson === "number") sw = iw / 2 + tw * f.sponson;
    const has = sw > iw / 2 + 0.01;
    return { yf, sw, has, ss: has ? def.armor.hull.side[1] || 0 : 0, iw };
}

/** Полуширина корпуса на высоте y (ниши шире, их борта наклонены) */
export function hullHalfWidth(def, y) {
    const F = def.form;
    if (!F.has || y < F.yf - 1e-6) return F.iw / 2;
    return Math.max(F.iw / 2, F.sw - (y - F.yf) * Math.tan(F.ss * DEG));
}

/**
 * Профиль корпуса сбоку. Лобовые листы идут сверху вниз по hullForm.nose:
 * обычные листы при спуске выдвигаются вперёд («\», «|»), нижний — уходит назад («/»).
 */
function hullProfile(def) {
    const { L, H } = def.dims;
    const a = def.armor.hull;
    const c = CLEARANCE;
    const hh = H - c;
    const nose = (def.hullForm && def.hullForm.nose) || [["front", 0.58], ["lower", 0.42]];
    const tg = (deg) => Math.tan(Math.min(deg || 0, 82) * DEG);
    let x = 0, y = H;
    const front = [[0, H]];
    for (const [key, frac] of nose) {
        const dy = hh * frac;
        x += (key === "lower" ? -1 : 1) * dy * tg((a[key] || a.front)[1]);
        y -= dy;
        front.push([x, y]);
    }
    front[front.length - 1][1] = c;
    // нос в x = L/2; крыша не короче 35% длины
    const xmax = Math.max(...front.map((p) => p[0]));
    const yr = c + hh * 0.55;
    let rt = Math.min(L * 0.2, (H - yr) * tg(a.rear[1]));
    const rb = (yr - c) * Math.tan(35 * DEG);
    const span = xmax - front[0][0];
    const maxSpan = L * 0.65 - rt;
    const k = span > maxSpan ? maxSpan / span : 1;
    for (const p of front) p[0] = L / 2 - (xmax - p[0]) * k;
    const rear = [[-L / 2 + rt, H], [-L / 2, yr], [-L / 2 + rb, c]];
    const labels = nose.map(([key]) => key);
    return { front, rear, labels, ft: L / 2 - front[0][0], rt, rb, yr };
}

function interpX(chain, y) {
    for (let i = 0; i < chain.length - 1; i++) {
        const [x0, y0] = chain[i], [x1, y1] = chain[i + 1];
        if (y <= y0 + 1e-9 && y >= y1 - 1e-9) return y0 === y1 ? Math.max(x0, x1) : x0 + (x1 - x0) * (y - y0) / (y1 - y0);
    }
    return y > chain[0][1] ? chain[0][0] : chain[chain.length - 1][0];
}

/** Метка лобового листа на высоте y */
function frontLabel(prof, y) {
    const ch = prof.front;
    for (let i = 0; i < ch.length - 1; i++) if (y <= ch[i][1] && y >= ch[i + 1][1]) return prof.labels[i];
    return "front";
}

/**
 * Корпус, разрезанный на горизонтальные слои по всем изломам профиля и низу ниш:
 * каждый слой — выпуклая трапеция в профиль с собственной шириной.
 */
export function hullBands(def) {
    const prof = def.profile, F = def.form;
    const c = CLEARANCE, H = def.dims.H;
    const ys = new Set([c, H]);
    for (const [, y] of prof.front) ys.add(+y.toFixed(4));
    for (const [, y] of prof.rear) ys.add(+y.toFixed(4));
    if (F.has) {
        ys.add(+F.yf.toFixed(4));
        // высота, где наклонный борт ниши доходит до ширины корпуса
        if (F.ss > 0) {
            const yc = F.yf + (F.sw - F.iw / 2) / Math.tan(F.ss * DEG);
            if (yc < H) ys.add(+yc.toFixed(4));
        }
    }
    const list = [...ys].filter((y) => y >= c - 1e-6 && y <= H + 1e-6).sort((p, q) => p - q);
    const bands = [];
    for (let i = 0; i < list.length - 1; i++) {
        const y0 = list[i], y1 = list[i + 1];
        if (y1 - y0 < 0.005) continue;
        const ym = (y0 + y1) / 2;
        const sponson = F.has && y0 >= F.yf - 1e-6;
        const hw0 = hullHalfWidth(def, y0 + 1e-5), hw1 = hullHalfWidth(def, y1 - 1e-5);
        // внутренние границы слоёв помечаем "inner": снаружи в них не попасть
        const bottom = y0 <= c + 1e-6 || (F.has && Math.abs(y0 - F.yf) < 1e-4) ? "bottom" : "inner";
        bands.push({
            y0, y1, hw0, hw1,
            poly: [[interpX(prof.rear, y0), y0], [interpX(prof.front, y0), y0], [interpX(prof.front, y1), y1], [interpX(prof.rear, y1), y1]],
            labels: [bottom, frontLabel(prof, ym), y1 >= H - 1e-6 ? "roof" : "inner", "rear"],
            // наклон борта ниши задан геометрией слоя, у остальных — аналитически
            slope: sponson && hw1 < hw0 - 1e-4 ? Math.atan2(hw0 - hw1, y1 - y0) : 0,
            sideSlope: F.has ? 0 : def.armor.hull.side[1] || 0,
        });
    }
    return bands;
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

    const F = def.form, prof = def.profile;
    // стеллаж/бак в нише над гусеницей (или у борта, если ниш нет), вписанный в наклон борта
    const sideBox = (xc, hx, s, fill = 1) => {
        if (!F.has) return boxAt([xc, c + hh * 0.6, s * iw * 0.41], [hx, hh * 0.2 * fill, iw * 0.07]);
        const y0 = F.yf + 0.03, y1 = Math.min(H - 0.06, y0 + Math.max(0.2, (H - F.yf) * 0.62 * fill));
        const zo = hullHalfWidth(def, y1) - 0.05, zi = Math.min(iw / 2 - 0.12, zo - 0.25);
        return boxAt([xc, (y0 + y1) / 2, s * (zo + zi) / 2], [hx, (y1 - y0) / 2, (zo - zi) / 2]);
    };
    // крайние точки носа и кормы в диапазоне высот — чтобы трансмиссия не торчала из листов
    const span = (chain, y0, y1, pick) => {
        let r = interpX(chain, y0);
        for (let i = 1; i <= 6; i++) r = pick(r, interpX(chain, y0 + (y1 - y0) * i / 6));
        for (const [x, y] of chain) if (y > y0 && y < y1) r = pick(r, x);
        return r;
    };
    const transBox = (front, cy, hy, hz, zc = 0) => {
        const y0 = cy - hy, y1 = cy + hy;
        const x = front ? span(prof.front, y0, y1, Math.min) - 0.06 : span(prof.rear, y0, y1, Math.max) + 0.06;
        const len = L * 0.11;
        return boxAt([x + (front ? -len / 2 : len / 2), cy, zc], [len / 2, hy, hz]);
    };
    const lay = def.layout;
    if (lay === "rear") {
        seat("driver", "hull", [L * 0.3, crewY, -iw * 0.22]);
        seat("radio", "hull", [L * 0.3, crewY, iw * 0.22]);
        mod("engine", "engine", "hull", boxAt([-L * 0.235, c + hh * 0.46, 0], [L * 0.11, hh * 0.33, iw * 0.3]), 150);
        mod("transmission", "transmission", "hull", transBox(false, c + hh * 0.42, hh * 0.25, iw * 0.36), 120);
        mod("fuel1", "fuel", "hull", sideBox(-L * 0.1, L * 0.1, -1), 70);
        mod("fuel2", "fuel", "hull", sideBox(-L * 0.1, L * 0.1, 1), 70);
        mod("ammo1", "ammo", "hull", boxAt([L * 0.03, c + 0.16, -iw * 0.17], [L * 0.09, 0.13, iw * 0.13]), 60);
        mod("ammo2", "ammo", "hull", boxAt([L * 0.03, c + 0.16, iw * 0.17], [L * 0.09, 0.13, iw * 0.13]), 60);
        mod("ammo3", "ammo", "hull", sideBox(L * 0.15, L * 0.06, 1, 0.8), 60);
    } else if (lay === "front") {
        seat("driver", "hull", [L * 0.28, crewY, -iw * 0.27]);
        seat("radio", "hull", [L * 0.28, crewY, iw * 0.27]);
        mod("transmission", "transmission", "hull", transBox(true, c + hh * 0.4, hh * 0.26, iw * 0.17), 120);
        mod("engine", "engine", "hull", boxAt([-L * 0.31, c + hh * 0.48, 0], [L * 0.12, hh * 0.33, iw * 0.27]), 150);
        mod("fuel1", "fuel", "hull", boxAt([-L * 0.17, c + hh * 0.4, -iw * 0.37], [L * 0.05, hh * 0.28, iw * 0.09]), 70);
        mod("fuel2", "fuel", "hull", boxAt([-L * 0.17, c + hh * 0.4, iw * 0.37], [L * 0.05, hh * 0.28, iw * 0.09]), 70);
        mod("ammo1", "ammo", "hull", sideBox(L * 0.07, L * 0.12, -1), 60);
        mod("ammo2", "ammo", "hull", sideBox(L * 0.07, L * 0.12, 1), 60);
        mod("ammo3", "ammo", "hull", boxAt([-L * 0.04, c + 0.15, 0], [L * 0.08, 0.12, iw * 0.13]), 60);
    } else { // openRear: двигатель в середине-носу, боевое отделение в корме
        seat("driver", "hull", [L * 0.33, crewY, -iw * 0.26]);
        mod("transmission", "transmission", "hull", transBox(true, c + hh * 0.4, hh * 0.25, iw * 0.28, iw * 0.08), 110);
        mod("engine", "engine", "hull", boxAt([L * 0.1, c + hh * 0.45, iw * 0.12], [L * 0.12, hh * 0.33, iw * 0.28]), 140);
        mod("fuel1", "fuel", "hull", boxAt([L * 0.12, c + hh * 0.45, -iw * 0.34], [L * 0.08, hh * 0.25, iw * 0.08]), 70);
        mod("ammo1", "ammo", "hull", sideBox(-L * 0.3, L * 0.1, -1), 60);
        mod("ammo2", "ammo", "hull", sideBox(-L * 0.3, L * 0.1, 1), 60);
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

/** Высота экранов: закрывают верхнюю ветвь гусеницы и низ борта над ней */
export function skirtSpan(def) {
    const { H, th } = def.dims;
    return { y0: th * 0.6, y1: Math.min(H - 0.12, th + 0.3) };
}

function buildParts(def, prof) {
    const { L, W, H, tw, th } = def.dims;
    const iw = W - 2 * tw;
    const T = def.turret;
    const parts = [];
    for (const band of hullBands(def)) {
        const planes = prismPlanes(band.poly, (nx, ny, i) => band.labels[i], 0, 1, 2, -band.hw0, band.hw0, ["side", "side"]);
        if (band.slope) {
            // борта ниши, сходящиеся кверху
            const sn = Math.sin(band.slope), cs = Math.cos(band.slope);
            const d = sn * band.y0 + cs * band.hw0;
            planes.splice(-2, 2, { n: [0, sn, cs], d, face: "side" }, { n: [0, sn, -cs], d, face: "side" });
        }
        parts.push({ id: "hull", frame: "hull", kind: "convex", sideSlope: band.sideSlope, planes });
    }
    // днище с ходовой между гусеницами
    const fb = prof.front[prof.front.length - 1][0], rb = prof.rear[prof.rear.length - 1][0];
    parts.push({
        id: "hull", frame: "hull", kind: "box", min: [rb, BELLY, -iw / 2], max: [fb, CLEARANCE, iw / 2], sideSlope: 0,
        faceMap: { front: "lower", rear: "rear", roof: "bottom" },
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
        const { y0, y1 } = skirtSpan(def);
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
    def.form = hullFormOf(def);
    const prof = hullProfile(def);
    def.profile = prof;
    // названия лобовых листов по положению: верхний — ВЛД, нижний — НЛД, между ними —
    // почти горизонтальный «скос» или средний лист
    def.noseNames = {};
    prof.labels.forEach((k, i) => {
        const slope = (def.armor.hull[k] || def.armor.hull.front)[1] || 0;
        def.noseNames[k] = i === 0 ? "ВЛД" : i === prof.labels.length - 1 ? "НЛД" : slope >= 65 ? "лобовой скос" : "средний лобовой лист";
    });
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
