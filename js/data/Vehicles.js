/**
 * База техники.
 *  dims: L — длина корпуса, W — полная ширина (с гусеницами), H — высота крыши корпуса,
 *        tw — ширина гусеницы, th — высота гусеницы (м)
 *  armor: [толщина мм, наклон ° от вертикали]. Наклон лба/кормы корпуса формирует геометрию;
 *         наклон бортов и стенок башни учитывается аналитически.
 *  turret: x — смещение центра башни вперёд от центра корпуса; hl/hw — полудлина/полуширина;
 *          h — высота; shape — форма в плане; casemate — неподвижная рубка (ПТ-САУ),
 *          arc — сектор горизонтальной наводки рубки, °; open — открытая рубка без крыши
 *  gun: disp — рассеивание (мрад), aim — время сведения (с), mag — снарядов в магазине,
 *       rof — интервал выстрелов внутри магазина (с)
 *  mob: speed / reverse — км/ч; pw — л.с./т; hull / turret — скорость поворота °/с
 *  engine: type diesel|petrol — влияет на звук и шанс пожара
 *  layout: rear — МТО в корме (советская схема); front — трансмиссия в носу (немецкая);
 *          openRear — двигатель спереди, боевое отделение в корме
 */
export const NATIONS = {
    ussr: { id: "ussr", name: "СССР", adj: "советская", flag: "★", color: "#c8402f" },
    germany: { id: "germany", name: "Германия", adj: "немецкая", flag: "✠", color: "#7f8a96" },
};

export const ROLES = {
    light: { name: "Лёгкий танк", short: "ЛТ", icon: "◇" },
    medium: { name: "Средний танк", short: "СТ", icon: "◆" },
    heavy: { name: "Тяжёлый танк", short: "ТТ", icon: "■" },
    td: { name: "ПТ-САУ", short: "ПТ", icon: "▼" },
};

export const ROLE_ORDER = ["light", "medium", "heavy", "td"];

