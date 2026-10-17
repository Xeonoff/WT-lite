import { Config } from "../core/Config.js";
import { Events } from "../core/Events.js";
import { rnd, clamp, angDiff, TAU } from "../core/Utils.js";
import { SHELLS } from "../data/Shells.js";
import { getVehicle } from "../data/VehicleBuild.js";
import { WEATHER, BIOME_WEATHER } from "../data/Maps.js";
import { World } from "./World.js";
import { Vehicle } from "./Vehicle.js";
import { Brain } from "./AI.js";
import { driveVehicle, resolveCollisions } from "./Physics.js";
import { Shot, updateShots } from "./Projectiles.js";
import { muzzleWorld, gunPivotWorld } from "./Armor.js";
import { fireTick } from "./Damage.js";
import { DominationMode } from "./modes/Domination.js";
import { WavesMode } from "./modes/Waves.js";
import { RangeMode } from "./modes/Range.js";

const CALLSIGNS = [
    ["Сокол", "Беркут", "Ястреб", "Кречет", "Орлан", "Сапсан"],
    ["Волк", "Рысь", "Барс", "Шакал", "Вепрь", "Лис", "Гюрза", "Кобра", "Варан", "Тур"],
];

export class Battle {
    /**
     * opts: { mode, mapId, nation, lineup:[ids], seed, rangeTargets:[ids] }
     */
    constructor(opts) {
        this.opts = opts;
        this.mode = opts.mode;
        this.time = 0;
        this.seed = opts.seed || Math.floor(Math.random() * 1e9);
        this.world = new World(opts.mapId, this.seed, opts.mode);
        const pool = BIOME_WEATHER[this.world.map.biome];
        let wid = opts.weather && opts.weather !== "random" ? opts.weather : pool[Math.floor(Math.random() * pool.length)];
        if (!pool.includes(wid)) wid = pool[0];
        if (opts.mode === "range") wid = "clear";
        this.weatherId = wid;
        this.weather = WEATHER[wid];
        this.difficulty = { easy: 0.68, normal: 1, hard: 1.22 }[opts.difficulty || "normal"] || 1;
        this.vstats = {};
        this.vehicles = [];
        this.shots = [];
        this.strikes = [];
        this.player = null;
        this.playerTeam = 0;
        this.nation = opts.nation;
        this.enemyNation = opts.nation === "ussr" ? "germany" : "ussr";
        this.lineup = opts.lineup.map((id) => ({ id, used: false, deaths: 0 }));
        this.sp = 0;
        this.spawns = 0;
        this.deathAt = -1;
        this.stats = { kills: 0, assists: 0, hits: 0, pens: 0, crits: 0, caps: 0, shots: 0, deaths: 0, rp: Config.RP.BASE, wave: 0, dmgDone: 0 };
        this.ended = false;
        this.result = null;
        this.spotAcc = 0;
        this.callIdx = [0, 0];
        this.lineupBR = Math.max(...opts.lineup.map((id) => getVehicle(id).br));
        if (this.mode === "domination") this.modeCtl = new DominationMode(this);
        else if (this.mode === "waves") this.modeCtl = new WavesMode(this);
        else this.modeCtl = new RangeMode(this);
        this.modeCtl.start();
    }

    callsign(team) {
        const list = CALLSIGNS[team === this.playerTeam ? 0 : 1];
        const i = this.callIdx[team]++;
        return list[i % list.length] + (i >= list.length ? "-" + (Math.floor(i / list.length) + 1) : "");
    }

    /* ─────────── Спавн ─────────── */
    spawnVehicle(defId, team, x, z, a, opts = {}) {
        const def = getVehicle(defId);
        const [fx, fz] = this.world.nearestFree(x, z, 30);
        const v = new Vehicle(def, team, fx, fz, a, opts);
        v.spawnT = this.time;
        v.callsign = opts.callsign || (opts.isPlayer ? "Вы" : this.callsign(team));
        if (!opts.isPlayer && !opts.static) {
            let skill = opts.skill ?? 0.55;
            if (team !== this.playerTeam) skill = clamp(skill * this.difficulty, 0.2, 0.95);
            v.brain = new Brain(v, this, skill);
        }
        // не спавнимся друг в друге
        for (let k = 0; k < 24; k++) {
            const clash = this.vehicles.some((o) => Math.hypot(o.x - v.x, o.z - v.z) < o.def.bodyRadius + def.bodyRadius + (o.dead ? 2.5 : 1)) || this.world.isBlocked(v.x, v.z);
            if (!clash) break;
            const r = 6 + k * 1.5, ang = rnd(0, Math.PI * 2);
            v.x = fx + Math.cos(ang) * r; v.z = fz + Math.sin(ang) * r;
        }
        this.vehicles.push(v);
        Events.emit("spawn", { v });
        return v;
    }

