import { G } from "./state.js";
import { MNAMES } from "./data.js";
import { rnd, clamp, dist, segPt } from "./utils.js";
import {
  turretPos, tankRadius, reloadTime, dispersion, toLocal, crewAlive,
} from "./entities.js";
import { sfx } from "./audio.js";
import { sparks, boom } from "./effects.js";
import { scorched } from "./world.js";
import { addFeed, floater, showXR } from "./hud.js";

export function fire(t, ang, shellDef) {
  const tp = turretPos(t);
  const bl = t.cls.tR + t.cls.barrel * 0.92;
  const bx = tp.x + Math.cos(t.ta) * bl;
  const by = tp.y + Math.sin(t.ta) * bl;
  const a = ang + (rnd() - 0.5) * 2 * dispersion(t);

  G.shells.push({
    x: bx, y: by,
    dx: Math.cos(a), dy: Math.sin(a),
    spd: shellDef.spd, pen: shellDef.pen, dmg: shellDef.dmg,
    he: shellDef.type === "ОФ",
    col: shellDef.col, name: shellDef.name,
    life: 1.15, own: t.isPlayer ? "p" : "e",
    tank: t, ang: a,
  });

  t.recoil = 1;
  t.reload = reloadTime(t) * (t.isPlayer ? 1 : rnd(0.9, 1.2));

  for (let i = 0; i < 12; i++) {
    G.parts.push({
      x: bx, y: by,
      vx: Math.cos(a) * rnd(120, 420) + rnd(-40, 40),
      vy: Math.sin(a) * rnd(120, 420) + rnd(-40, 40),
      t: 0, life: rnd(0.12, 0.3),
      r: rnd(2, 6), kind: "flash",
    });
  }
  for (let i = 0; i < 7; i++) {
    G.parts.push({
      x: bx, y: by,
      vx: Math.cos(a) * rnd(40, 120) + rnd(-30, 30),
      vy: Math.sin(a) * rnd(40, 120) + rnd(-30, 30),
      t: 0, life: rnd(0.6, 1.2),
      r: rnd(4, 9), kind: "smoke",
    });
  }

  // БАГ-ФИКС: если игрок мёртв, не считаем громкость относительно его позиции
  let vol;
  if (t.isPlayer) vol = 0.9;
  else if (G.player && !G.player.dead)
    vol = clamp(1 - dist(bx, by, G.player.x, G.player.y) / 1400, 0.08, 0.6);
  else vol = 0.4;

  sfx("shoot", vol, t.isPlayer ? 1 : 0.85);
  if (t.isPlayer) G.shake += 7;
}

export function damageModules(tank, hits, byPlayer) {
  for (const h of hits) {
    const m = tank.mods[h.t];
    if (!m) continue;
    const before = m.hp;
    m.hp = Math.max(0, m.hp - h.dmg);

    if (before > 0 && m.hp <= 0) {
      if (h.t === "ammo") {
        detonate(tank, byPlayer);
        return "det";
      }
      if (h.t === "engine")
        addFeed(
          (tank.isPlayer ? "Ваша машина: " : "«" + tank.cls.name + "»: ") +
            "двигатель уничтожен",
          "warn"
        );
      if (h.t === "gun")
        addFeed(
          (tank.isPlayer ? "Ваша машина: " : "«" + tank.cls.name + "»: ") +
            "орудие выведено",
          "warn"
        );
      if (["driver", "gunner", "loader", "commander"].includes(h.t))
        addFeed(
          (tank.isPlayer ? "" : "«" + tank.cls.name + "»: ") +
            MNAMES[h.t] +
            ": выведен из строя",
          "warn"
        );
    }
    if (
      (h.t === "fuel" || h.t === "engine") &&
      tank.burning <= 0 &&
      rnd() < 0.33
    ) {
      tank.burning = rnd(4, 7);
      addFeed(
        tank.isPlayer ? "ПОЖАР В МАШИНЕ!" : "Противник горит",
        tank.isPlayer ? "bad" : "good"
      );
    }
  }
  if (!tank.dead && !crewAlive(tank)) {
    destroyTank(tank, "crew", byPlayer);
    return "crew";
  }
  return null;
}

