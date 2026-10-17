import { Config } from "../core/Config.js";
import { Events } from "../core/Events.js";
import { DEG, clamp, uid, rnd } from "../core/Utils.js";
import { SHELLS } from "../data/Shells.js";

/** Состояние модуля: 0 — исправен, 1 — повреждён, 2 — критически, 3 — уничтожен */
export function modState(m) {
    if (!m) return 0;
    if (m.hp <= 0) return 3;
    const f = m.hp / m.maxHp;
    return f >= Config.MOD_DMG ? 0 : f >= Config.MOD_CRIT ? 1 : 2;
}

const SPEED_F = [1, 0.78, 0.5, 0];
const TRANS_F = [1, 0.88, 0.62, 0];
const DRIVE_F = [1, 0.7, 0.45, 0.12];
const RACK_RELOAD = [1, 1.22, 1.5, 1.8];
const BREECH_RELOAD = [1, 1.12, 1.32, 1];
const BARREL_DISP = [1, 1.25, 1.65, 1];

export class Vehicle {
    constructor(def, team, x, z, a, opts = {}) {
        this.def = def;
        this.id = uid();
        this.team = team;
        this.isPlayer = !!opts.isPlayer;
        this.name = opts.name || def.name;
        this.static = !!opts.static;

        this.x = x; this.z = z; this.a = a;
        this.v = 0;          // скорость вдоль корпуса, м/с
        this.w = 0;          // фактическая угловая скорость корпуса
        this.tr = 0;         // относительный угол башни (или орудия в рубке)
        this.trRate = 0;
        this.aimPoint = null;
        this.input = { throttle: 0, steer: 0 };
        this.bloom = 1.4;
        this.trackPhase = [0, 0];

        this.mods = {};
        for (const m of def.modules) this.mods[m.id] = { id: m.id, type: m.type, def: m, hp: m.maxHp, maxHp: m.maxHp };

        this.crew = [];
        this.seats = {};
        for (const s of def.crew) {
            const member = { home: s, seat: s, hp: Config.CREW.HP, maxHp: Config.CREW.HP, alive: true, transit: false };
            this.crew.push(member);
            this.seats[s] = { name: s, occupant: member, def: def.seats[s] };
        }
        this.swap = null;

        this.ammo = {};
        for (const [sid, n] of def.shells) this.ammo[sid] = n;
        this.racksLost = {};
        this.shell = def.shellIds[0];
        this.loaded = this.shell;
        this.mag = Math.min(def.gun.mag, this.ammo[this.shell]);
        this.reload = 0;
        this.reloadTotal = 1;

        this.fire = null;
        this.ext = 2;
        this.medkits = 1;
        this.repair = null;

        this.dead = false;
        this.deathCause = null;
        this.deathT = 0;
        this.lastShot = -99;
        this.spotT = [0, 0];       // до какого времени машину видит команда i
        this.visible = [false, false];
        this.concealed = 0;
        this.damagers = new Map(); // id стрелка -> время
        this.stats = { kills: 0, assists: 0, hits: 0, pens: 0, crits: 0, caps: 0, dmg: 0 };
        this.brain = null;
        this.spawnT = 0;
    }

    /* ─────────── Экипаж ─────────── */
    seatOk(name) {
        const s = this.seats[name];
        return !!(s && s.occupant && s.occupant.alive && !s.occupant.transit);
    }
    seatHp(name) {
        const s = this.seats[name];
        return s && s.occupant ? s.occupant.hp / s.occupant.maxHp : 0;
    }
    /** Эффективность члена экипажа: 0 — отсутствует, 0.5..1 — ранен..здоров */
    crewEff(name) {
        if (!this.seatOk(name)) return 0;
        return 0.5 + 0.5 * this.seatHp(name);
    }
    aliveCrew() { return this.crew.reduce((n, c) => n + (c.alive ? 1 : 0), 0); }
    hasSeat(name) { return !!this.seats[name]; }

