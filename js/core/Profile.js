import { Settings } from "./Settings.js";
import { Events } from "./Events.js";
import { ALL_VEHICLES, getVehicle } from "../data/VehicleBuild.js";
import { CASES, CASE_PRICE, rollItem, slotTarget } from "../data/Archive.js";
import { CARD_POOLS, cardFor } from "../data/ArchiveCards.js";

const KEY = "wtl_profile_v2";
export const RESEARCH_COST = { 1: 0, 2: 1800, 3: 4200 };
export const LINEUP_MAX = 4;

function defaults() {
    const researched = ALL_VEHICLES.filter((v) => v.rank === 1).map((v) => v.id);
    const lineup = { ussr: [], germany: [] };
    for (const v of ALL_VEHICLES) if (v.rank === 1 && lineup[v.nation].length < LINEUP_MAX) lineup[v.nation].push(v.id);
    return {
        rp: { ussr: 0, germany: 0 },
        researched,
        lineup,
        nation: "ussr",
        bestWave: 0,
        archive: [],
        stats: { battles: 0, wins: 0, kills: 0, deaths: 0 },
        lastMode: "domination",
        lastMap: "random",
        lastVehicle: { ussr: "t34_41", germany: "pz4f2" },
    };
}

function load() {
    try {
        const raw = localStorage.getItem(KEY);
        if (raw) {
            const d = { ...defaults(), ...JSON.parse(raw) };
            if (!Array.isArray(d.archive)) d.archive = [];
            let migrated = false;
            for (const item of d.archive) {
                if (item.tier === null) continue;
                const pool = CARD_POOLS[item.target]?.[item.tier];
                if (pool && !cardFor(item)) {
                    item.card = pool[(item.id - 1) % pool.length].id;
                    migrated = true;
                }
            }
            if (migrated) {
                try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* доступен в памяти до следующего сохранения */ }
            }
            d.lineup.ussr = (d.lineup.ussr || []).filter((id) => getVehicle(id));
            d.lineup.germany = (d.lineup.germany || []).filter((id) => getVehicle(id));
            return d;
        }
    } catch (e) { /* ignore */ }
    return defaults();
}

const data = load();

function addSealedCase(kind, source) {
    const id = (data.archive.at(-1)?.id || 0) + 1;
    data.archive.push({ id, kind, source, tier: null, vehicle: null, slot: null });
}

export const Profile = {
    data,
    receiveCase(kind, source) {
        if (!Object.hasOwn(CASES, kind) || !source || data.archive.some(i => i.source === source)) return false;
        addSealedCase(kind, source);
        this.save();
        return true;
    },
    buyCase(kind, nation) {
        if (!Object.hasOwn(CASES, kind) || !Object.hasOwn(data.rp, nation)) return false;
        const balance = data.rp[nation];
        if (!Number.isFinite(balance) || balance < CASE_PRICE) return false;
        data.rp[nation] = balance - CASE_PRICE;
        addSealedCase(kind, "shop");
        this.save();
        return true;
    },
    prepareCase(id) {
        const box = data.archive.find(i => i.id === id);
        if (!box || box.tier !== null) return null;
        if (!box.pending) {
            box.pending = rollItem(box.kind);
            this.save();
        }
        return box.pending;
    },
    openCase(id) {
        const item = data.archive.find(i => i.id === id);
        if (!item || item.tier !== null) return null;
        Object.assign(item, item.pending || rollItem(item.kind));
        delete item.pending;
        this.save();
        return item;
    },
    assignItem(id, vehicle, slot, { replace = false } = {}) {
        const item = data.archive.find(i => i.id === id);
        const def = getVehicle(vehicle);
        if (!item || item.tier === null || !def || !this.isResearched(vehicle) ||
            slotTarget(def, item.kind, slot) !== item.target) return false;
        const previous = data.archive.find(i => i !== item && i.kind === item.kind && i.vehicle === vehicle && i.slot === slot);
        if (previous && !replace) return false;
        if (previous) Object.assign(previous, { vehicle: null, slot: null });
        Object.assign(item, { vehicle, slot });
        this.save();
        return true;
    },
    unassignItem(id) {
        const item = data.archive.find(i => i.id === id);
        if (!item?.vehicle) return false;
        Object.assign(item, { vehicle: null, slot: null });
        this.save();
        return true;
    },
    equipment() {
        const byVehicle = {};
        for (const { id, vehicle, kind, target, tier, slot, card } of data.archive) {
            if (vehicle && this.isResearched(vehicle)) (byVehicle[vehicle] ??= []).push({ id, kind, target, tier, slot, card });
        }
        return byVehicle;
    },
    save() {
        try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* ignore */ }
        Events.emit("profile");
    },
    isResearched(id) { return Settings.get("unlockAll") || data.researched.includes(id); },
    cost(id) { return RESEARCH_COST[getVehicle(id).rank] || 0; },
    /** Ранг открывается, когда исследована хотя бы одна машина предыдущего ранга этой нации */
    rankOpen(nation, rank) {
        if (rank <= 1 || Settings.get("unlockAll")) return true;
        return ALL_VEHICLES.some((v) => v.nation === nation && v.rank === rank - 1 && this.isResearched(v.id));
    },
    canResearch(id) {
        const v = getVehicle(id);
        if (this.isResearched(id)) return false;
        return this.rankOpen(v.nation, v.rank) && data.rp[v.nation] >= this.cost(id);
    },
    research(id) {
        if (!this.canResearch(id)) return false;
        const v = getVehicle(id);
        data.rp[v.nation] -= this.cost(id);
        data.researched.push(id);
        if (data.lineup[v.nation].length < LINEUP_MAX) data.lineup[v.nation].push(id);
        this.save();
        return true;
    },
    lineup(nation) {
        return data.lineup[nation].filter((id) => this.isResearched(id));
    },
    toggleLineup(id) {
        const v = getVehicle(id);
        const arr = data.lineup[v.nation];
        const i = arr.indexOf(id);
        if (i >= 0) { if (arr.length > 1) arr.splice(i, 1); else return false; }
        else {
            if (!this.isResearched(id)) return false;
            if (arr.length >= LINEUP_MAX) arr.shift();
            arr.push(id);
        }
        this.save();
        return true;
    },
    addVehicleStats(vs) {
        data.vstats = data.vstats || {};
        for (const id in vs) {
            const s = data.vstats[id] || (data.vstats[id] = { spawns: 0, kills: 0 });
            s.spawns += vs[id].spawns;
            s.kills += vs[id].kills;
        }
        this.save();
    },
    addRP(nation, n) { data.rp[nation] = Math.max(0, Math.round(data.rp[nation] + n)); this.save(); },
    recordBattle(r) {
        data.stats.battles++;
        if (r.win) data.stats.wins++;
        data.stats.kills += r.kills || 0;
        data.stats.deaths += r.deaths || 0;
        if (r.wave) data.bestWave = Math.max(data.bestWave, r.wave);
        this.save();
    },
    setNation(n) { data.nation = n; this.save(); },
    reset() {
        const d = defaults();
        for (const k in d) data[k] = d[k];
        this.save();
    },
};
