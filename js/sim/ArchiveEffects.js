import { cardFor } from "../data/ArchiveCards.js";
import { Config } from "../core/Config.js";
import { Events } from "../core/Events.js";

const CONDITIONS = {
    fresh: (v,u) => u.hp > u.maxHp * .8, worn: (v,u) => u.hp < u.maxHp * .6,
    hurt: v => v.aliveCrew() < v.crew.length,
    rich: v => stocked(v), lean: v => !stocked(v),
    burning: v => !!v.fire,
    still:v=>Math.abs(v.v)<.3, moving:v=>Math.abs(v.v)>2, backing:v=>v.v<-.5,
    slope:v=>Math.abs(v.suspension?.grade || 0)>Math.PI/36,
    seen:v=>v.visible[1-v.team], turned:v=>Math.abs(v.tr)>Math.PI/36,
};
function stocked(v) {
    return v.def.shells.reduce((n,[id])=>n+v.ammo[id],0) > v.cards.capacity / 2;
}
function active(v,entry) {
    const u = entry.unit;
    if (u.hp <= 0) return false;
    if (entry.kind === "plan") return true;
    return u.alive && !u.transit && v.seats[u.seat]?.occupant === u &&
        (u.seat === entry.target || (u.seat === "loader2" && entry.target === "loader"));
}

