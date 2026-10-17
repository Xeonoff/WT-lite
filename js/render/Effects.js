import * as THREE from "three";
import { scorchTexture } from "./Textures.js";
import { rnd } from "../core/Utils.js";

const DECAL_VERT = /* glsl */`
attribute float aBirth;
attribute float aLife;
uniform float uTime;
varying vec2 vUv;
varying float vA;
void main() {
    vUv = uv;
    float age = uTime - aBirth;
    vA = aLife > 0.0 ? clamp(1.0 - age / aLife, 0.0, 1.0) : 0.0;
    vec4 p = instanceMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * modelViewMatrix * p;
}`;

const MARK_FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uOpacity;
varying vec2 vUv;
varying float vA;
void main() {
    float edge = smoothstep(0.0, 0.18, vUv.y) * smoothstep(1.0, 0.82, vUv.y);
    float links = 0.75 + 0.25 * step(0.5, fract(vUv.x * 3.0));
    float a = vA * uOpacity * edge * links;
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor, a);
}`;

const SCORCH_FRAG = /* glsl */`
uniform sampler2D map;
uniform float uOpacity;
varying vec2 vUv;
varying float vA;
void main() {
    vec4 t = texture2D(map, vUv);
    float a = t.a * vA * uOpacity;
    if (a < 0.003) discard;
    gl_FragColor = vec4(t.rgb, a);
}`;

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** Кольцевой буфер плоских декалей на земле */
class DecalRing {
    constructor(max, material, y) {
        this.max = max;
        this.i = 0;
        const g = new THREE.PlaneGeometry(1, 1);
        g.rotateX(-Math.PI / 2);
        this.birth = new THREE.InstancedBufferAttribute(new Float32Array(max).fill(-1e6), 1);
        this.life = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
        g.setAttribute("aBirth", this.birth);
        g.setAttribute("aLife", this.life);
        this.mesh = new THREE.InstancedMesh(g, material, max);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 2;
        tmpM.makeScale(0, 0, 0);
        for (let k = 0; k < max; k++) this.mesh.setMatrixAt(k, tmpM);
        this.y = y;
        this.dirty = false;
    }
    add(x, z, a, sx, sz, time, life) {
        const k = this.i;
        this.i = (this.i + 1) % this.max;
        tmpQ.setFromAxisAngle(UP, -a);
        tmpP.set(x, this.y, z);
        tmpS.set(sx, 1, sz);
        tmpM.compose(tmpP, tmpQ, tmpS);
        this.mesh.setMatrixAt(k, tmpM);
        this.birth.array[k] = time;
        this.life.array[k] = life;
        this.dirty = true;
    }
    flush() {
        if (!this.dirty) return;
        this.mesh.instanceMatrix.needsUpdate = true;
        this.birth.needsUpdate = true;
        this.life.needsUpdate = true;
        this.dirty = false;
    }
    clear() {
        tmpM.makeScale(0, 0, 0);
        for (let k = 0; k < this.max; k++) { this.mesh.setMatrixAt(k, tmpM); this.life.array[k] = 0; }
        this.dirty = true;
        this.flush();
    }
}

export class Effects {
    constructor(scene) {
        this.scene = scene;
        this.time = 0;
        this.group = new THREE.Group();
        scene.add(this.group);

        this.markMat = new THREE.ShaderMaterial({
            uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0x2a281e) }, uOpacity: { value: 0.42 } },
            vertexShader: DECAL_VERT, fragmentShader: MARK_FRAG, transparent: true, depthWrite: false,
        });
        this.marks = new DecalRing(3000, this.markMat, 0.035);
        this.group.add(this.marks.mesh);

        this.scorchMat = new THREE.ShaderMaterial({
            uniforms: { uTime: { value: 0 }, map: { value: scorchTexture() }, uOpacity: { value: 0.9 } },
            vertexShader: DECAL_VERT, fragmentShader: SCORCH_FRAG, transparent: true, depthWrite: false,
        });
        this.scorch = new DecalRing(260, this.scorchMat, 0.045);
        this.group.add(this.scorch.mesh);

        // трассеры
        this.tracers = new Map();
        this.tracerPool = [];
        this.tracerGeo = new THREE.BoxGeometry(1, 0.11, 0.11);
        this.tracerMats = new Map();

        // вспышки света
        this.lights = [];
        for (let i = 0; i < 3; i++) {
            const l = new THREE.PointLight(0xffb060, 0, 30, 1.6);
            l.position.set(0, -100, 0);
            this.group.add(l);
            this.lights.push({ l, t: 0, dur: 1, peak: 0 });
        }

        this.debris = [];
    }

    setMarkColor(hex) { this.markMat.uniforms.uColor.value.setHex(hex); }

    clear() {
        for (const [, m] of this.tracers) { m.visible = false; this.tracerPool.push(m); }
        this.tracers.clear();
        this.marks.clear();
        this.scorch.clear();
        for (const d of this.debris) this.scene.remove(d.obj);
        this.debris = [];
        for (const L of this.lights) { L.l.intensity = 0; L.t = L.dur; }
    }

    trackMark(x, z, a, w) { this.marks.add(x, z, a, 0.62, w * 0.9, this.time, 14); }
    crater(x, z, r) { this.scorch.add(x, z, rnd(6.28), r * 2, r * 2, this.time, 160); }

    flash(p, color, peak, dur, dist = 28) {
        let best = this.lights[0];
        for (const L of this.lights) if (L.t >= L.dur) { best = L; break; } else if (L.t / L.dur > best.t / best.dur) best = L;
        best.l.color.setHex(color);
        best.l.position.set(p[0], p[1] + 1.2, p[2]);
        best.l.distance = dist;
        best.t = 0; best.dur = dur; best.peak = peak;
    }

    tracerMat(col) {
        if (this.tracerMats.has(col)) return this.tracerMats.get(col);
        const m = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
        this.tracerMats.set(col, m);
        return m;
    }

    syncTracers(shots, particles) {
        const alive = new Set();
        for (const s of shots) {
            alive.add(s.id);
            let m = this.tracers.get(s.id);
            if (!m) {
                m = this.tracerPool.pop() || new THREE.Mesh(this.tracerGeo, this.tracerMat("#fff"));
                m.material = this.tracerMat(s.type.color);
                m.visible = true;
                if (!m.parent) this.group.add(m);
                this.tracers.set(s.id, m);
            }
            const len = Math.min(8, Math.max(1.5, s.traveled)) * (s.rico ? 0.5 : 1);
            m.scale.set(len, s.def.cal > 70 ? 1.6 : s.def.cal > 40 ? 1.2 : 0.8, s.def.cal > 70 ? 1.6 : 1);
            m.position.set(s.x - s.d[0] * len / 2, s.y - s.d[1] * len / 2, s.z - s.d[2] * len / 2);
            m.rotation.set(0, -Math.atan2(s.d[2], s.d[0]), Math.asin(Math.max(-1, Math.min(1, s.d[1]))));
            if (particles && Math.random() < 0.5) particles.tracerGlow([s.x, s.y, s.z], hexToRgb(s.type.color));
        }
        for (const [id, m] of this.tracers) {
            if (!alive.has(id)) {
                m.visible = false;
                this.tracerPool.push(m);
                this.tracers.delete(id);
            }
        }
    }

    /** Сорванная башня */
    throwTurret(obj, vel, spin) {
        this.scene.attach(obj);
        this.debris.push({ obj, v: vel, spin, rest: false });
    }

    update(dt) {
        this.time += dt;
        this.markMat.uniforms.uTime.value = this.time;
        this.scorchMat.uniforms.uTime.value = this.time;
        this.marks.flush();
        this.scorch.flush();
        for (const L of this.lights) {
            if (L.t >= L.dur) { L.l.intensity = 0; continue; }
            L.t += dt;
            const k = Math.max(0, 1 - L.t / L.dur);
            L.l.intensity = L.peak * k * k;
        }
        for (const d of this.debris) {
            if (d.rest) continue;
            d.v[1] -= 9.8 * dt;
            d.obj.position.x += d.v[0] * dt;
            d.obj.position.y += d.v[1] * dt;
            d.obj.position.z += d.v[2] * dt;
            d.obj.rotation.x += d.spin[0] * dt;
            d.obj.rotation.z += d.spin[2] * dt;
            if (d.obj.position.y < 0.3 && d.v[1] < 0) {
                d.obj.position.y = 0.3;
                if (Math.abs(d.v[1]) < 2.5) d.rest = true;
                d.v = [d.v[0] * 0.35, -d.v[1] * 0.25, d.v[2] * 0.35];
                d.spin = [d.spin[0] * 0.3, 0, d.spin[2] * 0.3];
            }
        }
    }
}

export function hexToRgb(hex) {
    const h = hex.replace("#", "");
    const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}
