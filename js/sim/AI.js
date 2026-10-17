import { rnd, clamp, angDiff } from "../core/Utils.js";
import { Config } from "../core/Config.js";
import { SHELLS } from "../data/Shells.js";
import { hullToWorld, muzzleWorld, traceShot, gunPivotWorld } from "./Armor.js";

const ENGAGE = { light: 95, medium: 150, heavy: 175, td: 235 };

export class Brain {
    constructor(v, battle, skill) {
        this.v = v;
        this.b = battle;
        this.skill = skill;
        this.target = null;
        this.aimLocal = null;
        this.err = [0, 0, 0];
        this.errT = 0;
        this.react = 0;
        this.path = null;
        this.pathI = 0;
        this.pathT = -99;
        this.goal = null;
        this.goalKey = "";
        this.stuckT = 0;
        this.reverseT = 0;
        this.revSteer = 1;
        this.think = rnd(0.4);
        this.scootT = 0;
        this.scootDir = rnd() < 0.5 ? -1 : 1;
        this.fireExtT = -1;
        this.angleSide = rnd() < 0.5 ? -1 : 1;
        this.flankSide = rnd() < 0.5 ? -1 : 1;
        this.los = false;
        this.dist = 999;
        this.lastSeen = null;
    }

    update(dt) {
        const v = this.v;
        if (v.dead || v.static) return;
        this.think -= dt;
        if (this.think <= 0) {
            this.think = 0.3 + rnd(0.15);
            this.decide();
        }
        this.control(dt);
    }

    /* ─────────── Решения (несколько раз в секунду) ─────────── */
    decide() {
        const v = this.v, b = this.b, now = b.time;
        // пожар
        if (v.fire && v.ext > 0) {
            if (this.fireExtT < 0) this.fireExtT = now + rnd(1.0, 3.2) * (1.3 - this.skill * 0.5);
            else if (now > this.fireExtT) { v.useExtinguisher(); this.fireExtT = -1; }
        } else this.fireExtT = -1;
        // ремонт
        if (!v.repair) {
            const immobile = !v.tracksOk() || v.mods.engine.hp <= 0 || v.mods.transmission.hp <= 0;
            const gunDown = v.gunBroken() || (v.mods.drive && v.st("drive") >= 3);
            if (immobile || gunDown || (!this.target && v.repairList().length >= 2)) v.startRepair();
        }
        if (v.medkits > 0 && v.crew.filter((c) => c.alive && c.hp < 60).length >= 2) v.useMedkit();

        // выбор цели
        let best = null, bestS = Infinity;
        for (const e of b.vehicles) {
            if (e.dead || e.team === v.team || !e.visible[v.team]) continue;
            const d = Math.hypot(e.x - v.x, e.z - v.z);
            if (d > 340) continue;
            const los = b.world.los(v.x, v.z, e.x, e.z);
            let s = d / 100 + (los ? 0 : 2.5);
            if (e === this.target) s -= 0.7;
            if (e.isPlayer) s -= 0.25;
            if (e.def.role === "td" || e.def.role === "heavy") s -= 0.15;
            if (s < bestS) { bestS = s; best = e; }
        }
        if (best !== this.target) {
            this.target = best;
            if (best) {
                this.react = now + (0.95 - this.skill * 0.6) + rnd(0.35);
                this.chooseAim();
            }
        } else if (best && now - this.aimT > 4) this.chooseAim();
        if (this.target) {
            const t = this.target;
            this.dist = Math.hypot(t.x - v.x, t.z - v.z);
            this.los = b.world.los(v.x, v.z, t.x, t.z);
            if (this.los) this.lastSeen = { x: t.x, z: t.z, t: now };
            this.chooseShell();
            // артудар по малоподвижной цели
            if (b.mode !== "range" && this.dist > 55 && this.dist < Config.ARTY.RANGE && Math.abs(t.v) < 1.5 &&
                b.artyLeft(v) <= 0 && Math.random() < 0.05 * this.skill) {
                b.callArtillery(v, t.x + rnd(-4, 4), t.z + rnd(-4, 4));
            }
        }

        // цель движения от режима
        const g = b.modeCtl.goalFor(v, this);
        const key = g ? Math.round(g.x / 8) + ":" + Math.round(g.z / 8) : "";
        if (g && (key !== this.goalKey || now - this.pathT > 7 || !this.path)) {
            this.goal = g;
            this.goalKey = key;
            this.replan();
        } else if (!g) { this.goal = null; this.path = null; }
    }

