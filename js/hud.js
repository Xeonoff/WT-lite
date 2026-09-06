import { G } from "./state.js";
import { WORLD, MNAMES, CREW_SHORT, MOD_LIST, CLASSES, RESPAWN_COSTS } from "./data.js";
import { $, clamp } from "./utils.js";
import { mkTank, reloadTime, getCurrentShell } from "./entities.js";
import { sfx } from "./audio.js";
import { genWorld } from "./world.js";
import { drawTopScheme, drawTankPreview } from "./render.js";

export function addFeed(txt, cls = "") {
    const f = document.createElement("div");
    f.className = "fitem " + cls;
    f.textContent = txt;
    const feed = $("feed");
    if (!feed) return;
    feed.prepend(f);
    while (feed.children.length > 6) feed.lastChild.remove();
    setTimeout(() => f.remove(), 6500);
}

export function floater(x, y, txt, col) {
    G.floaters.push({ x, y, txt, col, t: 0 });
}

export function showXR(title, sub, shellTxt, tank, res, kind) {
    G.xr = {
        t: 0,
        dur: 1.9,
        title,
        kind,
        cls: tank.cls,
        res,
        snap: tank.cls.schema.mods.map((m) => {
            const inst = tank.mods[m.t];
            return { t: m.t, x: m.x, y: m.y, r: m.r, hp: inst.hp, max: inst.max };
        }),
    };
    $("xrTitle").textContent = title;
    $("xrTitle").className = kind === "pen" || kind === "det" ? "" : "nr";
    $("xrShell").textContent = shellTxt;
    $("xrSub").innerHTML = sub;
    $("xr").classList.add("show");
}

export function hideXR() {
    $("xr").classList.remove("show");
    G.xr = null;
}

export function banner(t, s) {
    $("bnT").textContent = t;
    $("bnS").textContent = s;
    const b = $("banner");
    b.classList.remove("show");
    void b.offsetWidth;
    b.classList.add("show");
}

export function startWave(n) {
    G.wave = n;
    G.waveState = "announce";
    G.waveT = 2.2;
    $("statWave").textContent = n;
    banner("ВОЛНА " + n, ["приготовиться", "противник на подходе", "держать позицию"][n % 3]);
}

export function spawnWave(n) {
    import("./world.js").then(({ freeSpot }) => {
        const total = Math.min(3 + n, 9);
        let missiles = n >= 4 ? Math.min(2, Math.floor((n - 2) / 3)) : 0;
        let heavies = n >= 3 ? Math.min(3, Math.floor((n - 1) / 2)) : 0;
        let lights = n <= 3 ? 2 : n % 2;
        const meds = Math.max(1, total - heavies - lights - missiles);
        const list = [];
        for (let i = 0; i < missiles; i++) list.push("missile");
        for (let i = 0; i < heavies; i++) list.push("heavy");
        for (let i = 0; i < lights; i++) list.push("light");
        for (let i = 0; i < meds; i++) list.push("med");
        for (const c of list) {
            const p = freeSpot(800);
            G.spawnQ.push({ x: p.x, y: p.y, cls: c, t: rnd(0.5, 2.2) });
        }
    });
}
import { rnd } from "./utils.js";

export function tryRepair(kind) {
    const p = G.player;
    if (!p || p.dead || p.repair) return;
    if (kind === "crew") {
        const crew = p.cls.schema.mods
            .filter((m) => ["driver", "gunner", "loader", "commander"].includes(m.t))
            .map((m) => ({ k: m.t, m: p.mods[m.t] }))
            .sort((a, b) => a.m.hp / a.m.max - b.m.hp / b.m.max)[0];
        if (!crew || crew.m.hp >= crew.m.max) return;
        p.repair = { kind: "crew", target: crew.k, t: 0, dur: 3 };
        sfx("repair");
    } else {
        const order = ["gun", "engine", "ring"];
        const tg = order
            .map((k) => ({ k, m: p.mods[k] }))
            .filter((o) => o.m.hp < o.m.max)
            .sort((a, b) => a.m.hp / a.m.max - b.m.hp / b.m.max)[0];
        if (!tg) return;
        p.repair = { kind: "module", target: tg.k, t: 0, dur: 5 };
        sfx("repair");
    }
}

export function useExtinguisher() {
    if (!G.player || G.player.fext > 0 || G.player.burning <= 0) return;
    G.player.burning = 0;
    G.player.fext = 9;
    addFeed("Огонь потушен", "good");
    sfx("thud", 0.4);
}

export function selectShell(i) {
    if (!G.player) return;
    if (i >= G.player.cls.shells.length) return;
    if (G.curShell === i) return;
    G.curShell = i;
    sfx("click");
    for (let k = 0; k < G.player.cls.shells.length; k++)
        $("sh" + k).classList.toggle("active", k === i);
    $("rLbl").textContent = G.player.cls.shells[i].name;
    G.player.reload = Math.max(G.player.reload, reloadTime(G.player) * 0.4);
}

