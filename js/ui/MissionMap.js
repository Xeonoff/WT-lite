/** Условная схема цели выбранного режима на карте приказа. */
export function drawMissionMap(canvas, mode) {
    const g = canvas.getContext("2d");
    g.save();
    g.scale(2, 2);
    g.fillStyle = "#182725";
    g.fillRect(0, 0, 280, 78);
    g.strokeStyle = "#344440";
    g.lineWidth = 0.6;
    g.beginPath();
    for (let x = 8; x < 280; x += 16) { g.moveTo(x, 0); g.lineTo(x, 78); }
    for (let y = 7; y < 78; y += 16) { g.moveTo(0, y); g.lineTo(280, y); }
    g.stroke();
    g.strokeStyle = "#4b5949";
    for (const [cx, cy] of [[30, -8], [178, 86], [296, 9]]) {
        for (let ring = 1; ring <= 6; ring++) {
            g.beginPath();
            for (let i = 0; i <= 64; i++) {
                const a = i * Math.PI / 32, r = ring * (6 + Math.sin(a * 3 + cx) + 0.6 * Math.sin(a * 5));
                const x = cx + r * Math.cos(a) * 1.65, y = cy + r * Math.sin(a);
                if (i) g.lineTo(x, y); else g.moveTo(x, y);
            }
            g.closePath(); g.stroke();
        }
    }
    const ally = "#89bfd1", enemy = "#e38a70", obj = "#ebc777";
    function route(x, y, ex, ey, color) {
        g.strokeStyle = g.fillStyle = color; g.lineWidth = 1.5;
        g.setLineDash([4, 3]); g.beginPath(); g.moveTo(x, y); g.lineTo(ex, ey); g.stroke(); g.setLineDash([]);
        g.save(); g.translate(ex, ey); g.rotate(Math.atan2(ey - y, ex - x));
        g.beginPath(); g.moveTo(1, 0); g.lineTo(-5, -3); g.lineTo(-5, 3); g.fill(); g.restore();
    }
    function marker(x, y, label) {
        g.save(); g.translate(x, y); g.rotate(Math.PI / 4);
        g.fillStyle = "#222e29"; g.fillRect(-7, -7, 14, 14);
        g.strokeStyle = obj; g.strokeRect(-7, -7, 14, 14); g.rotate(-Math.PI / 4);
        g.font = "bold 9px monospace"; g.fillStyle = obj; g.textAlign = "center"; g.fillText(label, 0, 3); g.restore();
    }
    if (mode === "domination") {
        marker(84, 52, "A"); marker(140, 26, "B"); marker(197, 46, "C");
        route(28, 62, 68, 55, ally); route(250, 16, 211, 37, enemy);
    } else if (mode === "waves") {
        marker(124, 46, "★"); route(30, 66, 105, 50, ally);
        for (const [x, y] of [[126, 5], [198, 15], [244, 55]]) route(x, y, 124 + (x - 124) * .26, 46 + (y - 46) * .4, enemy);
    } else if (mode === "boss") {
        marker(53, 59, "Ш"); route(243, 18, 73, 55, enemy);
        marker(105, 19, "Р1"); marker(151, 54, "Р2"); marker(202, 33, "Р3");
    } else if (mode === "duel") {
        route(39, 59, 121, 39, ally); route(240, 17, 158, 37, enemy);
    } else {
        for (const [x, y] of [[110, 33], [160, 21], [213, 39]]) {
            g.strokeStyle = enemy; g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.stroke();
            g.fillStyle = enemy; g.fillRect(x - 1.5, y - 1.5, 3, 3);
        }
        route(36, 63, 96, 40, ally);
    }
    g.restore();
}
