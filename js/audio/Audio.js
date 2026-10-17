import { Settings } from "../core/Settings.js";
import { Events } from "../core/Events.js";
import { clamp, rnd, seeded } from "../core/Utils.js";

let AC = null;

function noiseBuffer(sec, kind = "white") {
    const n = Math.floor(AC.sampleRate * sec);
    const b = AC.createBuffer(1, n, AC.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
        const w = Math.random() * 2 - 1;
        if (kind === "brown") { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
        else d[i] = w;
    }
    return b;
}

function impulse(sec, decay) {
    const n = Math.floor(AC.sampleRate * sec);
    const b = AC.createBuffer(2, n, AC.sampleRate);
    for (let c = 0; c < 2; c++) {
        const d = b.getChannelData(c);
        for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay) * (i < 200 ? i / 200 : 1);
    }
    return b;
}

/* ─────────────────────── Голос экипажа ─────────────────────── */
class CrewVoice {
    constructor() {
        this.voice = null;
        this.busyUntil = 0;
        this.prio = 0;
        this.last = new Map();
        if (typeof speechSynthesis !== "undefined") {
            const pickV = () => {
                const vs = speechSynthesis.getVoices();
                this.voice = vs.find((v) => /ru/i.test(v.lang) && /male|pavel|dmitry|мужск/i.test(v.name)) || vs.find((v) => /ru/i.test(v.lang)) || null;
            };
            pickV();
            speechSynthesis.onvoiceschanged = pickV;
        }
    }
    say(text, prio = 1) {
        if (!Settings.get("voice") || !this.voice || typeof speechSynthesis === "undefined") return;
        const now = performance.now();
        if ((this.last.get(text) || 0) > now - 3500) return;
        if (now < this.busyUntil && prio <= this.prio) return;
        if (now < this.busyUntil) speechSynthesis.cancel();
        this.last.set(text, now);
        const u = new SpeechSynthesisUtterance(text);
        u.voice = this.voice;
        u.lang = this.voice.lang;
        u.rate = 1.25;
        u.pitch = 0.85;
        u.volume = clamp(Settings.get("master") * 0.9, 0, 1);
        this.prio = prio;
        this.busyUntil = now + 300 + text.length * 70;
        speechSynthesis.speak(u);
    }
}

/* ─────────────────────── Синтез петель двигателя и гусениц ─────────────────────── */
const ENGINE_REF_RPM = 1000;
const TRACK_HITS = 24;

/** ФНЧ второго порядка по кругу: петля без щелчка на стыке */
function lowpassLoop(d, sr, fc) {
    const w = Math.exp(-2 * Math.PI * fc / sr);
    for (let stage = 0; stage < 2; stage++) {
        let y = 0;
        for (let lap = 0; lap < 2; lap++) {
            for (let i = 0; i < d.length; i++) {
                y = (1 - w) * d[i] + w * y;
                if (lap === 1) d[i] = y;
            }
        }
    }
}

function finishLoop(d) {
    let mean = 0;
    for (let i = 0; i < d.length; i++) mean += d[i];
    mean /= d.length;
    let peak = 1e-6;
    for (let i = 0; i < d.length; i++) { d[i] -= mean; peak = Math.max(peak, Math.abs(d[i])); }
    for (let i = 0; i < d.length; i++) d[i] *= 0.9 / peak;
}

/**
 * Петля двигателя из отдельных вспышек в цилиндрах при ENGINE_REF_RPM:
 * каждая вспышка — низкий затухающий «удар» выхлопа + шум сгорания (у дизеля — жёсткий клёкот).
 * Разная сила цилиндров и дрожание момента вспышки дают неровный «живой» рокот.
 */
