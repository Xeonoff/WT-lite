import { Config } from "./core/Config.js";
import { Events } from "./core/Events.js";
import { Settings } from "./core/Settings.js";
import { Profile } from "./core/Profile.js";
import { cardFor } from "./data/ArchiveCards.js";
import { archiveShell } from "./sim/ArchiveEffects.js";
import { Input } from "./core/Input.js";
import { $, clamp, angDiff } from "./core/Utils.js";
import { SHELLS } from "./data/Shells.js";
import { CREW_SEATS } from "./data/Vehicles.js";
import { MODES } from "./data/Maps.js";
import { getVehicle, vehiclesOf } from "./data/VehicleBuild.js";
import { Battle } from "./sim/Battle.js";
import { raycastVehicle, traceShot, muzzleWorld, frameToHull, hullToWorld } from "./sim/Armor.js";
import { probeShot } from "./sim/Projectiles.js";
import { Scene3D } from "./render/Scene.js";
import { Overlay } from "./render/Overlay.js";
import { Hangar } from "./render/Hangar.js";
import { AudioSys } from "./audio/Audio.js";
import { HUD } from "./ui/HUD.js";
import { Screens } from "./ui/Screens.js";
import { NetClient } from "./net/NetClient.js";
import { NetBattle } from "./net/NetBattle.js";

const CAUSE = { ammo: "детонация боеукладки", crew: "экипаж выведен из строя", fire: "сгорел" };
const KIND_HIT = {
    pen: ["ПРОБИТИЕ", "#ff5147"], "he-pen": ["ФУГАС ВНУТРИ", "#ff5147"], he: ["ПОДРЫВ ФУГАСА", "#ff8c42"],
    nopen: ["НЕПРОБИТИЕ", "#9fb0be"], rico: ["РИКОШЕТ", "#ffd23f"], barrel: ["ПОПАДАНИЕ В СТВОЛ", "#ffb347"],
    stopped: ["ГУСЕНИЦА", "#9fb0be"],
};

export class Game {
    constructor() {
        this.input = new Input();
        this.scene3d = new Scene3D($("gl"));
        this.overlay = new Overlay($("ov"));
        this.hangar = new Hangar(this.scene3d);
        this.audio = new AudioSys();
        this.hud = new HUD();
        this.hud.onShell = (sid) => this.selectShell(sid);
        this.net = new NetClient();
        this.screens = new Screens(this);
        this.state = "menu";
        this.battle = null;
        this.paused = false;
        this.aim = { point: null, dist: 0, target: null, pen: null, penT: 0 };
        this.zoomH = Config.CAMERA.HEIGHT;
        // вид сзади и прицел: camT — цель (0 сверху … 1 сзади), camTs — сглаженное значение
        this.camT = 0;
        this.camTs = 0;
        this.tpDist = Config.CAMERA.TP.DIST;
        this.look = { yaw: 0, pitch: Config.CAMERA.TP.PITCH };
        this.sightToggle = false;
        this.sightZoom = 0;
        this.ourUnlock = false;
        this.unlockAt = -1e9;
        this.lastXray = null;
        this.deathT = 0;
        this.focus = { x: 0, z: 0 };
        this.spec = null;           // наблюдение за союзником: { v, lostT }
        this.thumbQueue = [];
        this.bindNet();
        this.bindChat();
        this.bindKeys();
        this.bindLook();
        this.bindFeedback();
        addEventListener("blur", () => { if (this.state === "battle" && !this.paused && !this.battle.ended && !this.battle.net) this.pause(); });
        document.addEventListener("pointerdown", () => this.audio.init(), { once: false });
        this.screens.show("menu");
        this.prewarmThumbs();
        this.applyHints();
        Events.on("settings", () => this.applyHints());
    }

    prewarmThumbs() {
        const nat = Profile.data.nation;
        const order = [...vehiclesOf(nat), ...vehiclesOf(nat === "ussr" ? "germany" : "ussr")];
        this.thumbQueue = order.map((v) => v.id);
    }

    applyHints() {
        $("hints").classList.toggle("hidden", !Settings.get("hints") || this.hintsOff);
        $("fps").classList.toggle("hidden", !Settings.get("showFps"));
    }

    /* ─────────── Бой ─────────── */
    startBattle(opts) {
        this.audio.init();
        this.screens.hideAll();
        $("loading").classList.remove("hidden");
        // даём кадру отрисовать экран загрузки
        setTimeout(() => {
            try {
                this.endBattleCleanup();
                this.battle = new Battle({ ...opts, equipment: Profile.equipment() });
                this.scene3d.loadBattle(this.battle);
                this.hud.battle = this.battle;
                this.hud.mmStatic = null;
                this.state = "battle";
                this.paused = false;
                this.deathT = 0;
                this.lastXray = null;
                this.resultShown = false;
                this.focus = { x: this.battle.world.spawns[0].x, z: this.battle.world.spawns[0].z };
                this.hud.show(true);
                $("feed").innerHTML = "";
                $("crewLog").innerHTML = "";
                document.body.classList.add("inBattle");
                $("loading").classList.add("hidden");
                const first = opts.firstVehicle;
                if (opts.mode === "range" && first) this.spawn(first);
                else this.screens.openSpawn({ title: "ВЫБОР ТЕХНИКИ" });
                const m = this.battle.world.map;
                this.hud.banner(opts.mode === "range" ? "ПОЛИГОН" : m.name.toUpperCase(), opts.mode === "range" ? "Полоса препятствий справа от старта" : this.battle.weather.name.toLowerCase() + " · " + MODES[opts.mode].name.toLowerCase());
                if (this.battle.weather.spotK < 0.8) setTimeout(() => this.hud.log(`${this.battle.weather.name}: дальность обнаружения снижена до ~${Math.round(Config.SPOT.RANGE * this.battle.weather.spotK)} м`, "tip", 7000), 1200);
            } catch (e) {
                console.error(e);
                $("loading").classList.add("hidden");
                this.showError(e);
            }
        }, 30);
    }

    spawn(id) {
        const b = this.battle;
        if (!b) return;
        if (b.net) {
            // выезд подтверждает сервер событием playerSpawn
            if (!b.canSpawn(id).ok) { this.audio.ui("bad"); return; }
            b.spawnPlayer(id);
            return;
        }
        if (b.mode === "range" && !b.lineup.some((l) => l.id === id)) b.lineup.push({ id, used: false });
        const v = b.spawnPlayer(id);
        if (!v) { this.audio.ui("bad"); return; }
        this.afterSpawn(v);
    }

