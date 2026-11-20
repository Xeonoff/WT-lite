import { Profile } from "../core/Profile.js";
import { RARITY, TARGETS, slotName, slotTarget } from "../data/Archive.js";
import { cardFor } from "../data/ArchiveCards.js";
import { getVehicle } from "../data/VehicleBuild.js";
import { CREW_SEATS, MODULE_SHORT } from "../data/Vehicles.js";
import { archiveArt } from "./ArchiveArt.js";

// Контуры пустых гнёзд, на сетке 24 × 24.
const symbols = {
    driver: "M21 12a9 9 0 1 1-18 0a9 9 0 1 1 18 0 M3 10l7 2 2 8 2-8 7-2 M14 12a2 2 0 1 1-4 0a2 2 0 1 1 4 0",
    commander: "M3 12l2-7h4l1 7 M14 12l1-7h4l2 7 M10 13h4 M11 15a4 4 0 1 1-8 0a4 4 0 1 1 8 0 M21 15a4 4 0 1 1-8 0a4 4 0 1 1 8 0",
    radio: "M4 15v-4a8 8 0 0 1 16 0v5 M4 11h3v7H4z M17 11h3v7h-3z M19 18q0 3-7 3",
    gunner: "M19 12a7 7 0 1 1-14 0a7 7 0 1 1 14 0 M12 2v7 M12 15v7 M2 12h7 M15 12h7",
    loader: "M3 13h5l3 2h5q2 0 2 2l-6 1 M3 13v6l8 2 10-5 M9 10V6l2-3 2 3v4z M16 10V6l2-3 2 3v4z",
    engine: "M2 9h3v8H2z M5 10l4-4h7l2 3h3v9h-4l-2 2H8l-3-3 M9 3h6 M12 3v3",
    transmission: "M6 5v13 M12 5v13 M18 5v7H6 M4 4h4 M10 4h4 M16 4h4",
    drive: "M5 9a8 8 0 0 1 14-2l1 3 M20 5v5h-5 M19 15a8 8 0 0 1-14 2l-1-3 M4 19v-5h5",
    breech: "M3 8h11v9H3z M14 10h7v5h-7 M5 5h6v3 M7 17v3h6",
    track: "M6 7h12a5 5 0 0 1 0 10H6A5 5 0 0 1 6 7z M8 12a2 2 0 1 1-4 0a2 2 0 1 1 4 0 M14 12a2 2 0 1 1-4 0a2 2 0 1 1 4 0 M20 12a2 2 0 1 1-4 0a2 2 0 1 1 4 0",
    ammo: "M3 20h18 M4 17V8l2-4 2 4v9z M10 17V8l2-4 2 4v9z M16 17V8l2-4 2 4v9z",
};
const glyphs = new Map();
function glyph(target) {
    if (!glyphs.has(target)) {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 72;
        const g = canvas.getContext("2d");
        g.scale(3,3);
        g.lineWidth = 1.6; g.lineJoin = g.lineCap = "round"; g.strokeStyle = "#b5beb0";
        g.stroke(new Path2D(symbols[target]));
        glyphs.set(target,canvas.toDataURL());
    }
    return glyphs.get(target);
}
function slotCode(def,kind,slot,target) {
    if (kind === "dossier") return CREW_SEATS[slot].short;
    if (target === "ammo") return "БК " + (def.rackOrder.indexOf(slot)+1);
    if (target === "track") return slot === "trackL" ? "ГУС Л" : "ГУС П";
    return MODULE_SHORT[target];
}
function locationOf(item) {
    const v = getVehicle(item.vehicle);
    return v ? v.name + " · " + slotName(v,item.kind,item.slot) : "На хранении";
}
function tile(item,source,caption,label) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "gearTile";
    button.setAttribute("aria-label",label);
    const img = new Image();
    img.alt = ""; img.src = source;
    const text = document.createElement("span");
    text.textContent = caption;
    button.append(img,text);
    if (item) {
        button.classList.add("filled");
        button.style.setProperty("--ink",RARITY[item.tier].color);
    }
    return button;
}
function itemArt(item) { return archiveArt(item.kind,false,RARITY[item.tier].color); }

