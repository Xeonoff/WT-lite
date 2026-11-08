/**
 * Landkreuzer P. 1000 «Ratte» — геометрия детальной модели без three.js (реконструкция проекта Krupp 1942 г.).
 * Общая для симуляции (броня, модули, экипаж, станции вооружения — в т.ч. на онлайн-сервере)
 * и рендера (js/render/models/RatteModel.js).
 *
 * Координаты модели: 1 ед. = 1 м; +Z — нос, +Y — вверх, +X — левый борт; начало — центр машины на грунте.
 * Иерархия: hull › turret (280 мм) › gun (качание; два ствола ±GUN_X), hull › turret2 (128 мм, корма) › gun2.
 *
 * Ratte не был построен: известен эскиз Krupp E-30404/1 (29.12.1942) и предложение Гроте. Габариты,
 * вооружение, двигатели, гусеницы 3 × 1,2 м — по Spielberger & Doyle и Hahn (через panzerworld.com
 * и en.wikipedia). Броня башни — как у башни линкора «Гнейзенау» (лоб 358, борт 190 мм). Броня корпуса
 * 360/200/150 мм — ru.wikipedia без источника. Остальное (формы листов, компоновка, толщины крыш,
 * ослабленные зоны) — инженерная реконструкция для игры, помечена est / placement: "estimate".
 */
const DEG = Math.PI / 180;

export const RATTE_DIMENSIONS = {
    variant: "Landkreuzer P. 1000 «Ratte», проект Krupp (E-30404/1, 1942)",
    hullLength: 35, lengthWithGuns: 39, width: 14, height: 11, clearance: 2,
    mass: 1000, crew: "20–41",
    track: { width: 1.2, perSide: 3, contact: 21, pitch: 0.40 },
    gun: { name: "2 × 28 cm SK C/34", calibre: 283, barrelCalibres: 54.5, elevation: [-8, 40] },
    gun2: { name: "12,8 cm KwK 44 L/55", calibre: 128, barrelCalibres: 55, elevation: [-7, 23] },
    engine: "8 × Daimler-Benz MB 501 (по 2000 л. с.) или 2 × MAN V12Z32/44",
    speed: "≈ 40 км/ч (заявлено)",
};

export const SPEC_ROWS = [
    ["Длина корпуса", "35 м"], ["Длина с орудиями", "39 м"], ["Ширина", "14 м"], ["Высота", "11 м"],
    ["Клиренс", "2 м"], ["Масса (проект)", "≈ 1000 т"], ["Главный калибр", "2 × 280 мм SK C/34, 54,5 клб"],
    ["Второй калибр", "128 мм KwK 44 L/55 (кормовая башня — одна из версий)"], ["Зенитные", "8 × 20 мм Flak 38 (2 Flakvierling)"],
    ["Пулемёты", "2 × 15 мм MG 151/15 в носу"], ["Двигатели", "8 × MB 501 или 2 × MAN V12Z32/44, ≈ 16 000 л. с."],
    ["Гусеницы", "3 × 1,2 м на борт; в модели на всю длину корпуса (по Krupp опорная длина 21 м)"], ["Экипаж", "20–41 (в модели 20)"],
];

/** Зоны бронирования. est — значение оценочное; g — название в игре; spaced — разнесённая броня */
export const ARMOR_ZONES = {
    "hull.front.upper": { short: "ВЛД", name: "Верхний лобовой лист", g: "ВЛД", mm: 360, angle: 59, est: true },
    "hull.front.lower": { short: "НЛД", name: "Нижний лобовой лист", g: "НЛД", mm: 300, angle: 46, est: true },
    "hull.side.upper": { short: "Борт", name: "Борт корпуса над гусеницами", g: "борт корпуса", mm: 200, angle: 0, est: true },
    "hull.side.bevel": { short: "Скос борта", name: "Верхний скос борта", g: "скос борта", mm: 150, angle: 45, est: true },
    "hull.skirt": { short: "Экран", name: "Бортовой экран гусениц", g: "бортовой экран", mm: 100, angle: 0, est: true, spaced: true },
    "hull.side.lower": { short: "Борт ↓", name: "Стенка корпуса между гусеницами", g: "нижний борт", mm: 150, angle: 0, est: true },
    "hull.sponson.floor": { short: "Полка", name: "Днище надгусеничных полок", g: "днище полки", mm: 50, angle: 90, est: true },
    "hull.rear": { short: "Корма", name: "Кормовой лист", g: "корма корпуса", mm: 150, angle: 10, est: true },
    "hull.deck": { short: "Крыша", name: "Крыша корпуса", g: "крыша корпуса", mm: 50, angle: 90, est: true },
    "hull.bottom": { short: "Днище", name: "Днище", g: "днище", mm: 50, angle: 90, est: true },
    "turret.front": { short: "Лоб ГК", name: "Лоб башни ГК и амбразуры орудий", g: "лоб башни ГК", mm: 358, angle: 23 },
    "turret.mantlet": { short: "Щиты", name: "Щиты орудийных портов", g: "щит порта", mm: 358, angle: 0, est: true },
    "turret.side": { short: "Борт ГК", name: "Борт башни главного калибра", g: "борт башни ГК", mm: 190, angle: 0 },
    "turret.bevel": { short: "Скос ГК", name: "Скосы бортов и кормы башни ГК", g: "скос башни ГК", mm: 190, angle: 45, est: true },
    "turret.rear": { short: "Корма ГК", name: "Корма башни главного калибра", g: "корма башни ГК", mm: 350, angle: 0, est: true },
    "turret.roof": { short: "Крыша ГК", name: "Крыша башни главного калибра", g: "крыша башни ГК", mm: 150, angle: 90, est: true },
    "turret2.front": { short: "Лоб 128", name: "Лоб башни 128 мм", g: "лоб башни 128 мм", mm: 220, angle: "0–60", est: true },
    "turret2.mantlet": { short: "Маска 128", name: "Маска орудия 128 мм", g: "маска 128 мм", mm: 220, angle: 0, est: true },
    "turret2.side": { short: "Борт 128", name: "Борт башни 128 мм", g: "борт башни 128 мм", mm: 200, angle: 30, est: true },
    "turret2.rear": { short: "Корма 128", name: "Корма башни 128 мм", g: "корма башни 128 мм", mm: 200, angle: 15, est: true },
    "turret2.roof": { short: "Крыша 128", name: "Крыша башни 128 мм", g: "крыша башни 128 мм", mm: 60, angle: 90, est: true },
    "deck.flak": { short: "Щит зенитки", name: "Щит Flakvierling 38", g: "щит зенитной установки", mm: 10, angle: 0, est: true },
};

