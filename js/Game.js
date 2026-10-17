import { Config } from "./core/Config.js";
import { Events } from "./core/Events.js";
import { Settings } from "./core/Settings.js";
import { Profile } from "./core/Profile.js";
import { Input } from "./core/Input.js";
import { $, clamp, angDiff } from "./core/Utils.js";
import { SHELLS } from "./data/Shells.js";
import { CREW_SEATS } from "./data/Vehicles.js";
import { getVehicle, vehiclesOf } from "./data/VehicleBuild.js";
import { Battle } from "./sim/Battle.js";
import { raycastVehicle, traceShot, muzzleWorld } from "./sim/Armor.js";
import { Scene3D } from "./render/Scene.js";
import { Overlay } from "./render/Overlay.js";
import { Hangar } from "./render/Hangar.js";
import { AudioSys } from "./audio/Audio.js";
import { HUD } from "./ui/HUD.js";
import { Screens } from "./ui/Screens.js";

const CAUSE = { ammo: "детонация боеукладки", crew: "экипаж выведен из строя", fire: "сгорел" };
const KIND_HIT = {
    pen: ["ПРОБИТИЕ", "#ff5147"], "he-pen": ["ФУГАС ВНУТРИ", "#ff5147"], he: ["ПОДРЫВ ФУГАСА", "#ff8c42"],
    nopen: ["НЕПРОБИТИЕ", "#9fb0be"], rico: ["РИКОШЕТ", "#ffd23f"], barrel: ["ПОПАДАНИЕ В СТВОЛ", "#ffb347"],
    stopped: ["ГУСЕНИЦА", "#9fb0be"],
};
const VOICE_KO = {
    driver: "Механик-водитель выбыл!", gunner: "Наводчик выбыл!", loader: "Заряжающий выбыл!",
    loader2: "Второй заряжающий выбыл!", commander: "Командир выбыл!", radio: "Радист выбыл!",
};
const VOICE_SEAT = { driver: "водителя", gunner: "наводчика", loader: "заряжающего", commander: "командира" };

export class Game {
    constructor() {
        this.input = new Input();
        this.scene3d = new Scene3D($("gl"));
        this.overlay = new Overlay($("ov"));
        this.hangar = new Hangar(this.scene3d);
        this.audio = new AudioSys();
        this.hud = new HUD();
        this.hud.onShell = (sid) => this.selectShell(sid);
        this.screens = new Screens(this);
        this.state = "menu";
        this.battle = null;
        this.paused = false;
        this.aim = { point: null, dist: 0, target: null, pen: null, penT: 0 };
        this.zoomH = Config.CAMERA.HEIGHT;
        this.lastXray = null;
        this.deathT = 0;
        this.focus = { x: 0, z: 0 };
        this.thumbQueue = [];
        this.bindKeys();
        this.bindFeedback();
        addEventListener("blur", () => { if (this.state === "battle" && !this.paused && !this.battle.ended) this.pause(); });
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
                this.battle = new Battle(opts);
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
                this.hud.banner(opts.mode === "range" ? "ПОЛИГОН" : m.name.toUpperCase(), opts.mode === "range" ? "испытание техники" : this.battle.weather.name.toLowerCase() + " · " + (opts.mode === "domination" ? "превосходство" : "оборона рубежа"));
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
        if (b.mode === "range" && !b.lineup.some((l) => l.id === id)) b.lineup.push({ id, used: false });
        const v = b.spawnPlayer(id);
        if (!v) { this.audio.ui("bad"); return; }
        this.screens.closeSpawn();
        this.hud.build(b);
        this.focus = { x: v.x, z: v.z };
        this.scene3d.cam.x = v.x; this.scene3d.cam.z = v.z;
        Profile.data.lastVehicle[getVehicle(id).nation] = id;
        this.audio.say("Экипаж готов, к бою!", 1);
        if (b.spawns === 1 && (Profile.data.stats.battles < 3 || b.mode === "range")) this.showTips(b);
    }