export class HangarEquipment {
    constructor(root, changed) {
        this.root = root;
        this.changed = changed;
        this.rack = document.createElement("div");
        this.rack.className = "gearRack";
        this.menu = document.createElement("div");
        this.menu.className = "gearPicker";
        this.menu.popover = "auto";
        this.menu.id = "gearPicker";
        this.menu.setAttribute("role","dialog");
        this.tip = document.createElement("div");
        this.tip.id = "gearTip";
        this.tip.hidden = true;
        this.tip.setAttribute("role","tooltip");
        this.tip.innerHTML = "<strong></strong><small></small><p></p><footer></footer>";
        root.append(this.rack,this.menu,this.tip);
        this.menu.addEventListener("beforetoggle",e=>{
            if (e.newState === "closed") {
                this.anchor?.setAttribute("aria-expanded","false");
                this.hideTip();
                if (this.tip.parentElement === this.menu) this.root.append(this.tip);
            }
        });
        root.addEventListener("keydown",e=>{
            if (e.key === "Escape" && this.menu.matches(":popover-open")) {
                e.preventDefault(); e.stopPropagation();
                this.menu.hidePopover();
                this.anchor?.focus();
            } else if (["Tab"," ","ArrowLeft","ArrowRight"].includes(e.key)) {
                e.stopPropagation();
                if (e.key.startsWith("Arrow") && e.target.matches(".gearTile")) {
                    const buttons = [...e.target.parentElement.querySelectorAll(".gearTile")];
                    const index = buttons.indexOf(e.target) + (e.key === "ArrowLeft" ? -1 : 1);
                    buttons[(index+buttons.length)%buttons.length].focus();
                    e.preventDefault();
                }
            }
        });
        const reposition = () => {
            this.hideTip();
            if (this.menu.matches(":popover-open")) this.positionMenu();
        };
        window.addEventListener("resize",reposition);
        root.closest(".hBody").addEventListener("scroll",reposition);
        this.menu.addEventListener("scroll",()=>this.hideTip(),true);
    }

    close() {
        this.menu.hidePopover();
        this.hideTip();
    }
    hideTip() {
        this.tip.hidden = true;
        this.tipOwner?.removeAttribute("aria-describedby");
        this.tipOwner = null;
    }
    describe(button,name,item,detail) {
        const show = () => {
            this.hideTip();
            const [title,meta,rule,foot] = this.tip.children;
            const card = item && cardFor(item);
            title.textContent = card?.name || name;
            meta.textContent = item ? RARITY[item.tier][item.kind] + " · №" + item.id + " · " + name : "";
            rule.textContent = card?.text || detail;
            foot.textContent = item ? detail : "";
            this.tip.style.setProperty("--ink",item ? RARITY[item.tier].color : "#babdac");
            this.tipOwner = button;
            button.setAttribute("aria-describedby","gearTip");
            // Фокус может вернуться к слоту во время закрытия меню. Подсказке
            // достаточно находиться в том же слое, что и её кнопка.
            const layer = this.menu.contains(button) ? this.menu : this.root;
            if (this.tip.parentElement !== layer) layer.append(this.tip);
            this.tip.hidden = false;
            const b = button.getBoundingClientRect(), t = this.tip.getBoundingClientRect();
            const left = Math.max(8,Math.min(innerWidth-t.width-8,b.left+b.width/2-t.width/2));
            this.tip.style.left = left + "px";
            this.tip.style.top = (b.top > t.height+10 ? b.top-t.height-7 : Math.min(innerHeight-t.height-8,b.bottom+7)) + "px";
        };
        const hide = () => { if (this.tipOwner === button) this.hideTip(); };
        button.addEventListener("pointerenter",e=>{ if (e.pointerType !== "touch") show(); });
        button.addEventListener("pointerleave",hide);
        button.addEventListener("focus",show);
        button.addEventListener("blur",hide);
        return show;
    }

