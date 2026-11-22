/* Beam view: draws an H-V intensity grid with segment boundaries, labels and hatched (off) segments.
   Draws only; every number comes from src/core. H+ is right, labelled L and R; V+ is up. */
import { hAt, vAt } from '../core/grid.js';

const RAMP = [[12, 16, 40], [40, 60, 140], [42, 120, 214], [27, 175, 122], [250, 178, 25], [235, 104, 52], [255, 245, 230]];

function colour(t) {
  t = Math.max(0, Math.min(1, t)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(t)), f = t - i, a = RAMP[i], b = RAMP[i + 1];
  return [0, 1, 2].map(k => Math.round(a[k] + (b[k] - a[k]) * f));
}

/** grid: { field, data }; max: colour-scale top (cd).
    overlay: { boundaries: [H°], spans: [{ h0, h1, v0, v1, hc, label, off, mixed }],
               boxes: [{ hMin, hMax, vMin, vMax, kind: 'detected' | 'margin', label }] }
    Returns { toHV(px, py) → [H, V] | null } for click handling. */
export function drawHVMap(canvas, grid, max, { boundaries = [], spans = [], boxes = [], cdFloor = 10 } = {}) {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth, cssH = canvas.clientHeight;
  canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const css = getComputedStyle(canvas);
  const text = css.getPropertyValue('--text-secondary').trim() || '#555';
  const frame = css.getPropertyValue('--grid').trim() || '#ddd';
  const { field, data } = grid;
  const H0 = field.h0, H1 = hAt(field, field.nH - 1), V0 = field.v0, V1 = vAt(field, field.nV - 1);
  const pad = { l: 44, r: 26, t: 36, b: 30 };
  const w = cssW - pad.l - pad.r, h = cssH - pad.t - pad.b;
  const x = hd => pad.l + (hd - H0) / (H1 - H0) * w;
  const y = vd => pad.t + (V1 - vd) / (V1 - V0) * h;

  // Heat map, log scale from cdFloor to max.
  const img = new ImageData(field.nH, field.nV);
  const lo = Math.log10(cdFloor), hi = Math.log10(Math.max(max, cdFloor * 10));
  for (let j = 0; j < field.nV; j++) for (let i = 0; i < field.nH; i++) {
    const c = colour((Math.log10(Math.max(data[j * field.nH + i], cdFloor)) - lo) / (hi - lo));
    const p = ((field.nV - 1 - j) * field.nH + i) * 4;
    img.data[p] = c[0]; img.data[p + 1] = c[1]; img.data[p + 2] = c[2]; img.data[p + 3] = 255;
  }
  const off = new OffscreenCanvas(field.nH, field.nV);
  off.getContext('2d').putImageData(img, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(off, pad.l, pad.t, w, h);

  ctx.save();
  ctx.beginPath(); ctx.rect(pad.l, pad.t, w, h); ctx.clip();
  // Hatch switched-off segments.
  for (const s of spans) {
    if (!s || !s.off) continue;
    const xa = x(s.h0), xb = x(s.h1), ya = y(s.v1), yb = y(s.v0);
    ctx.fillStyle = s.mixed ? 'rgba(0,0,0,0.15)' : 'rgba(0,0,0,0.35)'; ctx.fillRect(xa, ya, xb - xa, yb - ya);
    ctx.save(); ctx.beginPath(); ctx.rect(xa, ya, xb - xa, yb - ya); ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = -(yb - ya); k < xb - xa; k += 7) { ctx.moveTo(xa + k, yb); ctx.lineTo(xa + k + (yb - ya), ya); }
    ctx.stroke(); ctx.restore();
  }
  // Axes through 0 and segment boundaries.
  ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.beginPath(); ctx.moveTo(x(0), pad.t); ctx.lineTo(x(0), pad.t + h); ctx.moveTo(pad.l, y(0)); ctx.lineTo(pad.l + w, y(0)); ctx.stroke();
  ctx.setLineDash([4, 3]); ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  for (const b of boundaries) { ctx.beginPath(); ctx.moveTo(x(b), pad.t); ctx.lineTo(x(b), pad.t + h); ctx.stroke(); }
  ctx.setLineDash([]);
  // Target boxes: detected box solid, box with margins dashed, numbered.
  for (const b of boxes) {
    const xa = x(b.hMin), xb = x(b.hMax), ya = y(b.vMax), yb = y(b.vMin);
    ctx.lineWidth = b.kind === 'margin' ? 1.5 : 1.5;
    ctx.strokeStyle = b.kind === 'margin' ? '#ffd24a' : '#ffffff';
    ctx.setLineDash(b.kind === 'margin' ? [5, 3] : []);
    ctx.strokeRect(xa, ya, xb - xa, yb - ya);
    if (b.kind === 'margin' && b.label) {
      ctx.setLineDash([]); ctx.font = 'bold 11px system-ui, sans-serif'; ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(xa, ya - 15, ctx.measureText(b.label).width + 6, 14);
      ctx.fillStyle = '#ffd24a'; ctx.fillText(b.label, xa + 3, ya - 4);
    }
  }
  ctx.setLineDash([]);
  ctx.restore();
  ctx.strokeStyle = frame; ctx.strokeRect(pad.l, pad.t, w, h);

  // Segment numbers above the map; off segments say so in text, not only by hatching.
  ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'center';
  for (const s of spans) {
    if (!s || s.hc < H0 || s.hc > H1) continue; // label only segments whose centre is in view
    ctx.fillStyle = text;
    ctx.fillText(s.label, x(s.hc), pad.t - 18);
    // Text, not only hatching: 'off', or 'mix' when off in one lamp only; ✕ / ◐ where the word does not fit.
    if (s.off) ctx.fillText(x(s.h1) - x(s.h0) >= 22 ? (s.mixed ? 'mix' : 'off') : (s.mixed ? '◐' : '✕'), x(s.hc), pad.t - 6);
  }

  // Ticks.
  ctx.fillStyle = text; ctx.textAlign = 'center';
  const hStep = (H1 - H0) > 40 ? 10 : 5;
  for (let t = Math.ceil(H0 / hStep) * hStep; t <= H1; t += hStep) {
    ctx.fillText(t === 0 ? '0' : `${Math.abs(t)}° ${t < 0 ? 'L' : 'R'}`, x(t), pad.t + h + 14);
  }
  ctx.fillText('H', pad.l + w / 2, pad.t + h + 27);
  ctx.textAlign = 'right';
  const vStep = (V1 - V0) > 20 ? 5 : 2;
  for (let t = Math.ceil(V0 / vStep) * vStep; t <= V1; t += vStep) ctx.fillText(`${t}°`, pad.l - 6, y(t) + 4);

  return {
    toHV(px, py) {
      if (px < pad.l || px > pad.l + w || py < pad.t || py > pad.t + h) return null;
      return [H0 + (px - pad.l) / w * (H1 - H0), V1 - (py - pad.t) / h * (V1 - V0)];
    },
  };
}

/** Colour-scale legend: log ramp from floor to max. */
export function drawLegend(canvas, max, cdFloor = 10) {
  const dpr = window.devicePixelRatio || 1, cssW = canvas.clientWidth, cssH = canvas.clientHeight;
  canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const text = getComputedStyle(canvas).getPropertyValue('--text-secondary').trim() || '#555';
  const bw = Math.min(260, cssW - 120);
  for (let k = 0; k < bw; k++) { const c = colour(k / (bw - 1)); ctx.fillStyle = `rgb(${c})`; ctx.fillRect(44 + k, 4, 1, 10); }
  ctx.fillStyle = text; ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'left'; ctx.fillText(`${cdFloor} cd`, 44, 27);
  ctx.textAlign = 'right'; ctx.fillText(`${Math.round(max).toLocaleString()} cd (log scale)`, 44 + bw, 27);
}