    replan() {
        const v = this.v, g = this.goal;
        if (!g) return;
        this.pathT = this.b.time;
        this.path = this.b.world.findPath(v.x, v.z, g.x, g.z);
        this.pathI = 0;
    }

    /** Точка прицеливания: оцениваем пробитие по нескольким точкам цели */
    chooseAim() {
        const v = this.v, t = this.target;
        if (!t) return;
        this.aimT = this.b.time;
        const d = t.def, T = d.turret;
        const cands = [
            [0, d.dims.H * 0.62, 0],
            [T.x, d.dims.H + T.h * 0.5, 0],
            [d.dims.L * 0.18, d.dims.H * 0.5, 0],
            [-d.dims.L * 0.22, d.dims.H * 0.62, 0],
            [d.dims.L * 0.3, d.dims.H * 0.42, 0],
        ];
        const shell = SHELLS[v.shell];
        const m = muzzleWorld(v);
        let best = cands[0], bestS = -Infinity;
        for (const c of cands) {
            const w = hullToWorld(t, c);
            const dx = w[0] - m[0], dy = w[1] - m[1], dz = w[2] - m[2];
            const L = Math.hypot(dx, dy, dz) || 1;
            const dir = [dx / L, dy / L, dz / L];
            const tr = traceShot(shell, t, m, dir, L + 8, L);
            let s = -50;
            if (tr.main) {
                const ev = tr.main.ev;
                s = (tr.pen - ev.eff) - ev.ricoP * 60;
                if (shell.type === "HE") s = tr.main.hit.id === "barrel" ? 5 : (tr.pen - ev.eff) * 2;
            }
            s += rnd(0, 30) * (1.1 - this.skill);
            if (s > bestS) { bestS = s; best = c; }
        }
        this.aimLocal = best;
    }

    chooseShell() {
        const v = this.v, t = this.target;
        if (!t) return;
        const ids = v.def.shellIds.filter((s) => v.ammo[s] > 0);
        if (!ids.length) return;
        const thin = Math.max(t.def.armor.hull.side[0], t.def.armor.turret.side[0]) <= 20 || t.def.turret.open;
        let pick = ids.find((s) => SHELLS[s].type !== "HE") || ids[0];
        if (thin) pick = ids.find((s) => SHELLS[s].type === "HE") || pick;
        // против тяжёлых — подкалиберный, если хватает
        if (!thin && (t.def.role === "heavy" || t.def.armor.hull.front[0] >= 80) && this.dist < 160 && this.skill > 0.45) {
            const apcr = ids.find((s) => SHELLS[s].type === "APCR" && v.ammo[s] > 1);
            if (apcr) pick = apcr;
        }
        if (v.def.gun.cal >= 122 && ids.some((s) => SHELLS[s].type === "HE")) {
            // крупный калибр: фугас эффективен почти всегда
            if (this.skill < 0.75 || t.def.armor.hull.front[0] > 120) pick = ids.find((s) => SHELLS[s].type === "HE");
        }
        if (pick !== v.shell && (v.reload > v.reloadTotal * 0.35 || !v.loaded)) v.selectShell(pick);
    }

