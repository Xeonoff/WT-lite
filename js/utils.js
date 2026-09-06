export const TAU = Math.PI * 2;

export const rnd = (a = 1, b) =>
  b === undefined ? Math.random() * a : a + Math.random() * (b - a);
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
export const angDiff = (a, b) => {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};

export const $ = (id) => document.getElementById(id);
export const mkCv = (w, h) => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
};

export function rr(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export function segPt(px, py, qx, qy, x, y) {
  const dx = qx - px, dy = qy - py;
  const l2 = dx * dx + dy * dy || 1e-6;
  let t = ((x - px) * dx + (y - py) * dy) / l2;
  t = clamp(t, 0, 1);
  return Math.hypot(x - (px + dx * t), y - (py + dy * t));
}

export function star(g, x, y, r, col) {
  g.save();
  g.translate(x, y);
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr2 = i % 2 ? r * 0.45 : r;
    g.lineTo(Math.cos(a) * rr2, Math.sin(a) * rr2);
  }
  g.closePath();
  g.fillStyle = col;
  g.fill();
  g.restore();
}

export function poly(g, pts, X, Y) {
  g.beginPath();
  pts.forEach((p, i) =>
    i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1]))
  );
  g.closePath();
}

export function modStateColor(hp, max) {
  if (hp <= 0) return "#ff5147";
  if (hp < max * 0.6) return "#ffd23f";
  return "#57d977";
}