export const MODULE_CATEGORIES = {
    engine: { name: "Двигатели", color: "#e0782f" },
    cooling: { name: "Охлаждение", color: "#46b3c9" },
    transmission: { name: "Трансмиссия", color: "#8f62c4" },
    fuel: { name: "Топливные баки", color: "#e3c13b" },
    ammo: { name: "Боеукладка и погреба", color: "#d8413a" },
    weapon: { name: "Вооружение", color: "#7c8592" },
    optics: { name: "Приборы наблюдения", color: "#8fd3f0" },
    radio: { name: "Связь", color: "#3f6fd8" },
    electric: { name: "Электрооборудование", color: "#57b05a" },
    turretDrive: { name: "Поворот башен", color: "#c65fa8" },
    habitat: { name: "Помещения", color: "#c9a77a" },
    structure: { name: "Перекрытия", color: "#99a08a" },
};

export const CREW_ROLES = {
    commander: { name: "Командир машины", color: "#d8413a", place: "башня ГК, у дальномера" },
    rangefinder: { name: "Дальномерщик", color: "#e06b4f", place: "башня ГК, 10,5-м дальномер" },
    gunlayer: { name: "Наводчик 280 мм", color: "#e3a33b", place: "башня ГК, у своего орудия" },
    loader: { name: "Заряжающий 280 мм", color: "#2fae8f", place: "башня ГК, между орудиями" },
    t2cmd: { name: "Командир башни 128 мм", color: "#b8452e", place: "кормовая башня" },
    t2gunner: { name: "Наводчик 128 мм", color: "#d9b13b", place: "кормовая башня, слева" },
    t2loader: { name: "Заряжающий 128 мм", color: "#38a389", place: "кормовая башня, справа" },
    driver: { name: "Механик-водитель", color: "#3f6fd8", place: "нос корпуса, под ВЛД" },
    radio: { name: "Радист", color: "#8f62c4", place: "радиорубка в носу" },
    mg: { name: "Стрелок MG 151/15", color: "#6a7ad8", place: "носовые пулемётные установки" },
    mechanic: { name: "Моторист", color: "#a9743f", place: "машинное отделение" },
    flak: { name: "Зенитчик Flak 38", color: "#7c8592", place: "открытая зенитная установка на корме" },
};

export const COMPARTMENTS = [
    { id: "control", name: "Отделение управления", z: [11.5, 16.5], color: "#3f6fd8" },
    { id: "fighting", name: "Боевое отделение и погреба ГК", z: [-1.5, 11.5], color: "#d8413a" },
    { id: "aux", name: "Гараж, лазарет, генераторы", z: [-4.4, -1.5], color: "#c9a77a" },
    { id: "mto", name: "Машинное отделение", z: [-17.0, -4.4], color: "#e0782f" },
];

/* ───────────────────────── Основные размеры ───────────────────────── */
export const H = {
    bottom: 2.0, sponson: 3.9, deck: 7.2, tipY: 4.4, tipZ: 17.5, glacisTopZ: 12.8, lowBottomZ: 15.0,
    rearTopZ: -16.6, rearBottomZ: -17.5, halfBelly: 2.75, halfWide: 7.0, skirtLo: 2.6,
    bevelY: 6.2, halfDeck: 6.0,
    turretZ: 3.5, ringR: 4.4, turret2Z: -9.0, ring2R: 1.5,
};
export const zUp = (y) => H.tipZ - ((y - H.tipY) * (H.tipZ - H.glacisTopZ)) / (H.deck - H.tipY);
export const zLow = (y) => H.lowBottomZ + ((y - H.bottom) * (H.tipZ - H.lowBottomZ)) / (H.tipY - H.bottom);
export const zRear = (y) => H.rearBottomZ + ((y - H.bottom) * (H.rearTopZ - H.rearBottomZ)) / (H.deck - H.bottom);

// Три гусеницы по 1,2 м на борт с зазорами под продольные балки подвески; на всю длину корпуса
export const TRACK = { xs: [3.40, 4.85, 6.30], width: 1.2, pitch: 0.40, top: 3.6 };
export const GIRDERS = [2.70, 4.125, 5.575];
export const ROAD = { r: 0.75, y: 0.84, n: 16, z0: -14.4, z1: 13.9 };
export const IDLER = { z: 15.6, y: 1.85, r: 1.0 };
export const SPROCKET = { z: -16.0, y: 1.85, r: 1.0 };
export const RETURN = { r: 0.35, y: 3.22, z: [12.0, 6.0, 0, -6.0, -12.0] };
export const GUN_PIVOT = [0, 1.55, 4.6];       // в системе башни ГК
export const GUN_X = 2.8;                       // полурасстояние между орудиями
export const MUZZLE_Z = 13.2;                   // дульный срез 280 мм от оси цапф
export const GUN2_PIVOT = [0, 1.0, 1.2];        // в системе башни 128 мм
export const MUZZLE2_Z = 7.35;

