import { clamp } from "../core/Utils.js";
import { Config } from "../core/Config.js";
import { gunPivotWorld, muzzleWorld } from "../sim/Armor.js";
import { SHELLS, shellSpeed } from "../data/Shells.js";

const COL = {
    ally: "#59b4ff", enemy: "#ff5a48", player: "#ffd25a", neutral: "#e8e2cf",
    good: "#62e27e", warn: "#ffd23f", bad: "#ff5147", grey: "rgba(230,232,220,.85)",
};

export class Overlay {
    constructor(canvas) {
        this.cv = canvas;
        this.g = canvas.getContext("2d");
        this.hitTexts = [];
        this.incoming = [];
        this.resize();
        addEventListener("resize", () => this.resize());
    }

    resize() {
        this.dpr = Math.min(devicePixelRatio || 1, 2);
        this.w = innerWidth; this.h = innerHeight;
        this.cv.width = this.w * this.dpr;
        this.cv.height = this.h * this.dpr;
        this.g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }

    clear() { this.g.clearRect(0, 0, this.w, this.h); }

    hitText(text, color, sub) {
        this.hitTexts.unshift({ text, color, sub, t: 0 });
        if (this.hitTexts.length > 3) this.hitTexts.length = 3;
    }

    incomingHit(fromX, fromZ, kind) {
        this.incoming.push({ x: fromX, z: fromZ, kind, t: 0 });
        if (this.incoming.length > 6) this.incoming.shift();
    }

    draw(game, dt) {
        const g = this.g, b = game.battle, sc = game.scene3d;
        this.clear();
        if (!b) return;
        const p = b.player;
        const pt = b.playerTeam;

        this.edgeSlots = [];
        this.drawPoints(b, sc, pt);
        this.drawStrikes(b, sc, pt);
        // трофеи
        for (const pk of b.modeCtl.pickups || []) {
            const [x, y, front] = sc.project(pk.x, sc.gy(pk.x, pk.z) + 2.4, pk.z);
            if (!front || x < 0 || y < 0 || x > this.w || y > this.h) continue;
            this.g.font = "800 11px 'Exo 2', sans-serif";
            this.g.textAlign = "center";
            this.g.fillStyle = "rgba(0,0,0,.55)";
            this.g.fillText("ТРОФЕЙ", x + 1, y + 1);
            this.g.fillStyle = "#ffd25a";
            this.g.fillText("ТРОФЕЙ", x, y);
        }
        // метки техники
        for (const v of b.vehicles) {
            if (v.dead || v.isPlayer) continue;
            // в виде сзади за союзником его табличка закрывала бы обзор
            if (game.spec && game.spec.v === v && game.camTs > 0.5) continue;
            const ally = v.team === pt;
            if (!ally && !v.visible[pt]) continue;
            const top = (v.y || 0) + v.def.dims.H + v.def.turret.h + 2.2;
            const [x, y, front] = sc.project(v.x, top, v.z);
            const on = front && x > -20 && y > -20 && x < this.w + 20 && y < this.h + 20;
            if (on) this.nameplate(v, x, y, ally, p);
            else if (!ally) this.edgeArrow(x, y, front, COL.enemy, p ? Math.round(Math.hypot(v.x - p.x, v.z - p.z)) + " м" : "");
        }
        if (p && !p.dead) {
            const sight = game.sightOn();
            this.leadMarks(b, p, sc, pt);
            if (!sight) this.playerMarks(game, p, sc);
            this.drawIncoming(p, sc, dt);
            if (sight) this.sightReticle(game, p);
            this.crosshair(game, p, sc);
        } else {
            this.incoming.length = 0;
            const m = game.input.mouse;
            g.fillStyle = "rgba(230,232,220,.8)";
            g.beginPath(); g.arc(m.x, m.y, 3, 0, 6.283); g.fill();
        }
        // надписи попаданий
        for (const h of this.hitTexts) h.t += dt;
        this.hitTexts = this.hitTexts.filter((h) => h.t < 1.6);
    }

