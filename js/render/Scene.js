import * as THREE from "three";
import { Config } from "../core/Config.js";
import { Events } from "../core/Events.js";
import { Settings } from "../core/Settings.js";
import { damp, rnd, clamp } from "../core/Utils.js";
import { buildVehicleMesh, burnMesh, disposeVehicleMesh } from "./VehicleMesh.js";
import { WorldMesh } from "./WorldMesh.js";
import { Particles } from "./Particles.js";
import { Effects } from "./Effects.js";
import { hullToWorld } from "../sim/Armor.js";
import { modState } from "../sim/Vehicle.js";

const ALLY = 0x4aa3ff, ENEMY = 0xff4a3d, PLAYER = 0xffd25a;

export class Scene3D {
    constructor(canvas) {
        this.canvas = canvas;
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.05;
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(Config.CAMERA.FOV, 1, 2, 2000);
        this.hemi = new THREE.HemisphereLight(0xddeeff, 0x4b5a2f, 1.1);
        this.sun = new THREE.DirectionalLight(0xfff0d2, 2.5);
        this.sun.castShadow = true;
        this.sun.shadow.bias = -0.0004;
        this.sun.shadow.normalBias = 0.05;
        this.scene.add(this.hemi, this.sun, this.sun.target);

        this.particles = new Particles(Settings.get("quality"));
        for (const m of this.particles.group) this.scene.add(m);
        this.effects = new Effects(this.scene);

        this.vmeshes = new Map();
        this.cam = { x: 0, z: 0, h: Config.CAMERA.HEIGHT, shake: 0, sx: 0, sz: 0 };
        this.raycaster = new THREE.Raycaster();
        this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        this.tmpV = new THREE.Vector3();
        this.ndc = new THREE.Vector2();
        this.battle = null;
        this.worldMesh = null;

        this.setQuality(Settings.get("quality"));
        this.resize();
        addEventListener("resize", () => this.resize());
        Events.on("settings", (e) => { if (e.key === "quality" || e.key === "*") this.setQuality(Settings.get("quality")); });
        this.bindEvents();
    }

    setQuality(q) {
        const dpr = devicePixelRatio || 1;
        this.pixelRatio = q === "high" ? Math.min(dpr, 2) : q === "medium" ? Math.min(dpr, 1.25) : 0.8;
        this.renderer.setPixelRatio(this.pixelRatio);
        this.renderer.shadowMap.enabled = q !== "low";
        const size = q === "high" ? 2048 : 1024;
        if (this.sun.shadow.mapSize.x !== size) {
            this.sun.shadow.mapSize.set(size, size);
            if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
        }
        this.particles.setQuality(q);
        this.quality = q;
        this.scene.traverse((o) => { if (o.material) for (const m of [].concat(o.material)) m.needsUpdate = true; });
        this.resize();
    }

    resize() {
        const w = innerWidth, h = innerHeight;
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.w = w; this.h = h;
    }

    /* ─────────── Бой ─────────── */
    loadBattle(battle) {
        this.unloadBattle();
        this.battle = battle;
        const B = battle.world.biome;
        this.biome = B;
        this.worldMesh = new WorldMesh(battle.world);
        this.scene.add(this.worldMesh.group);
        const Wt = battle.weather;
        this.weather = Wt;
        const fogCol = new THREE.Color(B.fog);
        if (Wt.tint) fogCol.lerp(new THREE.Color(Wt.tint), 0.6);
        this.scene.background = fogCol.clone();
        this.scene.fog = new THREE.Fog(fogCol, 400, 1100);
        this.hemi.color.setHex(B.hemiSky);
        this.hemi.groundColor.setHex(B.hemiGround);
        this.hemi.intensity = B.hemiI * Wt.hemiK;
        this.sun.color.setHex(B.sun);
        this.sun.intensity = B.sunI * Wt.sunK;
        this.sun.shadow.radius = Wt.sunK < 0.6 ? 6 : 1;
        this.effects.setMarkColor(B.name === "Зима" ? 0x8d949a : B.name === "Пустыня" ? 0x8a7350 : 0x2c2a1f);
        this.dust = B.dust;
        const sp = battle.world.spawns[battle.playerTeam];
        this.cam.x = sp.x; this.cam.z = sp.z;
    }

