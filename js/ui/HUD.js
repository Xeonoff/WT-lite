import { $, h, clamp, fmtTime, mkCanvas } from "../core/Utils.js";
import { SHELLS, SHELL_TYPES, penAt } from "../data/Shells.js";
import { CREW_SEATS, MODULE_SHORT, ROLES } from "../data/Vehicles.js";
import { modState } from "../sim/Vehicle.js";
import { drawScheme, liveSnap, STATE_COL } from "../render/Xray.js";

const STATE_CLS = ["ok", "dmg", "crit", "dead"];
const KIND_TITLE = {
    pen: "ПРОБИТИЕ", "he-pen": "ФУГАС ВНУТРИ", he: "ФУГАСНЫЙ ПОДРЫВ", nopen: "НЕПРОБИТИЕ", rico: "РИКОШЕТ",
    barrel: "ПОПАДАНИЕ В СТВОЛ", stopped: "ГУСЕНИЦА ПОГЛОТИЛА", splash: "ОСКОЛКИ", miss: "ПРОМАХ",
};

export class HUD {
    constructor() {
        this.root = $("hud");
        this.acc = 0;
        this.xr = null;
        this.mmAcc = 0;
        this.feedEl = $("feed");
        this.logEl = $("crewLog");
        this.schemeCv = $("schemeCv");
        this.mmCv = $("minimap");
        this.xrCv = $("xrCv");
        this.fpsAcc = { t: 0, n: 0 };
    }

    show(on) { this.root.classList.toggle("hidden", !on); }

    /* ─────────── Построение под машину ─────────── */
    build(battle) {
        this.battle = battle;
        const p = battle.player;
        this.mmStatic = null;
        if (!p) return;
        $("vpName").textContent = p.def.name;
        $("vpBR").textContent = ROLES[p.def.role].short + " · БР " + p.def.br.toFixed(1);
        const cr = $("crewRow");
        cr.innerHTML = "";
        this.crewCells = {};
        for (const s of p.def.crew) {
            const el = h("div", "crew", `<i class="cdot"></i><b>${CREW_SEATS[s].short}</b><span class="chp"><i></i></span><span class="csw"></span>`);
            el.title = p.def.crewTitles[s];
            cr.appendChild(el);
            this.crewCells[s] = el;
        }
        cr.style.gridTemplateColumns = `repeat(${p.def.crew.length}, 1fr)`;
        const mr = $("modRow");
        mr.innerHTML = "";
        this.modCells = {};
        const order = ["engine", "transmission", "trackL", "trackR", "breech", "barrel", "drive", "ammo", "fuel"];
        for (const key of order) {
            const ids = key === "ammo" || key === "fuel" ? p.def.modules.filter((m) => m.type === key).map((m) => m.id) : p.mods[key] ? [key] : [];
            if (!ids.length) continue;
            const label = key === "trackL" ? "ГУС.Л" : key === "trackR" ? "ГУС.П" : MODULE_SHORT[p.mods[ids[0]].type];
            const el = h("div", "mod", `<i></i>${label}`);
            mr.appendChild(el);
            this.modCells[key] = { el, ids };
        }
        // снаряды
        const sb = $("shells");
        sb.innerHTML = "";
        this.shellCells = {};
        p.def.shellIds.forEach((sid, i) => {
            const s = SHELLS[sid], T = SHELL_TYPES[s.type];
            const el = h("div", "shell ui-block", `<span class="key">${i + 1}</span><div class="sn">${s.name}</div><div class="st" style="color:${T.color}">${T.short} · ${T.name}</div><div class="sp"><b class="pen">—</b><span class="cnt">0</span></div>`);
            el.title = T.desc;
            el.onclick = () => { if (this.onShell) this.onShell(sid); };
            sb.appendChild(el);
            this.shellCells[sid] = el;
        });
        this.prevMods = {};
        this.update(0, true);
    }

