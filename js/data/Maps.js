/** Биомы: палитра, освещение, атмосфера */
export const BIOMES = {
    summer: {
        name: "Лето",
        ground: ["#5a6d36", "#52653a", "#61733a", "#4d5f31", "#677a3f"],
        dirt: "#7b6a4a", road: "rgba(122,104,72,.85)", field: ["#8e8a46", "#a39a52", "#6e5a3c", "#7d8c43"],
        sky: 0xa9bccb, fog: 0xa9bccb, sun: 0xfff0d2, sunI: 2.5, hemiSky: 0xd8e6ff, hemiGround: 0x4b5a2f, hemiI: 1.15,
        roof: [0x8a3f2c, 0x6b4a33, 0x7a5a3a, 0x94523a, 0x5d5148], wall: [0xc9bea4, 0xb7a98a, 0xd8cfb7, 0x9d8b6e],
        tree: [0x3c5a2a, 0x46662f, 0x355024, 0x4f6f33], trunk: 0x4a3a28, bush: [0x46622c, 0x527136, 0x3e5826],
        rock: [0x7d7a6c, 0x8a8778, 0x6c695d], dust: [0.52, 0.47, 0.36], hay: 0xc7a85a, fence: 0x6b553a,
        treeKind: "leaf",
    },
    winter: {
        name: "Зима",
        ground: ["#cdd4db", "#c4ccd4", "#d6dce2", "#bec7cf", "#d1d8de"],
        dirt: "#9aa0a2", road: "rgba(120,118,112,.75)", field: ["#e9edf1", "#d6dde4", "#c9d0d6", "#dde3e8"],
        sky: 0xb4c0cc, fog: 0xb9c4cf, sun: 0xf3f6ff, sunI: 1.55, hemiSky: 0xdfe8f5, hemiGround: 0x8a949d, hemiI: 0.95,
        roof: [0xe9eef2, 0xdfe6ec, 0xf1f4f7], wall: [0x9b8f80, 0x8a7f72, 0xa8a196, 0x7f776e, 0xb2a48e],
        tree: [0x2e4433, 0x34503a, 0x29402e], trunk: 0x3d3128, bush: [0x5d6d5e, 0x6b7a6a, 0x4f5f52],
        rock: [0x8d9298, 0x7f858b, 0x9da2a7], dust: [0.92, 0.94, 0.97], hay: 0xb9ab86, fence: 0x5b4a3a,
        treeKind: "pine",
    },
    desert: {
        name: "Пустыня",
        ground: ["#c8aa74", "#bf9f69", "#d0b27c", "#b8985f", "#cdb07a"],
        dirt: "#a88a5a", road: "rgba(150,124,86,.8)", field: ["#b8a06a", "#a99062", "#c4ad78", "#9c8a5e"],
        sky: 0xd9c9a8, fog: 0xd6c4a0, sun: 0xfff2d6, sunI: 2.9, hemiSky: 0xfff3dc, hemiGround: 0x9a7f52, hemiI: 1.1,
        roof: [0xc9b48c, 0xbfa77e, 0xd2bf98], wall: [0xd8c39a, 0xcab48a, 0xe0cfaa, 0xbfa77a],
        tree: [0x55673a, 0x61703f, 0x4b5c33], trunk: 0x6a553a, bush: [0x8a8450, 0x7a7444, 0x9a9258],
        rock: [0xa88f6a, 0x9b8460, 0xb69d76, 0x8c7656], dust: [0.82, 0.7, 0.5], hay: 0xc7a85a, fence: 0x7b6545,
        treeKind: "palm",
    },
};

/**
 * Погода: множители освещения, туман и дальность обнаружения.
 * precip — осадки/взвесь частицами вокруг камеры
 */
export const WEATHER = {
    clear: { name: "Ясно", sunK: 1, hemiK: 1, fog: [280, 1000], spotK: 1 },
    overcast: { name: "Пасмурно", sunK: 0.42, hemiK: 1.2, fog: [90, 700], spotK: 0.9, tint: 0x9aa4ad },
    fog: { name: "Туман", sunK: 0.35, hemiK: 1.05, fog: [-45, 220], spotK: 0.55, tint: 0xc9cfd2, precip: "mist" },
    snow: { name: "Снегопад", sunK: 0.4, hemiK: 1.15, fog: [-15, 320], spotK: 0.7, tint: 0xd4dbe2, precip: "snow" },
    dust: { name: "Пыльная буря", sunK: 0.55, hemiK: 1.0, fog: [-35, 240], spotK: 0.6, tint: 0xc9a979, precip: "dust" },
};

export const BIOME_WEATHER = {
    summer: ["clear", "clear", "overcast", "fog"],
    winter: ["clear", "overcast", "snow", "snow"],
    desert: ["clear", "clear", "overcast", "dust"],
};

export const MAPS = {
    prokhorovka: {
        name: "Поля Прохоровки", biome: "summer", gen: "village", size: 520,
        desc: "Открытые поля, лесополосы и деревня в центре. Дальние дуэли на флангах и ближний бой в селе.",
    },
    winter_town: {
        name: "Зимний городок", biome: "winter", gen: "town", size: 480,
        desc: "Каменные кварталы и руины. Ближние дистанции, засады за углами, важна броня и скорость башни.",
    },
    bocage: {
        name: "Нормандские изгороди", biome: "summer", gen: "bocage", size: 500,
        desc: "Лоскутные поля в стенах живых изгородей. Изгороди скрывают технику и замедляют её, их можно проломить корпусом или крупным фугасом. Бой на коротких дистанциях и засады у проходов.",
    },
    desert_pass: {
        name: "Каменный перевал", biome: "desert", gen: "desert", size: 540,
        desc: "Скальные гряды и глинобитные посёлки. Позиционная игра от укрытий и длинные простреливаемые коридоры.",
    },
};

export const MAP_ORDER = ["prokhorovka", "bocage", "winter_town", "desert_pass"];

export const MODES = {
    domination: {
        name: "Превосходство",
        short: "Командный бой 6×6 за три точки",
        desc: "Две команды по шесть машин. Захватывайте точки A, B и C: команда, удерживающая больше точек, отнимает очки у соперника. Каждое уничтожение тоже стоит очков. Возрождение на технике из вашего сетапа за очки возрождения.",
    },
    waves: {
        name: "Оборона рубежа",
        short: "Удержание высоты против волн противника",
        desc: "Удерживайте точку в центре карты. Волны противника становятся крупнее и сильнее — от лёгких танков к тяжёлым. Если враг захватит точку или у вас кончится техника — бой проигран. Между волнами — ремонт и пополнение.",
    },
    range: {
        name: "Полигон",
        short: "Обстрел неподвижных целей",
        desc: "Испытайте любую машину и любой снаряд на неподвижных мишенях, расставленных под разными углами. Рентген показывает каждое попадание. Цели восстанавливаются автоматически.",
    },
};