/** Главная башня: профиль и план (нужен и рендеру) */
export const TURRET = { y0: 0.05, yc: 2.45, y1: 3.1, f0: 6.6, f1: 5.3, rear: -6.0, xF: 4.8, xR: 6.0 };
export const turretFaceZ = (y) => TURRET.f0 - ((y - TURRET.y0) * (TURRET.f0 - TURRET.f1)) / (TURRET.y1 - TURRET.y0);
export const turretHalfX = (z) => TURRET.xF + ((TURRET.f0 - z) * (TURRET.xR - TURRET.xF)) / (TURRET.f0 - TURRET.rear);
export const turretInset = (y) => Math.max(0, y - TURRET.yc);
/** Амбразуры орудий в лобовом листе */
export const POCKET = { lo: 0.6, hi: 2.65, half: 0.6, back: 5.15 };

/** Кормовая башня 128 мм */
export const TURRET2 = { y0: 0.05, y1: 2.0, half0: 2.1, R: 1.0, rear0: -2.4 };
export const t2HalfX = (y) => TURRET2.half0 - (y - TURRET2.y0) * Math.tan(30 * DEG);
export const t2FrontZ = (y) => GUN2_PIVOT[2] + Math.sqrt(Math.max(0, TURRET2.R * TURRET2.R - (y - GUN2_PIVOT[1]) ** 2));
export const t2RearZ = (y) => TURRET2.rear0 + (y - TURRET2.y0) * Math.tan(15 * DEG);
export const T2_YS = [TURRET2.y0, 0.3, 0.6, 0.85, 1.1, 1.35, 1.6, 1.8, TURRET2.y1];

/** Зенитные установки на корме: центр тумбы на крыше (модель) */
export const FLAK = [{ id: "flak_l", x: 4.8, z: -14.0 }, { id: "flak_r", x: -4.8, z: -14.0 }];
/** Шаровые установки MG 151/15 в ВЛД */
export const BOW_MG = [{ id: "mg_l", x: 3.4, y: 5.6 }, { id: "mg_r", x: -3.4, y: 5.6 }];

/* ───────────────────────── Броневые листы ───────────────────────── */
const sym = (pts) => [...pts, ...pts.slice().reverse().map((p) => [-p[0], p[1], p[2]])];

/**
 * Все броневые листы: внешняя грань pts, толщина уходит внутрь (к точке interior).
 * parent: hull | turret | gun | turret2 | gun2; holes — вырезы (только для рендера).
 */
