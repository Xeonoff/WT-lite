import assert from "node:assert/strict";
import { test } from "node:test";
import { getVehicle, ALL_VEHICLES } from "../js/data/VehicleBuild.js";
import { Vehicle } from "../js/sim/Vehicle.js";
import { Battle } from "../js/sim/Battle.js";
import { driveVehicle, resolveCollisions, settleOnGround } from "../js/sim/Physics.js";
import { packOwn, packVehicle } from "../js/net/Protocol.js";
import { hullToWorld } from "../js/sim/Armor.js";
import { beltTravel } from "../js/sim/Suspension.js";

const tank = (id = "t34_41", x = 80, z = 80, a = 0) => new Vehicle(getVehicle(id), 0, x, z, a);
const flat = (objects = []) => ({ S: 200, terrain: { height: () => 0 }, biome: { treeKind: "leaf" }, query: () => objects });
const collide = (vehicles, world = flat()) => resolveCollisions({
    vehicles, world, time: 2, lastDt: 1 / 30, creditDamage: Battle.prototype.creditDamage,
});
const losses = v => Object.values(v.mods).reduce((n, m) => n + m.maxHp - m.hp, 0)
    + v.crew.reduce((n, c) => n + c.maxHp - c.hp, 0);
const wall = { type: "building", o: { x: 0, z: 80, a: 0, hl: 1, hw: 8 } };
function atWall(v) {
    return flat([{ ...wall, o: { ...wall.o, x: v.x + v.def.dims.L / 2 + 0.99 } }]);
}

test("A wall stops a square impact. A fast impact damages the front, gentle sustained contact is harmless", () => {
    const v = tank(), world = atWall(v);
    v.v = 11;
    collide([v], world);
    assert.ok(Math.abs(v.v) < 1e-8);
    assert.ok(v.seats.driver.occupant.hp < v.seats.driver.occupant.maxHp);
    assert.equal(v.mods.engine.hp, v.mods.engine.maxHp);
    const loss = losses(v);
    for (let i = 0; i < 100; i++) { v.x += 0.001; v.v = 0.1; collide([v], world); }
    assert.equal(losses(v), loss);
    assert.equal(packOwn(v).impact, 1);
});

test("An off-centre ram transfers momentum, slides and turns the lighter vehicle", () => {
    const a = tank("kv1"), b = tank("bt7", 80, 80, Math.PI / 2);
    b.x += (a.def.dims.L + b.def.dims.W) / 2 - 0.02;
    b.team = 1;
    b.z += 1.6;
    a.v = 10;
    const initial = a.def.mob.mass * a.v;
    collide([a, b]);
    assert.ok(b.slip < -1 && Math.abs(b.w) > 0.05);
    assert.ok(Math.abs(initial - (a.v * a.def.mob.mass - b.slip * b.def.mob.mass)) < 1e-6);
    assert.ok(losses(b) > losses(a));
    assert.ok(a.stats.dmg > 0);
    assert.equal(packVehicle(b, 0)[12], Math.round(b.slip * 100) / 100);
});

test("An overlap of separating vehicles causes no damage", () => {
    const a = tank(), b = tank();
    b.x += a.def.dims.L - 0.1;
    a.v = -9; b.v = 3;
    collide([a, b]);
    assert.equal(losses(a) + losses(b), 0);
    assert.equal(a.v, -9);
});

test("A range target waits with no AI, moves after a side ram, and resets to its slot", () => {
    const b = new Battle({ mode: "range", mapId: "prokhorovka", nation: "ussr",
        seed: 31, lineup: ["kv1"], rangeTargets: ["pz2f"] });
    const slot = b.modeCtl.slots[2], target = slot.v, p = b.spawnPlayer("kv1");
    const { x, z } = target;
    const dt = 1 / 60;
    for (let i = 0; i < 30; i++) b.update(dt);
    assert.equal(target.brain, null);
    assert.equal(target.x, x); assert.equal(target.z, z);
    p.a = Math.PI / 2; p.x = x + 0.7;
    p.z = z - (p.def.dims.L + target.def.dims.W) / 2 - 0.12;
    p.v = 9;
    settleOnGround(p, b.world);
    for (let i = 0; i < 40; i++) b.update(dt);
    assert.ok(target.z - z > 1, "range target should slide away");
    assert.ok(Math.abs(target.a) > 0.03, "off-centre ram should rotate the target");
    b.removeVehicle(p);
    b.modeCtl.resetTargets();
    assert.notEqual(slot.v, target);
    assert.equal(slot.v.x, x); assert.equal(slot.v.z, z);
    assert.equal(slot.v.v, 0); assert.equal(slot.v.w, 0);
});

test("On level ground the hull pitches up, dives under braking, rebounds and settles across frame rates", () => {
    const peaks = [];
    for (const hz of [30, 60, 120]) {
        const dt = 1 / hz, v = tank(), world = flat();
        settleOnGround(v, world);
        let up = 0, dive = 0, rebound = 0;
        const axle = v.suspension.travelY[0];
        for (let i = 0; i < 9 * hz; i++) {
            v.input.throttle = i < hz * 2 ? 1 : 0;
            driveVehicle(v, dt);
            settleOnGround(v, world, dt);
            if (v.input.throttle) up = Math.max(up, v.pitch);
            else if (v.v > 0) dive = Math.min(dive, v.pitch);
            else rebound = Math.max(rebound, v.pitch);
            if (i === hz) assert.ok(axle[0] > 0.02 && axle.at(-1) < -0.02, "load shifts to rear wheels");
        }
        assert.ok(up > 0.02 && dive < -0.035 && rebound > 0.004);
        assert.ok(Math.abs(v.pitch) < 0.001 && Math.abs(v.y) < 0.001);
        peaks.push(up);
    }
    assert.ok(Math.max(...peaks) - Math.min(...peaks) < 0.001);
});

