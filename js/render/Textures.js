import * as THREE from "three";
import { mkCanvas, seeded } from "../core/Utils.js";

const cache = new Map();

function tex(canvas, repeat = true, srgb = true) {
    const t = new THREE.CanvasTexture(canvas);
    if (repeat) { t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping; }
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    t.needsUpdate = true;
    return t;
}

function blob(g, r, x, y, rad, col) {
    g.fillStyle = col;
    g.beginPath();
    const n = 9;
    for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2;
        const rr = rad * (0.6 + r() * 0.6);
        const px = x + Math.cos(a) * rr * 1.4, py = y + Math.sin(a) * rr * 0.8;
        i ? g.lineTo(px, py) : g.moveTo(px, py);
    }
    g.closePath();
    g.fill();
}

/** Камуфляж: 4БО (СССР), панцерграу, дункельгельб с пятнами; зимой — побелка */
export function camoTexture(paint, biome) {
    const key = "camo:" + paint + ":" + biome;
    if (cache.has(key)) return cache.get(key);
    const S = 256;
    const c = mkCanvas(S, S), g = c.getContext("2d");
    const r = seeded(paint.length * 977 + biome.length * 31);
    const base = { "4bo": "#4f5b33", grey: "#4d5357", yellow: "#a99662" }[paint] || "#55603a";
    g.fillStyle = base;
    g.fillRect(0, 0, S, S);
    // шум
    for (let i = 0; i < 1800; i++) {
        g.fillStyle = `rgba(${r() < 0.5 ? "0,0,0" : "255,255,255"},${0.03 + r() * 0.04})`;
        g.fillRect(r() * S, r() * S, 1 + r() * 3, 1 + r() * 3);
    }
    if (paint === "yellow") {
        for (let i = 0; i < 9; i++) blob(g, r, r() * S, r() * S, 14 + r() * 18, r() < 0.5 ? "#5d6a3c" : "#6d4f34");
    }
    if (paint === "4bo" && biome === "desert") {
        for (let i = 0; i < 6; i++) blob(g, r, r() * S, r() * S, 16 + r() * 18, "#8a7a52");
    }
    if (paint === "grey" && biome === "desert") {
        g.fillStyle = "rgba(170,150,100,.55)";
        g.fillRect(0, 0, S, S);
    }
    if (biome === "winter") {
        // побелка поверх, с проплешинами базового цвета
        g.globalAlpha = 0.86;
        for (let i = 0; i < 26; i++) blob(g, r, r() * S, r() * S, 26 + r() * 30, "#dfe3e2");
        g.globalAlpha = 1;
        for (let i = 0; i < 400; i++) {
            g.fillStyle = `rgba(230,234,232,${0.2 + r() * 0.3})`;
            g.fillRect(r() * S, r() * S, 2 + r() * 6, 1 + r() * 3);
        }
    }
    // потёки и грязь
    for (let i = 0; i < 40; i++) {
        g.fillStyle = `rgba(40,32,20,${0.04 + r() * 0.06})`;
        g.fillRect(r() * S, r() * S, 1 + r() * 2, 8 + r() * 30);
    }
    const t = tex(c);
    t.repeat.set(0.3, 0.3);
    cache.set(key, t);
    return t;
}

/** Траки гусеницы (вид сверху) */
export function trackTexture() {
    const key = "track";
    if (cache.has(key)) return cache.get(key);
    const c = mkCanvas(64, 32), g = c.getContext("2d");
    g.fillStyle = "#26251f";
    g.fillRect(0, 0, 64, 32);
    for (let i = 0; i < 4; i++) {
        const x = i * 16;
        g.fillStyle = "#3b3a32";
        g.fillRect(x + 1, 2, 13, 28);
        g.fillStyle = "#4c4a40";
        g.fillRect(x + 3, 4, 3, 24);
        g.fillStyle = "#1a1915";
        g.fillRect(x + 14, 0, 2, 32);
    }
    const t = tex(c);
    cache.set(key, t);
    return t;
}

/**
 * Борт ходовой части в масштабе 1:1 (для круглых катков): ведущее колесо, ленивец,
 * опорные катки по типу подвески и поддерживающие ролики.
 * Координаты текстуры: u = x / Lt + 0.5, v = y / th.
 */
