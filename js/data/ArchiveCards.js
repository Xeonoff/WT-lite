/** Правила карточек. Текст собирается из тех же параметров, которые читает симуляция. */
export const STATS = {
    turn: "скорость поворота корпуса", accel: "разгон", reverse: "скорость заднего хода",
    speed: "скорость вперёд", traverse: "горизонтальная наводка", elevate: "вертикальная наводка",
    reload: "время заряжания", repair: "длительность ремонта", arty: "перерыв между артударами",
    spot: "дальность обнаружения", swap: "длительность пересадки", memory:"время отметки контакта",
    radioRange:"радиус связи с артподдержкой", change:"время смены снаряда", brake:"торможение", grip:"гашение бокового скольжения", service:"прочность носителя после ремонта",
    hill:"тяга на подъёме", pen:"игровое пробитие", inside:"урон после пробития", guard:"входящий урон носителю",
};
const CONDITIONS = {
    fresh: "при здоровье носителя выше 80%", worn: "при здоровье носителя ниже 60%",
    rich: "пока осталось больше половины штатного боекомплекта", lean: "когда осталась половина штатного боекомплекта или меньше",
    hurt: "после потери хотя бы одного танкиста",
    burning: "во время пожара", still:"на стоянке", moving:"на ходу", backing:"на заднем ходу",
    slope:"на уклоне от 5°", seen:"пока машина видна противнику", turned:"при отвороте орудия от корпуса более 5°",
};
const GOOD_NEGATIVE = new Set(["reload","repair","arty","swap","change","guard"]);
const mod = (stat, gain) => ({stat, percent: GOOD_NEGATIVE.has(stat) ? -gain : gain});
function passive(id, condition, stat, gain, price, loss) {
    const mods = [mod(stat,gain)];
    if (price) mods.push(mod(price,-loss));
    const values = mods.map(m => STATS[m.stat] + " " + (m.percent > 0 ? "+" : "−") + Math.abs(m.percent) + "%");
    return {id, condition, mods, text: (condition ? CONDITIONS[condition] + " · " : "") + values.join(", ")};
}
const EVENTS = {
    shot: n => n === 1 ? "После каждого выстрела" : "После каждого " + n + "-го выстрела",
    lastRound: () => "Когда израсходован последний снаряд выбранного штатного типа,",
    travel: n => "За каждые " + n + " м пути",
    repair: () => "После завершения ручного ремонта",
    switchShot: n => n === 1 ? "При выстреле другим типом снаряда" : `После каждой ${n}-й смены типа между выстрелами`, swap: () => "После пересадки танкиста",
    ext: () => "При тушении огнетушителем", arty: () => "После вызова артподдержки",
    critical: () => "Один раз за выезд, когда у действующего носителя осталось не больше 25% здоровья,",
};
const ACTIONS = {
    charge: n => "сокращает оставшееся время заряжания на " + n + "%",
    signal: n => "снимает " + n + " с ожидания ближайшего артудара",
    mend: n => "восстанавливает носителю " + n + "% его максимального здоровья",
    crew: n => "лечит наиболее тяжело раненого живого танкиста на " + n + "% его максимального здоровья",
    rounds: n => "возвращает до " + n + " снарядов выбранного штатного типа в пределах начального запаса",
    convert: n => "обменивает до " + n + " других штатных снарядов на выбранный штатный тип в пределах начального запаса",
    rally: () => "возвращает в строй одного выбывшего танкиста при свободном месте",
    nest: n => "раскрывает вложенную кассету и возвращает до " + n + " таких снарядов. Стеллаж расходует 20% своей максимальной прочности, пока может выдержать расход",
    pendulum: () => "переключает ритм затвора. Нечётное заряжание длится втрое дольше обычного, чётное занимает десятую часть обычного времени",
    rewind: () => "возвращает водителю здоровье, которое у него было на последней контрольной отметке. Отметка обновляется каждые 5 с, пока водитель в строю и его здоровье выше 25%",
};
function pulse(id, name, event, every, action, amount, cost) {
    const text = EVENTS[event](every) + " " + ACTIONS[action](amount) +
        (cost ? ". Цена срабатывания — " + (cost === "kit" ? "одна аптечка" : "один огнетушитель") : "") + ".";
    return {id,name,event,every,action,amount,cost,text};
}

