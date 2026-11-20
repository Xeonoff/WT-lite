import { test } from "node:test";
import assert from "node:assert/strict";
import { getVehicle } from "../js/data/VehicleBuild.js";
import { readLoadout, rollDrop, rollItem, TARGETS } from "../js/data/Archive.js";
import { CARD_POOLS, cardFor } from "../js/data/ArchiveCards.js";
import { archiveShell, cardEvent } from "../js/sim/ArchiveEffects.js";
import { SHELLS } from "../js/data/Shells.js";
import { applyShellHit } from "../js/sim/Damage.js";
import { Battle } from "../js/sim/Battle.js";
import { Vehicle } from "../js/sim/Vehicle.js";
import { NetBattle } from "../js/net/NetBattle.js";
import { Room } from "./Room.js";
import { applyOwn, packOwn } from "../js/net/Protocol.js";

test("Loot eligibility, rarity intervals and all documented specializations", () => {
    const zero = () => 0;
    assert.equal(rollDrop(false,false,1,zero), null);
    assert.equal(rollDrop(true,true,0,zero), null);
    assert.equal(rollDrop(false,true,1,()=>.74), "plan");
    assert.equal(rollDrop(true,true,1,()=>.75), null);
    assert.equal(rollDrop(true,false,1,()=>.30), null);
    assert.equal(rollDrop(true,false,1,zero), "dossier");
    for (const kind of Object.keys(TARGETS)) {
        for (const [tier,roll] of [.01,.49,.78,.93,.99].entries()) {
            const types = Object.keys(TARGETS[kind]);
            for (const [index,target] of types.entries()) {
                const row = CARD_POOLS[target][tier];
                assert.equal(row.length,[10,8,7,4,3][tier]);
                assert.equal(new Set(row.map(c=>c.id)).size,row.length);
                for (const [j,card] of row.entries()) {
                    const draws = [roll,(index+.5)/types.length,(j+.5)/row.length];
                    assert.equal(cardFor(rollItem(kind,()=>draws.shift())),card);
                    assert.ok(card.name && card.text && !card.text.includes("undefined"));
                    assert.equal([card.hp,card.mods,card.event,card.salvage].filter(Boolean).length,1);
                }
            }
        }
    }
});

test("Old profile, idempotent receipt and opening, exclusive assignments and persistence", async () => {
    const db = new Map([["wtl_profile_v2",JSON.stringify({bestWave:8})]]);
    globalThis.localStorage = { getItem:k=>db.get(k), setItem:(k,v)=>db.set(k,v) };
    const {Profile:p} = await import("../js/core/Profile.js?archive-migration");
    assert.equal(p.data.bestWave,8);
    assert.deepEqual(p.data.archive,[]);
    for (const source of ["one","two"]) {
        assert.ok(p.receiveCase("plan",source));
        assert.equal(p.receiveCase("plan",source),false);
        const item = p.data.archive.at(-1);
        assert.equal(p.openCase(item.id),item);
        assert.equal(p.openCase(item.id),null);
        Object.assign(item,{target:"track",tier:4,card:"back-workshop"});
    }
    assert.ok(p.assignItem(1,"t34_41","trackL"));
    assert.equal(p.assignItem(2,"t34_41","trackL"),false);
    assert.equal(p.assignItem(1,"t34_41","engine"),false);
    assert.ok(p.assignItem(1,"kv1","trackR"));
    assert.deepEqual(Object.keys(p.equipment()),["kv1"]);
    const {Profile:reloaded} = await import("../js/core/Profile.js?archive-reload");
    assert.deepEqual(reloaded.equipment(),p.equipment());
    assert.ok(reloaded.unassignItem(1));
    assert.deepEqual(reloaded.equipment(),{});
});

test("Online match results award participants individually, including on a defeat", t => {
    t.mock.method(Math, "random", () => 0);
    const sent = [];
    const members = [0,1,1].map((team,index) => ({ pilot: {team, spawns:index===2 ? 0 : 1, stats:{}, vstats:{}},
        client:{send:m=>sent.push(m.r)} }));
    Room.prototype.onBattleEnd.call({members,flushEvents(){}},
        {winner:0,mode:"duel",reason:"",rewardId:"battle-1",pilots:[]});
    assert.deepEqual(sent.map(r=>[r.win,r.drop,r.rewardId]),[
        [true,"dossier","battle-1"],[false,"dossier","battle-1"],[false,null,"battle-1"],
    ]);
});