function synthEngine(sr, diesel, cyl, seed) {
    const rng = seeded(seed);
    const cycle = 120 / ENGINE_REF_RPM;
    const N = 20;
    const len = Math.round(N * cycle * sr);
    const d = new Float32Array(len);
    const fBody = diesel ? 82 : 96;
    const decB = diesel ? 42 : 52;
    const fRes = diesel ? 265 : 320;
    const plen = Math.round(sr * 5 / decB);
    const body = new Float32Array(plen);
    for (let i = 0; i < plen; i++) {
        const t = i / sr;
        body[i] = (Math.exp(-t * decB) * Math.sin(2 * Math.PI * fBody * t) + 0.38 * Math.exp(-t * 95) * Math.sin(2 * Math.PI * fRes * t)) * (1 - Math.exp(-t * 900));
    }
    const decN = diesel ? 480 : 850;
    const nlen = Math.round(sr * 6 / decN);
    const nenv = new Float32Array(nlen);
    for (let i = 0; i < nlen; i++) nenv[i] = Math.exp(-(i / sr) * decN);
    const nAmp = diesel ? 1.0 : 0.4;
    const cylAmp = Array.from({ length: cyl }, () => 0.68 + rng() * 0.5);
    for (let c = 0; c < N; c++) {
        for (let k = 0; k < cyl; k++) {
            const t0 = (c + k / cyl) * cycle + (rng() - 0.5) * 0.09 * cycle / cyl;
            const A = cylAmp[k] * (0.78 + rng() * 0.44);
            const i0 = Math.round(t0 * sr);
            for (let i = 0; i < plen; i++) d[(i0 + i) % len] += A * body[i];
            const na = A * nAmp * (0.5 + rng());
            for (let i = 0; i < nlen; i++) d[(i0 + i) % len] += na * (rng() * 2 - 1) * nenv[i];
        }
    }
    lowpassLoop(d, sr, diesel ? 1500 : 1200);
    finishLoop(d);
    const b = AC.createBuffer(1, len, sr);
    b.getChannelData(0).set(d);
    return b;
}

/** Петля лязга траков: TRACK_HITS ударов звена о каток в секунду при скорости воспроизведения 1 */
function synthTracks(sr, seed) {
    const rng = seeded(seed);
    const len = sr;
    const d = new Float32Array(len);
    const nl = Math.round(sr * 0.025), kl = Math.round(sr * 0.07);
    for (let h = 0; h < TRACK_HITS; h++) {
        const i0 = Math.round(((h + (rng() - 0.5) * 0.3) / TRACK_HITS) * len);
        const A = 0.6 + rng() * 0.6;
        const fk = 120 + rng() * 60;
        for (let i = 0; i < kl; i++) {
            const t = i / sr;
            let v = Math.sin(2 * Math.PI * fk * t) * Math.exp(-t * 75) * 0.8;
            if (i < nl) v += (rng() * 2 - 1) * Math.exp(-t * 260) * 0.7;
            d[((i0 + i) % len + len) % len] += A * v;
        }
    }
    lowpassLoop(d, sr, 1800);
    finishLoop(d);
    const b = AC.createBuffer(1, len, sr);
    b.getChannelData(0).set(d);
    return b;
}