    nameplate(v, x, y, ally, p) {
        const g = this.g;
        const col = ally ? COL.ally : COL.enemy;
        const d = p ? Math.hypot(v.x - p.x, v.z - p.z) : 0;
        const a = clamp(1.2 - d / 400, 0.45, 1);
        g.globalAlpha = a;
        g.textAlign = "center";
        g.font = "600 11px Inter, sans-serif";
        const label = (ally ? v.callsign + " · " : "") + v.def.name;
        g.fillStyle = "rgba(10,12,8,.55)";
        const tw = g.measureText(label).width;
        g.fillRect(x - tw / 2 - 5, y - 15, tw + 10, 15);
        g.fillStyle = col;
        g.fillText(label, x, y - 4);
        if (!ally) {
            g.beginPath();
            g.moveTo(x - 6, y + 2); g.lineTo(x + 6, y + 2); g.lineTo(x, y + 10);
            g.closePath();
            g.fill();
            if (v.fire) { g.fillStyle = "#ff8c42"; g.fillText("🔥", x + tw / 2 + 12, y - 3); }
        }
        g.globalAlpha = 1;
    }

    edgeArrow(x, y, front, col, label) {
        const g = this.g;
        const cx = this.w / 2, cy = this.h / 2;
        let dx = x - cx, dy = y - cy;
        if (!front) { dx = -dx; dy = -dy; }
        const m = 44;
        const kx = (this.w / 2 - m) / Math.max(1e-3, Math.abs(dx)), ky = (this.h / 2 - m) / Math.max(1e-3, Math.abs(dy));
        const k = Math.min(kx, ky);
        const ex = cx + dx * k, ey = cy + dy * k;
        const a = Math.atan2(dy, dx);
        g.save();
        g.translate(ex, ey);
        g.rotate(a);
        g.fillStyle = col;
        g.globalAlpha = 0.9;
        g.beginPath();
        g.moveTo(13, 0); g.lineTo(-7, -9); g.lineTo(-3, 0); g.lineTo(-7, 9);
        g.closePath();
        g.fill();
        g.restore();
        const lx = ex - Math.cos(a) * 22, ly = ey - Math.sin(a) * 22;
        const busy = this.edgeSlots.some((s) => Math.abs(s[0] - lx) < 34 && Math.abs(s[1] - ly) < 14);
        if (!busy) this.edgeSlots.push([lx, ly]);
        if (label && !busy) {
            g.fillStyle = col;
            g.font = "600 10px Inter, sans-serif";
            g.textAlign = "center";
            g.fillText(label, ex - Math.cos(a) * 22, ey - Math.sin(a) * 22 + 4);
        }
        g.globalAlpha = 1;
    }

    drawPoints(b, sc, pt) {
        const g = this.g;
        const pts = b.modeCtl.points || (b.modeCtl.point ? [{ ...b.modeCtl.point, owner: -1, prog: -(b.modeCtl.cap || 0) }] : []);
        for (const q of pts) {
            const [x, y, front] = sc.project(q.x, sc.gy(q.x, q.z), q.z);
            const col = q.owner === -1 ? COL.neutral : q.owner === pt ? COL.ally : COL.enemy;
            const on = front && x > 30 && y > 30 && x < this.w - 30 && y < this.h - 30;
            let px = x, py = y;
            if (!on) {
                const cx = this.w / 2, cy = this.h / 2;
                let dx = x - cx, dy = y - cy;
                if (!front) { dx = -dx; dy = -dy; }
                const k = Math.min((this.w / 2 - 70) / Math.max(1e-3, Math.abs(dx)), (this.h / 2 - 70) / Math.max(1e-3, Math.abs(dy)));
                px = cx + dx * k; py = cy + dy * k;
            }
            const R = on ? 17 : 13;
            g.globalAlpha = on ? 0.95 : 0.75;
            g.fillStyle = "rgba(10,12,8,.6)";
            g.beginPath(); g.arc(px, py - (on ? 34 : 0), R, 0, 6.283); g.fill();
            g.strokeStyle = col;
            g.lineWidth = 2;
            g.stroke();
            const prog = q.prog || 0;
            if (Math.abs(prog) > 0.5 && Math.abs(prog) < 99.5) {
                g.strokeStyle = prog > 0 ? (pt === 0 ? COL.ally : COL.enemy) : (pt === 1 ? COL.ally : COL.enemy);
                g.lineWidth = 3;
                g.beginPath();
                g.arc(px, py - (on ? 34 : 0), R + 4, -Math.PI / 2, -Math.PI / 2 + Math.abs(prog) / 100 * Math.PI * 2);
                g.stroke();
            }
            g.fillStyle = col;
            g.font = `800 ${on ? 17 : 13}px "Exo 2", sans-serif`;
            g.textAlign = "center";
            g.fillText(q.id, px, py - (on ? 34 : 0) + (on ? 6 : 5));
            g.globalAlpha = 1;
        }
    }

