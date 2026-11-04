/**
 * КВ-1 обр. 1941 г. (сварная башня, 76-мм пушка ЗИС-5) — геометрия детальной модели без three.js.
 * Общая для симуляции (броня, модули, экипаж — в т.ч. на онлайн-сервере) и рендера (js/render/models/KV1Model.js).
 *
 * Координаты модели: 1 ед. = 1 м; +Z — нос, +Y — вверх, +X — левый борт; начало — центр танка на грунте.
 * Башня — в своей системе (центр погона на крыше), орудие — в системе цапф.
 *
 * Источники: ru.wikipedia.org/wiki/КВ-1 (ТТХ, бронирование, вооружение, ходовая), фото КВ-1 Танкового музея
 * в Бовингтоне. Агрегаты, положение которых в источниках не описано, помечены placement: "estimate".
 */
const DEG = Math.PI / 180;

export const KV1_DIMENSIONS = {
    variant: "КВ-1 обр. 1941 г., сварная башня, 76-мм ЗИС-5",
    hullLength: 6.675, width: 3.32, height: 2.71, clearance: 0.45,
    mass: 47.5, crew: 5, turretRing: 1.535,
    track: { width: 0.70, pitch: 0.16, links: "86–90" },
    gun: { name: "76-мм ЗИС-5", calibre: 76.2, barrelCalibres: 41.6, elevation: [-5, 25] },
    ammo: { main: "111–116 (10 в нише башни, 78 в чемоданах на полу, 23–28 справа от мехвода)", mg: 2772 },
    engine: "В-2К, 12-цил. дизель, 600 л. с.",
    fuel: "600–615 л (баки в боевом отделении и МТО)",
};

/** Зоны бронирования: mm / angle (° от вертикали) — по таблице ТТХ; est — оценка; g — название в игре */
export const ARMOR_ZONES = {
    "hull.front.upper": { short: "ВЛД", name: "Верхний лобовой лист", g: "ВЛД", mm: 75, angle: 30 },
    "hull.front.middle": { short: "СЛД", name: "Средний лобовой лист", g: "средний лобовой лист", mm: 60, angle: 70 },
    "hull.front.lower": { short: "НЛД", name: "Нижний лобовой лист", g: "НЛД", mm: 75, angle: 25 },
    "hull.side.upper": { short: "Борт ↑", name: "Борт корпуса, надгусеничный", g: "борт над гусеницей", mm: 75, angle: 0 },
    "hull.side.lower": { short: "Борт ↓", name: "Борт корпуса, нижний", g: "борт корпуса", mm: 75, angle: 0 },
    "hull.sponson.floor": { short: "Полка", name: "Днище надгусеничной ниши", g: "днище ниши", mm: 40, angle: 90, est: true },
    "hull.roof.front": { short: "Крыша ОУ", name: "Крыша отделения управления", g: "крыша корпуса", mm: 40, angle: 90 },
    "hull.roof.turret": { short: "Крыша БО", name: "Крыша боевого отделения", g: "крыша корпуса", mm: 40, angle: 90 },
    "hull.roof.engine": { short: "Крыша МТО", name: "Крыша моторно-трансмиссионного отделения", g: "крыша МТО", mm: 30, angle: 90 },
    "hull.rear.upper": { short: "Корма ↑", name: "Кормовой лист, верхний", g: "верхний кормовой лист", mm: 60, angle: 50 },
    "hull.rear.lower": { short: "Корма ↓", name: "Кормовой лист, нижний (гнутый)", g: "нижний кормовой лист", mm: 75, angle: "0–90" },
    "hull.bottom.front": { short: "Днище", name: "Днище, передняя часть", g: "днище", mm: 40, angle: 90 },
    "hull.bottom.rear": { short: "Днище", name: "Днище, задняя часть", g: "днище", mm: 30, angle: 90 },
    "turret.front": { short: "Лоб башни", name: "Лобовая деталь башни", g: "лоб башни", mm: 75, angle: 20 },
    "turret.mantlet": { short: "Маска", name: "Маска орудия (гнутая плита)", g: "маска орудия", mm: 90, angle: "0–55" },
    "turret.side": { short: "Борт башни", name: "Борт башни", g: "борт башни", mm: 75, angle: 15 },
    "turret.rear": { short: "Корма башни", name: "Кормовой лист ниши башни", g: "корма башни", mm: 75, angle: 15 },
    "turret.niche.floor": { short: "Ниша", name: "Дно кормовой ниши", g: "дно ниши башни", mm: 40, angle: 90, est: true },
    "turret.niche.wall": { short: "Ниша", name: "Стенка под нишей", g: "стенка под нишей", mm: 75, angle: 0, est: true },
    "turret.roof": { short: "Крыша башни", name: "Крыша башни", g: "крыша башни", mm: 40, angle: 90 },
    "screen.turret": { short: "Экран", name: "Экран башни (КВ-1Э, на болтах)", g: "экран башни", mm: 25, angle: 15, spaced: true },
    "screen.hull": { short: "Экран", name: "Экран борта (КВ-1Э, на болтах)", g: "экран борта", mm: 25, angle: 0, spaced: true },
};

