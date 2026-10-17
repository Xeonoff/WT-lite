import * as THREE from "three";
import { softTexture, smokeTexture } from "./Textures.js";
import { rnd, TAU } from "../core/Utils.js";

const VERT = /* glsl */`
attribute vec3 aPos;
attribute vec4 aCol;
attribute float aSize;
attribute float aRot;
varying vec2 vUv;
varying vec4 vCol;
void main() {
    vUv = uv;
    vCol = aCol;
    vec4 mv = modelViewMatrix * vec4(aPos, 1.0);
    float c = cos(aRot), s = sin(aRot);
    vec2 p = position.xy;
    p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
    mv.xy += p * aSize;
    gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */`
uniform sampler2D map;
varying vec2 vUv;
varying vec4 vCol;
void main() {
    vec4 t = texture2D(map, vUv);
    float a = t.a * vCol.a;
    if (a < 0.004) discard;
    gl_FragColor = vec4(vCol.rgb * mix(1.0, t.r, 0.25), a);
}`;

class System {
    constructor(max, additive, texture) {
        this.max = max;
        this.n = 0;
        // состояние на CPU
        this.p = new Float32Array(max * 3);
        this.v = new Float32Array(max * 3);
        this.age = new Float32Array(max);
        this.life = new Float32Array(max);
        this.s0 = new Float32Array(max);
        this.s1 = new Float32Array(max);
        this.c0 = new Float32Array(max * 4);
        this.c1 = new Float32Array(max * 4);
        this.rot = new Float32Array(max);
        this.vr = new Float32Array(max);
        this.grav = new Float32Array(max);
        this.drag = new Float32Array(max);
        this.bounce = new Uint8Array(max);
        // атрибуты GPU
        const base = new THREE.PlaneGeometry(1, 1);
        const geo = new THREE.InstancedBufferGeometry();
        geo.index = base.index;
        geo.setAttribute("position", base.attributes.position);
        geo.setAttribute("uv", base.attributes.uv);
        this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
        this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
        this.aSize = new THREE.InstancedBufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
        this.aRot = new THREE.InstancedBufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
        geo.setAttribute("aPos", this.aPos);
        geo.setAttribute("aCol", this.aCol);
        geo.setAttribute("aSize", this.aSize);
        geo.setAttribute("aRot", this.aRot);
        geo.instanceCount = 0;
        this.geo = geo;
        const mat = new THREE.ShaderMaterial({
            uniforms: { map: { value: texture } },
            vertexShader: VERT, fragmentShader: FRAG,
            transparent: true, depthWrite: false,
            blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        });
        this.mesh = new THREE.Mesh(geo, mat);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = additive ? 12 : 10;
    }

    /** o: {x,y,z, vx,vy,vz, life, s0, s1, c0:[r,g,b,a], c1, grav, drag, rot, vr, bounce} */
    emit(o) {
        let i = this.n;
        if (i >= this.max) {
            // переполнение — перезаписываем случайную старую частицу
            i = Math.floor(Math.random() * this.max);
        } else this.n++;
        const i3 = i * 3, i4 = i * 4;
        this.p[i3] = o.x; this.p[i3 + 1] = o.y; this.p[i3 + 2] = o.z;
        this.v[i3] = o.vx || 0; this.v[i3 + 1] = o.vy || 0; this.v[i3 + 2] = o.vz || 0;
        this.age[i] = 0;
        this.life[i] = o.life;
        this.s0[i] = o.s0; this.s1[i] = o.s1 ?? o.s0;
        const c0 = o.c0, c1 = o.c1 || o.c0;
        this.c0[i4] = c0[0]; this.c0[i4 + 1] = c0[1]; this.c0[i4 + 2] = c0[2]; this.c0[i4 + 3] = c0[3];
        this.c1[i4] = c1[0]; this.c1[i4 + 1] = c1[1]; this.c1[i4 + 2] = c1[2]; this.c1[i4 + 3] = c1[3];
        this.rot[i] = o.rot ?? Math.random() * TAU;
        this.vr[i] = o.vr || 0;
        this.grav[i] = o.grav || 0;
        this.drag[i] = o.drag ?? 1.2;
        this.bounce[i] = o.bounce ? 1 : 0;
    }

    update(dt) {
        let n = this.n;
        const P = this.p, V = this.v;
        for (let i = 0; i < n; i++) {
            this.age[i] += dt;
            if (this.age[i] >= this.life[i]) {
                // удаление обменом с последней
                n--;
                if (i !== n) this.copy(n, i);
                i--;
                continue;
            }
            const i3 = i * 3;
            const dr = Math.max(0, 1 - this.drag[i] * dt);
            V[i3] *= dr; V[i3 + 1] = V[i3 + 1] * dr - this.grav[i] * dt; V[i3 + 2] *= dr;
            P[i3] += V[i3] * dt; P[i3 + 1] += V[i3 + 1] * dt; P[i3 + 2] += V[i3 + 2] * dt;
            if (P[i3 + 1] < 0.05) {
                P[i3 + 1] = 0.05;
                if (this.bounce[i]) { V[i3 + 1] = -V[i3 + 1] * 0.3; V[i3] *= 0.6; V[i3 + 2] *= 0.6; this.vr[i] *= 0.5; }
                else V[i3 + 1] = 0;
            }
            this.rot[i] += this.vr[i] * dt;
        }
        this.n = n;
        const aP = this.aPos.array, aC = this.aCol.array, aS = this.aSize.array, aR = this.aRot.array;
        for (let i = 0; i < n; i++) {
            const t = this.age[i] / this.life[i];
            const i3 = i * 3, i4 = i * 4;
            aP[i3] = P[i3]; aP[i3 + 1] = P[i3 + 1]; aP[i3 + 2] = P[i3 + 2];
            for (let k = 0; k < 4; k++) aC[i4 + k] = this.c0[i4 + k] + (this.c1[i4 + k] - this.c0[i4 + k]) * t;
            aS[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
            aR[i] = this.rot[i];
        }
        this.geo.instanceCount = n;
        this.aPos.needsUpdate = true;
        this.aCol.needsUpdate = true;
        this.aSize.needsUpdate = true;
        this.aRot.needsUpdate = true;
    }

    copy(from, to) {
        const f3 = from * 3, t3 = to * 3, f4 = from * 4, t4 = to * 4;
        for (let k = 0; k < 3; k++) { this.p[t3 + k] = this.p[f3 + k]; this.v[t3 + k] = this.v[f3 + k]; }
        for (let k = 0; k < 4; k++) { this.c0[t4 + k] = this.c0[f4 + k]; this.c1[t4 + k] = this.c1[f4 + k]; }
        this.age[to] = this.age[from]; this.life[to] = this.life[from];
        this.s0[to] = this.s0[from]; this.s1[to] = this.s1[from];
        this.rot[to] = this.rot[from]; this.vr[to] = this.vr[from];
        this.grav[to] = this.grav[from]; this.drag[to] = this.drag[from]; this.bounce[to] = this.bounce[from];
    }

    clear() { this.n = 0; this.geo.instanceCount = 0; }
}

/** Набор эмиттеров для боевых эффектов */
export class Particles {
    constructor(quality = "high") {
        this.scale = quality === "low" ? 0.45 : quality === "medium" ? 0.75 : 1;
        this.add = new System(2600, true, softTexture());
        this.norm = new System(3200, false, smokeTexture());
        this.group = [this.norm.mesh, this.add.mesh];
    }

    setQuality(q) { this.scale = q === "low" ? 0.45 : q === "medium" ? 0.75 : 1; }
    count(n) { return Math.max(1, Math.round(n * this.scale)); }

    update(dt) {
        this.add.update(dt);
        this.norm.update(dt);
    }

    clear() { this.add.clear(); this.norm.clear(); }

    /* ─────────── эмиттеры ─────────── */
    muzzle(p, d, cal) {
        const k = Math.min(2.4, 0.5 + cal / 60);
        this.add.emit({ x: p[0] + d[0] * 0.4, y: p[1], z: p[2] + d[2] * 0.4, life: 0.09, s0: 1.6 * k, s1: 3.2 * k, c0: [1, 0.85, 0.5, 1], c1: [1, 0.5, 0.15, 0] });
        for (let i = 0; i < this.count(8 * k); i++) {
            const sp = rnd(10, 40) * k;
            this.add.emit({ x: p[0], y: p[1], z: p[2], vx: d[0] * sp + rnd(-4, 4), vy: rnd(-1, 2), vz: d[2] * sp + rnd(-4, 4), life: rnd(0.06, 0.16), s0: rnd(0.5, 1.1) * k, s1: 0.2, c0: [1, 0.75, 0.35, 0.9], c1: [1, 0.3, 0.05, 0], drag: 8 });
        }
        // дым и пыль от дульного тормоза
        for (let i = 0; i < this.count(10 * k); i++) {
            const sp = rnd(2, 14) * k;
            const side = rnd() < 0.5 ? -1 : 1;
            const sx = d[0] * sp + -d[2] * side * rnd(0, 6) * k, sz = d[2] * sp + d[0] * side * rnd(0, 6) * k;
            this.norm.emit({ x: p[0], y: p[1], z: p[2], vx: sx, vy: rnd(0.5, 2.5), vz: sz, life: rnd(0.9, 2.2), s0: rnd(0.8, 1.4) * k, s1: rnd(3, 5) * k, c0: [0.75, 0.73, 0.68, 0.45], c1: [0.8, 0.78, 0.74, 0], drag: 2.6, vr: rnd(-1, 1) });
        }
    }

    groundBlast(p, cal, dust) {
        // волна пыли от выстрела крупного калибра
        if (cal < 70) return;
        const n = this.count(cal / 8);
        for (let i = 0; i < n; i++) {
            const a = rnd(TAU), sp = rnd(6, 14);
            this.norm.emit({ x: p[0], y: 0.4, z: p[2], vx: Math.cos(a) * sp, vy: rnd(0.3, 1.2), vz: Math.sin(a) * sp, life: rnd(1, 1.8), s0: 1.5, s1: 4.5, c0: [...dust, 0.35], c1: [...dust, 0], drag: 2.4 });
        }
    }

    explosion(p, size, ground, dust) {
        const k = size;
        this.add.emit({ x: p[0], y: p[1] + 0.3, z: p[2], life: 0.14, s0: 3 * k, s1: 7 * k, c0: [1, 0.9, 0.6, 1], c1: [1, 0.55, 0.2, 0] });
        for (let i = 0; i < this.count(18 * k); i++) {
            const a = rnd(TAU), up = rnd(0.2, 1), sp = rnd(4, 14) * k;
            this.add.emit({ x: p[0], y: p[1] + 0.3, z: p[2], vx: Math.cos(a) * sp, vy: up * sp, vz: Math.sin(a) * sp, life: rnd(0.25, 0.6), s0: rnd(1, 2.2) * k, s1: rnd(0.3, 1) * k, c0: [1, 0.68, 0.25, 0.95], c1: [0.9, 0.2, 0.05, 0], drag: 3.5 });
        }
        for (let i = 0; i < this.count(22 * k); i++) {
            const a = rnd(TAU), sp = rnd(1, 7) * k;
            const col = ground ? dust : [0.18, 0.17, 0.15];
            this.norm.emit({ x: p[0] + rnd(-0.5, 0.5), y: p[1] + rnd(0, 1), z: p[2] + rnd(-0.5, 0.5), vx: Math.cos(a) * sp, vy: rnd(1, 5) * k, vz: Math.sin(a) * sp, life: rnd(1.6, 3.4), s0: rnd(1.2, 2.2) * k, s1: rnd(4, 7) * k, c0: [...col, 0.7], c1: [col[0] * 1.2, col[1] * 1.2, col[2] * 1.2, 0], drag: 1.4, vr: rnd(-0.6, 0.6) });
        }
        for (let i = 0; i < this.count(14 * k); i++) {
            const a = rnd(TAU), sp = rnd(5, 16);
            this.norm.emit({ x: p[0], y: p[1] + 0.3, z: p[2], vx: Math.cos(a) * sp, vy: rnd(4, 12), vz: Math.sin(a) * sp, life: rnd(1, 2), s0: rnd(0.15, 0.35), c0: [0.12, 0.11, 0.09, 1], c1: [0.12, 0.11, 0.09, 0.8], grav: 14, drag: 0.4, bounce: true, vr: rnd(-12, 12) });
        }
    }

    /** Взрыв боеукладки: огненный столб */
    detonation(p) {
        this.explosion(p, 2.4, false, [0.2, 0.2, 0.2]);
        for (let i = 0; i < this.count(40); i++) {
            const a = rnd(TAU), sp = rnd(0.5, 4);
            this.add.emit({ x: p[0], y: 1.5, z: p[2], vx: Math.cos(a) * sp, vy: rnd(10, 26), vz: Math.sin(a) * sp, life: rnd(0.5, 1.2), s0: rnd(1.5, 3), s1: rnd(2, 4), c0: [1, 0.7, 0.3, 1], c1: [0.8, 0.2, 0.05, 0], drag: 1.4 });
        }
        for (let i = 0; i < this.count(30); i++) {
            this.norm.emit({ x: p[0] + rnd(-1, 1), y: rnd(2, 10), z: p[2] + rnd(-1, 1), vx: rnd(-2, 2), vy: rnd(3, 8), vz: rnd(-2, 2), life: rnd(3, 6), s0: rnd(2, 3), s1: rnd(7, 11), c0: [0.1, 0.09, 0.08, 0.75], c1: [0.25, 0.24, 0.22, 0], drag: 0.6, vr: rnd(-0.4, 0.4) });
        }
    }

    sparks(p, n = 10, col = [1, 0.8, 0.4]) {
        for (let i = 0; i < this.count(n); i++) {
            const a = rnd(TAU), sp = rnd(5, 22);
            this.add.emit({ x: p[0], y: p[1], z: p[2], vx: Math.cos(a) * sp, vy: rnd(1, 10), vz: Math.sin(a) * sp, life: rnd(0.15, 0.45), s0: rnd(0.15, 0.3), s1: 0.05, c0: [...col, 1], c1: [col[0], col[1] * 0.5, 0.1, 0], grav: 18, drag: 1.5, bounce: true });
        }
    }

    dust(p, col, n = 6, sp = 4) {
        for (let i = 0; i < this.count(n); i++) {
            const a = rnd(TAU), s = rnd(0.5, sp);
            this.norm.emit({ x: p[0] + rnd(-0.4, 0.4), y: p[1], z: p[2] + rnd(-0.4, 0.4), vx: Math.cos(a) * s, vy: rnd(0.5, 3), vz: Math.sin(a) * s, life: rnd(0.8, 1.8), s0: rnd(0.6, 1.2), s1: rnd(2.2, 3.6), c0: [...col, 0.5], c1: [...col, 0], drag: 2, vr: rnd(-1, 1) });
        }
    }

    /** Пыль из-под гусениц */
    trackDust(x, z, col, k) {
        this.norm.emit({ x: x + rnd(-0.3, 0.3), y: 0.3, z: z + rnd(-0.3, 0.3), vx: rnd(-1, 1), vy: rnd(0.4, 1.4), vz: rnd(-1, 1), life: rnd(0.9, 1.7), s0: 0.7 * k, s1: 2.6 * k, c0: [...col, 0.28 * k], c1: [...col, 0], drag: 1.5, vr: rnd(-0.8, 0.8) });
    }

    fire(p, k = 1) {
        this.add.emit({ x: p[0] + rnd(-0.4, 0.4), y: p[1] + rnd(0, 0.3), z: p[2] + rnd(-0.4, 0.4), vx: rnd(-0.5, 0.5), vy: rnd(2, 4.5), vz: rnd(-0.5, 0.5), life: rnd(0.35, 0.7), s0: rnd(0.8, 1.3) * k, s1: 0.2, c0: [1, 0.62, 0.2, 0.9], c1: [1, 0.25, 0.05, 0], drag: 0.8 });
        if (Math.random() < 0.55) this.smoke(p, 0.12, k);
    }

    smoke(p, dark = 0.2, k = 1) {
        this.norm.emit({ x: p[0] + rnd(-0.5, 0.5), y: p[1] + 0.5, z: p[2] + rnd(-0.5, 0.5), vx: rnd(-0.6, 0.6) + 1.2, vy: rnd(2, 3.5), vz: rnd(-0.6, 0.6) - 0.6, life: rnd(2.2, 4), s0: rnd(0.8, 1.4) * k, s1: rnd(4, 6.5) * k, c0: [dark, dark, dark * 0.95, 0.55], c1: [dark + 0.25, dark + 0.25, dark + 0.23, 0], drag: 0.5, vr: rnd(-0.5, 0.5) });
    }

    splash(p, k = 1) {
        for (let i = 0; i < this.count(16 * k); i++) {
            const a = rnd(TAU), sp = rnd(1, 5) * k;
            this.norm.emit({ x: p[0], y: 0.2, z: p[2], vx: Math.cos(a) * sp, vy: rnd(4, 11) * k, vz: Math.sin(a) * sp, life: rnd(0.6, 1.3), s0: rnd(0.4, 0.8) * k, s1: rnd(1.4, 2.4) * k, c0: [0.85, 0.92, 0.95, 0.75], c1: [0.9, 0.95, 1, 0], grav: 12, drag: 0.8 });
        }
    }

    markerSmoke(p, col) {
        this.norm.emit({ x: p[0] + rnd(-0.4, 0.4), y: 0.4, z: p[2] + rnd(-0.4, 0.4), vx: rnd(-0.5, 0.5) + 0.8, vy: rnd(1.5, 3), vz: rnd(-0.5, 0.5) - 0.4, life: rnd(2.5, 4), s0: 0.8, s1: rnd(4, 6), c0: [...col, 0.7], c1: [col[0] * 0.8 + 0.2, col[1] * 0.8 + 0.2, col[2] * 0.8 + 0.2, 0], drag: 0.6, vr: rnd(-0.5, 0.5) });
    }

    tracerGlow(p, col) {
        this.add.emit({ x: p[0], y: p[1], z: p[2], life: 0.08, s0: 0.9, s1: 0.4, c0: [...col, 0.9], c1: [...col, 0] });
    }

    debris(p, col, n = 8) {
        for (let i = 0; i < this.count(n); i++) {
            const a = rnd(TAU), sp = rnd(2, 7);
            this.norm.emit({ x: p[0], y: p[1], z: p[2], vx: Math.cos(a) * sp, vy: rnd(2, 6), vz: Math.sin(a) * sp, life: rnd(0.8, 1.6), s0: rnd(0.15, 0.35), c0: [...col, 1], c1: [...col, 0.6], grav: 14, drag: 0.6, bounce: true, vr: rnd(-10, 10) });
        }
    }
}