const measures = {
    travel:"м пути", back:"м заднего хода", fast:"м на скорости от 18 км/ч",
    turn:"° разворота корпуса", slew:"° поворота орудия", pitch:"° вертикальной наводки",
    climb:"м набора высоты", observe:"с наблюдения за противником", still:"с стоянки",
};
const counts = {
    discover:"новые контакты", start:"разгоны с остановки до 11 км/ч", reload:"заряжания после выстрела",
    hit:"попадания по противнику", pen:"пробития противника", blocked:"непробития или рикошеты",
    switchShot:"выстрелы со сменой типа снаряда", swap:"завершённые пересадки", shot:"выстрелы",
};
function threshold(event,every) {
    return measures[event] ? every + " " + measures[event] : counts[event] + " × " + every;
}
const RESET = { shot:"выстреле",pen:"пробитии",blocked:"непробитии или рикошете",repair:"завершении ремонта",stop:"остановке",forward:"движении вперёд",miss:"промахе",switchShot:"выстреле другим типом снаряда" };
function grow(name,event,every,stat,gain,cap,reset) {
    const m = mod(stat,gain);
    const text = `За выезд набирает до ${cap} уровней. Условие уровня — ${threshold(event,every)}. За уровень ${STATS[stat]} ${m.percent>0?"+":"−"}${Math.abs(m.percent)}%.` +
        (reset ? ` Все уровни сгорают при ${RESET[reset]}.` : "");
    return {name,mods:[m],stack:{event,every,cap,reset},text};
}
function reserve(name,event,every,cap,release,action,amount) {
    const text = `Накопите до ${cap} зарядов за выезд. Условие заряда — ${threshold(event,every)}. ${EVENTS[release](1)} расходует запас. Каждый заряд ${ACTIONS[action](amount)}.`;
    return {name,event:release,action,amount,stack:{event,every,cap,release},text};
}
const profiles = {
    driver: ["turn","accel","reverse","speed"],
    radio: ["memory","spot","arty","radioRange"],
    loader: ["reload","change","swap","guard"],
    commander: ["spot","swap","memory","repair"],
    gunner: ["elevate","traverse","spot","guard"],
    engine: ["accel","speed","reverse","hill"],
    transmission: ["reverse","turn","accel","brake"],
    drive: ["traverse","elevate","guard","service"],
    breech: ["reload","change","guard","service"],
    track: ["turn","grip","hill","brake"],
    ammo: ["pen","inside","reload","change"],
};
// Порядок в каждой строке соответствует четырём ветеранским и трём высшим картам.
const specialRules = {
    driver: [
        grow("Пятиться по памяти","back",22,"reverse",5,5),grow("Накат","fast",50,"accel",4,6,"stop"),
        grow("Школа серпантина","turn",120,"brake",6,5),grow("Чистый старт","start",2,"speed",4,5),
        grow("Гонщик наизнанку","back",16,"reverse",12,5,"forward"),grow("Танковый слалом","turn",100,"accel",10,5,"repair"),
        pulse(null,"Квитанция на вчера","critical",1,"rewind",1)],
    radio: [
        grow("Сеть ретрансляторов","discover",1,"memory",10,5),grow("Перекличка","observe",12,"spot",4,5),
        grow("Вынесенная антенна","travel",100,"radioRange",5,6),grow("Дежурная частота","discover",2,"arty",5,4),
        pulse(null,"Эхо из будущего","arty",1,"signal",45,"bottle"),grow("Бесконечный эфир","observe",8,"memory",18,7,"repair"),
        grow("Дальняя связь","discover",1,"radioRange",12,6)],
    loader: [
        grow("Ритм смены","reload",2,"reload",3,6),pulse(null,"Запасной лоток","switchShot",3,"rounds",3),
        grow("Сортировщик","switchShot",1,"change",7,5),pulse(null,"С рук на руки","swap",1,"charge",85),
        pulse(null,"Украденная секунда","shot",3,"charge",98),grow("Конвейер без пауз","shot",1,"reload",6,7,"switchShot"),
        reserve("Обменный фонд","reload",2,4,"switchShot","convert",2)],
    commander: [
        grow("Журнал контактов","discover",1,"spot",4,5),grow("Слаживание","swap",1,"swap",12,4),
        reserve("Резерв командира","discover",1,4,"swap","crew",12),grow("Наблюдательный пункт","observe",15,"memory",10,5),
        pulse(null,"Резервный экипаж","swap",1,"rally",1,"kit"),grow("Карта присутствия","discover",1,"memory",20,6),
        grow("Штаб на колёсах","observe",12,"repair",8,5,"repair")],
    gunner: [
        grow("Пристрелочная серия","hit",2,"traverse",5,5),grow("Вертикальная поправка","pen",1,"elevate",6,5),
        grow("Ведение цели","observe",10,"traverse",5,4),grow("Поправка по следу","blocked",1,"elevate",12,4,"pen"),
        grow("Попадание в ритм","hit",1,"traverse",10,6,"miss"),grow("Лестница попаданий","pen",1,"elevate",12,6,"miss"),
        grow("Дежурный прицел","still",3,"traverse",14,5,"shot")],
    engine: [
        pulse(null,"Холодный пуск","ext",1,"mend",65),grow("Прогрев под нагрузкой","fast",60,"accel",5,6),
        reserve("Тепловой аккумулятор","climb",12,4,"ext","mend",15),grow("Крейсерский ход","travel",95,"speed",4,5),
        pulse(null,"Перпетуум-мобиле","travel",85,"mend",55),grow("Маховик","fast",30,"accel",12,5,"stop"),
        grow("Километровый мотор","travel",140,"speed",8,6)],
    transmission: [
        grow("Приработка передач","start",2,"accel",5,5),grow("Зубчатая пара","turn",180,"turn",4,6),
        grow("Реверсивный ряд","back",26,"reverse",6,5),pulse(null,"Запасной картер","critical",1,"mend",65),
        grow("Задняя магистраль","back",22,"reverse",14,5,"forward"),grow("Разгонный каскад","start",1,"accel",10,6,"repair"),
        grow("Ползучая передача","climb",10,"hill",15,6)],
    drive: [
        grow("Притёртый погон","slew",120,"traverse",5,5),grow("Возврат в сектор","hit",2,"traverse",5,6),
        grow("Баланс цапф","pitch",25,"elevate",6,5),pulse(null,"Запасная обмотка","critical",1,"mend",65),
        grow("Карусель","slew",90,"traverse",12,6,"shot"),grow("Лифт","pitch",20,"elevate",14,6,"repair"),
        grow("Следящий привод","observe",10,"traverse",9,6,"miss")],
    breech: [
        grow("Приработка клина","shot",3,"reload",4,5),pulse(null,"Полуавтомат","shot",4,"charge",75),
        pulse(null,"Ремонтная втулка","repair",1,"mend",35),grow("Быстрая смена","switchShot",1,"change",8,5),
        pulse(null,"Маятник часовщика","shot",1,"pendulum",1),grow("Горячий затвор","shot",2,"reload",7,6,"repair"),
        pulse(null,"Затвор Феникса","critical",1,"mend",95)],
    track: [
        grow("Прикатка звеньев","travel",65,"grip",6,5),grow("Обратная намотка","back",30,"reverse",5,5),
        grow("Грунтозацеп","climb",10,"hill",8,5),reserve("Полевые звенья","travel",50,5,"repair","mend",8),
        grow("Лента Мёбиуса","turn",90,"turn",10,6,"stop"),grow("Альпинист","climb",8,"hill",16,6),
        pulse(null,"Самосборная цепь","critical",1,"mend",95)],
    ammo: [
        grow("Журнал непробитий","blocked",1,"pen",6,4,"pen"),grow("Внутреннее эхо","pen",1,"inside",5,5),
        grow("Номер партии","shot",3,"pen",3,6),grow("Контрольная пара","switchShot",1,"inside",6,5),
        pulse(null,"Матрёшка","lastRound",1,"nest",4),grow("Долг брони","blocked",1,"pen",12,5,"pen"),
        grow("Гул за бронёй","pen",1,"inside",12,6,"blocked")],
};
// Постоянные идентификаторы уже выданных документов.
const specialIds = {
    driver: ["back-signal","travel-workshop","ext-crew","travel-rounds","back-charge","travel-rally","critical-rewind"],
    radio: ["repair-signal","arty-crew","back-rounds","ext-charge","arty-signal","arty-rally","shot-convert"],
    loader: ["critical-charge","repair-convert","medkit-rounds","shot-kit","shot-charge","back-convert","shot-rounds"],
    commander: ["arty-kit","medkit-workshop","repair-crew","critical-bottle","arty-rally","medkit-signal","travel-workshop"],
    gunner: ["ext-charge","shot-signal","medkit-convert","arty-workshop","shot-charge","shot-convert","critical-rally"],
    engine: ["ext-mend","travel-charge","back-bottle","arty-rounds","travel-mend","critical-rally","ext-signal"],
    transmission: ["back-rounds","repair-charge","travel-crew","critical-mend","back-workshop","back-signal","repair-rally"],
    drive: ["medkit-mend","shot-workshop","arty-convert","ext-signal","shot-charge","critical-rally","repair-signal"],
    breech: ["ext-rounds","shot-charge","medkit-mend","repair-convert","shot-pendulum","arty-convert","critical-mend"],
    track: ["travel-crew","back-mend","repair-bottle","shot-signal","back-workshop","travel-rally","travel-charge"],
    ammo: ["repair-convert","critical-rounds","back-charge","shot-kit","lastRound-nest","shot-signal","critical-rally"],
};

