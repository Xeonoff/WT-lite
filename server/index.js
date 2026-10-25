/**
 * Сервер WT LITE: раздаёт игру (index.html, css, js) и ведёт онлайн-бои по WebSocket (/ws).
 * Запуск: npm start (порт из переменной PORT, по умолчанию 8080). Рассчитан на Render.com.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { Room } from "./Room.js";
import { PROTO_VERSION, cleanName } from "../js/net/Protocol.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = +process.env.PORT || 8080;
const MAX_ROOMS = 40;
const MAX_CLIENTS = 400;
const MSG_PER_SEC = 90;

/* ─────────── Статика ─────────── */
const MIME = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon",
};
// раздаём только файлы игры — серверный код, git и node_modules недоступны
const ALLOWED = [/^\/index\.html$/, /^\/css\/[\w.-]+\.css$/, /^\/js\/(?:[\w-]+\/)*[\w.-]+\.js$/];
const cache = new Map();

function serveStatic(req, res) {
    let url = decodeURIComponent((req.url || "/").split("?")[0]);
    if (url === "/") url = "/index.html";
    if (!ALLOWED.some((re) => re.test(url)) || url.includes("..")) return notFound(res);
    const file = path.join(ROOT, url);
    if (!file.startsWith(ROOT + path.sep)) return notFound(res);
    let entry = cache.get(file);
    if (!entry) {
        let body;
        try { body = fs.readFileSync(file); } catch { return notFound(res); }
        entry = { body, gz: zlib.gzipSync(body), type: MIME[path.extname(file)] || "application/octet-stream" };
        if (process.env.NODE_ENV === "production") cache.set(file, entry);
    }
    const gzip = /\bgzip\b/.test(req.headers["accept-encoding"] || "");
    res.writeHead(200, {
        "Content-Type": entry.type,
        "Cache-Control": url === "/index.html" ? "no-cache" : "public, max-age=300",
        ...(gzip ? { "Content-Encoding": "gzip" } : {}),
        "X-Content-Type-Options": "nosniff",
    });
    res.end(gzip ? entry.gz : entry.body);
}

function notFound(res) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
}

const server = http.createServer((req, res) => {
    if (req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, rooms: rooms.size, clients: clients.size, v: PROTO_VERSION }));
        return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); res.end(); return; }
    serveStatic(req, res);
});

/* ─────────── Клиенты и комнаты ─────────── */
const clients = new Map();
const rooms = new Map();
let nextId = 1;
let nextRoom = 1;

class Client {
    constructor(ws) {
        this.ws = ws;
        this.id = "c" + nextId++;
        this.name = "Танкист";
        this.room = null;
        this.hello = false;
        this.msgCount = 0;
        this.msgWindow = Date.now();
    }
    sendRaw(s) { if (this.ws.readyState === 1) this.ws.send(s); }
    send(o) { this.sendRaw(JSON.stringify(o)); }
}

function roomList() { return [...rooms.values()].map((r) => r.summary()); }

function pushRooms() {
    const s = JSON.stringify({ t: "rooms", rooms: roomList() });
    for (const c of clients.values()) if (c.hello && !c.room) c.sendRaw(s);
}

function onMessage(c, msg) {
    if (msg.t !== "hello" && !c.hello) return;
    const r = c.room;
    switch (msg.t) {
        case "hello":
            if (msg.v !== PROTO_VERSION) { c.send({ t: "error", text: "Версия клиента не совпадает с сервером — обновите страницу" }); return; }
            c.name = cleanName(msg.name);
            c.hello = true;
            c.send({ t: "welcome", id: c.id, name: c.name, rooms: roomList() });
            break;
        case "name": c.name = cleanName(msg.name); if (r) r.pushView(); break;
        case "rooms": c.send({ t: "rooms", rooms: roomList() }); break;
        case "create": {
            if (r) r.remove(c);
            if (rooms.size >= MAX_ROOMS) { c.send({ t: "error", text: "Слишком много комнат, попробуйте позже" }); return; }
            const room = new Room("r" + nextRoom++, c, msg, (rm) => { rooms.delete(rm.id); pushRooms(); });
            rooms.set(room.id, room);
            room.add(c);
            pushRooms();
            break;
        }
        case "join": {
            const room = rooms.get(String(msg.id));
            if (!room) { c.send({ t: "error", text: "Комната не найдена" }); return; }
            if (r && r !== room) r.remove(c);
            if (r === room) return;
            const err = room.add(c);
            if (err) c.send({ t: "error", text: err });
            pushRooms();
            break;
        }
        case "leaveRoom": if (r) { r.remove(c); c.send({ t: "rooms", rooms: roomList() }); pushRooms(); } break;
        case "team": if (r) r.setTeam(c, msg.team); break;
        case "lineup": if (r) r.setLineup(c, msg.ids); break;
        case "ready": if (r) r.setReady(c, msg.v); break;
        case "settings": if (r && r.hostId === c.id && r.state === "lobby") { r.applySettings(msg); r.pushView(); pushRooms(); } break;
        case "start": if (r) { const err = r.start(c); if (err) c.send({ t: "error", text: err }); pushRooms(); } break;
        case "chat": if (r) r.chat(c, msg.text); break;
        case "in": if (r) r.input(c, msg); break;
        case "act": if (r) r.action(c, msg); break;
        case "leaveBattle": if (r) r.leaveBattle(c); break;
        case "rejoin": if (r) r.rejoin(c); break;
        case "ping": c.send({ t: "pong", ts: msg.ts }); break;
    }
}

const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 32 * 1024 });

wss.on("connection", (ws) => {
    if (clients.size >= MAX_CLIENTS) { ws.close(1013, "server full"); return; }
    const c = new Client(ws);
    clients.set(c.id, c);
    ws.isAlive = true;
    ws.on("pong", () => { ws.isAlive = true; });
    ws.on("message", (data) => {
        // простое ограничение частоты сообщений
        const now = Date.now();
        if (now - c.msgWindow > 1000) { c.msgWindow = now; c.msgCount = 0; }
        if (++c.msgCount > MSG_PER_SEC) return;
        let msg;
        try { msg = JSON.parse(data); } catch { return; }
        if (!msg || typeof msg.t !== "string") return;
        try { onMessage(c, msg); } catch (e) { console.error("[msg " + msg.t + "]", e); }
    });
    ws.on("close", () => {
        clients.delete(c.id);
        if (c.room) { c.room.remove(c); pushRooms(); }
    });
});

// разрыв «зависших» соединений
setInterval(() => {
    for (const ws of wss.clients) {
        if (!ws.isAlive) { ws.terminate(); continue; }
        ws.isAlive = false;
        ws.ping();
    }
}, 20000);

server.listen(PORT, () => console.log(`WT LITE server: http://localhost:${PORT}  (WebSocket: /ws)`));