    drawStrikes(b, sc, pt) {
        const g = this.g;
        for (const s of b.strikes) {
            if (s.n >= s.total && s.t > s.next) continue;
            const ally = s.team === pt;
            const col = ally ? "89,180,255" : "255,90,72";
            g.beginPath();
            for (let i = 0; i <= 32; i++) {
                const a = (i / 32) * Math.PI * 2;
                const qx = s.x + Math.cos(a) * s.r, qz = s.z + Math.sin(a) * s.r;
                const [x, y] = sc.project(qx, sc.gy(qx, qz) + 0.2, qz);
                i ? g.lineTo(x, y) : g.moveTo(x, y);
            }
            g.fillStyle = `rgba(${col},.08)`;
            g.fill();
            g.setLineDash([8, 6]);
            g.strokeStyle = `rgba(${col},.85)`;
            g.lineWidth = 2;
            g.stroke();
            g.setLineDash([]);
            const [cx, cy, front] = sc.project(s.x, sc.gy(s.x, s.z), s.z);
            if (!front) continue;
            const left = Math.max(0, Config.ARTY.DELAY - s.t);
            g.font = "800 12px 'Exo 2', sans-serif";
            g.textAlign = "center";
            g.fillStyle = `rgba(${col},1)`;
            g.fillText(left > 0 ? "АРТУДАР · " + left.toFixed(1) + " с" : "ОГОНЬ!", cx, cy + 4);
        }
    }

    /** Упреждение по движущимся целям (как в аркадном режиме WT) */
    leadMarks(b, p, sc, pt) {
        const g = this.g;
        const m = muzzleWorld(p);
        const spd = shellSpeed(SHELLS[p.shell]);
        for (const v of b.vehicles) {
            if (v.dead || v.team === pt || !v.visible[pt] || Math.abs(v.v) < 1.2) continue;
            const d = Math.hypot(v.x - m[0], v.z - m[2]);
            if (d > 320) continue;
            // две итерации: время полёта до упреждённой точки
            let tx = v.x, tz = v.z;
            for (let k = 0; k < 2; k++) {
                const tof = Math.hypot(tx - m[0], tz - m[2]) / spd;
                tx = v.x + Math.cos(v.a) * v.v * tof;
                tz = v.z + Math.sin(v.a) * v.v * tof;
            }
            const y = (v.y || 0) + v.def.dims.H * 0.6;
            const [ax, ay] = sc.project(v.x, y, v.z);
            const [lx, ly, front] = sc.project(tx, sc.gy(tx, tz) + v.def.dims.H * 0.6, tz);
            if (!front || Math.hypot(lx - ax, ly - ay) < 6) continue;
            g.strokeStyle = "rgba(255,120,100,.55)";
            g.setLineDash([3, 3]);
            g.lineWidth = 1;
            g.beginPath(); g.moveTo(ax, ay); g.lineTo(lx, ly); g.stroke();
            g.setLineDash([]);
            g.strokeStyle = "rgba(255,150,120,.95)";
            g.lineWidth = 1.6;
            g.beginPath(); g.arc(lx, ly, 5, 0, 6.283); g.stroke();
            g.beginPath(); g.moveTo(lx - 8, ly); g.lineTo(lx - 5, ly); g.moveTo(lx + 5, ly); g.lineTo(lx + 8, ly); g.stroke();
        }
    }

