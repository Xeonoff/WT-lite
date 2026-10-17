import * as THREE from "three";
import { mkCanvas, seeded } from "../core/Utils.js";
import { groundTexture, roofTexture } from "./Textures.js";

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const tmpC = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

function setInst(mesh, i, x, y, z, rotY, sx, sy, sz) {
    tmpQ.setFromAxisAngle(UP, rotY);
    tmpP.set(x, y, z);
    tmpS.set(sx, sy, sz);
    tmpM.compose(tmpP, tmpQ, tmpS);
    mesh.setMatrixAt(i, tmpM);
}

function instanced(geo, mat, n, shadow = true) {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
    m.count = n;
    m.castShadow = shadow;
    m.receiveShadow = true;
    return m;
}

/** Треугольная призма для двускатной крыши: основание 1×1, высота 1 */
function prismGeometry() {
    const g = new THREE.BufferGeometry();
    const v = [
        // торцы
        -0.5, 0, -0.5, -0.5, 0, 0.5, -0.5, 1, 0,
        0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 1, 0,
        // скаты
        -0.5, 0, 0.5, 0.5, 0, 0.5, 0.5, 1, 0, -0.5, 0, 0.5, 0.5, 1, 0, -0.5, 1, 0,
        0.5, 0, -0.5, -0.5, 0, -0.5, -0.5, 1, 0, 0.5, 0, -0.5, -0.5, 1, 0, 0.5, 1, 0,
    ];
    const uv = [
        0, 0, 1, 0, 0.5, 1, 0, 0, 1, 0, 0.5, 1,
        0, 0, 4, 0, 4, 2, 0, 0, 4, 2, 0, 2,
        0, 0, 4, 0, 4, 2, 0, 0, 4, 2, 0, 2,
    ];
    g.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    return g;
}

export class WorldMesh {
    constructor(world) {
        this.world = world;
        this.biome = world.biome;
        this.group = new THREE.Group();
        this.buildGround();
        this.buildRiver();
        this.buildBuildings();
        this.buildTrees();
        this.buildBushes();
        this.buildRocks();
        this.buildFences();
        this.buildHedges();
        this.buildHay();
        this.buildPoints();
        this.buildBorder();
    }

