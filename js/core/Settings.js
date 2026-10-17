import { Events } from "./Events.js";

const KEY = "wtl_settings_v2";

const DEFAULTS = {
    master: 0.8,
    sfx: 0.9,
    engine: 0.7,
    voice: true,
    quality: "high",        // low | medium | high
    xray: true,             // рентген своих попаданий
    xrayIncoming: true,     // рентген попаданий по себе
    tilt: 20,               // наклон камеры, градусы от вертикали
    wheel: "zoom",          // zoom | shell
    hullAssist: true,       // доворот корпуса ПТ-САУ за прицелом
    difficulty: "normal",   // easy | normal | hard — меткость и реакция ИИ противника
    showFps: false,
    hints: true,
    unlockAll: false,
};

function load() {
    try {
        const raw = localStorage.getItem(KEY);
        if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
    } catch (e) { /* приватный режим и т.п. */ }
    return { ...DEFAULTS };
}

const data = load();

export const Settings = {
    get(k) { return data[k]; },
    set(k, v) {
        data[k] = v;
        try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* ignore */ }
        Events.emit("settings", { key: k, value: v });
    },
    all() { return data; },
    reset() {
        for (const k in DEFAULTS) data[k] = DEFAULTS[k];
        try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* ignore */ }
        Events.emit("settings", { key: "*" });
    },
};
