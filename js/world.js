import { G } from "./state.js";
import { WORLD } from "./data.js";
import { rnd, dist, segPt, mkCv } from "./utils.js";
import { dctx } from "./state.js";

export const terrain = mkCv(512, 512);
(function initTerrain() {
  const g = terrain.getContext("2d");
  g.fillStyle = "#4c5b34";
  g.fillRect(0, 0, 512, 512);
  const pal = ["#526238", "#455430", "#57683d", "#4f5f36", "#42502c"];
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = pal[i % 5];
    g.fillRect(rnd(512), rnd(512), rnd(2, 7), rnd(2, 7));
  }
  for (let i = 0; i < 26; i++) {
    g.fillStyle = "rgba(0,0,0,.07)";
    g.beginPath();
    g.ellipse(rnd(512), rnd(512), rnd(30, 90), rnd(20, 60), rnd(6.283), 0, 6.283);
    g.fill();
  }
  for (let i = 0; i < 14; i++) {
    g.fillStyle = "rgba(160,150,80,.10)";
    g.beginPath();
    g.ellipse(rnd(512), rnd(512), rnd(20, 70), rnd(14, 40), rnd(6.283), 0, 6.283);
    g.fill();
  }
})();

let terrainPat = null;
export function getTerrainPat(ctx) {
  if (!terrainPat) terrainPat = ctx.createPattern(terrain, "repeat");
  return terrainPat;
}

export function genWorld() {
  G.obstacles = [];
  G.trees = [];
  G.bushes = [];
  G.crates = [];
  G.wrecks = [];
  G.tracks = [];

  const cx = WORLD / 2;
  for (let i = 0; i < 70; i++) {
    const x = rnd(120, WORLD - 120);
    const y = rnd(120, WORLD - 120);
    if (dist(x, y, cx, cx) < 260) continue;
    G.trees.push({ x, y, r: rnd(22, 42), seed: rnd(100) });
    G.obstacles.push({ x, y, r: 9, tree: true });
  }
  for (let i = 0; i < 22; i++) {
    const x = rnd(150, WORLD - 150);
    const y = rnd(150, WORLD - 150);
    if (dist(x, y, cx, cx) < 300) continue;
    const r = rnd(16, 32);
    G.obstacles.push({ x, y, r, rock: true, seed: rnd(100) });
  }
  for (let i = 0; i < 6; i++) {
    const x = rnd(300, WORLD - 300);
    const y = rnd(300, WORLD - 300);
    if (dist(x, y, cx, cx) < 420) continue;
    G.obstacles.push({ x, y, r: 44, bunker: true, seed: rnd(100) });
  }
  for (let i = 0; i < 40; i++) {
    G.bushes.push({
      x: rnd(100, WORLD - 100),
      y: rnd(100, WORLD - 100),
      r: rnd(10, 18),
      seed: rnd(100),
    });
  }
  for (let i = 0; i < 14; i++) {
    const x = rnd(300, WORLD - 300);
    const y = rnd(300, WORLD - 300);
    G.crates.push({ x, y, hp: 20, r: 13, seed: rnd(100) });
  }

  dctx.clearRect(0, 0, dctx.canvas.width, dctx.canvas.height);
  dctx.save();
  dctx.scale(0.5, 0.5);
  dctx.strokeStyle = "rgba(107,92,63,.55)";
  dctx.lineCap = "round";
  dctx.lineWidth = 54;
  dctx.beginPath();
  dctx.moveTo(0, WORLD * 0.38);
  dctx.bezierCurveTo(WORLD * 0.3, WORLD * 0.3, WORLD * 0.6, WORLD * 0.62, WORLD, WORLD * 0.55);
  dctx.stroke();
  dctx.beginPath();
  dctx.moveTo(WORLD * 0.42, 0);
  dctx.bezierCurveTo(WORLD * 0.5, WORLD * 0.35, WORLD * 0.34, WORLD * 0.6, WORLD * 0.46, WORLD);
  dctx.stroke();
  dctx.strokeStyle = "rgba(60,50,32,.35)";
  dctx.lineWidth = 4;
  dctx.setLineDash([26, 20]);
  dctx.beginPath();
  dctx.moveTo(0, WORLD * 0.38);
  dctx.bezierCurveTo(WORLD * 0.3, WORLD * 0.3, WORLD * 0.6, WORLD * 0.62, WORLD, WORLD * 0.55);
  dctx.stroke();
  dctx.restore();
}

export function freeSpot(minD) {
  for (let k = 0; k < 40; k++) {
    const edge = (rnd(4)) | 0;
    const m = 140;
    let x, y;
    if (edge === 0) { x = m; y = rnd(m, WORLD - m); }
    else if (edge === 1) { x = WORLD - m; y = rnd(m, WORLD - m); }
    else if (edge === 2) { x = rnd(m, WORLD - m); y = m; }
    else { x = rnd(m, WORLD - m); y = WORLD - m; }
    if (G.player && dist(x, y, G.player.x, G.player.y) < minD) continue;
    if (G.obstacles.some((o) => dist(x, y, o.x, o.y) < o.r + 70)) continue;
    return { x, y };
  }
  return { x: rnd(400, WORLD - 400), y: rnd(400, WORLD - 400) };
}

export function losClear(x1, y1, x2, y2) {
  for (const o of G.obstacles) {
    if (o.tree) continue;
    if (segPt(x1, y1, x2, y2, o.x, o.y) < o.r) return false;
  }
  return true;
}

export function scorched(x, y, r) {
  dctx.save();
  dctx.translate(x / 2, y / 2);
  const g = dctx.createRadialGradient(0, 0, 2, 0, 0, r / 2);
  g.addColorStop(0, "rgba(10,10,8,.8)");
  g.addColorStop(1, "rgba(10,10,8,0)");
  dctx.fillStyle = g;
  dctx.beginPath();
  dctx.arc(0, 0, r / 2, 0, 6.283);
  dctx.fill();
  dctx.restore();
}

export function breakCrate(i) {
  const c = G.crates[i];
  if (!c) return;
  G.crates.splice(i, 1);
  for (let k = 0; k < 8; k++) {
    G.parts.push({
      x: c.x, y: c.y,
      vx: rnd(-140, 140), vy: rnd(-140, 140),
      t: 0, life: rnd(0.3, 0.7),
      r: rnd(2, 4),
      kind: "debris",
      rot: rnd(6.283),
      vr: rnd(-8, 8),
    });
  }
}