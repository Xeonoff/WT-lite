/**
 * Стилизованный выпадающий список поверх нативного <select>.
 * Нативный элемент скрыт, но остаётся источником значения и событий input/change,
 * поэтому существующий код (sel.value, addEventListener("change")) работает без изменений.
 * После программной смены опций/значения достаточно снова вызвать enhanceSelect(sel).
 */
let openDD = null;

function closeOpen() { if (openDD) openDD.close(); }
addEventListener("resize", closeOpen);
document.addEventListener("scroll", (e) => { if (openDD && !openDD.list.contains(e.target)) closeOpen(); }, true);
document.addEventListener("pointerdown", (e) => {
    if (openDD && !openDD.list.contains(e.target) && !openDD.btn.contains(e.target)) closeOpen();
}, true);

export function enhanceSelect(sel) {
    if (sel._dd) { sel._dd.sync(); return sel._dd; }
    const wrap = document.createElement("div");
    wrap.className = "dd";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "dd-btn";
    btn.setAttribute("aria-haspopup", "listbox");
    btn.setAttribute("aria-expanded", "false");
    btn.innerHTML = `<span class="dd-val"></span><i class="dd-chev"></i>`;
    const list = document.createElement("div");
    list.className = "dd-list";
    list.setAttribute("role", "listbox");
    list.tabIndex = -1;
    sel.parentNode.insertBefore(wrap, sel);
    wrap.append(sel, btn);
    sel.classList.add("dd-native");
    sel.tabIndex = -1;

    let hi = -1;
    const dd = {
        btn, list,
        sync() {
            const o = sel.options[sel.selectedIndex];
            btn.querySelector(".dd-val").textContent = o ? o.textContent : "";
            btn.disabled = sel.disabled;
            if (sel.hasAttribute("aria-label")) btn.setAttribute("aria-label", sel.getAttribute("aria-label") + " · " + (o?.textContent || ""));
        },
        open() {
            closeOpen();
            list.replaceChildren(...[...sel.options].map((option,i) => {
                const el = document.createElement("div");
                el.className = "dd-opt" + (i === sel.selectedIndex ? " on" : "");
                el.dataset.i = i;
                el.setAttribute("role","option");
                el.setAttribute("aria-selected",String(i === sel.selectedIndex));
                el.textContent = option.textContent;
                if (option.dataset.detail) {
                    const detail = document.createElement("small");
                    detail.textContent = option.dataset.detail;
                    el.append(detail);
                }
                return el;
            }));
            document.body.append(list);
            const r = btn.getBoundingClientRect();
            list.style.minWidth = r.width + "px";
            list.style.left = r.left + "px";
            const below = innerHeight - r.bottom;
            list.style.maxHeight = Math.max(160, Math.min(320, Math.max(below, r.top) - 16)) + "px";
            if (below < 200 && r.top > below) { list.style.top = ""; list.style.bottom = (innerHeight - r.top + 6) + "px"; }
            else { list.style.bottom = ""; list.style.top = (r.bottom + 6) + "px"; }
            // не выходить за правый край
            const lr = list.getBoundingClientRect();
            if (lr.right > innerWidth - 8) list.style.left = Math.max(8, innerWidth - 8 - lr.width) + "px";
            wrap.classList.add("open");
            btn.setAttribute("aria-expanded","true");
            openDD = dd;
            hi = sel.selectedIndex;
            mark();
            list.focus({ preventScroll: true });
        },
        close() {
            list.remove();
            wrap.classList.remove("open");
            btn.setAttribute("aria-expanded","false");
            if (openDD === dd) openDD = null;
        },
        choose(i) {
            if (i >= 0 && i !== sel.selectedIndex) {
                sel.selectedIndex = i;
                sel.dispatchEvent(new Event("input", { bubbles: true }));
                sel.dispatchEvent(new Event("change", { bubbles: true }));
            }
            dd.sync();
            dd.close();
            btn.focus({ preventScroll: true });
        },
    };
    const mark = () => {
        list.querySelectorAll(".dd-opt").forEach((el, i) => el.classList.toggle("hi", i === hi));
        const el = list.children[hi];
        if (el) el.scrollIntoView({ block: "nearest" });
    };
    btn.addEventListener("click", () => (openDD === dd ? dd.close() : dd.open()));
    btn.addEventListener("keydown", (e) => {
        if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) { e.preventDefault(); dd.open(); }
    });
    list.addEventListener("pointermove", (e) => {
        const o = e.target.closest(".dd-opt");
        if (o && +o.dataset.i !== hi) { hi = +o.dataset.i; mark(); }
    });
    list.addEventListener("click", (e) => {
        const o = e.target.closest(".dd-opt");
        if (o) dd.choose(+o.dataset.i);
    });
    list.addEventListener("keydown", (e) => {
        e.stopPropagation();
        const n = sel.options.length;
        if (e.key === "ArrowDown") { hi = (hi + 1) % n; mark(); }
        else if (e.key === "ArrowUp") { hi = (hi - 1 + n) % n; mark(); }
        else if (e.key === "Enter" || e.key === " ") dd.choose(hi);
        else if (e.key === "Escape" || e.key === "Tab") { dd.close(); btn.focus({ preventScroll: true }); }
        else return;
        e.preventDefault();
    });
    sel._dd = dd;
    dd.sync();
    return dd;
}
