import { $ } from "../core/Utils.js";
import { Settings } from "../core/Settings.js";
import { Profile, LINEUP_MAX } from "../core/Profile.js";
import { Events } from "../core/Events.js";
import { NATIONS, ROLES, ROLE_ORDER } from "../data/Vehicles.js";
import { ALL_VEHICLES, getVehicle, vehiclesOf } from "../data/VehicleBuild.js";
import { SHELLS, SHELL_TYPES } from "../data/Shells.js";
import { MAPS, MAP_ORDER, MODES, WEATHER, BIOME_WEATHER } from "../data/Maps.js";
import { drawScheme, freshSnap } from "../render/Xray.js";
import { REFERENCE } from "./Reference.js";

const SCREENS = ["menu", "hangarScr", "spawnScr", "pauseScr", "resultScr", "settingsScr", "refScr", "loading"];

export class Screens {
    constructor(game) {
        this.game = game;
        this.sel = { mode: Profile.data.lastMode || "domination", map: Profile.data.lastMap || "random", weather: "random" };
        this.hangarSel = null;
        this.hangarNation = Profile.data.nation;
        this.modal = [];
        this.bindStatic();
        Events.on("profile", () => { if (this.current === "menu") this.renderMenu(); });
    }

    show(id) {
        for (const s of SCREENS) if (!["settingsScr", "refScr"].includes(s)) $(s).classList.toggle("hidden", s !== id);
        this.current = id;
        document.body.classList.toggle("inMenu", id === "menu" || id === "hangarScr");
        if (id === "menu") this.renderMenu();
        if (id === "hangarScr") this.renderHangar();
    }
    hideAll() {
        for (const s of SCREENS) if (!["settingsScr", "refScr"].includes(s)) $(s).classList.add("hidden");
        this.current = null;
        document.body.classList.remove("inMenu");
    }
    openModal(id) {
        $(id).classList.remove("hidden");
        if (!this.modal.includes(id)) this.modal.push(id);
        if (id === "settingsScr") this.renderSettings();
        if (id === "refScr") this.renderRef(this.refTab || "damage");
    }
    closeModal() {
        const id = this.modal.pop();
        if (id) $(id).classList.add("hidden");
        return !!id;
    }
    get modalOpen() { return this.modal.length > 0; }

    click() { this.game.audio.init(); this.game.audio.ui("click"); }

    bindStatic() {
        document.addEventListener("click", (e) => {
            const t = e.target.closest("[data-act]");
            if (!t) return;
            this.click();
            const act = t.dataset.act;
            const g = this.game;
            switch (act) {
                case "play": this.startBattle(); break;
                case "hangar": this.show("hangarScr"); break;
                case "menu": this.show("menu"); break;
                case "settings": this.openModal("settingsScr"); break;
                case "ref": this.openModal("refScr"); break;
                case "closeModal": this.closeModal(); break;
                case "resume": g.resume(); break;
                case "leave": g.leaveBattle(); break;
                case "again": this.startBattle(); break;
                case "toHangar": g.toMenu("hangarScr"); break;
                case "toMenu": g.toMenu("menu"); break;
                case "spawn": if (this.spawnSel) g.spawn(this.spawnSel); break;
                case "change": g.resume(); this.openSpawn({ title: "СМЕНА ТЕХНИКИ" }); break;
                case "nation": Profile.setNation(t.dataset.v); this.hangarNation = t.dataset.v; this.renderMenu(); break;
                case "mode": this.sel.mode = t.dataset.v; this.renderMenu(); break;
                case "hNation": this.hangarNation = t.dataset.v; this.hangarSel = null; this.renderHangar(); break;
                case "hSel": this.hangarSel = t.dataset.v; this.renderHangar(); break;
                case "research": if (Profile.research(t.dataset.v)) { g.audio.ui("good"); this.renderHangar(); } else g.audio.ui("bad"); break;
                case "lineup": Profile.toggleLineup(t.dataset.v); this.renderHangar(); break;
                case "testdrive": this.testDrive(t.dataset.v); break;
                case "spSel": this.spawnSel = t.dataset.v; this.renderSpawn(); break;
                case "refTab": this.renderRef(t.dataset.v); break;
                case "resetProgress": if (confirm("Сбросить весь прогресс исследований?")) { Profile.reset(); this.renderSettings(); } break;
                case "resetSettings": Settings.reset(); this.renderSettings(); break;
            }
        });
        document.addEventListener("mouseover", (e) => {
            if (e.target.closest && e.target.closest("button, .card, .tcard") && this.game.audio.ready) this.game.audio.ui("hover");
        });
        $("mapSel").addEventListener("change", (e) => { this.sel.map = e.target.value; this.renderMenu(); });
        $("wxSel").addEventListener("change", (e) => { this.sel.weather = e.target.value; });
    }