    /* ─────────── Обновление ─────────── */
    update(dt, force = false, aim = null) {
        const b = this.battle;
        if (!b) return;
        this.acc -= dt;
        if (this.acc > 0 && !force) return;
        this.acc = 0.08;
        this.modePanel(b);
        const p = b.player;
        $("spotted").classList.toggle("on", !!(p && !p.dead && p.visible[1 - b.playerTeam] && b.mode !== "range"));
        $("spBadge").textContent = b.mode === "range" ? "∞" : b.sp;
        if (!p || p.dead || !this.crewCells) return;
        // экипаж
        for (const s in this.crewCells) {
            const el = this.crewCells[s];
            const seat = p.seats[s];
            const o = seat.occupant;
            let cls = "crew", hpF = 0, sw = "";
            if (o && o.alive && !o.transit) {
                hpF = o.hp / o.maxHp;
                cls += hpF > 0.66 ? "" : hpF > 0.33 ? " dmg" : " crit";
                if (o.home !== s) sw = CREW_SEATS[o.home].short + "→";
            } else if (o && !o.alive) cls += " dead";
            else cls += " empty";
            if (p.swap && p.swap.to === s) { cls += " incoming"; sw = Math.ceil(p.swap.dur - p.swap.t) + "с"; }
            el.className = cls;
            el.querySelector(".chp i").style.width = (hpF * 100).toFixed(0) + "%";
            el.querySelector(".csw").textContent = sw;
        }
        // модули
        for (const key in this.modCells) {
            const { el, ids } = this.modCells[key];
            let st = 0;
            for (const id of ids) st = Math.max(st, modState(p.mods[id]));
            el.className = "mod " + STATE_CLS[st];
        }
        // расходники
        const rep = p.repair;
        $("consR").classList.toggle("active", !!rep);
        $("consRf").style.width = rep ? (rep.t / rep.dur * 100).toFixed(0) + "%" : "0%";
        const need = p.repairList().length;
        $("consRs").textContent = rep ? Math.ceil(rep.dur - rep.t) + "с" : need ? need + " мод." : "—";
        $("consR").classList.toggle("need", !rep && need > 0);
        $("consTs").textContent = "×" + p.medkits;
        $("consT").classList.toggle("off", p.medkits <= 0);
        $("consFs").textContent = "×" + p.ext;
        $("consF").classList.toggle("off", p.ext <= 0);
        $("consF").classList.toggle("urgent", !!p.fire && p.ext > 0);
        const A = b.artyLeft(p);
        $("consBs").textContent = A > 0 ? Math.ceil(A) + "с" : "ГОТОВ";
        $("consBf").style.width = A > 0 ? (A / 80 * 100).toFixed(0) + "%" : "0%";
        $("consB").classList.toggle("ready", A <= 0);
        // тревоги
        const al = [];
        if (p.fire) al.push(["fire", "ПОЖАР — [F]"]);
        if (!p.tracksOk()) al.push(["bad", "ГУСЕНИЦА СБИТА — [R]"]);
        if (p.mods.engine.hp <= 0) al.push(["bad", "ДВИГАТЕЛЬ ВЫВЕДЕН"]);
        else if (p.mods.transmission.hp <= 0) al.push(["bad", "ТРАНСМИССИЯ ВЫВЕДЕНА"]);
        if (p.gunBroken()) al.push(["bad", "ОРУДИЕ ВЫВЕДЕНО — [R]"]);
        if (!p.seatOk("driver") && !(p.swap && p.swap.to === "driver")) al.push(["bad", "НЕТ МЕХВОДА"]);
        if (!p.seatOk("gunner") && !(p.swap && p.swap.to === "gunner")) al.push(["bad", "НЕТ НАВОДЧИКА"]);
        if (p.swap) al.push(["swap", CREW_SEATS[p.swap.member.home].short + " → " + CREW_SEATS[p.swap.to].name + " " + Math.ceil(p.swap.dur - p.swap.t) + " с"]);
        if (p.aliveCrew() === 2) al.push(["crit", "ЭКИПАЖ НА ПРЕДЕЛЕ"]);
        $("alerts").innerHTML = al.map(([c, t]) => `<span class="alert ${c}">${t}</span>`).join("");
        // оружие
        const dist = aim && aim.dist ? aim.dist : 100;
        for (const sid in this.shellCells) {
            const el = this.shellCells[sid];
            const s = SHELLS[sid];
            el.classList.toggle("active", sid === p.shell);
            el.classList.toggle("empty", !p.ammo[sid]);
            el.querySelector(".pen").textContent = s.type === "HE" ? "ОФ " + s.pen[0] + " мм" : Math.round(penAt(s, dist)) + " мм";
            el.querySelector(".cnt").textContent = "×" + p.ammo[sid];
        }
        const rl = $("rFill"), rt = $("rText");
        const g = p.def.gun;
        if (p.gunBroken()) { rl.style.width = "0%"; rt.textContent = "ОРУДИЕ ВЫВЕДЕНО"; rt.className = "bad"; }
        else if (!p.seatOk("gunner")) { rl.style.width = "0%"; rt.textContent = "НЕТ НАВОДЧИКА"; rt.className = "bad"; }
        else if (p.reload > 0) {
            rl.style.width = ((1 - p.reload / Math.max(0.01, p.reloadTotal)) * 100).toFixed(0) + "%";
            rt.textContent = (g.mag > 1 && p.loaded ? "ОЧЕРЕДЬ " : "ПЕРЕЗАРЯДКА ") + p.reload.toFixed(1) + " с";
            rt.className = "";
        } else {
            rl.style.width = "100%";
            rt.textContent = p.loaded ? "ГОТОВ · " + SHELLS[p.loaded].name + (g.mag > 1 ? " · " + p.mag + "/" + g.mag : "") : "НЕТ СНАРЯДОВ";
            rt.className = p.loaded ? "ok" : "bad";
        }
        const why = p.reloadBreakdown();
        $("rWhy").textContent = why.length ? "медленнее: " + why.join(", ") : "";
        $("rTime").textContent = p.reloadTime(p.shell).toFixed(1) + " с";
        const kmh = Math.round(p.speedKmh());
        $("speed").innerHTML = `<b>${kmh}</b> км/ч`;
        $("gear").textContent = p.canDrive() ? (Math.abs(p.v) < 0.3 ? "N" : p.v < 0 ? "R" : "▸") : "✕";
    }