export const MODULE_CATEGORIES = {
    engine: { name: "Двигатель", color: "#e0782f" },
    cooling: { name: "Охлаждение", color: "#46b3c9" },
    transmission: { name: "Трансмиссия", color: "#8f62c4" },
    fuel: { name: "Топливные баки", color: "#e3c13b" },
    oil: { name: "Масляный бак", color: "#a9743f" },
    ammo: { name: "Боеукладка", color: "#d8413a" },
    weapon: { name: "Вооружение", color: "#7c8592" },
    optics: { name: "Приборы наблюдения", color: "#8fd3f0" },
    radio: { name: "Связь", color: "#3f6fd8" },
    electric: { name: "Электрооборудование", color: "#57b05a" },
    air: { name: "Воздушный пуск", color: "#c3c8ce" },
    turretDrive: { name: "Поворот башни", color: "#c65fa8" },
    suspension: { name: "Торсионы подвески", color: "#99a08a" },
};

export const CREW_ROLES = {
    commander: { name: "Командир танка", color: "#d8413a", place: "башня, справа от орудия; люк в крыше башни" },
    gunner: { name: "Наводчик", color: "#e3a33b", place: "башня, слева от орудия; прицелы ТОД-6 и ПТ-6" },
    loader: { name: "Заряжающий", color: "#2fae8f", place: "башня, слева, позади наводчика" },
    driver: { name: "Механик-водитель", color: "#3f6fd8", place: "по центру отделения управления" },
    radio: { name: "Стрелок-радист", color: "#8f62c4", place: "слева от механика-водителя; курсовой ДТ, люк в крыше корпуса" },
};

export const COMPARTMENTS = [
    { id: "control", name: "Отделение управления", z: [1.62, 3.05], color: "#3f6fd8" },
    { id: "fighting", name: "Боевое отделение", z: [-0.75, 1.62], color: "#d8413a" },
    { id: "mto", name: "Моторно-трансмиссионное отделение", z: [-3.3, -0.75], color: "#e0782f" },
];

/* ───────────────────────── Основные размеры ───────────────────────── */
export const H = {
    bottom: 0.45, sponson: 1.27, roof: 1.62,
    halfLow: 0.90, halfUp: 1.27,
    noseBottomZ: 3.03, noseTipZ: 3.28, noseTipY: 0.98,
    upperBottomZ: 2.54, roofFrontZ: 2.33,
    roofRearZ: -2.97, rearZ: -3.39, rearKneeY: 0.85, rearBottomZ: -2.99,
    turretZ: 0.30, ringR: 1.535 / 2,
};
export const TRACK = { x: 1.31, width: 0.70, pitch: 0.16, top: 1.20 };
export const ROAD = { r: 0.30, y: 0.346, z: [-2.18, -1.344, -0.508, 0.328, 1.164, 2.0] };
export const IDLER = { z: 2.80, y: 0.62, r: 0.32 };
export const SPROCKET = { z: -2.95, y: 0.72, r: 0.31 };
export const RETURN = { r: 0.13, y: 1.03, z: [-1.88, -0.23, 1.45] };
export const GUN_PIVOT = [0, 0.45, 0.62];          // в системе башни
export const MUZZLE_Z = 2.44;                       // дульный срез от оси цапф