    /* ─────────── Подвижность ─────────── */
    st(id) { return modState(this.mods[id]); }

    tracksOk() { return this.mods.trackL.hp > 0 && this.mods.trackR.hp > 0; }

    canDrive() {
        return !this.dead && !this.static && !this.repair && this.seatOk("driver") &&
            this.mods.engine.hp > 0 && this.mods.transmission.hp > 0 && this.tracksOk();
    }

    maxSpeed() {
        if (!this.canDrive()) return 0;
        let f = SPEED_F[this.st("engine")] * TRANS_F[this.st("transmission")];
        if (this.fire) f *= 0.85;
        return (this.def.mob.speed / 3.6) * f;
    }
    maxReverse() {
        if (!this.canDrive()) return 0;
        const f = SPEED_F[this.st("engine")] * (this.st("transmission") >= 2 ? 0.4 : 1);
        return (this.def.mob.reverse / 3.6) * f;
    }
    accel() {
        const pw = this.def.mob.pw;
        return clamp(0.8 + pw * 0.085, 1.3, 4.2) * SPEED_F[this.st("engine")] * (0.6 + 0.4 * this.crewEff("driver"));
    }
    /** Скорость поворота корпуса: ранение мехвода замедляет поворот */
    turnRate() {
        if (!this.canDrive()) return 0;
        const drv = this.crewEff("driver");
        return this.def.mob.hull * 1.15 * DEG * drv * [1, 0.9, 0.7, 0][this.st("transmission")] * (this.st("engine") >= 2 ? 0.75 : 1);
    }
    /** Скорость наводки башни / орудия в рубке */
    turretRate() {
        if (this.dead) return 0;
        if (!this.seatOk("gunner")) return 0;
        let f = 0.6 + 0.4 * this.seatHp("gunner");
        if (this.mods.drive) f *= DRIVE_F[this.st("drive")];
        if (this.hasSeat("commander") && !this.seatOk("commander")) f *= 0.9;
        return this.def.mob.turret * 1.5 * DEG * f;
    }

    /* ─────────── Орудие ─────────── */
    turretRel() { return this.def.turret.casemate ? 0 : this.tr; }
    gunRel() { return this.def.turret.casemate ? this.tr : 0; }
    gunYaw() { return this.a + this.tr; }

    /** Время перезарядки: растёт при ранении/гибели заряжающего и повреждении боеукладки */
    reloadTime(sid) {
        const g = this.def.gun;
        let m = 1;
        if (this.hasSeat("loader")) {
            if (this.seatOk("loader")) m *= 1 + 0.6 * (1 - this.seatHp("loader"));
            else if (this.seatOk("loader2")) m *= 1.3;
            else m *= 2.0;
            if (this.hasSeat("loader2") && this.seatOk("loader") && !this.seatOk("loader2")) m *= 1.15;
        } else if (this.seatOk("gunner")) {
            m *= 1 + 0.5 * (1 - this.seatHp("gunner"));
        }
        let worst = 0;
        for (const id of this.def.rackOrder) worst = Math.max(worst, this.st(id));
        m *= RACK_RELOAD[worst];
        m *= BREECH_RELOAD[this.st("breech")];
        const base = g.reload * (sid && SHELLS[sid].type === "APCR" ? 1.0 : 1);
        return base * m;
    }
    reloadBreakdown() {
        const out = [];
        if (this.hasSeat("loader")) {
            if (!this.seatOk("loader")) out.push(this.seatOk("loader2") ? "заряжает второй заряжающий" : "заряжает другой член экипажа");
            else if (this.seatHp("loader") < 0.999) out.push("заряжающий ранен");
        }
        let worst = 0;
        for (const id of this.def.rackOrder) worst = Math.max(worst, this.st(id));
        if (worst > 0) out.push(["", "БК повреждена", "БК — крит.", "стеллаж БК уничтожен"][worst]);
        if (this.st("breech") > 0 && this.st("breech") < 3) out.push("казённик повреждён");
        return out;
    }

