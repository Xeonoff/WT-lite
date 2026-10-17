import { Events } from "../../core/Events.js";
import { vehiclesOf } from "../../data/VehicleBuild.js";

/** Полигон: неподвижные мишени под разными углами, автоматически восстанавливаются */
export class RangeMode {
    constructor(b) {
        this.b = b;
        this.slots = [];
        this.respawnQ = [];
    }

    start() {
        const b = this.b;
        const S = b.world.S;
        let ids = b.opts.rangeTargets && b.opts.rangeTargets.length ? b.opts.rangeTargets.slice() : null;
        if (!ids) {
            const enemy = vehiclesOf(b.enemyNation).sort((x, y) => x.br - y.br);
            ids = enemy.map((v) => v.id);
        }
        const layout = [
            { dx: -60, dz: -70, a: Math.PI / 2 },             // лоб
            { dx: -20, dz: -95, a: Math.PI / 2 + 0.55 },      // ромб
            { dx: 25, dz: -80, a: 0 },                        // борт
            { dx: 65, dz: -110, a: -Math.PI / 2 },            // корма
            { dx: -45, dz: -150, a: Math.PI / 2 - 0.3 },
            { dx: 10, dz: -175, a: Math.PI },
            { dx: 60, dz: -190, a: Math.PI / 2 + 0.25 },
            { dx: -80, dz: -200, a: 0.6 },
        ];
        const base = { x: S / 2, z: S - 40 };
        layout.forEach((L, i) => {
            const slot = { id: ids[i % ids.length], x: base.x + L.dx, z: base.z + L.dz, a: L.a, v: null };
            this.slots.push(slot);
            this.spawnSlot(slot);
        });
    }

    spawnSlot(slot) {
        slot.v = this.b.spawnVehicle(slot.id, 1, slot.x, slot.z, slot.a, { static: true, callsign: "Мишень" });
    }

    playerSpawnPoint() {
        const S = this.b.world.S;
        return { x: S / 2, z: S - 40, a: -Math.PI / 2 };
    }

    update(dt) {
        for (const slot of this.slots) {
            if (slot.v && slot.v.dead) {
                slot.t = (slot.t || 0) + dt;
                if (slot.t > 4) {
                    slot.t = 0;
                    this.b.removeVehicle(slot.v);
                    this.spawnSlot(slot);
                }
            }
        }
        const p = this.b.player;
        if (p && !p.dead && p.totalAmmo() < p.def.ammoTotal * 0.5) p.resupply(1);
    }

    resetTargets() {
        for (const slot of this.slots) {
            if (slot.v) this.b.removeVehicle(slot.v);
            this.spawnSlot(slot);
        }
        Events.emit("rangeReset");
    }

    onDestroyed() { }
    goalFor() { return null; }
    hud() { return { kind: "range", targets: this.slots.filter((s) => s.v && !s.v.dead).length }; }
}