    afterSpawn(v) {
        const b = this.battle;
        const id = v.def.id;
        this.stopSpectate(false);
        this.screens.closeSpawn();
        this.hud.build(b);
        this.focus = { x: v.x, z: v.z };
        this.scene3d.cam.x = v.x; this.scene3d.cam.z = v.z;
        Profile.data.lastVehicle[getVehicle(id).nation] = id;
        if (b.spawns === 1 && (Profile.data.stats.battles < 3 || b.mode === "range")) this.showTips(b);
    }

    showTips(b) {
        const tips = [
            "Кольцо показывает, куда направлен ствол. На броне его цвет показывает шанс пробития: <b>зелёный</b> — высокий, <b>жёлтый</b> — средний, <b>красный</b> — низкий.",
            "Ставьте корпус <b>ромбом</b> (25–35° к врагу) — приведённая броня растёт. Наклонные листы и так толще своей толщины.",
            "<b>R</b> — ремонт (сбитая гусеница, орудие), <b>F</b> — тушить пожар, <b>T</b> — аптечка экипажу.",
            "<b>ПКМ</b> — бинокль, <b>колесо</b> — масштаб, <b>B</b> — артудар по точке под курсором.",
        ];
        tips.forEach((t, i) => setTimeout(() => { if (this.battle === b && !b.ended) this.hud.log(t, "tip", 9000); }, 1500 + i * 6500));
    }

    pause() {
        if (this.state !== "battle" || this.paused) return;
        this.paused = true;
        this.input.resetPointer();
        this.releaseLock();
        if (this.battle.net) {
            const p = this.battle.player;
            if (p) p.input.throttle = p.input.steer = 0;
            this.battle.fireHeld = false;
            this.battle.sendInput();
        }
        $("pChange").classList.toggle("hidden", this.battle.mode !== "range");
        $("pauseSub").textContent = this.battle.net ? "онлайн-бой продолжается — машина стоит" : "бой остановлен";
        $("pauseScr").classList.remove("hidden");
    }
    resume() {
        this.input.resetPointer();
        this.paused = false;
        $("pauseScr").classList.add("hidden");
        this.screens.closeModal();
        if (this.lookWanted()) this.requestLock();
    }

    leaveBattle() {
        const b = this.battle;
        $("pauseScr").classList.add("hidden");
        this.paused = false;
        if (!b) return;
        if (b.net) {
            if (!b.ended) b.leave();
            this.toMenu("onlineScr");
            return;
        }
        if (!b.ended) {
            if (b.mode === "range") { this.toMenu("menu"); return; }
            b.end(1 - b.playerTeam, "вы покинули бой");
        }
    }

    endBattleCleanup() {
        this.stopSpectate(false);
        this.audio.stopEngines();
        this.scene3d.unloadBattle();
        this.battle = null;
        this.hud.battle = null;
        this.hud.show(false);
        this.hud.xr = null;
        this.overlay.clear();
        this.overlay.incoming.length = 0;
        this.overlay.hitTexts.length = 0;
        $("xray").classList.remove("show");
        $("resultScr").classList.add("hidden");
        $("spawnScr").classList.add("hidden");
        $("pauseScr").classList.add("hidden");
        document.body.classList.remove("inBattle");
    }

    toMenu(screen = "menu") {
        this.endBattleCleanup();
        this.state = "menu";
        this.paused = false;
        this.screens.show(screen);
    }

    finishBattle(r) {
        const b = this.battle;
        if (this.resultShown) return;
        this.resultShown = true;
        let next = null;
        if (b.mode !== "range" && r.stats) {
            Profile.addRP(b.nation, r.stats.rp);
            Profile.addVehicleStats(b.vstats);
            Profile.recordBattle({ win: r.win, kills: r.stats.kills, deaths: r.stats.deaths, wave: r.stats.wave });
            const cand = vehiclesOf(b.nation).filter((v) => !Profile.isResearched(v.id) && Profile.rankOpen(v.nation, v.rank)).sort((x, y) => Profile.cost(x.id) - Profile.cost(y.id))[0];
            if (cand) {
                const left = Profile.cost(cand.id) - Profile.data.rp[b.nation];
                next = cand.name + (left > 0 ? " — ещё " + left + " ОИ" : " — можно исследовать в ангаре!");
            }
        }
        this.stopSpectate(false);
        this.screens.closeSpawn();
        this.screens.showResults(r, { nation: b.nation, next, online: !!b.net });
    }

    /* ─────────── Онлайн ─────────── */
    bindNet() {
        const net = this.net;
        const nb = () => (this.battle && this.battle.net ? this.battle : null);
        net.on("start", (m) => this.startOnline(m));
        net.on("s", (m) => { const b = nb(); if (b) b.onSnapshot(m); });
        net.on("ev", (m) => { const b = nb(); if (b) b.onEvents(m.ev); });
        net.on("sc", (m) => { const b = nb(); if (b) b.onScores(m.v); });
        net.on("end", (m) => { const b = nb(); if (b) b.finish(m.r); });
        net.on("msg", (m) => { if (nb()) { this.hud.log(m.text, m.kind || "warn"); this.audio.ui("bad"); } });
        net.on("chat", (m) => { if (nb()) this.hud.chat(m.from, m.text, m.team === this.battle.playerTeam); });
        net.on("close", () => {
            if (nb()) { this.toMenu("onlineScr"); this.showError(new Error("соединение с сервером потеряно")); }
        });
    }

    startOnline(m) {
        this.audio.init();
        this.screens.hideAll();
        try {
            this.endBattleCleanup();
            const b = new NetBattle(m, this.net);
            this.battle = b;
            this.scene3d.loadBattle(b);
            this.hud.battle = b;
            this.hud.mmStatic = null;
            this.state = "battle";
            this.paused = false;
            this.deathT = 0;
            this.lastXray = null;
            this.resultShown = false;
            const sp = b.world.spawns[b.playerTeam];
            this.focus = { x: sp.x, z: sp.z };
            this.hud.show(true);
            $("feed").innerHTML = "";
            $("crewLog").innerHTML = "";
            $("chatLines").innerHTML = "";
            document.body.classList.add("inBattle");
            if (b.player && !b.player.dead) this.afterSpawn(b.player);
            else this.screens.openSpawn({ title: "ВЫБОР ТЕХНИКИ" });
            this.hud.banner(b.world.map.name.toUpperCase(), "онлайн · " + b.weather.name.toLowerCase() + " · " + (MODES[b.mode] || MODES.domination).name.toLowerCase());
            this.hud.log("Онлайн-бой: Enter — чат, Esc — меню (бой не останавливается)", "tip", 7000);
        } catch (e) {
            console.error(e);
            this.showError(e);
            this.toMenu("onlineScr");
        }
    }

