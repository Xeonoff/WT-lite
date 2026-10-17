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
        // метки техники
        for (const v of b.vehicles) {
            if (v.dead || v.isPlayer) continue;
            const ally = v.team === pt;
            if (!ally && !v.visible[pt]) continue;
            const top = v.def.dims.H + v.def.turret.h + 2.2;
            const [x, y, front] = sc.project(v.x, top, v.z);
            const on = front && x > -20 && y > -20 && x < this.w + 20 && y < this.h + 20;
            if (on) this.nameplate(v, x, y, ally, p);
            else if (!ally) this.edgeArrow(x, y, front, COL.enemy, p ? Math.round(Math.hypot(v.x - p.x, v.z - p.z)) + " м" : "");
        }
        if (p && !p.dead) {
            this.leadMarks(b, p, sc, pt);
            this.playerMarks(game, p, sc);
            this.drawIncoming(p, sc, dt);
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
        g.font = "600 11px Rubik, sans-serif";
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
            g.font = "600 10px Rubik, sans-serif";
            g.textAlign = "center";
            g.fillText(label, ex - Math.cos(a) * 22, ey - Math.sin(a) * 22 + 4);
        }
        g.globalAlpha = 1;
    }

    drawPoints(b, sc, pt) {
        const g = this.g;
        const pts = b.modeCtl.points || (b.modeCtl.point ? [{ ...b.modeCtl.point, owner: -1, prog: -(b.modeCtl.cap || 0) }] : []);
        for (const q of pts) {
            const [x, y, front] = sc.project(q.x, 0, q.z);
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
            g.font = `400 ${on ? 17 : 13}px "Russo One", sans-serif`;
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
                const [x, y] = sc.project(s.x + Math.cos(a) * s.r, 0, s.z + Math.sin(a) * s.r);
                i ? g.lineTo(x, y) : g.moveTo(x, y);
            }
            g.fillStyle = `rgba(${col},.08)`;
            g.fill();
            g.setLineDash([8, 6]);
            g.strokeStyle = `rgba(${col},.85)`;
            g.lineWidth = 2;
            g.stroke();
            g.setLineDash([]);
            const [cx, cy, front] = sc.project(s.x, 0, s.z);
            if (!front) continue;
            const left = Math.max(0, Config.ARTY.DELAY - s.t);
            g.font = "400 12px 'Russo One', sans-serif";
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
            const y = v.def.dims.H * 0.6;
            const [ax, ay] = sc.project(v.x, y, v.z);
            const [lx, ly, front] = sc.project(tx, y, tz);
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
        const [x, y] = sc.project(p.x, p.def.dims.H + T.h + 2.5, p.z);
        let bar = null;
        if (p.repair) bar = { t: p.repair.t / p.repair.dur, col: COL.warn, label: "РЕМОНТ " + Math.ceil(p.repair.dur - p.repair.t) + " с" };
        else if (p.swap) bar = { t: p.swap.t / p.swap.dur, col: COL.ally, label: "ПЕРЕСАДКА" };
        if (bar) {
            g.fillStyle = "rgba(10,12,8,.7)";
            g.fillRect(x - 40, y - 4, 80, 7);
            g.fillStyle = bar.col;
            g.fillRect(x - 39, y - 3, 78 * clamp(bar.t, 0, 1), 5);
            g.font = "600 10px Rubik, sans-serif";
            g.textAlign = "center";
            g.fillText(bar.label, x, y - 8);
        }
    }

    drawIncoming(p, sc, dt) {
        const g = this.g;
        const [px, py] = sc.project(p.x, 1, p.z);
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

    crosshair(game, p, sc) {
        const g = this.g;
        const m = game.input.mouse;
        const aim = game.aim;
        const mx = m.x, my = m.y;
        // цвет по индикатору пробития
        let col = COL.grey, info = null;
        if (aim.pen) {
            const e = aim.pen;
            if (e.blocked) col = COL.grey;
            else if (e.he) col = e.ok ? COL.good : COL.warn;
            else if (e.pen >= e.eff * 1.1 && e.rico < 0.35) col = COL.good;
            else if (e.pen >= e.eff * 0.9 && e.rico < 0.8) col = COL.warn;
            else col = COL.bad;
            info = e;
        }
        const cw = aim.cursor || aim.point;
        const ppm = cw ? sc.pxPerMeter(cw[0], cw[1], cw[2]) : 4;
        const disp = p.dispersion();
        const rad = Math.max(7, disp * (aim.dist || 50) * ppm);
        const ready = p.canFire();
        // маркер фактического направления орудия
        if (cw) {
            const piv = gunPivotWorld(p);
            const dd = Math.hypot(cw[0] - piv[0], cw[2] - piv[2]);
            const gy = p.gunYaw();
            const [gx, gyy] = sc.project(piv[0] + Math.cos(gy) * dd, cw[1], piv[2] + Math.sin(gy) * dd);
            const off = Math.hypot(gx - mx, gyy - my);
            if (off > 4) {
                g.strokeStyle = "rgba(255,255,255,.55)";
                g.lineWidth = 1.5;
                g.beginPath(); g.arc(gx, gyy, 5, 0, 6.283); g.stroke();
                g.beginPath(); g.moveTo(gx - 9, gyy); g.lineTo(gx - 5, gyy); g.moveTo(gx + 5, gyy); g.lineTo(gx + 9, gyy); g.stroke();
            }
        }
        g.strokeStyle = col;
        g.lineWidth = 1.8;
        g.beginPath(); g.arc(mx, my, rad, 0, 6.283); g.stroke();
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            g.beginPath();
            g.moveTo(mx + dx * (rad + 4), my + dy * (rad + 4));
            g.lineTo(mx + dx * (rad + 12), my + dy * (rad + 12));
            g.stroke();
        }
        g.fillStyle = col;
        g.beginPath(); g.arc(mx, my, 1.8, 0, 6.283); g.fill();
        // перезарядка
        const rr = rad + 16;
        if (p.gunBroken() || !p.seatOk("gunner")) {
            g.strokeStyle = COL.bad;
            g.lineWidth = 3;
            g.beginPath(); g.moveTo(mx - 10, my - 10); g.lineTo(mx + 10, my + 10); g.moveTo(mx + 10, my - 10); g.lineTo(mx - 10, my + 10); g.stroke();
        } else if (!ready && p.reload > 0) {
            const pr = 1 - clamp(p.reload / Math.max(0.01, p.reloadTotal), 0, 1);
            g.strokeStyle = "rgba(0,0,0,.35)";
            g.lineWidth = 3.5;
            g.beginPath(); g.arc(mx, my, rr, 0, 6.283); g.stroke();
            g.strokeStyle = "rgba(224,178,62,.95)";
            g.beginPath(); g.arc(mx, my, rr, -Math.PI / 2, -Math.PI / 2 + pr * 6.283); g.stroke();
        } else if (ready) {
            g.strokeStyle = "rgba(98,226,126,.85)";
            g.lineWidth = 2.5;
            for (let k = 0; k < 4; k++) {
                const a0 = -Math.PI / 2 + k * Math.PI / 2 - 0.25;
                g.beginPath(); g.arc(mx, my, rr, a0, a0 + 0.5); g.stroke();
            }
        }
        // подписи
        g.textAlign = "center";
        g.font = "600 11px Rubik, sans-serif";
        let ty = my + rr + 16;
        if (aim.dist) {
            g.fillStyle = "rgba(235,238,225,.9)";
            g.fillText(Math.round(aim.dist) + " м", mx, ty);
            ty += 14;
        }
        if (info && !info.blocked) {
            g.fillStyle = col;
            const t = info.he ? (info.ok ? "фугас: пробьёт " + Math.round(info.eff) + " мм" : "фугас: " + Math.round(info.eff) + " мм брони")
                : Math.round(info.pen) + " мм ▸ " + Math.round(info.eff) + " мм" + (info.rico > 0.3 ? " · рикошет" : "");
            g.fillText(t, mx, ty);
            ty += 13;
            g.fillStyle = "rgba(235,238,225,.7)";
            g.font = "500 10px Rubik, sans-serif";
            g.fillText(info.plate + (info.angle !== undefined ? " · " + Math.round(info.angle) + "°" : ""), mx, ty);
        }
        // надписи попаданий
        let hy = my - rr - 14;
        for (const h of this.hitTexts) {
            const a = clamp(1.6 - h.t, 0, 1);
            g.globalAlpha = a;
            g.font = `400 ${h === this.hitTexts[0] ? 16 : 13}px "Russo One", sans-serif`;
            g.fillStyle = "rgba(0,0,0,.6)";
            g.fillText(h.text, mx + 1, hy + 1 - h.t * 8);
            g.fillStyle = h.color;
            g.fillText(h.text, mx, hy - h.t * 8);
            if (h.sub) {
                g.font = "500 10px Rubik, sans-serif";
                g.fillText(h.sub, mx, hy + 12 - h.t * 8);
            }
            hy -= 26;
        }
        g.globalAlpha = 1;
    }
}