    showTips(b) {
        const tips = [
            "Наведите прицел на деталь противника: <b>зелёный</b> — пробьёте, <b>жёлтый</b> — на грани, <b>красный</b> — нет.",
            "Ставьте корпус <b>ромбом</b> (25–35° к врагу) — приведённая броня растёт. Наклонные листы и так толще своей толщины.",
            "<b>R</b> — ремонт (сбитая гусеница, орудие), <b>F</b> — тушить пожар, <b>T</b> — аптечка экипажу.",
            "<b>ПКМ</b> — бинокль, <b>колесо</b> — масштаб, <b>B</b> — артудар по точке под курсором.",
        ];
        tips.forEach((t, i) => setTimeout(() => { if (this.battle === b && !b.ended) this.hud.log(t, "tip", 9000); }, 1500 + i * 6500));
    }

    pause() {
        if (this.state !== "battle" || this.paused) return;
        this.paused = true;
        $("pChange").classList.toggle("hidden", this.battle.mode !== "range");
        $("pauseScr").classList.remove("hidden");
    }
    resume() {
        this.paused = false;
        $("pauseScr").classList.add("hidden");
        this.screens.closeModal();
    }

    leaveBattle() {
        const b = this.battle;
        $("pauseScr").classList.add("hidden");
        this.paused = false;
        if (!b) return;
        if (!b.ended) {
            if (b.mode === "range") { this.toMenu("menu"); return; }
            b.end(1 - b.playerTeam, "вы покинули бой");
        }
    }

    endBattleCleanup() {
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
        if (b.mode !== "range") {
            Profile.addRP(b.nation, r.stats.rp);
            Profile.addVehicleStats(b.vstats);
            Profile.recordBattle({ win: r.win, kills: r.stats.kills, deaths: r.stats.deaths, wave: r.stats.wave });
            const cand = vehiclesOf(b.nation).filter((v) => !Profile.isResearched(v.id) && Profile.rankOpen(v.nation, v.rank)).sort((x, y) => Profile.cost(x.id) - Profile.cost(y.id))[0];
            if (cand) {
                const left = Profile.cost(cand.id) - Profile.data.rp[b.nation];
                next = cand.name + (left > 0 ? " — ещё " + left + " ОИ" : " — можно исследовать в ангаре!");
            }
        }
        this.screens.closeSpawn();
        this.screens.showResults(r, { nation: b.nation, next });
    }

