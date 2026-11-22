/* Road illuminance grid, isolux contours, range and width. Ported from Road-illuminate (web tool).
   Pure: no DOM, no globals. Road frame = ego frame: x forward, y left, z up, origin on the road under the lamp midpoint.
   Two methods, as in Road-illuminate:
   - 'vertical' (default, HSPR / GTB): illuminance on a vertical plane facing the vehicle at height evalH, E = I·x / D³
   - 'road': horizontal illuminance on the road surface, E = I·h / D³ */
import { toLampFrame, dirToHV } from './frames.js';
import { gridAt } from './grid.js';
import { lampGrid } from './photometry.js';

/** Lamp sources for road evaluation: each lamp's total intensity grid for its weights, with position and aim. */
export function roadSources(scene, lampModels, weights) {
  return ['L', 'R'].map(k => ({ ...scene.lamps[k], grid: lampGrid(lampModels[k], (weights && weights[k]) || []) }));
}

/** Illuminance (lx) at road point (x, y) from the sources. */
export function roadE(x, y, sources, { method = 'vertical', evalH = 0 } = {}) {
  let E = 0;
  const zp = method === 'vertical' ? evalH : 0;
  for (const s of sources) {
    if (!s.grid) continue;
    const vx = x - s.pos[0], vy = y - s.pos[1], vz = zp - s.pos[2];
    if (vx <= 0) continue;
    const [H, V] = dirToHV(...toLampFrame(vx, vy, vz, s.aimV, s.aimH));
    const I = gridAt(s.grid, H, V); if (!I) continue;
    const D2 = vx * vx + vy * vy + vz * vz;
    E += I * (method === 'vertical' ? vx : s.pos[2]) / (D2 * Math.sqrt(D2));
  }
  return E;
}

/** Sample f(x, y) at cell centres. Row j has y = y0 + (j + 0.5)·dy (increasing y = leftwards).
    Returns { x0, x1, y0, y1, nx, ny, E: Float32Array, emax, at: [x, y] }. */
export function roadGrid({ x0, x1, y0, y1, nx, ny }, f) {
  const E = new Float32Array(nx * ny);
  let emax = 0, at = [x0, y0];
  for (let j = 0; j < ny; j++) {
    const y = y0 + (j + 0.5) / ny * (y1 - y0);
    for (let i = 0; i < nx; i++) {
      const x = x0 + (i + 0.5) / nx * (x1 - x0);
      const e = f(x, y); E[j * nx + i] = e;
      if (e > emax) { emax = e; at = [x, y]; }
    }
  }
  return { x0, x1, y0, y1, nx, ny, E, emax, at };
}

/** Element-wise a − b of two grids with the same layout. */
export function diffGrid(a, b) {
  const E = new Float32Array(a.E.length); let emax = 0, k = 0;
  for (let p = 0; p < E.length; p++) { E[p] = a.E[p] - b.E[p]; if (E[p] > emax) { emax = E[p]; k = p; } }
  const i = k % a.nx, j = Math.floor(k / a.nx);
  return { ...a, E, emax, at: [a.x0 + (i + 0.5) / a.nx * (a.x1 - a.x0), a.y0 + (j + 0.5) / a.ny * (a.y1 - a.y0)] };
}

/** Isolux line segments at `level` by marching squares, in fractional cell-index coordinates [i, j]. */
export function contourSegs(g, level) {
  const { E, nx } = g, segs = [];
  const t = (a, b) => (level - a) / (b - a);
  for (let j = 0; j < g.ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const tl = E[j * nx + i], tr = E[j * nx + i + 1], br = E[(j + 1) * nx + i + 1], bl = E[(j + 1) * nx + i];
    const c = (tl >= level ? 8 : 0) | (tr >= level ? 4 : 0) | (br >= level ? 2 : 0) | (bl >= level ? 1 : 0);
    if (c === 0 || c === 15) continue;
    const T = () => [i + t(tl, tr), j], R = () => [i + 1, j + t(tr, br)], B = () => [i + t(bl, br), j + 1], Lf = () => [i, j + t(tl, bl)];
    const add = (a, b) => segs.push([a(), b()]);
    switch (c) {
      case 1: case 14: add(Lf, B); break; case 2: case 13: add(B, R); break; case 3: case 12: add(Lf, R); break;
      case 4: case 11: add(T, R); break; case 5: add(T, R); add(Lf, B); break; case 6: case 9: add(T, B); break;
      case 7: case 8: add(T, Lf); break; case 10: add(T, Lf); add(B, R); break;
    }
  }
  return segs;
}

/** Farthest x on the line y = const where E ≥ thr (Road-illuminate range). null if never reached. */
export function rangeOn(fE, y, thr, { xMax = 400, dx = 0.1 } = {}) {
  let last = null;
  for (let k = 1; k * dx <= xMax + 1e-9; k++) { const x = k * dx; if (fE(x, y) >= thr) last = x; }
  return last;
}

/** Outermost lit points across the road at distance x: [yRight, yLeft] where E ≥ thr, or null. */
export function widthAt(fE, x, thr, { lim = 40, dy = 0.05 } = {}) {
  let a = null, b = null;
  for (let k = 0; -lim + k * dy <= lim + 1e-9; k++) {
    const y = -lim + k * dy;
    if (fE(x, y) >= thr) { if (a === null) a = y; b = y; }
  }
  return a === null ? null : [a, b];
}

/** Lane markings for the ego frame (ego in own lane 1 at y = 0). Returns [{ name, y, style }]. */
export function laneMarkings(road) {
  const w = road.laneWidth, n = Math.max(1, road.lanesPerDir | 0), s = road.traffic === 'LHT' ? -1 : 1;
  const near = road.traffic === 'LHT' ? 'Left' : 'Right', far = road.traffic === 'LHT' ? 'Right' : 'Left';
  const mk = [{ name: `${near} edge`, y: -w / 2, style: 'solid' }];
  for (let i = 1; i < n; i++) mk.push({ name: 'Lane line', y: -w / 2 + i * w, style: 'dashed' });
  mk.push({ name: 'Centre line', y: (n - 0.5) * w, style: 'centre' });
  for (let i = 1; i < n; i++) mk.push({ name: 'Oncoming lane line', y: (n - 0.5 + i) * w, style: 'dashed' });
  mk.push({ name: `${far} edge`, y: (2 * n - 0.5) * w, style: 'solid' });
  return mk.map(m => ({ ...m, y: +(s * m.y).toFixed(6) }));
}
