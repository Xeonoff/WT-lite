/**
 * Комната онлайн-боя: лобби (команды, сетапы, готовность) и авторитетная симуляция боя.
 * Симуляция — тот же код js/sim, что и в одиночной игре; клиенты получают снимки и события.
 */
import { Battle } from "../js/sim/Battle.js";
import { Brain } from "../js/sim/AI.js";
import { Events } from "../js/core/Events.js";
import { getVehicle, vehiclesOf } from "../js/data/VehicleBuild.js";
import { MAPS, MAP_ORDER, WEATHER } from "../js/data/Maps.js";
import { SHELLS } from "../js/data/Shells.js";
import {
    TICK_HZ, SNAP_EVERY, packVehicle, packOwn, packRes, packShot, WORLD_LISTS, rv, rd, r2, cleanName,
} from "../js/net/Protocol.js";

export const NATIONS = ["ussr", "germany"];
const LINEUP_MAX = 4;
const BACK_TO_LOBBY = 12;          // с после конца боя
const INPUT_TIMEOUT = 2.5;         // с без ввода — машина останавливается

/** Комната, в контексте которой сейчас выполняется симуляция: события попадают в её очередь */
let current = null;

const EVENT_NAMES = [
    "spawn", "vehicleRemoved", "playerSpawn", "shot", "hit", "splashDamage", "impact", "explosion", "destroyed",
    "modDestroyed", "crewKO", "crewSwap", "crewSwapDone", "fireStart", "fireOut", "repairStart", "repairDone",
    "repairCancel", "medkit", "reloaded", "resupply", "pointChange", "artyCalled", "artyShell", "worldChange", "battleEnd",
    "bossNote", "bossAim", "pickup",
];
for (const name of EVENT_NAMES) Events.on(name, (e) => { if (current) current.onSimEvent(name, e); });

const idOf = (v) => (v ? v.id : 0);

export class Room {
    constructor(id, host, opts, onEmpty) {
        this.id = id;
        this.name = cleanName(opts.name) || "Комната";
        this.hostId = host.id;
        this.settings = { mode: "domination", map: "random", weather: "random", teamSize: 6 };
        this.pilotsByKey = new Map();     // игрок (по ключу браузера) → пилот текущего боя
        this.applySettings(opts);
        this.members = new Map();     // clientId -> { client, team, lineup, ready, pilot }
        this.state = "lobby";
        this.battle = null;
        this.onEmpty = onEmpty;
        this.chatLog = [];
    }

    applySettings(o) {
        const S = this.settings;
        if (o.map === "random" || MAPS[o.map]) S.map = o.map;
        if (o.weather === "random" || WEATHER[o.weather]) S.weather = o.weather;
        if (o.mode === "domination" || o.mode === "duel" || o.mode === "boss") S.mode = o.mode;
        if (Number.isFinite(+o.teamSize)) S.teamSize = Math.max(2, Math.min(8, Math.round(+o.teamSize)));
        // дуэль — один на один; битва с боссом — teamSize игроков в одной команде
        if (S.mode === "duel") S.teamSize = 1;
        else if (S.teamSize < 2) S.teamSize = S.mode === "boss" ? 4 : 6;
    }

    /** Сетап игрока для нации команды: присланный клиентом (проверенный) или машины I ранга */
    lineupFor(client, team) {
        const nation = NATIONS[team];
        const ids = client.lineups && Array.isArray(client.lineups[nation]) ? client.lineups[nation] : [];
        const ok = [];
        for (const id of ids) {
            const d = typeof id === "string" && getVehicle(id);
            if (d && d.nation === nation && !ok.includes(id) && ok.length < LINEUP_MAX) ok.push(id);
        }
        return ok.length ? ok : defaultLineup(team);
    }

    /* ─────────── Лобби ─────────── */
    summary() {
        return {
            id: this.id, name: this.name, state: this.state, map: this.settings.map, mode: this.settings.mode,
            players: this.members.size, max: this.capacity(),
            host: this.members.get(this.hostId) ? this.members.get(this.hostId).client.name : "",
        };
    }