// Названия первых трёх рядов читаются в том же порядке, что и их правила ниже.
const titles = {
    driver: [
        "Внутренняя бровка|Мягкое сцепление|Второе зеркало|Зелёная улица|Стёганый шлем|Свежая смена|Выход из тупика|Отход со склона|Доеду сам|Ходовой вираж",
        "Разворот на пятаке|Короткий реверс|Из заднего ряда|Въезд в шпильку|Хромая передача|Перевальная дорога",
        "Сорванный ограничитель|Только с толкача|Ходовой резерв|Боковое зеркало"],
    radio: [
        "Длинная волна|Чистый эфир|Приоритет вызова|Выносная антенна|Ватные наушники|Утренняя сводка|Тихий пост|Тревожная заявка|Запасная линия|Мобильный узел",
        "Занятая частота|Прямой канал|Радиопост|Походный журнал|Аварийная частота|Открытый эфир",
        "Последняя сводка|Широкий диапазон|Маршевая антенна|Стационарный узел"],
    loader: [
        "Первый номер|Сменный лоток|Свободный проход|Защитный жилет|Кожаные краги|Сухие ладони|Пустые лотки|Поручень|Уплотнённый подбой|За двоих",
        "В один приём|Скользящий ремень|Свободное место|Неполный расчёт|Одной рукой|Упор под плечо",
        "Красный темп|Выбор без задержки|Плечо товарища|Короткий проход"],
    commander: [
        "Соколиный глаз|Короткий приказ|Память на силуэты|Ремонтный наряд|Офицерский шлем|Первый дозор|Боевая тревога|Список пропавших|Держать строй|Один бинокль",
        "Весь во внимание|Архив наблюдений|Заместитель|Наблюдательный пункт|Журнал командира|Неполная бригада",
        "Глаз бури|Рокировка|Полевой штаб|Контакт под огнём"],
    gunner: [
        "Вертикальная риска|Плавный поводок|Боковое зрение|Налобник|Подшлемник|Ясный глаз|Плавное ведение|Боковой сектор|Упор для головы|Обратный взгляд",
        "Высокая дуга|Широкий обзор|Спокойные руки|Ответная наводка|На ощупь|Боковой упор",
        "Вертикаль риска|Карусель|Лицевой щиток|Дальний наблюдатель"],
    engine: [
        "Первый оборот|Походный ход|Обратная тяга|Горный режим|Усиленный блок|Холодная обкатка|Накат|Обратный перевал|Тяжёлый подъём|Горячий пуск",
        "Короткий разгон|Задняя ступень|Дежурные обороты|Факельный пуск|Хриплый выхлоп|Затяжной подъём",
        "Красная зона|Длинная прямая|Огненный перевал|Аварийный реверс"],
    transmission: [
        "Реверс|Планетарный ряд|Разгонная пара|Тормозной вал|Толстый картер|Чистое масло|Обратный вираж|Ходовая пара|Тормозная лента|Горный реверс",
        "Короткий реверс|Первая тяговая|Поворот задом|Отход под уклон|Изношенная пара|Торможение на ходу",
        "Передача беглеца|Перекрёстный привод|Горный тормоз|Вторая задняя"],
    drive: [
        "Погон|Подъёмник|Кожух редуктора|Сервисный люк|Бронекороб|Чистая смазка|Наклон в секторе|Опора на ходу|Сменная секция|Резервный мотор",
        "Плоская карусель|Прочная шестерня|Широкий сектор|Аварийный привод|Упор вала|Балансир",
        "Сорванный стопор|Башенные качели|Ремонтный вкладыш|Секторная опора"],
    breech: [
        "Лёгкий клин|Сменная обойма|Щиток затвора|Ревизионное окно|Цельная муфта|Чистая камора|Ручная смена|Подбой каморы|Ремонтный паз|Ходовая подача",
        "Быстрый клин|Толстая муфта|Сменный лоток|Подача на ходу|Запасная цапфа|Комплект в укладке",
        "Ход на износ|Двойной лоток|Ходовая наладка|Клиновой упор"],
    track: [
        "Короткое звено|Поперечный зацеп|Горный башмак|Тормозной гребень|Толстый палец|Новая лента|Косогор|Обратный подъём|Стальной костыль|Ходовой поворот",
        "Крутой вираж|Тяговый башмак|Поперёк склона|Ходовая колея|Съёмное звено|Задний упор",
        "Рваный поворот|Цепкая лента|Тормоз на марше|Крутой склон"],
    ammo: [
        "Штамп пробития|Внутреннее эхо партии|Первый лоток|Кассета сменщика|Пробковый подбой|Заводская пломба|Последняя партия|Полная полка|Выдвижной ящик|Аварийная партия",
        "Контрольный образец|Подающая рампа|Остаток партии|Клеймо брака|Откидная полка|Парная кассета",
        "Красная маркировка|Отборная партия|Сменный погреб|Дежурный лоток"],
};

