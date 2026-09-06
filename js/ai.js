import { G } from "./state.js";
import {
  rnd, clamp, dist, angDiff,
} from "./utils.js";
import {
  tankSpeed, tankTurretSpd, tankRadius, dispersion,
  moveTank,
} from "./entities.js";
import { fire } from "./combat.js";
import { losClear } from "./world.js";

export function updateAI(e, dt) {
  const p = G.player;
  if (!p || p.dead) return;

  const d = dist(e.x, e.y, p.x, p.y);
  const angTo = Math.atan2(p.y - e.y, p.x - e.x);

  const ai = e.ai;
  ai.wanderT -= dt;
  if (ai.wanderT <= 0) {
    ai.wanderT = rnd(2, 4);
    ai.side = rnd() < 0.5 ? -1 : 1;
  }

  let want = angTo, drive = 1;
  if (e.cls.flank && d < 600) want = angTo + ai.side * 1.25;
  if (d < e.cls.keep - 60) { want = angTo + Math.PI; drive = 1; }
  else if (d <= e.cls.keep + 120) drive = e.cls.flank ? 1 : 0.25;

  const fx = e.x + Math.cos(e.a) * 90;
  const fy = e.y + Math.sin(e.a) * 90;

  for (const o of G.obstacles) {
    if (o.tree) continue;
    if (dist(fx, fy, o.x, o.y) < o.r + 44) {
      want += 0.9 * ai.side;
      break;
    }
  }
  for (const o of G.enemies) {
    if (o === e || o.dead) continue;
    if (dist(fx, fy, o.x, o.y) < 110) {
      want += 1.15 * ai.side;
      break;
    }
    if (dist(e.x, e.y, o.x, o.y) < tankRadius(e) + tankRadius(o) + 14) {
      want += 1.4 * ai.side;
      break;
    }
  }

  const dh = angDiff(e.a, want);
  e.a += clamp(dh, -e.cls.turn * dt, e.cls.turn * dt);

  const sp = tankSpeed(e);
  const tv = Math.abs(dh) < 1.15 ? sp * drive : sp * 0.3 * Math.sign(drive || 1);
  e.v += clamp(tv - e.v, -200 * dt, 200 * dt);
  moveTank(e, dt);

  ai.errT -= dt;
  if (ai.errT <= 0) {
    ai.errT = rnd(0.8, 1.6);
    ai.aimErr = rnd(-1, 1) * (dispersion(e) * 2 + 0.008);
  }

  const ts = tankTurretSpd(e);
  const da = angDiff(e.ta, angTo + ai.aimErr);
  e.ta += clamp(da, -ts * dt, ts * dt);
  e.reload -= dt;

  if (
    e.reload <= 0 &&
    e.mods.gun.hp > 0 &&
    Math.abs(angDiff(e.ta, angTo)) < 0.11 &&
    d < 980 &&
    losClear(e.x, e.y, p.x, p.y)
  ) {
    fire(e, e.ta, {
      pen: e.cls.pen + (G.wave - 1) * 3,
      spd: 1150,
      type: "ББ",
      dmg: e.cls.dmg,
      name: "Б-" + e.cls.kind,
    });
  }
}