    spawnPoint(team) {
        const sp = this.world.spawns[team];
        return { x: sp.x + rnd(-sp.spread, sp.spread), z: sp.z + rnd(-6, 6), a: sp.a };
    }

    spawnCost(id) { return this.spawns === 0 ? 0 : getVehicle(id).spCost; }

    canSpawn(id) {
        const e = this.lineup.find((l) => l.id === id);
        if (!e) return { ok: false, reason: "нет в сетапе" };
        if (this.mode !== "range" && e.used) return { ok: false, reason: "уже использована" };
        const cost = this.spawnCost(id);
        if (this.mode !== "range" && this.sp < cost) {
            // резервный выезд: если очков не хватает, неиспользованная машина становится доступна через время
            const wait = Config.SP.RESERVE_WAIT - (this.time - this.deathAt);
            if (this.deathAt >= 0 && wait <= 0) return { ok: true, cost: 0, reserve: true };
            return { ok: false, reason: "нужно " + cost + " ОВ" + (this.deathAt >= 0 ? " · резерв через " + Math.ceil(wait) + " с" : ""), cost, wait };
        }
        return { ok: true, cost };
    }

    anySpawnAvailable() {
        if (this.mode === "range") return true;
        return this.lineup.some((l) => this.canSpawn(l.id).ok);
    }

    /** Остались ли неиспользованные машины (с учётом будущего резервного выезда) */
    hasSpawnsLeft() {
        if (this.mode === "range") return true;
        return this.lineup.some((l) => !l.used);
    }

    spawnPlayer(id) {
        const c = this.canSpawn(id);
        if (!c.ok || (this.player && !this.player.dead && this.mode !== "range")) return null;
        if (this.mode !== "range") {
            this.sp -= c.cost;
            this.lineup.find((l) => l.id === id).used = true;
        }
        if (this.player && this.mode === "range") this.removeVehicle(this.player);
        const p = this.modeCtl.playerSpawnPoint ? this.modeCtl.playerSpawnPoint() : this.spawnPoint(this.playerTeam);
        const v = this.spawnVehicle(id, this.playerTeam, p.x, p.z, p.a, { isPlayer: true });
        this.player = v;
        (this.vstats[id] = this.vstats[id] || { spawns: 0, kills: 0 }).spawns++;
        this.spawns++;
        Events.emit("playerSpawn", { v });
        return v;
    }

    removeVehicle(v) {
        const i = this.vehicles.indexOf(v);
        if (i >= 0) this.vehicles.splice(i, 1);
        this.world.removeWreckOf(v);
        Events.emit("vehicleRemoved", { v });
    }

    /* ─────────── Главный шаг ─────────── */
    update(dt) {
        if (this.ended && this.endT !== undefined) this.endT += dt;
        this.time += dt;
        this.lastDt = dt;
        for (const v of this.vehicles) if (v.brain && !v.dead) v.brain.update(dt);
        for (const v of this.vehicles) {
            if (v.dead) continue;
            driveVehicle(v, dt);
            this.aimTurret(v, dt);
            v.update(dt, this.time);
            if (v.fire) fireTick(this, v, dt);
        }
        resolveCollisions(this);
        this.updateStrikes(dt);
        updateShots(this, dt);
        this.spotAcc -= dt;
        if (this.spotAcc <= 0) { this.spotAcc = 0.25; this.updateSpotting(); }
        if (!this.ended) this.modeCtl.update(dt);
    }

