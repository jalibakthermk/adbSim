/* Limits: validate and evaluate limits.json. No limit values live in code: they come only from the file,
   and the shipped file has nulls (= no limit). Pure: no DOM, no globals. */

/** Check the structure of a limits object. Returns a list of problems (empty = OK). */
export function validateLimits(L) {
  const e = [];
  if (!L || typeof L !== 'object') return ['Limits must be a JSON object.'];
  if (!Array.isArray(L.glare)) e.push('"glare" must be a list.');
  else L.glare.forEach((g, k) => {
    const at = `glare[${k}]`;
    if (typeof g.target !== 'string' || typeof g.point !== 'string') e.push(`${at}: "target" and "point" must be text.`);
    if (!Array.isArray(g.dist_m) || !Array.isArray(g.E_max_lx) || g.dist_m.length !== g.E_max_lx.length) e.push(`${at}: "dist_m" and "E_max_lx" must be lists of equal length.`);
    else {
      if (g.dist_m.some((d, i) => !(d > 0) || (i > 0 && d <= g.dist_m[i - 1]))) e.push(`${at}: "dist_m" must be positive and increasing.`);
      if (g.E_max_lx.some(v => v !== null && !(v >= 0))) e.push(`${at}: "E_max_lx" values must be ≥ 0 or null.`);
    }
  });
  if (L.deBoer_min != null && !(L.deBoer_min >= 1 && L.deBoer_min <= 9)) e.push('"deBoer_min" must be null or between 1 and 9.');
  return e;
}

/** Does a limit entry apply to this target type and glare point? "mirror" matches every mirror point. */
export function entryMatches(entry, type, pointId) {
  if (entry.target !== type) return false;
  return entry.point === pointId || (entry.point === 'mirror' && pointId.startsWith('mirror'));
}

/** E_max at distance d: exact or linear between the two neighbouring distances; null outside the listed range
    or when a neighbouring value is null. */
export function limitAt(entry, d) {
  const D = entry.dist_m, V = entry.E_max_lx;
  if (!D.length || d < D[0] - 1e-9 || d > D[D.length - 1] + 1e-9) return null;
  for (let i = 0; i < D.length; i++) if (Math.abs(d - D[i]) < 1e-9) return V[i];
  for (let i = 0; i + 1 < D.length; i++) if (d > D[i] && d < D[i + 1]) {
    if (V[i] == null || V[i + 1] == null) return null;
    return V[i] + (V[i + 1] - V[i]) * (d - D[i]) / (D[i + 1] - D[i]);
  }
  return null;
}

/** Evaluate glare rows ({ type, pointId, d, E, W }) against limits.
    Adds { E_max, eStatus, W_min, wStatus, status } with statuses 'pass' | 'fail' | 'none' (no limit). */
export function evaluateGlare(rows, limits) {
  return rows.map(r => {
    let E_max = null;
    for (const g of (limits && limits.glare) || []) {
      if (!entryMatches(g, r.type, r.pointId)) continue;
      const v = limitAt(g, r.d);
      if (v != null) E_max = E_max == null ? v : Math.min(E_max, v); // strictest applicable limit
    }
    const eStatus = E_max == null ? 'none' : r.E <= E_max ? 'pass' : 'fail';
    const W_min = limits && limits.deBoer_min != null ? limits.deBoer_min : null;
    const wStatus = W_min == null ? 'none' : r.W >= W_min ? 'pass' : 'fail';
    const status = eStatus === 'fail' || wStatus === 'fail' ? 'fail' : eStatus === 'pass' || wStatus === 'pass' ? 'pass' : 'none';
    return { ...r, E_max, eStatus, W_min, wStatus, status };
  });
}

/** Overall verdict over evaluated rows: 'fail' if any fails, 'pass' if any passes and none fails, else 'none'. */
export function overallStatus(rows) {
  if (rows.some(r => r.status === 'fail')) return 'fail';
  return rows.some(r => r.status === 'pass') ? 'pass' : 'none';
}