    /* ─────────── Земля ─────────── */
    buildGround() {
        const w = this.world, S = w.S, B = this.biome;
        const margin = 260;
        const gt = groundTexture(B);
        const tile = 26;
        gt.repeat.set((S + margin * 2) / tile, (S + margin * 2) / tile);
        const gm = new THREE.MeshStandardMaterial({ map: gt, roughness: 0.97, metalness: 0 });
        const ground = new THREE.Mesh(new THREE.PlaneGeometry(S + margin * 2, S + margin * 2), gm);
        ground.rotation.x = -Math.PI / 2;
        ground.position.set(S / 2, 0, S / 2);
        ground.receiveShadow = true;
        this.group.add(ground);

        // слой декалей: поля, дороги
        const PX = 2;
        const c = mkCanvas(Math.ceil(S * PX), Math.ceil(S * PX)), g = c.getContext("2d");
        g.scale(PX, PX);
        const r = seeded(w.seed + 11);
        for (const f of w.fields) {
            g.save();
            g.translate(f.x, f.z);
            g.rotate(f.a);
            g.fillStyle = B.field[f.col % B.field.length];
            g.globalAlpha = 0.55;
            g.fillRect(-f.hl, -f.hw, f.hl * 2, f.hw * 2);
            if (f.stripes) {
                g.globalAlpha = 0.18;
                g.fillStyle = "#000";
                for (let y = -f.hw; y < f.hw; y += 2.2) g.fillRect(-f.hl, y, f.hl * 2, 0.6);
            }
            g.restore();
        }
        g.globalAlpha = 1;
        // пятна грязи
        for (let i = 0; i < 60; i++) {
            g.fillStyle = B.dirt;
            g.globalAlpha = 0.12 + r() * 0.12;
            g.beginPath();
            g.ellipse(r() * S, r() * S, 4 + r() * 14, 3 + r() * 9, r() * 6.3, 0, 6.283);
            g.fill();
        }
        g.globalAlpha = 1;
        g.lineCap = "round";
        g.lineJoin = "round";
        if (w.river) {
            const R = w.river;
            const line = (lw, style, alpha) => {
                g.strokeStyle = style; g.lineWidth = lw; g.globalAlpha = alpha;
                g.beginPath();
                R.pts.forEach(([x, z], i) => (i ? g.lineTo(x, z) : g.moveTo(x, z)));
                g.stroke();
            };
            if (R.frozen) { line(R.w + 6, "#9aa7b0", 0.5); line(R.w, "#dbe9f1", 0.95); }
            else { line(R.w + 7, "#5d5038", 0.55); line(R.w + 3, "#7b6a4a", 0.6); line(R.w, "#2a3f45", 0.95); }
            g.globalAlpha = 1;
            for (const c of w.bridges) {
                if (c.kind !== "ford") continue;
                g.save(); g.translate(c.x, c.z); g.rotate(c.a + Math.PI / 2);
                g.fillStyle = "rgba(150,130,95,.75)";
                g.fillRect(-c.hl, -c.hw, c.hl * 2, c.hw * 2);
                g.restore();
            }
        }
        for (const rd of w.roads) {
            g.strokeStyle = B.road;
            g.lineWidth = rd.w;
            g.globalAlpha = rd.kind === "path" ? 0.6 : rd.kind === "street" ? 0.7 : 0.85;
            g.beginPath();
            rd.pts.forEach(([x, z], i) => (i ? g.lineTo(x, z) : g.moveTo(x, z)));
            g.stroke();
            if (rd.kind !== "street") {
                g.strokeStyle = "rgba(0,0,0,.18)";
                g.lineWidth = 0.6;
                for (const off of [-rd.w * 0.22, rd.w * 0.22]) {
                    g.beginPath();
                    rd.pts.forEach(([x, z], i) => {
                        const n = rd.pts[Math.min(i + 1, rd.pts.length - 1)], p = rd.pts[Math.max(0, i - 1)];
                        const ax = n[0] - p[0], az = n[1] - p[1], l = Math.hypot(ax, az) || 1;
                        const px = x - az / l * off, pz = z + ax / l * off;
                        i ? g.lineTo(px, pz) : g.moveTo(px, pz);
                    });
                    g.stroke();
                }
            }
        }
        g.globalAlpha = 1;
        // тени-пятна под деревьями и зданиями (ambient occlusion)
        for (const t of w.trees) {
            const gr = g.createRadialGradient(t.x, t.z, 0, t.x, t.z, t.r * 1.3);
            gr.addColorStop(0, "rgba(0,0,0,.22)");
            gr.addColorStop(1, "rgba(0,0,0,0)");
            g.fillStyle = gr;
            g.fillRect(t.x - t.r * 1.4, t.z - t.r * 1.4, t.r * 2.8, t.r * 2.8);
        }
        for (const b of w.buildings) {
            g.save();
            g.translate(b.x, b.z);
            g.rotate(b.a);
            g.fillStyle = "rgba(0,0,0,.16)";
            g.fillRect(-b.hl - 1, -b.hw - 1, b.hl * 2 + 2, b.hw * 2 + 2);
            g.restore();
        }
        const dt = new THREE.CanvasTexture(c);
        this.decalTex = dt;
        dt.colorSpace = THREE.SRGBColorSpace;
        dt.anisotropy = 4;
        const dm = new THREE.MeshStandardMaterial({ map: dt, transparent: true, roughness: 1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
        const decal = new THREE.Mesh(new THREE.PlaneGeometry(S, S), dm);
        decal.rotation.x = -Math.PI / 2;
        decal.position.set(S / 2, 0.02, S / 2);
        decal.receiveShadow = true;
        this.group.add(decal);
    }

    /* ─────────── Река и переправы ─────────── */
    buildRiver() {
        const w = this.world, R = w.river;
        if (!R) return;
        const pos = [], idx = [];
        const n = R.pts.length;
        for (let i = 0; i < n; i++) {
            const p = R.pts[i], q = R.pts[Math.min(n - 1, i + 1)], o = R.pts[Math.max(0, i - 1)];
            const dx = q[0] - o[0], dz = q[1] - o[1], l = Math.hypot(dx, dz) || 1;
            const nx = -dz / l, nz = dx / l;
            pos.push(p[0] + nx * R.w / 2, 0.07, p[1] + nz * R.w / 2, p[0] - nx * R.w / 2, 0.07, p[1] - nz * R.w / 2);
            if (i < n - 1) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
        geo.setIndex(idx);
        geo.computeVertexNormals();
        // нормали вверх (лента плоская)
        const nrm = geo.attributes.normal;
        for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
        const mat = R.frozen
            ? new THREE.MeshStandardMaterial({ color: 0xd8e8f2, roughness: 0.25, metalness: 0.05, transparent: true, opacity: 0.75, depthWrite: false })
            : new THREE.MeshStandardMaterial({ color: 0x2c4a56, roughness: 0.08, metalness: 0.35, transparent: true, opacity: 0.88, depthWrite: false });
        const water = new THREE.Mesh(geo, mat);
        water.receiveShadow = true;
        water.renderOrder = 1;
        this.group.add(water);
        this.water = water;
        // мосты
        const wood = new THREE.MeshStandardMaterial({ color: R.frozen ? 0x7d7a74 : 0x6b5638, roughness: 0.95 });
        for (const c of w.bridges) {
            const g = new THREE.Group();
            g.position.set(c.x, 0, c.z);
            g.rotation.y = -(c.a + Math.PI / 2);
            if (c.kind === "bridge") {
                const deck = new THREE.Mesh(new THREE.BoxGeometry(c.hl * 2, 0.12, c.hw * 2), wood);
                deck.position.y = 0.1;
                deck.receiveShadow = true;
                g.add(deck);
                for (const s of [-1, 1]) {
                    const rail = new THREE.Mesh(new THREE.BoxGeometry(c.hl * 2, 0.7, 0.14), wood);
                    rail.position.set(0, 0.45, s * (c.hw - 0.1));
                    rail.castShadow = true;
                    g.add(rail);
                }
                for (const sx of [-0.3, 0.3]) for (const s of [-1, 1]) {
                    const pile = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 1, 6), wood);
                    pile.position.set(sx * c.hl, 0, s * (c.hw - 0.3));
                    g.add(pile);
                }
            } else {
                const shoal = new THREE.Mesh(new THREE.PlaneGeometry(c.hl * 2, c.hw * 2), new THREE.MeshStandardMaterial({ color: 0x9a8a62, transparent: true, opacity: 0.55, depthWrite: false, roughness: 1 }));
                shoal.rotation.x = -Math.PI / 2;
                shoal.position.y = 0.075;
                shoal.renderOrder = 2;
                g.add(shoal);
            }
            this.group.add(g);
        }
    }

    /* ─────────── Здания ─────────── */
    buildBuildings() {
        const w = this.world, B = this.biome;
        const blds = w.buildings;
        const wallMat = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0 });
        const roofMat = new THREE.MeshStandardMaterial({ map: roofTexture(), roughness: 0.85 });
        const flatMat = new THREE.MeshStandardMaterial({ roughness: 0.95 });
        const box = new THREE.BoxGeometry(1, 1, 1);
        box.translate(0, 0.5, 0);
        const walls = instanced(box, wallMat, blds.length);
        const gable = blds.filter((b) => b.roof === "gable");
        const flat = blds.filter((b) => b.roof === "flat");
        const roofs = instanced(prismGeometry(), roofMat, gable.length);
        const flats = instanced(box, flatMat, flat.length * 2);
        blds.forEach((b, i) => {
            setInst(walls, i, b.x, 0, b.z, -b.a, b.hl * 2, b.h, b.hw * 2);
            tmpC.setHex(B.wall[b.col % B.wall.length]);
            if (b.kind === "ruin") tmpC.multiplyScalar(0.8);
            walls.setColorAt(i, tmpC);
        });
        gable.forEach((b, i) => {
            const rh = Math.min(b.hw * 1.1, 3.4);
            // конёк вдоль длинной стороны
            setInst(roofs, i, b.x, b.h, b.z, -b.a, b.hl * 2 + 0.6, rh, b.hw * 2 + 0.8);
            tmpC.setHex(B.roof[b.rcol % B.roof.length]);
            roofs.setColorAt(i, tmpC);
        });
        flat.forEach((b, i) => {
            setInst(flats, i * 2, b.x, b.h, b.z, -b.a, b.hl * 2 + 0.3, 0.35, b.hw * 2 + 0.3);
            setInst(flats, i * 2 + 1, b.x, b.h, b.z, -b.a, b.hl * 2 - 0.8, 0.42, b.hw * 2 - 0.8);
            tmpC.setHex(B.roof[b.rcol % B.roof.length]).multiplyScalar(0.92);
            flats.setColorAt(i * 2, tmpC);
            tmpC.multiplyScalar(0.8);
            flats.setColorAt(i * 2 + 1, tmpC);
        });
        for (const m of [walls, roofs, flats]) {
            if (m.instanceColor) m.instanceColor.needsUpdate = true;
            m.instanceMatrix.needsUpdate = true;
            this.group.add(m);
        }
    }

    /* ─────────── Деревья ─────────── */
    buildTrees() {
        const w = this.world, B = this.biome;
        const n = w.trees.length;
        const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 1, 6);
        trunkGeo.translate(0, 0.5, 0);
        const trunkMat = new THREE.MeshStandardMaterial({ color: B.trunk, roughness: 1 });
        let crownGeo;
        if (B.treeKind === "pine") {
            const a = new THREE.ConeGeometry(1, 1, 7);
            a.translate(0, 0.5, 0);
            crownGeo = a;
        } else if (B.treeKind === "palm") {
            crownGeo = new THREE.ConeGeometry(1, 0.42, 7);
            crownGeo.rotateX(Math.PI);
            crownGeo.translate(0, 0.21, 0);
        } else {
            crownGeo = new THREE.IcosahedronGeometry(1, 1);
            const pos = crownGeo.attributes.position;
            const r = seeded(5);
            for (let i = 0; i < pos.count; i++) {
                const k = 0.85 + r() * 0.3;
                pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k, pos.getZ(i) * k);
            }
            crownGeo.computeVertexNormals();
        }
        const crownMat = new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: B.treeKind !== "palm" });
        this.trunks = instanced(trunkGeo, trunkMat, n);
        this.crowns = instanced(crownGeo, crownMat, n);
        w.trees.forEach((t, i) => {
            tmpC.setHex(B.tree[i % B.tree.length]).multiplyScalar(0.85 + t.tint * 0.3);
            this.crowns.setColorAt(i, tmpC);
            this.placeTree(t);
        });
        if (this.crowns.instanceColor) this.crowns.instanceColor.needsUpdate = true;
        this.group.add(this.trunks, this.crowns);
    }

    treeDims(t) {
        const kind = this.biome.treeKind;
        if (kind === "pine") return { trunkH: t.h * 0.25, crownY: t.h * 0.18, cs: [t.r, t.h * 0.85, t.r] };
        if (kind === "palm") return { trunkH: t.h * 0.85, crownY: t.h * 0.82, cs: [t.r * 1.2, t.r * 0.9, t.r * 1.2] };
        return { trunkH: t.h * 0.42, crownY: t.h * 0.58, cs: [t.r, t.r * 0.85, t.r] };
    }

    placeTree(t) {
        const d = this.treeDims(t);
        const base = new THREE.Matrix4().makeTranslation(t.x, 0, t.z);
        let rot = new THREE.Matrix4();
        if (t.fallen) {
            const axis = new THREE.Vector3(-Math.sin(t.fallA), 0, Math.cos(t.fallA));
            rot.makeRotationAxis(axis, -Math.PI * 0.47);
        }
        const trunk = new THREE.Matrix4().compose(new THREE.Vector3(0, 0, 0), new THREE.Quaternion(), new THREE.Vector3(1, d.trunkH, 1));
        this.trunks.setMatrixAt(t.idx, base.clone().multiply(rot).multiply(trunk));
        const crown = new THREE.Matrix4().compose(new THREE.Vector3(0, d.crownY, 0), new THREE.Quaternion().setFromAxisAngle(UP, t.tint * 6), new THREE.Vector3(...d.cs));
        this.crowns.setMatrixAt(t.idx, base.clone().multiply(rot).multiply(crown));
        this.trunks.instanceMatrix.needsUpdate = true;
        this.crowns.instanceMatrix.needsUpdate = true;
    }

    /* ─────────── Кусты, камни, заборы, стога ─────────── */
    buildBushes() {
        const w = this.world, B = this.biome;
        const geo = new THREE.IcosahedronGeometry(1, 1);
        const mat = new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true });
        const m = instanced(geo, mat, w.bushes.length);
        w.bushes.forEach((b, i) => {
            setInst(m, i, b.x, b.r * 0.32, b.z, b.tint * 6, b.r, b.r * 0.62, b.r * (0.85 + b.tint * 0.3));
            tmpC.setHex(B.bush[i % B.bush.length]).multiplyScalar(0.85 + b.tint * 0.3);
            m.setColorAt(i, tmpC);
        });
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
        this.group.add(m);
    }

    buildRocks() {
        const w = this.world, B = this.biome;
        const geo = new THREE.DodecahedronGeometry(1, 0);
        const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true });
        const m = instanced(geo, mat, w.rocks.length);
        w.rocks.forEach((o, i) => {
            setInst(m, i, o.x, o.h * 0.3, o.z, o.rot, o.r * o.sx, o.h * 0.75, o.r * o.sz);
            tmpC.setHex(B.rock[i % B.rock.length]).multiplyScalar(0.85 + o.tint * 0.3);
            m.setColorAt(i, tmpC);
        });
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
        this.group.add(m);
    }

    buildFences() {
        const w = this.world, B = this.biome;
        const geo = new THREE.BoxGeometry(1, 1, 1);
        geo.translate(0, 0.5, 0);
        this.fenceMesh = instanced(geo, new THREE.MeshStandardMaterial({ color: B.fence, roughness: 1 }), w.fences.length);
        w.fences.forEach((f, i) => setInst(this.fenceMesh, i, f.x, 0, f.z, -f.a, f.hl * 2, f.h, 0.14));
        this.fenceMesh.instanceMatrix.needsUpdate = true;
        this.group.add(this.fenceMesh);
    }

    buildHedges() {
        const w = this.world, B = this.biome;
        const hs = w.hedges;
        if (!hs.length) return;
        const geo = new THREE.IcosahedronGeometry(1, 1);
        const pos = geo.attributes.position;
        const rr = seeded(17);
        for (let i = 0; i < pos.count; i++) {
            const k = 0.82 + rr() * 0.3;
            pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k, pos.getZ(i) * k);
        }
        geo.computeVertexNormals();
        this.hedgeMesh = instanced(geo, new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }), hs.length * 2);
        hs.forEach((h, i) => {
            for (let k = 0; k < 2; k++) {
                const off = (k ? 0.5 : -0.5) * h.hl;
                const x = h.x + Math.cos(h.a) * off, z = h.z + Math.sin(h.a) * off;
                setInst(this.hedgeMesh, i * 2 + k, x, h.h * 0.42, z, -h.a + h.tint, h.hl * 0.68, h.h * 0.62, h.hw * 1.35);
                tmpC.setHex(B.bush[(i + k) % B.bush.length]).multiplyScalar(0.8 + h.tint * 0.25);
                this.hedgeMesh.setColorAt(i * 2 + k, tmpC);
            }
        });
        if (this.hedgeMesh.instanceColor) this.hedgeMesh.instanceColor.needsUpdate = true;
        this.hedgeMesh.instanceMatrix.needsUpdate = true;
        this.group.add(this.hedgeMesh);
    }

    buildHay() {
        const w = this.world, B = this.biome;
        const geo = new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
        this.hayMesh = instanced(geo, new THREE.MeshStandardMaterial({ color: B.hay, roughness: 1 }), w.hay.length);
        w.hay.forEach((hy, i) => setInst(this.hayMesh, i, hy.x, 0, hy.z, 0, hy.r, hy.h, hy.r));
        this.hayMesh.instanceMatrix.needsUpdate = true;
        this.group.add(this.hayMesh);
    }

    hide(mesh, i) {
        tmpM.makeScale(0, 0, 0);
        mesh.setMatrixAt(i, tmpM);
        mesh.instanceMatrix.needsUpdate = true;
    }

    /** Изменения мира: падение деревьев, сломанные заборы и стога */
    onChange(e) {
        if (e.type === "tree") this.placeTree(e.o);
        else if (e.type === "fence") {
            const f = e.o;
            // повалить забор
            setInst(this.fenceMesh, f.idx, f.x, 0.05, f.z, -f.a + 0.3, f.hl * 2, 0.12, 1.0);
            this.fenceMesh.instanceMatrix.needsUpdate = true;
        } else if (e.type === "hay") this.hide(this.hayMesh, e.o.idx);
        else if (e.type === "hedge") {
            const h = e.o;
            // пролом: остаются низкие обломки кустарника
            for (let k = 0; k < 2; k++) {
                const off = (k ? 0.5 : -0.5) * h.hl;
                setInst(this.hedgeMesh, h.idx * 2 + k, h.x + Math.cos(h.a) * off, 0.15, h.z + Math.sin(h.a) * off, -h.a, h.hl * 0.6, 0.35, h.hw * 1.1);
            }
            this.hedgeMesh.instanceMatrix.needsUpdate = true;
        }
    }

    /* ─────────── Точки захвата ─────────── */
    buildPoints() {
        this.pointMeshes = [];
        for (const p of this.world.points) {
            const g = new THREE.Group();
            g.position.set(p.x, 0, p.z);
            const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, depthWrite: false });
            const ring = new THREE.Mesh(new THREE.RingGeometry(p.r - 0.7, p.r, 72), ringMat);
            ring.rotation.x = -Math.PI / 2;
            ring.position.y = 0.06;
            const discMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, depthWrite: false });
            const disc = new THREE.Mesh(new THREE.CircleGeometry(p.r - 0.7, 72), discMat);
            disc.rotation.x = -Math.PI / 2;
            disc.position.y = 0.05;
            const progMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide });
            const prog = new THREE.Mesh(new THREE.RingGeometry(p.r + 0.3, p.r + 1.2, 72, 1, 0, 0.001), progMat);
            prog.rotation.x = -Math.PI / 2;
            prog.position.y = 0.07;
            const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 7, 6), new THREE.MeshStandardMaterial({ color: 0x8b8b80 }));
            pole.position.y = 3.5;
            pole.castShadow = true;
            const flagMat = new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, roughness: 0.9 });
            const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.4, 6, 1), flagMat);
            flag.position.set(1.15, 6.2, 0);
            flag.castShadow = true;
            g.add(ring, disc, prog, pole, flag);
            this.group.add(g);
            this.pointMeshes.push({ p, ring, disc, prog, flag, ringMat, discMat, progMat, flagMat, lastProg: null });
        }
    }

    updatePoints(points, playerTeam, t) {
        if (!points) return;
        const ALLY = 0x4aa3ff, ENEMY = 0xff4a3d, NEUTRAL = 0xe8e2cf;
        for (const pm of this.pointMeshes) {
            const st = points.find((q) => q.id === pm.p.id);
            if (!st) continue;
            const owner = st.owner === undefined ? -1 : st.owner;
            const col = owner === -1 ? NEUTRAL : owner === playerTeam ? ALLY : ENEMY;
            pm.ringMat.color.setHex(col);
            pm.discMat.color.setHex(col);
            pm.flagMat.color.setHex(col);
            // прогресс захвата
            let prog = st.prog !== undefined ? st.prog : 0;
            if (st.cap !== undefined) prog = -st.cap;
            const frac = Math.abs(prog) / 100;
            const key = Math.round(frac * 100) * Math.sign(prog);
            if (key !== pm.lastProg) {
                pm.lastProg = key;
                pm.prog.geometry.dispose();
                pm.prog.geometry = new THREE.RingGeometry(pm.p.r + 0.3, pm.p.r + 1.2, 72, 1, Math.PI / 2, Math.max(0.001, frac * Math.PI * 2));
                const progTeam = prog > 0 ? 0 : 1;
                pm.progMat.color.setHex(frac < 0.01 ? NEUTRAL : progTeam === playerTeam ? ALLY : ENEMY);
            }
            // флаг колышется
            const pos = pm.flag.geometry.attributes.position;
            for (let i = 0; i < pos.count; i++) {
                const x = pos.getX(i);
                pos.setZ(i, Math.sin(t * 4 + x * 2.2) * 0.12 * (x + 1.1));
            }
            pos.needsUpdate = true;
        }
    }

    /* ─────────── Граница карты ─────────── */
    buildBorder() {
        const S = this.world.S, M = 300;
        const shape = new THREE.Shape([new THREE.Vector2(-M, -M), new THREE.Vector2(S + M, -M), new THREE.Vector2(S + M, S + M), new THREE.Vector2(-M, S + M)]);
        shape.holes.push(new THREE.Path([new THREE.Vector2(0, 0), new THREE.Vector2(0, S), new THREE.Vector2(S, S), new THREE.Vector2(S, 0)]));
        const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: 0x1a0f0c, transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide }));
        m.rotation.x = Math.PI / 2;
        m.position.y = 0.08;
        this.group.add(m);
        const lineGeo = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, 0.1, 0), new THREE.Vector3(S, 0.1, 0), new THREE.Vector3(S, 0.1, S), new THREE.Vector3(0, 0.1, S), new THREE.Vector3(0, 0.1, 0),
        ]);
        this.group.add(new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xff5040, transparent: true, opacity: 0.7 })));
    }

    dispose() {
        this.group.traverse((o) => {
            if (o.geometry) o.geometry.dispose();
            if (o.material) for (const m of [].concat(o.material)) m.dispose();
        });
        if (this.decalTex) this.decalTex.dispose();
    }
}
