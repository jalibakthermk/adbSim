/* Road view (bird's eye): banded isolux field with isolux lines, lane markings, targets to scale and lamps.
   Plot style ported from Road-illuminate. Draws only; every number comes from src/core.
   x (distance ahead) runs left → right; y (left +) runs up, labelled L and R. */
import { contourSegs } from '../core/road.js';

export const ISO_LEVELS = [0.5, 1, 3, 5, 10, 20, 50, 100];
const STOPS = [[22, 46, 84], [28, 92, 140], [23, 148, 152], [78, 184, 104], [214, 208, 70], [242, 154, 52], [226, 78, 58], [255, 226, 214]];

export function bandColour(t) {
  t = Math.min(1, Math.max(0, t)) * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(t)), f = t - i, a = STOPS[i], b = STOPS[i + 1];
  return [0, 1, 2].map(k => Math.round(a[k] + (b[k] - a[k]) * f));
}
const levelColours = levels => levels.map((_, i) => bandColour(levels.length > 1 ? i / (levels.length - 1) : 1));

function niceStep(range, target) {
  const r = range / target, p = Math.pow(10, Math.floor(Math.log10(r))), m = r / p;
  return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p;
}

/** g: road grid (core roadGrid). opts: { levels, markings: [{ name, y, style }], targets: [{ x0, x1, y0, y1, label }],
    lamps: [[x, y]] }. Returns { toXY(px, py) → [x, y] | null }. */
export function drawRoad(canvas, g, { levels = ISO_LEVELS, markings = [], targets = [], lamps = [] } = {}) {
  const dpr = window.devicePixelRatio || 1, W = canvas.clientWidth, Hh = canvas.clientHeight;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(Hh * dpr);
  const c = canvas.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const css = getComputedStyle(canvas), text = css.getPropertyValue('--text-secondary').trim() || '#555';
  const m = { l: 40, r: 14, t: 10, b: 26 }, pw = W - m.l - m.r, ph = Hh - m.t - m.b;
  const X = x => m.l + (x - g.x0) / (g.x1 - g.x0) * pw, Y = y => m.t + (g.y1 - y) / (g.y1 - g.y0) * ph;
  const cols = levelColours(levels);

  c.fillStyle = '#0d151d'; c.fillRect(m.l, m.t, pw, ph);
  // Banded field: each cell takes the colour of the highest level it reaches (rows flipped: y up).
  const img = new ImageData(g.nx, g.ny), d = img.data;
  for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
    const e = g.E[j * g.nx + i]; let bnd = -1;
    for (let l = 0; l < levels.length; l++) { if (e >= levels[l]) bnd = l; else break; }
    if (bnd < 0) continue;
    const k = 4 * ((g.ny - 1 - j) * g.nx + i), col = cols[bnd];
    d[k] = col[0]; d[k + 1] = col[1]; d[k + 2] = col[2]; d[k + 3] = 215;
  }
  const off = new OffscreenCanvas(g.nx, g.ny); off.getContext('2d').putImageData(img, 0, 0);
  c.imageSmoothingEnabled = true; c.drawImage(off, m.l, m.t, pw, ph);

  c.save(); c.beginPath(); c.rect(m.l, m.t, pw, ph); c.clip();
  const sx = niceStep(g.x1 - g.x0, 8), sy = niceStep(g.y1 - g.y0, 6);
  c.lineWidth = 1; c.strokeStyle = 'rgba(255,255,255,0.08)';
  for (let x = Math.ceil(g.x0 / sx) * sx; x <= g.x1; x += sx) { c.beginPath(); c.moveTo(X(x) + .5, m.t); c.lineTo(X(x) + .5, m.t + ph); c.stroke(); }
  // Isolux lines in their band colour (cell-centre index → pixels).
  const gx = i => m.l + (i + 0.5) / g.nx * pw, gy = j => m.t + (g.ny - 1 - j + 0.5) / g.ny * ph;
  levels.forEach((lv, l) => {
    if (lv > g.emax) return;
    const segs = contourSegs(g, lv); if (!segs.length) return;
    c.strokeStyle = `rgba(${cols[l].map(v => Math.min(255, v + 50))},0.95)`; c.beginPath();
    for (const [a, b] of segs) { c.moveTo(gx(a[0]), gy(a[1])); c.lineTo(gx(b[0]), gy(b[1])); }
    c.stroke();
  });
  // Lane markings.
  const pxPerM = pw / (g.x1 - g.x0);
  for (const mk of markings) {
    const yy = Y(mk.y), col = mk.style === 'centre' ? 'rgba(250,204,60,0.9)' : 'rgba(255,255,255,0.7)';
    c.strokeStyle = col; c.lineWidth = 1.4;
    c.setLineDash(mk.style === 'dashed' || mk.style === 'centre' ? [Math.max(3, 3 * pxPerM), Math.max(4, 9 * pxPerM)] : []);
    c.beginPath(); c.moveTo(m.l, yy); c.lineTo(m.l + pw, yy); c.stroke(); c.setLineDash([]);
  }
  // Targets to scale, numbered.
  c.font = '600 11px system-ui, sans-serif'; c.textBaseline = 'bottom'; c.textAlign = 'left';
  for (const t of targets) {
    const a = X(t.x0), b = X(t.x1), top = Y(t.y1), bot = Y(t.y0);
    c.fillStyle = 'rgba(255,255,255,0.85)'; c.fillRect(a, top, Math.max(2, b - a), Math.max(2, bot - top));
    c.lineWidth = 3; c.strokeStyle = 'rgba(13,21,29,0.85)'; c.strokeText(t.label, a, top - 2);
    c.fillStyle = '#ffd24a'; c.fillText(t.label, a, top - 2);
  }
  c.restore();
  // Lamps (arrows pointing forward).
  c.fillStyle = '#e6eef4';
  for (const [lx, ly] of lamps) { const px = X(Math.max(g.x0, lx)), py = Y(ly); c.beginPath(); c.moveTo(px, py - 4); c.lineTo(px + 8, py); c.lineTo(px, py + 4); c.closePath(); c.fill(); }
  // Axes: distance ahead below, lateral as L / R.
  c.fillStyle = text; c.font = '11px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'alphabetic';
  const xs = []; for (let x = Math.ceil(g.x0 / sx) * sx; x <= g.x1 + 1e-9; x += sx) xs.push(x);
  xs.forEach((x, i) => c.fillText(String(+x.toFixed(2)) + (i === xs.length - 1 ? ' m' : ''), Math.min(X(x), W - 18), Hh - 8));
  c.textAlign = 'right';
  for (let y = Math.ceil(g.y0 / sy) * sy; y <= g.y1 + 1e-9; y += sy) { const v = +y.toFixed(2); c.fillText(v === 0 ? '0' : Math.abs(v) + (v > 0 ? ' L' : ' R'), m.l - 5, Y(y) + 4); }

  return {
    toXY(px, py) {
      if (px < m.l || px > m.l + pw || py < m.t || py > m.t + ph) return null;
      return [g.x0 + (px - m.l) / pw * (g.x1 - g.x0), g.y1 - (py - m.t) / ph * (g.y1 - g.y0)];
    },
  };
}

/** Legend chips for the isolux bands. */
export function roadLegendHTML(levels = ISO_LEVELS) {
  return levelColours(levels).map((col, i) => `<span><i style="background:rgb(${col})"></i>${levels[i]}</span>`).join('') + '<span>lx</span>';
}