    dispersion() {
        let d = (this.def.gun.disp / 1000) * this.bloom;
        if (this.seatOk("gunner")) d *= 1 + 0.7 * (1 - this.seatHp("gunner"));
        d *= BARREL_DISP[this.st("barrel")];
        if (this.hasSeat("commander") && !this.seatOk("commander")) d *= 1.1;
        return d;
    }

    gunBroken() { return this.mods.breech.hp <= 0 || this.mods.barrel.hp <= 0; }

    canFire() {
        return !this.dead && this.seatOk("gunner") && !this.gunBroken() && !!this.loaded && this.reload <= 0;
    }

    totalAmmo() { let n = 0; for (const k in this.ammo) n += this.ammo[k]; return n; }

    /** Выбор снаряда (игрок / ИИ) */
    selectShell(sid) {
        if (!this.ammo[sid] && this.ammo[sid] !== 0) return false;
        if (sid === this.shell) return false;
        this.shell = sid;
        const g = this.def.gun;
        if (g.mag > 1) {
            // смена магазина
            this.loaded = null;
            this.mag = 0;
            this.reloadTotal = this.reloadTime(sid);
            this.reload = Math.max(this.reload, this.reloadTotal * 0.6);
        } else if (this.loaded && this.loaded !== sid) {
            if (this.reload <= 0) {
                this.loaded = null;
                this.reloadTotal = this.reloadTime(sid) * 0.5;
                this.reload = this.reloadTotal;
            }
        }
        return true;
    }

    /** Расход выстрела. Возвращает id снаряда или null */
    consumeShot() {
        const sid = this.loaded;
        if (!sid || !this.ammo[sid]) { this.loaded = null; return null; }
        this.ammo[sid]--;
        const g = this.def.gun;
        if (g.mag > 1) {
            this.mag--;
            if (this.mag > 0 && this.ammo[sid] > 0) {
                this.reload = g.rof;
                this.reloadTotal = g.rof;
            } else {
                this.loaded = null;
                this.mag = 0;
                this.reloadTotal = this.reloadTime(this.shell);
                this.reload = this.reloadTotal;
            }
        } else {
            this.loaded = null;
            this.reloadTotal = this.reloadTime(this.shell);
            this.reload = this.reloadTotal;
        }
        return sid;
    }

    /** Заполнение стеллажей: расходуются в порядке def.rackOrder */
    rackFills() {
        const order = this.def.rackOrder;
        let left = this.totalAmmo();
        const fills = {};
        for (let i = order.length - 1; i >= 0; i--) {
            const id = order[i];
            const m = this.mods[id];
            if (this.racksLost[id]) { fills[id] = 0; continue; }
            const f = Math.min(m.def.cap, left);
            fills[id] = f;
            left -= f;
        }
        return fills;
    }

    /** Боекомплект из уничтоженного стеллажа теряется */
    loseRack(id) {
        const fills = this.rackFills();
        const lost = fills[id] || 0;
        this.racksLost[id] = true;
        if (lost <= 0) return 0;
        const total = this.totalAmmo();
        let toRemove = lost;
        for (const k in this.ammo) {
            const take = Math.min(this.ammo[k], Math.round((this.ammo[k] / total) * lost));
            this.ammo[k] -= take;
            toRemove -= take;
        }
        for (const k in this.ammo) {
            if (toRemove <= 0) break;
            const take = Math.min(this.ammo[k], toRemove);
            this.ammo[k] -= take;
            toRemove -= take;
        }
        return lost;
    }

    resupply(frac) {
        let added = 0;
        for (const [sid, n] of this.def.shells) {
            const add = Math.min(n - this.ammo[sid], Math.ceil(n * frac));
            if (add > 0) { this.ammo[sid] += add; added += add; }
        }
        if (added) this.racksLost = {};
        return added;
    }

    /* ─────────── Обновление внутренних систем ─────────── */
    update(dt, now) {
        if (this.dead) return;
        this.updateReload(dt);
        this.updateCrewSwap(dt);
        this.updateRepair(dt);
        this.updateBloom(dt);
    }

