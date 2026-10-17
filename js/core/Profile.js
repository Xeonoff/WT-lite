import { Settings } from "./Settings.js";
import { Events } from "./Events.js";
import { ALL_VEHICLES, getVehicle } from "../data/VehicleBuild.js";

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
            d.lineup.ussr = (d.lineup.ussr || []).filter((id) => getVehicle(id));
            d.lineup.germany = (d.lineup.germany || []).filter((id) => getVehicle(id));
            return d;
        }
    } catch (e) { /* ignore */ }
    return defaults();
}

const data = load();

export const Profile = {
    data,
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