export function detonate(tank, byPlayer) {
  if (tank.dead) return;
  tank.burning = 0;
  destroyTank(tank, "ammo", byPlayer);
  const tp = turretPos(tank);
  G.debris.push({
    x: tp.x, y: tp.y,
    vx: rnd(-90, 90), vy: rnd(-90, 90),
    rot: tank.ta, vr: rnd(-6, 6),
    t: 0, cls: tank.cls,
  });
  boom(tank.x, tank.y, 2.2);
  sfx("det", 0.9);
  G.shake += tank.isPlayer ? 26 : 16;
  slowmo(0.55);
  addFeed(
    (tank.isPlayer ? "ВАША МАШИНА" : "«" + tank.cls.name + "»") +
      ": детонация боеукладки!",
    "bad"
  );
  scorched(tank.x, tank.y, 46);
}

export function destroyTank(tank, cause, byPlayer) {
  if (tank.dead) return;
  tank.dead = true;
  tank.burning = 0;

  G.wrecks.push({
    x: tank.x, y: tank.y,
    a: tank.a, ta: tank.ta,
    cls: tank.cls,
    noTurret: cause === "ammo",
  });
  scorched(tank.x, tank.y, cause === "ammo" ? 40 : 26);

  if (!tank.isPlayer) {
    G.enemies = G.enemies.filter((e) => e !== tank);
    G.kills++;
    const s = tank.cls.score;
    G.score += s;
    floater(tank.x, tank.y, "+" + s, "#ffd23f");
    if (cause !== "ammo") {
      boom(tank.x, tank.y, 1.1);
      sfx("boom", 0.8);
      addFeed("«" + tank.cls.name + "» уничтожен, +" + s, "good");
    }
  } else {
    G.overT = 1.8;
    G.overCause =
      cause === "ammo"
        ? "детонация боеукладки"
        : "весь экипаж выведен из строя";
    sfx("boom", 1);
    G.shake += 30;
    slowmo(0.7);
  }
}

export function computeImpact(shell, tank) {
  const c = tank.cls;
  const raw = toLocal(tank, shell.x, shell.y);
  const dlx = Math.cos(shell.ang - tank.a);
  const dly = Math.sin(shell.ang - tank.a);
  const loc = { x: raw.x - dlx * 9, y: raw.y - dly * 9 };
  const inTur = Math.hypot(raw.x - c.tOff, raw.y) < c.tR;

  let plate, armor, px, py;
  if (inTur) {
    plate = "башня";
    armor = c.armor.turret;
    let nx = raw.x - c.tOff, ny = raw.y;
    const nl = Math.hypot(nx, ny) || 1;
    nx /= nl; ny /= nl;
    px = -ny; py = nx;
  } else if (Math.abs(raw.x) / (c.L / 2) >= Math.abs(raw.y) / (c.W / 2)) {
    plate = raw.x > 0 ? "корма" : "лоб";
    armor = raw.x > 0 ? c.armor.rear : c.armor.front;
    px = 0; py = 1;
  } else {
    plate = "борт";
    armor = c.armor.side;
    px = 1; py = 0;
  }

  const meetAng = Math.acos(clamp(Math.abs(dlx * px + dly * py), 0, 1));
  const meetDeg = Math.round(meetAng * 57.3);
  const sinM = Math.max(Math.sin(meetAng), 0.35);
  const eff = armor / sinM;

  const dir = { x: dlx, y: dly };

  if (shell.he) {
    const deep = eff < 20;
    const af = deep ? 1 : clamp(1 - eff / 90, 0.08, 1);
    const hits = [];
    for (const m of c.schema.mods) {
      const d = dist(m.x, m.y, loc.x, loc.y);
      const R = (m.r || 8) + (deep ? 34 : 26);
      if (d < R) {
        const fall = 1 - d / R;
        let dmg = shell.dmg * af * fall;
        if (m.t === "gun" || m.t === "ring") dmg *= 1.2;
        if (dmg > 3) hits.push({ t: m.t, dmg, x: m.x, y: m.y });
      }
    }
    return {
      type: "he", eff, deep, plate, meetDeg,
      entry: loc, dir, hits, wx: shell.x, wy: shell.y,
    };
  }

  if (meetAng < 0.436 && rnd() < 0.75) {
    const sg = dlx * px + dly * py >= 0 ? 1 : -1;
    return {
      type: "rico", ang: meetAng, meetDeg, eff, plate,
      entry: loc, dir,
      tan: { x: px * sg, y: py * sg },
      wx: shell.x, wy: shell.y,
    };
  }

  if (shell.pen < eff) {
    return {
      type: "nofrag", eff, plate, meetDeg,
      entry: loc, dir, wx: shell.x, wy: shell.y,
    };
  }

  const resPen = shell.pen - eff;
  const pathLen = Math.min(26 + resPen * 1.15, c.L * 1.6);
  const ex2 = loc.x + dlx * pathLen;
  const ey2 = loc.y + dly * pathLen;
  const hits = [];
  for (const m of c.schema.mods) {
    const d = segPt(loc.x, loc.y, ex2, ey2, m.x, m.y);
    const along = Math.abs((m.x - loc.x) * dlx + (m.y - loc.y) * dly);
    const cone = (m.r || 8) + 5 + along * 0.12;
    if (d < cone) {
      const fall = 1 - d / cone;
      const dmg = (shell.dmg + resPen * 0.35) * fall;
      if (dmg > 4) hits.push({ t: m.t, dmg, x: m.x, y: m.y });
    }
  }
  return {
    type: "pen", eff, res: resPen, pathLen, plate, meetDeg,
    entry: loc, dir, hits, wx: shell.x, wy: shell.y,
  };
}