export function installCards(v, equipment) {
    const stats = new Map(), triggers = new Map(), entries = new Map(), resets = new Map();
    for (const item of equipment) {
        const card = cardFor(item);
        if (!card) continue;
        const unit = item.kind === "plan" ? v.mods[item.slot] : v.seats[item.slot]?.occupant;
        if (!unit) continue;
        const entry = { id:item.id, card, unit, kind:item.kind, target:item.target, progress:0, spent:false };
        entry.level = 0;
        entries.set(item.id,entry);
        if (card.salvage) unit.salvageCard = entry;
        if (card.stack?.reset) {
            if (!resets.has(card.stack.reset)) resets.set(card.stack.reset,[]);
            resets.get(card.stack.reset).push(entry);
        }
        if (card.hp) {
            unit.maxHp *= 1 + card.hp / 100;
            unit.hp = unit.maxHp;
        }
        for (const mod of card.mods || []) {
            if (!stats.has(mod.stat)) stats.set(mod.stat,[]);
            stats.get(mod.stat).push({entry, factor:1 + mod.percent / 100});
        }
        for (const event of new Set([card.stack?.event,card.event].filter(Boolean))) {
            if (!triggers.has(event)) triggers.set(event,[]);
            triggers.get(event).push(entry);
        }
    }
    for (const e of triggers.get("critical") || []) {
        if (e.card.action === "rewind") e.savedHp = e.unit.hp;
    }
    return {stats,triggers,entries,resets,capacity:v.def.shells.reduce((n,s)=>n+s[1],0)};
}
export function statFactor(v,stat,unit) {
    const list = v.cards?.stats.get(stat);
    if (!list) return 1;
    let factor = 1;
    let feedingRack;
    for (const {entry,factor:part} of list) {
        if (unit && entry.unit !== unit) continue;
        if (!unit && entry.target === "ammo" && (stat === "reload" || stat === "change")) {
            feedingRack ??= nextRack(v);
            if (entry.unit !== feedingRack) continue;
        }
        const canApply = stat === "service" && entry.kind === "plan" || active(v,entry);
        if (canApply && (!entry.card.condition || CONDITIONS[entry.card.condition](v,entry.unit))) {
            factor *= entry.card.stack ? 1 + (part - 1) * entry.level : part;
        }
    }
    return Math.min(2.5,Math.max(.35,factor));
}
function restore(unit,percent) {
    if (!unit || unit.hp >= unit.maxHp) return false;
    unit.hp = Math.min(unit.maxHp,unit.hp + unit.maxHp * percent / 100);
    return true;
}
function weakest(units) {
    return units.reduce((weak,u) => !weak || u.hp/u.maxHp < weak.hp/weak.maxHp ? u : weak,null);
}
function restock(v,limit,exchange) {
    const id = v.shell, capacity = v.def.shells.find(([sid])=>sid===id)?.[1];
    let amount = Math.min(limit,(capacity || 0) - (v.ammo[id] || 0));
    if (amount <= 0) return false;
    if (exchange) {
        let paid = 0;
        for (const [other] of v.def.shells) {
            if (other === id) continue;
            const take = Math.min(amount - paid,v.ammo[other]);
            v.ammo[other] -= take; paid += take;
        }
        amount = paid;
    }
    v.ammo[id] += amount;
    return amount > 0;
}
const ACTIONS = {
    charge(v,u,n) {
        if (v.reload <= .01) return false;
        v.reload = Math.max(.01,v.reload * (1 - n/100));
        return true;
    },
    signal(v,u,n,now) {
        const due = v.artyT ?? v.spawnT + Config.ARTY.FIRST;
        if (due <= now) return false;
        v.artyT = Math.max(now,due-n);
        return true;
    },
    mend: (v,u,n) => restore(u,n),
    crew: (v,u,n) => restore(weakest(v.crew.filter(c=>c.alive)),n),
    rounds: (v,u,n) => restock(v,n,false), convert: (v,u,n) => restock(v,n,true),
    rally: v => v.aliveCrew() < v.def.crew.length && !!v.restoreCrewOne(),
    nest(v,u,n) {
        if (u.hp <= u.maxHp * .2 || !restock(v,n,false)) return false;
        u.hp -= u.maxHp * .2;
        return true;
    },
    pendulum(v,u,n,now,entry) {
        entry.fast = !entry.fast;
        v.reload *= entry.fast ? 3 : .1;
        v.reloadTotal = v.reload;
        return true;
    },
    rewind(v,u,n,now,entry) {
        u.hp = entry.savedHp;
        return true;
    },
};
export function cardEvent(v,event,amount=1,now=v.cardTime || 0) {
    if (!v.cards || v.dead) return;
    for (const e of v.cards.resets.get(event) || []) {
        e.level = 0;
        e.progress = 0;
    }
    const entries = v.cards.triggers.get(event);
    if (!entries || v.dead) return;
    for (const e of entries) {
        if (e.spent || !active(v,e)) continue;
        const c = e.card;
        if (c.stack) {
            if (event === c.stack.release) {
                if (e.level && ACTIONS[c.action](v,e.unit,c.amount * e.level,now,e)) {
                    e.level = 0;
                    e.progress = 0;
                    Events.emit("archiveProc",{v,id:e.id});
                }
                continue;
            }
            if (e.level >= c.stack.cap) continue;
            e.progress += amount;
            const gained = Math.floor(e.progress / c.stack.every);
            if (gained) {
                e.level = Math.min(c.stack.cap,e.level + gained);
                e.progress %= c.stack.every;
                Events.emit("archiveProc",{v,id:e.id});
            }
            continue;
        }
        if (event === "critical" && e.unit.hp > .25*e.unit.maxHp) {
            if (c.action === "rewind" && now - (e.savedAt ?? v.spawnT) >= 5) {
                e.savedHp = e.unit.hp;
                e.savedAt = now;
            }
            continue;
        }
        e.progress += amount;
        if (e.progress < c.every) continue;
        e.progress %= c.every;
        if (c.cost === "kit" && !v.medkits || c.cost === "bottle" && !v.ext) continue;
        if (!ACTIONS[c.action](v,e.unit,c.amount,now,e)) continue;
        if (event === "critical") e.spent = true;
        if (c.cost === "kit") v.medkits--;
        if (c.cost === "bottle") v.ext--;
        Events.emit("archiveProc",{v,id:e.id});
    }
}

export function rackLoss(v,slot,loss) {
    const e = v.mods[slot]?.salvageCard;
    if (!e || !loss || (e.card.cost === "kit" && !v.medkits)) return loss;
    const saved = Math.floor(loss * e.card.salvage);
    if (saved) {
        if (e.card.cost === "kit") v.medkits--;
        Events.emit("archiveProc",{v,id:e.id});
    }
    return loss - saved;
}

function nextRack(v) {
    const fills = v.rackFills();
    return v.mods[v.def.rackOrder.find(id=>fills[id]>0)];
}

/** Бонус партии фиксируется до расхода снаряда и до срабатывания карт за выстрел. */
export function archiveShell(v,shell) {
    if (!v.cards || (!v.cards.stats.has("pen") && !v.cards.stats.has("inside"))) return shell;
    const rack = nextRack(v);
    if (!rack) return shell;
    const pen = statFactor(v,"pen",rack), inside = statFactor(v,"inside",rack);
    if (pen === 1 && inside === 1) return shell;
    return {...shell, pen:shell.pen.map(value=>value*pen), insideScale:inside};
}
