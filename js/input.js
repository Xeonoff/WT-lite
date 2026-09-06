import { G } from "./state.js";
import { setMuted, isMuted } from "./audio.js";
import {
    togglePause,
    selectShell,
    tryRepair,
    useExtinguisher,
} from "./hud.js";

export const keys = {};
export const mouse = { x: innerWidth / 2, y: innerHeight / 2, down: false, right: false };

addEventListener("keydown", (e) => {
    keys[e.code] = true;
    if (e.code === "Escape" && (G.state === "play" || G.state === "pause"))
        togglePause();
    if (e.code === "KeyM") setMuted(!isMuted());
    if (G.state === "play") {
        if (e.code === "Digit1") selectShell(0);
        if (e.code === "Digit2") selectShell(1);
        if (e.code === "Digit3") selectShell(2);
        if (e.code === "KeyR") tryRepair("module");
        if (e.code === "KeyT") tryRepair("crew");
        if (e.code === "KeyF") useExtinguisher();
    }
    if (["KeyW", "KeyA", "KeyS", "KeyD", "Space"].includes(e.code))
        e.preventDefault();
});
addEventListener("keyup", (e) => {
    keys[e.code] = false;
});
addEventListener("mousemove", (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
});
addEventListener("mousedown", (e) => {
    if (e.button === 0) mouse.down = true;
    if (e.button === 2) { mouse.right = true; G.zoomTarget = 0.75; }
});
addEventListener("mouseup", (e) => {
    if (e.button === 0) mouse.down = false;
    if (e.button === 2) { mouse.right = false; G.zoomTarget = 1; }
});
addEventListener("wheel", (e) => {
    if (G.state === "play" && G.player) {
        const n = G.player.cls.shells.length;
        selectShell((G.curShell + (e.deltaY > 0 ? 1 : n - 1)) % n);
    }
}, { passive: true });
addEventListener("contextmenu", (e) => e.preventDefault());