export function buildDamagePanel() {
    $("tankNameHdr").textContent = G.player.cls.name + " · СОСТОЯНИЕ МАШИНЫ";
    const cr = $("crewRow");
    cr.innerHTML = "";
    G.crewCells = {};
    G.player.cls.schema.mods
        .filter((m) => ["driver", "gunner", "loader", "commander"].includes(m.t))
        .forEach((m) => {
            const d = document.createElement("div");
            d.className = "crew";
            d.title = MNAMES[m.t];
            d.innerHTML =
                `<div class="cdot"></div><div class="cname">${CREW_SHORT[m.t]}</div><div class="chp"><i></i></div>`;
            cr.appendChild(d);
            G.crewCells[m.t] = d;
        });

    const mr = $("modRow");
    mr.innerHTML = "";
    G.modCells = {};
    MOD_LIST.forEach(([k, n]) => {
        const d = document.createElement("div");
        d.className = "mod";
        d.title = MNAMES[k];
        d.innerHTML = `<i></i>${n}`;
        mr.appendChild(d);
        G.modCells[k] = d;
    });
}

export function syncDamagePanel() {
    const p = G.player;
    if (!p) return;
    for (const k in G.crewCells) {
        const m = p.mods[k], el = G.crewCells[k];
        el.querySelector(".chp i").style.width = (m.hp / m.max * 100) + "%";
        el.className = "crew " + (m.hp <= 0 ? "bad dead" : (m.hp < m.max * 0.6 ? "warn" : ""));
        el.title = MNAMES[k] + ": " + (m.hp <= 0 ? "убит" : Math.round(m.hp) + " / " + m.max);
    }
    for (const k in G.modCells) {
        const m = p.mods[k], el = G.modCells[k];
        el.className = "mod " + (m.hp <= 0 ? "bad" : (m.hp < m.max * 0.6 ? "warn" : ""));
        el.title = MNAMES[k] + ": " + Math.round(m.hp) + " / " + m.max;
    }
    let html = "";
    if (p.burning > 0) html += `<span class="alert fire">ПОЖАР — ЖМИ [F]</span>`;
    if (p.mods.engine.hp <= 0) html += `<span class="alert bad">ОБЕЗДВИЖЕН</span>`;
    else if (p.mods.driver.hp <= 0) html += `<span class="alert bad">НЕТ МЕХВОДА</span>`;
    if (p.mods.gun.hp <= 0) html += `<span class="alert bad">НЕТ ОРУДИЯ</span>`;
    $("alerts").innerHTML = html;

    $("consR").classList.toggle("active", !!(p.repair && p.repair.kind === "module"));
    $("consRf").style.width =
        p.repair && p.repair.kind === "module"
            ? (p.repair.t / p.repair.dur * 100) + "%"
            : "0%";
    $("consT").classList.toggle("active", !!(p.repair && p.repair.kind === "crew"));
    $("consTf").style.width =
        p.repair && p.repair.kind === "crew"
            ? (p.repair.t / p.repair.dur * 100) + "%"
            : "0%";
    const fReady = p.fext <= 0;
    $("consFf").style.width = fReady ? "0%" : (p.fext / 9 * 100) + "%";
    $("consF").classList.toggle("readyF", p.burning > 0 && fReady);
    $("consFt").textContent = fReady ? "" : Math.ceil(p.fext) + "с";
}

let hudT = 0;
export function updHUD(dt) {
    hudT -= dt;
    if (hudT > 0) return;
    hudT = 0.1;
    $("statKills").textContent = G.kills;
    $("statScore").querySelector(".v").textContent = G.score;
    const p = G.player;
    if (!p) return;
    const rt = reloadTime(p);
    const pr = p.mods.gun.hp <= 0 ? 0 : 1 - clamp(p.reload / rt, 0, 1);
    $("rfill").style.width = (pr * 100) + "%";
    const shell = getCurrentShell(p);
    $("rtext").textContent =
        p.mods.gun.hp <= 0
            ? "ОРУДИЕ ВЫВЕДЕНО — ремонт (R)"
            : p.reload > 0
                ? p.reload.toFixed(1) + " с"
                : "ГОТОВ · " + shell.name;
    $("rLbl").textContent = shell.name;
    syncDamagePanel();
}

export function togglePause() {
    if (G.state === "play") {
        G.state = "pause";
        $("pause").classList.remove("hidden");
    } else if (G.state === "pause") {
        G.state = "play";
        $("pause").classList.add("hidden");
    }
}