export function runningGearTexture(def, Lt, Lb, rS) {
    const key = "gear:" + def.id;
    if (cache.has(key)) return cache.get(key);
    const th = def.dims.th;
    const W = 1024, H = Math.max(64, Math.round(W * th / Lt));
    const c = mkCanvas(W, H), g = c.getContext("2d");
    const k = W / Lt;
    const X = (x) => (x / Lt + 0.5) * W, Y = (y) => (1 - y / th) * H, R = (r) => r * k;
    const cy = th - rS;
    const cxF = Lt / 2 - rS, cxR = -Lt / 2 + rS;
    // внутренняя часть ходовой
    g.fillStyle = "#1c1b17";
    g.fillRect(0, 0, W, H);
    // лента гусеницы по контуру
    g.lineJoin = "round";
    g.strokeStyle = "#34332b";
    g.lineWidth = R(0.085);
    g.beginPath();
    const a0 = -1.05;
    g.moveTo(X(-Lb / 2), Y(0.04));
    g.lineTo(X(Lb / 2), Y(0.04));
    g.lineTo(X(cxF + rS * Math.cos(a0) * 0.95), Y(cy + rS * Math.sin(a0) * 0.95));
    g.arc(X(cxF), Y(cy), R(rS * 0.95), -a0, -Math.PI / 2, true);
    g.lineTo(X(cxR), Y(th - 0.04));
    g.arc(X(cxR), Y(cy), R(rS * 0.95), -Math.PI / 2, -(Math.PI - a0), true);
    g.closePath();
    g.stroke();
    const wheel = (x, y, r, kind, shade = 1) => {
        const px = X(x), py = Y(y), pr = R(r);
        g.fillStyle = "#151512";
        g.beginPath(); g.arc(px, py, pr, 0, 6.283); g.fill();
        const col = Math.round(72 * shade);
        g.fillStyle = `rgb(${col},${col},${Math.round(col * 0.85)})`;
        g.beginPath(); g.arc(px, py, pr * (kind === "steel" ? 0.95 : 0.84), 0, 6.283); g.fill();
        g.strokeStyle = "rgba(0,0,0,.35)";
        g.lineWidth = Math.max(1, pr * 0.06);
        g.beginPath(); g.arc(px, py, pr * 0.62, 0, 6.283); g.stroke();
        if (kind === "holes") {
            g.fillStyle = "#24231e";
            for (let i = 0; i < 6; i++) { const a = i / 6 * 6.283; g.beginPath(); g.arc(px + Math.cos(a) * pr * 0.42, py + Math.sin(a) * pr * 0.42, pr * 0.1, 0, 6.283); g.fill(); }
        }
        g.fillStyle = "#2b2a24";
        g.beginPath(); g.arc(px, py, pr * 0.22, 0, 6.283); g.fill();
    };
    const sus = def.susp;
    const n = sus.wheels;
    const rw = th * ({ christie: 0.47, kv: 0.33, interleaved: 0.44, small: n >= 8 ? 0.26 : n === 5 ? 0.36 : 0.31 }[sus.type] || 0.3);
    const x0 = -Lb / 2 + rw * 0.55, x1 = Lb / 2 - rw * 0.55;
    const pos = Array.from({ length: n }, (_, i) => x0 + (x1 - x0) * (n === 1 ? 0.5 : i / (n - 1)));
    const wy = rw + 0.06;
    if (sus.type === "interleaved") {
        const step = (x1 - x0) / (n - 1);
        for (const x of pos.slice(0, -1)) wheel(x + step / 2, wy + 0.01, rw, "steel", 0.72);
        for (const x of pos) wheel(x, wy, rw, "steel", 1);
    } else {
        for (const x of pos) wheel(x, wy, rw, sus.type === "christie" ? "holes" : "rubber", 1);
    }
    // поддерживающие ролики
    if (sus.type === "kv" || (sus.type === "small" && n >= 6)) {
        const m = sus.type === "kv" ? 3 : 4;
        const rr = th * 0.09;
        for (let i = 0; i < m; i++) {
            const x = -Lt * 0.3 + (Lt * 0.6) * (i / (m - 1));
            wheel(x, th - 0.075 - rr, rr, "rubber", 0.9);
        }
    }
    // ведущее колесо (звёздочка) и ленивец
    const drive = sus.driveFront ? cxF : cxR, idler = sus.driveFront ? cxR : cxF;
    const sx = X(drive), sy = Y(cy), sr = R(rS * 0.82);
    g.fillStyle = "#3f3e35";
    g.beginPath();
    const teeth = 13;
    for (let i = 0; i < teeth * 2; i++) {
        const a = i / (teeth * 2) * 6.283, rr = i % 2 ? sr * 0.86 : sr;
        i ? g.lineTo(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr) : g.moveTo(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr);
    }
    g.closePath(); g.fill();
    g.fillStyle = "#2a2923";
    g.beginPath(); g.arc(sx, sy, sr * 0.55, 0, 6.283); g.fill();
    g.fillStyle = "#4a493f";
    g.beginPath(); g.arc(sx, sy, sr * 0.2, 0, 6.283); g.fill();
    wheel(idler, cy, rS * 0.78, "steel", 0.85);
    const t = tex(c, false);
    cache.set(key, t);
    return t;
}