    modePanel(b) {
        const m = b.modeCtl.hud();
        const el = $("modePanel");
        if (m.kind === "domination") {
            const pt = b.playerTeam;
            const my = m.tickets[pt], en = m.tickets[1 - pt];
            const pts = m.points.map((q) => {
                const cls = q.owner === -1 ? "n" : q.owner === pt ? "a" : "e";
                const pr = Math.abs(q.prog);
                const capCls = q.prog > 0 === (pt === 0) ? "a" : "e";
                return `<div class="pt ${cls}"><span>${q.id}</span>${pr > 1 && pr < 99 ? `<i class="pp ${capCls}" style="height:${pr}%"></i>` : ""}</div>`;
            }).join("");
            el.innerHTML = `<div class="tk a"><b>${Math.ceil(my)}</b><div class="bar"><i style="width:${(my / m.max * 100).toFixed(1)}%"></i></div></div>
                <div class="pts">${pts}</div>
                <div class="tk e"><div class="bar"><i style="width:${(en / m.max * 100).toFixed(1)}%"></i></div><b>${Math.ceil(en)}</b></div>
                <div class="timer">${fmtTime(m.time)}</div>`;
        } else if (m.kind === "waves") {
            const st = m.state === "fight" ? `противников: <b>${m.enemies}</b>` : m.state === "break" ? `передышка: <b>${Math.ceil(m.t)} с</b>` : `начало через <b>${Math.ceil(m.t)} с</b>`;
            el.innerHTML = `<div class="wave"><span>ВОЛНА</span><b>${m.wave || "—"}</b></div><div class="winfo">${st}</div>
                <div class="capw"><span>Высота</span><div class="bar"><i style="width:${m.cap.toFixed(0)}%"></i></div></div>`;
        } else {
            el.innerHTML = `<div class="wave"><span>ПОЛИГОН</span><b>${m.targets}</b></div><div class="winfo">мишеней · <b>Backspace</b> — восстановить, <b>Esc</b> — меню</div>`;
        }
    }