    show(def) {
        this.close();
        this.def = def;
        this.rack.replaceChildren();
        this.root.hidden = !!def.boss;
        if (def.boss) return;
        const editable = Profile.isResearched(def.id);
        for (const kind of ["dossier","plan"]) {
            const group = document.createElement("section");
            const title = kind === "dossier" ? "Экипаж" : "Модули";
            group.innerHTML = "<h4>"+title+"</h4><div class='gearRow'></div>";
            const slots = kind === "dossier" ? def.crew : Object.keys(TARGETS.plan).flatMap(t=>
                t === "ammo" ? def.rackOrder : def.modules.filter(m=>m.type===t).map(m=>m.id));
            for (const slot of slots) {
                const target = slotTarget(def,kind,slot);
                if (!Object.hasOwn(TARGETS[kind],target)) continue;
                const name = slotName(def,kind,slot);
                const item = Profile.data.archive.find(i=>i.vehicle===def.id && i.kind===kind && i.slot===slot);
                const label = name + " · " + (item ? cardFor(item).name : "Пустой слот");
                const button = tile(item,item ? itemArt(item) : glyph(target),slotCode(def,kind,slot,target),label);
                button.dataset.slot = slot;
                button.setAttribute("aria-haspopup","dialog");
                button.setAttribute("aria-expanded","false");
                button.setAttribute("aria-controls",this.menu.id);
                button.setAttribute("aria-disabled",String(!editable));
                this.describe(button,name,item,editable ? (item ? locationOf(item) : "Пустой слот") : "Сначала исследуйте машину.");
                button.onclick = () => { if (editable) this.open(button,kind,slot,target,item); };
                group.lastElementChild.append(button);
            }
            this.rack.append(group);
        }
    }
    positionMenu() {
        const r = this.anchor.getBoundingClientRect(), box = this.menu.getBoundingClientRect();
        this.menu.style.left = Math.max(8,Math.min(innerWidth-box.width-8,r.left+(r.width-box.width)/2)) + "px";
        this.menu.style.top = Math.max(8,r.top-box.height-6 >= 8 ? r.top-box.height-6 : Math.min(r.bottom+6,innerHeight-box.height-8)) + "px";
    }
    open(anchor,kind,slot,target,current) {
        const wasOpen = this.menu.matches(":popover-open") && this.anchor === anchor;
        this.close();
        if (wasOpen) return;
        this.anchor = anchor;
        const name = slotName(this.def,kind,slot);
        this.menu.setAttribute("aria-label",name);
        this.menu.innerHTML = "<header><b></b><button type='button' aria-label='Закрыть'>×</button></header><div class='gearItems scrollable'></div>";
        this.menu.querySelector("header b").textContent = name;
        this.menu.querySelector("header button").onclick = () => {this.menu.hidePopover();anchor.focus();};
        const grid = this.menu.querySelector(".gearItems");
        const items = Profile.data.archive.filter(i=>i.kind===kind && i.target===target && i.tier!==null && cardFor(i));
        items.sort((a,b)=>Number(b===current)-Number(a===current) || Number(!!a.vehicle)-Number(!!b.vehicle) || b.tier-a.tier || a.id-b.id);
        const equip = item => {
            const ok = item ? Profile.assignItem(item.id,this.def.id,slot,{replace:true}) : Profile.unassignItem(current.id);
            this.show(this.def);
            if (ok) this.changed();
            this.rack.querySelector('[data-slot="'+slot+'"]').focus({preventScroll:true});
        };
        let preview;
        for (const item of items) {
            const card = cardFor(item);
            const b = tile(item,itemArt(item),card.name,card.name + " · " + RARITY[item.tier][kind] + " · №" + item.id);
            b.dataset.item = item.id;
            b.setAttribute("aria-pressed",String(item===current));
            const detail = item.vehicle && item !== current ? "Перенести · " + locationOf(item) : locationOf(item);
            const show = this.describe(b,name,item,detail);
            b.onclick = e => {
                if (e.pointerType === "touch" && preview !== b) {
                    preview = b; show();
                    this.tip.lastElementChild.textContent += " · Коснитесь ещё раз для выбора";
                    return;
                }
                equip(item);
            };
            grid.append(b);
        }
        if (!items.length) grid.textContent = kind === "dossier" ? "Подходящих личных дел пока нет." : "Подходящих чертежей пока нет.";
        if (current) {
            const remove = document.createElement("button");
            remove.className = "gearRemove"; remove.textContent = "Снять на хранение";
            remove.onclick = () => equip(null);
            this.menu.append(remove);
        }
        anchor.setAttribute("aria-expanded","true");
        this.menu.showPopover({source:anchor});
        this.positionMenu();
        this.menu.querySelector("header button").focus({preventScroll:true});
    }
}