    /* ─────────── Главное меню ─────────── */
    renderMenu() {
        const d = Profile.data;
        const nation = d.nation;
        $("profChips").innerHTML = Object.values(NATIONS).map((n) =>
            `<span class="chipx ${n.id === nation ? "on" : ""}" data-act="nation" data-v="${n.id}">${n.name} · <b>${d.rp[n.id]}</b> ОИ</span>`).join("") +
            `<span class="chipx stat">боёв <b>${d.stats.battles}</b> · побед <b>${d.stats.wins}</b> · уничтожено <b>${d.stats.kills}</b> · рекорд волн <b>${d.bestWave}</b></span>`;
        $("modeCards").innerHTML = Object.entries(MODES).map(([id, m]) =>
            `<div class="card mode ${this.sel.mode === id ? "on" : ""}" data-act="mode" data-v="${id}"><div class="mn">${m.name}</div><div class="ms">${m.short}</div><div class="md">${m.desc}</div></div>`).join("");
        const ms = $("mapSel");
        ms.innerHTML = `<option value="random">Случайная карта</option>` + MAP_ORDER.map((id) => `<option value="${id}">${MAPS[id].name} · ${MAPS[id].biome === "summer" ? "лето" : MAPS[id].biome === "winter" ? "зима" : "пустыня"}</option>`).join("");
        ms.value = this.sel.map;
        const wx = $("wxSel");
        const pool = this.sel.map === "random" ? Object.keys(WEATHER) : [...new Set(BIOME_WEATHER[MAPS[this.sel.map].biome])];
        if (this.sel.weather !== "random" && !pool.includes(this.sel.weather)) this.sel.weather = "random";
        wx.innerHTML = `<option value="random">Случайная</option>` + pool.map((id) => `<option value="${id}">${WEATHER[id].name}</option>`).join("");
        wx.value = this.sel.weather;
        const lu = Profile.lineup(nation);
        $("pChange").classList.add("hidden");
        $("lineupPrev").innerHTML = lu.map((id) => {
            const v = getVehicle(id);
            return `<div class="lslot"><img src="${this.game.hangar.thumbnail(id)}" alt=""><b>${v.name}</b><span>${ROLES[v.role].short} · БР ${v.br.toFixed(1)}</span></div>`;
        }).join("") + Array(Math.max(0, LINEUP_MAX - lu.length)).fill(`<div class="lslot empty" data-act="hangar">+</div>`).join("");
        const br = lu.length ? Math.max(...lu.map((id) => getVehicle(id).br)) : 0;
        $("lineupBR").textContent = "Боевой рейтинг сетапа: " + br.toFixed(1) + " · противник: " + NATIONS[nation === "ussr" ? "germany" : "ussr"].name;
        $("mapNote").textContent = this.sel.map === "random" ? "" : MAPS[this.sel.map].desc;
        this.game.hangar.show(Profile.data.lastVehicle[nation] && Profile.isResearched(Profile.data.lastVehicle[nation]) ? Profile.data.lastVehicle[nation] : lu[0]);
    }

