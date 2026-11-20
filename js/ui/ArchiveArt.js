/** Четыре миниатюры рисуются один раз, цвет печати соответствует редкости. */
const cache = new Map();
export function archiveArt(kind, sealed, ink = "#bb9657") {
    const key = [kind, sealed, ink].join("/");
    if (cache.has(key)) return cache.get(key);
    const canvas = document.createElement("canvas");
    canvas.width = 208; canvas.height = 144;
    const g = canvas.getContext("2d");
    g.scale(2, 2);
    function poly(fill, points) {
        g.beginPath(); g.moveTo(...points[0]);
        for (const p of points.slice(1)) g.lineTo(...p);
        g.closePath(); g.fillStyle = fill; g.fill();
    }
    function rect(x, y, w, h, fill) { g.fillStyle = fill; g.fillRect(x, y, w, h); }
    function circle(x, y, r, color) { g.fillStyle = color; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
    function lines(points, color, width = 1) {
        g.strokeStyle = color; g.lineWidth = width; g.beginPath(); g.moveTo(...points[0]);
        for (const p of points.slice(1)) g.lineTo(...p);
        g.stroke();
    }
    g.translate(52, 37); g.rotate(sealed ? -.09 : -.06); g.translate(-52, -37);
    if (sealed && kind === "dossier") {
        poly("#4c493b", [[10,20],[76,15],[92,24],[25,32]]);
        for (let i = 0; i < 5; i++) {
            const y = 16 + i * 2;
            poly(i % 2 ? "#b2a58a" : "#dbccaa", [[15,y],[74,y-3],[87,y+3],[25,y+9]]);
        }
        poly("#79664b", [[10,21],[26,29],[26,63],[12,54]]);
        poly("#988459", [[26,29],[92,23],[88,58],[26,63]]);
        lines([[26,33],[91,27]], "#c3af7a", 2);
        rect(43,37,29,12,"#514d3f"); rect(45,39,25,8,"#dbccac");
        lines([[49,43],[66,42]],"#736a55"); rect(52,51,11,3,"#4c4435");
    } else if (sealed) {
        poly("#846739", [[11,20],[35,18],[40,13],[78,13],[85,55],[17,60]]);
        poly("#dfce9e", [[17,20],[80,16],[88,52],[21,55]]);
        poly("#385d66", [[19,25],[83,19],[89,52],[22,57]]);
        poly("#b79a61", [[11,27],[41,27],[46,22],[94,22],[86,60],[19,62]]);
        lines([[20,57],[83,55]],"#e2c998"); rect(58,33,22,12,"#dbcfad");
        lines([[61,41],[66,36],[75,38]],"#507071",1.4);
        lines([[27,28],[33,60]],"#817250",3);
    } else if (kind === "dossier") {
        rect(24,7,59,58,"#87765a"); rect(21,5,60,58,"#d7caab");
        rect(25,9,52,3,"#9e8a68"); rect(27,17,22,29,"#797b69");
        poly("#323c35",[[28,44],[30,37],[37,33],[43,35],[48,41],[48,45]]);
        circle(38,27,6,"#c4ae88"); poly("#394339",[[31,24],[32,19],[44,19],[45,23],[40,25]]);
        for(let i=0;i<5;i++) rect(53,18+i*5, i%2 ? 16 : 21,1,"#8c8068");
        rect(28,50,27,1,"#918268"); rect(28,54,18,1,"#918268");
        circle(67,51,8,ink); circle(67,51,6,"#5b5547"); circle(67,51,4,ink);
    } else {
        rect(12,13,79,49,"#203a44"); rect(10,10,80,49,"#345865");
        for(let x=15;x<89;x+=6) rect(x,11,.5,46,"#527782");
        for(let y=15;y<58;y+=6) rect(11,y,78,.5,"#527782");
        g.strokeStyle="#c2d9cc";g.strokeRect(14,14,72,41);
        const pts=[];
        for(let i=0;i<=48;i++){const a=i*Math.PI/24,r=i%4===1||i%4===2?13:11;pts.push([39+r*Math.cos(a),34+r*Math.sin(a)]);}
        lines(pts,"#cfdfce",1.4); circle(39,34,5,"#bad2c9");circle(39,34,3,"#345865");
        lines([[58,23],[63,23],[63,20],[69,20],[69,23],[78,23],[78,44],[69,44],[69,47],[63,47],[63,44],[58,44],[58,23]],"#c0d3ca");
        rect(52,50,28,2,ink);
    }
    const url = canvas.toDataURL();
    cache.set(key, url);
    return url;
}
