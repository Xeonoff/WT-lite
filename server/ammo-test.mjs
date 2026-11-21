import assert from "node:assert/strict";
import { test } from "node:test";
import { getVehicle } from "../js/data/VehicleBuild.js";
import { applyOwn, packOwn } from "../js/net/Protocol.js";
import { Battle } from "../js/sim/Battle.js";
import { Vehicle } from "../js/sim/Vehicle.js";

for (const id of ["kv1","pz2f"]) {
    test(id + ": switching during a reload starts a full cycle, including between magazine shots", () => {
        const v = new Vehicle(getVehicle(id),0,0,0,0);
        const [first,second] = v.shellIds();
        assert.equal(v.consumeShot(),first);
        v.updateReload(v.reload * .8);
        assert.ok(v.selectShell(second));
        assert.equal(v.loaded,null);
        assert.equal(v.reload,v.reloadTime(second));
        v.updateReload(v.reload - .05);
        assert.equal(v.canFire(),false);
        assert.equal(v.selectShell(second),false);
        assert.ok(v.selectShell(first));
        assert.equal(v.reload,v.reloadTime(first));
        v.updateReload(v.reload);
        assert.ok(v.canFire());
        assert.equal(v.consumeShot(),first);
    });
}

test("Range fires only stocked rounds, syncs the fallback type and refills on explicit reset", () => {
    const b = new Battle({mode:"range",mapId:"prokhorovka",nation:"ussr",seed:1,lineup:["kv1"]});
    const v = b.spawnPlayer("kv1"), replica = new Vehicle(v.def,0,0,0,0);
    for (const sid of v.shellIds()) v.ammo[sid] = 1;
    for (const [i,sid] of v.shellIds().entries()) {
        assert.equal(v.loaded,sid);
        assert.ok(b.fire(v));
        assert.equal(b.shots.at(-1).def.id,sid);
        assert.equal(v.ammo[sid],0);
        b.modeCtl.update(.1);
        assert.equal(v.selectShell(sid),false);
        applyOwn(replica,packOwn(v));
        assert.equal(replica.ammo[sid],0);
        assert.equal(replica.shell,v.shellIds()[i+1] || sid);
        v.updateReload(100);
    }
    assert.equal(b.fire(v),false);
    assert.equal(v.totalAmmo(),0);
    assert.equal(b.shots.length,v.shellIds().length);
    b.modeCtl.resetTargets();
    assert.equal(v.totalAmmo(),v.def.ammoTotal);
    v.updateReload(.1);
    assert.equal(b.fire(v),false);
    v.updateReload(v.reload);
    assert.ok(b.fire(v));
});

test("A two-barrel salvo with a single remaining round launches a single projectile", () => {
    const b = new Battle({mode:"range",mapId:"prokhorovka",nation:"ussr",seed:2,lineup:["kv1"]});
    const v = b.spawnVehicle("ratte",1,80,80,0,{rangeTarget:true});
    const sid = v.loaded;
    v.ammo[sid] = 1;
    assert.equal(v.boss.salvo().length,2);
    assert.ok(b.fire(v));
    assert.equal(v.ammo[sid],0);
    assert.equal(b.shots.length,1);
    assert.equal(b.shots[0].def.id,sid);
    assert.notEqual(v.shell,sid);
});