    startBattle() {
        const nation = Profile.data.nation;
        const lineup = Profile.lineup(nation);
        if (!lineup.length) { this.show("hangarScr"); return; }
        let map = this.sel.map;
        if (map === "random") map = MAP_ORDER[Math.floor(Math.random() * MAP_ORDER.length)];
        Profile.data.lastMode = this.sel.mode;
        Profile.data.lastMap = this.sel.map;
        Profile.save();
        this.game.startBattle({ mode: this.sel.mode, mapId: map, nation, lineup, weather: this.sel.weather, difficulty: Settings.get("difficulty") });
    }

    testDrive(id) {
        const v = getVehicle(id);
        let map = this.sel.map === "random" ? MAP_ORDER[Math.floor(Math.random() * MAP_ORDER.length)] : this.sel.map;
        const all = vehiclesOf(v.nation).sort((a, b) => a.br - b.br).map((q) => q.id);
        this.game.startBattle({ mode: "range", mapId: map, nation: v.nation, lineup: all, firstVehicle: id, difficulty: Settings.get("difficulty") });
    }

    /* ─────────── Ангар ─────────── */
    renderHangar() {
        const nation = this.hangarNation;
        const d = Profile.data;
        $("hNations").innerHTML = Object.values(NATIONS).map((n) =>
            `<button class="tab ${n.id === nation ? "on" : ""}" data-act="hNation" data-v="${n.id}">${n.name}</button>`).join("") +
            `<span class="rp">Очки исследований: <b>${d.rp[nation]}</b></span>`;
        const list = vehiclesOf(nation);
        const lineup = Profile.lineup(nation);
        let html = `<div class="trow head"><div class="rk"></div>${ROLE_ORDER.map((r) => `<div class="rh">${ROLES[r].icon} ${ROLES[r].name}</div>`).join("")}</div>`;
        for (const rank of [1, 2, 3]) {
            const open = Profile.rankOpen(nation, rank);
            html += `<div class="trow"><div class="rk ${open ? "" : "locked"}">${["", "I", "II", "III"][rank]}<small>ранг</small></div>`;
            for (const role of ROLE_ORDER) {
                const vs = list.filter((v) => v.rank === rank && v.role === role);
                html += `<div class="tcell">` + vs.map((v) => {
                    const res = Profile.isResearched(v.id);
                    const inL = lineup.includes(v.id);
                    const st = res ? (inL ? "в сетапе" : "исследована") : open ? Profile.cost(v.id) + " ОИ" : "закрыто";
                    return `<div class="tcard ${res ? "res" : open ? "can" : "lock"} ${inL ? "inl" : ""} ${this.hangarSel === v.id ? "on" : ""}" data-act="hSel" data-v="${v.id}">
                        <img src="${this.game.hangar.thumbnail(v.id)}" alt=""><b>${v.name}</b><span>БР ${v.br.toFixed(1)} · ${st}</span></div>`;
                }).join("") + `</div>`;
            }
            html += `</div>`;
        }
        $("tree").innerHTML = html;
        if (!this.hangarSel || getVehicle(this.hangarSel).nation !== nation) this.hangarSel = lineup[0] || list[0].id;
        this.renderDetail(this.hangarSel);
        $("hLineup").innerHTML = `<span class="lbl">СЕТАП (${lineup.length}/${LINEUP_MAX})</span>` + lineup.map((id) => {
            const v = getVehicle(id);
            return `<div class="lslot sm" data-act="hSel" data-v="${id}"><img src="${this.game.hangar.thumbnail(id)}" alt=""><b>${v.name}</b></div>`;
        }).join("");
        this.game.hangar.show(this.hangarSel);
        d.lastVehicle[nation] = this.hangarSel;
    }