    /** Поворот башни (или орудия в рубке) к точке прицеливания */
    aimTurret(v, dt) {
        if (!v.aimPoint) { v.trRate = 0; return; }
        const piv = gunPivotWorld(v);
        const T = v.def.turret;
        let want;
        if (T.casemate) {
            want = angDiff(v.a, Math.atan2(v.aimPoint[2] - piv[2], v.aimPoint[0] - piv[0]));
            const arc = T.arc * Math.PI / 180;
            want = clamp(want, -arc, arc);
        } else {
            // относительный угол башни: от центра башни на точку
            const tc = [v.x + Math.cos(v.a) * T.x, v.z + Math.sin(v.a) * T.x];
            want = angDiff(v.a, Math.atan2(v.aimPoint[2] - tc[1], v.aimPoint[0] - tc[0]));
        }
        const rate = v.turretRate();
        const d = angDiff(v.tr, want);
        const step = clamp(d, -rate * dt, rate * dt);
        v.tr += step;
        if (!T.casemate) v.tr = angDiff(0, v.tr);
        v.trRate = step / Math.max(dt, 1e-4);
    }

    /** Выстрел: направление по фактическому положению орудия + рассеивание */
    fire(v) {
        if (!v.canFire()) return false;
        const sid = v.consumeShot();
        if (!sid) return false;
        const def = SHELLS[sid];
        const m = muzzleWorld(v);
        let yaw = v.gunYaw();
        let pitch = 0;
        if (v.aimPoint) {
            const dx = v.aimPoint[0] - m[0], dz = v.aimPoint[2] - m[2];
            const hd = Math.max(12, Math.hypot(dx, dz));
            pitch = clamp(Math.atan2(v.aimPoint[1] - m[1], hd), -0.12, 0.2);
        }
        const disp = v.dispersion();
        const r = disp * Math.sqrt(Math.random()), ph = Math.random() * TAU;
        yaw += Math.cos(ph) * r;
        pitch += Math.sin(ph) * r * 0.7;
        const dir = [Math.cos(pitch) * Math.cos(yaw), Math.sin(pitch), Math.cos(pitch) * Math.sin(yaw)];
        this.shots.push(new Shot(v, def, m, dir));
        v.lastShot = this.time;
        v.bloom += def.cal >= 40 ? 1.6 : 0.35;
        v.recoil = 1;
        if (v.isPlayer) this.stats.shots++;
        Events.emit("shot", { v, def, pos: m, dir });
        return true;
    }

    /* ─────────── Артиллерийский удар ─────────── */
    artyLeft(v) {
        const ready = v.artyT !== undefined ? v.artyT : v.spawnT + Config.ARTY.FIRST;
        return Math.max(0, ready - this.time);
    }

    callArtillery(v, x, z) {
        const A = Config.ARTY;
        if (!v || v.dead || this.ended) return { ok: false, reason: "недоступно" };
        const left = this.artyLeft(v);
        if (left > 0) return { ok: false, reason: "перезарядка " + Math.ceil(left) + " с" };
        if (Math.hypot(x - v.x, z - v.z) > A.RANGE) return { ok: false, reason: "слишком далеко" };
        const S = this.world.S;
        x = clamp(x, 4, S - 4); z = clamp(z, 4, S - 4);
        v.artyT = this.time + (this.mode === "range" ? 5 : A.COOLDOWN * (v.isPlayer ? 1 : A.BOT_MULT));
        const def = SHELLS[v.def.nation === "ussr" ? "arty122" : "arty105"];
        const s = { x, z, team: v.team, by: v, def, t: 0, n: 0, total: A.SHELLS, r: A.SPREAD, next: A.DELAY, done: false };
        this.strikes.push(s);
        Events.emit("artyCalled", { strike: s, v });
        return { ok: true };
    }

    updateStrikes(dt) {
        for (const s of this.strikes) {
            s.t += dt;
            while (s.n < s.total && s.t >= s.next) {
                s.n++;
                s.next += rnd(0.22, 0.5);
                const a = rnd(0, TAU), r = Math.sqrt(Math.random()) * s.r;
                const px = s.x + Math.cos(a) * r, pz = s.z + Math.sin(a) * r;
                const dx = rnd(-0.06, 0.06), dz = rnd(-0.06, 0.06);
                const L = Math.hypot(dx, 1, dz);
                const shot = new Shot(s.by, s.def, [px - dx * 70, 70, pz - dz * 70], [dx / L, -1 / L, dz / L]);
                shot.ignore = null;
                shot.arty = true;
                this.shots.push(shot);
                Events.emit("artyShell", { x: px, z: pz, strike: s });
            }
            if (s.n >= s.total && s.t > s.next + 1.5) s.done = true;
        }
        if (this.strikes.length && this.strikes.some((s) => s.done)) this.strikes = this.strikes.filter((s) => !s.done);
    }