    view() {
        return {
            id: this.id, name: this.name, host: this.hostId, state: this.state, settings: this.settings,
            members: [...this.members.values()].map((m) => ({ id: m.client.id, name: m.client.name, team: m.team, ready: m.ready, lineup: m.lineup, inBattle: !!m.pilot })),
            chat: this.chatLog.slice(-30),
        };
    }

    broadcast(msg) {
        const s = JSON.stringify(msg);
        for (const m of this.members.values()) m.client.sendRaw(s);
    }

    pushView() { this.broadcast({ t: "room", room: this.view() }); }

    teamCount(team) { let n = 0; for (const m of this.members.values()) if (m.team === team) n++; return n; }

    /** Мест в комнате: в битве с боссом все игроки — одна команда (колонка — только нация сетапа) */
    capacity() { return this.settings.mode === "boss" ? this.settings.teamSize : this.settings.teamSize * 2; }
    /** Пилот в бою: команда и нация (в битве с боссом команда одна, нация — по колонке) */
    pilotOf(m) {
        const boss = this.settings.mode === "boss";
        return { id: m.client.id, name: m.client.name, team: boss ? 0 : m.team, nation: NATIONS[m.team], lineup: m.lineup };
    }

    add(client) {
        if (this.members.size >= this.capacity()) return "комната заполнена";
        let prev = this.state === "battle" ? this.pilotsByKey.get(client.key) : null;
        // тот же игрок уже в комнате (вторая вкладка) — прежнего пилота не отдаём
        if (prev && [...this.members.values()].some((o) => o.pilot === prev || o.oldPilot === prev)) prev = null;
        const team = prev ? Math.max(0, NATIONS.indexOf(prev.nation)) : this.teamCount(0) <= this.teamCount(1) ? 0 : 1;
        const m = { client, team, lineup: this.lineupFor(client, team), ready: false, pilot: null };
        this.members.set(client.id, m);
        client.room = this;
        this.pushView();
        if (this.state === "battle") {
            if (prev) { m.oldPilot = prev; this.rejoin(client); }
            else this.joinBattle(m);
        }
        return null;
    }

    remove(client) {
        const m = this.members.get(client.id);
        if (!m) return;
        this.members.delete(client.id);
        client.room = null;
        if (m.pilot) this.dropPilot(m.pilot);
        if (!this.members.size) { this.stop(); this.onEmpty(this); return; }
        if (this.hostId === client.id) this.hostId = this.members.keys().next().value;
        this.pushView();
    }

    setTeam(client, team) {
        const m = this.members.get(client.id);
        if (!m || this.state !== "lobby" || (team !== 0 && team !== 1)) return;
        if (m.team !== team && this.settings.mode !== "boss" && this.teamCount(team) >= this.settings.teamSize) return;
        if (m.team !== team) m.lineup = this.lineupFor(client, team);
        m.team = team;
        m.ready = false;
        this.pushView();
    }

    setLineup(client, ids) {
        const m = this.members.get(client.id);
        if (!m || !Array.isArray(ids)) return;
        const nation = NATIONS[m.team];
        const ok = [];
        for (const id of ids) {
            const d = typeof id === "string" && getVehicle(id);
            if (d && d.nation === nation && !ok.includes(id) && ok.length < LINEUP_MAX) ok.push(id);
        }
        m.lineup = ok;
        if (!ok.length) m.ready = false;
        this.pushView();
    }

    setReady(client, v) {
        const m = this.members.get(client.id);
        if (!m || this.state !== "lobby") return;
        m.ready = !!v && m.lineup.length > 0;
        this.pushView();
    }

