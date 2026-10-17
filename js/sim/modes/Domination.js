import { Config } from "../../core/Config.js";
import { Events } from "../../core/Events.js";
import { rnd } from "../../core/Utils.js";
import { vehiclesOf } from "../../data/VehicleBuild.js";

/** Подбор техники бота по боевому рейтингу и ролям */
export function pickBotVehicle(nation, br, roleBias) {
    const all = vehiclesOf(nation);
    let pool = all.filter((v) => Math.abs(v.br - br) <= 1.01);
    if (!pool.length) pool = all.slice().sort((a, b) => Math.abs(a.br - br) - Math.abs(b.br - br)).slice(0, 3);
    if (roleBias) {
        const biased = pool.filter((v) => v.role === roleBias);
        if (biased.length && Math.random() < 0.6) pool = biased;
    }
    // тяжёлых и ПТ чуть меньше
    const w = pool.map((v) => (v.role === "medium" ? 1.4 : v.role === "light" ? 0.9 : 0.8) * (1 - Math.abs(v.br - br) * 0.25));
    let s = w.reduce((a, b) => a + b, 0) * Math.random();
    for (let i = 0; i < pool.length; i++) { s -= w[i]; if (s <= 0) return pool[i].id; }
    return pool[0].id;
}

export class DominationMode {
    constructor(b) {
        this.b = b;
        const C = Config.DOMINATION;
        this.tickets = [C.TICKETS, C.TICKETS];
        this.points = b.world.points.map((p) => ({ ...p, owner: -1, prog: 0, n: [0, 0] }));
        this.bots = [];
        this.supplyT = 0;
        this.timeLeft = C.TIME;
    }

    start() {
        const C = Config.DOMINATION;
        const b = this.b;
        const roles = ["medium", "heavy", "light", "td", "medium", "medium"];
        for (let team = 0; team < 2; team++) {
            const n = team === b.playerTeam ? C.TEAM_SIZE - 1 : C.TEAM_SIZE;
            const nation = team === b.playerTeam ? b.nation : b.enemyNation;
            for (let i = 0; i < n; i++) {
                const bot = { team, nation, lives: C.BOT_LIVES, v: null, respawnT: rnd(0, 1.5), skill: rnd(0.45, 0.8), role: roles[i % roles.length] };
                this.bots.push(bot);
            }
        }
        for (const bot of this.bots) this.spawnBot(bot);
    }

    spawnBot(bot) {
        const b = this.b;
        const id = pickBotVehicle(bot.nation, b.lineupBR, bot.role);
        const sp = b.spawnPoint(bot.team);
        bot.v = b.spawnVehicle(id, bot.team, sp.x, sp.z, sp.a, { skill: bot.skill });
        bot.lives--;
    }

    playerSpawnPoint() {
        return this.b.spawnPoint(this.b.playerTeam);
    }

