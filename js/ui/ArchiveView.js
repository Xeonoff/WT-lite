import { Profile } from "../core/Profile.js";
import { CASES, DROP_CHANCE, RARITY, TARGETS, slotName, slotTarget } from "../data/Archive.js";
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
            this.notice = "";
            if (archive === "kind") { this.kind = value; this.id = null; this.filter = null; }
            if (archive === "filter") this.filter = value;
            if (archive === "tab") this.catalog = value === "catalog";
            if (archive === "item") this.id = Number(value);
            if (archive === "open") {
                const item = Profile.openCase(Number(value));
                if (item) {
                    this.id = item.id; this.catalog = false;
                    this.notice = "Получено · " + RARITY[item.tier][item.kind] + " · " + itemTitle(item);
                }
            }
            if (archive === "equip" && Profile.assignItem(this.id, this.vehicle, value)) this.notice = "Установлено · " + assignment(this.selected());
            if (archive === "remove" && Profile.unassignItem(this.id)) this.notice = "Предмет возвращён на хранение";
            this.render();
            if (["open", "equip", "remove"].includes(archive)) this.changed();
        });
    }
    show(vehicle, kind) {
        this.vehicle = vehicle;
        this.kind = kind;
        this.filter = null;
        this.notice = "";
        this.id = null;
        this.catalog = false;
        this.render();
    }
    selected() { return Profile.data.archive.find(i => i.id === this.id); }
    render() {
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
            <div class="caseHeader"><div><h3>${CASES[kind]}</h3><small>Один документ — одна карточка</small></div>
              <button class="big" data-archive="open" data-value="${stock[0]?.id || 0}" ${stock.length ? "" : "disabled"}>Открыть · ${stock.length}</button></div>
            ${this.catalog ? this.catalogHTML() : `<div class="stockBody">
              <div class="stockList scrollable">${items.map(i => `<button class="archiveItem" style="--rarity:${RARITY[i.tier].color}" data-archive="item" data-value="${i.id}" aria-pressed="${i.id===this.id}">
                ${icon(kind,false,RARITY[i.tier].color)}<span><b>${itemTitle(i)}</b><small>${TARGETS[kind][i.target]} · ${RARITY[i.tier][kind]}</small><em>${assignment(i)}</em></span></button>`).join("") || "<p>Хранилище пусто. Здесь появятся открытые документы.</p>"}</div>
              ${item ? this.detailHTML(item) : ""}</div>`}
            <div class="archiveNotice" role="status">${this.notice}</div>
          </section>`;
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
