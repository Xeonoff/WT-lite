import { G } from "./state.js";
import { clamp } from "./utils.js";

let AC = null;
let master = null;
let muted = false;
let engOsc = null;
let engGain = null;
let engFilt = null;
let nzShort = null;

function nzBuf(sec) {
  const b = AC.createBuffer(1, AC.sampleRate * sec, AC.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

export function initAudio() {
  if (AC) return;
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    master = AC.createGain();
    master.gain.value = 0.5;
    master.connect(AC.destination);

    engOsc = AC.createOscillator();
    engOsc.type = "sawtooth";
    const o2 = AC.createOscillator();
    o2.type = "sawtooth";

    engFilt = AC.createBiquadFilter();
    engFilt.type = "lowpass";
    engFilt.frequency.value = 110;
    engFilt.Q.value = 0.5;
    const f2 = AC.createBiquadFilter();
    f2.type = "lowpass";
    f2.frequency.value = 330;
    f2.Q.value = 0.4;

    engGain = AC.createGain();
    engGain.gain.value = 0;
    const g2 = AC.createGain();
    g2.gain.value = 0.65;

    engOsc.connect(engFilt);
    o2.connect(g2);
    g2.connect(engFilt);
    engFilt.connect(f2);
    f2.connect(engGain);
    engGain.connect(master);

    const lfo = AC.createOscillator();
    lfo.type = "square";
    lfo.frequency.value = 9;
    const lfoG = AC.createGain();
    lfoG.gain.value = 0.022;
    lfo.connect(lfoG);
    lfoG.connect(engGain.gain);

    engOsc.start();
    o2.start();
    lfo.start();
    engOsc._o2 = o2;
    engOsc._lfo = lfo;
  } catch (e) {
    console.warn("Audio init failed:", e);
  }
}

export function sfx(type, vol = 1, pitch = 1) {
  if (!AC || muted) return;
  vol = clamp(vol, 0, 1);
  const t = AC.currentTime;
  const g = AC.createGain();
  g.connect(master);

  if (type === "shoot") {
    nzShort = nzShort || nzBuf(0.3);
    const s = AC.createBufferSource();
    s.buffer = nzShort;
    const f = AC.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(1600 * pitch, t);
    f.frequency.exponentialRampToValueAtTime(120, t + 0.25);
    s.connect(f);
    f.connect(g);
    g.gain.setValueAtTime(0.5 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    s.start(t);

    const o = AC.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(120 * pitch, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.22);
    const g2 = AC.createGain();
    g2.gain.setValueAtTime(0.55 * vol, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(g2);
    g2.connect(master);
    o.start(t);
    o.stop(t + 0.3);
  } else if (type === "ping") {
    const o = AC.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(2400 * pitch, t);
    o.frequency.exponentialRampToValueAtTime(900, t + 0.16);
    g.gain.setValueAtTime(0.22 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(g);
    o.start(t);
    o.stop(t + 0.25);
  } else if (type === "thud") {
    const o = AC.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.12);
    g.gain.setValueAtTime(0.4 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    o.connect(g);
    o.start(t);
    o.stop(t + 0.2);
  } else if (type === "pen") {
    sfx("thud", vol * 0.9);
    const o = AC.createOscillator();
    o.type = "square";
    o.frequency.setValueAtTime(620 * pitch, t);
    o.frequency.exponentialRampToValueAtTime(220, t + 0.1);
    const gg = AC.createGain();
    gg.gain.setValueAtTime(0.1 * vol, t);
    gg.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(gg);
    gg.connect(master);
    o.start(t);
    o.stop(t + 0.14);
  } else if (type === "boom" || type === "det") {
    const big = AC.createBufferSource();
    big.buffer = AC.createBuffer(1, AC.sampleRate * 1.2, AC.sampleRate);
    const d = big.buffer.getChannelData(0);
    for (let i = 0; i < d.length; i++)
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 1.6);
    const f = AC.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(type === "det" ? 2600 : 1400, t);
    f.frequency.exponentialRampToValueAtTime(70, t + 1);
    big.connect(f);
    f.connect(g);
    g.gain.setValueAtTime((type === "det" ? 0.9 : 0.7) * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
    big.start(t);

    const o = AC.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(type === "det" ? 90 : 65, t);
    o.frequency.exponentialRampToValueAtTime(24, t + 0.7);
    const g2 = AC.createGain();
    g2.gain.setValueAtTime(0.6 * vol, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
    o.connect(g2);
    g2.connect(master);
    o.start(t);
    o.stop(t + 0.9);
  } else if (type === "click") {
    const o = AC.createOscillator();
    o.type = "square";
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.08, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    o.connect(g);
    o.start(t);
    o.stop(t + 0.07);
  } else if (type === "repair") {
    const o = AC.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(440, t);
    o.frequency.linearRampToValueAtTime(660, t + 0.15);
    g.gain.setValueAtTime(0.07, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    o.connect(g);
    o.start(t);
    o.stop(t + 0.22);
  }
}
export function sfxMissileFly(duration, vol = 1) {
  if (!AC || muted) return;
  vol = clamp(vol, 0, 1);
  const t = AC.currentTime;
  // Жужжание двигателя ракеты
  const o = AC.createOscillator();
  o.type = "sawtooth";
  o.frequency.setValueAtTime(160, t);
  o.frequency.linearRampToValueAtTime(200, t + duration);
  const f = AC.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.value = 500;
  const g = AC.createGain();
  g.gain.setValueAtTime(0.12 * vol, t);
  g.gain.linearRampToValueAtTime(0.04 * vol, t + duration);
  g.gain.linearRampToValueAtTime(0.001, t + duration + 0.2);
  o.connect(f); f.connect(g); g.connect(master);
  o.start(t); o.stop(t + duration + 0.3);
  // Свист воздуха
  const o2 = AC.createOscillator();
  o2.type = "sine";
  o2.frequency.setValueAtTime(700, t);
  o2.frequency.linearRampToValueAtTime(500, t + duration);
  const g2 = AC.createGain();
  g2.gain.setValueAtTime(0.04 * vol, t);
  g2.gain.linearRampToValueAtTime(0.001, t + duration);
  o2.connect(g2); g2.connect(master);
  o2.start(t); o2.stop(t + duration + 0.1);
}
export function updEngine(spd) {
  if (!AC || !engGain) return;
  const v =
    G.state === "play" || G.state === "over"
      ? clamp(Math.abs(spd) / 160, 0, 1)
      : 0;
  engGain.gain.setTargetAtTime(muted ? 0 : 0.035 + v * 0.085, AC.currentTime, 0.12);
  engOsc.frequency.setTargetAtTime(26 + v * 34, AC.currentTime, 0.15);
  engOsc._o2.frequency.setTargetAtTime(13 + v * 17, AC.currentTime, 0.15);
  engFilt.frequency.setTargetAtTime(85 + v * 150, AC.currentTime, 0.2);
  engOsc._lfo.frequency.setTargetAtTime(4 + v * 22, AC.currentTime, 0.2);
}

export function setMuted(m) {
  muted = m;
  if (master) master.gain.value = muted ? 0 : 0.5;
}
export function isMuted() {
  return muted;
}