/* Segments: per-file segments or synthetic segmentation of one high beam, support boxes S_i and boundaries.
   Pure: no DOM, no globals. All angles in degrees in the lamp frame (H+ right, V+ up). */
import { hAt, vAt, colSums, gridAt } from './grid.js';

const smooth = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);

/** Soft step at boundary b: 0 well left of b, 1 well right, 0.5 at b. The transition spans `soft` degrees. */
export function edgeStep(h, b, soft) {
  return soft <= 0 ? (h >= b ? 1 : 0) : smooth((h - b + soft / 2) / soft);
}

/** Weight of segment i (between edges[i] and edges[i+1]) at horizontal angle h. The masks telescope, so they sum
    to edgeStep(h, edges[0]) − edgeStep(h, edges.at(-1)): exactly 1 inside the segmented field. */
export function segmentMask(h, i, edges, soft) {
  return edgeStep(h, edges[i], soft) - edgeStep(h, edges[i + 1], soft);
}

/** Parse a boundary list such as "-25, -16, -11 …" into ascending numbers. Returns { edges, errors }. */
export function parseEdges(text) {
  const toks = String(text).split(/[\s,;]+/).filter(Boolean);
  const edges = toks.map(Number), errors = [];
  if (toks.some((t, k) => !isFinite(edges[k]))) errors.push('Boundaries must be numbers (degrees).');
  else {
    if (edges.length < 2) errors.push('Enter at least two boundaries (one segment).');
    if (edges.some((e, k) => k > 0 && e <= edges[k - 1])) errors.push('Boundaries must increase from left to right.');
  }
  return { edges: errors.length ? [] : edges, errors };
}

/** Synthetic segmentation: segment i = high-beam grid × mask_i(H). Returns one grid per segment. */
export function syntheticSegments(hbGrid, edges, soft) {
  const { field, data } = hbGrid;
  return edges.slice(0, -1).map((_, k) => {
    const out = new Float32Array(data.length);
    for (let i = 0; i < field.nH; i++) {
      const m = segmentMask(hAt(field, i), k, edges, soft);
      if (m === 0) continue;
      for (let j = 0; j < field.nV; j++) out[j * field.nH + i] = data[j * field.nH + i] * m;
    }
    return { field, data: out };
  });
}

/** Support S_i: the H-V box where the segment gives more than `frac` of its own peak, widened by one grid step.
    Returns { hMin, hMax, vMin, vMax, peak } or null for an empty segment. */
export function supportBox({ field, data }, frac = 0.05) {
  let peak = 0; for (let p = 0; p < data.length; p++) if (data[p] > peak) peak = data[p];
  if (peak <= 0) return null;
  const thr = frac * peak;
  let i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity;
  for (let j = 0; j < field.nV; j++) for (let i = 0; i < field.nH; i++) {
    if (data[j * field.nH + i] > thr) { if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j; }
  }
  // Bilinear lookup gives light up to the next grid point, so widen by one step (clipped to the field):
  // a box in the last sub-step before a hard boundary must still switch the segment off.
  const s = field.step, hEnd = hAt(field, field.nH - 1), vEnd = vAt(field, field.nV - 1);
  return {
    hMin: Math.max(field.h0, hAt(field, i0) - s), hMax: Math.min(hEnd, hAt(field, i1) + s),
    vMin: Math.max(field.v0, vAt(field, j0) - s), vMax: Math.min(vEnd, vAt(field, j1) + s), peak,
  };
}

/** Flux-weighted centre H of a segment (from its column sums). NaN for an empty segment. */
export function centroidH(grid) {
  const cs = colSums(grid);
  let s = 0, sh = 0;
  for (let i = 0; i < cs.length; i++) { s += cs[i]; sh += cs[i] * hAt(grid.field, i); }
  return s > 0 ? sh / s : NaN;
}

/** Boundaries between neighbouring segments, ordered left to right by centroid.
    The boundary of a pair is the H where their V-integrated profiles cross (linear interpolation).
    Returns { order: [segment indices left→right], boundaries: [{ left, right, H }] }. */
export function segmentBoundaries(grids) {
  const cents = grids.map(centroidH);
  const order = grids.map((_, k) => k).filter(k => isFinite(cents[k])).sort((a, b) => cents[a] - cents[b]);
  const cs = grids.map(colSums), field = grids[0]?.field;
  const boundaries = [];
  for (let n = 0; n + 1 < order.length; n++) {
    const a = order[n], b = order[n + 1];
    const iA = Math.round((cents[a] - field.h0) / field.step), iB = Math.round((cents[b] - field.h0) / field.step);
    let H = (cents[a] + cents[b]) / 2;
    for (let i = iA; i < iB; i++) {
      const d0 = cs[a][i] - cs[b][i], d1 = cs[a][i + 1] - cs[b][i + 1];
      if (d0 >= 0 && d1 < 0) { H = hAt(field, i) + field.step * d0 / (d0 - d1); break; }
    }
    boundaries.push({ left: a, right: b, H });
  }
  return { order, boundaries };
}

/** Index of the segment contributing most at (h, v) on the grids, or -1 if none contributes. */
export function segmentAt(grids, h, v) {
  let best = -1, bestVal = 0;
  grids.forEach((g, k) => { const x = gridAt(g, h, v); if (x > bestVal) { bestVal = x; best = k; } });
  return best;
}

/** Display span of each segment: H from its neighbouring boundaries (outer sides from the support box),
    V from the support box. Returns per segment { h0, h1, v0, v1, hc } or null for an empty segment. */
export function segmentSpans(supports, order, boundaries) {
  const spans = supports.map(() => null);
  order.forEach((k, n) => {
    const s = supports[k]; if (!s) return;
    const h0 = n > 0 ? boundaries[n - 1].H : s.hMin;
    const h1 = n < order.length - 1 ? boundaries[n].H : s.hMax;
    spans[k] = { h0, h1, v0: s.vMin, v1: s.vMax, hc: (h0 + h1) / 2 };
  });
  return spans;
}