export function startGame() {
    import("./audio.js").then(({ initAudio }) => {
        initAudio();
        genWorld();
        G.player = mkTank("med", WORLD / 2, WORLD / 2, true);
        buildDamagePanel();
        buildShellUI();
        G.enemies = [];
        G.shells = [];
        G.parts = [];
        G.debris = [];
        G.floaters = [];
        G.spawnQ = [];
        G.tracks = [];
        G.wave = 0;
        G.kills = 0;
        G.pens = 0;
        G.score = 0;
        G.overT = 0;
        G.gameT = 0;
        G.selectedTank = null;
        $("feed").innerHTML = "";
        $("hud").classList.add("on");
        $("menu").classList.add("hidden");
        $("over").classList.add("hidden");
        $("pause").classList.add("hidden");
        G.state = "play";
        hideXR();
        startWave(1);
        G.CAM.x = G.player.x;
        G.CAM.y = G.player.y;
    });
}

export function showOver() {
    G.best = Math.max(G.best, G.wave);
    localStorage.setItem("sg_best", G.best);
    $("bestV").textContent = G.best;
    $("overCause").textContent = "причина: " + G.overCause;
    $("overStats").innerHTML = [
        ["Достигнутая волна", G.wave],
        ["Уничтожено танков", G.kills],
        ["Пробитий", G.pens],
        ["Очки", G.score],
        ["Рекорд (волна)", G.best],
    ]
        .map(([k, v]) => `<div class="orow"><span>${k}</span><b>${v}</b></div>`)
        .join("");
    $("over").classList.remove("hidden");
}
export function showRespawnMenu() {
    $("respawnCause").textContent = "причина: " + G.overCause;
    $("respawnScore").textContent = G.score;
    $("respawnWave").textContent = G.wave;

    const container = $("tankOptions");
    container.innerHTML = "";

    const order = ["light", "med", "heavy", "missile"];
    for (const cls of order) {
        const c = CLASSES[cls];
        const cost = RESPAWN_COSTS[cls];
        const affordable = G.score >= cost;

        const card = document.createElement("div");
        card.className = "tankCard" + (affordable ? "" : " disabled");
        card.dataset.cls = cls;
        card.innerHTML = `
      <canvas class="tcCv" width="220" height="64"></canvas>
      <div class="tcName">${c.name}</div>
      <div class="tcKind">${c.kind}</div>
      <div class="tcStats">
        <span>Броня лба: <b>${c.armor.front} мм</b></span>
        <span>Скорость: <b>${c.speed}</b></span>
        <span>Пробитие: <b>${c.shells[0].pen} мм</b></span>
        <span>Перезарядка: <b>${c.shells[0].reload} с</b></span>
      </div>
      <div class="tcCost">${cost} очков</div>
    `;
        if (affordable) {
            card.addEventListener("click", () => selectTankForRespawn(cls));
        }
        container.appendChild(card);
        drawTankPreview(card.querySelector(".tcCv").getContext("2d"), c, 220, 64);
    }

    G.selectedTank = null;
    $("btnRespawn").disabled = true;
    $("respawn").classList.remove("hidden");
}

export function selectTankForRespawn(cls) {
    G.selectedTank = cls;
    document.querySelectorAll(".tankCard").forEach(c => c.classList.remove("selected"));
    const card = document.querySelector(`.tankCard[data-cls="${cls}"]`);
    if (card) card.classList.add("selected");
    $("btnRespawn").disabled = false;
}

export function startRespawn() {
    if (!G.selectedTank) return;
    const cost = RESPAWN_COSTS[G.selectedTank];
    if (G.score < cost) return;

    G.score -= cost;
    $("respawn").classList.add("hidden");

    import("./world.js").then(({ freeSpot }) => {
        import("./entities.js").then(({ mkTank }) => {
            const spot = freeSpot(600);
            G.player = mkTank(G.selectedTank, spot.x, spot.y, true);
            G.state = "play";
            G.overT = 0;
            G.overCause = "";
            G.curShell = 0;
            buildDamagePanel();
            buildShellUI();
            G.CAM.x = G.player.x;
            G.CAM.y = G.player.y;
        });
    });
}

export function endBattle() {
    $("respawn").classList.add("hidden");
    showOver();
}
export function drawXRAnim() {
    if (!G.xr) return;
    const c = $("xrCv");
    if (!c) return;
    const g = c.getContext("2d");
    g.setTransform(2, 0, 0, 2, 0, 0);
    g.clearRect(0, 0, 560, 262);
    const fake = { mods: {} };
    G.xr.snap.forEach((m) => { fake.mods[m.t] = { hp: m.hp, max: m.max }; });
    drawTopScheme(g, 250, 131, 2.0, G.xr.cls, fake, G.xr.res, clamp(G.xr.t / 0.5, 0, 1));
}

export function buildShellUI() {
    const box = $("shells");
    box.innerHTML = "";
    if (!G.player) return;
    G.player.cls.shells.forEach((s, i) => {
        const d = document.createElement("div");
        d.className = "shell panel cut";
        d.id = "sh" + i;
        d.innerHTML = `<span class="key">${i + 1}</span><div class="n">${s.name}</div><div class="d">${s.type}</div><div class="p">▮ ${s.pen} мм</div>`;
        box.appendChild(d);
    });
    G.curShell = 0;
    if (box.children.length > 0) box.children[0].classList.add("active");
}