    unloadBattle() {
        for (const [, vm] of this.vmeshes) this.removeVM(vm);
        this.vmeshes.clear();
        if (this.worldMesh) {
            this.scene.remove(this.worldMesh.group);
            this.worldMesh.dispose();
            this.worldMesh = null;
        }
        this.particles.clear();
        this.effects.clear();
        this.battle = null;
    }

    removeVM(vm) {
        this.scene.remove(vm.root);
        if (vm.ring) { this.scene.remove(vm.ring); vm.ring.geometry.dispose(); vm.ring.material.dispose(); }
        if (vm.loose) this.scene.remove(vm.loose);
        disposeVehicleMesh(vm);
    }

    ensureVM(v) {
        let vm = this.vmeshes.get(v.id);
        if (vm) return vm;
        vm = buildVehicleMesh(v.def, this.battle.world.map.biome);
        vm.v = v;
        vm.markAcc = [0, 0];
        vm.lastPhase = [v.trackPhase[0], v.trackPhase[1]];
        vm.recoil = 0;
        vm.burnt = false;
        // кольцо принадлежности
        const col = v.isPlayer ? PLAYER : v.team === this.battle.playerTeam ? ALLY : ENEMY;
        const r = v.def.bodyRadius + 0.35;
        vm.ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.22, r, 48), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: v.isPlayer ? 0.35 : 0.55, depthWrite: false }));
        vm.ring.rotation.x = -Math.PI / 2;
        vm.ring.renderOrder = 3;
        this.scene.add(vm.root, vm.ring);
        this.vmeshes.set(v.id, vm);
        return vm;
    }

    /** Синхронизация моделей с симуляцией */
    sync(dt) {
        const b = this.battle;
        if (!b) return;
        const pt = b.playerTeam;
        for (const v of b.vehicles) {
            const vm = this.ensureVM(v);
            const seen = v.team === pt || v.visible[pt] || v.dead;
            vm.root.visible = seen;
            vm.root.position.set(v.x, 0, v.z);
            vm.root.rotation.y = -v.a;
            vm.ring.position.set(v.x, 0.05, v.z);
            vm.ring.visible = seen && !v.dead;
            if (vm.turret.parent === vm.root) vm.turret.rotation.y = -v.turretRel();
            vm.gun.rotation.y = -v.gunRel();
            // откат ствола
            if (v.recoil > 0) { vm.recoil = 1; v.recoil = 0; }
            vm.recoil = Math.max(0, vm.recoil - dt * 3.2);
            vm.barrel.position.x = -vm.recoil * vm.recoil * Math.min(0.7, v.def.gun.cal / 160);
            if (v.dead) {
                if (!vm.burnt) this.onDeathVisual(v, vm);
                this.wreckFx(v, vm, dt);
                continue;
            }
            // гусеницы
            for (let s = 0; s < 2; s++) {
                vm.tracks[s].tex.offset.x = -v.trackPhase[s] / 0.7;
                const dph = Math.abs(v.trackPhase[s] - vm.lastPhase[s]);
                vm.lastPhase[s] = v.trackPhase[s];
                vm.markAcc[s] = Math.min(vm.markAcc[s] + dph, 8);
                const side = s === 0 ? -1 : 1;
                const off = side * (v.def.dims.W / 2 - v.def.dims.tw / 2);
                const sg = v.v < 0 ? -1 : 1;
                while (vm.markAcc[s] >= 0.62) {
                    vm.markAcc[s] -= 0.62;
                    const back = vm.markAcc[s] * sg;
                    const x = v.x - Math.sin(v.a) * off - Math.cos(v.a) * back, z = v.z + Math.cos(v.a) * off - Math.sin(v.a) * back;
                    this.effects.trackMark(x, z, v.a, v.def.dims.tw);
                    if (vm.markAcc[s] >= 0.62) continue;
                    if (seen && Math.abs(v.v) > 3 && Math.random() < 0.55) {
                        const bx = x - Math.cos(v.a) * v.def.dims.L * 0.45, bz = z - Math.sin(v.a) * v.def.dims.L * 0.45;
                        this.particles.trackDust(bx, bz, this.dust, Math.min(1.4, Math.abs(v.v) / 8));
                    }
                }
            }
            // огонь и дым
            if (v.fire && seen) {
                const wp = hullToWorld(v, v.fire.pos);
                for (let k = 0; k < 2; k++) this.particles.fire([wp[0], v.def.dims.H, wp[2]], 1.1);
            } else if (seen && modState(v.mods.engine) >= 2 && Math.random() < dt * 6) {
                const ep = hullToWorld(v, v.mods.engine.def.c);
                this.particles.smoke([ep[0], v.def.dims.H, ep[2]], 0.3, 0.7);
            }
        }
        if (this.weather && this.weather.precip && dt > 0) this.precip(dt);
        for (const s of b.strikes) {
            if (s.n < s.total && Math.random() < dt * 9) this.particles.markerSmoke([s.x, 0, s.z], s.team === pt ? [0.35, 0.6, 0.95] : [0.95, 0.3, 0.2]);
        }
        this.effects.syncTracers(b.shots, this.particles);
        if (this.worldMesh) this.worldMesh.updatePoints(b.modeCtl.points || (b.modeCtl.point ? [{ ...b.modeCtl.point, owner: -1, cap: b.modeCtl.cap }] : null), pt, b.time);
        this.particles.update(dt);
        this.effects.update(dt);
    }

    /** Осадки и взвесь вокруг точки обзора */
    precip(dt) {
        const kind = this.weather.precip;
        const c = this.cam, hw = c.h * 0.95, hd = c.h * 0.6;
        const q = this.particles.scale;
        if (kind === "snow") {
            const n = Math.round(260 * q * dt + Math.random());
            for (let i = 0; i < n; i++) {
                this.particles.norm.emit({ x: c.x + rnd(-hw, hw), y: rnd(14, 34), z: c.z + rnd(-hd, hd), vx: rnd(1, 2.5), vy: rnd(-7, -5), vz: rnd(-0.5, 0.5), life: 4.5, s0: rnd(0.3, 0.55), c0: [1, 1, 1, 0.85], c1: [1, 1, 1, 0.7], drag: 0 });
            }
        } else if (kind === "dust") {
            const n = Math.round(48 * q * dt + Math.random());
            for (let i = 0; i < n; i++) {
                this.particles.norm.emit({ x: c.x + rnd(-hw * 1.4, hw * 0.6), y: rnd(2, 9), z: c.z + rnd(-hd, hd), vx: rnd(10, 16), vy: rnd(-0.3, 0.6), vz: rnd(-1.5, 1.5), life: rnd(3, 5), s0: rnd(6, 10), s1: rnd(14, 22), c0: [0.93, 0.84, 0.66, 0.36], c1: [0.95, 0.88, 0.72, 0], drag: 0, vr: rnd(-0.3, 0.3) });
            }
            // песчинки
            const m = Math.round(120 * q * dt + Math.random());
            for (let i = 0; i < m; i++) {
                this.particles.norm.emit({ x: c.x + rnd(-hw * 1.2, hw), y: rnd(0.5, 5), z: c.z + rnd(-hd, hd), vx: rnd(18, 26), vy: rnd(-0.5, 0.5), vz: rnd(-1, 1), life: rnd(1.5, 2.5), s0: rnd(0.2, 0.4), c0: [0.6, 0.5, 0.34, 0.8], c1: [0.6, 0.5, 0.34, 0], drag: 0 });
            }
        } else if (kind === "mist") {
            const n = Math.round(10 * q * dt + Math.random());
            for (let i = 0; i < n; i++) {
                this.particles.norm.emit({ x: c.x + rnd(-hw * 1.2, hw), y: rnd(2, 8), z: c.z + rnd(-hd, hd), vx: rnd(1.5, 3), vy: 0, vz: rnd(-0.5, 0.5), life: rnd(7, 10), s0: rnd(16, 22), s1: rnd(26, 34), c0: [0.9, 0.92, 0.93, 0.13], c1: [0.9, 0.92, 0.93, 0], drag: 0, vr: rnd(-0.1, 0.1) });
            }
        }
    }

    onDeathVisual(v, vm) {
        vm.burnt = true;
        burnMesh(vm);
        vm.deathT = this.battle.time;
        if (v.deathCause === "ammo") {
            const vel = [rnd(-3, 3) + v.v * 0.3 * Math.cos(v.a), rnd(10, 15), rnd(-3, 3) + v.v * 0.3 * Math.sin(v.a)];
            this.effects.throwTurret(vm.turret, vel, [rnd(-4, 4), 0, rnd(-4, 4)]);
            vm.loose = vm.turret;
        }
    }

    wreckFx(v, vm, dt) {
        const age = this.battle.time - vm.deathT;
        if (age < 70 && Math.random() < dt * (age < 12 ? 9 : 3)) {
            const p = [v.x + rnd(-0.6, 0.6), v.def.dims.H, v.z + rnd(-0.6, 0.6)];
            this.particles.smoke(p, 0.12, 1.2);
        }
        if (age < (v.deathCause === "crew" ? 4 : 16) && Math.random() < dt * 18) this.particles.fire([v.x + rnd(-1, 1), v.def.dims.H * 0.8, v.z + rnd(-1, 1)], 1.3);
    }

    /* ─────────── События боя → эффекты ─────────── */
    bindEvents() {
        const near = (x, z) => {
            const p = this.battle && this.battle.player;
            const fx = p && !p.dead ? p.x : this.cam.x, fz = p && !p.dead ? p.z : this.cam.z;
            return Math.hypot(x - fx, z - fz);
        };
        const visibleAt = (x, z) => Math.abs(x - this.cam.x) < this.cam.h * 1.3 && Math.abs(z - this.cam.z) < this.cam.h * 1.1;
        Events.on("shot", (e) => {
            if (!this.battle) return;
            const v = e.v;
            this.particles.muzzle(e.pos, e.dir, e.def.cal);
            this.particles.groundBlast(e.pos, e.def.cal, this.dust);
            if (e.def.cal >= 40) this.effects.flash(e.pos, 0xffb060, 6 + e.def.cal / 10, 0.12);
            if (v.isPlayer) this.cam.shake = Math.max(this.cam.shake, 0.15 + e.def.cal / 300);
        });
        Events.on("hit", (e) => {
            if (!this.battle) return;
            const w = e.world || [e.target.x, 1.5, e.target.z];
            const k = e.res.kind;
            if (k === "rico" || k === "nopen" || k === "barrel" || k === "stopped") this.particles.sparks(w, k === "nopen" ? 14 : 9);
            if (k === "pen") { this.particles.sparks(w, 18, [1, 0.6, 0.3]); this.effects.flash(w, 0xffa050, 5, 0.12, 14); }
            if (e.target.isPlayer && k !== "rico") this.cam.shake = Math.max(this.cam.shake, k === "pen" || k === "he-pen" ? 0.9 : 0.45);
        });
        Events.on("explosion", (e) => {
            if (!this.battle) return;
            const p = [e.x, e.y, e.z];
            if (e.inside) { this.particles.sparks(p, 10, [1, 0.5, 0.2]); return; }
            const w = this.battle.world;
            if (e.y < 1 && w.river && !w.river.frozen && w.inWater(e.x, e.z)) {
                this.particles.splash(p, 0.8 + e.size * 0.6);
                this.effects.flash(p, 0xff9a40, 6 * e.size, 0.15, 18);
                return;
            }
            this.particles.explosion(p, e.size, e.ground !== false && e.y < 1, this.dust);
            this.effects.flash(p, 0xff9a40, 10 * e.size, 0.25, 22 + e.size * 10);
            if (e.y < 1.2) this.effects.crater(e.x, e.z, 0.8 + e.size * 1.1);
            const d = near(e.x, e.z);
            if (d < 60) this.cam.shake = Math.max(this.cam.shake, (1 - d / 60) * e.size * 0.8);
        });
        Events.on("impact", (e) => {
            if (!this.battle || e.shell.type === "HE") return;
            const p = [e.x, Math.max(0.2, e.y), e.z];
            const w = this.battle.world;
            if (e.kind === "ground" && w.river && !w.river.frozen && w.inWater(e.x, e.z)) this.particles.splash(p, 0.5);
            else if (e.kind === "ground") this.particles.dust(p, this.dust, 5, 3);
            else if (e.kind === "building") { this.particles.dust(p, [0.7, 0.66, 0.6], 6, 3); this.particles.debris(p, [0.5, 0.45, 0.4], 5); }
            else if (e.kind === "rock") { this.particles.dust(p, [0.6, 0.58, 0.54], 4, 3); this.particles.sparks(p, 5); }
            else this.particles.sparks(p, 8);
        });
        Events.on("destroyed", (e) => {
            if (!this.battle) return;
            const v = e.v;
            const p = [v.x, 1.4, v.z];
            if (e.cause === "ammo") {
                this.particles.detonation(p);
                this.effects.flash(p, 0xff8030, 40, 0.6, 50);
                this.effects.crater(v.x, v.z, 3.5);
            } else {
                this.particles.explosion(p, 1.1, false, this.dust);
                this.effects.flash(p, 0xff8030, 14, 0.35, 30);
            }
            const d = near(v.x, v.z);
            if (d < 80) this.cam.shake = Math.max(this.cam.shake, (1 - d / 80) * (e.cause === "ammo" ? 2 : 1));
            if (!visibleAt(v.x, v.z)) return;
        });
        Events.on("worldChange", (e) => {
            if (!this.worldMesh) return;
            this.worldMesh.onChange(e);
            const o = e.o;
            if (e.type === "fence") this.particles.debris([o.x, 0.8, o.z], [0.42, 0.32, 0.2], 7);
            else if (e.type === "hay") { this.particles.debris([o.x, 1, o.z], [0.8, 0.68, 0.36], 14); this.particles.dust([o.x, 0.8, o.z], [0.8, 0.7, 0.45], 6, 3); }
            else if (e.type === "tree") this.particles.dust([o.x, 1.5, o.z], this.dust, 5, 2);
            else if (e.type === "hedge") { this.particles.debris([o.x, 1.2, o.z], [0.25, 0.38, 0.16], 14); this.particles.dust([o.x, 1, o.z], [0.45, 0.42, 0.3], 6, 3); }
        });
        Events.on("vehicleRemoved", (e) => {
            const vm = this.vmeshes.get(e.v.id);
            if (vm) { this.removeVM(vm); this.vmeshes.delete(e.v.id); }
        });
        Events.on("fireOut", (e) => {
            if (!this.battle || !e.ext || e.v.dead) return;
            const p = [e.v.x, e.v.def.dims.H, e.v.z];
            this.particles.dust(p, [0.9, 0.9, 0.92], 10, 4);
        });
    }

    /* ─────────── Камера ─────────── */
    updateCamera(dt, focus, aim, binoc, zoomH) {
        const C = Config.CAMERA;
        let tx = focus.x, tz = focus.z;
        if (aim) {
            const lead = binoc ? C.BINOC_LEAD : C.LEAD;
            let dx = (aim[0] - focus.x) * lead, dz = (aim[2] - focus.z) * lead;
            const maxL = (binoc ? 1.1 : 0.55) * zoomH;
            const L = Math.hypot(dx, dz);
            if (L > maxL) { dx *= maxL / L; dz *= maxL / L; }
            tx += dx; tz += dz;
        }
        // камера не уходит далеко за границу карты
        if (this.battle) {
            const S = this.battle.world.S, m = 18;
            const hh = zoomH * Math.tan(C.FOV * Math.PI / 360), hw = hh * this.camera.aspect;
            tx = hw * 2 > S + m * 2 ? S / 2 : clamp(tx, hw - m, S - hw + m);
            tz = hh * 2 > S + m * 2 ? S / 2 : clamp(tz, hh - m, S - hh + m);
        }
        this.cam.x = damp(this.cam.x, tx, 5, dt);
        this.cam.z = damp(this.cam.z, tz, 5, dt);
        this.cam.h = damp(this.cam.h, zoomH * (binoc ? C.BINOC_ZOOM : 1), 5, dt);
        this.cam.shake = Math.max(0, this.cam.shake - dt * 2.2);
        const sh = this.cam.shake * this.cam.shake * 1.4;
        this.cam.sx = rnd(-sh, sh);
        this.cam.sz = rnd(-sh, sh);
        this.placeCamera();
    }

    placeCamera() {
        const tilt = clamp(Settings.get("tilt"), 0, 40) * Math.PI / 180;
        const x = this.cam.x + this.cam.sx, z = this.cam.z + this.cam.sz, h = this.cam.h;
        this.camera.position.set(x, h, z + h * Math.tan(tilt));
        this.camera.lookAt(x, 0, z);
        this.camera.updateMatrixWorld();
        // дымка зависит от расстояния до точки обзора, иначе в виде сверху туман однороден
        if (this.scene.fog && this.weather) {
            const d = h / Math.cos(tilt);
            this.scene.fog.near = Math.max(1, d + this.weather.fog[0]);
            this.scene.fog.far = d + this.weather.fog[1];
        }
        // солнце и тени следуют за камерой
        const ext = h * 0.85 + 20;
        const sc = this.sun.shadow.camera;
        if (sc.right !== ext) {
            sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext;
            sc.near = 1; sc.far = 500;
            sc.updateProjectionMatrix();
        }
        this.sun.position.set(x - 90, 170, z + 60);
        this.sun.target.position.set(x, 0, z);
        this.sun.target.updateMatrixWorld();
    }

    /* ─────────── Экран ↔ мир ─────────── */
    screenRay(mx, my) {
        this.ndc.set((mx / this.w) * 2 - 1, -(my / this.h) * 2 + 1);
        this.raycaster.setFromCamera(this.ndc, this.camera);
        const r = this.raycaster.ray;
        return { o: [r.origin.x, r.origin.y, r.origin.z], d: [r.direction.x, r.direction.y, r.direction.z] };
    }

    groundAt(mx, my, y = 0) {
        this.ndc.set((mx / this.w) * 2 - 1, -(my / this.h) * 2 + 1);
        this.raycaster.setFromCamera(this.ndc, this.camera);
        this.plane.constant = -y;
        const hit = this.raycaster.ray.intersectPlane(this.plane, this.tmpV);
        return hit ? [hit.x, hit.y, hit.z] : null;
    }

    project(x, y, z) {
        this.tmpV.set(x, y, z).project(this.camera);
        return [(this.tmpV.x + 1) / 2 * this.w, (1 - this.tmpV.y) / 2 * this.h, this.tmpV.z < 1];
    }

    /** Пикселей на метр на глубине точки */
    pxPerMeter(x, y, z) {
        const a = this.project(x, y, z), b = this.project(x + 1, y, z);
        return Math.hypot(b[0] - a[0], b[1] - a[1]);
    }

    render() {
        this.renderer.render(this.scene, this.camera);
    }
}

