import { G } from "./state.js";
import { SHELLS } from "./data.js";
import { clamp, lerp, rnd, dist, angDiff } from "./utils.js";
import {
    mkTank, tankSpeed, tankTurretSpd, tankRadius, reloadTime,
    toLocal, turretPos, moveTank,
} from "./entities.js";
import { fire, damageModules, computeImpact, hitResultFx } from "./combat.js";
import { sparks } from "./effects.js";
import { scorched } from "./world.js";
import { updateAI } from "./ai.js";
import { addFeed, startWave, spawnWave, banner } from "./hud.js";
import { updEngine } from "./audio.js";
import { keys, mouse } from "./input.js";

export function updatePlayer(dt) {
    const p = G.player;
    if (!p || p.dead) return;

    const sp = tankSpeed(p);
    let th = 0, tr = 0;
    if (keys.KeyW) th = 1;
    else if (keys.KeyS) th = -0.55;
    if (keys.KeyA) tr = -1;
    if (keys.KeyD) tr = 1;

    const tv = sp * th;
    p.v += clamp(tv - p.v, -260 * dt, 260 * dt);
    p.a += tr * p.cls.turn * dt * (Math.abs(p.v) > 5 ? (p.v < 0 ? -1 : 1) : 1);
    moveTank(p, dt);

    const mw = {
        x: G.CAM.x + (mouse.x - innerWidth / 2),
        y: G.CAM.y + (mouse.y - innerHeight / 2),
    };
    const tp = turretPos(p);
    const want = Math.atan2(mw.y - tp.y, mw.x - tp.x);
    const ts = tankTurretSpd(p);
    const da = angDiff(p.ta, want);
    p.ta += clamp(da, -ts * dt, ts * dt);

    p.reload -= dt;
    if (mouse.down && p.reload <= 0) {
        if (p.mods.gun.hp > 0) fire(p, p.ta, SHELLS[G.curShell]);
        else p.reload = 0.4;
    }
}

export function updateTankCommon(t, dt) {
    t.recoil = Math.max(0, t.recoil - dt * 4);
    t.mark += dt;
    if (t.burning > 0) {
        t.burning -= dt;
        t.burnTick -= dt;
        if (t.burnTick <= 0) {
            t.burnTick = 0.8;
            const ms = t.cls.schema.mods.map((m) => m.t);
            const pick = ms[(rnd() * ms.length) | 0];
            if (damageModules(t, [{ t: pick, dmg: 6, x: 0, y: 0 }], t.isPlayer) === "det")
                return;
        }
        if (rnd() < 0.3) {
            G.parts.push({
                x: t.x + rnd(-12, 12), y: t.y + rnd(-12, 12),
                vx: rnd(-20, 20), vy: rnd(-20, 20),
                t: 0, life: rnd(0.4, 0.8),
                r: rnd(4, 9), kind: "fire",
            });
        }
    }
    if (t.isPlayer) {
        const firev = document.getElementById("firev");
        if (firev) firev.style.opacity = t.burning > 0 ? 1 : 0;
    }
    if (t.mods.engine.hp <= 0 && rnd() < 0.15) {
        G.parts.push({
            x: t.x + rnd(-10, 10), y: t.y + rnd(-10, 10),
            vx: rnd(-14, 14), vy: rnd(-14, 14),
            t: 0, life: rnd(0.8, 1.6),
            r: rnd(5, 11), kind: "smoke",
        });
    }
    if (t.repair) {
        t.repair.t += dt;
        if (t.repair.t >= t.repair.dur) {
            const k = t.repair.target;
            const m = t.mods[k];
            if (t.repair.kind === "crew") {
                m.hp = Math.max(m.hp, m.hp <= 0 ? 50 : Math.min(m.max, m.hp + 70));
                addFeed(
                    (m.hp <= 50 ? " возвращён в строй" : " вылечен"),
                    "good"
                );
            } else {
                m.hp = m.max;
                addFeed(k + ": отремонтирован", "good");
            }
            t.repair = null;
        }
    }
    if (t.fext > 0) t.fext -= dt;
}

