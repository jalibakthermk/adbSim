/* Regular H-V grids in the lamp frame (degrees, H+ right, V+ up). Pure: no DOM, no globals.
   A grid is { field, data } with field = { h0, v0, step, nH, nV } and data a Float32Array, row-major by V then H. */

/** Field from ranges: { H: [h0, h1], V: [v0, v1], step } → { h0, v0, step, nH, nV } (end points inclusive). */
export function makeField({ H: [h0, h1], V: [v0, v1], step }) {
  if (!(step > 0) || !(h1 > h0) || !(v1 > v0)) throw new Error('Field needs h1 > h0, v1 > v0 and step > 0');
  return { h0, v0, step, nH: Math.round((h1 - h0) / step) + 1, nV: Math.round((v1 - v0) / step) + 1 };
}

export const hAt = (field, i) => field.h0 + i * field.step;
export const vAt = (field, j) => field.v0 + j * field.step;

/** Sample f(H, V) on the field. */
export function resampleHV(f, field) {
  const data = new Float32Array(field.nH * field.nV);
  for (let j = 0; j < field.nV; j++) {
    const v = vAt(field, j);
    for (let i = 0; i < field.nH; i++) data[j * field.nH + i] = f(hAt(field, i), v);
  }
  return { field, data };
}

/** Bilinear value at (h, v); 0 outside the field. */
export function gridAt({ field, data }, h, v) {
  const x = (h - field.h0) / field.step, y = (v - field.v0) / field.step;
  if (x < -1e-9 || y < -1e-9 || x > field.nH - 1 + 1e-9 || y > field.nV - 1 + 1e-9) return 0;
  const i = Math.min(Math.floor(x), field.nH - 2), j = Math.min(Math.floor(y), field.nV - 2);
  const tx = Math.max(0, Math.min(1, x - i)), ty = Math.max(0, Math.min(1, y - j)), n = field.nH;
  const a = data[j * n + i] * (1 - tx) + data[j * n + i + 1] * tx;
  const b = data[(j + 1) * n + i] * (1 - tx) + data[(j + 1) * n + i + 1] * tx;
  return a * (1 - ty) + b * ty;
}

/** base + Σ w_i · grids_i on a shared field. base may be null. */
export function weightedSum(base, grids, weights) {
  const field = (base || grids[0]).field, n = field.nH * field.nV;
  const out = base ? Float32Array.from(base.data) : new Float32Array(n);
  grids.forEach((g, k) => {
    const w = weights[k] ?? 1;
    if (w === 0) return;
    const d = g.data;
    for (let p = 0; p < n; p++) out[p] += w * d[p];
  });
  return { field, data: out };
}

/** Largest value in a grid. */
export function gridMax({ data }) {
  let m = 0; for (let p = 0; p < data.length; p++) if (data[p] > m) m = data[p];
  return m;
}

/** Sum over V of each H column (Float64Array of length nH). */
export function colSums({ field, data }) {
  const out = new Float64Array(field.nH);
  for (let j = 0; j < field.nV; j++) for (let i = 0; i < field.nH; i++) out[i] += data[j * field.nH + i];
  return out;
}