export function armorPlates() {
    const P = [];
    const add = (parent, zone, pts, interior, extra = {}) => P.push({ parent, zone, pts, mm: ARMOR_ZONES[zone].mm, interior, ...extra });
    const hullIn = [0, 4.6, 0];
    const { halfWide: W, halfDeck: D, halfBelly: B } = H;

    /* ── корпус ── */
    add("hull", "hull.front.upper", sym([[W, H.tipY, H.tipZ], [W, H.bevelY, zUp(H.bevelY)], [D, H.deck, H.glacisTopZ]]), hullIn);
    add("hull", "hull.front.lower", sym([[B, H.bottom, zLow(H.bottom)], [B, H.sponson, zLow(H.sponson)], [W, H.sponson, zLow(H.sponson)], [W, H.tipY, H.tipZ]]), hullIn);
    add("hull", "hull.rear", sym([[B, H.bottom, zRear(H.bottom)], [B, H.sponson, zRear(H.sponson)], [W, H.sponson, zRear(H.sponson)], [W, H.bevelY, zRear(H.bevelY)], [D, H.deck, zRear(H.deck)]]), hullIn);
    for (const s of [1, -1]) {
        add("hull", "hull.side.upper", [[zRear(H.sponson), H.sponson], [zLow(H.sponson), H.sponson], [H.tipZ, H.tipY], [zUp(H.bevelY), H.bevelY], [zRear(H.bevelY), H.bevelY]]
            .map(([z, y]) => [s * W, y, z]), hullIn);
        add("hull", "hull.side.bevel", [[s * W, H.bevelY, zUp(H.bevelY)], [s * D, H.deck, H.glacisTopZ], [s * D, H.deck, H.rearTopZ], [s * W, H.bevelY, zRear(H.bevelY)]], hullIn);
        add("hull", "hull.side.lower", [[zRear(H.bottom), H.bottom], [zLow(H.bottom), H.bottom], [zLow(H.sponson), H.sponson], [zRear(H.sponson), H.sponson]]
            .map(([z, y]) => [s * B, y, z]), hullIn);
        add("hull", "hull.sponson.floor", [[s * B, H.sponson, zLow(H.sponson)], [s * W, H.sponson, zLow(H.sponson)], [s * W, H.sponson, zRear(H.sponson)], [s * B, H.sponson, zRear(H.sponson)]], [s * 5, 5, 0]);
        const skF = zLow(H.sponson) - 0.1, skR = zRear(H.sponson) + 0.1;
        add("hull", "hull.skirt", [[s * W, H.skirtLo, skF], [s * W, H.sponson, skF], [s * W, H.sponson, skR], [s * W, H.skirtLo, skR]], [0, 3, 0],
            { spaced: true, spacedId: s > 0 ? "skirtL" : "skirtR" });
    }
    add("hull", "hull.deck", [[D, H.deck, H.rearTopZ], [-D, H.deck, H.rearTopZ], [-D, H.deck, H.glacisTopZ], [D, H.deck, H.glacisTopZ]], hullIn,
        { holes: [{ x: 0, z: H.turretZ, r: H.ringR }, { x: 0, z: H.turret2Z, r: H.ring2R }] });
    add("hull", "hull.bottom", [[B, H.bottom, zRear(H.bottom)], [-B, H.bottom, zRear(H.bottom)], [-B, H.bottom, zLow(H.bottom)], [B, H.bottom, zLow(H.bottom)]], hullIn);

    /* ── башня главного калибра (по типу Drh LC/34 «Гнейзенау», средний ствол убран) ── */
    const T = TURRET;
    const F = (s, y) => { const z = turretFaceZ(y); return [s * (turretHalfX(z) - turretInset(y)), y, z]; };
    const R = (s, y) => { const z = T.rear + turretInset(y); return [s * (turretHalfX(z) - turretInset(y)), y, z]; };
    const tIn = [0, 1.6, 0];
    const PK = POCKET;
    const pocketHole = (gx) => [[gx - PK.half, PK.lo, turretFaceZ(PK.lo)], [gx + PK.half, PK.lo, turretFaceZ(PK.lo)], [gx + PK.half, PK.hi, turretFaceZ(PK.hi)], [gx - PK.half, PK.hi, turretFaceZ(PK.hi)]];
    add("turret", "turret.front", sym([F(1, T.y0), F(1, T.yc), F(1, T.y1)]), tIn, { holes: [pocketHole(GUN_X), pocketHole(-GUN_X)] });
    for (const gx of [GUN_X, -GUN_X]) {
        for (const sx of [gx - PK.half, gx + PK.half]) {
            const out = sx > gx ? 1 : -1;
            add("turret", "turret.front", [[sx, PK.lo, turretFaceZ(PK.lo)], [sx, PK.hi, turretFaceZ(PK.hi)], [sx, PK.hi, PK.back], [sx, PK.lo, PK.back]], [sx + out, 1.6, 5.5], { pocket: true });
        }
        add("turret", "turret.front", [[gx - PK.half, PK.lo, turretFaceZ(PK.lo)], [gx + PK.half, PK.lo, turretFaceZ(PK.lo)], [gx + PK.half, PK.lo, PK.back], [gx - PK.half, PK.lo, PK.back]], [gx, PK.lo - 1, 5.6], { pocket: true });
        add("turret", "turret.front", [[gx - PK.half, PK.hi, turretFaceZ(PK.hi)], [gx + PK.half, PK.hi, turretFaceZ(PK.hi)], [gx + PK.half, PK.hi, PK.back], [gx - PK.half, PK.hi, PK.back]], [gx, PK.hi + 1, 5.3], { pocket: true });
        add("turret", "turret.front", [[gx - PK.half, PK.lo, PK.back], [gx + PK.half, PK.lo, PK.back], [gx + PK.half, PK.hi, PK.back], [gx - PK.half, PK.hi, PK.back]], [gx, 1.6, PK.back - 1], { pocket: true });
    }
    for (const s of [1, -1]) {
        add("turret", "turret.side", [F(s, T.y0), F(s, T.yc), R(s, T.yc), R(s, T.y0)], tIn);
        add("turret", "turret.bevel", [F(s, T.yc), F(s, T.y1), R(s, T.y1), R(s, T.yc)], tIn);
    }
    add("turret", "turret.rear", sym([R(1, T.y0), R(1, T.yc)]), tIn);
    add("turret", "turret.bevel", sym([R(1, T.yc), R(1, T.y1)]), tIn);
    add("turret", "turret.roof", [F(1, T.y1), R(1, T.y1), R(-1, T.y1), F(-1, T.y1)], tIn);

    // щиты портов — гнутые сегменты вокруг оси цапф (для расчёта попаданий — гранями по 22°)
    for (const gx of [GUN_X, -GUN_X]) {
        const r1 = 0.70, a0 = -55 * DEG, a1 = 55 * DEG, N = 5, w = 0.5;
        for (let i = 0; i < N; i++) {
            const t0 = a0 + (a1 - a0) * (i / N), t1 = a0 + (a1 - a0) * ((i + 1) / N);
            const p = (t, x) => [x, r1 * Math.sin(t), r1 * Math.cos(t)];
            add("gun", "turret.mantlet", [p(t0, gx + w), p(t0, gx - w), p(t1, gx - w), p(t1, gx + w)], [gx, 0, 0], { mantlet: true });
        }
    }

    /* ── кормовая башня 128 мм ── */
    const T2 = TURRET2, t2In = [0, 1.0, -0.5];
    const ys = T2_YS;
    for (let i = 0; i < ys.length - 1; i++) {
        const a = ys[i], b = ys[i + 1];
        add("turret2", "turret2.front", [[t2HalfX(a), a, t2FrontZ(a)], [-t2HalfX(a), a, t2FrontZ(a)], [-t2HalfX(b), b, t2FrontZ(b)], [t2HalfX(b), b, t2FrontZ(b)]], t2In);
    }
    for (const s of [1, -1]) {
        add("turret2", "turret2.side", [...ys.map((y) => [s * t2HalfX(y), y, t2FrontZ(y)]), [s * t2HalfX(T2.y1), T2.y1, t2RearZ(T2.y1)], [s * t2HalfX(T2.y0), T2.y0, t2RearZ(T2.y0)]], t2In);
    }
    add("turret2", "turret2.rear", sym([[t2HalfX(T2.y0), T2.y0, t2RearZ(T2.y0)], [t2HalfX(T2.y1), T2.y1, t2RearZ(T2.y1)]]), t2In);
    add("turret2", "turret2.roof", sym([[t2HalfX(T2.y1), T2.y1, t2FrontZ(T2.y1)], [t2HalfX(T2.y1), T2.y1, t2RearZ(T2.y1)]]), t2In);
    {
        const r1 = T2.R + 0.23, a0 = -32 * DEG, a1 = 32 * DEG, N = 4, w = 0.65;
        for (let i = 0; i < N; i++) {
            const t0 = a0 + (a1 - a0) * (i / N), t1 = a0 + (a1 - a0) * ((i + 1) / N);
            const p = (t, x) => [x, r1 * Math.sin(t), r1 * Math.cos(t)];
            add("gun2", "turret2.mantlet", [p(t0, w), p(t0, -w), p(t1, -w), p(t1, w)], [0, 0, 0], { mantlet: true });
        }
    }

    /* ── щиты зенитных установок (открыты сверху и сзади) ── */
    for (const f of FLAK) {
        const y0 = H.deck + 0.45, y1 = H.deck + 1.55, z = f.z + 0.75;
        add("hull", "deck.flak", [[f.x + 0.95, y0, z], [f.x - 0.95, y0, z], [f.x - 0.95, y1, z], [f.x + 0.95, y1, z]], [f.x, y0, f.z - 1], { flak: f.id });
    }
    return P;
}

