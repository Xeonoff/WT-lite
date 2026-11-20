/** Состояние клавиатуры и мыши + подписка на нажатия */
export class Input {
    constructor() {
        this.keys = {};
        this.mouse = { x: innerWidth / 2, y: innerHeight / 2 };
        this.resetPointer();
        this.onDown = null;
        this.handlers = [];
        this.wheelHandlers = [];
        this.enabled = true;
        const GAME_KEYS = ["KeyW", "KeyA", "KeyS", "KeyD", "Space", "Tab", "F1"];
        addEventListener("keydown", (e) => {
            if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "SELECT")) return;
            if (GAME_KEYS.includes(e.code)) e.preventDefault();
            const first = !this.keys[e.code];
            this.keys[e.code] = true;
            if (!first) return;
            for (const h of this.handlers) if (h.code === e.code) h.fn(e);
        });
        addEventListener("keyup", (e) => { this.keys[e.code] = false; });
        addEventListener("blur", () => { this.keys = {}; this.resetPointer(); });
        addEventListener("mousemove", (e) => {
            // при захвате мыши курсор стоит на месте — копим смещение для обзора
            if (document.pointerLockElement) { this.mouse.overUI = false; this.mouse.dx += e.movementX; this.mouse.dy += e.movementY; return; }
            this.mouse.x = e.clientX;
            this.mouse.y = e.clientY;
            this.mouse.overUI = !!(e.target && e.target.closest && e.target.closest(".ui-block"));
        });
        addEventListener("mousedown", (e) => {
            this.mouse.overUI = !document.pointerLockElement && !!e.target.closest?.(".screen, .ui-block, button, input, select, a");
            if (this.mouse.overUI) return;
            if (!document.pointerLockElement) { this.mouse.x = e.clientX; this.mouse.y = e.clientY; }
            if (this.onDown && this.onDown(e)) return;
            if (e.button === 0) this.mouse.left = this.mouse.pressed = true;
            if (e.button === 2) this.mouse.right = true;
        });
        addEventListener("mouseup", (e) => {
            if (e.button === 0) this.mouse.left = false;
            if (e.button === 2) this.mouse.right = false;
        });
        addEventListener("wheel", (e) => {
            if (e.target && e.target.closest && e.target.closest(".scrollable")) return;
            for (const h of this.wheelHandlers) h(e.deltaY);
        }, { passive: true });
        addEventListener("contextmenu", (e) => e.preventDefault());
    }

    on(code, fn) { this.handlers.push({ code, fn }); }
    resetPointer() {
        Object.assign(this.mouse, { left: false, right: false, pressed: false, overUI: false, dx: 0, dy: 0 });
    }
    onWheel(fn) { this.wheelHandlers.push(fn); }
    down(code) { return this.enabled && !!this.keys[code]; }
}