/* ─────────────────────── Голос двигателя ─────────────────────── */
class EngineVoice {
    constructor(sys, def) {
        this.sys = sys;
        this.def = def;
        const e = def.engine;
        this.diesel = e.type === "diesel";
        this.rpm = e.idle;
        this.gear = 1;
        this.shiftT = 0;
        this.wob = 0;
        const t = AC.currentTime;

        this.out = AC.createGain();
        this.out.gain.value = 0;
        this.pan = AC.createStereoPanner();
        this.dist = AC.createBiquadFilter();
        this.dist.type = "lowpass";
        this.dist.frequency.value = 9000;
        this.out.connect(this.pan).connect(this.dist).connect(sys.engBus);

        // двигатель: петля вспышек, обороты = скорость воспроизведения
        this.eng = AC.createBufferSource();
        this.eng.buffer = sys.engineLoop(e);
        this.eng.loop = true;
        this.engLP = AC.createBiquadFilter(); this.engLP.type = "lowpass"; this.engLP.Q.value = 0.6;
        this.engG = AC.createGain(); this.engG.gain.value = 0;
        this.eng.connect(this.engLP).connect(this.engG).connect(this.out);
        // рёв выхлопа под нагрузкой
        this.ex = AC.createBufferSource(); this.ex.buffer = sys.noiseB; this.ex.loop = true;
        this.exLP = AC.createBiquadFilter(); this.exLP.type = "lowpass"; this.exLP.frequency.value = 240;
        this.exG = AC.createGain(); this.exG.gain.value = 0;
        this.ex.connect(this.exLP).connect(this.exG).connect(this.out);
        // гусеницы: лязг звеньев и низкий гул качения
        this.trk = AC.createBufferSource(); this.trk.buffer = sys.trackLoop(); this.trk.loop = true;
        this.trkG = AC.createGain(); this.trkG.gain.value = 0;
        this.trk.connect(this.trkG).connect(this.out);
        this.roll = AC.createBufferSource(); this.roll.buffer = sys.noiseB; this.roll.loop = true;
        this.rollLP = AC.createBiquadFilter(); this.rollLP.type = "lowpass"; this.rollLP.frequency.value = 220;
        this.rollG = AC.createGain(); this.rollG.gain.value = 0;
        this.roll.connect(this.rollLP).connect(this.rollG).connect(this.out);

        this.eng.start(t, Math.random() * this.eng.buffer.duration);
        this.ex.start(t, Math.random() * 2);
        this.trk.start(t, Math.random() * 0.9);
        this.roll.start(t, Math.random() * 2);
        this.alive = true;
    }

    update(v, dt, lx, lz, isPlayer) {
        const t = AC.currentTime;
        const e = this.def.engine;
        const vmax = this.def.mob.speed / 3.6;
        const s = clamp(Math.abs(v.v) / vmax, 0, 1);
        const thr = Math.min(1, Math.abs(v.input.throttle) + Math.abs(v.input.steer) * 0.6);
        const engOk = !v.dead && v.mods.engine.hp > 0;
        // коробка передач
        const gears = e.gears;
        const g = clamp(Math.floor(s * gears * 0.999) + 1, 1, gears);
        if (g !== this.gear) { this.shiftT = 0.2; this.gear = g; }
        this.shiftT = Math.max(0, this.shiftT - dt);
        const lo = (g - 1) / gears, hi = g / gears;
        const inGear = clamp((s - lo) / (hi - lo), 0, 1);
        let target = e.idle;
        if (engOk) {
            if (s > 0.02) target = e.idle + (e.max - e.idle) * (0.3 + 0.55 * inGear) * (0.85 + 0.15 * thr);
            else target = e.idle + (e.max - e.idle) * 0.35 * thr;
            if (this.shiftT > 0) target *= 0.8;
        }
        this.rpm += (target - this.rpm) * Math.min(1, dt * (target > this.rpm ? 3.5 : 2.5));
        const load = engOk ? clamp(0.2 + thr * 0.8, 0, 1) : 0;
        // лёгкое «плавание» оборотов, чтобы не было ровного тона
        this.wob += (Math.random() - 0.5) * dt * 0.6;
        this.wob *= Math.max(0, 1 - dt * 2);
        const rate = Math.pow(this.rpm / ENGINE_REF_RPM, 0.8) * (1 + this.wob * 0.05);
        this.eng.playbackRate.setTargetAtTime(Math.max(0.3, rate), t, 0.05);
        this.engLP.frequency.setTargetAtTime(420 + load * 950 + (this.rpm - e.idle) * 0.15, t, 0.08);
        let eg = engOk ? 0.42 + load * 0.5 : 0;
        if (engOk && v.mods.engine.hp < v.mods.engine.maxHp * 0.33 && Math.random() < dt * 6) eg *= 0.2;
        this.engG.gain.setTargetAtTime(eg, t, 0.06);
        this.exG.gain.setTargetAtTime(engOk ? load * 0.26 : 0, t, 0.1);
        this.exLP.frequency.setTargetAtTime(260 + load * 420, t, 0.1);
        // скорость движения ленты гусеницы (включая разворот на месте)
        const ts = Math.max(Math.abs(v.v), Math.abs(v.w) * this.def.dims.W / 2);
        this.trk.playbackRate.setTargetAtTime(clamp(ts / 0.17 / TRACK_HITS, 0.05, 3), t, 0.08);
        this.trkG.gain.setTargetAtTime(Math.min(1, ts / 3.5) * 0.42, t, 0.1);
        this.rollG.gain.setTargetAtTime(Math.min(1, ts / 9) * 0.55, t, 0.15);
        // пространство
        const d = isPlayer ? 0 : Math.hypot(v.x - lx, v.z - lz);
        const att = isPlayer ? 1 : 1 / (1 + Math.pow(d / 22, 1.35));
        this.out.gain.setTargetAtTime(att * (v.dead ? 0 : 1), t, 0.12);
        this.pan.pan.setTargetAtTime(isPlayer ? 0 : clamp((v.x - lx) / 70, -0.85, 0.85), t, 0.1);
        this.dist.frequency.setTargetAtTime(isPlayer ? 9000 : clamp(9000 * Math.exp(-d / 110), 400, 9000), t, 0.15);
    }

