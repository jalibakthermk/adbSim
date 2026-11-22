/* Beam view: draws an H-V intensity grid (from core sampleHV) with segment boundaries. Draws only, computes nothing.
   H+ is right, labelled L and R; V+ is up. */

const RAMP = [[12, 16, 40], [40, 60, 140], [42, 120, 214], [27, 175, 122], [250, 178, 25], [235, 104, 52], [255, 245, 230]];

function colour(t) {
  t = Math.max(0, Math.min(1, t)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(t)), f = t - i, a = RAMP[i], b = RAMP[i + 1];
  return [0, 1, 2].map(k => Math.round(a[k] + (b[k] - a[k]) * f));
}

/** grid: { H[], V[], val[iV][iH], max }; opts: { edges: [H°], title, cdFloor } */
export function drawHVMap(canvas, grid, { edges = [], cdFloor = 10 } = {}) {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth, cssH = canvas.clientHeight;
  canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const css = getComputedStyle(canvas);
  const text = css.getPropertyValue('--text-secondary').trim() || '#555';
  const gridCol = css.getPropertyValue('--grid').trim() || '#ddd';
  const pad = { l: 44, r: 26, t: 22, b: 30 };
  const w = cssW - pad.l - pad.r, h = cssH - pad.t - pad.b;
  const { H, V, val, max } = grid;
  const x = hd => pad.l + (hd - H[0]) / (H.at(-1) - H[0]) * w;
  const y = vd => pad.t + (V.at(-1) - vd) / (V.at(-1) - V[0]) * h;

  // Heat map, log scale from cdFloor to max.
  const img = ctx.createImageData(H.length, V.length);
  const lo = Math.log10(cdFloor), hi = Math.log10(Math.max(max, cdFloor * 10));
  for (let j = 0; j < V.length; j++) for (let i = 0; i < H.length; i++) {
    const c = colour((Math.log10(Math.max(val[j][i], cdFloor)) - lo) / (hi - lo));
    const p = ((V.length - 1 - j) * H.length + i) * 4;
    img.data[p] = c[0]; img.data[p + 1] = c[1]; img.data[p + 2] = c[2]; img.data[p + 3] = 255;
  }
  const off = new OffscreenCanvas(H.length, V.length);
  off.getContext('2d').putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.drawImage(off, pad.l, pad.t, w, h);

  // Axes through 0, segment boundaries, ticks.
  ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath(); ctx.moveTo(x(0), pad.t); ctx.lineTo(x(0), pad.t + h); ctx.moveTo(pad.l, y(0)); ctx.lineTo(pad.l + w, y(0)); ctx.stroke();
  ctx.setLineDash([4, 3]); ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  for (const e of edges) { ctx.beginPath(); ctx.moveTo(x(e), pad.t); ctx.lineTo(x(e), pad.t + h); ctx.stroke(); }
  ctx.setLineDash([]);
  ctx.strokeStyle = gridCol; ctx.strokeRect(pad.l, pad.t, w, h);

  ctx.fillStyle = text; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'center';
  const hStep = (H.at(-1) - H[0]) > 40 ? 10 : 5;
  for (let t = Math.ceil(H[0] / hStep) * hStep; t <= H.at(-1); t += hStep) {
    const lbl = t === 0 ? '0' : `${Math.abs(t)}° ${t < 0 ? 'L' : 'R'}`;
    ctx.fillText(lbl, x(t), pad.t + h + 14);
  }
  ctx.fillText('H', pad.l + w / 2, pad.t + h + 27);
  ctx.textAlign = 'right';
  const vStep = (V.at(-1) - V[0]) > 20 ? 5 : 2;
  for (let t = Math.ceil(V[0] / vStep) * vStep; t <= V.at(-1); t += vStep) ctx.fillText(`${t}°`, pad.l - 6, y(t) + 4);
  ctx.textAlign = 'left'; ctx.fillText(`V (up)   ·   log scale ${cdFloor} … ${Math.round(max).toLocaleString()} cd`, pad.l, pad.t - 8);
}