export function hitResultFx(shell, tank, res) {
  const shooterP = shell.own === "p";
  if (res.type === "rico") {
    sfx("ping", shooterP ? 0.9 : 0.4);
    sparks(res.wx, res.wy, 8);
    if (shooterP) {
      markHit("РИКОШЕТ", "#ffd23f");
      G.score += 5;
      showXR(
        "РИКОШЕТ",
        "Зона: " + res.plate + " · угол встречи " + res.meetDeg +
          "° — скользящий удар, снаряд отброшен",
        shell.name + " · " + tank.cls.name,
        tank, res, "rico"
      );
    }
  } else if (res.type === "nofrag") {
    sfx("thud", shooterP ? 0.8 : 0.35);
    sparks(res.wx, res.wy, 10);
    if (shooterP) {
      markHit("НЕ ПРОБИЛ", "#9fb0be");
      G.score += 5;
      showXR(
        "СНАРЯД НЕ ПРОБИЛ",
        "Зона: " + res.plate + " · угол встречи " + res.meetDeg +
          "° · приведённая броня " + Math.round(res.eff) +
          " мм против пробития " + Math.round(shell.pen) + " мм",
        shell.name + " · " + tank.cls.name,
        tank, res, "nofrag"
      );
    }
  } else if (res.type === "he") {
    boom(res.wx, res.wy, 0.9);
    sfx("boom", shooterP ? 0.8 : 0.5);
    G.shake += shooterP ? 5 : 2;
    if (shooterP) markHit("ПОДРЫВ ОФ", "#ff8c42");
    damageModules(tank, res.hits, shooterP);
    if (shooterP) {
      showXR(
        "ФУГАСНЫЙ ПОДРЫВ",
        evSub(res.hits) +
          "<br><span style='color:#8fa0b2'>Зона: " + res.plate +
          " · приведённая " + Math.round(res.eff) + " мм</span>",
        shell.name + " · " + tank.cls.name,
        tank, res, "he"
      );
    }
  } else {
    G.pens += shooterP ? 1 : 0;
    sfx("pen", shooterP ? 0.9 : 0.5);
    const ev = damageModules(tank, res.hits, shooterP);
    if (ev === "det" && shooterP) G.score += Math.round(tank.cls.score * 0.25);
    if (shooterP) {
      G.score += 40;
      markHit(ev === "det" ? "ДЕТОНАЦИЯ!" : "ПРОБИТИЕ", "#ff5147");
      slowmo(0.28);
      showXR(
        ev === "det" ? "ДЕТОНАЦИЯ!" : "ПРОБИТИЕ",
        evSub(res.hits) +
          "<br><span style='color:#8fa0b2'>Зона: " + res.plate +
          " · угол встречи " + res.meetDeg + "° · приведённая " +
          Math.round(res.eff) + " мм · заброневое " +
          Math.round(res.res) + " мм</span>",
        shell.name + " · " + tank.cls.name,
        tank, res, "pen"
      );
    }
  }
  // БАГ-ФИКС: защита от null player
  if (!shooterP && G.player && tank === G.player && res.type !== "rico") {
    const v = document.getElementById("vign");
    if (v) { v.style.opacity = 1; setTimeout(() => { v.style.opacity = 0; }, 160); }
    G.shake += 8;
  }
}

export function evSub(hits) {
  if (!hits.length) return "Осколки не поразили модули";
  return hits
    .slice(0, 3)
    .map((h) => MNAMES[h.t] + " <b>−" + Math.round(h.dmg) + "</b>")
    .join(" · ");
}

export function markHit(t, c) {
  G.markTxt = t;
  G.markCol = c;
  G.markT = 0.8;
}

export function slowmo(t) {
  G.slowT = Math.max(G.slowT, t);
}