    updateReload(dt) {
        if (this.reload > 0) {
            // без наводчика и заряжающего перезарядка не идёт; без орудия — тоже
            if (this.gunBroken()) return;
            if (!this.hasSeat("loader") && !this.seatOk("gunner")) return;
            this.reload -= dt;
            if (this.reload <= 0) {
                this.reload = 0;
                const g = this.def.gun;
                if (!this.loaded) {
                    let sid = this.shell;
                    if (!this.ammo[sid]) sid = this.def.shellIds.find((s) => this.ammo[s] > 0);
                    if (sid) {
                        this.loaded = sid;
                        if (g.mag > 1) this.mag = Math.min(g.mag, this.ammo[sid]);
                        Events.emit("reloaded", { v: this });
                    }
                }
            }
        } else if (!this.loaded) {
            // боекомплект пополнили или поменяли тип — начинаем перезарядку
            const sid = this.ammo[this.shell] ? this.shell : this.def.shellIds.find((s) => this.ammo[s] > 0);
            if (sid) {
                this.shell = sid;
                this.reloadTotal = this.reloadTime(sid);
                this.reload = this.reloadTotal;
            }
        }
    }

    /** Автоматическая пересадка экипажа на ключевые места */
    updateCrewSwap(dt) {
        if (this.swap) {
            const sw = this.swap;
            if (!sw.member.alive) { this.swap = null; return; }
            sw.t += dt;
            if (sw.t >= sw.dur) {
                const target = this.seats[sw.to];
                sw.member.transit = false;
                sw.member.seat = sw.to;
                target.occupant = sw.member;
                this.swap = null;
                Events.emit("crewSwapDone", { v: this, member: sw.member, to: sw.to });
            }
            return;
        }
        if (this.aliveCrew() < Config.CREW.MIN_ALIVE) return;
        for (const need of ["gunner", "driver", "loader", "commander"]) {
            const s = this.seats[need];
            if (!s) continue;
            if (s.occupant && s.occupant.alive) continue;
            const critical = need === "gunner" || need === "driver";
            const donors = critical ? ["radio", "loader2", "commander", "loader"] : ["radio", "loader2"];
            for (const dn of donors) {
                if (dn === need) continue;
                const ds = this.seats[dn];
                if (!ds || !ds.occupant || !ds.occupant.alive || ds.occupant.transit) continue;
                // если заряжающий единственный — берём его только на место наводчика
                if (dn === "loader" && need !== "gunner") continue;
                const member = ds.occupant;
                ds.occupant = null;
                member.transit = true;
                const cross = ds.def.frame !== s.def.frame;
                const dur = cross ? Config.CREW.SWAP_CROSS : Config.CREW.SWAP_HULL;
                this.swap = { member, from: dn, to: need, t: 0, dur };
                Events.emit("crewSwap", { v: this, member, from: dn, to: need, dur });
                return;
            }
        }
    }

    repairList() {
        const out = [];
        for (const id in this.mods) {
            const m = this.mods[id];
            if (m.hp < m.maxHp * Config.REPAIR.RESTORE_TO - 0.01) out.push(m);
        }
        return out;
    }

    startRepair() {
        if (this.dead || this.repair) return false;
        const list = this.repairList();
        if (!list.length) return false;
        let crit = 0, dmg = 0;
        for (const m of list) (modState(m) >= 2 ? crit++ : dmg++);
        const missing = this.crew.length - this.aliveCrew();
        const dur = (Config.REPAIR.BASE + crit * Config.REPAIR.PER_CRIT + dmg * Config.REPAIR.PER_DMG) * (1 + 0.22 * missing);
        this.repair = { t: 0, dur };
        this.v *= 0.3;
        Events.emit("repairStart", { v: this, dur });
        return true;
    }
    cancelRepair() {
        if (!this.repair) return;
        this.repair = null;
        Events.emit("repairCancel", { v: this });
    }
    updateRepair(dt) {
        if (!this.repair) return;
        this.repair.t += dt;
        if (this.repair.t >= this.repair.dur) {
            for (const m of this.repairList()) {
                m.hp = m.maxHp * (m.type === "track" ? 0.6 : Config.REPAIR.RESTORE_TO);
                if (m.type === "ammo") delete this.racksLost[m.id];
            }
            this.repair = null;
            Events.emit("repairDone", { v: this });
        }
    }

