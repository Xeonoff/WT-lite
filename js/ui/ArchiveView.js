import { Profile } from "../core/Profile.js";
import { CASES, CASE_PRICE, DROP_CHANCE, RARITY, TARGETS, rollItem, slotName, slotTarget } from "../data/Archive.js";
import { NATIONS } from "../data/Vehicles.js";
import { getVehicle } from "../data/VehicleBuild.js";
import { archiveArt } from "./ArchiveArt.js";
import { CARD_POOLS, cardFor } from "../data/ArchiveCards.js";

const itemTitle = i => cardFor(i).name;
const icon = (kind, sealed, ink) => '<img alt="" src="' + archiveArt(kind, sealed, ink) + '">';
function assignment(i) {
    const v = getVehicle(i.vehicle);
    return v ? v.name + " · " + slotName(v, i.kind, i.slot) : "На хранении";
}

export class ArchiveView {
    constructor(root, changed) {
        this.root = root;
        this.changed = changed;
        this.kind = "dossier";
        this.catalog = false;
        this.id = null;
        root.addEventListener("click", e => {
            const button = e.target.closest("[data-archive]");
            if (!button) return;
            const { archive, value } = button.dataset;
            if (archive === "faster" && this.animation) {
                this.animation.updatePlaybackRate(3);
                button.disabled = true;
                return;
            }
            if (this.reel) return;
            this.stopReel();
            this.reward = null;
            const listY = this.root.querySelector(".stockList")?.scrollTop || 0;
            this.notice = "";
            if (archive === "kind") { this.kind = value; this.id = null; this.filter = null; }
            if (archive === "filter") this.filter = value;
            if (archive === "tab") this.catalog = value === "catalog";
            if (archive === "item") this.id = Number(value);
            if (archive === "buy") {
                if (Profile.buyCase(this.kind,this.nation)) {
                    this.notice = "Куплено · " + CASES[this.kind];
                    this.changed();
                }
            }
            if (archive === "open") {
                const id = Number(value);
                const item = Profile.prepareCase(id);
                if (item) {
                    this.catalog = false;
                    this.playReel(id,item);
                    return;
                }
            }
            if (archive === "equip" && Profile.assignItem(this.id, this.vehicle, value)) this.notice = "Установлено · " + assignment(this.selected());
            if (archive === "remove" && Profile.unassignItem(this.id)) this.notice = "Предмет возвращён на хранение";
            this.render();
            if (["item","equip","remove"].includes(archive)) this.root.querySelector(".stockList").scrollTop = listY;
            if (["equip", "remove"].includes(archive)) this.changed();
        });
    }
    show(vehicle, kind) {
        this.stopReel();
        this.vehicle = vehicle;
        this.nation = getVehicle(vehicle).nation;
        this.kind = kind;
        this.filter = null;
        this.notice = "";
        this.id = null;
        this.reward = null;
        this.catalog = false;
        this.render();
    }
    selected() { return Profile.data.archive.find(i => i.id === this.id); }
    stopReel() {
        if (this.animation) {
            this.animation.onfinish = null;
            this.animation.cancel();
            this.animation = null;
        }
        this.reel = null;
    }
    finishReel() {
        if (!this.reel) return;
        const id = this.reel.id;
        this.stopReel();
        this.reward = Profile.openCase(id);
        if (this.reward) {
            this.id = id;
            this.changed();
        }
        this.render();
        this.root.querySelector("[data-archive=stock]")?.focus({preventScroll:true});
    }
    playReel(id,item) {
        const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
        const start = 4, winner = reduced ? start + 2 : 34;
        this.reel = {id, cards:Array.from({length:winner + 6}, (_,i)=>i === winner ? item : rollItem(item.kind))};
        this.render();
        const strip = this.root.querySelector(".caseStrip");
        const center = i => strip.children[i].offsetLeft + strip.children[i].offsetWidth / 2;
        const stop = `translateX(-${center(winner)}px)`;
        this.animation = strip.animate([
            {transform:`translateX(-${center(start)}px)`, easing:"cubic-bezier(.16,.49,.15,1)"},
            {transform:stop, offset:.89}, {transform:stop}
        ],{duration:reduced ? 1200 : 4600,fill:"both"});
        this.animation.onfinish = () => this.finishReel();
        this.root.querySelector("[data-archive=faster]").focus({preventScroll:true});
    }
    render() {
        if (this.reel || this.reward) {
            this.root.innerHTML = `<section class="caseOpening"><h3>${CASES[this.kind]}</h3>${this.reel ? this.reelHTML() : this.rewardHTML()}</section>`;
            return;
        }
        const all = Profile.data.archive;
        const kind = this.kind, stock = all.filter(i => i.kind === kind && i.tier === null);
        const items = all.filter(i => i.kind === kind && i.tier !== null).reverse();
        if (!items.some(i => i.id === this.id)) this.id = items[0]?.id;
        const item = this.selected();
        this.root.innerHTML = `
          <aside class="archiveSide">
            ${Object.entries(CASES).map(([k, name]) => `<button class="caseCard" data-archive="kind" data-value="${k}" aria-pressed="${kind===k}">
                ${icon(k,true)}<span>${name}</span><b>×${all.filter(i=>i.kind===k && i.tier===null).length}</b></button>`).join("")}
            <p>Шанс после выезда в завершённом онлайн-бою — ${DROP_CHANCE.online}%. За победу над Ratte в одиночку или онлайн — ${DROP_CHANCE.boss}%. Оба вида контейнеров равновероятны.</p>
          </aside>
          <section class="archiveMain">
            <div class="archiveTabs"><button data-archive="tab" data-value="stock" aria-pressed="${!this.catalog}">Хранилище · ${items.length}</button>
              <button data-archive="tab" data-value="catalog" aria-pressed="${this.catalog}">Все эффекты и шансы</button></div>
            <div class="caseHeader"><div><h3>${CASES[kind]}</h3><small>${NATIONS[this.nation].name} · Баланс: ${Profile.data.rp[this.nation].toLocaleString("ru-RU")} ОИ</small></div>
              <div class="caseActions"><button class="ghost" data-archive="buy" ${Profile.data.rp[this.nation] >= CASE_PRICE && !this.reel ? "" : "disabled"}>Купить · ${CASE_PRICE.toLocaleString("ru-RU")} ОИ</button>
              <button class="big" data-archive="open" data-value="${stock[0]?.id || 0}" ${stock.length ? "" : "disabled"}>${stock[0]?.pending ? "Продолжить открытие" : "Открыть"} · ${stock.length}</button></div></div>
            ${this.catalog ? this.catalogHTML() : `<div class="stockBody">
              <div class="stockList scrollable">${items.map(i => `<button class="archiveItem" style="--rarity:${RARITY[i.tier].color}" data-archive="item" data-value="${i.id}" aria-pressed="${i.id===this.id}">
                ${icon(kind,false,RARITY[i.tier].color)}<span><b>${itemTitle(i)}</b><small>${TARGETS[kind][i.target]} · ${RARITY[i.tier][kind]}</small><em>${assignment(i)}</em></span></button>`).join("") || "<p>Хранилище пусто. Здесь появятся открытые документы.</p>"}</div>
              ${item ? this.detailHTML(item) : ""}</div>`}
            <div class="archiveNotice" role="status">${this.notice}</div>
          </section>`;
    }
    reelHTML() {
        const cards = this.reel.cards.map(i => `<div class="reelCard" style="--rarity:${RARITY[i.tier].color}">
            ${icon(i.kind,false,RARITY[i.tier].color)}<b>${itemTitle(i)}</b><small>${TARGETS[i.kind][i.target]}</small></div>`).join("");
        return `<div class="caseReel" aria-hidden="true"><div class="caseStrip">${cards}</div></div>
            <button class="ghost" data-archive="faster">Ускорить</button>`;
    }
    rewardHTML() {
        const i = this.reward, rarity = RARITY[i.tier];
        return `<article class="caseReward" role="status" style="--rarity:${rarity.color}">
            ${icon(i.kind,false,rarity.color)}<small>${rarity[i.kind]} · ${TARGETS[i.kind][i.target]}</small>
            <h2>${itemTitle(i)}</h2><p>${cardFor(i).text}</p></article>
            <button class="big" data-archive="stock">В хранилище</button>`;
    }
    catalogHTML() {
        const kind = this.kind;
        const types = Object.entries(TARGETS[kind]);
        const target = this.filter || types[0][0];
        const filters = types.map(([id,name]) =>
            `<button data-archive="filter" data-value="${id}" aria-pressed="${target === id}">${name}</button>`).join("");
        const rows = CARD_POOLS[target].map((pool,t) => {
            const r = RARITY[t];
            const count = pool.length + (pool.length === 3 || pool.length === 4 ? " карты" : " карт");
            return `<details style="--rarity:${r.color}" ${t === 0 ? "open" : ""}><summary>${r[kind]} · ${count} <b>${r.chance}%</b></summary>${pool.map(card =>
                `<p><b>${card.name}</b><span>${card.text}</span></p>`).join("")}</details>`;
        }).join("");
        return `<div class="archiveFilters" aria-label="Специализация">${filters}</div>
            <div class="archiveCatalog scrollable"><p>Процент указан за редкость. Все специализации равновероятны. Внутри выбранной редкости и специализации каждая карта имеет одинаковый шанс. Навыки работают, пока носитель в строю и на своём месте. Новый выезд начинает накопление заново. Бонусы боеукладки к пробитию и внутреннему урону получает снаряд из стеллажа с этим чертежом.</p>${rows}</div>`;
    }
    detailHTML(item) {
        const v = getVehicle(this.vehicle), r = RARITY[item.tier];
        const slots = item.kind === "plan" ? v.modules.map(m=>m.id) : v.crew;
        const fits = slots.filter(s=>slotTarget(v,item.kind,s)===item.target);
        let actions = "<p>Для этой машины нет подходящего места.</p>";
        if (!v.boss && !Profile.isResearched(v.id)) actions = "<p>Сначала исследуйте машину.</p>";
        else if (fits.length) actions = fits.map(slot => {
            const other = Profile.data.archive.find(i=>i.kind===item.kind && i.vehicle===v.id && i.slot===slot);
            const action = other ? other.id===item.id ? "Установлено" : "Занято" : item.vehicle ? "Перенести" : "Установить";
            return `<button class="ghost" data-archive="equip" data-value="${slot}" ${other ? "disabled" : ""}>${action} · ${slotName(v,item.kind,slot)}</button>`;
        }).join("");
        return `<article class="archiveDetail scrollable" style="--rarity:${r.color}">${icon(item.kind,false,r.color)}
            <small>${r[item.kind]} · ${TARGETS[item.kind][item.target]} · № ${item.id}</small><h3>${itemTitle(item)}</h3>
            <p class="archiveRule">${cardFor(item).text}</p>
            <h4>${v.name}</h4>${actions}
            ${item.vehicle ? `<button class="ghost" data-archive="remove">Снять · ${assignment(item)}</button>` : ""}
        </article>`;
    }
}

export function archiveButtons() {
    return Object.entries(CASES).map(([kind,name]) => `<button class="archiveShortcut" data-act="archive" data-v="${kind}" title="${name}" aria-label="${name}">
        ${icon(kind,true)}<span>${kind==="plan" ? "Чертежи" : "Личные дела"}</span><b>${Profile.data.archive.filter(i=>i.kind===kind && i.tier===null).length}</b></button>`).join("");
}