    /* ─────────── Миникарта ─────────── */
    minimap(dt, cam) {
        const b = this.battle;
        if (!b) return;
        this.mmAcc -= dt;
        if (this.mmAcc > 0) return;
        this.mmAcc = 0.1;
        const cv = this.mmCv, g = cv.getContext("2d");
        const W = cv.width, S = b.world.S;
        const k = W / S;
        if (!this.mmStatic) this.mmStatic = this.renderMinimapStatic(b, W);
        g.clearRect(0, 0, W, W);
        g.drawImage(this.mmStatic, 0, 0);
        const pt = b.playerTeam;
        const pts = b.modeCtl.points || (b.modeCtl.point ? [{ ...b.modeCtl.point, owner: -1 }] : []);
        for (const q of pts) {
            const col = q.owner === -1 ? "#e8e2cf" : q.owner === pt ? "#59b4ff" : "#ff5a48";
            g.strokeStyle = col;
            g.lineWidth = 2;
            g.beginPath(); g.arc(q.x * k, q.z * k, q.r * k + 2, 0, 6.283); g.stroke();
            g.fillStyle = col;
            g.font = "700 11px 'Russo One', sans-serif";
            g.textAlign = "center";
            g.fillText(q.id, q.x * k, q.z * k + 4);
        }
        // кадр камеры
        if (cam) {
            g.strokeStyle = "rgba(255,255,255,.35)";
            g.lineWidth = 1;
            g.strokeRect((cam.x - cam.hw) * k, (cam.z - cam.hh) * k, cam.hw * 2 * k, cam.hh * 2 * k);
        }
        for (const v of b.vehicles) {
            const ally = v.team === pt;
            if (!ally && !v.visible[pt]) continue;
            const x = v.x * k, y = v.z * k;
            if (v.dead) {
                g.fillStyle = "rgba(20,20,20,.7)";
                g.fillRect(x - 2, y - 2, 4, 4);
                continue;
            }
            g.save();
            g.translate(x, y);
            g.rotate(v.a);
            g.fillStyle = v.isPlayer ? "#ffd25a" : ally ? "#59b4ff" : "#ff5a48";
            const s = v.isPlayer ? 6 : 4.5;
            g.beginPath(); g.moveTo(s, 0); g.lineTo(-s * 0.8, -s * 0.7); g.lineTo(-s * 0.8, s * 0.7); g.closePath(); g.fill();
            if (v.isPlayer) { g.strokeStyle = "#000"; g.lineWidth = 1; g.stroke(); }
            g.restore();
        }
    }