    /* ─────────── Управление игроком ─────────── */
    selectShell(sid) {
        const p = this.battle && this.battle.player;
        if (!p || p.dead) return;
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
            if (this.screens.closeModal()) return;
            if (this.state === "battle") {
                if (this.battle && this.battle.ended) return;
                if (!$("spawnScr").classList.contains("hidden")) {
                    const p = this.battle.player;
                    if (p && !p.dead) this.screens.closeSpawn();
                    return;
                }
                this.paused ? this.resume() : this.pause();
            } else if (this.screens.current === "hangarScr") this.screens.show("menu");
        });
        I.on("KeyM", () => { const m = this.audio.toggleMute(); this.hud.log(m ? "Звук выключен" : "Звук включён"); });
        I.on("KeyH", () => { this.hintsOff = !this.hintsOff; this.applyHints(); });
        I.on("F1", () => { this.screens.refTab = "controls"; this.screens.openModal("refScr"); if (this.state === "battle") this.pause(); });
        for (let i = 0; i < 4; i++) {
            I.on("Digit" + (i + 1), () => {
                const p = player();
                if (p && p.def.shellIds[i]) this.selectShell(p.def.shellIds[i]);
            });
        }
        I.on("KeyR", () => {
            const p = player();
            if (!p) return;
            if (p.repair) { p.cancelRepair(); this.hud.log("Ремонт отменён"); }
            else if (!p.startRepair()) this.hud.log("Ремонт не требуется");
        });
        I.on("KeyT", () => {
            const p = player();
            if (p && !p.useMedkit()) this.hud.log(p.medkits <= 0 ? "Аптечек нет" : "Раненых нет");
        });
        I.on("KeyF", () => {
            const p = player();
            if (!p) return;
            if (!p.fire) this.hud.log("Пожара нет");
            else if (!p.useExtinguisher()) this.hud.log("Огнетушителей не осталось", "bad");
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
                const ids = p.def.shellIds;
                const i = ids.indexOf(p.shell);
                this.selectShell(ids[(i + (dy > 0 ? 1 : ids.length - 1)) % ids.length]);
            } else {
                this.zoomH = clamp(this.zoomH * (dy > 0 ? 1.1 : 0.9), Config.CAMERA.MIN_H, Config.CAMERA.MAX_H);
            }
        });
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
        if (!blocked && I.mouse.left && !I.mouse.overUI) b.fire(p);
    }

    /** Точка прицеливания: деталь под курсором → центр её высоты; иначе — направление на землю */
    computeAim(dt) {
        const b = this.battle, p = b && b.player;
        const aim = this.aim;
        if (!p || p.dead) { aim.point = null; aim.pen = null; return; }
        const m = this.input.mouse;
        const ray = this.scene3d.screenRay(m.x, m.y);
        let best = null;
        for (const v of b.vehicles) {
            if (v === p) continue;
            if (!v.dead && v.team !== p.team && !v.visible[p.team]) continue;
            // широкая фаза: расстояние от луча до центра машины
            const cx = v.x - ray.o[0], cy = 1.2 - ray.o[1], cz = v.z - ray.o[2];
            const t = cx * ray.d[0] + cy * ray.d[1] + cz * ray.d[2];
            const px = ray.o[0] + ray.d[0] * t - v.x, py = ray.o[1] + ray.d[1] * t - 1.2, pz = ray.o[2] + ray.d[2] * t - v.z;
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
            aim.point = [best.hit.world[0], y, best.hit.world[2]];
            aim.cursor = best.hit.world;
            aim.ground = null;
            aim.target = v;
            aim.part = id;
            aim.dist = Math.hypot(aim.point[0] - mz[0], aim.point[2] - mz[2]);
        } else {
            const gp = this.scene3d.groundAt(m.x, m.y, 0);
            aim.target = null;
            if (gp) {
                const dx = gp[0] - p.x, dz = gp[2] - p.z;
                const dd = Math.hypot(dx, dz) || 1;
                const ext = Math.max(dd, 70);
                aim.point = [p.x + dx / dd * ext, 1.1, p.z + dz / dd * ext];
                aim.dist = dd;
                aim.ground = gp;
                aim.cursor = gp;
            }
        }
        // индикатор пробития (10 раз в секунду)
        aim.penT -= dt;
        if (aim.penT <= 0) {
            aim.penT = 0.1;
            aim.pen = null;
            const t = aim.target;
            if (t && !t.dead && t.team !== p.team && aim.point) {
                const s = SHELLS[p.shell];
                const dx = aim.point[0] - mz[0], dy = aim.point[1] - mz[1], dz = aim.point[2] - mz[2];
                const L = Math.hypot(dx, dy, dz) || 1;
                const tr = traceShot(s, t, mz, [dx / L, dy / L, dz / L], L + 10, L);
                if (tr.main) {
                    const ev = tr.main.ev;
                    if (s.type === "HE") aim.pen = { he: true, ok: tr.pen >= ev.eff, eff: ev.eff, pen: tr.pen, plate: ev.info.name, angle: ev.theta };
                    else aim.pen = { pen: tr.pen, eff: ev.eff, rico: ev.ricoP, plate: ev.info.name, angle: ev.theta };
                } else if (tr.layers.length) aim.pen = { pen: tr.pen, eff: 999, rico: 0, plate: tr.layers[0].ev.info.name, blocked: false };
            }
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
                if (k === "pen" || k === "he-pen") this.audio.say(r.killed ? "Цель уничтожена!" : "Пробитие!", 2);
                else if (k === "nopen") this.audio.say("Не пробил!", 1);
                else if (k === "rico") this.audio.say("Рикошет!", 1);
                if (r.events.includes("mod:track") && !r.killed) this.audio.say("Гусеница противника сбита!", 2);
                if (Settings.get("xray") && k !== "miss") {
                    this.hud.showXray(r, e.target);
                    this.lastXray = { res: r, target: e.target, incoming: false };
                }
                this.audio.impact(k === "he-pen" || k === "he" ? "pen" : k === "stopped" || k === "barrel" ? "nopen" : k, w[0], w[2], cal, true);
            } else if (isP(e.target)) {
                if (e.shooter) this.overlay.incomingHit(e.shooter.x, e.shooter.z, k === "he-pen" ? "pen" : k);
                this.audio.playerHit(k, cal);
                if (k === "pen" || k === "he-pen") { this.vignette(1); this.audio.say("Нас пробили!", 2); }
                else if (k === "rico") this.audio.say("Отскок!", 0);
                else if (k === "nopen") this.audio.say("Броня выдержала!", 0);
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
            if (v.static && b.mode === "range") { this.audio.say("Мишень поражена!", 1); }
            const vName = (v.isPlayer ? "Вы" : v.callsign) + ` <i>${v.def.name}</i>`;
            const kName = killer ? (killer.isPlayer ? "Вы" : killer.callsign) + ` <i>${killer.def.name}</i>` : "";
            const vc = v.team === b.playerTeam ? "a" : "e";
            const kc = killer ? (killer.team === b.playerTeam ? "a" : "e") : "";
            const cause = { ammo: "💥", crew: "✝", fire: "🔥" }[e.cause] || "✕";
            this.hud.feed(killer && killer !== v ? `<span class="${kc}">${kName}</span> ${cause} <span class="${vc}">${vName}</span>` : `<span class="${vc}">${vName}</span> ${cause}`, isP(killer) ? "mine" : isP(v) ? "me" : "");
            if (e.cause === "ammo") this.audio.detonation(v.x, v.z);
            else this.audio.explosion(v.x, v.z, 1.1);
            if (isP(killer) && v.team !== b.playerTeam) { this.audio.ui("good"); this.audio.say("Цель уничтожена!", 3); }
            if (isP(v)) {
                this.deathT = b.time;
                this.deathCause = CAUSE[e.cause] || e.cause;
                this.deathKiller = killer;
                this.hud.log("Машина потеряна: " + this.deathCause, "bad");
                this.hud.banner("МАШИНА УНИЧТОЖЕНА", (killer && killer !== v ? "уничтожил: " + killer.callsign + " · " + killer.def.name + " · " : "") + this.deathCause, "lose");
                this.vignette(1.4);
            }
        });
        Events.on("crewKO", (e) => {
            if (isP(e.v)) {
                this.hud.log(e.v.def.crewTitles[e.seat] + " выбыл", "bad");
                this.audio.say(VOICE_KO[e.seat] || "Потери в экипаже!", 3);
            }
        });
        Events.on("crewSwap", (e) => {
            if (!isP(e.v)) return;
            this.hud.log(`${CREW_SEATS[e.member.home].name} пересаживается: ${CREW_SEATS[e.to].name.toLowerCase()} (${e.dur.toFixed(1)} с)`, "swap");
            this.audio.say("Занимаю место " + (VOICE_SEAT[e.to] || "в экипаже") + "!", 2);
        });
        Events.on("crewSwapDone", (e) => { if (isP(e.v)) this.hud.log(`${CREW_SEATS[e.member.home].name} на месте: ${CREW_SEATS[e.to].name.toLowerCase()}`, "good"); });
        Events.on("modDestroyed", (e) => {
            if (!isP(e.v)) return;
            const t = e.type;
            const msg = { track: "Гусеница сбита!", engine: "Двигатель выведен!", transmission: "Трансмиссия выведена!", barrel: "Ствол уничтожен!", breech: "Казённик выведен!", ammo: "Боеукладка разбита!", drive: "Поворотный механизм выведен!", fuel: "Бак пробит!" }[t];
            if (msg) { this.hud.log(msg, "bad"); this.audio.say(msg, t === "track" || t === "engine" ? 3 : 2); }
            if (t === "track") this.audio.trackBreak();
        });
        Events.on("fireStart", (e) => {
            const b = B();
            if (!b) return;
            if (isP(e.v)) { this.hud.log("ПОЖАР! Жми [F]", "fire"); this.audio.say("Пожар! Горим!", 4); }
            else if (isP(e.by)) { this.hud.feed(`<span class="e">${e.v.callsign} <i>${e.v.def.name}</i></span> горит`, "mine"); this.audio.say("Противник горит!", 1); }
        });
        Events.on("fireOut", (e) => {
            if (!isP(e.v)) return;
            this.hud.log(e.ext ? "Пожар потушен" : "Пожар погас", "good");
            if (e.ext) this.audio.extinguisher();
        });
        Events.on("repairStart", (e) => { if (isP(e.v)) { this.hud.log(`Ремонт: ${e.dur.toFixed(0)} с. Машина неподвижна`, "warn"); this.audio.repairTick(); } });
        Events.on("repairDone", (e) => { if (isP(e.v)) { this.hud.log("Ремонт завершён", "good"); this.audio.say("Ремонт закончен!", 2); } });
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
            if (isP(e.v)) { this.hud.log("Артиллерия: огонь по квадрату!", "good"); this.audio.say("Артиллерия, огонь!", 2); this.audio.radio(); }
            else if (e.v.team !== b.playerTeam) {
                const p = b.player;
                if (p && !p.dead && Math.hypot(p.x - e.strike.x, p.z - e.strike.z) < e.strike.r + 18) { this.hud.log("АРТОБСТРЕЛ! Уходите из зоны", "bad"); this.audio.say("Артобстрел! Уходим!", 4); }
            }
        });
        Events.on("artyShell", (e) => { if (B()) this.audio.whistle(e.x, e.z); });
        Events.on("waveStart", (e) => { this.hud.banner("ВОЛНА " + e.n, "противников: " + e.count); this.audio.say("Противник на подходе!", 2); });
        Events.on("waveClear", (e) => { this.hud.banner("ВОЛНА " + e.n + " ОТБИТА", "полевой ремонт и пополнение"); this.audio.ui("good"); });
        Events.on("playerSpawn", () => { });
        Events.on("battleEnd", (r) => {
            this.hud.banner(r.win ? "ПОБЕДА" : "ПОРАЖЕНИЕ", r.reason, r.win ? "win" : "lose");
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
        const offset = this.screens.current === "hangarScr" ? 0.045 : this.screens.current === "menu" ? 0.2 : 0;
        this.hangar.render(dt, offset);
    }

    frameBattle(dt) {
        const b = this.battle;
        const running = !this.paused && !this.screens.modalOpen;
        const sdt = running ? dt : 0;
        if (running) {
            this.computeAim(dt);
            this.updatePlayer(dt);
            b.update(dt);
        }
        const p = b.player;
        // фокус камеры
        let aimForCam = null;
        if (p && !p.dead) {
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
        const binoc = this.input.mouse.right && running;
        this.scene3d.updateCamera(dt, this.focus, aimForCam, binoc, this.zoomH);
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
        if (running && !b.ended && (!p || p.dead) && p && b.time - this.deathT > 3.6 && $("spawnScr").classList.contains("hidden")) {
            const killer = this.deathKiller;
            this.screens.openSpawn({
                title: "МАШИНА УНИЧТОЖЕНА", dead: true,
                cause: "Причина: <b>" + (this.deathCause || "") + "</b>" + (killer ? " · уничтожил: " + (killer.isPlayer ? "вы" : killer.callsign + " (" + killer.def.name + ")") : ""),
            });
        }
    }
}