    update(dt) {
        const b = this.b, C = Config.DOMINATION;
        this.timeLeft -= dt;
        // захват
        for (const p of this.points) {
            p.n = [0, 0];
            for (const v of b.vehicles) {
                if (v.dead || v.static) continue;
                if (Math.hypot(v.x - p.x, v.z - p.z) < p.r) p.n[v.team]++;
            }
            const [n0, n1] = p.n;
            const prev = p.owner;
            if (n0 && !n1) p.prog = Math.min(100, p.prog + C.CAP_RATE * Math.min(3, n0) * dt);
            else if (n1 && !n0) p.prog = Math.max(-100, p.prog - C.CAP_RATE * Math.min(3, n1) * dt);
            if (p.owner === 0 && p.prog <= 0) p.owner = -1;
            if (p.owner === 1 && p.prog >= 0) p.owner = -1;
            if (p.prog >= 100) p.owner = 0;
            if (p.prog <= -100) p.owner = 1;
            if (p.owner !== prev) {
                Events.emit("pointChange", { p, owner: p.owner, prev });
                if (p.owner !== -1) {
                    const capturers = b.vehicles.filter((v) => !v.dead && v.team === p.owner && Math.hypot(v.x - p.x, v.z - p.z) < p.r);
                    for (const v of capturers) {
                        v.stats.caps++;
                        if (v === b.player) { b.stats.caps++; b.award("CAPTURE"); }
                    }
                }
            }
        }
        // пополнение на своей точке
        this.supplyT -= dt;
        if (this.supplyT <= 0) {
            this.supplyT = 4;
            for (const v of b.vehicles) {
                if (v.dead || v.static) continue;
                const p = this.points.find((q) => q.owner === v.team && Math.hypot(v.x - q.x, v.z - q.z) < q.r);
                if (!p) continue;
                const restored = v.restoreCrewOne();
                const ammo = v.resupply(0.15);
                if (v.ext < 2) v.ext++;
                if (v.medkits < 1) v.medkits = 1;
                if ((restored || ammo) && v === b.player) Events.emit("resupply", { v, crew: restored, ammo });
            }
        }
        // очки
        const own = [0, 0];
        for (const p of this.points) if (p.owner >= 0) own[p.owner]++;
        if (own[0] > own[1]) this.tickets[1] -= (own[0] - own[1]) * C.BLEED * dt;
        if (own[1] > own[0]) this.tickets[0] -= (own[1] - own[0]) * C.BLEED * dt;
        // возрождение ботов
        for (const bot of this.bots) {
            if (bot.v && !bot.v.dead) continue;
            if (bot.lives <= 0) continue;
            bot.respawnT -= dt;
            if (bot.respawnT <= 0) { this.spawnBot(bot); bot.respawnT = 9; }
        }
        // конец боя
        const pt = b.playerTeam;
        if (this.tickets[0] <= 0 || this.tickets[1] <= 0) {
            this.tickets = this.tickets.map((t) => Math.max(0, t));
            b.end(this.tickets[0] <= 0 ? 1 : 0, "очки команды исчерпаны");
            return;
        }
        for (let team = 0; team < 2; team++) {
            const alive = b.vehicles.some((v) => !v.dead && v.team === team);
            const botsLeft = this.bots.some((bt) => bt.team === team && bt.lives > 0);
            const playerLeft = team === pt && (b.player && !b.player.dead || b.hasSpawnsLeft());
            if (!alive && !botsLeft && !playerLeft) { b.end(1 - team, "вся техника команды уничтожена"); return; }
        }
        if (this.timeLeft <= 0) b.end(this.tickets[0] >= this.tickets[1] ? 0 : 1, "время боя истекло");
    }

    onDestroyed(v) {
        this.tickets[v.team] = Math.max(0, this.tickets[v.team] - Config.DOMINATION.KILL_COST);
        const bot = this.bots.find((bt) => bt.v === v);
        if (bot) bot.respawnT = 9 + rnd(0, 4);
    }

    /** Цель для ИИ: точки захвата с учётом роли */
    goalFor(v, brain) {
        const b = this.b;
        if (!brain.assign || b.time > brain.assignT || (brain.assign.owner === v.team && rnd() < 0.02)) {
            brain.assignT = b.time + rnd(12, 24);
            let best = null, bestS = Infinity;
            for (const p of this.points) {
                const d = Math.hypot(p.x - v.x, p.z - v.z);
                let s = d / 110 + rnd(0, 1.3);
                if (p.owner === v.team && !p.n[1 - v.team]) s += 2.2;
                if (p.n[1 - v.team]) s -= 0.6;
                if (p.owner !== -1 && p.owner !== v.team) s -= 0.4;
                if (s < bestS) { bestS = s; best = p; }
            }
            brain.assign = best;
        }
        const p = brain.assign;
        if (!p) return null;
        if (v.def.role === "td") {
            // поддержка с дистанции: позиция за точкой ближе к своей базе
            const sp = b.world.spawns[v.team];
            const dx = sp.x - p.x, dz = sp.z - p.z, L = Math.hypot(dx, dz) || 1;
            const k = p.owner === v.team ? 55 : 30;
            return { x: p.x + dx / L * k, z: p.z + dz / L * k, r: 8 };
        }
        return { x: p.x + rnd(-p.r * 0.5, p.r * 0.5), z: p.z + rnd(-p.r * 0.5, p.r * 0.5), r: p.r * 0.45, cx: p.x, cz: p.z, wander: p.r * 0.55 };
    }

    hud() {
        return { kind: "domination", tickets: this.tickets, points: this.points, time: this.timeLeft, max: Config.DOMINATION.TICKETS };
    }
}