test("Existing documents keep their identity, rarity and assignment across migration", async () => {
    const old = {id:7,kind:"dossier",tier:3,target:"driver",vehicle:"kv1",slot:"driver",source:"previous"};
    const sealed = {id:8,kind:"plan",tier:null,source:"sealed",vehicle:null,slot:null};
    const db=new Map([["wtl_profile_v2",JSON.stringify({archive:[old,sealed]})]]);
    globalThis.localStorage={getItem:k=>db.get(k),setItem:(k,v)=>db.set(k,v)};
    const {Profile:p}=await import("../js/core/Profile.js?old-card");
    assert.deepEqual(p.data.archive[0],{...old,card:CARD_POOLS.driver[3][2].id});
    assert.deepEqual(p.data.archive[1],sealed);
    p.save();
    const {Profile:q}=await import("../js/core/Profile.js?old-card-again");
    assert.deepEqual(q.equipment(),p.equipment());
});

test("Specific rack pays for nested ammunition, preserves the last rounds and cannot spend other racks' HP", () => {
    const def=getVehicle("kv1"), [slot,other]=def.rackOrder;
    const gear = (card,tier) => [{id:1,kind:"plan",target:"ammo",slot,tier,card}];
    const tank = equipment=>new Vehicle(def,0,0,0,0,{equipment});
    const v=tank(gear("lastRound-nest",4)), sid=v.shell, rack=v.mods[slot], spare=v.mods[other];
    v.ammo[sid]=1;
    v.consumeShot();
    assert.equal(v.ammo[sid],4);
    assert.equal(rack.hp,rack.maxHp*.8);
    assert.equal(spare.hp,spare.maxHp);
    rack.hp=rack.maxHp*.1;
    v.loaded=sid; v.ammo[sid]=1; v.consumeShot();
    assert.equal(v.ammo[sid],0);
    const insured=tank(gear("escrow",2));
    assert.ok(insured.rackFills()[slot]>0);
    assert.equal(insured.loseRack(slot),0);
    assert.equal(insured.medkits,0);
    assert.ok(insured.loseRack(other)>0);
});

test("Pendulum alternates, paid cards consume resources only on success and costs stay on their carrier", () => {
    const def=getVehicle("kv1");
    const v=new Vehicle(def,0,0,0,0,{equipment:[
        {id:1,kind:"plan",slot:"breech",target:"breech",tier:4,card:"shot-pendulum"},
        {id:2,kind:"dossier",slot:"radio",target:"radio",tier:4,card:"arty-signal"},
    ]});
    const base=v.reloadTime();
    v.consumeShot(); assert.equal(v.reload,base*3);
    v.loaded=v.shell; v.consumeShot(); assert.equal(v.reload,base*.1);
    v.artyT=70; cardEvent(v,"arty",1,10); assert.equal(v.artyT,25); assert.equal(v.ext,1);
    cardEvent(v,"arty",1,30); assert.equal(v.ext,1);
    v.seats.radio.occupant.transit=true;
    v.artyT=100; cardEvent(v,"arty",1,10); assert.equal(v.artyT,100);
});

test("Rack streaks are capped, scoped to the feeding rack and fixed at launch", () => {
    const def = getVehicle("kv1");
    const [first,second] = def.rackOrder;
    const gear = [
        {id:1, kind:"plan", target:"ammo", slot:first, tier:4, card:"shot-signal"},
        {id:2, kind:"plan", target:"ammo", slot:second, tier:4, card:"critical-rally"},
    ];
    const vehicle = () => new Vehicle(def,0,0,0,0,{equipment:gear});
    const v = vehicle(), shell = SHELLS[v.shell];
    cardEvent(v,"blocked",8);
    assert.equal(v.cards.entries.get(1).level,5);
    const replica = vehicle();
    applyOwn(replica,packOwn(v));
    assert.deepEqual(archiveShell(replica,shell),archiveShell(v,shell));
    const battle = {time:5,shots:[],fireLine:Battle.prototype.fireLine};
    assert.ok(Battle.prototype.fire.call(battle,v));
    const shot = battle.shots[0];
    assert.ok(Math.abs(shot.def.pen[0]/shell.pen[0] - 1.6) < 1e-8);
    cardEvent(v,"pen",2);
    assert.equal(v.cards.entries.get(1).level,0);
    assert.equal(v.cards.entries.get(2).level,2);
    assert.equal(archiveShell(v,shell),shell);
    v.loseRack(first);
    assert.ok(Math.abs(archiveShell(v,shell).insideScale - 1.24) < 1e-8);
    assert.equal(shot.def.insideScale,1);
    cardEvent(v,"blocked");
    assert.equal(archiveShell(v,shell),shell);
    assert.equal(vehicle().cards.entries.get(2).level,0);
});