test("A moving right turn loads the left track, driving backwards loads the front", () => {
    const v = tank(), world = flat();
    v.v = 6;
    settleOnGround(v, world);
    v.w = 0.5;
    let peak = 0;
    for (let i = 0; i < 60; i++) {
        settleOnGround(v, world, 1 / 60);
        peak = Math.max(peak, Math.abs(v.roll));
    }
    assert.ok(peak < 2.6 * Math.PI / 180, "excessive body roll at 21.6 km/h");
    assert.ok(v.roll < -0.02);
    assert.ok(v.suspension.travelY[0][2] > 0 && v.suspension.travelY[1][2] < 0);
    v.w = v.v = 0;
    settleOnGround(v, world);
    v.input.throttle = -1;
    for (let i = 0; i < 30; i++) { driveVehicle(v, 1 / 60); settleOnGround(v, world, 1 / 60); }
    assert.ok(v.pitch < -0.01);
});

test("Slopes support all vehicle types with no residual wheel travel on a plane", () => {
    const world = flat();
    world.terrain.height = (x, z) => 3 + x * 0.12 - z * 0.08;
    for (const def of [...ALL_VEHICLES, getVehicle("ratte")]) {
        const v = tank(def.id);
        settleOnGround(v, world);
        assert.ok(Math.abs(Math.tan(v.pitch) - 0.12) < 1e-6, def.id);
        assert.ok(Math.abs(Math.tan(v.roll) / Math.cos(v.pitch) - 0.08) < 1e-6, def.id);
        assert.ok(Math.abs(v.y - world.terrain.height(v.x, v.z)) < 1e-6);
        for (const lane of v.suspension.travelY) assert.ok(lane.every(h => Math.abs(h) < 0.001));
    }
});

test("A fallen trunk lifts its near wheel. A low rock is traversable, a tall rock stops the hull", () => {
    const v = tank("kv1");
    settleOnGround(v, flat());
    const { first, offsets } = v.suspension;
    const obstacle = { x: v.x + first, z: v.z + offsets[0] - 1, y: 0, h: 5, alive: true, fallen: true, fallA: Math.PI / 2 };
    settleOnGround(v, flat([{ type: "tree", o: obstacle }]), 1 / 30);
    assert.ok(v.suspension.travelY[0][0] > 0.1);
    assert.ok(v.suspension.travelY[1][0] < 0.01);
    const rock = { x: v.x + v.def.dims.L / 2 + 0.6, z: v.z, r: 1, sx: 1, sz: 1, rot: 0, y: 0, h: 0.45 };
    const world = flat([{ type: "rock", o: rock }]);
    v.v = 7; collide([v], world);
    assert.equal(v.v, 7);
    rock.h = 2; collide([v], world);
    assert.ok(v.v < 0.01);
});

test("Loaded wheels follow range crests; unloaded wheels reach droop and regain contact on exit", () => {
    const b = new Battle({ mode: "range", mapId: "prokhorovka", seed: 31, nation: "ussr", lineup: ["kv1"] });
    for (const ramp of b.world.course) for (const id of ["t34_41", "kv1", "panther_d"]) {
        const v = tank(id, ramp.x, ramp.z + ramp.run + 4, -Math.PI / 2);
        const hz = 60;
        v.v = 3;
        settleOnGround(v, b.world);
        let airborne = false;
        const ticks = Math.ceil((2 * ramp.run + 8) / v.v * hz);
        for (let t = 0; t < ticks + hz; t++) {
            if (t === ticks) v.v = 0;
            v.z -= v.v / hz;
            settleOnGround(v, b.world, 1 / hz);
            const st = v.suspension;
            for (let lane = 0; lane < st.offsets.length; lane++) {
                const gap = (x, y) => {
                    const p = hullToWorld(v, [x, y, st.offsets[lane]]);
                    return p[1] - b.world.h(p[0], p[2]);
                };
                for (let i = 0; i < st.count; i++) {
                    const lift = st.travelY[lane][i], x = st.first + i * st.spacing;
                    const clearance = gap(x, lift);
                    assert.ok(clearance > -0.005, id + " wheel penetrated ramp");
                    if (lift > -st.travel + 0.001 || t === ticks + hz - 1) assert.ok(clearance < 0.005, id + " wheel hung up");
                    if (clearance > 0.04) airborne = true;
                    if (i === st.count - 1) continue;
                    // Включая точки между вершинами полигонов визуальной ленты.
                    for (let j = 1; j < 8; j++) {
                        const bx = x + st.spacing * j / 8;
                        assert.ok(gap(bx, beltTravel(st, lane, bx)) > -0.035, id + " belt cut through crest");
                    }
                }
            }
        }
        if (ramp.rise > 1.5) assert.ok(airborne, id + " had no wheel unloading on the sharp crest");
    }
});
