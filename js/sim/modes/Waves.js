import { Config } from "../../core/Config.js";
import { Events } from "../../core/Events.js";
import { rnd, pick } from "../../core/Utils.js";
import { vehiclesOf } from "../../data/VehicleBuild.js";

export class WavesMode {
    constructor(b) {
        this.b = b;
        this.wave = 0;
        this.state = "prep";
        this.t = 6;
        this.queue = [];
        this.point = b.world.points[0];
        this.cap = 0;
        this.enemies = [];
    }

    start() { }

    playerSpawnPoint() {
        const p = this.point;
        return { x: p.x + rnd(-8, 8), z: p.z + 26 + rnd(-4, 4), a: -Math.PI / 2 };
    }

    startWave(n) {
        const b = this.b;
        this.wave = n;
        this.state = "fight";
        const count = Math.min(2 + n, 10);
        const brTop = Math.min(6.7, 1.6 + (n - 1) * 0.5);
        const pool = vehiclesOf(b.enemyNation).filter((v) => v.br <= brTop + 0.35);
        const strong = pool.filter((v) => v.br >= brTop - 1.6);
        const use = strong.length ? strong : pool;
        const skill = Math.min(0.85, 0.36 + n * 0.035);
        for (let i = 0; i < count; i++) {
            const def = pick(use);
            const edge = pick(b.world.enemyEdges);
            this.queue.push({ id: def.id, x: edge.x + rnd(-40, 40), z: edge.z + rnd(-10, 10), a: edge.a, t: 0.5 + i * 1.4, skill: skill + rnd(-0.08, 0.08) });
        }
        Events.emit("waveStart", { n, count });
    }

    update(dt) {
        const b = this.b;
        // очередь появления
        for (let i = this.queue.length - 1; i >= 0; i--) {
            const q = this.queue[i];
            q.t -= dt;
            if (q.t <= 0) {
                this.queue.splice(i, 1);
                const v = b.spawnVehicle(q.id, 1, q.x, q.z, q.a, { skill: q.skill });
                this.enemies.push(v);
            }
        }
        if (this.state === "prep" || this.state === "break") {
            this.t -= dt;
            if (this.t <= 0) this.startWave(this.wave + 1);
        } else if (this.state === "fight") {
            const alive = b.vehicles.filter((v) => v.team === 1 && !v.dead).length;
            if (!alive && !this.queue.length) this.waveClear();
        }
        // захват высоты противником
        const p = this.point;
        let ne = 0, np = 0;
        for (const v of b.vehicles) {
            if (v.dead) continue;
            if (Math.hypot(v.x - p.x, v.z - p.z) < p.r) (v.team === 1 ? ne++ : np++);
        }
        if (ne && !np) this.cap = Math.min(100, this.cap + Config.WAVES.CAP_RATE * Math.min(3, ne) * dt);
        else if (np && !ne) this.cap = Math.max(0, this.cap - Config.WAVES.CAP_RATE * 2.5 * dt);
        if (this.cap >= 100) { b.end(1, "противник захватил высоту"); return; }
        if ((!b.player || b.player.dead) && !b.hasSpawnsLeft() && b.spawns > 0) {
            b.end(1, "вся техника уничтожена");
        }
    }

    waveClear() {
        const b = this.b;
        this.state = "break";
        this.t = Config.WAVES.BREAK;
        b.stats.wave = this.wave;
        b.award("WAVE", 1 + this.wave * 0.15);
        if (b.player && !b.player.dead) b.player.fieldRepairFull();
        this.cap = 0;
        Events.emit("waveClear", { n: this.wave });
    }

    onDestroyed() { }

    goalFor(v, brain) {
        const b = this.b, p = this.point;
        if (v.team === b.playerTeam) return { x: p.x + rnd(-8, 8), z: p.z + rnd(-8, 8), r: p.r * 0.5, cx: p.x, cz: p.z, wander: p.r * 0.5 };
        const pl = b.player;
        if (pl && !pl.dead && pl.visible[v.team]) {
            const d = Math.hypot(pl.x - v.x, pl.z - v.z);
            if (d < 260 || v.def.role === "light") return { x: pl.x, z: pl.z, r: v.def.role === "td" ? 160 : 60 };
        }
        return { x: p.x + rnd(-6, 6), z: p.z + rnd(-6, 6), r: p.r * 0.4, cx: p.x, cz: p.z, wander: p.r * 0.5 };
    }

    hud() {
        const alive = this.b.vehicles.filter((v) => v.team === 1 && !v.dead).length + this.queue.length;
        return { kind: "waves", wave: this.wave, state: this.state, t: this.t, enemies: alive, cap: this.cap };
    }
}
