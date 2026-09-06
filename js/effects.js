import { G } from "./state.js";
import { TAU, rnd, clamp } from "./utils.js";
import { sfx } from "./audio.js";

export function sparks(x, y, n) {
  for (let i = 0; i < n; i++) {
    const a = rnd(TAU);
    const s = rnd(60, 320);
    G.parts.push({
      x, y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      t: 0, life: rnd(0.15, 0.4),
      r: rnd(1, 2.5),
      kind: "spark",
    });
  }
}

export function boom(x, y, sc) {
  G.shake += 10 * sc;
  sfx("boom", clamp(0.9 * sc, 0.3, 1));
  G.parts.push({ x, y, vx: 0, vy: 0, t: 0, life: 0.28, r: 8 * sc, kind: "flash2" });
  for (let i = 0; i < 26 * sc; i++) {
    const a = rnd(TAU);
    const s = rnd(40, 340) * sc;
    G.parts.push({
      x, y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      t: 0, life: rnd(0.3, 0.9),
      r: rnd(3, 8),
      kind: "boom",
    });
  }
  for (let i = 0; i < 14 * sc; i++) {
    G.parts.push({
      x, y,
      vx: rnd(-60, 60), vy: rnd(-60, 60),
      t: 0, life: rnd(0.8, 1.8),
      r: rnd(6, 14),
      kind: "smoke",
    });
  }
  for (let i = 0; i < 10 * sc; i++) {
    const a = rnd(TAU);
    const s = rnd(120, 420);
    G.parts.push({
      x, y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      t: 0, life: rnd(0.3, 0.7),
      r: rnd(2, 4),
      kind: "debris",
      rot: rnd(TAU),
      vr: rnd(-10, 10),
    });
  }
}