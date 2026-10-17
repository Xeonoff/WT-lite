import { Config } from "../core/Config.js";
import { clamp, lerp } from "../core/Utils.js";

/**
 * Типы боеприпасов. Углы — в градусах от нормали.
 *  ricoStart/ricoFull — диапазон, в котором шанс рикошета растёт от 0 до 100%
 *  norm — нормализация (доворот к нормали брони)
 *  cone — половина угла конуса осколков после пробития
 */
export const SHELL_TYPES = {
    AP: {
        short: "ББ", name: "Бронебойный", color: "#ffd25a",
        ricoStart: 52, ricoFull: 72, norm: 5, cone: 22, fragMul: 1.0, bodyMul: 1.0,
        desc: "Сплошной бронебойный снаряд. Пробивает броню, а затем сам снаряд и вторичные осколки брони поражают модули и экипаж на своём пути.",
    },
    APHE: {
        short: "БРс", name: "Бронебойный каморный", color: "#ffb347",
        ricoStart: 48, ricoFull: 70, norm: 5, cone: 20, fragMul: 0.8, bodyMul: 0.9,
        desc: "Бронебойный снаряд с зарядом ВВ. После пробития взрывается внутри машины с небольшой задержкой — мощное заброневое действие. Не взводится о тонкую броню.",
    },
    APCR: {
        short: "БП", name: "Подкалиберный", color: "#8fd8ff",
        ricoStart: 40, ricoFull: 64, norm: 2, cone: 13, fragMul: 0.55, bodyMul: 0.7,
        desc: "Твёрдый сердечник: высокое пробитие вблизи, но быстро теряет его с дистанцией, легче рикошетит и даёт мало осколков.",
    },
    HEAT: {
        short: "КС", name: "Кумулятивный", color: "#c58bff",
        ricoStart: 66, ricoFull: 82, norm: 0, cone: 9, fragMul: 0.45, bodyMul: 0.8,
        desc: "Пробитие не зависит от дистанции. Узкая кумулятивная струя: поражает модули строго по линии, экраны и гусеницы сильно снижают её пробитие.",
    },
    HE: {
        short: "ОФ", name: "Осколочно-фугасный", color: "#ff8a4c",
        ricoStart: 80, ricoFull: 89, norm: 0, cone: 0, fragMul: 0, bodyMul: 0,
        desc: "Фугасное и осколочное действие. Сбивает гусеницы и стволы, разрушает тонкую броню и открытые рубки. Если пробил — взрыв внутри почти всегда фатален.",
    },
};

/**
 * Снаряды по калибрам. pen: [мм на 10 м, мм на 1000 м] при 0° от нормали.
 * vel — реальная начальная скорость, м/с. filler — масса ВВ в тротиловом эквиваленте, г.
 */