test("Post-penetration bonus changes internal damage only after the simulated plate is passed", t => {
    t.mock.method(Math,"random",()=>.7);
    function impact(insideScale,canPen) {
        const v = new Vehicle(getVehicle("bt7"),0,0,0,0);
        const point = v.mods.engine.def.c;
        const trace = {layers:[],pen:40,main:{
            hit:{frame:"hull",part:{},point,world:point,dir:[1,0,0]},
            ev:{info:{name:"test",thick:8},eff:8,ricoP:0,canPen},
        }};
        const shot = {def:{...SHELLS.pzgr20,insideScale},traveled:0};
        return applyShellHit({time:1,destroyVehicle(){}},shot,v,trace);
    }
    const base = impact(1,true).dmg[0], bonus = impact(1.5,true).dmg[0];
    assert.equal(base.id,bonus.id);
    assert.ok(Math.abs((bonus.before-bonus.after)/(base.before-base.after)-1.5) < 1e-8);
    assert.equal(impact(1.5,false).dmg.length,0);
});

test("Track reserves store partial distance and spend charges on their own repair", () => {
    const v = new Vehicle(getVehicle("kv1"),0,0,0,0,{equipment:[
        {id:3,kind:"plan",target:"track",slot:"trackL",tier:3,card:"shot-signal"},
    ]});
    const e = v.cards.entries.get(3);
    cardEvent(v,"travel",35);
    cardEvent(v,"travel",70);
    assert.equal(e.level,2);
    const replica = new Vehicle(v.def,0,0,0,0,{equipment:v.equipment});
    applyOwn(replica,packOwn(v));
    assert.equal(replica.cards.entries.get(3).progress,5);
    cardEvent(v,"repair");
    assert.equal(e.level,2);
    v.mods.trackL.hp = v.mods.trackR.hp = 0;
    cardEvent(v,"travel",50);
    assert.equal(e.level,2);
    assert.ok(v.startRepair());
    v.updateRepair(v.repair.dur);
    assert.equal(e.level,0);
    assert.ok(Math.abs(v.mods.trackL.hp/v.mods.trackL.maxHp - .76) < 1e-8);
    assert.equal(v.mods.trackR.hp/v.mods.trackR.maxHp,.6);
});

test("Only the radio operator specializes in artillery support", () => {
    for (const [family,tiers] of Object.entries(CARD_POOLS)) {
        if (family === "radio") continue;
        for (const c of tiers.flat()) {
            assert.ok(c.event !== "arty" && c.action !== "signal");
            assert.ok(!c.mods?.some(m=>m.stat === "arty" || m.stat === "radioRange"));
        }
    }
});

test("Server validates individual slots and applies the same gear on spawn and client rejoin", () => {
    const def = getVehicle("kv1");
    const entries = [
        { id:1,kind:"dossier",target:"driver",slot:"driver",tier:4,card:"critical-rewind" },
        { id:2,kind:"plan",target:"track",slot:"trackL",tier:0,card:"reserve" },
        { id:3,kind:"plan",target:"breech",slot:"breech",tier:0,card:"standard" },
    ];
    const used = new Set();
    assert.deepEqual(readLoadout(def,[...entries,{...entries[0],id:4},{...entries[1],slot:"trackR"},
        {...entries[1],id:5,tier:9,slot:"trackR"},{...entries[1],id:6,slot:"engine"}],used), entries);
    assert.deepEqual(readLoadout(getVehicle("bt7"),entries,used),[]);
    const b = new Battle({mode:"duel",mapId:"prokhorovka",nations:["ussr","germany"],pilots:[
        {id:"p",name:"Pilot",team:0,lineup:["kv1"],equipment:{kv1:entries}}
    ]});
    const P=b.pilots[0], v=b.spawnPlayer("kv1",P);
    const base = new Vehicle(def,0,0,0,0);
    assert.equal(v.turnRate(),base.turnRate());
    assert.ok(v.reloadTime()<base.reloadTime());
    assert.ok(v.mods.trackL.maxHp>v.mods.trackR.maxHp);
    const crew=v.seats.driver.occupant;
    const radio=v.seats.radio.occupant;
    radio.hp=35; v.update(.01,6);
    radio.hp=80; crew.hp=12; v.update(.01,7);
    assert.equal(crew.hp,crew.maxHp); assert.equal(radio.hp,80);
    crew.hp=12; v.update(.01,8); assert.equal(crew.hp,12);
    assert.ok(v.useMedkit()); assert.equal(crew.hp,67);
    v.mods.trackL.hp=1; assert.ok(v.startRepair());
    v.updateRepair(v.repair.dur); assert.equal(v.mods.trackL.hp,v.mods.trackL.maxHp*.6);
    const info=Room.prototype.spawnInfo(v);
    const replica = new NetBattle({b:{mode:"duel",mapId:"prokhorovka",nations:["ussr","germany"],seed:b.seed},
        me:{pid:"p",name:"Pilot",team:0,nation:"ussr",lineup:["kv1"]},full:{tm:1,veh:[info],wc:[],pts:[]}}, {});
    applyOwn(replica.player,packOwn(v));
    assert.equal(replica.player.mods.trackL.maxHp,v.mods.trackL.maxHp);
    assert.equal(replica.player.turnRate(),v.turnRate());
    assert.equal(replica.player.reloadTime(),v.reloadTime());
});