    /* ─────────── Управление (каждый кадр) ─────────── */
    control(dt) {
        const v = this.v, b = this.b, t = this.target;
        const now = b.time;
        // ошибка прицеливания
        this.errT -= dt;
        if (this.errT <= 0) {
            this.errT = rnd(0.8, 1.8);
            const k = (1.05 - this.skill) * 1.3 * Math.max(0.4, this.dist / 120);
            this.err = [rnd(-k, k), rnd(-k, k) * 0.35, rnd(-k, k)];
        }
        // наведение
        if (t && !t.dead) {
            const w = hullToWorld(t, this.aimLocal || [0, 1, 0]);
            const tof = this.dist / (SHELLS[v.shell].vel * 0.5);
            const lead = this.skill * tof;
            v.aimPoint = [
                w[0] + Math.cos(t.a) * t.v * lead + this.err[0],
                w[1] + this.err[1],
                w[2] + Math.sin(t.a) * t.v * lead + this.err[2],
            ];
        } else {
            const ahead = this.goal && this.path ? this.path[Math.min(this.pathI, this.path.length - 1)] : null;
            const ls = this.lastSeen && now - this.lastSeen.t < 12 ? this.lastSeen : null;
            const fx = ls ? ls.x : ahead ? ahead[0] : v.x + Math.cos(v.a) * 40;
            const fz = ls ? ls.z : ahead ? ahead[1] : v.z + Math.sin(v.a) * 40;
            v.aimPoint = [fx, 1.2, fz];
        }

        // движение
        const inp = v.input;
        inp.throttle = 0;
        inp.steer = 0;
        if (v.repair || !v.canDrive()) { this.tryFire(); return; }

        // уход из-под артиллерийского огня
        for (const s of b.strikes) {
            const d = Math.hypot(v.x - s.x, v.z - s.z);
            if (d < s.r + 7 && s.n < s.total) {
                const ax = v.x + (v.x - s.x) / (d || 1) * 40, az = v.z + (v.z - s.z) / (d || 1) * 40;
                this.driveTo(ax, az, 0, 1);
                this.tryFire();
                return;
            }
        }

        if (this.reverseT > 0) {
            this.reverseT -= dt;
            inp.throttle = -1;
            inp.steer = this.revSteer;
            this.tryFire();
            return;
        }
        // объезд после повторного застревания
        if (this.detour) {
            if (now < this.detour.t && Math.hypot(this.detour.x - v.x, this.detour.z - v.z) > 4) {
                this.driveTo(this.detour.x, this.detour.z, 3, 0.8);
                this.tryFire();
                return;
            }
            this.detour = null;
            this.pathT = -99;
        }

        const role = v.def.role;
        const engage = t && this.los && this.dist < ENGAGE[role] * (0.85 + this.skill * 0.3);
        let moved = false;
        if (engage) {
            const bearing = Math.atan2(t.z - v.z, t.x - v.x);
            if (role === "light") {
                // обход с фланга
                const side = t.a + this.flankSide * Math.PI / 2;
                const fx = t.x + Math.cos(side) * 60, fz = t.z + Math.sin(side) * 60;
                if (Math.hypot(fx - v.x, fz - v.z) < 14) this.flankSide = -this.flankSide;
                this.driveTo(fx, fz, 6, 1);
                moved = true;
            } else if (role === "medium") {
                if (this.scootT > 0) {
                    this.scootT -= dt;
                    const a = bearing + this.scootDir * 1.4;
                    this.steerToHeading(a, 0.8);
                    moved = true;
                } else if (this.dist > ENGAGE.medium * 0.8) {
                    this.driveTo(t.x, t.z, 20, 0.8);
                    moved = true;
                } else this.steerToHeading(bearing + this.angleSide * 0.35, 0);
            } else if (role === "heavy") {
                if (this.dist > ENGAGE.heavy * 0.9) { this.driveTo(t.x, t.z, 30, 0.7); moved = true; }
                else this.steerToHeading(bearing + this.angleSide * 0.5, 0);
            } else {
                // ПТ: корпус на цель, стоим
                this.steerToHeading(bearing, 0);
            }
        }
        if (!engage || (!moved && !t)) {
            if (this.path && this.path.length) {
                const wp = this.path[this.pathI];
                const last = this.pathI >= this.path.length - 1;
                const arrive = last ? (this.goal ? this.goal.r : 6) : 7;
                if (Math.hypot(wp[0] - v.x, wp[1] - v.z) < arrive) {
                    if (!last) this.pathI++;
                    else if (this.goal && this.goal.wander) {
                        this.goal = { ...this.goal, x: this.goal.cx + rnd(-this.goal.wander, this.goal.wander), z: this.goal.cz + rnd(-this.goal.wander, this.goal.wander) };
                        this.path = [[this.goal.x, this.goal.z]];
                        this.pathI = 0;
                    }
                } else {
                    // если цель видна, но далеко — едем медленнее, чтобы не терять сведение
                    this.driveTo(wp[0], wp[1], 0, t && this.los ? 0.65 : 1);
                }
            }
        }

        // застревание
        const wantMove = Math.abs(inp.throttle) > 0.3;
        if (wantMove && Math.abs(v.v) < 0.6) this.stuckT += dt; else this.stuckT = Math.max(0, this.stuckT - dt * 2);
        if (this.stuckT > 1.6) {
            this.stuckT = 0;
            this.stuckN = now - (this.lastStuck || -99) < 14 ? (this.stuckN || 0) + 1 : 1;
            this.lastStuck = now;
            this.reverseT = rnd(1.0, 1.8);
            this.revSteer = rnd() < 0.5 ? -1 : 1;
            this.pathT = -99;
            if (this.stuckN >= 2) {
                const a = v.a + (rnd() < 0.5 ? 1 : -1) * rnd(1.3, 2.1);
                const [dx, dz] = b.world.nearestFree(v.x + Math.cos(a) * 22, v.z + Math.sin(a) * 22, 16);
                this.detour = { x: dx, z: dz, t: now + this.reverseT + 4 };
            }
        }
        this.tryFire();
    }