export function updateShells(dt) {
    for (let i = G.shells.length - 1; i >= 0; i--) {
        const s = G.shells[i];
        if (!isFinite(s.x) || !isFinite(s.y) || !isFinite(s.spd)) {
            G.shells.splice(i, 1);
            continue;
        }
        const steps = Math.max(1, Math.ceil((s.spd * dt) / 10));
        let hit = null;
        for (let st = 0; st < steps && !hit; st++) {
            s.x += (s.dx * s.spd * dt) / steps;
            s.y += (s.dy * s.spd * dt) / steps;

            for (const o of G.obstacles) {
                if (o.tree) continue;
                if (dist(s.x, s.y, o.x, o.y) < o.r) {
                    hit = { obs: o };
                    break;
                }
            }
            if (!hit) {
                for (let ci = G.crates.length - 1; ci >= 0; ci--) {
                    const c = G.crates[ci];
                    if (dist(s.x, s.y, c.x, c.y) < c.r) {
                        if (s.he) { hit = { obs: c }; }
                        // breakCrate вызывается через world при обработке
                        break;
                    }
                }
            }
            if (!hit) {
                const targets =
                    s.own === "p"
                        ? G.enemies
                        : [G.player, ...G.enemies.filter((e) => e !== s.tank)];
                for (const t of targets) {
                    if (!t || t.dead) continue;
                    const loc = toLocal(t, s.x, s.y);
                    const inH = Math.abs(loc.x) < t.cls.L / 2 && Math.abs(loc.y) < t.cls.W / 2;
                    const inT = Math.hypot(loc.x - t.cls.tOff, loc.y) < t.cls.tR;
                    if (inH || inT) {
                        hit = { tank: t };
                        break;
                    }
                }
            }
            s.life -= dt / steps;
            if (s.life <= 0) hit = { gone: 1 };
        }
        if (hit) {
            G.shells.splice(i, 1);
            if (hit.obs) {
                if (s.he) {
                    // boom через effects
                    import("./effects.js").then(m => m.boom(s.x, s.y, 0.7));
                }
                sparks(s.x, s.y, 8);
            } else if (hit.tank) {
                const res = computeImpact(s, hit.tank);
                hitResultFx(s, hit.tank, res);
            }
        }
    }
}