    useExtinguisher() {
        if (!this.fire || this.ext <= 0 || this.dead) return false;
        this.ext--;
        this.fire = null;
        Events.emit("fireOut", { v: this, ext: true });
        return true;
    }

    useMedkit() {
        if (this.medkits <= 0 || this.dead) return false;
        let healed = 0;
        for (const c of this.crew) {
            if (c.alive && c.hp < c.maxHp) { c.hp = Math.min(c.maxHp, c.hp + 55); healed++; }
        }
        if (!healed) return false;
        this.medkits--;
        Events.emit("medkit", { v: this, healed });
        return true;
    }

    /** Разброс растёт от движения, поворота корпуса и башни, после выстрела; сводится со временем */
    updateBloom(dt) {
        const vmax = this.def.mob.speed / 3.6;
        const wmax = this.def.mob.hull * DEG;
        const tmax = this.def.mob.turret * 1.5 * DEG;
        const target = 1 + 3.0 * Math.min(1, Math.abs(this.v) / vmax) + 1.8 * Math.min(1, Math.abs(this.w) / wmax) +
            1.3 * Math.min(1, Math.abs(this.trRate) / tmax);
        if (target > this.bloom) this.bloom += (target - this.bloom) * Math.min(1, dt * 7);
        else {
            const aim = this.def.gun.aim / (0.55 + 0.45 * Math.max(0.2, this.crewEff("gunner")));
            this.bloom += (target - this.bloom) * Math.min(1, dt * (2.4 / aim));
        }
    }

    /** Окончательное уничтожение (событие генерирует Damage) */
    kill(cause) {
        if (this.dead) return;
        this.dead = true;
        this.deathCause = cause;
        this.fire = null;
        this.repair = null;
        this.swap = null;
        this.v = 0;
        this.w = 0;
    }

    /** Полное восстановление (между волнами / на точке) */
    /** Возвращает в строй одного выбывшего члена экипажа (пополнение на точке / между волнами) */
    restoreCrewOne() {
        if (this.swap || this.dead) return null;
        const seated = (c) => Object.values(this.seats).some((q) => q.occupant === c);
        for (const s of this.def.crew) {
            const seat = this.seats[s];
            if (seat.occupant && seat.occupant.alive) continue;
            const member = { home: s, seat: s, hp: Config.CREW.HP, maxHp: Config.CREW.HP, alive: true, transit: false };
            let idx = seat.occupant ? this.crew.indexOf(seat.occupant) : -1;
            if (idx < 0) idx = this.crew.findIndex((c) => !c.alive && !seated(c));
            if (idx >= 0) this.crew[idx] = member; else this.crew.push(member);
            seat.occupant = member;
            return s;
        }
        return null;
    }

    fieldRepairFull() {
        for (const id in this.mods) this.mods[id].hp = this.mods[id].maxHp;
        if (this.swap) { this.swap.t = this.swap.dur; this.updateCrewSwap(0); }
        while (this.restoreCrewOne());
        for (const c of this.crew) if (c.alive) c.hp = c.maxHp;
        this.crew = this.crew.filter((c) => c.alive);
        this.fire = null;
        this.repair = null;
        this.resupply(1);
        this.ext = Math.max(this.ext, 2);
        this.medkits = Math.max(this.medkits, 1);
    }

    speedKmh() { return Math.abs(this.v) * 3.6; }
}

export function randomCrewName() {
    return ["Иванов", "Петров", "Смирнов", "Кузнецов", "Попов", "Соколов"][Math.floor(rnd(6))];
}