    steerToHeading(h, throttle) {
        const v = this.v;
        const d = angDiff(v.a, h);
        v.input.steer = clamp(d * 2.2, -1, 1);
        v.input.throttle = Math.abs(d) > 0.9 ? 0 : throttle;
    }

    driveTo(x, z, stopR, speed) {
        const v = this.v;
        const dx = x - v.x, dz = z - v.z;
        const d = Math.hypot(dx, dz);
        if (d < stopR) { v.input.throttle = 0; return; }
        let h = Math.atan2(dz, dx);
        // уклонение от машин впереди
        const fx = Math.cos(v.a), fz = Math.sin(v.a);
        for (const o of this.b.vehicles) {
            if (o === v) continue;
            const ox = o.x - v.x, oz = o.z - v.z;
            const along = ox * fx + oz * fz;
            if (along < 0 || along > 16) continue;
            const side = -ox * fz + oz * fx;
            const clear = v.def.dims.W / 2 + o.def.bodyRadius + 1.2;
            if (Math.abs(side) < clear) { h += (side > 0 ? -1 : 1) * 0.7; break; }
        }
        const da = angDiff(v.a, h);
        v.input.steer = clamp(da * 2.4, -1, 1);
        const slow = d < 20 ? 0.55 : 1;
        v.input.throttle = Math.abs(da) > 1.0 ? 0.15 : speed * slow * (1 - Math.abs(da) * 0.35);
    }

    tryFire() {
        const v = this.v, b = this.b, t = this.target;
        if (!t || t.dead || !v.canFire() || b.time < this.react || !this.los || !v.aimPoint) return;
        if (this.dist > 330) return;
        // орудие смотрит на цель?
        const piv = gunPivotWorld(v);
        const want = Math.atan2(v.aimPoint[2] - piv[2], v.aimPoint[0] - piv[0]);
        const err = Math.abs(angDiff(v.gunYaw(), want));
        const tol = Math.atan2(t.def.dims.W * 0.45, this.dist);
        if (err > tol) return;
        // ждём сведения (опытные экипажи терпеливее)
        const maxBloom = 1.5 + (1 - this.skill) * 2.2 + (v.def.role === "light" ? 1.5 : 0) + (this.scootT > 0 ? 1 : 0);
        if (v.bloom > maxBloom && b.time - this.react < 6) return;
        // союзники на линии огня
        const m = muzzleWorld(v);
        for (const o of b.vehicles) {
            if (o === v || o.team !== v.team || o.dead) continue;
            const ax = v.aimPoint[0] - m[0], az = v.aimPoint[2] - m[2];
            const L = Math.hypot(ax, az) || 1;
            const ox = o.x - m[0], oz = o.z - m[2];
            const along = (ox * ax + oz * az) / L;
            if (along < 0 || along > L) continue;
            const side = Math.abs(-ox * az + oz * ax) / L;
            if (side < o.def.bodyRadius + 0.8) return;
        }
        if (b.fire(v)) {
            if (v.def.role === "medium") { this.scootT = rnd(1.5, 2.8); this.scootDir = rnd() < 0.5 ? -1 : 1; }
            if (rnd() < 0.3) this.chooseAim();
        }
    }
}