// Тренировка конкретной роли: основной и дополнительный источники опыта, затем подписи её карт.
const drills = {
    driver:["turn",90,"start",2,"Школа разворота|Двойной старт|Извилистый маршрут|Стартовая сетка|Старая колея"],
    radio:["observe",8,"discover",1,"Проверка связи|Новый абонент|Длинная волна|Пеленгация|Сетка частот"],
    loader:["reload",2,"switchShot",1,"Набитая рука|Смена лотка|Темп подачи|Новая укладка|Работа в паре"],
    commander:["discover",1,"swap",1,"Знакомый силуэт|Замена в расчёте|Полевой атлас|Кадровый резерв|Командирский обзор"],
    gunner:["hit",2,"pen",1,"Корректура|Верная отметка|Одна линия|Зачётная серия|Работа по цели"],
    engine:["fast",50,"climb",8,"Обкатка|Высотная проба|Крейсерский режим|Горный стенд|Марафон"],
    transmission:["back",24,"start",2,"Обратный пробег|Переключение|Притирка пары|Разгонная смена|Походная передача"],
    drive:["slew",90,"pitch",18,"Полукруг|Вертикальный ход|Длинная дуга|Нулевая риска|Следящий контур"],
    breech:["shot",3,"switchShot",1,"Наработка|Два калибра укладки|Такт затвора|Сменная обойма|Серийный цикл"],
    track:["travel",60,"turn",100,"Притирка трака|Внутренний радиус|Длинная колея|Бортовой поворот|Зацеп за грунт"],
    ammo:["pen",1,"blocked",1,"Ведомость пробитий|Пересмотр партии|Накопленное эхо|Брак под запись|Книга попаданий"],
};