    /* ─────────── Засвет ─────────── */
    updateSpotting() {
        const C = Config.SPOT;
        const now = this.time;
        const wk = this.weather.spotK;
        for (const v of this.vehicles) {
            if (v.dead) continue;
            v.concealed = this.world.concealment(v.x, v.z, v.def.dims.W / 2);
        }
        for (const e of this.vehicles) {
            if (e.dead) { e.visible = [true, true]; continue; }
            e.visible[e.team] = true;
            const t = 1 - e.team;
            if (e.static) { e.visible[t] = true; continue; }
            let seen = false;
            const fired = now - e.lastShot < C.FIRED_REVEAL;
            for (const o of this.vehicles) {
                if (o.dead || o.team !== t) continue;
                const d = Math.hypot(o.x - e.x, o.z - e.z);
                if (d < C.PROXIMITY) { seen = true; break; }
                let R = C.RANGE * wk * (o.hasSeat("commander") && !o.seatOk("commander") ? 0.8 : 1);
                if (fired) R = 380 * Math.max(0.6, wk);
                else if (e.concealed > 0.3) {
                    const moving = Math.abs(e.v) > 1.2;
                    R = Math.min(R, (moving ? C.BUSH_MOVING : C.BUSH_STILL) * (1.25 - e.concealed * 0.45));
                }
                if (d < R && this.world.los(o.x, o.z, e.x, e.z)) { seen = true; break; }
            }
            if (seen) e.spotT[t] = now + C.MEMORY;
            e.visible[t] = now < e.spotT[t];
        }
    }

    /* ─────────── Начисления ─────────── */
    award(kind, mult = 1) {
        const sp = Config.SP[kind] || 0, rp = Config.RP[kind] || 0;
        this.sp += Math.round(sp * mult);
        this.stats.rp += Math.round(rp * mult);
    }

    creditDamage(shooter, target, res) {
        if (!shooter || shooter.team === target.team) return;
        if (!res.dmg.length) return;
        shooter.stats.dmg += res.dmg.length;
        if (res.crit) shooter.stats.crits++;
        if (shooter === this.player) {
            this.stats.dmgDone += res.dmg.length;
            if (res.crit) { this.stats.crits++; this.award("CRIT", 0.5 + target.def.rank * 0.5); }
            else this.award("HIT");
        }
    }

    onShellHit(shot, v, res, wp) {
        const sh = shot.owner;
        if (sh && sh.team !== v.team) {
            sh.stats.hits++;
            if (res.kind === "pen" || res.kind === "he-pen") sh.stats.pens++;
            if (sh === this.player) {
                this.stats.hits++;
                if (res.kind === "pen" || res.kind === "he-pen") this.stats.pens++;
            }
            this.creditDamage(sh, v, res);
        }
        Events.emit("hit", { shooter: sh, target: v, res, shell: shot.def, world: wp, dir: shot.d });
    }

    destroyVehicle(v, cause, killer) {
        if (v.dead) return;
        v.kill(cause);
        v.deathT = this.time;
        v.killer = killer || null;
        this.world.addWreck(v);
        if (killer && killer !== v && killer.team !== v.team) {
            killer.stats.kills++;
            if (killer === this.player) {
                this.stats.kills++;
                (this.vstats[killer.def.id] = this.vstats[killer.def.id] || { spawns: 0, kills: 0 }).kills++;
                this.award("KILL", 0.6 + v.def.rank * 0.4);
            }
        }
        // помощь
        for (const [id, t] of v.damagers) {
            if (killer && id === killer.id) continue;
            if (this.time - t > 30) continue;
            const a = this.vehicles.find((o) => o.id === id);
            if (!a || a.team === v.team) continue;
            a.stats.assists++;
            if (a === this.player) { this.stats.assists++; this.award("ASSIST"); }
        }
        if (v === this.player) { this.stats.deaths++; this.deathAt = this.time; }
        Events.emit("destroyed", { v, cause, killer });
        this.modeCtl.onDestroyed(v, killer);
    }

    end(winner, reason) {
        if (this.ended) return;
        this.ended = true;
        this.endT = 0;
        const win = winner === this.playerTeam;
        if (win) this.stats.rp = Math.round(this.stats.rp * Config.RP.WIN_MULT);
        this.result = { win, winner, reason, stats: { ...this.stats }, mode: this.mode };
        Events.emit("battleEnd", this.result);
    }
}
