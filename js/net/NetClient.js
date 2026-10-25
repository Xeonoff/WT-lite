import { PROTO_VERSION } from "./Protocol.js";

/** Адрес сервера по умолчанию: тот же хост (игра раздаётся сервером), для Live Server — локальный сервер */
export function defaultServerUrl() {
    if (location.protocol === "file:" || location.port === "5501" || location.port === "5500") return "ws://localhost:8080/ws";
    return (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws";
}

/** Нормализация введённого адреса: «my-app.onrender.com» → wss://my-app.onrender.com/ws */
export function normalizeServerUrl(s) {
    s = String(s || "").trim();
    if (!s) return defaultServerUrl();
    if (/^https?:\/\//i.test(s)) s = s.replace(/^http/i, "ws");
    if (!/^wss?:\/\//i.test(s)) s = (/^(localhost|127\.|192\.168\.|10\.)/.test(s) ? "ws://" : "wss://") + s;
    if (!/\/ws\/?$/.test(s)) s = s.replace(/\/+$/, "") + "/ws";
    return s;
}

/** WebSocket-клиент онлайн-режима: подключение, приветствие, подписка на типы сообщений */
export class NetClient {
    constructor() {
        this.ws = null;
        this.handlers = new Map();
        this.id = null;
        this.name = "";
        this.connected = false;
        this.rtt = 0;
        this.pingTimer = null;
    }

    on(type, fn) {
        if (!this.handlers.has(type)) this.handlers.set(type, []);
        this.handlers.get(type).push(fn);
    }

    emit(type, msg) {
        for (const fn of this.handlers.get(type) || []) {
            try { fn(msg); } catch (e) { console.error("[net " + type + "]", e); }
        }
    }

    connect(url, name) {
        this.close();
        return new Promise((resolve, reject) => {
            let ws;
            try { ws = new WebSocket(url); } catch (e) { reject(new Error("неверный адрес сервера")); return; }
            this.ws = ws;
            let settled = false;
            const fail = (msg) => { if (!settled) { settled = true; reject(new Error(msg)); } };
            const timer = setTimeout(() => { fail("сервер не отвечает"); ws.close(); }, 12000);
            ws.onopen = () => ws.send(JSON.stringify({ t: "hello", name, v: PROTO_VERSION }));
            ws.onmessage = (ev) => {
                let m;
                try { m = JSON.parse(ev.data); } catch { return; }
                if (m.t === "welcome") {
                    clearTimeout(timer);
                    this.id = m.id;
                    this.name = m.name;
                    this.connected = true;
                    settled = true;
                    this.startPing();
                    resolve(m);
                } else if (m.t === "error" && !settled) {
                    clearTimeout(timer);
                    fail(m.text);
                    return;
                } else if (m.t === "pong") {
                    this.rtt = performance.now() - m.ts;
                }
                this.emit(m.t, m);
            };
            ws.onclose = () => {
                clearTimeout(timer);
                const was = this.connected;
                this.connected = false;
                this.stopPing();
                if (this.ws === ws) this.ws = null;
                fail("не удалось подключиться");
                if (was) this.emit("close", {});
            };
            ws.onerror = () => {};
        });
    }

    startPing() {
        this.stopPing();
        this.pingTimer = setInterval(() => this.send({ t: "ping", ts: performance.now() }), 3000);
    }
    stopPing() { if (this.pingTimer) clearInterval(this.pingTimer); this.pingTimer = null; }

    send(o) {
        if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o));
    }

    close() {
        this.stopPing();
        if (this.ws) { const ws = this.ws; this.ws = null; this.connected = false; ws.onclose = null; ws.close(); }
    }
}