    stop() {
        if (!this.alive) return;
        this.alive = false;
        const t = AC.currentTime;
        this.out.gain.setTargetAtTime(0, t, 0.1);
        for (const n of [this.eng, this.ex, this.trk, this.roll]) { try { n.stop(t + 0.6); } catch (e) { /* */ } }
        setTimeout(() => this.out.disconnect(), 900);
    }
}

/* ─────────────────────── Аудиосистема ─────────────────────── */
export class AudioSys {
    constructor() {
        this.voices = new Map();
        this.lx = 0; this.lz = 0;
        this.voice = new CrewVoice();
        this.muted = false;
        Events.on("settings", () => this.applyVolumes());
    }

    /** ctx — необязательный внешний контекст (например, OfflineAudioContext для анализа звука) */
    init(ctx) {
        if (AC && !ctx) { if (AC.state === "suspended") AC.resume(); return; }
        try {
            AC = ctx || new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) { console.warn("Нет Web Audio", e); return; }
        this.loops = null;
        this.comp = AC.createDynamicsCompressor();
        this.comp.threshold.value = -14; this.comp.knee.value = 10; this.comp.ratio.value = 5;
        this.comp.attack.value = 0.003; this.comp.release.value = 0.25;
        this.master = AC.createGain();
        this.duck = AC.createGain();
        this.master.connect(this.comp).connect(AC.destination);
        this.duck.connect(this.master);
        this.sfxBus = AC.createGain(); this.sfxBus.connect(this.duck);
        this.engBus = AC.createGain(); this.engBus.connect(this.duck);
        this.uiBus = AC.createGain(); this.uiBus.connect(this.master);
        this.reverb = AC.createConvolver();
        this.reverb.buffer = impulse(2.2, 3.2);
        this.revSend = AC.createGain(); this.revSend.gain.value = 0.6;
        this.revSend.connect(this.reverb).connect(this.duck);
        this.noiseW = noiseBuffer(2.5, "white");
        this.noiseB = noiseBuffer(3, "brown");
        this.noiseShort = noiseBuffer(3.6, "white");
        // эфир: ветер
        const wind = AC.createBufferSource(); wind.buffer = this.noiseB; wind.loop = true;
        const wf = AC.createBiquadFilter(); wf.type = "lowpass"; wf.frequency.value = 420;
        this.windGain = AC.createGain(); this.windGain.gain.value = 0;
        const lfo = AC.createOscillator(); lfo.frequency.value = 0.13;
        const lg = AC.createGain(); lg.gain.value = 0.025;
        lfo.connect(lg).connect(this.windGain.gain);
        wind.connect(wf).connect(this.windGain).connect(this.duck);
        wind.start(); lfo.start();
        // огонь в машине игрока
        const fire = AC.createBufferSource(); fire.buffer = this.noiseW; fire.loop = true;
        const ff = AC.createBiquadFilter(); ff.type = "bandpass"; ff.frequency.value = 1400; ff.Q.value = 0.5;
        this.fireGain = AC.createGain(); this.fireGain.gain.value = 0;
        fire.connect(ff).connect(this.fireGain).connect(this.sfxBus);
        fire.start();
        this.applyVolumes();
    }