export const SHELLS = {
    // 20 мм KwK 30
    pzgr20: { name: "PzGr", type: "AP", cal: 20, pen: [36, 18], vel: 780 },
    pzgr40_20: { name: "PzGr 40", type: "APCR", cal: 20, pen: [52, 12], vel: 1050 },
    sprgr20: { name: "Sprgr", type: "HE", cal: 20, pen: [4, 4], vel: 900, filler: 6 },

    // 45 мм 20-К
    br240: { name: "БР-240", type: "APHE", cal: 45, pen: [60, 38], vel: 757, filler: 16 },
    br240p: { name: "БР-240П", type: "APCR", cal: 45, pen: [88, 34], vel: 985 },
    o240: { name: "О-240", type: "HE", cal: 45, pen: [5, 5], vel: 343, filler: 118 },

    // 50 мм KwK 38
    pzgr39_50: { name: "PzGr 39", type: "APHE", cal: 50, pen: [72, 50], vel: 685, filler: 17 },
    pzgr40_50: { name: "PzGr 40", type: "APCR", cal: 50, pen: [105, 32], vel: 1050 },
    sprgr38_50: { name: "Sprgr 38", type: "HE", cal: 50, pen: [6, 6], vel: 450, filler: 160 },

    // 76 мм Ф-34 / ЗиС-5 / ЗиС-3
    br350a: { name: "БР-350А", type: "APHE", cal: 76, pen: [84, 62], vel: 662, filler: 155 },
    br350p: { name: "БР-350П", type: "APCR", cal: 76, pen: [104, 44], vel: 965 },
    of350: { name: "ОФ-350", type: "HE", cal: 76, pen: [11, 11], vel: 680, filler: 621 },

    // 75 мм KwK 40 L/43
    pzgr39_75: { name: "PzGr 39", type: "APHE", cal: 75, pen: [110, 82], vel: 740, filler: 29 },
    pzgr40_75: { name: "PzGr 40", type: "APCR", cal: 75, pen: [140, 70], vel: 920 },
    hlgr38: { name: "Hl.Gr 38B", type: "HEAT", cal: 75, pen: [80, 80], vel: 450 },
    sprgr34: { name: "Sprgr 34", type: "HE", cal: 75, pen: [10, 10], vel: 550, filler: 686 },

    // 75 мм KwK 42 L/70
    pzgr39_42: { name: "PzGr 39/42", type: "APHE", cal: 75, pen: [185, 140], vel: 925, filler: 29 },
    pzgr40_42: { name: "PzGr 40/42", type: "APCR", cal: 75, pen: [226, 118], vel: 1120 },
    sprgr42: { name: "Sprgr 42", type: "HE", cal: 75, pen: [10, 10], vel: 700, filler: 725 },

    // 85 мм ЗиС-С-53 / Д-5Т
    br365: { name: "БР-365", type: "APHE", cal: 85, pen: [136, 100], vel: 792, filler: 164 },
    br365p: { name: "БР-365П", type: "APCR", cal: 85, pen: [192, 88], vel: 1050 },
    o365: { name: "О-365", type: "HE", cal: 85, pen: [13, 13], vel: 793, filler: 741 },

    // 88 мм KwK 36
    pzgr39_88: { name: "PzGr 39", type: "APHE", cal: 88, pen: [165, 124], vel: 773, filler: 59 },
    pzgr40_88: { name: "PzGr 40", type: "APCR", cal: 88, pen: [211, 108], vel: 930 },
    hlgr39: { name: "Hl.Gr 39", type: "HEAT", cal: 88, pen: [110, 110], vel: 600 },
    sprgr88: { name: "Sprgr", type: "HE", cal: 88, pen: [14, 14], vel: 820, filler: 900 },

    // 88 мм KwK 43 / PaK 43
    pzgr39_43: { name: "PzGr 39/43", type: "APHE", cal: 88, pen: [232, 180], vel: 1000, filler: 59 },
    pzgr40_43: { name: "PzGr 40/43", type: "APCR", cal: 88, pen: [275, 158], vel: 1130 },
    sprgr43: { name: "Sprgr 43", type: "HE", cal: 88, pen: [14, 14], vel: 750, filler: 1000 },

    // 100 мм Д-10С
    br412: { name: "БР-412", type: "APHE", cal: 100, pen: [196, 150], vel: 895, filler: 65 },
    br412b: { name: "БР-412Б", type: "APHE", cal: 100, pen: [212, 168], vel: 895, filler: 65 },
    of412: { name: "ОФ-412", type: "HE", cal: 100, pen: [16, 16], vel: 900, filler: 1460 },

    // 122 мм Д-25Т
    br471: { name: "БР-471", type: "APHE", cal: 122, pen: [205, 165], vel: 800, filler: 156 },
    br471b: { name: "БР-471Б", type: "APHE", cal: 122, pen: [225, 182], vel: 800, filler: 156 },
    of471: { name: "ОФ-471", type: "HE", cal: 122, pen: [27, 27], vel: 800, filler: 3600 },

    // гаубичная артиллерия поддержки
    arty122: { name: "М-30 · ОФ-462", type: "HE", cal: 122, pen: [24, 24], vel: 515, filler: 3000 },
    arty105: { name: "leFH 18 · Sprgr", type: "HE", cal: 105, pen: [20, 20], vel: 470, filler: 2200 },

    // 152 мм МЛ-20С
    br540: { name: "БР-540", type: "APHE", cal: 152, pen: [135, 112], vel: 600, filler: 480 },
    of540: { name: "ОФ-540", type: "HE", cal: 152, pen: [46, 46], vel: 655, filler: 5860 },
};

for (const id in SHELLS) SHELLS[id].id = id;

export function shellType(s) { return SHELL_TYPES[s.type]; }

/** Скорость снаряда в игре, м/с */
export function shellSpeed(s) { return s.vel * Config.SHELL_SPEED_SCALE; }

/** Пробитие на игровой дистанции d, мм (при 0°) */
export function penAt(s, d) {
    if (s.type === "HEAT" || s.type === "HE") return s.pen[0];
    const k = clamp((d * Config.PEN_RANGE_SCALE - 10) / 990, 0, 1.5);
    return Math.max(1, lerp(s.pen[0], s.pen[1], k));
}

/** Базовый урон «тела» снаряда при прохождении через модуль */
export function bodyDamage(s) { return (60 + s.cal * 1.35) * (SHELL_TYPES[s.type].bodyMul || 0); }

/** Параметры осколков после пробития */
export function fragParams(s, armor) {
    const T = SHELL_TYPES[s.type];
    const n = Math.round((5 + s.cal / 7 + Math.min(armor, 120) / 22) * T.fragMul);
    const dmg = 18 + s.cal * 0.28;
    const len = 2.2 + s.cal / 60;
    return { n, dmg, len, cone: T.cone * Math.PI / 180 };
}

/** Параметры взрыва (для каморных и ОФ) */
export function blastParams(s) {
    const g = s.filler || 0;
    const kg = g / 1000;
    if (s.type === "APHE") {
        return {
            n: Math.round(10 + g * 0.1),
            dmg: 28 + g * 0.12,
            radius: 0.45 + g * 0.004,
            blastDmg: 100 + g * 0.3,
            len: 2.3,
        };
    }
    // ОФ
    return {
        n: Math.round(14 + Math.pow(kg, 0.5) * 26),
        dmg: 40 + Math.pow(kg, 0.5) * 30,
        radius: 0.6 + Math.pow(kg, 0.45) * 1.1,
        blastDmg: 150 + kg * 70,
        len: 2.8,
        splash: 1.6 + Math.pow(kg, 0.4) * 2.4,   // радиус наружного фугасного действия, м
    };
}

/** Взводится ли каморный снаряд о броню данной толщины */
export function fuseArms(s, armorEff) {
    if (s.type !== "APHE") return false;
    const sens = s.cal >= 100 ? 18 : s.cal >= 70 ? 14 : 10;
    return armorEff >= sens;
}

export function fuseDelay(s) { return 0.9 + s.cal / 180; }