    chat(client, text) {
        const m = this.members.get(client.id);
        text = String(text || "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 160);
        if (!m || !text) return;
        const msg = { from: client.name, team: m.team, text, all: true };
        this.chatLog.push(msg);
        if (this.chatLog.length > 60) this.chatLog.shift();
        this.broadcast({ t: "chat", ...msg });
    }

    /* ─────────── Бой ─────────── */
    start(client) {
        if (client.id !== this.hostId || this.state !== "lobby") return "начать бой может только создатель комнаты";
        const ready = [...this.members.values()].filter((m) => m.lineup.length);
        if (!ready.length) return "ни у кого нет сетапа";
        const S = this.settings;
        const mapId = S.map === "random" ? MAP_ORDER[Math.floor(Math.random() * MAP_ORDER.length)] : S.map;
        const pilots = ready.map((m) => this.pilotOf(m));
        this.run(() => {
            this.battle = new Battle({ mode: S.mode, mapId, seed: 1 + Math.floor(Math.random() * 1e9), weather: S.weather, nations: NATIONS, pilots, teamSize: S.teamSize });
        });
        this.queue = null;
        const b = this.battle;
        this.pilotsByKey = new Map();
        for (const m of this.members.values()) {
            m.pilot = b.pilots.find((P) => P.id === m.client.id) || null;
            if (m.pilot) this.pilotsByKey.set(m.client.key, m.pilot);
        }
        this.state = "battle";
        this.tick = 0;
        this.sentShots = new Set();
        this.worldLog = [];
        for (const m of this.members.values()) {
            m.ready = false;
            m.lastInput = 0;
            if (m.pilot) this.sendStart(m); else this.joinBattle(m);
        }
        this.clockAt = performance.now();
        this.acc = 0;
        this.timer = setInterval(() => this.pump(), 1000 / TICK_HZ / 2);
        this.pushView();
        return null;
    }

    /** Подключение к уже идущему бою */
    joinBattle(m) {
        const b = this.battle;
        if (!m.lineup.length) m.lineup = this.lineupFor(m.client, m.team);
        m.pilot = b.addPilot(this.pilotOf(m));
        this.pilotsByKey.set(m.client.key, m.pilot);
        this.sendStart(m);
    }

    sendStart(m) {
        const b = this.battle, P = m.pilot;
        m.client.send({
            t: "start",
            b: { mode: b.mode, mapId: b.world.mapId || b.opts.mapId, seed: b.seed, weather: b.weatherId, nations: b.teamNation, br: b.lineupBR, teamSize: this.settings.teamSize },
            me: { pid: P.id, name: P.name, team: P.team, nation: P.nation, lineup: P.lineup.map((l) => l.id) },
            full: this.fullState(),
        });
    }

    /** Полное состояние для (пере)подключившегося клиента */
    fullState() {
        const b = this.battle;
        return {
            tm: r2(b.time),
            veh: b.vehicles.map((v) => this.spawnInfo(v)),
            wc: this.worldLog,
            pts: b.modeCtl.points.map((p) => [p.owner, r2(p.prog)]),
        };
    }

    spawnInfo(v) {
        return { id: v.id, def: v.def.id, team: v.team, cs: v.callsign, pid: v.pilot ? v.pilot.id : null, x: r2(v.x), z: r2(v.z), a: r2(v.a), tr: r2(v.tr), dead: v.dead, cause: v.deathCause, st: !!v.static };
    }

    dropPilot(P) {
        P.left = true;
        const v = P.vehicle;
        if (v) v.input.throttle = v.input.steer = 0;
        // машина ушедшего игрока продолжает бой под управлением ИИ
        if (v && !v.dead && this.battle && !this.battle.ended) {
            v.pilot = null;
            v.brain = new Brain(v, this.battle, 0.5);
            v.callsign += " (ИИ)";
        }
    }

    run(fn) {
        const prev = current;
        current = this;
        try { return fn(); } finally { current = prev; }
    }

    /**
     * Время боя идёт вровень с реальным: таймер срабатывает неровно (на Windows шаг ~16 мс,
     * под нагрузкой — реже), поэтому шаги отсчитываются по часам, а пропущенные догоняются.
     */
    pump() {
        const now = performance.now();
        this.acc += (now - this.clockAt) / 1000;
        this.clockAt = now;
        const dt = 1 / TICK_HZ;
        let n = 0;
        while (this.acc >= dt && n < 5 && this.battle) {
            // ошибка в одном бою не должна ронять сервер со всеми комнатами
            try { this.step(); } catch (e) { console.error("[room " + this.id + "] step:", e); this.errors = (this.errors || 0) + 1; if (this.errors > 50) { this.backToLobby(); return; } }
            this.acc -= dt; n++;
        }
        // сервер не успевает — не копим долг, иначе потом будет рывок
        if (n === 5) this.acc = Math.min(this.acc, dt);
    }

    step() {
        const b = this.battle;
        if (!b) return;
        const dt = 1 / TICK_HZ;
        this.tick++;
        this.run(() => {
            this.applyInputs(dt);
            b.update(dt);
        });
        this.diffShots();
        if (this.tick % SNAP_EVERY === 0) this.sendSnapshots();
        else this.flushEvents();
        if (this.tick % TICK_HZ === 0) this.sendScores();
        if (b.ended && b.endT > BACK_TO_LOBBY) this.backToLobby();
    }

    applyInputs(dt) {
        for (const m of this.members.values()) {
            const P = m.pilot;
            if (!P) continue;
            const v = P.vehicle;
            if (!v || v.dead) continue;
            const inp = m.input;
            m.lastInput += dt;
            if (!inp || m.lastInput > INPUT_TIMEOUT) { v.input.throttle = 0; v.input.steer = 0; continue; }
            v.input.throttle = inp.th;
            v.input.steer = inp.st;
            v.aimPoint = inp.aim;
            if (inp.f) this.battle.fire(v);
        }
    }

    input(client, msg) {
        const m = this.members.get(client.id);
        if (!m || this.state !== "battle") return;
        const num = (x, lo, hi) => (Number.isFinite(+x) ? Math.max(lo, Math.min(hi, +x)) : 0);
        const S = this.battle.world.S;
        const aim = Array.isArray(msg.aim) ? [num(msg.aim[0], -200, S + 200), num(msg.aim[1], -5, 60), num(msg.aim[2], -200, S + 200)] : null;
        m.input = { th: num(msg.th, -1, 1), st: num(msg.st, -1, 1), aim, f: !!msg.f };
        m.lastInput = 0;
    }

    /** Действия игрока: выезд, снаряд, ремонт, аптечка, огнетушитель, артудар, выход */
    action(client, msg) {
        const m = this.members.get(client.id);
        if (!m || this.state !== "battle" || !m.pilot) return;
        const b = this.battle, P = m.pilot, v = P.vehicle;
        const alive = v && !v.dead;
        const say = (text, kind = "warn") => client.send({ t: "msg", text, kind });
        this.run(() => {
            switch (msg.a) {
                case "spawn": {
                    if (alive) return;
                    const id = String(msg.id || "");
                    const c = P.lineup.some((l) => l.id === id) ? b.canSpawn(id, P) : { ok: false, reason: "нет в сетапе" };
                    if (!c.ok || !b.spawnPlayer(id, P)) say("Выезд невозможен: " + (c.reason || "подождите"), "bad");
                    break;
                }
                case "shell": if (alive && SHELLS[msg.id]) v.selectShell(msg.id); break;
                case "repair":
                    if (!alive) return;
                    if (v.repair) v.cancelRepair();
                    else if (!v.startRepair()) say("Ремонт не требуется");
                    break;
                case "medkit": if (alive && !v.useMedkit()) say(v.medkits <= 0 ? "Аптечек нет" : "Раненых нет"); break;
                case "ext":
                    if (!alive) return;
                    if (!v.fire) say("Пожара нет");
                    else if (!v.useExtinguisher()) say("Огнетушителей не осталось", "bad");
                    break;
                case "arty": {
                    if (!alive) return;
                    const r = b.callArtillery(v, +msg.x || 0, +msg.z || 0);
                    if (!r.ok) say("Артудар: " + r.reason);
                    break;
                }
            }
        });
    }

    /* ─────────── События симуляции → сообщения ─────────── */
    ownerOf(v) {
        if (!v || !v.pilot) return null;
        for (const m of this.members.values()) if (m.pilot === v.pilot) return m;
        return null;
    }

    onSimEvent(name, e) {
        if (!this.battle) return;           // события конструктора боя уйдут в полном состоянии
        const all = (ev) => this.queueEv(ev, null);
        const owner = (v, ev) => { const m = this.ownerOf(v); if (m) this.queueEv(ev, m); };
        switch (name) {
            case "spawn": all({ e: "spawn", ...this.spawnInfo(e.v) }); break;
            case "vehicleRemoved": all({ e: "rm", id: e.v.id }); break;
            case "playerSpawn": owner(e.v, { e: "pspawn", id: e.v.id }); break;
            case "shot": all(e.st ? { e: "shot", v: e.v.id, s: e.def.id, p: rv(e.pos), d: rd(e.dir), st: e.st } : { e: "shot", v: e.v.id, s: e.def.id, p: rv(e.pos), d: rd(e.dir) }); break;
            case "bossNote": all({ e: "bn", v: idOf(e.v), t: e.text, k: e.kind }); break;
            case "bossAim": all({ e: "baim", v: idOf(e.v), tg: idOf(e.target), t: r2(e.t) }); break;
            case "pickup": owner(e.v, { e: "pick", v: e.v.id, id: e.id, n: e.n }); break;
            case "hit": {
                const base = { e: "hit", sh: idOf(e.shooter), tg: e.target.id, s: e.shell.id, w: rv(e.world), d: rd(e.dir) };
                const full = { ...base, res: packRes(e.res, true) };
                const lite = { ...base, res: packRes(e.res, false) };
                const ms = new Set([this.ownerOf(e.shooter), this.ownerOf(e.target)].filter(Boolean));
                for (const m of this.members.values()) this.queueEv(ms.has(m) ? full : lite, m);
                break;
            }
            case "splashDamage": {
                const ev = { e: "splash", v: e.v.id, sh: idOf(e.shooter), direct: !!e.direct, res: packRes(e.res, true) };
                const ms = new Set([this.ownerOf(e.shooter), this.ownerOf(e.v)].filter(Boolean));
                for (const m of ms) this.queueEv(ev, m);
                break;
            }
            case "impact": all({ e: "imp", k: e.kind, p: rv([e.x, e.y, e.z]), s: e.shell.id, h: e.harmless ? 1 : 0, o: idOf(e.owner) }); break;
            case "explosion": all({ e: "exp", p: rv([e.x, e.y, e.z]), sz: r2(e.size), in: e.inside ? 1 : 0, gr: e.ground === false ? 0 : 1 }); break;
            case "destroyed": all({ e: "dead", id: e.v.id, c: e.cause, k: idOf(e.killer), x: r2(e.v.x), z: r2(e.v.z), a: r2(e.v.a) }); break;
            case "modDestroyed": owner(e.v, { e: "mod", v: e.v.id, id: e.id, ty: e.type }); break;
            case "crewKO": owner(e.v, { e: "ko", v: e.v.id, s: e.seat }); break;
            case "crewSwap": owner(e.v, { e: "swap", v: e.v.id, h: e.member.home, f: e.from, to: e.to, d: e.dur }); break;
            case "crewSwapDone": owner(e.v, { e: "swapd", v: e.v.id, h: e.member.home, to: e.to }); break;
            case "fireStart": all({ e: "fire", v: e.v.id, by: idOf(e.by) }); break;
            case "fireOut": all({ e: "fout", v: e.v.id, x: e.ext ? 1 : 0 }); break;
            case "repairStart": owner(e.v, { e: "rep", v: e.v.id, d: r2(e.dur) }); break;
            case "repairDone": owner(e.v, { e: "repd", v: e.v.id }); break;
            case "repairCancel": owner(e.v, { e: "repc", v: e.v.id }); break;
            case "medkit": owner(e.v, { e: "med", v: e.v.id, n: e.healed }); break;
            case "reloaded": owner(e.v, { e: "rel", v: e.v.id }); break;
            case "resupply": owner(e.v, { e: "sup", v: e.v.id, c: e.crew || null, a: e.ammo || 0 }); break;
            case "pointChange": all({ e: "pt", i: this.battle.modeCtl.points.indexOf(e.p), o: e.owner, p: e.prev }); break;
            case "artyCalled": all({ e: "arty", v: idOf(e.v), team: e.strike.team, x: r2(e.strike.x), z: r2(e.strike.z), r: e.strike.r }); break;
            case "artyShell": all({ e: "ashell", x: r2(e.x), z: r2(e.z) }); break;
            case "worldChange": {
                const list = this.battle.world[WORLD_LISTS[e.type]];
                const i = list ? list.indexOf(e.o) : -1;
                if (i < 0) break;
                const ev = { e: "wc", ty: e.type, i, a: e.o.fallA !== undefined ? r2(e.o.fallA) : 0 };
                this.worldLog.push(ev);
                all(ev);
                break;
            }
            case "battleEnd": this.onBattleEnd(e); break;
        }
    }

    queueEv(ev, member) {
        if (!this.queue) this.queue = new Map();
        const targets = member ? [member] : [...this.members.values()];
        for (const m of targets) {
            if (!this.queue.has(m)) this.queue.set(m, []);
            this.queue.get(m).push(ev);
        }
    }

    diffShots() {
        const b = this.battle;
        const now = new Set();
        for (const s of b.shots) {
            now.add(s.id);
            if (!this.sentShots.has(s.id)) this.queueEv({ e: "sh+", s: packShot(s) }, null);
        }
        for (const id of this.sentShots) if (!now.has(id)) this.queueEv({ e: "sh-", id }, null);
        this.sentShots = now;
    }

    flushEvents() {
        if (!this.queue) return;
        for (const [m, evs] of this.queue) if (evs.length) m.client.send({ t: "ev", ev: evs });
        this.queue = null;
    }

    sendSnapshots() {
        const b = this.battle;
        const M = b.modeCtl;
        const mode = M.netState();
        const strikes = b.strikes.map((s) => [r2(s.x), r2(s.z), s.team, s.n, s.total, s.r]);
        for (const m of this.members.values()) {
            const P = m.pilot;
            if (!P) continue;
            const T = P.team;
            const veh = [];
            for (const v of b.vehicles) if (v.team === T || v.visible[T] || v.dead) veh.push(packVehicle(v, T));
            const msg = {
                t: "s", tm: r2(b.time), v: veh, m: mode, st: strikes,
                P: { sp: P.sp, n: P.spawns, da: r2(P.deathAt), u: P.lineup.filter((l) => l.used).map((l) => l.id), rp: P.stats.rp },
            };
            if (P.vehicle && !P.vehicle.dead) msg.me = packOwn(P.vehicle);
            const evs = this.queue && this.queue.get(m);
            if (evs && evs.length) msg.ev = evs;
            m.client.send(msg);
        }
        this.queue = null;
    }

    sendScores() {
        const b = this.battle;
        const rows = b.vehicles.map((v) => [v.id, v.stats.kills, v.stats.assists, v.stats.caps, v.stats.dmg]);
        this.broadcast({ t: "sc", v: rows });
    }

    onBattleEnd(r) {
        this.flushEvents();
        for (const m of this.members.values()) {
            const P = m.pilot;
            if (!P) continue;
            m.client.send({
                t: "end",
                r: { win: r.winner === P.team, draw: r.winner === -1, winner: r.winner, reason: r.reason, mode: r.mode, stats: { ...P.stats }, vstats: P.vstats, pilots: r.pilots.map((p) => ({ name: p.name, team: p.team, kills: p.stats.kills })) },
            });
        }
    }

    backToLobby() {
        this.stop();
        this.state = "lobby";
        for (const m of this.members.values()) { m.pilot = null; m.oldPilot = null; m.input = null; }
        this.pilotsByKey = new Map();
        this.pushView();
    }

    stop() {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        this.battle = null;
        this.queue = null;
    }

    leaveBattle(client) {
        const m = this.members.get(client.id);
        if (!m || !m.pilot) return;
        this.run(() => this.dropPilot(m.pilot));
        m.oldPilot = m.pilot;
        m.pilot = null;
        this.pushView();
    }

    /** Возврат в идущий бой тем же пилотом (сетап и очки сохраняются) */
    rejoin(client) {
        const m = this.members.get(client.id);
        if (!m || this.state !== "battle" || m.pilot) return;
        const P = m.oldPilot;
        if (!P) { this.joinBattle(m); return; }
        P.left = false;
        const v = P.vehicle;
        if (v && !v.dead && !v.pilot) { v.brain = null; v.pilot = P; v.callsign = P.name; }
        m.pilot = P;
        m.oldPilot = null;
        this.sendStart(m);
    }
}

/** Сетап по умолчанию — машины первого ранга нации команды */
export function defaultLineup(team) {
    return vehiclesOf(NATIONS[team]).filter((v) => v.rank === 1).slice(0, LINEUP_MAX).map((v) => v.id);
}