export const VEHICLES = {
    // ─────────────────────────── СССР ───────────────────────────
    bt7: {
        name: "БТ-7", nation: "ussr", rank: 1, br: 1.7, role: "light",
        desc: "Колёсно-гусеничный быстроходный танк. Броня держит только пули и осколки, зато скорость позволяет заходить в борт и корму. Лучшее оружие — внезапность.",
        dims: { L: 5.4, W: 2.3, H: 1.42, tw: 0.36, th: 0.75 },
        armor: {
            hull: { front: [20, 18], lower: [20, 55], side: [13, 0], rear: [13, 25], roof: [10] },
            turret: { front: [15, 15], side: [15, 15], rear: [15, 15], roof: [10] },
        },
        turret: { x: 0.65, hl: 0.83, hw: 0.74, h: 0.58, shape: "round" },
        gun: { name: "20-К", cal: 45, len: 2.15, reload: 3.6, disp: 2.4, aim: 1.2 },
        shells: [["br240", 120], ["o240", 30], ["br240p", 12]],
        mob: { speed: 62, reverse: 12, pw: 34, hull: 52, turret: 44, mass: 14 },
        engine: { type: "petrol", cyl: 12, idle: 700, max: 2200, gears: 4 },
        crew: ["driver", "gunner", "loader"],
        titles: { gunner: "Командир-наводчик" },
        layout: "rear", paint: "4bo", details: { exhaust: 2 },
    },
    t34_41: {
        name: "Т-34 (1941)", nation: "ussr", rank: 1, br: 3.7, role: "medium",
        desc: "Легенда войны. Наклонный лист 45 мм под 60° держит малокалиберные снаряды, дизель редко горит, а каморный БР-350А разносит экипаж после пробития. Тесная двухместная башня — командир сам наводит орудие.",
        dims: { L: 5.92, W: 3.0, H: 1.6, tw: 0.5, th: 0.82 },
        armor: {
            hull: { front: [45, 60], lower: [45, 53], side: [40, 40], rear: [40, 47], roof: [16] },
            turret: { front: [52, 20], side: [45, 30], rear: [40, 30], roof: [16] },
        },
        turret: { x: 0.85, hl: 0.95, hw: 0.82, h: 0.68, shape: "hex" },
        gun: { name: "Ф-34", cal: 76, len: 3.15, reload: 6.4, disp: 2.2, aim: 1.6 },
        shells: [["br350a", 45], ["of350", 24], ["br350p", 8]],
        mob: { speed: 54, reverse: 8, pw: 17.8, hull: 40, turret: 36, mass: 28 },
        engine: { type: "diesel", cyl: 12, idle: 600, max: 2000, gears: 4 },
        crew: ["driver", "radio", "gunner", "loader"],
        titles: { gunner: "Командир-наводчик" },
        layout: "rear", paint: "4bo", details: { exhaust: 2, drums: true },
    },
    kv1: {
        name: "КВ-1 (ЗиС-5)", nation: "ussr", rank: 1, br: 4.7, role: "heavy",
        desc: "Тяжёлый прорыв 1941 года: 75 мм корпуса и 95 мм башни неуязвимы для большинства немецких пушек ранних рангов. Медленный — береги борта и не подставляй корму.",
        dims: { L: 6.75, W: 3.32, H: 1.75, tw: 0.62, th: 0.9 },
        armor: {
            hull: { front: [75, 25], lower: [75, 30], side: [75, 0], rear: [60, 10], roof: [30] },
            turret: { front: [95, 12], side: [75, 15], rear: [75, 15], roof: [30] },
        },
        turret: { x: 0.45, hl: 1.06, hw: 0.93, h: 0.83, shape: "box" },
        gun: { name: "ЗиС-5", cal: 76, len: 3.3, reload: 6.6, disp: 2.2, aim: 1.8 },
        shells: [["br350a", 70], ["of350", 30], ["br350p", 10]],
        mob: { speed: 35, reverse: 6, pw: 12, hull: 30, turret: 24, mass: 45 },
        engine: { type: "diesel", cyl: 12, idle: 550, max: 1900, gears: 5 },
        crew: ["driver", "radio", "gunner", "loader", "commander"],
        layout: "rear", paint: "4bo", details: { exhaust: 2 },
    },
    su76m: {
        name: "СУ-76М", nation: "ussr", rank: 1, br: 3.0, role: "td",
        desc: "Лёгкая самоходка с открытой рубкой. Отличная пушка ЗиС-3 и малый силуэт, но броня символическая, а сверху экипаж не защищён — любой фугас рядом опасен.",
        dims: { L: 5.0, W: 2.72, H: 1.36, tw: 0.42, th: 0.72 },
        armor: {
            hull: { front: [25, 30], lower: [15, 45], side: [15, 0], rear: [15, 10], roof: [7] },
            turret: { front: [25, 28], side: [10, 22], rear: [10, 0], roof: [0] },
        },
        turret: { x: -0.95, hl: 1, hw: 0.95, h: 0.77, shape: "casemate", casemate: true, open: true, arc: 15 },
        gun: { name: "ЗиС-3", cal: 76, len: 3.25, reload: 5.4, disp: 2.0, aim: 1.4 },
        shells: [["br350a", 40], ["of350", 20], ["br350p", 8]],
        mob: { speed: 45, reverse: 7, pw: 16.5, hull: 42, turret: 22, mass: 10.5 },
        engine: { type: "petrol", cyl: 6, idle: 650, max: 3400, gears: 4 },
        crew: ["driver", "gunner", "loader", "commander"],
        layout: "openRear", paint: "4bo", details: { exhaust: 1 },
    },
    t34_85: {
        name: "Т-34-85", nation: "ussr", rank: 2, br: 5.7, role: "medium",
        desc: "Т-34 с просторной трёхместной башней и 85-мм пушкой. Пробивает Тигр в борт с любой дистанции, но корпус уже уязвим для длинноствольных 75 и 88 мм.",
        dims: { L: 6.1, W: 3.0, H: 1.6, tw: 0.5, th: 0.82 },
        armor: {
            hull: { front: [45, 60], lower: [45, 53], side: [45, 40], rear: [45, 47], roof: [20] },
            turret: { front: [90, 15], side: [75, 20], rear: [52, 10], roof: [20] },
        },
        turret: { x: 0.75, hl: 1.19, hw: 0.96, h: 0.75, shape: "cast" },
        gun: { name: "ЗиС-С-53", cal: 85, len: 4.1, reload: 6.8, disp: 1.9, aim: 1.7 },
        shells: [["br365", 40], ["o365", 20], ["br365p", 8]],
        mob: { speed: 56, reverse: 8, pw: 15.6, hull: 38, turret: 32, mass: 32 },
        engine: { type: "diesel", cyl: 12, idle: 600, max: 2000, gears: 5 },
        crew: ["driver", "radio", "gunner", "loader", "commander"],
        layout: "rear", paint: "4bo", details: { exhaust: 2, drums: true, cupola: true, bustle: true },
    },
    is1: {
        name: "ИС-1", nation: "ussr", rank: 2, br: 6.0, role: "heavy",
        desc: "Первый «Иосиф Сталин»: толстая литая броня 100–120 мм и 85-мм орудие. Не боится лобовых попаданий 75-мм пушек, но корма и борта уязвимы.",
        dims: { L: 6.77, W: 3.07, H: 1.62, tw: 0.62, th: 0.9 },
        armor: {
            hull: { front: [120, 30], lower: [100, 30], side: [90, 0], rear: [60, 40], roof: [30] },
            turret: { front: [100, 15], side: [100, 15], rear: [100, 15], roof: [30] },
        },
        turret: { x: 0.55, hl: 1.17, hw: 0.99, h: 0.83, shape: "cast" },
        gun: { name: "Д-5Т", cal: 85, len: 4.0, reload: 7.4, disp: 1.9, aim: 1.9 },
        shells: [["br365", 40], ["o365", 15], ["br365p", 8]],
        mob: { speed: 37, reverse: 7, pw: 11.4, hull: 30, turret: 26, mass: 44 },
        engine: { type: "diesel", cyl: 12, idle: 550, max: 2000, gears: 4 },
        crew: ["driver", "gunner", "loader", "commander"],
        layout: "rear", paint: "4bo", details: { exhaust: 2, cupola: true, bustle: true },
    },
    su100: {
        name: "СУ-100", nation: "ussr", rank: 2, br: 6.0, role: "td",
        desc: "Истребитель танков на базе Т-34: мощная 100-мм пушка Д-10С и наклонная рубка 75 мм. Ограниченный сектор наводки — доворачивай корпус.",
        dims: { L: 6.1, W: 3.0, H: 1.55, tw: 0.5, th: 0.82 },
        armor: {
            hull: { front: [75, 50], lower: [45, 53], side: [45, 20], rear: [45, 47], roof: [20] },
            turret: { front: [75, 50], side: [45, 20], rear: [45, 0], roof: [20] },
        },
        turret: { x: 0.95, hl: 1.44, hw: 1.24, h: 0.65, shape: "casemate", casemate: true, arc: 8 },
        gun: { name: "Д-10С", cal: 100, len: 5.0, reload: 8.6, disp: 1.7, aim: 1.9 },
        shells: [["br412", 22], ["of412", 10], ["br412b", 8]],
        mob: { speed: 50, reverse: 7, pw: 16.1, hull: 36, turret: 18, mass: 31.6 },
        engine: { type: "diesel", cyl: 12, idle: 600, max: 2000, gears: 5 },
        crew: ["driver", "gunner", "loader", "commander"],
        layout: "rear", paint: "4bo", details: { exhaust: 2, cupola: true },
    },
    is2: {
        name: "ИС-2 (1944)", nation: "ussr", rank: 3, br: 6.7, role: "heavy",
        desc: "122-мм Д-25Т уничтожает почти любую цель одним пробитием — ОФ-471 снимает башни даже без пробития. Долгая перезарядка и малый боекомплект требуют точности.",
        dims: { L: 6.77, W: 3.07, H: 1.62, tw: 0.62, th: 0.9 },
        armor: {
            hull: { front: [110, 60], lower: [100, 30], side: [90, 15], rear: [60, 45], roof: [30] },
            turret: { front: [110, 22], side: [90, 20], rear: [90, 30], roof: [30] },
        },
        turret: { x: 0.5, hl: 1.24, hw: 1.03, h: 0.86, shape: "cast" },
        gun: { name: "Д-25Т", cal: 122, len: 5.4, reload: 15.5, disp: 1.6, aim: 2.1, brake: true },
        shells: [["br471", 18], ["of471", 8], ["br471b", 6]],
        mob: { speed: 37, reverse: 7, pw: 11.3, hull: 30, turret: 22, mass: 46 },
        engine: { type: "diesel", cyl: 12, idle: 550, max: 2000, gears: 4 },
        crew: ["driver", "gunner", "loader", "commander"],
        layout: "rear", paint: "4bo", details: { exhaust: 2, cupola: true, bustle: true },
    },
    t44: {
        name: "Т-44", nation: "ussr", rank: 3, br: 6.7, role: "medium",
        desc: "Наследник Т-34 с поперечным двигателем: низкий корпус, лоб 90 мм под 60° и башня 120 мм. Скорость и броня в одном танке.",
        dims: { L: 6.07, W: 3.18, H: 1.45, tw: 0.5, th: 0.8 },
        armor: {
            hull: { front: [90, 60], lower: [90, 45], side: [75, 0], rear: [30, 45], roof: [20] },
            turret: { front: [120, 15], side: [90, 20], rear: [75, 15], roof: [20] },
        },
        turret: { x: 0.3, hl: 1.22, hw: 1.03, h: 0.77, shape: "cast" },
        gun: { name: "ЗиС-С-53", cal: 85, len: 4.1, reload: 6.4, disp: 1.8, aim: 1.6 },
        shells: [["br365", 40], ["o365", 18], ["br365p", 10]],
        mob: { speed: 51, reverse: 8, pw: 16.8, hull: 40, turret: 32, mass: 31.8 },
        engine: { type: "diesel", cyl: 12, idle: 600, max: 2000, gears: 5 },
        crew: ["driver", "gunner", "loader", "commander"],
        layout: "rear", paint: "4bo", details: { exhaust: 2, cupola: true },
    },
    isu152: {
        name: "ИСУ-152", nation: "ussr", rank: 3, br: 6.3, role: "td",
        desc: "«Зверобой»: 152-мм гаубица-пушка МЛ-20С. Фугас ОФ-540 срывает гусеницы, ломает стволы и убивает экипаж через крышу. Перезарядка долгая — каждый выстрел на вес золота.",
        dims: { L: 6.8, W: 3.07, H: 1.6, tw: 0.62, th: 0.9 },
        armor: {
            hull: { front: [90, 30], lower: [100, 30], side: [90, 0], rear: [60, 40], roof: [20] },
            turret: { front: [90, 30], side: [75, 15], rear: [60, 0], roof: [20] },
        },
        turret: { x: 0.95, hl: 1.77, hw: 1.3, h: 0.79, shape: "casemate", casemate: true, arc: 10 },
        gun: { name: "МЛ-20С", cal: 152, len: 3.6, reload: 17, disp: 2.1, aim: 2.2, brake: true },
        shells: [["of540", 12], ["br540", 10]],
        mob: { speed: 37, reverse: 7, pw: 11.3, hull: 28, turret: 16, mass: 46 },
        engine: { type: "diesel", cyl: 12, idle: 550, max: 2000, gears: 4 },
        crew: ["driver", "gunner", "loader", "loader2", "commander"],
        titles: { loader2: "Замковый" },
        layout: "rear", paint: "4bo", details: { exhaust: 2, cupola: true },
    },

    // ───────────────────────── Германия ─────────────────────────
    pz2f: {
        name: "Pz.Kpfw. II Ausf. F", nation: "germany", rank: 1, br: 1.3, role: "light",
        desc: "Лёгкий танк с 20-мм автоматической пушкой: очередь из магазина на 10 выстрелов разбирает лёгкую технику и открытые рубки. Против Т-34 в лоб бесполезен.",
        dims: { L: 4.8, W: 2.28, H: 1.38, tw: 0.3, th: 0.7 },
        armor: {
            hull: { front: [35, 12], lower: [35, 45], side: [20, 0], rear: [15, 10], roof: [10] },
            turret: { front: [30, 10], side: [15, 22], rear: [15, 15], roof: [10] },
        },
        turret: { x: 0.25, hl: 0.72, hw: 0.64, h: 0.58, shape: "box" },
        gun: { name: "KwK 30", cal: 20, len: 1.35, reload: 4.6, disp: 3.4, aim: 1.0, mag: 10, rof: 0.22 },
        shells: [["pzgr20", 120], ["sprgr20", 60], ["pzgr40_20", 30]],
        mob: { speed: 40, reverse: 10, pw: 14.7, hull: 46, turret: 40, mass: 9.5 },
        engine: { type: "petrol", cyl: 6, idle: 800, max: 2600, gears: 6 },
        crew: ["driver", "gunner", "commander"],
        titles: { gunner: "Наводчик-заряжающий" },
        layout: "front", paint: "grey", details: { exhaust: 1 },
    },
    pz3j: {
        name: "Pz.Kpfw. III Ausf. J", nation: "germany", rank: 1, br: 3.0, role: "medium",
        desc: "Рабочая лошадка вермахта: лоб 50 мм, удобная трёхместная башня и быстрая перезарядка 50-мм пушки. Подкалиберный PzGr 40 пробивает Т-34 вблизи.",
        dims: { L: 5.52, W: 2.95, H: 1.62, tw: 0.4, th: 0.78 },
        armor: {
            hull: { front: [50, 20], lower: [50, 50], side: [30, 0], rear: [50, 10], roof: [16] },
            turret: { front: [57, 15], side: [30, 25], rear: [30, 15], roof: [10] },
        },
        turret: { x: 0.1, hl: 0.95, hw: 0.82, h: 0.7, shape: "box" },
        gun: { name: "KwK 38 L/42", cal: 50, len: 2.4, reload: 3.9, disp: 2.0, aim: 1.3 },
        shells: [["pzgr39_50", 50], ["sprgr38_50", 30], ["pzgr40_50", 12]],
        mob: { speed: 40, reverse: 20, pw: 13.2, hull: 38, turret: 34, mass: 21.5 },
        engine: { type: "petrol", cyl: 12, idle: 800, max: 3000, gears: 6 },
        crew: ["driver", "radio", "gunner", "loader", "commander"],
        layout: "front", paint: "grey", details: { exhaust: 2, cupola: true },
    },
    pz4f2: {
        name: "Pz.Kpfw. IV Ausf. F2", nation: "germany", rank: 1, br: 3.7, role: "medium",
        desc: "Первая «длинная» четвёрка: 75-мм KwK 40 L/43 пробивает Т-34 в лоб. Броня тонкая — играй от позиции и стреляй первым. Есть кумулятивный Hl.Gr 38B.",
        dims: { L: 5.9, W: 2.88, H: 1.62, tw: 0.4, th: 0.78 },
        armor: {
            hull: { front: [50, 12], lower: [50, 45], side: [30, 0], rear: [20, 10], roof: [12] },
            turret: { front: [50, 10], side: [30, 25], rear: [30, 15], roof: [10] },
        },
        turret: { x: 0.12, hl: 1.03, hw: 0.82, h: 0.73, shape: "box" },
        gun: { name: "KwK 40 L/43", cal: 75, len: 3.3, reload: 6.0, disp: 1.9, aim: 1.5, brake: true },
        shells: [["pzgr39_75", 50], ["sprgr34", 25], ["pzgr40_75", 8], ["hlgr38", 8]],
        mob: { speed: 40, reverse: 10, pw: 12.5, hull: 36, turret: 26, mass: 23.6 },
        engine: { type: "petrol", cyl: 12, idle: 800, max: 3000, gears: 6 },
        crew: ["driver", "radio", "gunner", "loader", "commander"],
        layout: "front", paint: "grey", details: { exhaust: 1, cupola: true, bustle: true },
    },
    stug3f: {
        name: "StuG III Ausf. F", nation: "germany", rank: 1, br: 3.7, role: "td",
        desc: "Низкая штурмовая самоходка: рубка 80 мм в лоб и та же KwK 40 L/43. Малый силуэт и хорошая задняя скорость — идеальна для засад из кустов.",
        dims: { L: 5.52, W: 2.95, H: 1.2, tw: 0.4, th: 0.78 },
        armor: {
            hull: { front: [80, 20], lower: [50, 52], side: [30, 0], rear: [50, 10], roof: [16] },
            turret: { front: [80, 10], side: [30, 10], rear: [30, 10], roof: [12] },
        },
        turret: { x: 0.35, hl: 1.49, hw: 1.01, h: 0.7, shape: "casemate", casemate: true, arc: 10 },
        gun: { name: "StuK 40 L/43", cal: 75, len: 3.3, reload: 6.0, disp: 1.8, aim: 1.4, brake: true },
        shells: [["pzgr39_75", 40], ["sprgr34", 20], ["pzgr40_75", 8], ["hlgr38", 8]],
        mob: { speed: 40, reverse: 20, pw: 13.1, hull: 36, turret: 18, mass: 22.6 },
        engine: { type: "petrol", cyl: 12, idle: 800, max: 3000, gears: 6 },
        crew: ["driver", "gunner", "loader", "commander"],
        layout: "front", paint: "grey", details: { exhaust: 2, cupola: true },
    },
    panther_d: {
        name: "Panther Ausf. D", nation: "germany", rank: 2, br: 6.0, role: "medium",
        desc: "Лоб 80 мм под 55° держит почти всё на своём ранге, а KwK 42 L/70 пробивает любого соперника. Слабые места — борта, нижний лист и очень медленный задний ход.",
        dims: { L: 6.88, W: 3.27, H: 1.82, tw: 0.66, th: 0.95 },
        armor: {
            hull: { front: [80, 55], lower: [60, 55], side: [40, 40], rear: [40, 30], roof: [16] },
            turret: { front: [100, 12], side: [45, 25], rear: [45, 25], roof: [16] },
        },
        turret: { x: 0.3, hl: 1.28, hw: 0.99, h: 0.89, shape: "panther" },
        gun: { name: "KwK 42 L/70", cal: 75, len: 5.25, reload: 7.0, disp: 1.5, aim: 1.7, brake: true },
        shells: [["pzgr39_42", 50], ["sprgr42", 20], ["pzgr40_42", 9]],
        mob: { speed: 55, reverse: 6, pw: 15.6, hull: 32, turret: 26, mass: 44.8 },
        engine: { type: "petrol", cyl: 12, idle: 700, max: 3000, gears: 7 },
        crew: ["driver", "radio", "gunner", "loader", "commander"],
        layout: "front", paint: "yellow", details: { exhaust: 2, cupola: true, skirts: 5 },
    },
    tiger_h1: {
        name: "Tiger H1", nation: "germany", rank: 2, br: 5.7, role: "heavy",
        desc: "Вертикальная 100-мм броня и точнейшая 88-мм KwK 36. Ставь корпус ромбом — угол 25–35° превращает 100 мм в 120+. Медленная башня — главный враг.",
        dims: { L: 6.32, W: 3.56, H: 1.8, tw: 0.72, th: 0.95 },
        armor: {
            hull: { front: [100, 10], lower: [60, 25], side: [80, 0], rear: [80, 8], roof: [26] },
            turret: { front: [110, 5], side: [80, 0], rear: [80, 0], roof: [26] },
        },
        turret: { x: 0.0, hl: 1.3, hw: 1.19, h: 0.89, shape: "tiger" },
        gun: { name: "KwK 36", cal: 88, len: 5.0, reload: 8.0, disp: 1.5, aim: 1.8, brake: true },
        shells: [["pzgr39_88", 50], ["sprgr88", 22], ["pzgr40_88", 8], ["hlgr39", 10]],
        mob: { speed: 45, reverse: 10, pw: 11.9, hull: 28, turret: 20, mass: 57 },
        engine: { type: "petrol", cyl: 12, idle: 700, max: 3000, gears: 8 },
        crew: ["driver", "radio", "gunner", "loader", "commander"],
        layout: "front", paint: "yellow", details: { exhaust: 2, cupola: true, bustle: true },
    },
    nashorn: {
        name: "Nashorn", nation: "germany", rank: 2, br: 5.3, role: "td",
        desc: "«Носорог» с 88-мм PaK 43/1 пробивает любой танк на любой дистанции. Броня 10–30 мм и открытая рубка: обнаружили — умер. Стреляй из укрытия и меняй позицию.",
        dims: { L: 5.95, W: 2.95, H: 1.45, tw: 0.4, th: 0.78 },
        armor: {
            hull: { front: [30, 30], lower: [30, 45], side: [20, 0], rear: [20, 10], roof: [10] },
            turret: { front: [10, 30], side: [10, 15], rear: [10, 10], roof: [0] },
        },
        turret: { x: -0.85, hl: 1.44, hw: 1.17, h: 0.9, shape: "casemate", casemate: true, open: true, arc: 15 },
        gun: { name: "PaK 43/1", cal: 88, len: 6.3, reload: 7.6, disp: 1.3, aim: 1.6, brake: true },
        shells: [["pzgr39_43", 30], ["sprgr43", 10], ["pzgr40_43", 6]],
        mob: { speed: 40, reverse: 8, pw: 11.5, hull: 30, turret: 20, mass: 24 },
        engine: { type: "petrol", cyl: 12, idle: 800, max: 3000, gears: 6 },
        crew: ["driver", "gunner", "loader", "commander"],
        layout: "openRear", paint: "yellow", details: { exhaust: 1 },
    },
    tiger2: {
        name: "Tiger II (H)", nation: "germany", rank: 3, br: 6.7, role: "heavy",
        desc: "Королевский Тигр: 150 мм под 50° в лоб корпуса и 180 мм башни. Почти неуязвим спереди, но тяжёл, медлителен и боеукладка в нише башни детонирует от попадания в борт башни.",
        dims: { L: 7.38, W: 3.75, H: 1.9, tw: 0.8, th: 1.0 },
        armor: {
            hull: { front: [150, 50], lower: [100, 50], side: [80, 25], rear: [80, 30], roof: [40] },
            turret: { front: [180, 9], side: [80, 21], rear: [80, 21], roof: [40] },
        },
        turret: { x: 0.2, hl: 1.57, hw: 1.12, h: 0.92, shape: "kingtiger" },
        gun: { name: "KwK 43", cal: 88, len: 6.3, reload: 9.0, disp: 1.3, aim: 1.9, brake: true },
        shells: [["pzgr39_43", 50], ["sprgr43", 20], ["pzgr40_43", 8]],
        mob: { speed: 41, reverse: 10, pw: 10.1, hull: 26, turret: 20, mass: 68.5 },
        engine: { type: "petrol", cyl: 12, idle: 700, max: 3000, gears: 8 },
        crew: ["driver", "radio", "gunner", "loader", "commander"],
        layout: "front", paint: "yellow", details: { exhaust: 2, cupola: true, bustle: true },
    },
    jagdpanther: {
        name: "Jagdpanther", nation: "germany", rank: 3, br: 6.7, role: "td",
        desc: "Шасси Пантеры и 88-мм PaK 43/3 в наклонной рубке 80 мм под 55°. Быстрая, хорошо бронированная в лоб — подставлять борт нельзя.",
        dims: { L: 6.88, W: 3.42, H: 1.75, tw: 0.66, th: 0.95 },
        armor: {
            hull: { front: [80, 55], lower: [60, 55], side: [50, 30], rear: [40, 35], roof: [25] },
            turret: { front: [80, 55], side: [50, 30], rear: [40, 35], roof: [25] },
        },
        turret: { x: 0.85, hl: 1.86, hw: 1.35, h: 0.72, shape: "casemate", casemate: true, arc: 12 },
        gun: { name: "PaK 43/3", cal: 88, len: 6.3, reload: 7.8, disp: 1.3, aim: 1.7, brake: true },
        shells: [["pzgr39_43", 40], ["sprgr43", 12], ["pzgr40_43", 8]],
        mob: { speed: 55, reverse: 6, pw: 15.4, hull: 32, turret: 18, mass: 45.5 },
        engine: { type: "petrol", cyl: 12, idle: 700, max: 3000, gears: 7 },
        crew: ["driver", "radio", "gunner", "loader", "commander"],
        layout: "front", paint: "yellow", details: { exhaust: 2, cupola: false, skirts: 5 },
    },
    panther_g: {
        name: "Panther Ausf. G", nation: "germany", rank: 3, br: 6.3, role: "medium",
        desc: "Финальная серийная Пантера: усиленные борта 50 мм, «подбородок» маски, стабильная KwK 42. Быстрая и смертоносная — главное не подставлять нижний лист.",
        dims: { L: 6.88, W: 3.27, H: 1.82, tw: 0.66, th: 0.95 },
        armor: {
            hull: { front: [80, 55], lower: [60, 55], side: [50, 30], rear: [40, 30], roof: [16] },
            turret: { front: [110, 12], side: [45, 25], rear: [45, 25], roof: [16] },
        },
        turret: { x: 0.3, hl: 1.28, hw: 0.99, h: 0.89, shape: "panther" },
        gun: { name: "KwK 42 L/70", cal: 75, len: 5.25, reload: 6.6, disp: 1.4, aim: 1.6, brake: true },
        shells: [["pzgr39_42", 50], ["sprgr42", 20], ["pzgr40_42", 12]],
        mob: { speed: 55, reverse: 7, pw: 15.5, hull: 33, turret: 28, mass: 45.5 },
        engine: { type: "petrol", cyl: 12, idle: 700, max: 3000, gears: 7 },
        crew: ["driver", "radio", "gunner", "loader", "commander"],
        layout: "front", paint: "yellow", details: { exhaust: 2, cupola: true, skirts: 5 },
    },
};

export const CREW_SEATS = {
    driver: { name: "Механик-водитель", short: "МЕХ" },
    radio: { name: "Радист-пулемётчик", short: "РАД" },
    gunner: { name: "Наводчик", short: "НАВ" },
    loader: { name: "Заряжающий", short: "ЗАР" },
    loader2: { name: "Заряжающий", short: "ЗР2" },
    commander: { name: "Командир", short: "КМД" },
};

export const MODULE_NAMES = {
    engine: "Двигатель", transmission: "Трансмиссия", fuel: "Топливный бак", ammo: "Боеукладка",
    breech: "Казённик", barrel: "Ствол", drive: "Пов. механизм", track: "Гусеница",
};

export const MODULE_SHORT = {
    engine: "ДВИГ", transmission: "ТРАНСМ", fuel: "ТОПЛ", ammo: "БК",
    breech: "КАЗЁН", barrel: "СТВОЛ", drive: "ПОВОР", track: "ГУС",
};