/* ───────────────────────── Броневые листы ───────────────────────── */
const quadX = (hw, a, b) => [[hw, a[1], a[0]], [-hw, a[1], a[0]], [-hw, b[1], b[0]], [hw, b[1], b[0]]];

export function rearProfile() {
    const out = [[H.rearZ, H.sponson], [H.rearZ, H.rearKneeY]];
    for (let i = 1; i <= 4; i++) {
        const a = Math.PI + (i / 4) * (Math.PI / 2);
        out.push([H.rearBottomZ + 0.40 * Math.cos(a), H.rearKneeY + 0.40 * Math.sin(a)]);
    }
    return out;
}

/** Профиль сварной башни сбоку [z, y] и ширина её половины на высоте y (борта 15°) */
export const TURRET_PROFILE = [[0.95, 0.02], [0.64, 0.86], [-1.30, 0.86], [-1.155, 0.32], [-0.80, 0.32], [-0.80, 0.02]];
export const turretHalfWidth = (y) => 1.0 - y * Math.tan(15 * DEG);

/**
 * Все броневые листы: внешняя грань — многоугольник pts, толщина уходит внутрь (к точке interior).
 * parent: hull | turret | gun; spaced — экраны КВ-1Э (в игровой модели не установлены).
 */
export function armorPlates({ screens = false } = {}) {
    const P = [];
    const add = (parent, zone, pts, interior, extra = {}) => P.push({ parent, zone, pts, mm: ARMOR_ZONES[zone].mm, interior, ...extra });
    const hullIn = [0, 1.05, -0.2];

    // лоб: НЛД, средний лист, ВЛД
    add("hull", "hull.front.lower", quadX(H.halfLow, [H.noseBottomZ, H.bottom], [H.noseTipZ, H.noseTipY]), hullIn);
    add("hull", "hull.front.middle", quadX(H.halfLow, [H.noseTipZ, H.noseTipY], [H.upperBottomZ, H.sponson]), hullIn);
    add("hull", "hull.front.upper", quadX(H.halfUp, [H.upperBottomZ, H.sponson], [H.roofFrontZ, H.roof]), hullIn);

    // корма: верхний лист 60/50°, нижний — гнутый 75 мм (вертикаль → горизонталь)
    add("hull", "hull.rear.upper", quadX(H.halfUp, [H.roofRearZ, H.roof], [H.rearZ, H.sponson]), hullIn);
    const rp = rearProfile();
    for (let i = 0; i < rp.length - 1; i++) add("hull", "hull.rear.lower", quadX(H.halfLow, rp[i], rp[i + 1]), hullIn);

    // борта: нижний замыкается по профилю гнутого кормового листа; над гусеницами — ниши
    const lowSide = [[H.rearBottomZ, H.bottom], [H.noseBottomZ, H.bottom], [H.noseTipZ, H.noseTipY], [H.upperBottomZ, H.sponson], ...rp.slice(0, -1)];
    for (const s of [1, -1]) {
        add("hull", "hull.side.lower", lowSide.map(([z, y]) => [s * H.halfLow, y, z]), hullIn);
        add("hull", "hull.side.upper", [[H.upperBottomZ, H.sponson], [H.roofFrontZ, H.roof], [H.roofRearZ, H.roof], [H.rearZ, H.sponson]].map(([z, y]) => [s * H.halfUp, y, z]), hullIn);
        add("hull", "hull.sponson.floor", [[s * H.halfLow, H.sponson, H.upperBottomZ], [s * H.halfUp, H.sponson, H.upperBottomZ], [s * H.halfUp, H.sponson, H.rearZ], [s * H.halfLow, H.sponson, H.rearZ]], [s * 1.08, 1.45, 0]);
    }

    // крыша (в листе боевого отделения — вырез под погон)
    const roofRect = (z0, z1) => [[H.halfUp, H.roof, z0], [-H.halfUp, H.roof, z0], [-H.halfUp, H.roof, z1], [H.halfUp, H.roof, z1]];
    add("hull", "hull.roof.front", roofRect(1.50, H.roofFrontZ), hullIn);
    add("hull", "hull.roof.turret", roofRect(-0.55, 1.50), hullIn, { hole: { x: 0, z: H.turretZ, r: H.ringR } });
    add("hull", "hull.roof.engine", roofRect(H.roofRearZ, -0.55), hullIn);

    // днище
    const bottomRect = (z0, z1) => [[H.halfLow, H.bottom, z0], [-H.halfLow, H.bottom, z0], [-H.halfLow, H.bottom, z1], [H.halfLow, H.bottom, z1]];
    add("hull", "hull.bottom.front", bottomRect(1.0, H.noseBottomZ), hullIn);
    add("hull", "hull.bottom.rear", bottomRect(H.rearBottomZ, 1.0), hullIn);

    // башня
    const tIn = [0, 0.45, -0.2];
    const TP = TURRET_PROFILE;
    const tPt = (s, [z, y]) => [s * turretHalfWidth(y), y, z];
    const across = (a, b) => [tPt(1, a), tPt(-1, a), tPt(-1, b), tPt(1, b)];
    add("turret", "turret.front", across(TP[0], TP[1]), tIn);
    add("turret", "turret.roof", across(TP[1], TP[2]), tIn);
    add("turret", "turret.rear", across(TP[2], TP[3]), tIn);
    add("turret", "turret.niche.floor", across(TP[3], TP[4]), tIn);
    add("turret", "turret.niche.wall", across(TP[4], TP[5]), tIn);
    for (const s of [1, -1]) add("turret", "turret.side", TP.map((p) => tPt(s, p)), tIn);

    // маска орудия: гнутая плита 90 мм вокруг оси цапф (для расчёта попаданий — гранями по 18°)
    const R = 0.30, N = 6, a0 = -55 * DEG, a1 = 55 * DEG;
    for (let i = 0; i < N; i++) {
        const t0 = a0 + (a1 - a0) * (i / N), t1 = a0 + (a1 - a0) * ((i + 1) / N);
        const p = (t, x) => [x, R * Math.sin(t), R * Math.cos(t)];
        add("gun", "turret.mantlet", [p(t0, 0.46), p(t0, -0.46), p(t1, -0.46), p(t1, 0.46)], [0, 0, 0], { mantlet: true });
    }

    if (screens) {
        // экраны КВ-1Э: 25 мм с зазором 40 мм (в игре не используются)
        for (const s of [1, -1]) add("hull", "screen.hull", [[2.30, 1.30], [2.12, 1.60], [-2.70, 1.60], [-2.70, 1.30]].map(([z, y]) => [s * (H.halfUp + 0.065), y, z]), hullIn, { spaced: true });
    }
    return P;
}