    get ready() { return !!AC; }

    engineLoop(e) {
        this.loops = this.loops || {};
        const key = e.type + e.cyl;
        if (!this.loops[key]) this.loops[key] = synthEngine(AC.sampleRate, e.type === "diesel", e.cyl, e.cyl * 7 + (e.type === "diesel" ? 1 : 2));
        return this.loops[key];
    }

    trackLoop() {
        this.loops = this.loops || {};
        if (!this.loops.tracks) this.loops.tracks = synthTracks(AC.sampleRate, 31);
        return this.loops.tracks;
    }

    applyVolumes() {
        if (!AC) return;
        const m = this.muted ? 0 : Settings.get("master");
        this.master.gain.setTargetAtTime(m, AC.currentTime, 0.05);
        this.sfxBus.gain.value = Settings.get("sfx");
        this.engBus.gain.value = Settings.get("engine") * 0.8;
        this.uiBus.gain.value = 0.6;
    }

    toggleMute() { this.muted = !this.muted; this.applyVolumes(); return this.muted; }

    setListener(x, z) { this.lx = x; this.lz = z; }

    /** Пространственная цепочка для одноразового звука */
    chain(x, z, vol, isLocal) {
        const d = isLocal ? 0 : Math.hypot(x - this.lx, z - this.lz);
        const g = AC.createGain();
        g.gain.value = vol * (isLocal ? 1 : 1 / (1 + Math.pow(d / 26, 1.3)));
        const lp = AC.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = isLocal ? 18000 : clamp(18000 * Math.exp(-d / 150), 450, 18000);
        const pan = AC.createStereoPanner();
        pan.pan.value = isLocal ? 0 : clamp((x - this.lx) / 70, -0.9, 0.9);
        g.connect(lp).connect(pan);
        pan.connect(this.sfxBus);
        const send = AC.createGain();
        send.gain.value = isLocal ? 0.12 : clamp(0.1 + d / 300, 0.1, 0.55);
        pan.connect(send).connect(this.revSend);
        const delay = !isLocal && d > 35 ? Math.min(1.0, d / 343) : 0;
        return { in: g, t: AC.currentTime + delay + 0.005, d };
    }