    renderMinimapStatic(b, W) {
        const c = mkCanvas(W, W), g = c.getContext("2d");
        const w = b.world, k = W / w.S;
        const B = w.biome;
        g.fillStyle = B.ground[0];
        g.fillRect(0, 0, W, W);
        g.fillStyle = "rgba(0,0,0,.25)";
        g.fillRect(0, 0, W, W);
        g.strokeStyle = "rgba(160,140,100,.6)";
        g.lineCap = "round";
        for (const rd of w.roads) {
            g.lineWidth = Math.max(1, rd.w * k);
            g.beginPath();
            rd.pts.forEach(([x, z], i) => (i ? g.lineTo(x * k, z * k) : g.moveTo(x * k, z * k)));
            g.stroke();
        }
        if (w.river) {
            g.strokeStyle = w.river.frozen ? "rgba(210,228,240,.85)" : "rgba(60,110,140,.9)";
            g.lineWidth = Math.max(2, w.river.w * k);
            g.beginPath();
            w.river.pts.forEach(([x, z], i) => (i ? g.lineTo(x * k, z * k) : g.moveTo(x * k, z * k)));
            g.stroke();
            for (const c of w.bridges) {
                g.save(); g.translate(c.x * k, c.z * k); g.rotate(c.a + Math.PI / 2);
                g.fillStyle = c.kind === "bridge" ? "#8a6d45" : "rgba(170,150,110,.9)";
                g.fillRect(-c.hl * k, -c.hw * k, c.hl * 2 * k, c.hw * 2 * k);
                g.restore();
            }
        }
        g.fillStyle = "rgba(30,60,25,.55)";
        for (const t of w.trees) { g.beginPath(); g.arc(t.x * k, t.z * k, Math.max(1.2, t.r * k * 0.8), 0, 6.283); g.fill(); }
        g.strokeStyle = "rgba(25,55,20,.9)";
        g.lineWidth = 2;
        for (const hg of w.hedges) {
            g.beginPath();
            g.moveTo((hg.x - Math.cos(hg.a) * hg.hl) * k, (hg.z - Math.sin(hg.a) * hg.hl) * k);
            g.lineTo((hg.x + Math.cos(hg.a) * hg.hl) * k, (hg.z + Math.sin(hg.a) * hg.hl) * k);
            g.stroke();
        }
        g.fillStyle = "rgba(40,70,30,.35)";
        for (const bu of w.bushes) { g.beginPath(); g.arc(bu.x * k, bu.z * k, Math.max(0.8, bu.r * k * 0.7), 0, 6.283); g.fill(); }
        g.fillStyle = "rgba(25,22,18,.85)";
        for (const bd of w.buildings) {
            g.save(); g.translate(bd.x * k, bd.z * k); g.rotate(bd.a);
            g.fillRect(-bd.hl * k, -bd.hw * k, bd.hl * 2 * k, bd.hw * 2 * k);
            g.restore();
        }
        g.fillStyle = "rgba(90,88,80,.9)";
        for (const r of w.rocks) { g.beginPath(); g.arc(r.x * k, r.z * k, Math.max(1, r.r * k), 0, 6.283); g.fill(); }
        // зоны возрождения
        for (let t = 0; t < 2; t++) {
            const sp = w.spawns[t];
            if (b.mode === "range" && t === 1) continue;
            g.strokeStyle = t === b.playerTeam ? "rgba(89,180,255,.5)" : "rgba(255,90,72,.5)";
            g.setLineDash([3, 3]);
            g.strokeRect((sp.x - sp.spread - 6) * k, (sp.z - 8) * k, (sp.spread * 2 + 12) * k, 16 * k);
            g.setLineDash([]);
        }
        return c;
    }

    /* ─────────── Рентген ─────────── */
    showXray(res, target, title, incoming) {
        if (!res || !res.snap) return;
        this.xr = { res, def: target.def, t: 0, dur: 2.6, title, incoming };
        const el = $("xray");
        el.classList.add("show");
        el.classList.toggle("incoming", !!incoming);
        $("xrTitle").textContent = (incoming ? "ПО ВАМ · " : "") + (title || KIND_TITLE[res.kind] || res.kind);
        $("xrTitle").className = res.kind === "pen" || res.kind === "he-pen" ? "pen" : res.kind === "rico" ? "rico" : "";
        $("xrShell").textContent = res.shell.name + " → " + target.def.name;
        const parts = [];
        if (res.plate) parts.push(`<span>${res.plate}: <b>${res.thick} мм</b> под <b>${Math.round(res.angle)}°</b></span>`);
        if (res.eff) parts.push(`<span>приведённая <b>${Math.round(res.eff)}</b> · пробитие <b>${Math.round(res.pen)}</b> мм</span>`);
        if (res.layers && res.layers.length) parts.push(`<span>экран: ${res.layers.map((l) => l.name).join(", ")}</span>`);
        const ko = res.dmg.filter((d) => d.kind === "crew" && d.after <= 0).map((d) => d.name.toLowerCase());
        const mods = [...new Set(res.dmg.filter((d) => d.kind === "mod" && d.after <= 0).map((d) => d.name.toLowerCase()))];
        const lines = [];
        if (ko.length) lines.push(`<span class="ko">выведены: ${ko.join(", ")}</span>`);
        if (mods.length) lines.push(`<span class="md">уничтожено: ${mods.join(", ")}</span>`);
        if (res.events.includes("fire")) lines.push(`<span class="fi">пожар</span>`);
        if (res.events.includes("nofuse")) lines.push(`<span>взрыватель не взвёлся — тонкая броня</span>`);
        if (res.det) lines.push(`<span class="ko">детонация боеукладки</span>`);
        else if (res.killed) lines.push(`<span class="ko">машина уничтожена</span>`);
        $("xrSub").innerHTML = parts.join(" · ") + (lines.length ? "<br>" + lines.join(" · ") : "");
    }