    renderDetail(id) {
        const v = getVehicle(id);
        const res = Profile.isResearched(id);
        const inL = Profile.lineup(v.nation).includes(id);
        const A = v.armor;
        const arm = (a) => `${a[0]}${a[1] ? "<small>/" + a[1] + "°</small>" : ""}`;
        const crew = v.crew.map((s) => v.crewTitles[s]).join(", ");
        const shells = v.shells.map(([sid, n]) => {
            const s = SHELLS[sid], T = SHELL_TYPES[s.type];
            return `<tr><td><b>${s.name}</b></td><td style="color:${T.color}">${T.short}</td><td>${s.type === "HE" ? "ОФ " + s.pen[0] : s.pen[0] + " / " + s.pen[1]} мм</td><td>${Math.round(s.vel)} м/с</td><td>×${n}</td></tr>`;
        }).join("");
        const can = Profile.canResearch(id);
        $("hDetail").innerHTML = `
            <div class="dh"><div><h2>${v.name}</h2><div class="sub">${NATIONS[v.nation].name} · ${ROLES[v.role].name} · ранг ${["", "I", "II", "III"][v.rank]} · <b>БР ${v.br.toFixed(1)}</b></div></div></div>
            <p class="desc">${v.desc}</p>
            ${(() => { const st = Profile.data.vstats && Profile.data.vstats[id]; return st ? `<div class="vst">В боях: <b>${st.spawns}</b> выездов · уничтожено <b>${st.kills}</b></div>` : ""; })()}
            <canvas id="hScheme" width="680" height="260"></canvas>
            <table class="stats">
                <tr><th>Броня корпуса</th><td>лоб ${arm(A.hull.front)} · борт ${arm(A.hull.side)} · корма ${arm(A.hull.rear)} мм</td></tr>
                <tr><th>${v.turret.casemate ? "Броня рубки" : "Броня башни"}</th><td>лоб ${arm(A.turret.front)} · борт ${arm(A.turret.side)} · корма ${arm(A.turret.rear)} мм${v.turret.open ? " · <span class='warn'>открыта сверху</span>" : ""}</td></tr>
                <tr><th>Подвижность</th><td>${v.mob.speed} км/ч вперёд · ${v.mob.reverse} назад · ${v.mob.pw} л.с./т · ${v.engine.type === "diesel" ? "дизель" : "бензин"}</td></tr>
                <tr><th>Наводка</th><td>корпус ${v.mob.hull}°/с · ${v.turret.casemate ? "рубка ±" + v.turret.arc + "°, " : "башня "}${(v.mob.turret * 1.5).toFixed(0)}°/с</td></tr>
                <tr><th>Орудие</th><td>${v.gun.name} ${v.gun.cal} мм · ${v.gun.mag > 1 ? "магазин " + v.gun.mag + ", " : ""}перезарядка ${v.gun.reload} с · сведение ${v.gun.aim} с</td></tr>
                <tr><th>Экипаж (${v.crew.length})</th><td>${crew}</td></tr>
            </table>
            <table class="shells"><tr><th>Снаряд</th><th>Тип</th><th>Пробитие 10/1000 м</th><th>Скорость</th><th>БК</th></tr>${shells}</table>
            <div class="btnrow">
                ${res ? `<button class="big" data-act="lineup" data-v="${id}">${inL ? "УБРАТЬ ИЗ СЕТАПА" : "В СЕТАП"}</button>` :
                    `<button class="big" data-act="research" data-v="${id}" ${can ? "" : "disabled"}>ИССЛЕДОВАТЬ · ${Profile.cost(id)} ОИ</button>`}
                <button class="ghost" data-act="testdrive" data-v="${id}">ТЕСТ-ДРАЙВ</button>
            </div>
            ${!res && !Profile.rankOpen(v.nation, v.rank) ? `<div class="note">Откройте любую машину ранга ${["", "I", "II", "III"][v.rank - 1]}, чтобы исследовать этот ранг.</div>` : ""}`;
        const cv = $("hScheme");
        const g = cv.getContext("2d");
        g.setTransform(2, 0, 0, 2, 0, 0);
        drawScheme(g, { def: v, snap: freshSnap(v), x: 0, y: 0, w: 340, h: 130, labels: true });
    }

    /* ─────────── Выбор техники в бою ─────────── */
    openSpawn(opts = {}) {
        this.spawnOpts = opts;
        const b = this.game.battle;
        if (!this.spawnSel || !b.canSpawn(this.spawnSel).ok) {
            const ok = b.lineup.find((l) => b.canSpawn(l.id).ok);
            this.spawnSel = ok ? ok.id : null;
        }
        this.renderSpawn();
        $("spawnScr").classList.remove("hidden");
        this.current = "spawnScr";
    }
    closeSpawn() { $("spawnScr").classList.add("hidden"); if (this.current === "spawnScr") this.current = null; }

