import { Game } from "./Game.js";

let game = null;
let errShown = false;

function showFatal(e) {
    console.error(e);
    if (errShown) return;
    errShown = true;
    const d = document.createElement("div");
    d.className = "errbox";
    d.textContent = "Ошибка: " + (e && e.message ? e.message : String(e));
    document.body.appendChild(d);
    setTimeout(() => { d.remove(); errShown = false; }, 8000);
}

try {
    game = new Game();
    window.__game = game;
} catch (e) {
    showFatal(e);
}

let last = performance.now();
function loop(now) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    if (!game) return;
    try {
        game.frame(dt);
    } catch (e) {
        showFatal(e);
    }
}
requestAnimationFrame(loop);

addEventListener("error", (e) => showFatal(e.error || e.message));
addEventListener("unhandledrejection", (e) => showFatal(e.reason));
