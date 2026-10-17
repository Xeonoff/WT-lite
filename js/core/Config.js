/** Глобальные игровые константы. Единицы: метры, секунды, радианы (если не указано иное). */
export const Config = {
    CAMERA: {
        FOV: 40,
        HEIGHT: 135,          // высота камеры по умолчанию
        MIN_H: 60,
        MAX_H: 240,
        LEAD: 0.3,            // смещение камеры к прицелу
        BINOC_LEAD: 0.66,     // ПКМ — бинокль командира
        BINOC_ZOOM: 1.25,
    },

    // Скорость снарядов в игре = реальная начальная скорость * коэффициент
    SHELL_SPEED_SCALE: 0.5,
    // Пробитие падает с дистанцией; игровая дистанция умножается на коэффициент
    PEN_RANGE_SCALE: 2.2,
    SHELL_MAX_RANGE: 650,

    // Пороги состояний модулей (доля прочности)
    MOD_DMG: 0.66,
    MOD_CRIT: 0.33,

    CREW: {
        HP: 100,
        SWAP_HULL: 4.5,        // пересадка внутри корпуса, с
        SWAP_CROSS: 6.5,       // пересадка корпус <-> башня, с
        MIN_ALIVE: 2,          // меньше двух живых — машина потеряна
    },

    FIRE: {
        DUR_MIN: 14,
        DUR_MAX: 24,
        MOD_DPS: 5,
        CREW_DPS: 4.5,
        RADIUS: 1.8,
        AMMO_CHANCE_PS: 0.035,
        CHANCE_FUEL: 0.55,
        CHANCE_ENGINE: 0.35,
    },

    REPAIR: {
        BASE: 5,
        PER_CRIT: 2.6,
        PER_DMG: 0.8,
        RESTORE_TO: 0.5,
    },

    SPOT: {
        RANGE: 255,
        BUSH_STILL: 75,
        BUSH_MOVING: 135,
        FIRED_REVEAL: 3.0,
        PROXIMITY: 32,
        MEMORY: 2.5,
    },

    DOMINATION: {
        TICKETS: 600,
        KILL_COST: 10,
        BLEED: 0.55,
        CAP_RATE: 6.5,
        TIME: 15 * 60,
        TEAM_SIZE: 6,
        BOT_LIVES: 3,
    },

    ARTY: {
        FIRST: 25,            // доступен через N с после выезда
        COOLDOWN: 80,
        BOT_MULT: 3,          // боты вызывают реже
        DELAY: 3.2,           // от вызова до первого разрыва
        SHELLS: 8,
        SPREAD: 10,
        RANGE: 330,
    },

    WAVES: {
        BREAK: 9,
        CAP_RATE: 1.6,
    },

    SP: {
        HIT: 4, CRIT: 12, KILL: 90, ASSIST: 30, CAPTURE: 45, WAVE: 60,
        COST: { 1: 80, 2: 120, 3: 160 },
        RESERVE_WAIT: 25,
    },

    RP: {
        HIT: 6, CRIT: 18, KILL: 110, ASSIST: 40, CAPTURE: 60, WIN_MULT: 1.5, BASE: 120, WAVE: 70,
    },
};