    renderSpawn() {
        const b = this.game.battle;
        if (!b) return;
        const o = this.spawnOpts || {};
        $("spTitle").textContent = o.title || "ВЫБОР ТЕХНИКИ";
        $("spTitle").className = o.dead ? "bad" : "";
        $("spCause").innerHTML = (o.cause ? o.cause + "<br>" : "") + (b.mode === "range" ? "Полигон: любая машина бесплатно" : b.spawns === 0 ? "Первый выезд бесплатный. Следующие — за очки возрождения (ОВ): попадания, крит. повреждения, уничтожения, захват точек." : "Не хватает ОВ? Через " + 25 + " с после гибели неиспользованная машина выедет из резерва бесплатно.");
        $("spSP").textContent = b.mode === "range" ? "∞" : b.sp;
        $("spCards").innerHTML = b.lineup.map((l) => {
            const v = getVehicle(l.id);
            const c = b.canSpawn(l.id);
            const cost = b.spawnCost(l.id);
            const st = c.ok ? (c.reserve ? "резервный выезд" : cost ? cost + " ОВ" : "бесплатно") : c.reason;
            return `<div class="card sp ${c.ok ? "" : "dis"} ${this.spawnSel === l.id ? "on" : ""}" ${c.ok ? `data-act="spSel" data-v="${l.id}"` : ""}>
                <img src="${this.game.hangar.thumbnail(l.id)}" alt=""><b>${v.name}</b><span>${ROLES[v.role].short} · БР ${v.br.toFixed(1)}</span><em>${st}</em></div>`;
        }).join("");
        $("spGo").disabled = !this.spawnSel || !b.canSpawn(this.spawnSel).ok;
        $("spNone").classList.toggle("hidden", b.hasSpawnsLeft());
    }

    /* ─────────── Итоги ─────────── */
    showResults(r, extra) {
        const s = r.stats;
        $("resTitle").textContent = r.win ? "ПОБЕДА" : "ПОРАЖЕНИЕ";
        $("resTitle").className = r.win ? "win" : "lose";
        $("resReason").textContent = r.reason || "";
        const rows = [
            ["Уничтожено", s.kills], ["Помощь", s.assists], ["Попаданий", s.hits + " / " + s.shots],
            ["Пробитий", s.pens], ["Критических", s.crits], ["Захватов", s.caps],
        ];
        if (r.mode === "waves") rows.unshift(["Отбито волн", s.wave]);
        rows.push(["Потеряно машин", s.deaths]);
        $("resStats").innerHTML = rows.map(([k, v]) => `<div class="orow"><span>${k}</span><b>${v}</b></div>`).join("");
        $("resRP").innerHTML = r.mode === "range" ? "Полигон не приносит очков исследования" :
            `Очки исследований: <b>+${s.rp}</b> (${NATIONS[extra.nation].name}) · всего <b>${Profile.data.rp[extra.nation]}</b>` + (extra.next ? `<br><span class="hint">Следующая цель: ${extra.next}</span>` : "");
        $("resultScr").classList.remove("hidden");
        this.current = "resultScr";
    }

