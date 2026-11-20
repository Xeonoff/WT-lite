/**
 * Сетевой протокол онлайн-режима: общий для сервера (Node) и клиента (браузер).
 * Сообщения — JSON. Состояния машин упакованы в короткие массивы, числа округлены.
 */
import { SHELLS } from "../data/Shells.js";

export const PROTO_VERSION = 7;
export const TICK_HZ = 30;          // шаг симуляции на сервере
export const SNAP_EVERY = 2;        // снимок состояния — каждый второй шаг (15 Гц)
export const SNAP_HZ = TICK_HZ / SNAP_EVERY;
export const INPUT_HZ = 30;         // частота отправки ввода клиентом
export const MAX_NAME = 18;

const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;
const r3 = (x) => Math.round(x * 1000) / 1000;
const rv = (p) => p && [r2(p[0]), r2(p[1]), r2(p[2])];
const rd = (p) => p && [r3(p[0]), r3(p[1]), r3(p[2])];

export function cleanName(s) {
    return String(s || "").replace(/[<>&"'`\u0000-\u001f]/g, "").trim().slice(0, MAX_NAME) || "Танкист";
}

/* ─────────── Краткое состояние машины (все видимые машины) ─────────── */
/** Станции босса, чьи углы видны другим (пулемёты неподвижны) */
export const STATIONS_NET = ["t2", "flak_l", "flak_r"];
// флаги
export const F_DEAD = 1, F_FIRE = 2, F_SPOTTED = 4, F_REPAIR = 8, F_SMOKE = 16;

export function packVehicle(v, viewTeam) {
    let f = 0;
    if (v.dead) f |= F_DEAD;
    if (v.fire) f |= F_FIRE;
    if (v.visible[1 - v.team]) f |= F_SPOTTED;
    if (v.repair) f |= F_REPAIR;
    if (v.mods.engine && v.mods.engine.hp < v.mods.engine.maxHp * 0.35) f |= F_SMOKE;
    const a = [v.id, r2(v.x), r2(v.z), r3(v.a), r2(v.v), r3(v.w), r3(v.tr), f, v.input.throttle, v.input.steer, r3(v.gp)];
    // станции вооружения босса: курс и угол возвышения кормовой башни и зениток
    if (v.stn) a.push(STATIONS_NET.map((k) => [r3(v.stn[k].yaw), r3(v.stn[k].pitch)]));
    if (Math.abs(v.slip) > 0.01) a[12] = r2(v.slip);
    return a;
}

/** Полное внутреннее состояние своей машины (для HUD: экипаж, модули, БК, перезарядка) */
export function packOwn(v) {
    const d = v.def;
    const ci = (m) => v.crew.indexOf(m);
    return {
        m: d.modules.map((m) => r1(v.mods[m.id].hp)),
        c: v.crew.map((c) => [c.home, c.seat, r1(c.hp), c.alive ? 1 : 0, c.transit ? 1 : 0]),
        s: d.crew.map((s) => (v.seats[s].occupant ? ci(v.seats[s].occupant) : -1)),
        sw: v.swap ? [ci(v.swap.member), v.swap.from, v.swap.to, r2(v.swap.t), v.swap.dur] : null,
        x: v.extra || null,
        am: v.shellIds().map((sid) => v.ammo[sid]),
        rl: Object.keys(v.racksLost),
        sh: v.shell, ld: v.loaded, mg: v.mag, r: r2(v.reload), rt: r2(v.reloadTotal),
        fi: v.fire ? { pos: rv(v.fire.pos), t: r1(v.fire.t), dur: r1(v.fire.dur) } : null,
        impact: v.impactSeq || 0,
        levels: v.cards ? [...v.cards.entries.values()].filter(e=>e.card.stack)
            .map(e=>[e.id,e.level,Math.floor(100*e.progress/e.card.stack.every)]) : undefined,
        ex: v.ext, mk: v.medkits, rp: v.repair ? [r2(v.repair.t), r2(v.repair.dur)] : null,
        bl: r2(v.bloom), at: v.artyT === undefined ? null : r2(v.artyT), st: r2(v.spawnT),
    };
}

export function applyOwn(v, s) {
    for (const [id,level,percent = 0] of s.levels || []) {
        const entry = v.cards?.entries.get(id);
        if (!entry?.card.stack) continue;
        entry.level = level;
        entry.progress = entry.card.stack.every * percent / 100;
    }
    const d = v.def;
    d.modules.forEach((m, i) => { v.mods[m.id].hp = s.m[i]; });
    // экипаж пересобираем, сохраняя объекты по индексу (на них ссылаются места)
    v.crew.length = s.c.length;
    s.c.forEach(([home, seat, hp, alive, transit], i) => {
        const c = v.crew[i] || (v.crew[i] = { maxHp: 100 });
        Object.assign(c, { home, seat, hp, alive: !!alive, transit: !!transit, maxHp: c.maxHp || 100 });
    });
    d.crew.forEach((name, i) => { v.seats[name].occupant = s.s[i] >= 0 ? v.crew[s.s[i]] : null; });
    v.swap = s.sw ? { member: v.crew[s.sw[0]], from: s.sw[1], to: s.sw[2], t: s.sw[3], dur: s.sw[4] } : null;
    v.extra = s.x && s.x.length ? s.x.slice() : null;
    v.shellIds().forEach((sid, i) => { v.ammo[sid] = s.am[i]; });
    v.racksLost = {};
    for (const id of s.rl) v.racksLost[id] = true;
    v.shell = s.sh; v.loaded = s.ld; v.mag = s.mg; v.reload = s.r; v.reloadTotal = s.rt;
    v.fire = s.fi ? { ...s.fi } : null;
    v.ext = s.ex; v.medkits = s.mk;
    v.repair = s.rp ? { t: s.rp[0], dur: s.rp[1] } : null;
    v.bloom = s.bl;
    if (s.at !== null) v.artyT = s.at;
    v.spawnT = s.st;
}

/* ─────────── Результат попадания ─────────── */
export function packRes(res, full) {
    if (!full) return { kind: res.kind, killed: res.killed, events: res.events, dmg: res.dmg.length ? [res.dmg.length] : [], crit: res.crit };
    const o = { ...res, shell: res.shell ? res.shell.id : null };
    return JSON.parse(JSON.stringify(o, (k, val) => (typeof val === "number" ? Math.round(val * 1000) / 1000 : val)));
}

export function unpackRes(o) {
    const res = { ...o };
    res.shell = o.shell ? SHELLS[o.shell] : null;
    if (!Array.isArray(res.dmg)) res.dmg = [];
    if (res.dmg.length && typeof res.dmg[0] === "number") res.dmg = Array.from({ length: res.dmg[0] }, () => ({ kind: "mod" }));
    res.layers = res.layers || [];
    res.events = res.events || [];
    return res;
}

/* ─────────── Снаряды ─────────── */
export function packShot(s) {
    return [s.id, s.def.id, rv([s.x, s.y, s.z]), rd(s.d), r1(s.speed), s.owner ? s.owner.id : 0, (s.harmless ? 1 : 0) | (s.rico ? 2 : 0) | (s.arty ? 4 : 0), s.life === Infinity ? -1 : r2(s.life)];
}

/* ─────────── Разрушения мира ─────────── */
export const WORLD_LISTS = { tree: "trees", fence: "fences", hay: "hay", hedge: "hedges", building: "buildings" };

export { rv, rd, r2, r3 };