/* ───────────────────────── Внутренние модули ───────────────────────── */
// фигуры: ["box", w, h, d, x, y, z, rx?, ry?, rz?] | ["cyl", r, len, axis, x, y, z, seg?]
const b = (w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) => ["box", w, h, d, x, y, z, rx, ry, rz];
const c = (r, len, axis, x, y, z, seg = 20) => ["cyl", r, len, axis, x, y, z, seg];

const ENGINE_Z = [-16.0, -10.3, -7.8, -5.3];

/**
 * Модули модели. game — соответствие игровому модулю (тип, id, прочность; rounds — выстрелов в укладке).
 * aux: true — модуль только поглощает осколки, на ходовые качества не влияет.
 */
export const MODULES = [
    ...ENGINE_Z.flatMap((z, i) => [1, -1].map((s) => {
        const n = i * 2 + (s > 0 ? 1 : 2);
        return {
            id: `engine_${n}`, parent: "hull", cat: "engine", name: `Двигатель MB 501 №${n}`,
            desc: "20-цилиндровый дизель торпедных катеров, 2000 л. с.; вариант силовой установки — 8 таких двигателей",
            shapes: [b(1.1, 1.3, 2.3, s * 1.45, 2.75, z), b(0.5, 0.35, 2.0, s * 1.45, 3.55, z)], placement: "estimate",
            game: { id: n === 1 ? "engine" : `engine_${n}`, type: "engine", hp: 130 },
        };
    })),
    { id: "transmission", parent: "hull", cat: "transmission", name: "Трансмиссия и бортовые передачи", placement: "estimate",
        desc: "Схема трансмиссии в источниках не определена; вероятен электрический или гидромеханический привод на три гусеницы борта",
        shapes: [b(5.0, 1.5, 2.6, 0, 2.85, -13.2), c(0.55, 4.1, "x", 4.85, SPROCKET.y, SPROCKET.z), c(0.55, 4.1, "x", -4.85, SPROCKET.y, SPROCKET.z)],
        hitShapes: [b(5.0, 1.5, 2.6, 0, 2.85, -13.2)],
        game: { id: "transmission", type: "transmission", hp: 320 } },
    { id: "radiators", parent: "hull", cat: "cooling", name: "Радиаторы", desc: "Под решётками крыши машинного отделения", placement: "estimate",
        shapes: [b(4.6, 1.2, 1.6, 0, 6.3, -15.5), b(4.6, 1.2, 1.6, 0, 6.3, -11.5)],
        game: { id: "radiators", type: "radiator", hp: 120 } },
    ...[1, -1].map((s) => ({
        id: `fuel_${s > 0 ? "L" : "R"}`, parent: "hull", cat: "fuel", name: `Топливные баки ${s > 0 ? "левого" : "правого"} борта`,
        desc: "Баки в надгусеничных полках машинного отделения; запас хода ≈ 190 км", placement: "estimate",
        shapes: [b(3.2, 1.7, 10.4, s * 5.05, 4.85, -10.3)],
        game: { id: s > 0 ? "fuel_l" : "fuel_r", type: "fuel", hp: 170 },
    })),
    { id: "garage", parent: "hull", cat: "habitat", name: "Гараж на 2 мотоцикла BMW R12", desc: "Отсек с воротами в левом борту для разведывательных мотоциклов",
        shapes: [b(3.2, 2.5, 3.4, 5.05, 5.2, -2.65)], game: { id: "garage", type: "room", hp: 300, aux: true } },
    { id: "infirmary", parent: "hull", cat: "habitat", name: "Лазарет", desc: "Компактный медицинский отсек, правый борт: пока цел, раненые понемногу выздоравливают",
        shapes: [b(3.2, 2.5, 2.6, -5.05, 5.2, -3.1)], game: { id: "infirmary", type: "infirmary", hp: 120 } },
    { id: "lavatory", parent: "hull", cat: "habitat", name: "Санузел", desc: "Автономный санузел, правый борт",
        shapes: [b(2.0, 2.5, 1.2, -4.45, 5.2, -1.2)], game: { id: "lavatory", type: "room", hp: 200, aux: true } },
    { id: "generators", parent: "hull", cat: "electric", name: "Генераторы и аккумуляторы", desc: "Питание приводов башен, вентиляции и освещения: без них башни крутятся вручную",
        shapes: [b(2.4, 1.6, 2.2, 1.3, 2.85, -2.9), b(2.0, 1.0, 1.6, -1.4, 2.55, -2.9)], game: { id: "generators", type: "generator", hp: 160 } },
    { id: "upper_deck", parent: "hull", cat: "structure", name: "Межпалубное перекрытие", desc: "Условная верхняя палуба жилых и рабочих отсеков",
        shapes: [b(5.3, 0.06, 26.0, 0, 4.6, 2.7)], noLabel: true },
    { id: "ammo_shells", parent: "hull", cat: "ammo", name: "Снарядный погреб 280 мм", desc: "Под башней, нижняя палуба; на линкоре погреба были в корпусе, у Ratte — часть боезапаса в самой башне",
        shapes: [b(2.2, 1.9, 6.0, 1.35, 3.0, 3.5)], game: { id: "ammo1", type: "ammo", hp: 260, rounds: 60, order: 1 } },
    { id: "ammo_charges", parent: "hull", cat: "ammo", name: "Зарядный погреб 280 мм", desc: "Картузы и гильзы полузарядов",
        shapes: [b(2.2, 1.9, 6.0, -1.35, 3.0, 3.5)], game: { id: "ammo2", type: "ammo", hp: 240, rounds: 60, order: 2 } },
    { id: "hoists", parent: "turret", cat: "weapon", name: "Элеваторы подачи", desc: "Подъём снарядов и зарядов из погребов к орудиям: без них — подача вручную, втрое медленнее",
        shapes: [c(0.42, 6.2, "y", 1.3, -2.1, 1.4, 16), c(0.42, 6.2, "y", -1.3, -2.1, 1.4, 16)], game: { id: "hoists", type: "hoist", hp: 150 } },
    { id: "radio", parent: "hull", cat: "radio", name: "Радиорубка", desc: "Связь с командованием: радисты вызывают подкрепления сопровождения",
        shapes: [b(2.2, 1.6, 1.4, 0, 5.5, 11.6)], game: { id: "radio", type: "radio", hp: 90 } },
    { id: "driver_optics", parent: "hull", cat: "optics", name: "Приборы водителей", desc: "Бронированные смотровые приборы в ВЛД",
        shapes: [b(1.0, 0.5, 0.6, 1.4, 6.5, 13.9), b(1.0, 0.5, 0.6, -1.4, 6.5, 13.9)], game: { id: "driver_optics", type: "optic", hp: 60, aux: true } },
    ...BOW_MG.map((m) => ({
        id: m.id, parent: "hull", cat: "weapon", name: `Пулемёт MG 151/15 (${m.x > 0 ? "левый" : "правый"})`, desc: "15-мм установка в ВЛД",
        shapes: [b(0.3, 0.4, 1.4, m.x, 5.55, 14.4)], game: { id: m.id, type: "mg", hp: 60 },
    })),
    { id: "stores", parent: "hull", cat: "habitat", name: "Кладовые", desc: "Продовольствие, ЗИП, вещевое имущество",
        shapes: [b(3.2, 2.5, 4.5, 5.05, 5.2, 8.5), b(3.2, 2.5, 4.5, -5.05, 5.2, 8.5)], game: { id: "stores", type: "room", hp: 300, aux: true } },
    ...FLAK.map((f) => ({
        id: f.id, parent: "hull", cat: "weapon", name: `Flakvierling 38 (${f.x > 0 ? "левая" : "правая"})`, desc: "Счетверённая 20-мм зенитная установка на открытой площадке кормы",
        shapes: [b(1.4, 0.9, 1.6, f.x, H.deck + 0.75, f.z)], game: { id: f.id, type: "flak", hp: 80 },
    })),
    { id: "ammo_flak", parent: "hull", cat: "ammo", name: "Ящики боеприпасов Flak", desc: "Магазины 20-мм у зенитных установок",
        shapes: [b(1.2, 0.6, 0.8, 4.8, H.deck + 0.3, -15.8), b(1.2, 0.6, 0.8, -4.8, H.deck + 0.3, -15.8)] },
    // башня ГК
    { id: "gun_breech_l", parent: "gun", cat: "weapon", name: "Казённик левого 28 cm SK C/34", desc: "Клиновой затвор, противооткатные устройства; ВН −8…+40°", placement: "source",
        shapes: [b(1.0, 1.0, 2.2, GUN_X, 0, -1.0), b(0.5, 0.5, 2.6, GUN_X, 0.75, -0.2)], game: { id: "breech", type: "breech", hp: 300 } },
    { id: "gun_breech_r", parent: "gun", cat: "weapon", name: "Казённик правого 28 cm SK C/34", desc: "Клиновой затвор, противооткатные устройства; ВН −8…+40°", placement: "source",
        shapes: [b(1.0, 1.0, 2.2, -GUN_X, 0, -1.0), b(0.5, 0.5, 2.6, -GUN_X, 0.75, -0.2)], game: { id: "breech_r", type: "breech", hp: 300 } },
    { id: "ammo_turret", parent: "turret", cat: "ammo", name: "Укладка в башне ГК", desc: "Расходный боезапас у орудий (место среднего ствола отдано под боеприпасы)",
        shapes: [b(1.4, 1.2, 2.4, 0, 0.7, 2.6), b(7.0, 1.2, 0.9, 0, 0.7, -5.0)], game: { id: "ammo0", type: "ammo", hp: 220, rounds: 12, order: 0 } },
    { id: "rangefinder", parent: "turret", cat: "optics", name: "Дальномер 10,5 м", desc: "Стереодальномер в кормовой части башни: без него главный калибр бьёт с большим разбросом", placement: "source",
        shapes: [c(0.3, 10.4, "x", 0, 3.4, -3.8, 16)], game: { id: "rangefinder", type: "optic", hp: 90 } },
    { id: "turret_drive", parent: "turret", cat: "turretDrive", name: "Привод поворота башни ГК", desc: "Электродвигатели и погонная шестерня",
        shapes: [b(1.2, 1.0, 1.6, 3.2, 0.5, -1.8), b(1.2, 1.0, 1.6, -3.2, 0.5, -1.8)], game: { id: "drive", type: "drive", hp: 220 } },
    // кормовая башня
    { id: "gun2_breech", parent: "gun2", cat: "weapon", name: "Казённик 12,8 cm KwK 44", desc: "Раздельное заряжание; ВН −7…+23°", placement: "source",
        shapes: [b(0.55, 0.55, 1.4, 0, 0, -0.4)], game: { id: "breech2", type: "breech", hp: 160 } },
    { id: "ammo_turret2", parent: "turret2", cat: "ammo", name: "Укладка 128 мм", desc: "Снаряды и гильзы в кормовой нише: детонация выводит кормовую башню",
        shapes: [b(2.4, 0.9, 0.7, 0, 0.6, -1.7)], game: { id: "ammo_t2", type: "ammo2", hp: 110 } },
    { id: "turret2_drive", parent: "turret2", cat: "turretDrive", name: "Привод поворота башни 128 мм", desc: "Электропривод",
        shapes: [b(0.6, 0.5, 0.7, 1.3, 0.3, 0.2)], game: { id: "drive2", type: "drive", hp: 110 } },
];

