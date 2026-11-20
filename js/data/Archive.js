import { CARD_POOLS, cardFor } from "./ArchiveCards.js";
export const CASES = { dossier: "Архив личных дел", plan: "Папка с чертежами" };
export const DROP_CHANCE = { online: 30, boss: 75 };
export const RARITY = [
    { dossier: "Обычное", plan: "Обычный", color: "#c3c6bc", chance: 48 },
    { dossier: "Необычное", plan: "Необычный", color: "#95ce88", chance: 29 },
    { dossier: "Редкое", plan: "Редкий", color: "#80bcf4", chance: 15 },
    { dossier: "Дело ветерана", plan: "Новаторский", color: "#d2a0f2", chance: 6 },
    { dossier: "Дело аса", plan: "Сверхсекретный", color: "#ffca74", chance: 2 },
];
export const TARGETS = {
    dossier: { driver:"Механик-водитель", radio:"Радист", loader:"Заряжающий", commander:"Командир", gunner:"Наводчик" },
    plan: { engine:"Двигатель", transmission:"Трансмиссия", drive:"Механизм поворота", breech:"Казённик", track:"Гусеница", ammo:"Боеукладка" },
};

export function slotTarget(def, kind, slot) {
    if (!def || def.boss) return null;
    if (kind === "dossier" && def.crew.includes(slot)) return slot === "loader2" ? "loader" : slot;
    if (kind === "plan") return def.modules.find(m => m.id === slot)?.type;
    return null;
}

export function slotName(def, kind, slot) {
    if (kind === "dossier") return slot === "loader2" ? "Второй заряжающий" : def.crewTitles[slot];
    if (slot === "trackL") return "Левая гусеница";
    if (slot === "trackR") return "Правая гусеница";
    const index = def.rackOrder.indexOf(slot);
    if (index >= 0) return "Стеллаж БК № " + (index + 1);
    return def.modules.find(m => m.id === slot)?.name || slot;
}

export function rollDrop(online, bossWin, spawns, random = Math.random) {
    if (!spawns || (!online && !bossWin) || random() * 100 >= (bossWin ? DROP_CHANCE.boss : DROP_CHANCE.online)) return null;
    return random() < 0.5 ? "dossier" : "plan";
}

export function rollItem(kind, random = Math.random) {
    let roll = random() * 100, tier = 0;
    while (tier < RARITY.length - 1 && roll >= RARITY[tier].chance) {
        roll -= RARITY[tier].chance;
        tier++;
    }
    const targets = Object.keys(TARGETS[kind]);
    const target = targets[Math.floor(random() * targets.length)];
    const pool = CARD_POOLS[target][tier];
    return {kind, tier, target, card:pool[Math.floor(random() * pool.length)].id};
}

/** На проводе только назначения. Значения эффектов всегда берём из каталога. */
export function readLoadout(def, entries, used = new Set()) {
    if (!Array.isArray(entries) || def.boss) return [];
    const result = [], occupied = new Set();
    for (const e of entries.slice(0, def.crew.length + def.modules.length)) {
        if (!e || !Number.isSafeInteger(e.id) || e.id < 1 || used.has(e.id) ||
            !Number.isInteger(e.tier) || !RARITY[e.tier] || typeof e.kind !== "string" || !Object.hasOwn(TARGETS, e.kind)) continue;
        const target = slotTarget(def, e.kind, e.slot);
        if (!target || !Object.hasOwn(TARGETS[e.kind], target) || target !== e.target || !cardFor(e)) continue;
        const key = e.kind + "/" + e.slot;
        if (occupied.has(key)) continue;
        occupied.add(key);
        used.add(e.id);
        result.push({ id: e.id, kind: e.kind, target, tier: e.tier, slot: e.slot, card:e.card });
    }
    return result;
}