const fieldConditions = {
    driver:["backing","slope","moving"], engine:["moving","slope","burning"], transmission:["backing","moving","slope"], track:["slope","backing","moving"],
    loader:["lean","moving","hurt"], ammo:["lean","rich","worn"], breech:["worn","rich","moving"],
    gunner:["still","turned","seen"], drive:["turned","moving","worn"], commander:["seen","hurt","still"], radio:["still","seen","moving"],
};

function pool(target) {
    const [a,b,c,d] = profiles[target];
    const [field,work,stress] = fieldConditions[target];
    const [ev,step,other,pace,names] = drills[target];
    const training = names.split("|");
    const p = (id,...args) => passive(id, ...args);
    const vitality = {id:"reserve",hp:8,text:"Максимальное здоровье носителя +8%."};
    const common = [
        p("standard",null,a,5),p("backup",null,b,5),
        p("practice",null,c,5),p("tuning",null,d,5),vitality,
        p("fresh","fresh",a,8),p("light",field,b,10),
        p("stock",work,c,7),p("worn","worn",d,11),
        p("empty",stress,a,10),
    ];
    const uncommon = [
        p("exchange",null,a,13,b,8),p("alternate",null,c,14,d,9),
        p("shortage",field,b,20),p("flame",stress,a,26),
        p("scar","worn",c,16),p("cargo",work,d,13),
        {...grow(training[0],ev,step,a,2,4),id:"firstAid"},
        {...grow(training[1],other,pace,b,2,4),id:"spares"},
    ];
    const rare = [
        p("redline","worn",a,32,d,16),p("pact",null,b,22,c,16),
        p("skeleton",stress,d,30),p("debt",field,c,26,a,12),
        {...grow(training[2],ev,step,b,4,5),id:"relay"},
        {...grow(training[3],other,pace,c,4,5),id:"circuit"},
        {...grow(training[4],ev,step*2,d,7,4),id:"rescue"},
    ];
    if (target === "ammo") {
        common[4] = {id:"padding", name:"Пробковый подбой", hp:12, text:"Прочность именно этого стеллажа +12%."};
        uncommon[7] = {id:"false-bottom",name:"Двойное дно",salvage:0.4,text:"При потере этого стеллажа сохраняет 40% его снарядов с округлением вниз."};
        rare[6] = {id:"escrow",name:"Страховой полис",salvage:1,text:"При потере этого стеллажа автоматически тратит аптечку, чтобы сохранить все его снаряды.",cost:"kit"};
    }
    for (const [i,row] of [common,uncommon,rare].entries()) {
        const names = titles[target][i].split("|");
        row.forEach((card,j) => { if (!card.name) card.name = names[j]; });
    }
    const exotic = specialRules[target].map((card,i) => ({...card,id:specialIds[target][i]}));
    return [common,uncommon,rare,exotic.slice(0,4),exotic.slice(4)];
}
export const CARD_POOLS = Object.fromEntries(Object.keys(profiles).map(t => [t,pool(t)]));
export function cardFor(item) {
    return CARD_POOLS[item.target]?.[item.tier]?.find(c=>c.id===item.card);
}