/** Стволы для попаданий (системы цапф): x — смещение ствола от оси, z — от маски до дульного среза */
export const BARRELS = [
    { id: "barrel", frame: "gun", x: GUN_X, z0: 0.9, z1: MUZZLE_Z, r: 0.42, hp: 600 },
    { id: "barrel_r", frame: "gun", x: -GUN_X, z0: 0.9, z1: MUZZLE_Z, r: 0.42, hp: 600 },
    { id: "barrel2", frame: "gun2", x: 0, z0: 1.3, z1: MUZZLE2_Z, r: 0.16, hp: 220 },
];

/* ───────────────────────── Экипаж (20 человек) ───────────────────────── */
export const POSES = {
    seat: { kneeY: 0.0, kneeZ: 0.42, footY: -0.42, footZ: 0.5, handX: 0.17, handY: 0.25, handZ: 0.40 },
    low: { kneeY: 0.0, kneeZ: 0.42, footY: -0.45, footZ: 0.5, handX: 0.17, handY: 0.25, handZ: 0.40 },
};
const DECK_SEAT = 4.63 + 0.45;
/** pos — таз сидящего; open — открытое место (зенитчики на палубе) */
export const CREW = [
    { id: "driver_l", role: "driver", parent: "hull", pos: [1.4, DECK_SEAT, 13.2], rotY: 0, pose: "seat" },
    { id: "driver_r", role: "driver", parent: "hull", pos: [-1.4, DECK_SEAT, 13.2], rotY: 0, pose: "seat" },
    { id: "radio_1", role: "radio", parent: "hull", pos: [0.6, DECK_SEAT, 10.6], rotY: 0, pose: "seat" },
    { id: "radio_2", role: "radio", parent: "hull", pos: [-0.6, DECK_SEAT, 10.6], rotY: 0, pose: "seat" },
    { id: "mg_l", role: "mg", parent: "hull", pos: [3.4, DECK_SEAT, 13.3], rotY: 0, pose: "seat" },
    { id: "mg_r", role: "mg", parent: "hull", pos: [-3.4, DECK_SEAT, 13.3], rotY: 0, pose: "seat" },
    { id: "mech_1", role: "mechanic", parent: "hull", pos: [0, 2.55, -6.6], rotY: Math.PI, pose: "low" },
    { id: "mech_2", role: "mechanic", parent: "hull", pos: [0, 2.55, -9.1], rotY: Math.PI, pose: "low" },
    { id: "mech_3", role: "mechanic", parent: "hull", pos: [0, 2.55, -14.6], rotY: 0, pose: "low" },
    { id: "commander", role: "commander", parent: "turret", pos: [1.6, 1.9, -0.6], rotY: 0, pose: "seat" },
    { id: "rangefinder", role: "rangefinder", parent: "turret", pos: [-0.5, 1.9, -4.6], rotY: Math.PI, pose: "seat" },
    { id: "gunlayer_l", role: "gunlayer", parent: "turret", pos: [GUN_X + 1.2, 1.6, 2.4], rotY: 0, pose: "seat" },
    { id: "gunlayer_r", role: "gunlayer", parent: "turret", pos: [-GUN_X - 1.2, 1.6, 2.4], rotY: 0, pose: "seat" },
    { id: "loader_l", role: "loader", parent: "turret", pos: [1.0, 0.45, 1.6], rotY: -Math.PI / 2, pose: "seat" },
    { id: "loader_r", role: "loader", parent: "turret", pos: [-1.0, 0.45, 1.6], rotY: Math.PI / 2, pose: "seat" },
    { id: "t2_cmd", role: "t2cmd", parent: "turret2", pos: [0.7, 1.1, -0.9], rotY: 0, pose: "seat" },
    { id: "t2_gunner", role: "t2gunner", parent: "turret2", pos: [0.75, 0.55, 0.3], rotY: 0, pose: "seat" },
    { id: "t2_loader", role: "t2loader", parent: "turret2", pos: [-0.8, 0.45, -0.4], rotY: Math.PI / 2, pose: "seat" },
    { id: "flak_l", role: "flak", parent: "hull", pos: [4.8, H.deck + 0.75, -15.0], rotY: 0, pose: "seat", open: true },
    { id: "flak_r", role: "flak", parent: "hull", pos: [-4.8, H.deck + 0.75, -15.0], rotY: 0, pose: "seat", open: true },
];

