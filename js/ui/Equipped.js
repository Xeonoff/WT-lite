import { RARITY, slotName } from "../data/Archive.js";
import { cardFor } from "../data/ArchiveCards.js";
import { archiveArt } from "./ArchiveArt.js";

function icon(item) {
    return '<img alt="" src="' + archiveArt(item.kind,false,RARITY[item.tier].color) + '">';
}
export function markEquipment(el,def,items) {
    if (!items.length) return;
    el.dataset.document = items[0].kind;
    el.title = [el.title,...items.map(i=>slotName(def,i.kind,i.slot)+" · "+cardFor(i).name)].filter(Boolean).join("\n");
}
export function treeEquipment(def,items) {
    if (!items?.length) return "";
    const summary = items.map(i=>slotName(def,i.kind,i.slot)+" · "+cardFor(i).name).join("&#10;");
    const groups = ["dossier","plan"].map(kind=>{
        const matching = items.filter(i=>i.kind===kind);
        return matching.length ? `<i>${icon(matching[0])}${matching.length}</i>` : "";
    });
    return `<div class="treeDocs" title="${summary}" aria-label="${summary}">${groups.join("")}</div>`;
}

export function equipmentRows(def,items) {
    return items.map(i=>{
        const c = cardFor(i), r = RARITY[i.tier];
        return `<div class="equippedDoc" style="--rarity:${r.color}" title="${c.text}">${icon(i)}
            <div><b>${c.name}</b><small>${slotName(def,i.kind,i.slot)} · ${r[i.kind]}</small><p>${c.text}</p></div>
            ${c.stack ? `<em data-stack="${i.id}">0/${c.stack.cap}</em>` : ""}</div>`;
    }).join("");
}
