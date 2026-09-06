export const WORLD = 3400;

export const SHELLS = [
    { name: "БР-350Б", type: "ББ", pen: 84, spd: 1500, col: "#ffd23f", dmg: 95 },
    { name: "ОФ-350", type: "ОФ", pen: 14, spd: 1050, col: "#ff8c42", dmg: 118 },
    { name: "БП-350", type: "БП", pen: 122, spd: 1750, col: "#8fd8ff", dmg: 80 },
];

export const MNAMES = {
    driver: "Механик-водитель",
    gunner: "Наводчик",
    loader: "Заряжающий",
    commander: "Командир",
    engine: "Двигатель",
    gun: "Орудие",
    ammo: "Боеукладка",
    fuel: "Топливный бак",
    ring: "Погон башни",
};

export const CREW_SHORT = {
    driver: "МЕХ",
    gunner: "НАВ",
    loader: "ЗАР",
    commander: "КМД",
};
export const RESPAWN_COSTS = {
    light: 100,
    med: 250,
    heavy: 450,
};
export const MOD_LIST = [
    ["engine", "ДВИГ"],
    ["gun", "ОРУД"],
    ["ring", "ПОГОН"],
    ["ammo", "БК"],
    ["fuel", "ТОПЛ"],
];

export const CLASSES = {
    light: {
        name: "ЛТ-25 «Оса»", kind: "ЛЁГКИЙ",
        L: 48, W: 30, tread: 6, tR: 11, barrel: 44, tOff: 2,
        speed: 185, turn: 2.7, turret: 3.0, reload: 4.6,
        pen: 56, dmg: 70, keep: 300, flank: true,
        armor: { front: 25, side: 15, rear: 12, turret: 22 },
        score: 150,
        body: "#6e6f5e", bodyD: "#575847", tur: "#77786a", barrelCol: "#4c4d40",
        schema: {
            mods: [
                { t: "driver", x: 15, y: -7, r: 6 },
                { t: "gun", x: 8, y: 0, r: 5, hp: 60, max: 60 },
                { t: "ring", x: 2, y: 0, r: 8, hp: 80, max: 80 },
                { t: "gunner", x: 4, y: 6, r: 5.5 },
                { t: "commander", x: -5, y: 0, r: 5.5 },
                { t: "ammo", x: 1, y: 10, r: 7 },
                { t: "fuel", x: -9, y: -9, r: 6 },
                { t: "engine", x: -16, y: 0, r: 9, hp: 90, max: 90 },
            ]
        },
    },
    med: {
        name: "Т-34-76", kind: "СРЕДНИЙ",
        L: 64, W: 38, tread: 8, tR: 15, barrel: 56, tOff: -2,
        speed: 150, turn: 2.1, turret: 2.3, reload: 6.2,
        pen: 78, dmg: 85, keep: 420, flank: false,
        armor: { front: 45, side: 30, rear: 25, turret: 52 },
        score: 250,
        body: "#5c6b3e", bodyD: "#47532f", tur: "#66754a", barrelCol: "#3f4729",
        schema: {
            mods: [
                { t: "driver", x: 21, y: -8, r: 6.5 },
                { t: "gun", x: 10, y: 0, r: 6, hp: 80, max: 80 },
                { t: "ring", x: -2, y: 0, r: 11, hp: 100, max: 100 },
                { t: "gunner", x: -2, y: 9, r: 6 },
                { t: "loader", x: -2, y: -9, r: 6 },
                { t: "commander", x: -11, y: 0, r: 5.5 },
                { t: "ammo", x: 6, y: 12, r: 9 },
                { t: "fuel", x: -14, y: -12, r: 7.5 },
                { t: "engine", x: -24, y: 0, r: 11, hp: 150, max: 150 },
            ]
        },
    },
    heavy: {
        name: "ТТ-41 «Молот»", kind: "ТЯЖЁЛЫЙ",
        L: 76, W: 46, tread: 10, tR: 18, barrel: 62, tOff: -4,
        speed: 95, turn: 1.35, turret: 1.5, reload: 8.6,
        pen: 102, dmg: 100, keep: 460, flank: false,
        armor: { front: 80, side: 55, rear: 40, turret: 90 },
        score: 400,
        body: "#4e5450", bodyD: "#3c413d", tur: "#565c58", barrelCol: "#33372f",
        schema: {
            mods: [
                { t: "driver", x: 27, y: -10, r: 7 },
                { t: "gun", x: 12, y: 0, r: 7, hp: 100, max: 100 },
                { t: "ring", x: -4, y: 0, r: 13, hp: 120, max: 120 },
                { t: "gunner", x: -3, y: 11, r: 6.5 },
                { t: "loader", x: -3, y: -11, r: 6.5 },
                { t: "commander", x: -14, y: 0, r: 6 },
                { t: "ammo", x: -15, y: 14, r: 9 },
                { t: "fuel", x: -15, y: -14, r: 8 },
                { t: "engine", x: -29, y: 0, r: 13, hp: 180, max: 180 },
            ]
        },
    },
};