/* ───────────────────────── Внутренние модули ───────────────────────── */
// фигуры: ["box", w, h, d, x, y, z, rx?, ry?, rz?] | ["cyl", r, len, axis, x, y, z, seg?]
const b = (w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) => ["box", w, h, d, x, y, z, rx, ry, rz];
const c = (r, len, axis, x, y, z, seg = 20) => ["cyl", r, len, axis, x, y, z, seg];

function floorCases() {
    const out = [];
    for (const x of [-0.60, -0.30, 0, 0.30, 0.60]) for (const z of [0.0, 0.94]) out.push(b(0.28, 0.15, 0.92, x, 0.57, z));
    for (const x of [-0.30, 0, 0.30]) out.push(b(0.28, 0.15, 0.92, x, 0.72, 0.94));
    return out;
}

function torsionBars() {
    const out = [];
    ROAD.z.forEach((z) => { for (const s of [1, -1]) out.push(c(0.028, 1.66, "x", 0, 0.53, z + 0.36 + s * 0.035, 8)); });
    return out;
}

/**
 * Модули модели. game — соответствие игровому модулю (тип, id, прочность; rounds — выстрелов в укладке).
 * aux: true — модуль только поглощает осколки, на ходовые качества не влияет.
 */
export const MODULES = [
    { id: "engine", parent: "hull", cat: "engine", name: "Двигатель В-2К", desc: "12-цилиндровый V-образный дизель, 38,9 л, 600 л. с. при 1800 об/мин",
        shapes: [b(0.62, 0.50, 1.55, 0, 0.88, -1.62), b(0.30, 0.34, 1.42, 0.20, 1.27, -1.62, 0, 0, -32 * DEG), b(0.30, 0.34, 1.42, -0.20, 1.27, -1.62, 0, 0, 32 * DEG),
            b(0.46, 0.16, 1.40, 0, 0.58, -1.62), c(0.12, 0.16, "z", 0, 1.0, -0.84)],
        game: { id: "engine", type: "engine", hp: 150 } },
    { id: "radiators", parent: "hull", cat: "cooling", name: "Радиаторы", desc: "Два трубчато-пластинчатых радиатора по бортам двигателя; воздух через жалюзи крыши МТО", placement: "estimate",
        shapes: [b(0.12, 0.52, 1.30, 0.66, 1.15, -1.62, 0, 0, 22 * DEG), b(0.12, 0.52, 1.30, -0.66, 1.15, -1.62, 0, 0, -22 * DEG)],
        game: { id: "radiators", type: "radiator", hp: 60, aux: true } },
    { id: "fan", parent: "hull", cat: "cooling", name: "Вентилятор", desc: "Вентилятор системы охлаждения на маховике двигателя", placement: "estimate",
        shapes: [c(0.40, 0.12, "z", 0, 1.0, -2.48, 28)] },
    { id: "transmission", parent: "hull", cat: "transmission", name: "Трансмиссия", desc: "Главный фрикцион, 5-ступенчатая КПП, бортовые фрикционы и ленточные тормоза, планетарные бортовые редукторы",
        shapes: [c(0.30, 0.20, "z", 0, 1.0, -2.70, 24), b(0.80, 0.55, 0.48, 0, 0.86, -3.02), c(0.25, 0.26, "x", 0.56, 0.80, -2.98), c(0.25, 0.26, "x", -0.56, 0.80, -2.98),
            c(0.20, 0.16, "x", 0.80, SPROCKET.y, SPROCKET.z), c(0.20, 0.16, "x", -0.80, SPROCKET.y, SPROCKET.z)],
        // для попаданий — без бортовых редукторов у самых гусениц
        hitShapes: [c(0.30, 0.20, "z", 0, 1.0, -2.70, 24), b(0.80, 0.55, 0.48, 0, 0.86, -3.02), c(0.25, 0.26, "x", 0.56, 0.80, -2.98), c(0.25, 0.26, "x", -0.56, 0.80, -2.98)],
        game: { id: "transmission", type: "transmission", hp: 120 } },
    { id: "fuel_mto_l", parent: "hull", cat: "fuel", name: "Топливный бак МТО (левый)", desc: "Часть основных баков 600–615 л расположена в МТО", placement: "estimate",
        shapes: [b(0.30, 0.30, 1.30, 0.62, 0.66, -1.62)], game: { id: "fuel1", type: "fuel", hp: 70 } },
    { id: "fuel_mto_r", parent: "hull", cat: "fuel", name: "Топливный бак МТО (правый)", desc: "Часть основных баков 600–615 л расположена в МТО", placement: "estimate",
        shapes: [b(0.30, 0.30, 1.30, -0.62, 0.66, -1.62)], game: { id: "fuel2", type: "fuel", hp: 70 } },
    { id: "fuel_fc", parent: "hull", cat: "fuel", name: "Топливный бак боевого отделения", desc: "Часть основных баков находится в боевом отделении, у моторной перегородки", placement: "estimate",
        shapes: [b(0.36, 0.72, 0.27, -0.62, 0.86, -0.605)], game: { id: "fuel3", type: "fuel", hp: 70 } },
    { id: "oil", parent: "hull", cat: "oil", name: "Масляный бак", desc: "Бак масляной системы двигателя", placement: "estimate",
        shapes: [b(0.30, 0.56, 0.27, 0.62, 0.78, -0.605)], game: { id: "oil", type: "oil", hp: 50, aux: true } },
    { id: "air", parent: "hull", cat: "air", name: "Баллоны сжатого воздуха", desc: "Два баллона по 5 л для воздушного пуска двигателя (в боевом отделении)",
        shapes: [c(0.075, 0.55, "y", -0.74, 0.86, 1.48, 14), c(0.075, 0.55, "y", -0.74, 0.86, 1.62, 14)] },
    { id: "batteries", parent: "hull", cat: "electric", name: "Аккумуляторные батареи", desc: "4 × 6-СТЭ-128, 24 В, 128 А·ч", placement: "estimate",
        shapes: [b(0.27, 0.24, 0.19, 0.48, 0.61, 1.52), b(0.27, 0.24, 0.19, 0.48, 0.61, 1.72), b(0.27, 0.24, 0.19, 0.72, 0.61, 1.52), b(0.27, 0.24, 0.19, 0.72, 0.61, 1.72)],
        game: { id: "batteries", type: "battery", hp: 40, aux: true } },
    { id: "torsion", parent: "hull", cat: "suspension", name: "Торсионы подвески", desc: "Индивидуальная торсионная подвеска, 6 торсионов на борт, вдоль днища",
        shapes: torsionBars(), noLabel: true },
    { id: "radio", parent: "hull", cat: "radio", name: "Радиостанция 10-Р", desc: "Радиостанция у рабочего места стрелка-радиста",
        shapes: [b(0.36, 0.26, 0.30, 0.60, 1.00, 2.62)], game: { id: "radio", type: "radio", hp: 40, aux: true } },
    { id: "hull_mg", parent: "hull", cat: "weapon", name: "Курсовой ДТ-29", desc: "Курсовой пулемёт в шаровой установке ВЛД",
        shapes: [b(0.07, 0.10, 0.40, 0.40, 1.42, 2.24), c(0.07, 0.04, "y", 0.40, 1.49, 2.22, 16)] },
    { id: "driver_optics", parent: "hull", cat: "optics", name: "Приборы механика-водителя", desc: "Смотровой прибор в ВЛД и два перископа в крыше",
        shapes: [b(0.30, 0.13, 0.16, 0, 1.46, 2.34), b(0.09, 0.14, 0.10, -0.16, 1.53, 2.18), b(0.09, 0.14, 0.10, 0.12, 1.53, 2.18)] },
    { id: "ammo_floor", parent: "hull", cat: "ammo", name: "Боеукладка на полу (78 выстр.)", desc: "13 «чемоданов» по 6 унитарных выстрелов на полу боевого отделения",
        shapes: floorCases(), game: { id: "ammo1", type: "ammo", hp: 60, rounds: 78, order: 2 } },
    { id: "ammo_driver", parent: "hull", cat: "ammo", name: "Укладка у правого борта (25 выстр.)", desc: "23–28 выстрелов справа от механика-водителя у борта",
        shapes: [b(0.37, 0.70, 0.92, -0.635, 0.85, 2.17)], rack: true, game: { id: "ammo2", type: "ammo", hp: 60, rounds: 25, order: 1 } },
    { id: "ammo_niche", parent: "turret", cat: "ammo", name: "Укладка в нише башни (10 выстр.)", desc: "Стеллаж в кормовой нише башни",
        shapes: [b(0.98, 0.20, 0.50, 0, 0.46, -1.04)], rack: true, game: { id: "ammo0", type: "ammo", hp: 55, rounds: 10, order: 0 } },
    { id: "gun_breech", parent: "gun", cat: "weapon", name: "Казённик и противооткатные устройства ЗИС-5", desc: "Пушка уравновешена на цапфах; ВН −5…+25°, ручной механический спуск",
        shapes: [b(0.30, 0.30, 0.48, 0, 0, -0.42), b(0.10, 0.10, 0.80, 0, 0.15, -0.20), b(0.10, 0.10, 0.80, 0, -0.15, -0.20), b(0.36, 0.06, 0.30, 0, -0.18, -0.85)],
        game: { id: "breech", type: "breech", hp: 120 } },
    { id: "coax_mg", parent: "gun", cat: "weapon", name: "Спаренный ДТ-29", desc: "Пулемёт, спаренный с пушкой (справа)",
        shapes: [b(0.08, 0.12, 0.62, -0.19, -0.02, -0.05), c(0.07, 0.04, "y", -0.19, 0.06, -0.10, 14)] },
    { id: "sight_tod", parent: "gun", cat: "optics", name: "Телескопический прицел ТОД-6", desc: "Прицел наводчика, слева от пушки",
        shapes: [c(0.035, 0.95, "z", 0.18, 0.04, -0.17, 12)] },
    { id: "sight_pt", parent: "turret", cat: "optics", name: "Перископические приборы", desc: "Прицел ПТ-6 наводчика и перископ командира",
        shapes: [b(0.10, 0.36, 0.12, 0.34, 0.74, 0.30), b(0.10, 0.32, 0.12, -0.30, 0.74, 0.22)] },
    { id: "rear_mg", parent: "turret", cat: "weapon", name: "Кормовой ДТ-29", desc: "Пулемёт в шаровой установке кормы башни",
        shapes: [b(0.08, 0.08, 0.60, 0, 0.62, -0.93)] },
    { id: "turret_drive", parent: "turret", cat: "turretDrive", name: "Механизм поворота башни", desc: "Электромотор поворота башни и ручной привод", placement: "estimate",
        shapes: [b(0.26, 0.30, 0.34, 0.66, 0.16, 0.30), c(0.07, 0.24, "x", 0.48, 0.16, 0.30)], game: { id: "drive", type: "drive", hp: 70 } },
];

