import { G } from "./state.js";
import { WORLD } from "./data.js";
import { clamp, star, modStateColor } from "./utils.js";
import { turretPos, tankRadius, dispersion, reloadTime } from "./entities.js";
import { getTerrainPat } from "./world.js";
import { decals } from "./state.js";
import { mouse } from "./input.js";

const cv = document.getElementById("cv");
const ctx = cv.getContext("2d");
let VW = 0, VH = 0, DPR = 1;

export function resize() {
  DPR = Math.min(devicePixelRatio || 1, 2);
  VW = innerWidth;
  VH = innerHeight;
  cv.width = VW * DPR;
  cv.height = VH * DPR;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
addEventListener("resize", resize);
resize();

export function drawTopScheme(g, cx, cy, s, cls, tank, res, prog) {
  const X = (x) => cx + x * s;
  const Y = (y) => cy + y * s;
  g.lineJoin = "round";
  g.lineWidth = 2;
  g.fillStyle = "rgba(140,155,170,.14)";
  g.strokeStyle = "#7d8ea0";
  // верхняя гусеница
  g.beginPath();
  g.rect(X(-cls.L / 2), Y(-cls.W / 2), cls.L * s, cls.tread * s);
  g.fill(); g.stroke();
  // нижняя гусеница
  g.beginPath();
  g.rect(X(-cls.L / 2), Y(cls.W / 2 - cls.tread), cls.L * s, cls.tread * s);
  g.fill(); g.stroke();
  // корпус
  g.fillStyle = "rgba(160,180,200,.08)";
  g.beginPath();
  g.rect(X(-cls.L / 2), Y(-cls.W / 2), cls.L * s, cls.W * s);
  g.fill();
  g.strokeStyle = "#aebfd2";
  g.stroke();
  // ствол и башня
  g.strokeStyle = "#aebfd2";
  g.lineWidth = Math.max(3, 3.5 * s * 0.9);
  g.beginPath();
  g.moveTo(X(cls.tOff + cls.tR * 0.4), Y(0));
  g.lineTo(X(cls.tOff + cls.tR + cls.barrel), Y(0));
  g.stroke();
  g.lineWidth = 2;
  g.fillStyle = "rgba(160,180,200,.10)";
  g.beginPath();
  g.arc(X(cls.tOff), Y(0), cls.tR * s, 0, 6.283);
  g.fill();
  g.strokeStyle = "#aebfd2";
  g.stroke();

  if (res) {
    g.fillStyle = "#8fa0b2";
    g.font = "11px Rubik";
    g.textAlign = "center";
    g.fillText("НОС ▶", X(cls.L / 2 + 20), Y(0) + 4);
    g.fillText("КОРМА", X(-cls.L / 2 - 22), Y(0) + 4);
    g.fillText("лоб " + cls.armor.front + " мм", X(cls.L / 2 - 10), Y(-cls.W / 2) - 8);
    g.fillText("корма " + cls.armor.rear + " мм", X(-cls.L / 2 + 14), Y(-cls.W / 2) - 8);
    g.fillText("борт " + cls.armor.side + " мм", X(0), Y(cls.W / 2) + 16);
  }

  for (const md of cls.schema.mods) {
    const inst = tank ? tank.mods[md.t] : null;
    const hp = inst ? inst.hp : (md.hp ?? 100);
    const max = inst ? inst.max : (md.max ?? 100);
    const col = modStateColor(hp, max);
    const mx = X(md.x), my = Y(md.y);
    const r = md.r * s * 0.92;
    const isCrew = ["driver", "gunner", "loader", "commander"].includes(md.t);
    g.globalAlpha = 0.9;
    if (md.t === "ring") {
      g.setLineDash([4, 3]);
      g.strokeStyle = col;
      g.lineWidth = 2.2;
      g.beginPath();
      g.arc(mx, my, r, 0, 6.283);
      g.stroke();
      g.setLineDash([]);
      g.lineWidth = 2;
    } else {
      g.fillStyle = col;
      g.strokeStyle = "rgba(0,0,0,.45)";
      if (isCrew) {
        g.beginPath();
        g.arc(mx, my, r, 0, 6.283);
        g.fill();
        g.stroke();
        g.strokeStyle = "rgba(20,26,16,.8)";
        g.beginPath();
        g.arc(mx, my - r * 0.25, r * 0.55, Math.PI, 0);
        g.stroke();
        if (hp <= 0) {
          g.strokeStyle = "#3a0b08";
          g.lineWidth = 2.4;
          g.beginPath();
          g.moveTo(mx - r * 0.6, my - r * 0.6);
          g.lineTo(mx + r * 0.6, my + r * 0.6);
          g.moveTo(mx + r * 0.6, my - r * 0.6);
          g.lineTo(mx - r * 0.6, my + r * 0.6);
          g.stroke();
          g.lineWidth = 2;
        }
      } else if (md.t === "engine") {
        g.beginPath(); g.rect(mx - r, my - r * 0.8, r * 2, r * 1.6); g.fill(); g.stroke();
        g.strokeStyle = "rgba(20,26,16,.8)";
        for (let i = -1; i <= 1; i++) {
          g.beginPath();
          g.moveTo(mx + i * r * 0.55, my - r * 0.8);
          g.lineTo(mx + i * r * 0.55, my + r * 0.8);
          g.stroke();
        }
      } else if (md.t === "ammo") {
        g.beginPath(); g.rect(mx - r, my - r * 0.8, r * 2, r * 1.6); g.fill(); g.stroke();
        g.strokeStyle = "rgba(20,26,16,.8)";
        for (let i = -1; i <= 1; i++) {
          g.beginPath();
          g.moveTo(mx + i * r * 0.6, my - r * 0.55);
          g.lineTo(mx + i * r * 0.6, my + r * 0.55);
          g.stroke();
        }
      } else if (md.t === "fuel") {
        g.beginPath(); g.rect(mx - r, my - r * 0.7, r * 2, r * 1.4); g.fill(); g.stroke();
      } else if (md.t === "gun") {
        g.beginPath(); g.rect(mx - r, my - r * 0.6, r * 2, r * 1.2); g.fill(); g.stroke();
      }
    }
    g.globalAlpha = 1;
  }

  if (res) {
    const e = res.entry, d = res.dir, q = prog ?? 1;
    const EX = X(e.x), EY = Y(e.y);
    if (res.type === "pen") {
      const len = res.pathLen * q;
      const tx = e.x + d.x * len, ty = e.y + d.y * len;
      const cw = (5 + res.pathLen * 0.12) * q;
      const pxp = -d.y, pyp = d.x;
      g.fillStyle = "rgba(255,60,40,.16)";
      g.beginPath();
      g.moveTo(EX, EY);
      g.lineTo(X(tx + pxp * cw), Y(ty + pyp * cw));
      g.lineTo(X(tx - pxp * cw), Y(ty - pyp * cw));
      g.closePath();
      g.fill();
      g.strokeStyle = "#ff3b30";
      g.lineWidth = 2.6;
      g.shadowColor = "#ff3b30";
      g.shadowBlur = 8;
      g.beginPath();
      g.moveTo(EX, EY);
      g.lineTo(X(tx), Y(ty));
      g.stroke();
      g.shadowBlur = 0;
      g.fillStyle = "#ff3b30";
      g.beginPath();
      g.arc(EX, EY, 3.4, 0, 6.283);
      g.fill();
    } else if (res.type === "he") {
      const R = ((res.deep ? 34 : 26) * q + 8) * s;
      g.fillStyle = "rgba(255,140,60,.12)";
      g.beginPath();
      g.arc(EX, EY, R, 0, 6.283);
      g.fill();
      g.strokeStyle = "rgba(255,140,60,.9)";
      g.lineWidth = 2.4;
      g.stroke();
      g.fillStyle = "#ff8c42";
      g.beginPath();
      g.arc(EX, EY, 3.4, 0, 6.283);
      g.fill();
    } else if (res.type === "rico") {
      g.strokeStyle = "#ffd23f";
      g.lineWidth = 2.4;
      g.beginPath();
      g.moveTo(X(e.x - d.x * 34), Y(e.y - d.y * 34));
      g.lineTo(EX, EY);
      g.lineTo(X(e.x + res.tan.x * 46), Y(e.y + res.tan.y * 46));
      g.stroke();
      g.fillStyle = "#ffd23f";
      g.beginPath();
      g.arc(EX, EY, 3, 0, 6.283);
      g.fill();
    } else if (res.type === "nofrag") {
      g.strokeStyle = "#9fb0be";
      g.lineWidth = 2.4;
      g.beginPath();
      g.moveTo(X(e.x - d.x * 34), Y(e.y - d.y * 34));
      g.lineTo(EX, EY);
      g.stroke();
      g.strokeStyle = "#ff5147";
      g.lineWidth = 2.6;
      g.beginPath();
      g.moveTo(EX - 6, EY - 6);
      g.lineTo(EX + 6, EY + 6);
      g.moveTo(EX + 6, EY - 6);
      g.lineTo(EX - 6, EY + 6);
      g.stroke();
    }
    if (res.hits) {
      for (const h of res.hits) {
        const a = clamp((q - 0.55) / 0.3, 0, 1);
        if (a <= 0) continue;
        const hx = X(h.x), hy = Y(h.y);
        g.globalAlpha = a;
        g.strokeStyle = "#ff5147";
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(hx - 6, hy);
        g.lineTo(hx + 6, hy);
        g.moveTo(hx, hy - 6);
        g.lineTo(hx, hy + 6);
        g.stroke();
        g.fillStyle = "#ffd2d0";
        g.font = "700 12px 'Russo One'";
        g.textAlign = "center";
        g.fillText("−" + Math.round(h.dmg), hx, hy - 10 - a * 8);
        g.globalAlpha = 1;
      }
    }
  }
}

// export function drawXRAnim { }
// drawXRAnim перенесён в hud.js для упрощения зависимостей
// Вызывается из render через render() в hud

export function drawTank(g, t, alpha = 1) {
  const c = t.cls;
  g.save();
  g.translate(t.x, t.y);
  g.globalAlpha = alpha;
  g.save();
  g.rotate(t.a);
  g.fillStyle = "rgba(0,0,0,.28)";
  g.beginPath();
  g.rect(-c.L / 2 + 3, -c.W / 2 + 4, c.L, c.W);
  g.fill();
  g.restore();

  g.rotate(t.a);
  const w = c.W, ww = c.tread;
  g.fillStyle = "#2c2f24";
  g.beginPath(); g.rect(-c.L / 2, -w / 2, c.L, ww); g.fill();
  g.beginPath(); g.rect(-c.L / 2, w / 2 - ww, c.L, ww); g.fill();

  g.strokeStyle = "rgba(0,0,0,.5)";
  g.lineWidth = 1.5;
  const off = ((t.trackDist % 8) + 8) % 8;
  for (let x = -c.L / 2 + off; x < c.L / 2; x += 8) {
    g.beginPath();
    g.moveTo(x, -w / 2 + 1);
    g.lineTo(x, -w / 2 + ww - 1);
    g.moveTo(x, w / 2 - ww + 1);
    g.lineTo(x, w / 2 - 1);
    g.stroke();
  }
  g.fillStyle = c.body;
  g.beginPath();
  g.rect(-c.L / 2 + 2, -w / 2 + ww - 1, c.L - 4, w - 2 * ww + 2);
  g.fill();
  g.strokeStyle = c.bodyD;
  g.lineWidth = 2;
  g.stroke();
  g.fillStyle = c.bodyD;
  g.fillRect(c.L / 2 - 10, -w / 2 + ww, 6, w - 2 * ww);
  g.strokeStyle = "rgba(255,255,255,.14)";
  g.beginPath();
  g.moveTo(-c.L / 2 + 6, -w / 2 + ww + 2);
  g.lineTo(-c.L / 2 + 14, -w / 2 + ww + 2);
  g.stroke();
  g.restore();

  const tp = turretPos(t);
  g.save();
  g.translate(tp.x, tp.y);
  g.rotate(t.ta);
  g.fillStyle = "rgba(0,0,0,.25)";
  g.beginPath();
  g.arc(2, 2, c.tR, 0, 6.283);
  g.fill();
  const bl = c.barrel * (1 - 0.13 * t.recoil);
  const bw = c.tR > 16 ? 7 : 6;
  g.fillStyle = c.barrelCol;
  g.fillRect(c.tR * 0.3, -bw / 2, bl, bw);
  g.strokeStyle = "rgba(0,0,0,.35)";
  g.lineWidth = 1;
  g.strokeRect(c.tR * 0.3, -bw / 2, bl, bw);
  g.fillStyle = c.barrelCol;
  g.fillRect(c.tR * 0.3 + bl - 4, -bw / 2 - 1.6, 5, bw + 3.2);
  g.fillStyle = c.tur;
  g.beginPath();
  g.arc(0, 0, c.tR, 0, 6.283);
  g.fill();
  g.strokeStyle = c.bodyD;
  g.lineWidth = 2;
  g.stroke();
  g.fillStyle = c.bodyD;
  g.fillRect(c.tR * 0.45, -7, 10, 14);
  g.fillStyle = c.bodyD;
  g.beginPath();
  g.arc(-c.tR * 0.25, c.tR * 0.3, c.tR * 0.3, 0, 6.283);
  g.fill();
  if (t.isPlayer) star(g, 0, -c.tR * 0.35, c.tR * 0.42, "#d8e6c8");
  g.restore();

  if (!t.isPlayer) {
    g.save();
    g.translate(t.x, t.y);
    const m = Math.sin(t.mark * 4) * 2;
    g.translate(0, -c.L * 0.62 - m);
    g.rotate(Math.PI / 4);
    g.fillStyle = "rgba(255,70,55,.9)";
    g.fillRect(-5, -5, 10, 10);
    g.strokeStyle = "rgba(255,255,255,.7)";
    g.lineWidth = 1.5;
    g.strokeRect(-5, -5, 10, 10);
    g.restore();
  }

  if (t.repair) {
    g.save();
    g.translate(t.x, t.y - c.L * 0.7);
    g.fillStyle = "rgba(20,24,14,.8)";
    g.fillRect(-24, 0, 48, 6);
    g.fillStyle = "#ffd23f";
    g.fillRect(-23, 1, 46 * clamp(t.repair.t / t.repair.dur, 0, 1), 4);
    g.restore();
  }
}

export function drawWreck(g, w) {
  g.save();
  g.translate(w.x, w.y);
  g.rotate(w.a);
  const c = w.cls;
  g.fillStyle = "#191b15";
  g.beginPath(); g.rect(-c.L / 2, -c.W / 2, c.L, c.W); g.fill();
  g.strokeStyle = "#0d0e0a";
  g.stroke();
  g.fillStyle = "#11130e";
  g.fillRect(-c.L / 2, -c.W / 2, c.L, c.tread);
  g.fillRect(-c.L / 2, c.W / 2 - c.tread, c.L, c.tread);
  if (!w.noTurret) {
    g.rotate(w.ta - w.a);
    g.beginPath();
    g.arc(0, 0, c.tR, 0, 6.283);
    g.fillStyle = "#15170f";
    g.fill();
  }
  g.restore();
}

export function drawLaser(g, t) {
  if (!t || t.dead) return;
  const c = t.cls, tp = turretPos(t);
  const dx = Math.cos(t.ta), dy = Math.sin(t.ta);
  const mx = tp.x + dx * (c.tR + c.barrel * 0.92);
  const my = tp.y + dy * (c.tR + c.barrel * 0.92);
  let len = 280;
  for (let d = 12; d < len; d += 12) {
    const x = mx + dx * d, y = my + dy * d;
    let blocked = false;
    for (const o of G.obstacles) {
      if (!o.tree && Math.hypot(x - o.x, y - o.y) < o.r) {
        blocked = true;
        break;
      }
    }
    if (!blocked) {
      const tg = [G.player, ...G.enemies];
      for (const q of tg) {
        if (!q || q === t || q.dead) continue;
        if (Math.hypot(x - q.x, y - q.y) < tankRadius(q) * 0.85) {
          blocked = true;
          break;
        }
      }
    }
    if (blocked) { len = d; break; }
  }
  const col = t.isPlayer ? "160,242,120" : "255,92,72";
  const grad = g.createLinearGradient(mx, my, mx + dx * len, my + dy * len);
  grad.addColorStop(0, `rgba(${col},${t.isPlayer ? 0.55 : 0.4})`);
  grad.addColorStop(1, `rgba(${col},0)`);
  g.strokeStyle = grad;
  g.lineWidth = t.isPlayer ? 1.7 : 1.3;
  g.beginPath();
  g.moveTo(mx, my);
  g.lineTo(mx + dx * len, my + dy * len);
  g.stroke();
}

export function drawPanel() {
  if (!G.player) return;
  const pcv = document.getElementById("panelCv");
  if (!pcv) return;
  const pctx = pcv.getContext("2d");
  pctx.setTransform(2, 0, 0, 2, 0, 0);
  pctx.clearRect(0, 0, 264, 132);
  drawTopScheme(pctx, 112, 66, 1.28, G.player.cls, G.player, null, null);
}

export function render() {
  ctx.clearRect(0, 0, VW, VH);
  ctx.save();
  ctx.translate(VW / 2 - G.CAM.x + G.shX, VH / 2 - G.CAM.y + G.shY);
  ctx.fillStyle = getTerrainPat(ctx);
  ctx.fillRect(G.CAM.x - VW / 2 - 60, G.CAM.y - VH / 2 - 60, VW + 120, VH + 120);
  ctx.drawImage(decals, 0, 0, decals.width, decals.height, 0, 0, WORLD, WORLD);

  ctx.lineCap = "butt";
  for (const m of G.tracks) {
    if (Math.abs(m.x - G.CAM.x) > VW / 2 + 30 || Math.abs(m.y - G.CAM.y) > VH / 2 + 30)
      continue;
    const a = (1 - m.t / m.life) * 0.2;
    ctx.strokeStyle = `rgba(30,32,20,${a.toFixed(3)})`;
    ctx.lineWidth = m.w;
    const dx = Math.cos(m.ang) * 5.5;
    const dy = Math.sin(m.ang) * 5.5;
    ctx.beginPath();
    ctx.moveTo(m.x - dx, m.y - dy);
    ctx.lineTo(m.x + dx, m.y + dy);
    ctx.stroke();
  }
  ctx.lineCap = "round";

  for (const b of G.bushes) {
    if (Math.abs(b.x - G.CAM.x) > VW / 2 + 40 || Math.abs(b.y - G.CAM.y) > VH / 2 + 40)
      continue;
    ctx.fillStyle = "rgba(58,74,38,.9)";
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, 6.283);
    ctx.arc(b.x + b.r * 0.6, b.y + b.r * 0.3, b.r * 0.7, 0, 6.283);
    ctx.fill();
  }

  for (const c of G.crates) {
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.seed);
    ctx.fillStyle = "#7a6238";
    ctx.fillRect(-11, -11, 22, 22);
    ctx.strokeStyle = "#54431f";
    ctx.lineWidth = 2;
    ctx.strokeRect(-11, -11, 22, 22);
    ctx.beginPath();
    ctx.moveTo(-11, -11); ctx.lineTo(11, 11);
    ctx.moveTo(11, -11); ctx.lineTo(-11, 11);
    ctx.stroke();
    ctx.restore();
  }

  for (const w of G.wrecks) drawWreck(ctx, w);

  for (const o of G.obstacles) {
    if (o.tree) continue;
    if (Math.abs(o.x - G.CAM.x) > VW / 2 + 60 || Math.abs(o.y - G.CAM.y) > VH / 2 + 60)
      continue;
    if (o.bunker) {
      ctx.save();
      ctx.translate(o.x, o.y);
      ctx.rotate(o.seed);
      ctx.fillStyle = "rgba(0,0,0,.3)";
      ctx.fillRect(-40 + 4, -40 + 5, 80, 80);
      ctx.fillStyle = "#6f6b60";
      ctx.fillRect(-40, -40, 80, 80);
      ctx.strokeStyle = "#4c4940";
      ctx.lineWidth = 3;
      ctx.strokeRect(-40, -40, 80, 80);
      ctx.fillStyle = "#3b3931";
      ctx.fillRect(-18, -18, 36, 36);
      ctx.restore();
    } else {
      ctx.save();
      ctx.translate(o.x, o.y);
      ctx.fillStyle = "rgba(0,0,0,.28)";
      ctx.beginPath();
      ctx.ellipse(3, 4, o.r, o.r * 0.8, 0, 0, 6.283);
      ctx.fill();
      ctx.fillStyle = "#7d7a6c";
      ctx.beginPath();
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * 6.283;
        const rr2 = o.r * (0.75 + (((o.seed * 13 + i * 7) % 10) / 22));
        ctx.lineTo(Math.cos(a) * rr2, Math.sin(a) * rr2);
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#57544a";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }
  }

  if (G.player && !G.player.dead) drawTank(ctx, G.player);
  for (const e of G.enemies) drawTank(ctx, e);
  if (G.player && !G.player.dead) drawLaser(ctx, G.player);
  for (const e of G.enemies) drawLaser(ctx, e);

  for (const s of G.shells) {
    ctx.strokeStyle = s.col;
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.moveTo(s.x - s.dx * 20, s.y - s.dy * 20);
    ctx.lineTo(s.x, s.y);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(s.x, s.y, 2.6, 0, 6.283);
    ctx.fill();
  }

  for (const d of G.debris) {
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.rotate(d.rot);
    ctx.globalAlpha = clamp(1.6 - d.t, 0, 1);
    ctx.fillStyle = d.cls.tur;
    ctx.beginPath();
    ctx.arc(0, 0, d.cls.tR, 0, 6.283);
    ctx.fill();
    ctx.strokeStyle = d.cls.bodyD;
    ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  for (const p of G.parts) {
    const a = 1 - p.t / p.life;
    if (p.kind === "smoke") {
      ctx.fillStyle = `rgba(60,60,55,${a * 0.4})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * (1 + p.t * 2), 0, 6.283);
      ctx.fill();
    } else if (p.kind === "fire") {
      ctx.fillStyle = `rgba(255,${(120 + p.t * 200) | 0},30,${a * 0.8})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * a, 0, 6.283);
      ctx.fill();
    } else if (p.kind === "spark") {
      ctx.fillStyle = `rgba(255,220,120,${a})`;
      ctx.fillRect(p.x, p.y, p.r, p.r);
    } else if (p.kind === "flash") {
      ctx.fillStyle = `rgba(255,210,110,${a * 0.9})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * (1 + a), 0, 6.283);
      ctx.fill();
    } else if (p.kind === "flash2") {
      ctx.fillStyle = `rgba(255,240,190,${a})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * (1 + (1 - a) * 4), 0, 6.283);
      ctx.fill();
    } else if (p.kind === "boom") {
      ctx.fillStyle = `rgba(255,${(100 + p.t * 260) | 0},30,${a})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * a + 1, 0, 6.283);
      ctx.fill();
    } else if (p.kind === "debris") {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = `rgba(40,42,34,${a})`;
      ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r);
      ctx.restore();
    }
  }

  ctx.textAlign = "center";
  ctx.font = "700 15px 'Russo One'";
  for (const f of G.floaters) {
    ctx.globalAlpha = clamp(1.5 - f.t, 0, 1);
    ctx.fillStyle = "#000";
    ctx.fillText(f.txt, f.x + 1, f.y + 1);
    ctx.fillStyle = f.col;
    ctx.fillText(f.txt, f.x, f.y);
    ctx.globalAlpha = 1;
  }

  for (const tr of G.trees) {
    if (Math.abs(tr.x - G.CAM.x) > VW / 2 + 60 || Math.abs(tr.y - G.CAM.y) > VH / 2 + 60)
      continue;
    ctx.fillStyle = "rgba(0,0,0,.22)";
    ctx.beginPath();
    ctx.ellipse(tr.x + 6, tr.y + 8, tr.r, tr.r * 0.8, 0, 0, 6.283);
    ctx.fill();
    ctx.fillStyle = "rgba(52,74,36,.92)";
    ctx.beginPath();
    ctx.arc(tr.x, tr.y, tr.r, 0, 6.283);
    ctx.fill();
    ctx.fillStyle = "rgba(80,106,52,.55)";
    ctx.beginPath();
    ctx.arc(tr.x - tr.r * 0.25, tr.y - tr.r * 0.25, tr.r * 0.6, 0, 6.283);
    ctx.fill();
  }

  for (const q of G.spawnQ) {
    const pl = Math.sin(G.gameT * 8) * 3;
    ctx.save();
    ctx.translate(q.x, q.y);
    ctx.rotate(Math.PI / 4);
    ctx.strokeStyle = "rgba(255,70,55,.9)";
    ctx.lineWidth = 3;
    ctx.strokeRect(-14 - pl, -14 - pl, 28 + pl * 2, 28 + pl * 2);
    ctx.restore();
  }

  ctx.restore();

  if (G.state === "play") {
    for (const e of G.enemies) {
      const sx = e.x - G.CAM.x + VW / 2;
      const sy = e.y - G.CAM.y + VH / 2;
      const m = 34;
      if (sx > -10 && sx < VW + 10 && sy > -10 && sy < VH + 10) continue;
      const cx2 = clamp(sx, m, VW - m);
      const cy2 = clamp(sy, m, VH - m);
      const a = Math.atan2(sy - cy2, sx - cx2);
      ctx.save();
      ctx.translate(cx2, cy2);
      ctx.rotate(a);
      ctx.fillStyle = "rgba(255,70,55,.85)";
      ctx.beginPath();
      ctx.moveTo(12, 0);
      ctx.lineTo(-6, -8);
      ctx.lineTo(-2, 0);
      ctx.lineTo(-6, 8);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = "rgba(255,120,100,.8)";
      ctx.font = "11px Rubik";
      ctx.textAlign = "center";
      ctx.fillText(
        Math.round(Math.hypot(e.x - G.player.x, e.y - G.player.y) / 10) + "м",
        cx2, cy2 + 22
      );
    }
  }

  if (G.state === "play" && G.player && !G.player.dead) {
    const mx = mouse.x, my = mouse.y;
    const sp = dispersion(G.player) * 300 + 6;
    ctx.strokeStyle = G.markT > 0 ? G.markCol : "rgba(230,235,215,.9)";
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(mx, my, sp + 8, 0, 6.283);
    ctx.stroke();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      ctx.beginPath();
      ctx.moveTo(mx + dx * (sp + 12), my + dy * (sp + 12));
      ctx.lineTo(mx + dx * (sp + 22), my + dy * (sp + 22));
      ctx.stroke();
    }
    ctx.fillStyle = G.markT > 0 ? G.markCol : "#eee";
    ctx.beginPath();
    ctx.arc(mx, my, 2, 0, 6.283);
    ctx.fill();

    if (G.player.reload > 0) {
      const rt = reloadTime(G.player);
      const pr = 1 - clamp(G.player.reload / rt, 0, 1);
      ctx.strokeStyle = "rgba(224,178,62,.95)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(mx, my, sp + 16, -Math.PI / 2, -Math.PI / 2 + pr * 6.283);
      ctx.stroke();
    } else {
      ctx.strokeStyle = "rgba(87,217,119,.9)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(mx, my, sp + 16, -Math.PI / 2, -Math.PI / 2 + 0.35 * 6.283);
      ctx.stroke();
    }

    if (G.markT > 0) {
      ctx.fillStyle = G.markCol;
      ctx.font = "700 15px 'Russo One'";
      ctx.textAlign = "center";
      ctx.globalAlpha = clamp(G.markT * 2, 0, 1);
      ctx.fillText(G.markTxt, mx, my - sp - 24);
      ctx.globalAlpha = 1;
    }
    if (G.player.burning > 0) {
      ctx.fillStyle = `rgba(255,90,30,${0.6 + Math.sin(G.gameT * 10) * 0.3})`;
      ctx.font = "700 14px 'Russo One'";
      ctx.textAlign = "center";
      ctx.fillText("ПОЖАР — НАЖМИТЕ F", VW / 2, VH * 0.2);
    }
  } else {
    ctx.fillStyle = "rgba(220,225,200,.7)";
    ctx.beginPath();
    ctx.arc(mouse.x, mouse.y, 3, 0, 6.283);
    ctx.fill();
  }
}