/** Плитка земли для биома */
export function groundTexture(biome) {
    const key = "ground:" + biome.name;
    if (cache.has(key)) return cache.get(key);
    const S = 512;
    const c = mkCanvas(S, S), g = c.getContext("2d");
    const r = seeded(4242 + biome.name.length);
    g.fillStyle = biome.ground[0];
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 70; i++) {
        g.fillStyle = biome.ground[1 + (i % (biome.ground.length - 1))];
        g.globalAlpha = 0.35;
        g.beginPath();
        g.ellipse(r() * S, r() * S, 30 + r() * 80, 20 + r() * 50, r() * 6.28, 0, 6.283);
        g.fill();
    }
    g.globalAlpha = 1;
    for (let i = 0; i < 9000; i++) {
        g.fillStyle = biome.ground[i % biome.ground.length];
        g.globalAlpha = 0.5 + r() * 0.5;
        const s = 1 + r() * 2.5;
        g.fillRect(r() * S, r() * S, s, s * (biome.name === "Лето" ? 2.2 : 1));
    }
    g.globalAlpha = 1;
    for (let i = 0; i < 500; i++) {
        g.fillStyle = `rgba(0,0,0,${r() * 0.08})`;
        g.fillRect(r() * S, r() * S, 2 + r() * 4, 2 + r() * 4);
    }
    const t = tex(c);
    t.repeat.set(1, 1);
    cache.set(key, t);
    return t;
}

/** Мягкая круглая частица */
export function softTexture() {
    if (cache.has("soft")) return cache.get("soft");
    const c = mkCanvas(64, 64), g = c.getContext("2d");
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, "rgba(255,255,255,1)");
    gr.addColorStop(0.35, "rgba(255,255,255,.65)");
    gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    const t = tex(c, false, false);
    cache.set("soft", t);
    return t;
}

/** Клуб дыма с шумом */
export function smokeTexture() {
    if (cache.has("smoke")) return cache.get("smoke");
    const S = 128;
    const c = mkCanvas(S, S), g = c.getContext("2d");
    const r = seeded(99);
    for (let i = 0; i < 26; i++) {
        const x = S / 2 + (r() - 0.5) * S * 0.45, y = S / 2 + (r() - 0.5) * S * 0.45;
        const rad = S * (0.16 + r() * 0.2);
        const gr = g.createRadialGradient(x, y, 0, x, y, rad);
        gr.addColorStop(0, "rgba(255,255,255,.35)");
        gr.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = gr;
        g.beginPath(); g.arc(x, y, rad, 0, 6.283); g.fill();
    }
    const t = tex(c, false, false);
    cache.set("smoke", t);
    return t;
}

/** Воронка / подпалина */
export function scorchTexture() {
    if (cache.has("scorch")) return cache.get("scorch");
    const S = 128;
    const c = mkCanvas(S, S), g = c.getContext("2d");
    const r = seeded(7);
    const gr = g.createRadialGradient(S / 2, S / 2, 4, S / 2, S / 2, S / 2);
    gr.addColorStop(0, "rgba(10,8,6,.95)");
    gr.addColorStop(0.45, "rgba(25,20,14,.75)");
    gr.addColorStop(1, "rgba(30,25,18,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 40; i++) {
        const a = r() * 6.28, d = S * (0.2 + r() * 0.28);
        g.fillStyle = `rgba(20,16,10,${0.2 + r() * 0.3})`;
        g.beginPath(); g.arc(S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d, 2 + r() * 5, 0, 6.283); g.fill();
    }
    const t = tex(c, false, false);
    cache.set("scorch", t);
    return t;
}

/** Черепица/кровля */
export function roofTexture() {
    if (cache.has("roof")) return cache.get("roof");
    const c = mkCanvas(64, 64), g = c.getContext("2d");
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, 64, 64);
    for (let y = 0; y < 64; y += 8) {
        g.fillStyle = "rgba(0,0,0,.18)";
        g.fillRect(0, y, 64, 2);
        for (let x = (y / 8) % 2 ? 0 : 6; x < 64; x += 12) {
            g.fillStyle = "rgba(0,0,0,.08)";
            g.fillRect(x, y, 2, 8);
        }
    }
    const t = tex(c, true, true);
    cache.set("roof", t);
    return t;
}

export { tex as canvasTexture };