export function updateParticles(dt) {
    for (let i = G.parts.length - 1; i >= 0; i--) {
        const p = G.parts[i];
        p.t += dt;
        if (p.t >= p.life) {
            G.parts.splice(i, 1);
            continue;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 1 - 1.6 * dt;
        p.vy *= 1 - 1.6 * dt;
        if (p.vr) p.rot += p.vr * dt;
    }
    for (let i = G.tracks.length - 1; i >= 0; i--) {
        const m = G.tracks[i];
        m.t += dt;
        if (m.t >= m.life) G.tracks.splice(i, 1);
    }
    for (let i = G.debris.length - 1; i >= 0; i--) {
        const d = G.debris[i];
        d.t += dt;
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        d.rot += d.vr * dt;
        d.vx *= 1 - 1.2 * dt;
        d.vy *= 1 - 1.2 * dt;
        if (rnd() < 0.4) {
            G.parts.push({
                x: d.x, y: d.y,
                vx: 0, vy: 0,
                t: 0, life: 0.8,
                r: rnd(4, 9), kind: "smoke",
            });
        }
        if (d.t > 1.3) {
            G.debris.splice(i, 1);
            scorched(d.x, d.y, 20);
        }
    }
    for (let i = G.floaters.length - 1; i >= 0; i--) {
        const f = G.floaters[i];
        f.t += dt;
        f.y -= 26 * dt;
        if (f.t > 1.4) G.floaters.splice(i, 1);
    }
    for (const w of G.wrecks) {
        if (rnd() < 0.06) {
            G.parts.push({
                x: w.x + rnd(-14, 14), y: w.y + rnd(-14, 14),
                vx: rnd(-8, 8), vy: rnd(-8, 8),
                t: 0, life: rnd(1, 2),
                r: rnd(6, 12), kind: "smoke",
            });
        }
    }
}

export function update(dt) {
    if (G.slowT > 0) {
        G.slowT -= dt;
        G.timeScale = lerp(G.timeScale, 0.3, 0.2);
    } else {
        G.timeScale = lerp(G.timeScale, 1, 0.1);
    }

    const sdt = dt * G.timeScale;
    G.gameT += sdt;

    // БАГ-ФИКС: после смерти не обновляем снаряды (иначе летят в труп)
    if (G.state === "play") {
        updatePlayer(sdt);
        for (const e of G.enemies) updateAI(e, sdt);
    }

    const all = [G.player, ...G.enemies].filter((t) => t && !t.dead);
    for (const t of all) updateTankCommon(t, sdt);

    for (let i = G.spawnQ.length - 1; i >= 0; i--) {
        const q = G.spawnQ[i];
        q.t -= sdt;
        if (q.t <= 0) {
            G.spawnQ.splice(i, 1);
            const e = mkTank(q.cls, q.x, q.y, false);
            G.enemies.push(e);
            sparks(q.x, q.y, 14);
        }
    }

    if (G.state === "play") {
        updateShells(sdt);
    }
    updateParticles(sdt);

    if (G.state === "play") {
        if (G.waveState === "announce") {
            G.waveT -= sdt;
            if (G.waveT <= 0) {
                G.waveState = "fight";
                spawnWave(G.wave);
            }
        } else if (G.waveState === "fight") {
            if (G.enemies.length === 0 && G.spawnQ.length === 0) {
                G.waveState = "clear";
                G.waveT = 2.6;
                G.score += 100 * G.wave;
                banner("ВОЛНА " + G.wave + " ЗАЧИЩЕНА", "полевой ремонт выполнен");
                for (const k in G.player.mods) {
                    const m = G.player.mods[k];
                    m.hp = Math.min(m.max, m.hp + m.max * 0.45);
                }
                addFeed("Полевой ремонт: модули и экипаж частично восстановлены", "good");
            }
        } else if (G.waveState === "clear") {
            G.waveT -= sdt;
            if (G.waveT <= 0) startWave(G.wave + 1);
        }
    }

    if (G.overT > 0) {
        G.overT -= dt;
        if (G.overT <= 0 && G.state === "play") {
            G.state = "respawn";
            import("./hud.js").then((m) => m.showRespawnMenu());
        }
    }

    const lead = {
        x: (mouse.x - innerWidth / 2) * 0.22,
        y: (mouse.y - innerHeight / 2) * 0.22,
    };
    if (G.player) {
        G.CAM.x = lerp(G.CAM.x, G.player.x + lead.x, 1 - Math.pow(0.001, dt));
        G.CAM.y = lerp(G.CAM.y, G.player.y + lead.y, 1 - Math.pow(0.001, dt));
    }
    const WORLD = 3400;
    G.CAM.x = clamp(G.CAM.x, innerWidth / 2 - 100, WORLD - innerWidth / 2 + 100);
    G.CAM.y = clamp(G.CAM.y, innerHeight / 2 - 100, WORLD - innerHeight / 2 + 100);
    G.shake = Math.max(0, G.shake - 60 * dt);
    G.shX = rnd(-G.shake, G.shake) * 0.5;
    G.shY = rnd(-G.shake, G.shake) * 0.5;

    if (G.xr) {
        G.xr.t += dt;
        if (G.xr.t > G.xr.dur) {
            const xrEl = document.getElementById("xr");
            if (xrEl) xrEl.classList.remove("show");
            G.xr = null;
        }
    }
    if (G.markT > 0) G.markT -= dt;

    updEngine(G.player ? G.player.v : 0);
}