/**
 * Ослабленные зоны (координаты модели): приборы, шаровые установки, ворота, двери, решётки, люки.
 * c — точка на листе, n — наружная нормаль, u — направление ширины; box — выступающий колпак (w × h × d).
 */
export function weakZones() {
    const nGl = [0, Math.sin(31 * DEG), Math.cos(31 * DEG)];
    const out = [];
    for (const x of [1.4, -1.4]) out.push({ name: "смотровой прибор водителя", parent: "hull", c: [x, 6.6, zUp(6.6)], n: nGl, u: [1, 0, 0], w: 1.0, h: 0.45, mm: 90 });
    for (const m of BOW_MG) out.push({ name: "шаровая установка MG 151/15", parent: "hull", c: [m.x, m.y, zUp(m.y)], n: nGl, u: [1, 0, 0], w: 0.9, h: 0.9, mm: 100, round: true });
    out.push({ name: "ворота гаража", parent: "hull", c: [H.halfWide, 5.15, -2.7], n: [1, 0, 0], u: [0, 0, 1], w: 3.0, h: 2.1, mm: 60 });
    out.push({ name: "дверь лазарета", parent: "hull", c: [-H.halfWide, 5.0, -3.0], n: [-1, 0, 0], u: [0, 0, 1], w: 1.0, h: 2.0, mm: 50 });
    for (const zc of [-15.5, -11.5]) for (const s of [1, -1]) {
        out.push({ name: "решётка радиаторов", parent: "hull", c: [s * 3.4, H.deck, zc], n: [0, 1, 0], u: [1, 0, 0], w: 2.6, h: 1.8, mm: 20 });
    }
    for (const [x, z] of [[1.8, 11.4], [-1.8, 11.4], [5.4, 9.5], [-5.4, 9.5], [5.4, -2.6], [-5.4, -2.6], [0, -4.0]]) {
        out.push({ name: "люк крыши корпуса", parent: "hull", c: [x, H.deck, z], n: [0, 1, 0], u: [1, 0, 0], w: 1.2, h: 1.2, mm: 30, round: true });
    }
    // выступающие колпаки башни ГК
    const y1 = TURRET.y1;
    for (const x of [3.9, -3.9]) out.push({ name: "колпак прицела наводчика", parent: "turret", box: [0.84, 0.45, 0.84], c: [x, y1 + 0.22, 1.6], mm: 60 });
    for (const s of [1, -1]) out.push({ name: "колпак окуляра дальномера", parent: "turret", box: [0.7, 0.76, 1.2], c: [s * 6.0, y1 + 0.3, -3.8], mm: 40, module: "rangefinder" });
    out.push({ name: "труба дальномера", parent: "turret", box: [10.6, 0.7, 0.7], c: [0, y1 + 0.3, -3.8], mm: 25, module: "rangefinder" });
    out.push({ name: "командирская башенка", parent: "turret", box: [1.4, 0.7, 1.4], c: [1.6, y1 + 0.35, -0.6], mm: 80 });
    for (const [x, z] of [[-2.2, -0.6], [3.4, -4.6], [-3.4, -4.6]]) out.push({ name: "люк крыши башни ГК", parent: "turret", c: [x, y1, z], n: [0, 1, 0], u: [1, 0, 0], w: 1.1, h: 1.1, mm: 50, round: true });
    // кормовая башня
    out.push({ name: "командирская башенка 128 мм", parent: "turret2", box: [0.84, 0.45, 0.84], c: [0.7, TURRET2.y1 + 0.22, -0.9], mm: 50 });
    return out;
}

