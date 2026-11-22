/* Kept-illumination metrics: kept-flux ratio, road points, detection-distance proxy, dark tunnel on the road.
   Pure: no DOM, no globals. */

/** Flux kept by ADB in the high-beam zone: Σ_k Σ_i w_ki·Φ_ki / Σ_k Σ_i Φ_ki over both lamps' segments.
    1 with every segment on, 0 with every segment off. NaN when there are no segments. */
export function keptFlux(lampModels, weights) {
  let kept = 0, full = 0;
  for (const k of ['L', 'R']) {
    const m = lampModels[k], w = weights[k] || [];
    m.segFlux.forEach((phi, i) => { const x = Math.max(0, Math.min(1, w[i] ?? 1)); kept += x * phi; full += phi; });
  }
  return full > 0 ? kept / full : NaN;
}

/** Default road points: the near road edge at 100 m and 150 m, own lane centre at 150 m, first oncoming lane at 100 m.
    y follows the ego frame (y left) for the road's traffic side; ego is in own lane 1 at y = 0. */
export function defaultRoadPoints(road) {
  const s = road.traffic === 'LHT' ? -1 : 1, w = road.laneWidth, n = Math.max(1, road.lanesPerDir | 0);
  const edge = road.traffic === 'LHT' ? 'Left edge' : 'Right edge';
  return [
    { label: `${edge}, 100 m`, x: 100, y: -s * w / 2 },
    { label: `${edge}, 150 m`, x: 150, y: -s * w / 2 },
    { label: 'Own lane centre, 150 m', x: 150, y: 0 },
    { label: 'Oncoming lane, 100 m', x: 100, y: s * n * w },
  ];
}

/** E at each point with ADB and with full high beam. fADB / fHB: (x, y) → lx. */
export function comparePoints(points, fADB, fHB) {
  return points.map(p => {
    const E_adb = fADB(p.x, p.y), E_hb = fHB(p.x, p.y);
    return { ...p, E_adb, E_hb, ratio: E_hb > 0 ? E_adb / E_hb : NaN };
  });
}

/** Detection-distance proxy: the first distance x ≥ x0 on the line y where E drops below thr. null if it never does by xMax. */
export function detectionDistance(fE, y, thr, { x0 = 10, xMax = 400, dx = 0.5 } = {}) {
  for (let k = 0; x0 + k * dx <= xMax + 1e-9; k++) { const x = x0 + k * dx; if (fE(x, y) < thr) return x; }
  return null;
}

/** Dark tunnel across the road at distance x: the widest run of y where E_ADB < frac·E_HB (with E_HB > eMin).
    Returns { yRight, yLeft, width } or null. */
export function tunnelOnRoad(fADB, fHB, x, { lim = 30, dy = 0.02, frac = 0.5, eMin = 1e-6 } = {}) {
  let best = null, start = null;
  const n = Math.round(2 * lim / dy);
  for (let k = 0; k <= n + 1; k++) {
    const y = -lim + k * dy;
    let dark = false;
    if (k <= n) { const hb = fHB(x, y); dark = hb > eMin && fADB(x, y) < frac * hb; }
    if (dark && start === null) start = y;
    if (!dark && start !== null) {
      const run = { yRight: start, yLeft: y - dy, width: y - dy - start };
      if (!best || run.width > best.width) best = run;
      start = null;
    }
  }
  return best;
}