    playerMarks(game, p, sc) {
        const g = this.g;
        const T = p.def.turret;
        // сектор наводки ПТ-САУ
        if (T.casemate) {
            const piv = gunPivotWorld(p);
            const [ox, oy] = sc.project(piv[0], piv[1], piv[2]);
            g.strokeStyle = "rgba(255,210,90,.35)";
            g.setLineDash([6, 6]);
            g.lineWidth = 1.5;
            for (const s of [-1, 1]) {
                const a = p.a + s * T.arc * Math.PI / 180;
                const [ex, ey] = sc.project(piv[0] + Math.cos(a) * 45, piv[1], piv[2] + Math.sin(a) * 45);
                g.beginPath(); g.moveTo(ox, oy); g.lineTo(ex, ey); g.stroke();
            }
            g.setLineDash([]);
        }
        // ремонт / пересадка над машиной
        const [x, y] = sc.project(p.x, (p.y || 0) + p.def.dims.H + T.h + 2.5, p.z);
        let bar = null;
        if (p.repair) bar = { t: p.repair.t / p.repair.dur, col: COL.warn, label: "РЕМОНТ " + Math.ceil(p.repair.dur - p.repair.t) + " с" };
        else if (p.swap) bar = { t: p.swap.t / p.swap.dur, col: COL.ally, label: "ПЕРЕСАДКА" };
        if (bar) {
            g.fillStyle = "rgba(10,12,8,.7)";
            g.fillRect(x - 40, y - 4, 80, 7);
            g.fillStyle = bar.col;
            g.fillRect(x - 39, y - 3, 78 * clamp(bar.t, 0, 1), 5);
            g.font = "600 10px Inter, sans-serif";
            g.textAlign = "center";
            g.fillText(bar.label, x, y - 8);
        }
    }

    drawIncoming(p, sc, dt) {
        const g = this.g;
        const [px, py] = sc.project(p.x, (p.y || 0) + 1, p.z);
        for (const h of this.incoming) {
            h.t += dt;
            const a = Math.atan2(h.z - p.z, h.x - p.x);
            const alpha = clamp(1 - h.t / 2.6, 0, 1);
            if (alpha <= 0) continue;
            g.strokeStyle = h.kind === "pen" ? `rgba(255,70,50,${alpha})` : h.kind === "rico" ? `rgba(255,210,80,${alpha})` : `rgba(220,225,230,${alpha * 0.8})`;
            g.lineWidth = h.kind === "pen" ? 7 : 4;
            g.beginPath();
            g.arc(px, py, 78, a - 0.22, a + 0.22);
            g.stroke();
        }
        this.incoming = this.incoming.filter((h) => h.t < 2.6);
    }

    /** Окуляр прицела наводчика: затемнение вокруг, сетка по нации машины, кратность */
    sightReticle(game, p) {
        const g = this.g, w = this.w, h = this.h, cx = w / 2, cy = h / 2;
        const R = Math.min(w, h) * 0.47;
        g.save();
        g.fillStyle = "rgba(4,5,4,.94)";
        g.beginPath();
        g.rect(0, 0, w, h);
        g.arc(cx, cy, R, 0, Math.PI * 2, true);
        g.fill("evenodd");
        const edge = g.createRadialGradient(cx, cy, R * 0.78, cx, cy, R);
        edge.addColorStop(0, "rgba(0,0,0,0)");
        edge.addColorStop(1, "rgba(0,0,0,.8)");
        g.fillStyle = edge;
        g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
        const ink = "rgba(12,12,10,.92)";
        g.strokeStyle = ink;
        g.fillStyle = ink;
        g.lineWidth = 1.6;
        if (p.def.nation === "ussr") {
            // советский прицел: угольник в центре, боковые штрихи, вертикаль снизу
            g.beginPath(); g.moveTo(cx - 13, cy + 15); g.lineTo(cx, cy); g.lineTo(cx + 13, cy + 15); g.stroke();
            for (const s of [-1, 1]) {
                g.beginPath(); g.moveTo(cx + s * 30, cy); g.lineTo(cx + s * R * 0.96, cy); g.stroke();
                for (let i = 1; i <= 6; i++) {
                    const x = cx + s * (30 + i * 24);
                    g.beginPath(); g.moveTo(x, cy); g.lineTo(x, cy + (i % 2 ? 7 : 13)); g.stroke();
                }
            }
            g.beginPath(); g.moveTo(cx, cy + 42); g.lineTo(cx, cy + R * 0.62); g.stroke();
        } else {
            // немецкий TZF: три ряда треугольников и горизонталь
            const tri = (x, y, s) => { g.beginPath(); g.moveTo(x - s * 0.45, y + s); g.lineTo(x, y); g.lineTo(x + s * 0.45, y + s); g.closePath(); g.fill(); };
            tri(cx, cy, 24);
            for (const s of [-1, 1]) for (let i = 1; i <= 3; i++) tri(cx + s * i * 48, cy + 6, 14);
            g.beginPath(); g.moveTo(cx - R * 0.96, cy + 24); g.lineTo(cx - 170, cy + 24); g.moveTo(cx + 170, cy + 24); g.lineTo(cx + R * 0.96, cy + 24); g.stroke();
        }
        g.restore();
    }