    /** Действие игрока: в онлайне — запрос серверу, в одиночной игре — сразу */
    act(name, local) {
        const b = this.battle;
        if (b && b.net) { b.act(name); return true; }
        return local();
    }

    openChat() {
        const inp = $("chatIn");
        inp.classList.remove("hidden");
        inp.value = "";
        inp.focus();
    }

    bindChat() {
        const inp = $("chatIn");
        const close = () => { inp.classList.add("hidden"); inp.blur(); };
        inp.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                const text = inp.value.trim();
                if (text) this.net.send({ t: "chat", text });
                close();
            } else if (e.key === "Escape") close();
            e.stopPropagation();
        });
        inp.addEventListener("blur", () => inp.classList.add("hidden"));
    }

    /* ─────────── Управление игроком ─────────── */
    selectShell(sid) {
        const p = this.battle && this.battle.player;
        if (!p || p.dead) return;
        if (this.battle.net) this.battle.act("shell", { id: sid });
        if (p.selectShell(sid)) {
            this.audio.ui("click");
            this.hud.update(0, true, this.aim);
        }
    }

    bindKeys() {
        const I = this.input;
        const inBattle = () => this.state === "battle" && this.battle && !this.paused && !this.screens.modalOpen;
        const player = () => (inBattle() && this.battle.player && !this.battle.player.dead ? this.battle.player : null);
        I.on("Escape", () => {
            if (performance.now() - this.unlockAt < 400) return;
            if (this.screens.closeModal()) return;
            if (this.state === "battle") {
                if (this.battle && this.battle.ended) return;
                if (this.spec) { this.stopSpectate(true); return; }
                if (!$("spawnScr").classList.contains("hidden")) {
                    const p = this.battle.player;
                    if (p && !p.dead) this.screens.closeSpawn();
                    return;
                }
                this.paused ? this.resume() : this.pause();
            } else if (this.screens.current === "hangarScr") this.screens.hangarBack();
        });
        I.on("KeyM", () => { const m = this.audio.toggleMute(); this.hud.log(m ? "Звук выключен" : "Звук включён"); });
        I.on("KeyH", () => { this.hintsOff = !this.hintsOff; this.applyHints(); });
        I.on("F1", () => { this.screens.refTab = "controls"; this.screens.openModal("refScr"); if (this.state === "battle") this.pause(); });
        for (let i = 0; i < 5; i++) {
            I.on("Digit" + (i + 1), () => {
                const p = player();
                const ids = p && p.shellIds();
                if (ids && ids[i]) this.selectShell(ids[i]);
            });
        }
        I.on("KeyR", () => {
            const p = player();
            if (!p) return;
            this.act("repair", () => {
                if (p.repair) { p.cancelRepair(); this.hud.log("Ремонт отменён"); }
                else if (!p.startRepair()) this.hud.log("Ремонт не требуется");
            });
        });
        I.on("KeyT", () => {
            const p = player();
            if (p) this.act("medkit", () => { if (!p.useMedkit()) this.hud.log(p.medkits <= 0 ? "Аптечек нет" : "Раненых нет"); });
        });
        I.on("KeyF", () => {
            const p = player();
            if (!p) return;
            this.act("ext", () => {
                if (!p.fire) this.hud.log("Пожара нет");
                else if (!p.useExtinguisher()) this.hud.log("Огнетушителей не осталось", "bad");
            });
        });
        I.on("Enter", () => { if (this.state === "battle" && this.battle && this.battle.net && !this.screens.modalOpen) this.openChat(); });
        I.on("KeyI", () => {
            if (player()?.equipment.length) $("battleDocs").open = !$("battleDocs").open;
        });
        I.on("KeyB", () => {
            const p = player();
            if (!p) return;
            const pt = this.aim.cursor || this.aim.ground;
            if (!pt) return;
            const r = this.battle.callArtillery(p, pt[0], pt[2]);
            if (!r.ok) { this.hud.log("Артудар: " + r.reason, "warn"); this.audio.ui("bad"); }
        });
        I.on("KeyX", () => {
            if (this.lastXray && this.state === "battle") this.hud.showXray(this.lastXray.res, this.lastXray.target, null, this.lastXray.incoming);
        });
        I.on("Backspace", () => { if (inBattle() && this.battle.mode === "range") this.battle.modeCtl.resetTargets(); });
        I.onWheel((dy) => {
            if (this.state !== "battle" || this.paused || this.screens.modalOpen) return;
            if (Settings.get("wheel") === "shell") {
                const p = player();
                if (!p) return;
                const ids = p.shellIds();
                const i = ids.indexOf(p.shell);
                this.selectShell(ids[(i + (dy > 0 ? 1 : ids.length - 1)) % ids.length]);
            } else this.zoomStep(dy < 0 ? 1 : -1);
        });
        I.on("KeyV", () => {
            if (!player() && !(this.spec && inBattle())) return;
            this.setViewT(this.camT >= 1 ? 0 : 1);
            if (this.camT === 0 && this.zoomH < Config.CAMERA.MIN_H + 1) this.zoomH = Config.CAMERA.MIN_H;
        });
        I.on("ShiftLeft", () => { if (player() && this.camT >= 1) this.sightToggle = !this.sightToggle; });
    }

    /** Шаг колеса: +1 — приблизить, −1 — отдалить */
    zoomStep(dir) {
        const C = Config.CAMERA, T = C.TP;
        if (this.sightOn()) { this.sightZoom = dir > 0 ? 1 : 0; return; }
        const s = this.camSubject();
        if (dir > 0) {
            if (this.zoomH > C.MIN_H + 0.5) this.zoomH = Math.max(C.MIN_H, this.zoomH * 0.9);
            else if (this.camT < 1 && s) this.setViewT(Math.min(1, this.camT + T.STEP));
            else if (this.camT >= 1) this.tpDist = Math.max(T.MIN_DIST, this.tpDist * 0.86);
        } else {
            if (this.camT >= 1 && this.tpDist < T.DIST - 0.01) this.tpDist = Math.min(T.DIST, this.tpDist / 0.86);
            else if (this.camT > 0) this.setViewT(Math.max(0, this.camT - T.STEP));
            else this.zoomH = Math.min(C.MAX_H, this.zoomH * 1.1);
        }
    }

    setViewT(t) {
        const s = this.camSubject();
        if (this.camT === 0 && t > 0 && s) {
            // камера разворачивается за корму машины (при наблюдении — за орудие)
            this.look.yaw = this.spec ? s.gunYaw() : s.a;
            this.look.pitch = Config.CAMERA.TP.PITCH;
        }
        if (t < 1e-6) t = 0;
        if (t > 1 - 1e-6) t = 1;
        this.camT = t;
        if (t >= 1 && !this.spec) this.requestLock();
        else { this.sightToggle = false; this.releaseLock(); }
    }

    /* ─────────── Обзор мышью (вид сзади и прицел) ─────────── */
    bindLook() {
        const gl = $("gl");
        document.addEventListener("pointerlockchange", () => {
            if (document.pointerLockElement === gl) {
                this.input.mouse.overUI = false;
                if (!this.lookWanted()) this.releaseLock();
                return;
            }
            // захват снял браузер (Esc) — как в играх, открываем паузу
            if (!this.ourUnlock && this.lookWanted()) {
                this.unlockAt = performance.now();
                this.pause();
            }
            this.ourUnlock = false;
        });
        document.addEventListener("pointerlockerror", () => {
            if (this.lookWanted() && !this.lockHint) {
                this.lockHint = true;
                this.hud.log("Вид сзади: щёлкните мышью, чтобы обзор следовал за мышью", "tip", 6000);
            }
        });
        // Клик по полю одновременно возвращает захват и выполняет игровое действие.
        this.input.onDown = (e) => {
            // наблюдение: ЛКМ / ПКМ — следующий / предыдущий союзник
            if (this.spec && this.state === "battle" && !this.paused && !this.screens.modalOpen) {
                if (e.button === 0 || e.button === 2) this.specCycle(e.button === 0 ? 1 : -1);
                return true;
            }
            if (this.state !== "battle" || this.paused || this.screens.modalOpen || !$("spawnScr").classList.contains("hidden")) return true;
            if (!this.battle.player || this.battle.player.dead || this.battle.ended) return true;
            if (this.lookWanted() && document.pointerLockElement !== gl) this.requestLock();
            return false;
        };
    }

    lookWanted() {
        const b = this.battle, p = b && b.player;
        return this.state === "battle" && !!p && !p.dead && !b.ended && this.camT >= 1 && !this.paused && !this.screens.modalOpen &&
            $("spawnScr").classList.contains("hidden");
    }

    mouseLook() { return this.lookWanted() && this.camTs > 0.95 && document.pointerLockElement === $("gl"); }

    sightOn() {
        const p = this.battle && this.battle.player;
        return this.camT >= 1 && this.camTs > 0.9 && !!p && !p.dead && (this.input.mouse.right || this.sightToggle);
    }

    requestLock() {
        const gl = $("gl");
        if (document.pointerLockElement === gl) return;
        try {
            const r = gl.requestPointerLock();
            if (r && r.catch) r.catch(() => {});
        } catch { /* нет поддержки — остаётся наведение курсором */ }
    }

    releaseLock() {
        if (!document.pointerLockElement) return;
        this.ourUnlock = true;
        document.exitPointerLock();
    }

    /** Точка экрана, по которой наводится орудие: центр — при обзоре мышью, иначе курсор */
    aimScreen() {
        if (this.mouseLook()) return { x: innerWidth / 2, y: innerHeight / 2 };
        return this.input.mouse;
    }

    updateLook(dt) {
        const T = Config.CAMERA.TP;
        const s = this.camSubject();
        const m = this.input.mouse;
        // сглаженный переход между видами
        this.camTs += clamp(this.camT - this.camTs, -dt * 2.2, dt * 2.2);
        if (Math.abs(this.camT - this.camTs) < 1e-3) this.camTs = this.camT;
        // вход в прицел и выход из него сохраняют точку прицеливания
        const sightNow = this.sightOn();
        if (sightNow !== !!this.wasSight) {
            this.wasSight = sightNow;
            this.retarget(sightNow);
        }
        if (this.mouseLook()) {
            const sight = sightNow;
            const k = T.SENS * Settings.get("lookSens") * (sight ? T.SIGHT_FOV[this.sightZoom] / T.FOV : 1);
            this.look.yaw += m.dx * k;
            const [lo, hi] = sight ? T.SIGHT_PITCH : [T.PITCH_MIN, T.PITCH_MAX];
            this.look.pitch = clamp(this.look.pitch - m.dy * k, lo, hi);
        } else if (s && this.camT > 0) {
            // без захвата мыши — камера держится за кормой, наведение курсором; при наблюдении — за орудием союзника
            this.look.yaw += angDiff(this.look.yaw, this.spec ? s.gunYaw() : s.a) * Math.min(1, dt * 2.5);
            this.look.pitch += (T.PITCH - this.look.pitch) * Math.min(1, dt * 2);
        }
        m.dx = 0; m.dy = 0;
        // после гибели и в меню — обратно в вид сверху без захвата мыши
        if (!s && this.camT > 0) this.setViewT(0);
        if (!this.lookWanted()) this.releaseLock();
    }

    /** Повернуть взгляд так, чтобы из новой точки камеры центр экрана смотрел на прежнюю точку прицеливания */
    retarget(sight) {
        const T = Config.CAMERA.TP;
        const p = this.battle && this.battle.player, a = this.aim.point;
        if (!p || p.dead || !a) return;
        const aimFrom = (c) => {
            this.look.yaw = Math.atan2(a[2] - c[2], a[0] - c[0]);
            this.look.pitch = Math.atan2(a[1] - c[1], Math.hypot(a[0] - c[0], a[2] - c[2]));
        };
        if (sight) {
            aimFrom(hullToWorld(p, frameToHull(p, "gun", [0.25, 0.16, -0.32])));
            this.look.pitch = clamp(this.look.pitch, T.SIGHT_PITCH[0], T.SIGHT_PITCH[1]);
            return;
        }
        // камера вида сзади зависит от направления взгляда — несколько приближений
        const d = p.def, P = [p.x, (p.y || 0) + d.dims.H + d.turret.h + 0.9, p.z];
        for (let i = 0; i < 4; i++) {
            const cy = Math.cos(this.look.pitch), D = [cy * Math.cos(this.look.yaw), Math.sin(this.look.pitch), cy * Math.sin(this.look.yaw)];
            aimFrom([P[0] - D[0] * this.tpDist, Math.max(1.1, P[1] - D[1] * this.tpDist + 0.7), P[2] - D[2] * this.tpDist]);
        }
        this.look.pitch = clamp(this.look.pitch, T.PITCH_MIN, T.PITCH_MAX);
    }

    /** Машина, за которой идёт камера: своя живая или та, за которой наблюдаем */
    camSubject() {
        const b = this.battle;
        if (!b) return null;
        if (this.spec) return this.spec.v;
        return b.player && !b.player.dead ? b.player : null;
    }

    /* ─────────── Наблюдение за боем ─────────── */
    /** Союзники в бою, за которыми можно наблюдать */
    specList() {
        const b = this.battle;
        if (!b) return [];
        return b.vehicles.filter((v) => !v.dead && !v.static && v.team === b.playerTeam && v !== b.player);
    }

    startSpectate() {
        const b = this.battle;
        if (!b || b.ended) return;
        const list = this.specList();
        if (!list.length) { this.hud.log("Наблюдать не за кем — союзников в бою нет", "warn"); this.audio.ui("bad"); return; }
        this.spec = { v: null, lostT: 0, ox: 0, oz: 0 };
        this.specSet(list.slice().sort((x, y) => y.stats.kills - x.stats.kills)[0]);
        this.screens.closeSpawn();
        $("specBar").classList.remove("hidden");
    }

    /** Новая цель наблюдения: камера плавно перелетает к ней (смещение гаснет), дальше держит без отставания */
    specSet(v) {
        const s = this.spec;
        s.v = v;
        s.lostT = 0;
        s.ox = this.focus.x - v.x;
        s.oz = this.focus.z - v.z;
        this.specShow();
    }

    /** toSpawn — вернуться к выбору техники */
    stopSpectate(toSpawn) {
        if (!this.spec) return;
        this.spec = null;
        $("specBar").classList.add("hidden");
        if (this.camT > 0) this.setViewT(0);
        const b = this.battle;
        if (toSpawn && b && !b.ended && (!b.player || b.player.dead)) this.screens.openSpawn({ title: "ВЫБОР ТЕХНИКИ" });
    }

    specCycle(dir) {
        const list = this.specList();
        if (!this.spec || !list.length) return;
        const i = list.indexOf(this.spec.v);
        this.specSet(i < 0 ? list[0] : list[(i + dir + list.length) % list.length]);
        if (this.camT > 0) { this.look.yaw = this.spec.v.gunYaw(); this.look.pitch = Config.CAMERA.TP.PITCH; }
        this.audio.ui("click");
    }

    specShow() {
        const v = this.spec.v, w = $("specWho");
        w.textContent = v.callsign + " ";
        const i = document.createElement("i");
        i.textContent = v.def.name + (v.dead ? " · уничтожен" : " · уничтожено: " + v.stats.kills);
        w.append(i);
    }

    /** Цель наблюдения погибла — через пару секунд переходим к другому союзнику */
    updateSpectate(dt) {
        const s = this.spec, b = this.battle;
        if (!s) return;
        if (!s.v.dead && b.vehicles.includes(s.v)) return;
        if (s.lostT === 0) this.specShow();
        s.lostT += dt;
        if (s.lostT < 2.5) return;
        const list = this.specList();
        if (list.length) this.specSet(list.slice().sort((x, y) => y.stats.kills - x.stats.kills)[0]);
        else s.lostT = 2.5;
    }

    /** Параметры камеры для вида сзади / прицела */
    viewParams() {
        const p = this.camSubject() || (this.battle && this.battle.player);
        if (!p || this.camTs <= 0) return null;
        const d = p.def;
        const view = {
            t: this.camTs, yaw: this.look.yaw, pitch: this.look.pitch, dist: this.tpDist,
            pivot: [p.x, (p.y || 0) + d.dims.H + d.turret.h + 0.9, p.z], sight: null,
        };
        if (this.sightOn()) {
            // прицел наводчика — слева от орудия, над осью цапф
            const pos = hullToWorld(p, frameToHull(p, "gun", [0.25, 0.16, -0.32]));
            view.sight = { pos, fov: Config.CAMERA.TP.SIGHT_FOV[this.sightZoom] };
        }
        return view;
    }

    updatePlayer(dt) {
        const b = this.battle, p = b.player;
        if (!p || p.dead) return;
        const I = this.input;
        const blocked = this.screens.modalOpen || this.paused;
        let thr = 0, steer = 0;
        if (!blocked) {
            if (I.down("KeyW")) thr += 1;
            if (I.down("KeyS")) thr -= 1;
            if (I.down("KeyA")) steer -= 1;
            if (I.down("KeyD")) steer += 1;
        }
        if (p.repair && (thr || steer)) {
            if (b.time - (this.repairHintT || 0) > 2.5) { this.hud.log("Идёт ремонт — машина стоит. [R] — отменить", "warn"); this.repairHintT = b.time; }
            thr = 0; steer = 0;
        }
        // доворот корпуса ПТ-САУ за прицелом
        const T = p.def.turret;
        if (T.casemate && Settings.get("hullAssist") && steer === 0 && this.aim.point) {
            const want = Math.atan2(this.aim.point[2] - p.z, this.aim.point[0] - p.x);
            const d = angDiff(p.a, want);
            const arc = T.arc * Math.PI / 180;
            if (Math.abs(d) > arc * 0.85 && Math.abs(d) < Math.PI * 0.9) steer = clamp(d * 2, -1, 1);
        }
        p.input.throttle = thr;
        p.input.steer = steer;
        p.aimPoint = this.aim.point;
        if (!blocked && !I.mouse.overUI && (I.mouse.left || I.mouse.pressed)) b.fire(p);
        I.mouse.pressed = false;
    }

    /** Точка прицеливания: деталь под курсором → центр её высоты; иначе — направление на землю */
    computeAim(dt) {
        const b = this.battle, p = b && b.player;
        const aim = this.aim;
        if (!p || p.dead) { aim.cursor = aim.point = aim.pen = aim.block = aim.gunRange = null; return; }
        const m = this.aimScreen();
        const tp = this.camTs > 0.5;
        const ray = this.scene3d.screenRay(m.x, m.y);
        let best = null;
        for (const v of b.vehicles) {
            if (v === p) continue;
            if (!v.dead && v.team !== p.team && !v.visible[p.team]) continue;
            // широкая фаза: расстояние от луча до центра машины
            const vy = (v.y || 0) + 1.2;
            const cx = v.x - ray.o[0], cy = vy - ray.o[1], cz = v.z - ray.o[2];
            const t = cx * ray.d[0] + cy * ray.d[1] + cz * ray.d[2];
            const px = ray.o[0] + ray.d[0] * t - v.x, py = ray.o[1] + ray.d[1] * t - vy, pz = ray.o[2] + ray.d[2] * t - v.z;
            if (px * px + py * py + pz * pz > (v.def.radius + 1.5) ** 2) continue;
            const hit = raycastVehicle(v, ray.o, ray.d, 5000);
            if (hit && (!best || hit.t < best.hit.t)) best = { v, hit };
        }
        const mz = muzzleWorld(p);
        if (best) {
            const v = best.v, d = v.def, id = best.hit.id;
            let y;
            if (id === "turret") y = d.dims.H + d.turret.h * 0.5;
            else if (id === "hull") y = d.dims.H * 0.55;
            else if (id === "barrel") y = d.muzzleY;
            else y = Math.min(d.dims.H * 0.4, d.dims.th * 0.55);
            // сверху луч камеры попадает в крышу — целимся в середину детали; сбоку — в точку под прицелом
            aim.point = tp ? best.hit.world.slice() : [best.hit.world[0], (v.y || 0) + y, best.hit.world[2]];
            aim.cursor = best.hit.world;
            aim.ground = null;
            aim.target = v;
            aim.part = id;
            aim.dist = Math.hypot(aim.point[0] - mz[0], aim.point[2] - mz[2]);
        } else {
            const gp = this.scene3d.groundAt(m.x, m.y, 0);
            aim.target = null;
            if (tp) {
                // вид сзади: прицел — первая преграда на луче камеры (здание, скала, обломки, грунт),
                // выше горизонта — точка далеко на луче; невидимые машины не выдаём
                const far = 700;
                const hit = probeShot(b, p, ray.o, ray.d, 900);
                const pt = hit && hit.kind !== "vehicle" ? hit.point
                    : gp && Math.hypot(gp[0] - ray.o[0], gp[2] - ray.o[2]) < 900 ? gp
                    : [ray.o[0] + ray.d[0] * far, ray.o[1] + ray.d[1] * far, ray.o[2] + ray.d[2] * far];
                aim.point = pt;
                aim.cursor = pt;
                aim.ground = pt[1] < 0.5 ? pt : null;
                aim.dist = Math.hypot(pt[0] - p.x, pt[2] - p.z);
            } else if (gp) {
                const dx = gp[0] - p.x, dz = gp[2] - p.z;
                const dd = Math.hypot(dx, dz) || 1;
                const ext = Math.max(dd, 70);
                const ax = p.x + dx / dd * ext, az = p.z + dz / dd * ext;
                aim.point = [ax, b.world.h(ax, az) + 1.1, az];
                aim.dist = dd;
                aim.ground = gp;
                aim.cursor = gp;
            } else { aim.cursor = aim.ground = aim.point = null; aim.dist = 0; }
        }
        // Прогноз для маркера орудия строим по тому же лучу, по которому полетит выстрел.
        aim.penT -= dt;
        if (aim.penT > 0) return;
        aim.penT = 0.08;
        aim.pen = aim.block = null;
        aim.gunRange = null;
        const cursor = aim.cursor;
        if (!cursor) return;
        const { m: origin, dir } = b.fireLine(p);
        const reach = Math.max(4, Math.hypot(cursor[0] - origin[0], cursor[1] - origin[1], cursor[2] - origin[2]));
        const hit = probeShot(b, p, origin, dir, reach + 2);
        if (!hit) return;
        if (hit.kind === "vehicle" && hit.v.team !== p.team && !hit.v.visible[p.team]) return;
        aim.gunRange = hit.t;
        if (hit.kind === "vehicle" && hit.v.team !== p.team) {
            const shell = archiveShell(p,SHELLS[p.loaded || p.shell]);
            const tr = traceShot(shell, hit.v, origin, dir, hit.t + 2 * hit.v.def.radius, hit.t);
            const plate = tr.main || tr.layers.at(-1);
            if (plate) aim.pen = { pen: tr.pen, eff: plate.ev.eff, plate: plate.ev.info.name,
                angle: plate.ev.theta, rico: plate.ev.ricoP, screen: !tr.main };
        } else if (hit.kind !== "ground" || hit.t < reach * (aim.target ? 0.9 : 0.85)) {
            aim.block = { what: { vehicle: "Союзник", ground: "Склон", building: "Здание", wreck: "Остов", rock: "Скала" }[hit.kind] || "Преграда" };
        }
    }

    /* ─────────── События → обратная связь ─────────── */
    bindFeedback() {
        const B = () => this.battle;
        const isP = (v) => B() && v && v === B().player;
        Events.on("shot", (e) => { if (B()) this.audio.shot(e.def, e.pos[0], e.pos[2], isP(e.v)); });
        Events.on("hit", (e) => {
            const b = B();
            if (!b) return;
            const r = e.res, k = r.kind;
            const w = e.world || [e.target.x, 1, e.target.z];
            const cal = e.shell.cal;
            if (isP(e.shooter)) {
                const [txt, col] = KIND_HIT[k] || [null];
                const crit = r.dmg.filter((d) => d.kind === "crew" && d.after <= 0).length;
                if (txt) this.overlay.hitText(r.killed ? "УНИЧТОЖЕН" : txt, r.killed ? "#ffd25a" : col, crit ? "выведено членов экипажа: " + crit : r.events.includes("fire") ? "пожар!" : "");
                if (Settings.get("xray") && k !== "miss") {
                    this.hud.showXray(r, e.target);
                    this.lastXray = { res: r, target: e.target, incoming: false };
                }
                this.audio.impact(k === "he-pen" || k === "he" ? "pen" : k === "stopped" || k === "barrel" ? "nopen" : k, w[0], w[2], cal, true);
            } else if (isP(e.target)) {
                if (e.shooter) this.overlay.incomingHit(e.shooter.x, e.shooter.z, k === "he-pen" ? "pen" : k);
                this.audio.playerHit(k, cal);
                if (k === "pen" || k === "he-pen") this.vignette(1);
                if (Settings.get("xrayIncoming") && (k === "pen" || k === "he-pen" || k === "he")) {
                    this.hud.showXray(r, e.target, null, true);
                    this.lastXray = { res: r, target: e.target, incoming: true };
                }
            } else {
                this.audio.impact(k === "he-pen" || k === "he" ? "pen" : k === "stopped" || k === "barrel" ? "nopen" : k, w[0], w[2], cal, false);
            }
        });
        Events.on("splashDamage", (e) => {
            if (isP(e.shooter) && !e.direct && e.res.dmg.length) this.overlay.hitText("ОСКОЛКИ", "#ff8c42", e.res.dmg.length + " попаданий");
            if (isP(e.v) && e.res.dmg.length) { this.vignette(0.5); this.overlay.incomingHit(e.shooter ? e.shooter.x : e.v.x, e.shooter ? e.shooter.z : e.v.z, "he"); }
        });
        Events.on("explosion", (e) => { if (B() && !e.inside) this.audio.explosion(e.x, e.z, e.size); });
        Events.on("impact", (e) => { if (B() && e.shell.type !== "HE" && !e.harmless) this.audio.impact(e.kind, e.x, e.z, e.shell.cal, false); });
        Events.on("destroyed", (e) => {
            const b = B();
            if (!b) return;
            const v = e.v, killer = e.killer;
            const vName = (v.isPlayer ? "Вы" : v.callsign) + ` <i>${v.def.name}</i>`;
            const kName = killer ? (killer.isPlayer ? "Вы" : killer.callsign) + ` <i>${killer.def.name}</i>` : "";
            const vc = v.team === b.playerTeam ? "a" : "e";
            const kc = killer ? (killer.team === b.playerTeam ? "a" : "e") : "";
            const cause = { ammo: "💥", crew: "✝", fire: "🔥" }[e.cause] || "✕";
            this.hud.feed(killer && killer !== v ? `<span class="${kc}">${kName}</span> ${cause} <span class="${vc}">${vName}</span>` : `<span class="${vc}">${vName}</span> ${cause}`, isP(killer) ? "mine" : isP(v) ? "me" : "");
            if (e.cause === "ammo") this.audio.detonation(v.x, v.z);
            else this.audio.explosion(v.x, v.z, 1.1);
            if (isP(killer) && v.team !== b.playerTeam) this.audio.ui("good");
            if (isP(v)) {
                this.deathT = b.time;
                this.deathCause = CAUSE[e.cause] || e.cause;
                this.deathKiller = killer;
                this.hud.log("Машина потеряна: " + this.deathCause, "bad");
                this.hud.banner("МАШИНА УНИЧТОЖЕНА", (killer && killer !== v ? "уничтожил: " + killer.callsign + " · " + killer.def.name + " · " : "") + this.deathCause, "lose");
                this.vignette(1.4);
            }
        });
        Events.on("collisionDamage", ({ v, severe }) => {
            if (!isP(v)) return;
            this.vignette(severe ? 0.65 : 0.25);
            this.hud.log("Повреждения от столкновения", "bad");
        });
        Events.on("crewKO", (e) => {
            if (isP(e.v)) this.hud.log(e.v.def.crewTitles[e.seat] + " выбыл", "bad");
        });
        Events.on("crewSwap", (e) => {
            if (!isP(e.v)) return;
            this.hud.log(`${CREW_SEATS[e.member.home].name} пересаживается: ${CREW_SEATS[e.to].name.toLowerCase()} (${e.dur.toFixed(1)} с)`, "swap");
        });
        Events.on("crewSwapDone", (e) => { if (isP(e.v)) this.hud.log(`${CREW_SEATS[e.member.home].name} на месте: ${CREW_SEATS[e.to].name.toLowerCase()}`, "good"); });
        Events.on("modDestroyed", (e) => {
            if (!isP(e.v)) return;
            const t = e.type;
            const msg = { track: "Гусеница сбита!", engine: "Двигатель выведен!", transmission: "Трансмиссия выведена!", barrel: "Ствол уничтожен!", breech: "Казённик выведен!", ammo: "Боеукладка разбита!", drive: "Поворотный механизм выведен!", fuel: "Бак пробит!" }[t];
            if (msg) this.hud.log(msg, "bad");
            if (t === "track") this.audio.trackBreak();
        });
        Events.on("fireStart", (e) => {
            const b = B();
            if (!b) return;
            if (isP(e.v)) this.hud.log("ПОЖАР! Жми [F]", "fire");
            else if (isP(e.by)) this.hud.feed(`<span class="e">${e.v.callsign} <i>${e.v.def.name}</i></span> горит`, "mine");
        });
        Events.on("fireOut", (e) => {
            if (!isP(e.v)) return;
            this.hud.log(e.ext ? "Пожар потушен" : "Пожар погас", "good");
            if (e.ext) this.audio.extinguisher();
        });
        Events.on("repairStart", (e) => { if (isP(e.v)) { this.hud.log(`Ремонт: ${e.dur.toFixed(0)} с. Машина неподвижна`, "warn"); this.audio.repairTick(); } });
        Events.on("repairDone", (e) => { if (isP(e.v)) this.hud.log("Ремонт завершён", "good"); });
        Events.on("archiveProc", ({v,id}) => {
            if (!isP(v)) return;
            const item = v.equipment.find(i => i.id === id);
            if (item) this.hud.log("Архив · " + cardFor(item).name, "good");
        });
        Events.on("medkit", (e) => { if (isP(e.v)) this.hud.log("Аптечка: вылечено " + e.healed, "good"); });
        Events.on("reloaded", (e) => { if (isP(e.v)) this.audio.reloadDone(); });
        Events.on("resupply", (e) => {
            const parts = [];
            if (e.crew) parts.push("экипаж: " + CREW_SEATS[e.crew].name.toLowerCase());
            if (e.ammo) parts.push("БК +" + e.ammo);
            if (parts.length) this.hud.log("Пополнение на точке: " + parts.join(", "), "good");
        });
        Events.on("pointChange", (e) => {
            const b = B();
            if (!b) return;
            const p = e.p;
            if (e.owner === -1) this.hud.feed(`Точка <b>${p.id}</b> нейтрализована`, "");
            else {
                const ally = e.owner === b.playerTeam;
                this.hud.feed(`Точка <b>${p.id}</b> захвачена ${ally ? "<span class='a'>союзниками</span>" : "<span class='e'>противником</span>"}`, ally ? "mine" : "me");
                this.audio.ui(ally ? "cap" : "bad");
                const pl = b.player;
                if (ally && pl && !pl.dead && Math.hypot(pl.x - p.x, pl.z - p.z) < p.r) this.hud.banner("ТОЧКА " + p.id + " ЗАХВАЧЕНА", "+" + Config.SP.CAPTURE + " ОВ");
            }
        });
        Events.on("artyCalled", (e) => {
            const b = B();
            if (!b) return;
            if (isP(e.v)) { this.hud.log("Артиллерия: огонь по квадрату!", "good"); this.audio.radio(); }
            else if (e.v.team !== b.playerTeam) {
                const p = b.player;
                if (p && !p.dead && Math.hypot(p.x - e.strike.x, p.z - e.strike.z) < e.strike.r + 18) this.hud.log("АРТОБСТРЕЛ! Уходите из зоны", "bad");
            }
        });
        Events.on("artyShell", (e) => { if (B()) this.audio.whistle(e.x, e.z); });
        // битва с боссом: сводки о состоянии «Ратте» и предупреждение о наводке главного калибра
        Events.on("bossNote", (e) => { if (B()) this.hud.log("«Ратте»: " + e.text, e.kind === "good" ? "good" : e.kind === "bad" ? "bad" : e.kind === "swap" ? "swap" : "warn", 6000); });
        Events.on("pickup", (e) => {
            const b = B();
            if (!b || e.v !== b.player) return;
            const s = SHELLS[e.id];
            this.hud.log(`Трофей: +${e.n} × «${s ? s.name : "кумулятивный"}» (${s ? s.pen[0] : "—"} мм, сильное заброневое действие) — клавиша ${e.v.shellIds().indexOf(e.id) + 1}`, "good", 7000);
            this.audio.ui("good");
        });
        Events.on("bossAim", (e) => {
            const b = B();
            if (!b || e.target !== b.player) return;
            this.hud.log("⚠ ГЛАВНЫЙ КАЛИБР «РАТТЕ» НАВОДИТСЯ НА ВАС — уходите из-под прицела или за укрытие!", "fire", 4000);
            this.audio.ui("bad");
            this.vignette(0.55);
        });
        Events.on("waveStart", (e) => this.hud.banner("ВОЛНА " + e.n, "противников: " + e.count));
        Events.on("waveClear", (e) => { this.hud.banner("ВОЛНА " + e.n + " ОТБИТА", "полевой ремонт и пополнение"); this.audio.ui("good"); });
        Events.on("playerSpawn", (e) => { const b = B(); if (b && b.net && e.v === b.player) this.afterSpawn(e.v); });
        Events.on("battleEnd", (r) => {
            if (r.drop) Profile.receiveCase(r.drop, r.rewardId);
            this.hud.banner(r.draw ? "НИЧЬЯ" : r.win ? "ПОБЕДА" : "ПОРАЖЕНИЕ", r.reason, r.draw ? "" : r.win ? "win" : "lose");
            this.audio.ui(r.win ? "good" : "bad");
            setTimeout(() => { if (this.battle && this.battle.result === r) this.finishBattle(r); }, 3200);
        });
    }

    vignette(k) {
        const v = $("vign");
        v.style.transition = "none";
        v.style.opacity = Math.min(1, k);
        void v.offsetWidth;
        v.style.transition = "opacity .8s";
        v.style.opacity = 0;
    }

    showError(e) {
        const d = document.createElement("div");
        d.className = "errbox";
        d.textContent = "Ошибка: " + (e && e.message ? e.message : e);
        document.body.appendChild(d);
        setTimeout(() => d.remove(), 8000);
    }

    /* ─────────── Кадр ─────────── */
    frame(dt) {
        if (this.state === "battle" && this.battle) this.frameBattle(dt);
        else this.frameMenu(dt);
    }

    frameMenu(dt) {
        if (this.thumbQueue.length) {
            const id = this.thumbQueue.shift();
            this.hangar.thumbnail(id);
        }
        let offset = this.screens.current === "menu" ? 0.2 : 0;
        if (this.screens.current === "hangarScr") {
            // машина — по центру окна осмотра между деревом и карточкой
            const r = document.getElementById("hView").getBoundingClientRect();
            offset = r.width > 0 ? (r.left + r.width / 2 - innerWidth / 2) / innerWidth : 0.045;
        }
        this.hangar.render(dt, offset);
    }

    frameBattle(dt) {
        const b = this.battle;
        const running = !this.paused && !this.screens.modalOpen;
        // онлайн-бой не ставится на паузу: реплика обновляется всегда
        const sdt = running || b.net ? dt : 0;
        this.updateLook(dt);
        if (running) {
            this.computeAim(dt);
            this.updatePlayer(dt);
            b.update(dt);
        } else if (b.net) {
            const p = b.player;
            if (p) { p.input.throttle = 0; p.input.steer = 0; }
            b.update(dt);
        }
        const p = b.player;
        this.updateSpectate(dt);
        // фокус камеры
        let aimForCam = null;
        if (this.spec) {
            const s = this.spec, k = Math.exp(-dt * 4);
            s.ox *= k; s.oz *= k;
            this.focus = { x: s.v.x + s.ox, z: s.v.z + s.oz };
        } else if (p && !p.dead) {
            this.focus = { x: p.x, z: p.z };
            aimForCam = this.aim.ground || this.aim.point;
            if (this.aim.target && this.aim.point) aimForCam = this.aim.point;
        } else if (p && p.dead && b.time - this.deathT < 3.6 && this.deathKiller && this.deathKiller !== p) {
            const k = this.deathKiller;
            this.focus = { x: this.focus.x + (k.x - this.focus.x) * Math.min(1, dt * 2.2), z: this.focus.z + (k.z - this.focus.z) * Math.min(1, dt * 2.2) };
        } else if (b.time - this.deathT > 4) {
            const ally = b.vehicles.filter((v) => !v.dead && v.team === b.playerTeam && !v.static).sort((x, y) => y.stats.kills - x.stats.kills)[0];
            if (ally) this.focus = { x: this.focus.x + (ally.x - this.focus.x) * Math.min(1, dt * 2), z: this.focus.z + (ally.z - this.focus.z) * Math.min(1, dt * 2) };
        }
        const binoc = this.input.mouse.right && running && this.camTs < 0.5;
        this.scene3d.updateCamera(dt, this.focus, aimForCam, binoc, this.zoomH, this.viewParams());
        this.scene3d.sync(sdt);
        this.scene3d.render();
        this.overlay.draw(this, sdt);
        this.hud.update(dt, false, this.aim);
        const c = this.scene3d.cam;
        const tilt = Settings.get("tilt") * Math.PI / 180;
        this.hud.minimap(dt, { x: c.x, z: c.z - c.h * Math.tan(tilt) * 0.05, hw: c.h * Math.tan(Config.CAMERA.FOV * Math.PI / 360) * innerWidth / innerHeight, hh: c.h * Math.tan(Config.CAMERA.FOV * Math.PI / 360) });
        this.hud.drawXray(dt);
        this.hud.drawScheme(dt);
        this.hud.scoreboard(this.input.keys.Tab && running);
        if (Settings.get("showFps")) this.hud.fps(dt);
        this.audio.updateEngines(b, sdt, c.x, c.z);

        if (!$("spawnScr").classList.contains("hidden")) {
            this.spawnRefresh = (this.spawnRefresh || 0) - dt;
            if (this.spawnRefresh <= 0) { this.spawnRefresh = 0.5; this.screens.renderSpawn(); }
        }
        // экран возрождения после гибели
        if (running && !b.ended && !this.spec && (!p || p.dead) && p && b.time - this.deathT > 3.6 && $("spawnScr").classList.contains("hidden")) {
            const killer = this.deathKiller;
            this.screens.openSpawn({
                title: "МАШИНА УНИЧТОЖЕНА", dead: true,
                cause: "Причина: <b>" + (this.deathCause || "") + "</b>" + (killer ? " · уничтожил: " + (killer.isPlayer ? "вы" : killer.callsign + " (" + killer.def.name + ")") : ""),
            });
        }
    }
}