/** Ствол для попаданий: от маски до дульного среза (система цапф) */
export const BARREL = { z0: 0.25, z1: MUZZLE_Z, r: 0.07 };

/* ───────────────────────── Экипаж ───────────────────────── */
export const POSES = {
    seatedFwd: { kneeY: 0.02, kneeZ: 0.42, footY: -0.26, footZ: 0.55, handX: 0.17, handY: 0.22, handZ: 0.40 },
    turretSeat: { kneeY: -0.18, kneeZ: 0.36, footY: -0.68, footZ: 0.38, handX: 0.16, handY: 0.30, handZ: 0.36 },
};
/** pos — таз сидящего; для попаданий центр корпуса на 0,3 м выше */
export const CREW = [
    { id: "driver", role: "driver", parent: "hull", pos: [0, 0.74, 1.98], rotY: 0, pose: "seatedFwd" },
    { id: "radio", role: "radio", parent: "hull", pos: [0.47, 0.74, 1.93], rotY: 0, pose: "seatedFwd" },
    { id: "gunner", role: "gunner", parent: "turret", pos: [0.40, -0.30, 0.10], rotY: 0, pose: "turretSeat" },
    { id: "commander", role: "commander", parent: "turret", pos: [-0.42, -0.18, -0.20], rotY: 0, pose: "turretSeat" },
    { id: "loader", role: "loader", parent: "turret", pos: [0.46, -0.34, -0.62], rotY: -Math.PI / 2 + 0.3, pose: "turretSeat" },
];

export const KV1_SPEC = {
    id: "kv1", dims: KV1_DIMENSIONS, zones: ARMOR_ZONES, H, TRACK, ROAD, IDLER, SPROCKET, RETURN,
    gunPivot: GUN_PIVOT, muzzle: MUZZLE_Z, barrel: BARREL, turretProfile: TURRET_PROFILE, turretHalfWidth,
    plates: armorPlates, modules: MODULES, crew: CREW,
};
