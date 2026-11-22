/* Timeline: glare-point illuminance against time (log scale) with limits, and segment-state strips.
   Draws only; every number comes from the core scenario run. */

export const SERIES_COLOURS = ['#2a78d6', '#eb6834', '#1baf7a', '#9b59d0', '#d03b3b', '#b08600', '#16a3b8', '#7a7974'];

function setup(canvas) {
  const dpr = window.devicePixelRatio || 1, W = canvas.clientWidth, H = canvas.clientHeight;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  const c = canvas.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
  const css = getComputedStyle(canvas);
  return { c, W, H, text: css.getPropertyValue('--text-secondary').trim() || '#555', grid: css.getPropertyValue('--grid').trim() || '#ddd' };
}

/** E(t) per glare point (log y), limit as a dotted line where one exists, a cursor at tNow.
    Returns { toT(px) → t | null } for scrubbing. */
export function drawTimeline(canvas, run, { tNow = 0, eFloor = 1e-3 } = {}) {
  const { c, W, H, text, grid } = setup(canvas);
  const m = { l: 52, r: 14, t: 10, b: 28 }, pw = W - m.l - m.r, ph = H - m.t - m.b;
  const t0 = run.t[0], t1 = run.t.at(-1) || 1;
  let eMax = eFloor * 10;
  for (const s of run.series) for (let i = 0; i < s.E.length; i++) { eMax = Math.max(eMax, s.E[i], s.E_max[i] ?? 0); }
  const lo = Math.log10(eFloor), hi = Math.ceil(Math.log10(eMax));
  const X = t => m.l + (t - t0) / (t1 - t0 || 1) * pw;
  const Y = e => m.t + (hi - Math.log10(Math.max(e, eFloor))) / (hi - lo) * ph;

  c.strokeStyle = grid; c.lineWidth = 1; c.fillStyle = text; c.font = '11px system-ui, sans-serif';
  c.textAlign = 'right';
  for (let p = Math.ceil(lo); p <= hi; p++) {
    const y = Y(10 ** p); c.beginPath(); c.moveTo(m.l, y + .5); c.lineTo(m.l + pw, y + .5); c.stroke();
    c.fillText(p >= 0 ? String(10 ** p) : (10 ** p).toFixed(-p), m.l - 6, y + 4);
  }
  c.textAlign = 'center';
  const step = (t1 - t0) > 8 ? 2 : (t1 - t0) > 3 ? 1 : 0.5;
  for (let t = Math.ceil(t0 / step) * step; t <= t1 + 1e-9; t += step) c.fillText(`${+t.toFixed(2)}${t + step > t1 + 1e-9 ? ' s' : ''}`, X(t), H - 10);
  c.save(); c.translate(12, m.t + ph / 2); c.rotate(-Math.PI / 2); c.fillText('E (lx, log)', 0, 0); c.restore();

  c.save(); c.beginPath(); c.rect(m.l, m.t, pw, ph); c.clip();
  run.series.forEach((s, k) => {
    const col = SERIES_COLOURS[k % SERIES_COLOURS.length];
    // Limit (dotted), only where a value applies.
    c.strokeStyle = col; c.lineWidth = 1.25; c.setLineDash([2, 3]); c.beginPath();
    let pen = false;
    s.E_max.forEach((v, i) => { if (v == null) { pen = false; return; } const x = X(run.t[i]), y = Y(v); pen ? c.lineTo(x, y) : c.moveTo(x, y); pen = true; });
    c.stroke(); c.setLineDash([]);
    // E (solid).
    c.lineWidth = 2; c.beginPath();
    s.E.forEach((e, i) => { const x = X(run.t[i]), y = Y(e); i ? c.lineTo(x, y) : c.moveTo(x, y); });
    c.stroke();
    // Fail markers: an ✗ on top of the line (status is never shown by colour alone).
    c.fillStyle = col; c.font = 'bold 11px system-ui, sans-serif'; c.textAlign = 'center';
    let lastX = -99;
    s.status.forEach((st, i) => { if (st !== 'fail') return; const x = X(run.t[i]); if (x - lastX < 10) return; lastX = x; c.fillText('✗', x, Y(s.E[i]) - 4); });
  });
  c.restore();
  // Cursor.
  c.strokeStyle = text; c.lineWidth = 1; c.setLineDash([4, 3]);
  c.beginPath(); c.moveTo(X(tNow) + .5, m.t); c.lineTo(X(tNow) + .5, m.t + ph); c.stroke(); c.setLineDash([]);
  c.strokeStyle = grid; c.strokeRect(m.l, m.t, pw, ph);

  return { toT(px) { return px < m.l || px > m.l + pw ? null : t0 + (px - m.l) / pw * (t1 - t0); } };
}

/** Segment state over time for one lamp: one row per segment (1 at the top), filled = on, empty = off. */
export function drawSegmentStrip(canvas, run, lamp, { tNow = 0, label = lamp } = {}) {
  const { c, W, H, text, grid } = setup(canvas);
  const ws = run.weights[lamp]; if (!ws.length) return;
  const n = ws[0].length, m = { l: 52, r: 14, t: 4, b: 4 }, pw = W - m.l - m.r, ph = H - m.t - m.b;
  const t0 = run.t[0], t1 = run.t.at(-1) || 1, rowH = ph / n;
  const X = t => m.l + (t - t0) / (t1 - t0 || 1) * pw;
  const on = getComputedStyle(canvas).getPropertyValue('--accent').trim() || '#2a78d6';
  for (let i = 0; i < n; i++) {
    const y = m.t + i * rowH;
    for (let k = 0; k < run.t.length; k++) {
      const w = ws[k][i]; if (!(w > 0)) continue;
      const x0 = X(run.t[k]), x1 = k + 1 < run.t.length ? X(run.t[k + 1]) : m.l + pw;
      c.globalAlpha = 0.25 + 0.75 * w; c.fillStyle = on; c.fillRect(x0, y + 0.5, Math.max(1, x1 - x0 + 0.5), rowH - 1);
    }
    c.globalAlpha = 1;
  }
  c.strokeStyle = grid; c.strokeRect(m.l, m.t, pw, ph);
  c.fillStyle = text; c.font = '10px system-ui, sans-serif'; c.textAlign = 'right';
  c.fillText(`${label} 1`, m.l - 6, m.t + rowH * 0.5 + 3); c.fillText(String(n), m.l - 6, m.t + ph - rowH * 0.5 + 3);
  c.strokeStyle = text; c.setLineDash([4, 3]); c.beginPath(); c.moveTo(X(tNow) + .5, m.t); c.lineTo(X(tNow) + .5, m.t + ph); c.stroke(); c.setLineDash([]);
}

/** Legend for the timeline series. */
export function timelineLegendHTML(run, nOf) {
  return run.series.map((s, k) => `<span><i style="background:${SERIES_COLOURS[k % SERIES_COLOURS.length]}"></i>${nOf(s.targetId)} · ${s.point}</span>`).join('') +
    '<span>solid: E · dotted: limit · ✗: fail</span>';
}
