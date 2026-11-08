import { Config } from "../../core/Config.js";
import { rnd } from "../../core/Utils.js";
import { pickBotVehicle } from "./Domination.js";

/**
 * Дуэль 1 на 1: по одной машине с каждой стороны, точек нет. Машины сетапа выезжают по очереди,
 * каждая — один раз и бесплатно. Побеждает тот, у кого осталась техника.
 * Если на стороне нет игрока, её занимает бот с таким же числом машин, как у соперника.
 */
export class DuelMode {
    constructor(b) {
        this.b = b;
        this.timeLeft = Config.DUEL.TIME;
        this.bots = [];
        this.points = [];
        this.freeSpawns = true;
    }

    start() {
        const b = this.b;
        for (let team = 0; team < 2; team++) {
            if (b.pilots.some((P) => P.team === team)) continue;
            const opp = b.pilots.find((P) => P.team !== team);
            const lives = opp ? Math.max(1, opp.lineup.length) : Config.DUEL.BOT_LIVES;
            const bot = { team, nation: b.teamNation[team], lives, v: null, respawnT: 0, skill: Config.DUEL.BOT_SKILL };
            this.bots.push(bot);
            this.spawnBot(bot);
        }
    }

    spawnPoint(team) {
        const sp = this.b.world.spawns[team];
        return { x: sp.x + rnd(-sp.spread, sp.spread), z: sp.z + rnd(-4, 4), a: sp.a };
    }

    playerSpawnPoint(P) { return this.spawnPoint(P ? P.team : this.b.playerTeam); }

    spawnBot(bot) {
        const b = this.b;
        const id = pickBotVehicle(bot.nation, b.lineupBR, null);
        const sp = this.spawnPoint(bot.team);
        bot.v = b.spawnVehicle(id, bot.team, sp.x, sp.z, sp.a, { skill: bot.skill });
        bot.lives--;
    }

    /** Сколько машин у стороны ещё в бою или в запасе */
    remaining(team) {
        const b = this.b;
        let n = b.vehicles.filter((v) => !v.dead && v.team === team && !v.static).length;
        for (const bot of this.bots) if (bot.team === team) n += bot.lives;
        for (const P of b.pilots) if (P.team === team && !P.left) n += P.lineup.filter((l) => !l.used).length;
        return n;
    }

    update(dt) {
        const b = this.b;
        this.timeLeft -= dt;
        for (const bot of this.bots) {
            if (bot.v && !bot.v.dead) continue;
            if (bot.lives <= 0) continue;
            bot.respawnT -= dt;
            if (bot.respawnT <= 0) this.spawnBot(bot);
        }
        const left = [this.remaining(0), this.remaining(1)];
        for (let team = 0; team < 2; team++) {
            if (left[team] <= 0) { b.end(1 - team, "у противника не осталось техники"); return; }
        }
        if (this.timeLeft <= 0) {
            b.end(left[0] === left[1] ? -1 : left[0] > left[1] ? 0 : 1, left[0] === left[1] ? "время вышло — ничья" : "время вышло — больше техники в строю");
        }
    }

    onDestroyed(v) {
        const bot = this.bots.find((bt) => bt.v === v);
        if (bot) bot.respawnT = Config.DUEL.BOT_RESPAWN;
    }

    /** Цель ИИ: к последнему известному противнику, иначе к центру карты */
    goalFor(v, brain) {
        const b = this.b, S = b.world.S;
        const enemy = b.vehicles.find((o) => !o.dead && o.team !== v.team && !o.static);
        if (enemy && (enemy.visible[v.team] || brain.lastSeen)) {
            const t = enemy.visible[v.team] ? enemy : brain.lastSeen;
            return { x: t.x + rnd(-20, 20), z: t.z + rnd(-20, 20), r: 18 };
        }
        return { x: S / 2 + rnd(-40, 40), z: S / 2 + rnd(-40, 40), r: 20 };
    }

    hud() {
        return { kind: "duel", time: this.timeLeft, left: [this.remaining(0), this.remaining(1)] };
    }

    netState() { return { k: "duel", tl: Math.round(this.timeLeft * 10) / 10, left: [this.remaining(0), this.remaining(1)] }; }
}