/** План главной башни [z, полуширина] (для схем) */
export function turretPlan() {
    const T = TURRET;
    return [[T.f0, turretHalfX(T.f0)], [T.f1, turretHalfX(T.f1) - turretInset(T.y1)], [T.rear + turretInset(T.y1), turretHalfX(T.rear)], [T.rear, turretHalfX(T.rear)]];
}

export const RATTE_SPEC = {
    id: "ratte", dims: RATTE_DIMENSIONS, zones: ARMOR_ZONES, H, TRACK, ROAD, IDLER, SPROCKET, RETURN,
    gunPivot: GUN_PIVOT, muzzle: MUZZLE_Z, barrels: BARRELS, turretPlan: turretPlan(),
    turretFrames: {
        turret: { origin: [0, H.deck, H.turretZ] },
        turret2: { origin: [0, H.deck, H.turret2Z], pivot: GUN2_PIVOT, muzzle: MUZZLE2_Z },
    },
    // разнесённая броня: гусеницы по 3 на борт
    tracks: TRACK.xs.flatMap((x, k) => [1, -1].map((s) => ({ id: (s > 0 ? "trackL" : "trackR") + (k === 2 ? "" : k === 1 ? "2" : "3"), x: s * x, width: TRACK.width, top: TRACK.top, mm: 40, hp: 280 }))),
    belly: { min: [zRear(H.bottom), 0.3, -H.halfBelly], max: [zLow(H.bottom), H.bottom, H.halfBelly], zone: "hull.bottom", side: "hull.side.lower" },
    plates: armorPlates, modules: MODULES, crew: CREW, weakZones: weakZones(),
};