    /* ─────────── Настройки ─────────── */
    renderSettings() {
        const S = Settings.all();
        const slider = (k, label, min, max, step, fmt) =>
            `<label class="set"><span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${S[k]}" data-k="${k}"><em>${fmt(S[k])}</em></label>`;
        const toggle = (k, label) => `<label class="set tg"><span>${label}</span><input type="checkbox" ${S[k] ? "checked" : ""} data-k="${k}"><i></i></label>`;
        const select = (k, label, opts) => `<label class="set"><span>${label}</span><select data-k="${k}">${opts.map(([v, t]) => `<option value="${v}" ${S[k] === v ? "selected" : ""}>${t}</option>`).join("")}</select></label>`;
        const pct = (v) => Math.round(v * 100) + "%";
        $("setBody").innerHTML = `
            <div class="sgrp"><h4>ЗВУК</h4>
                ${slider("master", "Общая громкость", 0, 1, 0.05, pct)}
                ${slider("sfx", "Эффекты", 0, 1, 0.05, pct)}
                ${slider("engine", "Двигатели и гусеницы", 0, 1, 0.05, pct)}
                ${toggle("voice", "Голосовые доклады экипажа")}
            </div>
            <div class="sgrp"><h4>ГРАФИКА И КАМЕРА</h4>
                ${select("quality", "Качество", [["high", "Высокое"], ["medium", "Среднее"], ["low", "Низкое"]])}
                ${slider("tilt", "Наклон камеры", 0, 35, 1, (v) => v + "°")}
                ${toggle("showFps", "Показывать FPS")}
            </div>
            <div class="sgrp"><h4>ИГРА</h4>
                ${select("difficulty", "Противник", [["easy", "Новобранцы"], ["normal", "Ветераны"], ["hard", "Асы"]])}
                ${toggle("xray", "Рентген своих попаданий")}
                ${toggle("xrayIncoming", "Рентген попаданий по вам")}
                ${toggle("hullAssist", "Доворот корпуса ПТ-САУ за прицелом")}
                ${select("wheel", "Колесо мыши", [["zoom", "Масштаб камеры"], ["shell", "Смена снаряда"]])}
                ${toggle("hints", "Подсказки управления")}
                ${toggle("unlockAll", "Открыть всю технику (режим теста)")}
            </div>
            <div class="btnrow"><button class="ghost" data-act="resetSettings">СБРОСИТЬ НАСТРОЙКИ</button><button class="ghost danger" data-act="resetProgress">СБРОСИТЬ ПРОГРЕСС</button></div>`;
        $("setBody").querySelectorAll("[data-k]").forEach((el) => {
            const k = el.dataset.k;
            el.addEventListener("input", () => {
                let v = el.type === "checkbox" ? el.checked : el.type === "range" ? +el.value : el.value;
                Settings.set(k, v);
                const em = el.parentElement.querySelector("em");
                if (em) em.textContent = k === "tilt" ? v + "°" : Math.round(v * 100) + "%";
                if (k === "unlockAll" && this.current === "hangarScr") this.renderHangar();
            });
        });
    }

    /* ─────────── Справочник ─────────── */
    renderRef(tab) {
        this.refTab = tab;
        $("refTabs").innerHTML = REFERENCE.map((s) => `<button class="tab ${s.id === tab ? "on" : ""}" data-act="refTab" data-v="${s.id}">${s.title}</button>`).join("");
        const sec = REFERENCE.find((s) => s.id === tab) || REFERENCE[0];
        let html = `<h2>${sec.title}</h2>`;
        if (sec.intro) html += `<p class="intro">${sec.intro}</p>`;
        if (sec.rows) html += `<table class="reft">${sec.rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join("")}</table>`;
        if (sec.id === "shells") {
            html += `<table class="reft">${Object.values(SHELL_TYPES).map((t) => `<tr><th style="color:${t.color}">${t.short} · ${t.name}</th><td>${t.desc}</td></tr>`).join("")}</table>`;
        }
        if (sec.id === "vehicles") {
            html += `<div class="refv">${ALL_VEHICLES.map((v) => `<div class="card rv"><img src="${this.game.hangar.thumbnail(v.id)}" alt=""><b>${v.name}</b><span>${NATIONS[v.nation].name} · ${ROLES[v.role].name} · БР ${v.br.toFixed(1)}</span><p>${v.desc}</p><em>${v.gun.name} ${v.gun.cal} мм · лоб ${v.armor.hull.front[0]}/${v.armor.hull.front[1]}° · ${v.mob.speed} км/ч · экипаж ${v.crew.length}</em></div>`).join("")}</div>`;
        }
        $("refBody").innerHTML = html;
        $("refBody").scrollTop = 0;
    }
}