    drawXray(dt) {
        if (!this.xr) return;
        const x = this.xr;
        x.t += dt;
        if (x.t > x.dur) { $("xray").classList.remove("show"); this.xr = null; return; }
        const cv = this.xrCv, g = cv.getContext("2d");
        const dpr = cv.width / cv.clientWidth || 1;
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        const w = cv.clientWidth, hh = cv.clientHeight;
        g.clearRect(0, 0, w, hh);
        drawScheme(g, { def: x.def, snap: x.res.snap, res: x.res, prog: clamp(x.t / 1.1, 0, 1), x: 0, y: 0, w, h: hh, labels: true });
    }

    drawScheme(dt = 0.1) {
        const b = this.battle;
        if (!b || !b.player || b.player.dead) return;
        this.schAcc = (this.schAcc || 0) - dt;
        if (this.schAcc > 0) return;
        this.schAcc = 0.1;
        const cv = this.schemeCv, g = cv.getContext("2d");
        const dpr = cv.width / cv.clientWidth || 1;
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, cv.clientWidth, cv.clientHeight);
        drawScheme(g, { def: b.player.def, snap: liveSnap(b.player), x: 0, y: 0, w: cv.clientWidth, h: cv.clientHeight, labels: false, compact: true });
    }

    /* ─────────── Сообщения ─────────── */
    feed(html, cls = "") {
        const f = h("div", "fitem " + cls, html);
        this.feedEl.prepend(f);
        while (this.feedEl.children.length > 6) this.feedEl.lastChild.remove();
        setTimeout(() => f.classList.add("fade"), 7000);
        setTimeout(() => f.remove(), 7600);
    }

    log(text, cls = "", life = 5000) {
        const f = h("div", "litem " + cls, text);
        this.logEl.prepend(f);
        while (this.logEl.children.length > 5) this.logEl.lastChild.remove();
        setTimeout(() => f.classList.add("fade"), life);
        setTimeout(() => f.remove(), life + 600);
    }

    banner(title, sub, cls = "") {
        const b = $("banner");
        $("bnT").textContent = title;
        $("bnS").textContent = sub || "";
        b.className = cls;
        void b.offsetWidth;
        b.classList.add("show");
    }

    scoreboard(on) {
        const el = $("scoreboard");
        el.classList.toggle("hidden", !on);
        if (!on || !this.battle) return;
        const b = this.battle;
        const col = (team) => b.vehicles
            .filter((v) => v.team === team && !v.static)
            .sort((x, y) => (x.dead - y.dead) || y.stats.kills - x.stats.kills)
            .map((v) => `<tr class="${v.dead ? "dead" : ""} ${v.isPlayer ? "me" : ""}"><td>${v.callsign}</td><td>${v.def.name}</td><td>${v.stats.kills}</td><td>${v.stats.assists}</td><td>${v.stats.caps}</td></tr>`)
            .join("");
        el.innerHTML = `<div class="sbcol a"><h3>СОЮЗНИКИ</h3><table><tr><th>Позывной</th><th>Техника</th><th>У</th><th>П</th><th>З</th></tr>${col(b.playerTeam)}</table></div>
            <div class="sbcol e"><h3>ПРОТИВНИК</h3><table><tr><th>Позывной</th><th>Техника</th><th>У</th><th>П</th><th>З</th></tr>${col(1 - b.playerTeam)}</table></div>`;
    }

    fps(dt) {
        const f = this.fpsAcc;
        f.t += dt; f.n++;
        if (f.t > 0.5) { $("fps").textContent = Math.round(f.n / f.t) + " FPS"; f.t = 0; f.n = 0; }
    }

    stateColor(st) { return STATE_COL[st]; }
}
