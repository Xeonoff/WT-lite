/** Минимальная шина событий: связывает симуляцию с рендером, звуком и HUD */
const handlers = new Map();

export const Events = {
    on(name, fn) {
        if (!handlers.has(name)) handlers.set(name, []);
        handlers.get(name).push(fn);
        return () => this.off(name, fn);
    },
    off(name, fn) {
        const list = handlers.get(name);
        if (!list) return;
        const i = list.indexOf(fn);
        if (i >= 0) list.splice(i, 1);
    },
    emit(name, data) {
        const list = handlers.get(name);
        if (!list) return;
        for (const fn of list.slice()) {
            try { fn(data); } catch (e) { console.error("[event " + name + "]", e); }
        }
    },
};
