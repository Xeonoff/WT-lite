/**
 * Дымовой тест сервера: два бота-клиента создают комнату, расходятся по командам,
 * начинают бой, выезжают, едут и стреляют. Запуск: node server/smoke-test.mjs [ws://localhost:8080/ws]
 */
import WebSocket from "ws";
import { PROTO_VERSION } from "../js/net/Protocol.js";

const URL = process.argv[2] || "ws://localhost:8080/ws";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function client(name) {
    const ws = new WebSocket(URL);
    const c = { ws, name, msgs: [], counts: {}, last: {}, events: {} };
    c.send = (o) => ws.send(JSON.stringify(o));
    ws.on("message", (d) => {
        const m = JSON.parse(d);
        c.counts[m.t] = (c.counts[m.t] || 0) + 1;
        c.last[m.t] = m;
        for (const ev of m.ev || []) c.events[ev.e] = (c.events[ev.e] || 0) + 1;
        if (m.t === "error") console.log(name, "ERROR:", m.text);
    });
    c.open = new Promise((r) => ws.on("open", r));
    return c;
}

const a = client("Alpha"), b = client("Bravo");
await Promise.all([a.open, b.open]);
a.send({ t: "hello", name: "Alpha", v: PROTO_VERSION });
b.send({ t: "hello", name: "Bravo", v: PROTO_VERSION });
await wait(200);
a.send({ t: "create", name: "Тест", map: "prokhorovka", teamSize: 4 });
await wait(200);
const roomId = a.last.room.room.id;
b.send({ t: "join", id: roomId });
await wait(200);
b.send({ t: "team", team: 1 });
a.send({ t: "lineup", ids: ["t34_41", "kv1"] });
b.send({ t: "lineup", ids: ["pz4f2", "stug3f", "t34_41"] });   // чужая машина отбрасывается
a.send({ t: "ready", v: true }); b.send({ t: "ready", v: true });
await wait(200);
const view = a.last.room.room;
console.log("room:", view.members.map((m) => `${m.name}[${m.team}] ${m.lineup.join(",")} ready=${m.ready}`).join(" | "));
a.send({ t: "start" });
await wait(500);
console.log("start A:", JSON.stringify(a.last.start && a.last.start.b), "vehicles in full:", a.last.start && a.last.start.full.veh.length);
a.send({ t: "act", a: "spawn", id: "t34_41" });
b.send({ t: "act", a: "spawn", id: "pz4f2" });
let t0 = Date.now();
while (Date.now() - t0 < 6000) {
    const sa = a.last.s, sb = b.last.s;
    for (const [c, s] of [[a, sa], [b, sb]]) {
        if (!s || !s.me) continue;
        const me = s.v.find((v) => v[0] === c.myId) || s.v[0];
        c.send({ t: "in", th: 1, st: 0.2, aim: [me[1] + 60, 1.2, me[2] + 10], f: 1 });
    }
    await wait(33);
    if (!a.myId && a.events.pspawn) a.myId = -1;
}
const s = a.last.s;
console.log("A counts:", JSON.stringify(a.counts));
console.log("A events:", JSON.stringify(a.events));
console.log("snapshot: tm", s.tm, "vehicles", s.v.length, "me:", !!s.me, "P:", JSON.stringify(s.P), "mode:", JSON.stringify(s.m.tk));
console.log("bytes of last snapshot:", JSON.stringify(s).length);
a.send({ t: "chat", text: "привет <b>" });
await wait(200);
console.log("chat to B:", JSON.stringify(b.last.chat));
a.ws.close(); b.ws.close();
await wait(200);
process.exit(0);
