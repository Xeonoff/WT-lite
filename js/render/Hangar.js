import * as THREE from "three";
import { buildVehicleMesh, disposeVehicleMesh } from "./VehicleMesh.js";
import { buildArmorModel } from "./ArmorView.js";
import { getVehicle } from "../data/VehicleBuild.js";
import { mkCanvas, clamp, DEG } from "../core/Utils.js";
import { raycastVehicle, plateInfo, tiltedNormal } from "../sim/Armor.js";

export class Hangar {
    constructor(scene3d) {
        this.s3 = scene3d;
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x14170f);
        this.scene.fog = new THREE.Fog(0x14170f, 18, 46);
        this.camera = new THREE.PerspectiveCamera(32, 1, 0.5, 200);
        const hemi = new THREE.HemisphereLight(0xe2ecf6, 0x4a4a38, 2.0);
        const key = new THREE.DirectionalLight(0xfff0d8, 3.4);
        key.position.set(-8, 12, 6);
        key.castShadow = true;
        key.shadow.mapSize.set(1024, 1024);
        key.shadow.camera.left = -8; key.shadow.camera.right = 8; key.shadow.camera.top = 8; key.shadow.camera.bottom = -8;
        key.shadow.bias = -0.0005;
        const rim = new THREE.DirectionalLight(0x9fc0ff, 1.6);
        rim.position.set(8, 6, -8);
        this.scene.add(hemi, key, rim);
        // подиум
        const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 64), new THREE.MeshStandardMaterial({ color: 0x2a2d22, roughness: 0.95 }));
        floor.rotation.x = -Math.PI / 2;
        floor.receiveShadow = true;
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.4, 0.18, 64), new THREE.MeshStandardMaterial({ color: 0x3a3e2f, roughness: 0.8, metalness: 0.2 }));
        disc.position.y = 0.09;
        disc.receiveShadow = true;
        const ring = new THREE.Mesh(new THREE.TorusGeometry(5.3, 0.05, 6, 96), new THREE.MeshBasicMaterial({ color: 0xe0b23e }));
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 0.19;
        this.scene.add(floor, disc, ring);
        this.env = [floor, disc, ring];
        this.stand = new THREE.Group();
        this.stand.position.y = 0.18;
        this.scene.add(this.stand);
        this.vm = null;
        this.defId = null;
        this.angle = -0.7;
        this.thumbs = new Map();
        this.offsetX = 0;
        // ручной осмотр: вращение мышью, наклон, масштаб; автоповорот после паузы
        this.pitch = 0.48;
        this.zoom = 0.85;
        this.idle = 99;
        this.drag = null;
        this.mode = "model";        // model | armor | modules
        this.armor = null;
        this.pointer = null;
        this.raycaster = new THREE.Raycaster();
    }

    /** Подключить элемент-«окно» осмотра: перетаскивание, колесо, наведение */
    attach(el, onHover) {
        this.view = el;
        this.onHover = onHover;
        el.addEventListener("pointerdown", (e) => {
            if (e.button !== 0 || e.target.closest("button")) return;
            this.drag = { x: e.clientX, y: e.clientY, a: this.angle, p: this.pitch, moved: false };
            el.setPointerCapture(e.pointerId);
            el.classList.add("grab");
        });
        el.addEventListener("pointermove", (e) => {
            this.pointer = { x: e.clientX, y: e.clientY };
            const d = this.drag;
            if (!d) return;
            const dx = e.clientX - d.x, dy = e.clientY - d.y;
            if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
            this.angle = d.a + dx * 0.009;
            this.pitch = clamp(d.p + dy * 0.005, 0.08, 1.35);
            this.idle = 0;
        });
        const end = (e) => {
            if (!this.drag) return;
            this.drag = null;
            el.classList.remove("grab");
            if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
        };
        el.addEventListener("pointerup", end);
        el.addEventListener("pointercancel", end);
        el.addEventListener("pointerleave", () => { this.pointer = null; });
        el.addEventListener("wheel", (e) => {
            e.preventDefault();
            this.zoom = clamp(this.zoom * Math.exp(e.deltaY * 0.0011), 0.5, 1.7);
            this.idle = 0;
        }, { passive: false });
        el.addEventListener("dblclick", () => this.resetView());
    }

    resetView() { this.pitch = 0.48; this.zoom = 0.85; this.idle = 99; }

    setMode(mode) {
        this.mode = mode;
        this.applyMode();
    }

    applyMode() {
        if (!this.vm) return;
        const M = this.vm.model;
        if (M) {
            // детальная модель сама показывает модули и экипаж (броня полупрозрачная)
            for (const m of this.vm.meshes) m.visible = true;
            M.setMode(this.mode === "modules" ? "modules" : "exterior");
            if (this.mode === "modules") {
                if (this.armor) this.armor.root.visible = false;
                return;
            }
        }
        const show = this.mode !== "model";
        if (show && !this.armor) {
            this.armor = buildArmorModel(this.def);
            this.vm.root.add(this.armor.root);
        }
        if (this.armor) {
            this.armor.root.visible = show;
            if (show) this.armor.setMode(this.mode);
        }
        for (const m of this.vm.meshes) m.visible = !show;
        if (!show && this.onHover) this.onHover(null);
    }

    show(defId, biome = "summer") {
        if (!defId || this.defId === defId + biome) return;
        this.defId = defId + biome;
        if (this.vm) { this.stand.remove(this.vm.root); disposeVehicleMesh(this.vm); }
        if (this.armor) { this.armor.dispose(); this.armor = null; }
        const def = getVehicle(defId);
        this.vm = buildVehicleMesh(def, biome, { full: true });
        this.vm.root.position.x = -(Math.max(def.dims.L / 2, def.turret.x + def.turret.hl + def.gun.len) - def.dims.L / 2) * 0.35;
        this.stand.add(this.vm.root);
        this.def = def;
        this.applyMode();
    }

    /** Лист брони под курсором: деталь попадания, толщина, угол к линии взгляда */
    pick() {
        if (!this.pointer || !this.vm || this.mode === "model" || this.drag) return null;
        const w = innerWidth, h = innerHeight;
        const nx = (this.pointer.x / w) * 2 - 1, ny = -(this.pointer.y / h) * 2 + 1;
        this.camera.setViewOffset(w, h, -this.lastOffset * w, 0, w, h);
        this.raycaster.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
        this.camera.clearViewOffset();
        const ro = this.raycaster.ray.origin, rd = this.raycaster.ray.direction;
        const root = this.vm.root;
        root.updateWorldMatrix(true, false);
        const p = new THREE.Vector3().setFromMatrixPosition(root.matrixWorld);
        const v = { def: this.def, x: p.x, z: p.z, a: -this.angle, turretRel: () => 0, gunRel: () => 0 };
        const hit = raycastVehicle(v, [ro.x, ro.y - p.y, ro.z], [rd.x, rd.y, rd.z], 400);
        if (!hit) return null;
        const info = plateInfo(v, hit);
        const n = tiltedNormal(hit.normal, info.vslope);
        const d = hit.dir;
        const cosT = clamp(-(d[0] * n[0] + d[1] * n[1] + d[2] * n[2]), 0, 1);
        const theta = Math.acos(cosT) / DEG;
        const eff = info.thick / Math.max(0.1, cosT);
        return { hit, info, theta, eff };
    }

    /** offset — сдвиг машины влево/вправо на экране, чтобы не мешали панели */
    render(dt, offset = 0) {
        const r = this.s3.renderer;
        this.idle += dt;
        // автоповорот только в обычном виде и после 5 с без касаний
        if (this.idle > 5 && this.mode === "model") this.angle += dt * 0.22 * clamp((this.idle - 5) / 2, 0, 1);
        this.stand.rotation.y = this.angle;
        const w = innerWidth, h = innerHeight;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        const size = this.def ? Math.max(this.def.dims.L + this.def.gun.len * 0.5, 6) : 7;
        const dist = (size * 2.3 + 5) * this.zoom;
        const az = 0.97;
        this.camera.position.set(Math.cos(this.pitch) * Math.cos(az) * dist, Math.sin(this.pitch) * dist + 1.1, Math.cos(this.pitch) * Math.sin(az) * dist);
        this.camera.lookAt(0, 1.1, 0);
        this.lastOffset = offset;
        if (this.onHover && this.mode !== "model") {
            const pk = this.pick();
            if (this.armor) this.armor.highlight(pk && pk.hit);
            this.onHover(pk, this.pointer);
        }
        this.camera.setViewOffset(w, h, -offset * w, 0, w, h);
        r.setRenderTarget(null);
        r.render(this.scene, this.camera);
        this.camera.clearViewOffset();
    }

    /** Миниатюра машины (dataURL), кешируется */
    thumbnail(defId, w = 300, h = 150) {
        const key = defId + ":" + w;
        if (this.thumbs.has(key)) return this.thumbs.get(key);
        const r = this.s3.renderer;
        const def = getVehicle(defId);
        const vm = buildVehicleMesh(def, "summer");
        vm.root.rotation.y = 0.55;
        vm.turret.rotation.y = -0.25;
        const prevStand = this.vm ? this.vm.root : null;
        if (prevStand) prevStand.visible = false;
        for (const e of this.env) e.visible = false;
        this.scene.add(vm.root);
        const rt = new THREE.WebGLRenderTarget(w * 2, h * 2, { samples: 4 });
        rt.texture.colorSpace = THREE.SRGBColorSpace;
        const cam = new THREE.PerspectiveCamera(26, w / h, 0.5, 100);
        const size = def.dims.L + def.gun.len * 0.6;
        const d = size * 2.0 + 3;
        cam.position.set(d * 0.15, d * 0.62, d * 0.78);
        cam.lookAt(def.gun.len * 0.15, 0.9, 0);
        const bg = this.scene.background;
        this.scene.background = null;
        const fog = this.scene.fog;
        this.scene.fog = null;
        r.setRenderTarget(rt);
        r.setClearColor(0x000000, 0);
        r.clear();
        r.render(this.scene, cam);
        const buf = new Uint8Array(w * 2 * h * 2 * 4);
        r.readRenderTargetPixels(rt, 0, 0, w * 2, h * 2, buf);
        r.setRenderTarget(null);
        this.scene.background = bg;
        this.scene.fog = fog;
        this.scene.remove(vm.root);
        disposeVehicleMesh(vm);
        if (prevStand) prevStand.visible = true;
        for (const e of this.env) e.visible = true;
        rt.dispose();
        const c = mkCanvas(w * 2, h * 2), g = c.getContext("2d");
        const img = g.createImageData(w * 2, h * 2);
        for (let y = 0; y < h * 2; y++) {
            const src = (h * 2 - 1 - y) * w * 2 * 4;
            img.data.set(buf.subarray(src, src + w * 2 * 4), y * w * 2 * 4);
        }
        g.putImageData(img, 0, 0);
        const url = c.toDataURL("image/png");
        this.thumbs.set(key, url);
        return url;
    }
}