    crosshair(game, p, sc) {
        const g = this.g, aim = game.aim, sight = game.sightOn();
        const mouse = game.aimScreen();
        if (!sight) {
            g.fillStyle = "rgba(0,0,0,.65)";
            g.beginPath(); g.arc(mouse.x, mouse.y, 2.4, 0, Math.PI * 2); g.fill();
            g.fillStyle = "#e8e9db";
            g.beginPath(); g.arc(mouse.x, mouse.y, 1.35, 0, Math.PI * 2); g.fill();
        }
        if (!aim.cursor) return;
        const { m, dir } = game.battle.fireLine(p);
        const range = aim.gunRange ?? Math.max(4, Math.hypot(...aim.cursor.map((n, i) => n - m[i])));
        const [x, y, front] = sc.project(m[0] + dir[0] * range, m[1] + dir[1] * range, m[2] + dir[2] * range);
        if (!front || x < 0 || y < 0 || x > this.w || y > this.h) return;
        const pen = aim.pen, block = aim.block, broken = p.gunBroken() || !p.seatOk("gunner");
        let color = COL.grey;
        if (broken) color = COL.bad;
        else if (block) color = "#ff985e";
        else if (pen) color = pen.screen ? COL.warn : pen.pen >= pen.eff * 1.1 && pen.rico < 0.35 ? COL.good :
            pen.pen >= pen.eff * 0.9 && pen.rico < 0.8 ? COL.warn : COL.bad;
        g.save();
        g.translate(x, y);
        g.shadowColor = "#101512";
        g.shadowBlur = 2;
        g.strokeStyle = color; g.lineWidth = 1.5;
        g.beginPath(); g.arc(0, 0, 6, 0, Math.PI * 2);
        g.moveTo(-12, 0); g.lineTo(-8, 0); g.moveTo(8, 0); g.lineTo(12, 0); g.stroke();
        if (block || broken) {
            g.beginPath(); g.moveTo(-3, 3); g.lineTo(3, -3); g.stroke();
        }
        if (!broken && p.reload > 0) {
            const progress = 1 - clamp(p.reload / Math.max(0.01, p.reloadTotal), 0, 1);
            g.lineWidth = 2; g.strokeStyle = COL.warn;
            g.beginPath(); g.arc(0, 0, 10, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2); g.stroke();
        } else if (p.canFire()) {
            g.fillStyle = COL.good; g.fillRect(-2, 9, 4, 2);
        }
        const T = Config.CAMERA.TP;
        const line = [sight && "×" + (T.FOV / T.SIGHT_FOV[game.sightZoom]).toFixed(1),
            (aim.gunRange == null ? "≈" : "") + Math.round(range) + " м",
            broken ? "Орудие недоступно" : block?.what || (p.reload > 0 && p.reload.toFixed(1) + " с")].filter(Boolean).join(" · ");
        const armor = pen && [pen.plate, pen.screen ? "экран" : Math.round(pen.pen) + "/" + Math.round(pen.eff) + " мм",
            pen.angle != null && Math.round(pen.angle) + "°", pen.rico >= 0.05 && "↗" + Math.round(100 * pen.rico) + "%"].filter(Boolean).join(" · ");
        g.font = "600 10px Inter, sans-serif";
        g.textAlign = "center";
        const width = Math.min(this.w - 8, Math.max(g.measureText(line).width, armor ? g.measureText(armor).width : 0) + 10);
        const cx = clamp(x, width / 2 + 3, this.w - width / 2 - 3) - x;
        const h = armor ? 27 : 15, top = y + h + 16 < this.h ? 15 : -15 - h;
        g.fillStyle = "rgba(10,16,15,.76)"; g.fillRect(cx - width / 2, top, width, h);
        g.fillStyle = color; g.fillText(line, cx, top + 11);
        if (armor) g.fillText(armor, cx, top + 23);
        const hit = this.hitTexts[0];
        if (hit) {
            g.globalAlpha = clamp(1.6 - hit.t, 0, 1);
            g.fillStyle = hit.color; g.font = "700 12px 'Exo 2', sans-serif";
            const hy = top > 0 ? -17 : 23;
            g.fillText(hit.text, cx, hy);
            if (hit.sub) { g.font = "10px Inter, sans-serif"; g.fillText(hit.sub, cx, hy + (top > 0 ? -13 : 13)); }
        }
        g.restore();
    }
}