    burst(dest, t, dur, type, f0, f1, q, gain, decay) {
        const s = AC.createBufferSource();
        s.buffer = this.noiseShort;
        const f = AC.createBiquadFilter();
        f.type = type;
        f.frequency.setValueAtTime(f0, t);
        if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
        f.Q.value = q;
        const g = AC.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0008, t + (decay || dur));
        s.connect(f).connect(g).connect(dest);
        s.start(t, Math.random() * 0.3);
        s.stop(t + (decay || dur) + 0.05);
    }

    tone(dest, t, type, f0, f1, dur, gain, decay) {
        const o = AC.createOscillator();
        o.type = type;
        o.frequency.setValueAtTime(f0, t);
        if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t + dur);
        const g = AC.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0006, t + (decay || dur));
        o.connect(g).connect(dest);
        o.start(t);
        o.stop(t + (decay || dur) + 0.05);
    }

    /** Тяжёлый короткий удар металла: шумовое тело + глухой низ, без звенящего хвоста */
    clunk(dest, t, f, gain, decay) {
        this.burst(dest, t, decay, "bandpass", f, f * 0.7, 1.1, gain, decay);
        this.tone(dest, t, "sine", f * 0.25, f * 0.14, decay * 1.2, gain * 0.4, decay * 1.3);
    }

    /** Несколько коротких негармонических призвуков — «железо», но не колокол */
    grit(dest, t, fLo, fHi, n, gain, decay) {
        for (let i = 0; i < n; i++) {
            const f = rnd(fLo, fHi);
            this.tone(dest, t, "triangle", f, f * 0.92, decay, gain / n, decay * rnd(0.6, 1));
        }
    }

    /* ─────────── Выстрелы и попадания ─────────── */
    shot(def, x, z, isPlayer) {
        if (!AC) return;
        const cal = def.cal;
        const c = this.chain(x, z, isPlayer ? 1 : 0.9, isPlayer);
        const t = c.t;
        const big = clamp((cal - 20) / 130, 0, 1);
        if (cal < 30) {
            this.burst(c.in, t, 0.06, "bandpass", 2600, 1800, 0.9, 0.5, 0.07);
            this.burst(c.in, t, 0.12, "lowpass", 1600, 300, 0.7, 0.35, 0.14);
            this.tone(c.in, t, "sine", 120, 60, 0.08, 0.25, 0.1);
            return;
        }
        this.burst(c.in, t, 0.05, "bandpass", 2400 - big * 900, 1400, 0.8, 0.9, 0.08);
        this.burst(c.in, t, 0.35 + big * 0.5, "lowpass", 2000 - big * 600, 90, 0.7, 0.85, 0.55 + big * 0.9);
        this.tone(c.in, t, "sine", 105 - big * 45, 32, 0.25 + big * 0.2, 0.9, 0.38 + big * 0.35);
        this.tone(c.in, t + 0.01, "triangle", 62 - big * 20, 28, 0.4, 0.45, 0.5 + big * 0.4);
        if (isPlayer) {
            // лязг затвора и гильзы
            const tb = t + 0.32 + rnd(0, 0.05);
            this.clunk(this.sfxBus, tb, 1100, 0.09, 0.06);
            this.burst(this.sfxBus, tb + 0.05, 0.02, "highpass", 2600, 2600, 0.7, 0.05, 0.03);
            this.duckFor(0.12, 0.55);
        }
    }

    impact(kind, x, z, cal, local) {
        if (!AC) return;
        const c = this.chain(x, z, local ? 0.8 : 0.7, false);
        const t = c.t;
        const k = clamp(cal / 100, 0.3, 1.5);
        if (kind === "rico") {
            this.burst(c.in, t, 0.02, "highpass", 2500, 2500, 0.7, 0.4, 0.03);
            const o = AC.createOscillator(); o.type = "triangle";
            o.frequency.setValueAtTime(rnd(2200, 2900), t);
            o.frequency.exponentialRampToValueAtTime(rnd(500, 800), t + 0.42);
            const vib = AC.createOscillator(); vib.frequency.value = rnd(25, 40);
            const vg = AC.createGain(); vg.gain.value = 60;
            vib.connect(vg).connect(o.frequency);
            const g = AC.createGain();
            g.gain.setValueAtTime(0.0001, t);
            g.gain.exponentialRampToValueAtTime(0.16, t + 0.02);
            g.gain.exponentialRampToValueAtTime(0.0008, t + 0.5);
            o.connect(g).connect(c.in);
            o.start(t); vib.start(t); o.stop(t + 0.55); vib.stop(t + 0.55);
        } else if (kind === "nopen") {
            // броня выдержала: сухой треск, тяжёлый удар и глухой низ
            this.burst(c.in, t, 0.012, "highpass", 2400, 2400, 0.7, 0.2, 0.016);
            this.burst(c.in, t, 0.12, "bandpass", rnd(760, 900) / Math.sqrt(k), 480, 1.0, 1.0, 0.1 + k * 0.03);
            this.grit(c.in, t, 340, 1400, 4, 0.34, 0.09 + k * 0.02);
            this.tone(c.in, t, "sine", 130, 60, 0.14, 0.32, 0.16);
        } else if (kind === "pen") {
            this.burst(c.in, t, 0.012, "highpass", 2400, 2400, 0.7, 0.18, 0.016);
            this.burst(c.in, t, 0.12, "bandpass", 1050, 400, 0.8, 1.0, 0.16);
            this.clunk(c.in, t, 520, 0.45, 0.12);
            this.tone(c.in, t, "sine", 90, 40, 0.2, 0.32, 0.24);
        } else if (kind === "ground") {
            this.burst(c.in, t, 0.18, "lowpass", 900, 200, 0.7, 0.35, 0.22);
        } else if (kind === "building" || kind === "rock") {
            this.burst(c.in, t, 0.14, "bandpass", 1100, 600, 0.9, 0.45, 0.2);
            this.burst(c.in, t + 0.03, 0.25, "lowpass", 600, 150, 0.7, 0.25, 0.3);
        }
    }

    explosion(x, z, size) {
        if (!AC) return;
        const c = this.chain(x, z, 1, false);
        const t = c.t;
        const k = clamp(size, 0.5, 3);
        this.burst(c.in, t, 0.9 + k * 0.4, "lowpass", 2600, 70, 0.6, 0.9, 1.0 + k * 0.5);
        this.tone(c.in, t, "sine", 70, 24, 0.6 + k * 0.2, 0.8, 0.8 + k * 0.3);
        this.burst(c.in, t, 0.05, "bandpass", 1800, 1200, 0.8, 0.6, 0.07);
        // треск обломков
        for (let i = 0; i < 6 * k; i++) this.burst(c.in, t + 0.1 + Math.random() * (0.5 + k * 0.3), 0.03, "bandpass", rnd(1500, 3500), 1000, 2, 0.06, 0.05);
    }

    detonation(x, z) {
        if (!AC) return;
        this.explosion(x, z, 3);
        const c = this.chain(x, z, 0.8, false);
        this.explosion(x + 1, z, 1.8);
        for (let i = 0; i < 8; i++) this.burst(c.in, c.t + 0.4 + Math.random() * 2.2, 0.08, "lowpass", 1400, 300, 0.7, 0.3, 0.2);
    }

    /** Попадание по машине игрока — звук изнутри */
    playerHit(kind, cal) {
        if (!AC) return;
        const t = AC.currentTime + 0.005;
        const k = clamp(cal / 90, 0.4, 1.6);
        const lp = AC.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1800;
        lp.connect(this.sfxBus);
        if (kind === "rico") {
            this.clunk(lp, t, 1000, 0.5, 0.09);
            this.grit(lp, t, 600, 1400, 2, 0.08, 0.12);
        } else {
            // удар по своей броне изнутри: тяжёлый глухой «бум» корпуса
            this.burst(lp, t, 0.2, "lowpass", 1500, 220, 0.7, 1.0, 0.24);
            this.burst(lp, t, 0.06, "bandpass", 700, 450, 1.0, 0.6, 0.07);
            this.tone(lp, t, "sine", 95 / Math.sqrt(k), 42, 0.28, 0.55, 0.32);
            this.grit(lp, t, 260, 760, 3, 0.26, 0.16);
        }
        if (kind === "pen" || kind === "he-pen") {
            this.duckFor(1.4, 0.18);
            this.tone(this.uiBus, t + 0.05, "sine", 3650, 3600, 2.6, 0.05, 2.6);
        }
    }

    duckFor(dur, level) {
        const t = AC.currentTime;
        this.duck.gain.cancelScheduledValues(t);
        this.duck.gain.setValueAtTime(level, t + 0.01);
        this.duck.gain.linearRampToValueAtTime(1, t + dur);
    }

    /** Свист падающего снаряда */
    whistle(x, z) {
        if (!AC) return;
        const d = Math.hypot(x - this.lx, z - this.lz);
        const g = AC.createGain();
        g.gain.value = 1 / (1 + Math.pow(d / 40, 1.2));
        const pan = AC.createStereoPanner();
        pan.pan.value = clamp((x - this.lx) / 70, -0.9, 0.9);
        g.connect(pan).connect(this.sfxBus);
        const t = AC.currentTime;
        this.tone(g, t, "sine", rnd(1500, 2200), rnd(450, 650), 0.34, 0.07, 0.36);
    }

    /** Радиосвязь: шипение и щелчок */
    radio() {
        if (!AC) return;
        const t = AC.currentTime;
        this.burst(this.uiBus, t, 0.18, "bandpass", 2200, 1800, 2, 0.08, 0.2);
        this.tone(this.uiBus, t + 0.2, "square", 1400, 1400, 0.03, 0.04, 0.04);
    }

    reloadDone() {
        if (!AC) return;
        const t = AC.currentTime;
        // затвор закрылся: двойной механический лязг
        this.burst(this.sfxBus, t, 0.02, "highpass", 2400, 2400, 0.7, 0.08, 0.03);
        this.clunk(this.sfxBus, t + 0.05, 1300, 0.16, 0.05);
        this.clunk(this.sfxBus, t + 0.13, 850, 0.2, 0.07);
    }

    trackBreak() {
        if (!AC) return;
        const t = AC.currentTime;
        this.clunk(this.sfxBus, t, 520, 0.45, 0.14);
        for (let i = 0; i < 6; i++) this.clunk(this.sfxBus, t + 0.09 + i * rnd(0.05, 0.09), rnd(900, 1500), 0.12, 0.04);
    }

    extinguisher() {
        if (!AC) return;
        const t = AC.currentTime;
        this.burst(this.sfxBus, t, 1.4, "highpass", 3500, 2000, 0.6, 0.25, 1.5);
    }

    repairTick() {
        if (!AC) return;
        const t = AC.currentTime;
        this.burst(this.sfxBus, t, 0.015, "highpass", 3000, 3000, 0.7, 0.05, 0.02);
        this.clunk(this.sfxBus, t + 0.02, rnd(1400, 2000), 0.06, 0.04);
    }

    ui(kind = "click") {
        if (!AC) return;
        const t = AC.currentTime;
        if (kind === "click") this.tone(this.uiBus, t, "square", 1200, 900, 0.04, 0.05, 0.05);
        else if (kind === "hover") this.tone(this.uiBus, t, "sine", 1800, 1800, 0.02, 0.02, 0.03);
        else if (kind === "good") { this.tone(this.uiBus, t, "triangle", 660, 660, 0.1, 0.08, 0.12); this.tone(this.uiBus, t + 0.09, "triangle", 990, 990, 0.14, 0.08, 0.18); }
        else if (kind === "bad") this.tone(this.uiBus, t, "sawtooth", 220, 150, 0.25, 0.06, 0.3);
        else if (kind === "cap") { for (let i = 0; i < 3; i++) this.tone(this.uiBus, t + i * 0.1, "triangle", 520 * (1 + i * 0.25), 520 * (1 + i * 0.25), 0.1, 0.07, 0.14); }
    }

    /* ─────────── Двигатели ─────────── */
    updateEngines(battle, dt, listenerX, listenerZ) {
        if (!AC) return;
        this.lx = listenerX; this.lz = listenerZ;
        const p = battle.player;
        const near = battle.vehicles
            .filter((v) => !v.dead && !v.static && (v === p || v.team === battle.playerTeam || v.visible[battle.playerTeam]))
            .map((v) => ({ v, d: v === p ? -1 : Math.hypot(v.x - listenerX, v.z - listenerZ) }))
            .filter((o) => o.d < 120)
            .sort((a, b) => a.d - b.d)
            .slice(0, 4);
        const keep = new Set(near.map((o) => o.v.id));
        for (const [id, ev] of this.voices) {
            if (!keep.has(id)) { ev.stop(); this.voices.delete(id); }
        }
        for (const o of near) {
            let ev = this.voices.get(o.v.id);
            if (!ev) { ev = new EngineVoice(this, o.v.def); this.voices.set(o.v.id, ev); }
            ev.update(o.v, dt, listenerX, listenerZ, o.v === p);
        }
        const t = AC.currentTime;
        this.windGain.gain.setTargetAtTime(0.05, t, 1);
        this.fireGain.gain.setTargetAtTime(p && !p.dead && p.fire ? 0.12 : 0, t, 0.2);
    }

    stopEngines() {
        for (const [, ev] of this.voices) ev.stop();
        this.voices.clear();
        if (AC) {
            this.windGain.gain.setTargetAtTime(0, AC.currentTime, 0.3);
            this.fireGain.gain.setTargetAtTime(0, AC.currentTime, 0.1);
        }
    }

    say(text, prio) { this.voice.say(text, prio); }
}
