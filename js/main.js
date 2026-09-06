import { G } from "./state.js";
import { update } from "./update.js";
import { render, drawPanel } from "./render.js";
import { updHUD, startGame, togglePause, selectShell } from "./hud.js";
import { drawXRAnim } from "./hud.js";
import "./input.js"; // установка слушателей

const cv = document.getElementById("cv");
const ctx = cv.getContext("2d");

let last = performance.now();
function loop(now) {
    requestAnimationFrame(loop);
    try {
        let dt = Math.min((now - last) / 1000, 0.05);
        last = now;
        if (G.state === "play" || G.state === "over") update(dt);
        if (G.state !== "menu") {
            render();
            drawPanel();
            drawXRAnim();
        } else {
            const VW = innerWidth, VH = innerHeight;
            ctx.fillStyle = "#0d0f0a";
            ctx.fillRect(0, 0, VW, VH);
        }
        if (G.state === "play" || G.state === "over") updHUD(dt);
    } catch (err) {
        if (!G.errShown) {
            G.errShown = true;
            const d = document.createElement("div");
            d.style.cssText =
                "position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:99;" +
                "background:#3a1210;color:#ffb4ad;font:12px monospace;padding:8px 14px;" +
                "border:1px solid #ff5147;max-width:80vw";
            d.textContent = "Ошибка (игра продолжает работать): " + err.message;
            document.body.appendChild(d);
            console.error(err);
        }
    }
}
requestAnimationFrame(loop);

// Кнопки
document.getElementById("btnStart").onclick = startGame;
document.getElementById("btnAgain").onclick = startGame;
document.getElementById("btnRestart").onclick = startGame;
document.getElementById("btnResume").onclick = togglePause;
document.getElementById("btnRespawn").onclick = () =>
    import("./hud.js").then((m) => m.startRespawn());
document.getElementById("btnEndBattle").onclick = () =>
    import("./hud.js").then((m) => m.endBattle());

addEventListener("blur", () => {
    if (G.state === "play") togglePause();
});

selectShell(0);

const bestEl = document.getElementById("bestV");
if (bestEl) bestEl.textContent = G.best || "—";