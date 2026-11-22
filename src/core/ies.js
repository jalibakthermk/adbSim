/* IES LM-63 parsing, grid lookup and writing. Ported from GLEn v0.2. Pure: no DOM, no globals. */

/** Parse IES LM-63 text into { type: 'A'|'B'|'C', V, H, cd[iH][iV], nV, nH, peak, keywords }. */
export function parseIES(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  const ti = lines.findIndex(l => /^\s*TILT\s*=/i.test(l));
  if (ti < 0) throw new Error('No TILT= line found — is this an IES LM-63 file?');
  const tiltVal = lines[ti].split('=')[1].trim().toUpperCase();
  const toks = lines.slice(ti + 1).join(' ').trim().split(/[\s,]+/).filter(Boolean).map(Number);
  let p = 0;
  if (tiltVal === 'INCLUDE') { p++; const n = toks[p++]; p += 2 * n; }
  const header = toks.slice(p, p + 13); p += 13;
  if (header.length < 13 || header.some(isNaN)) throw new Error('Could not read the IES header numbers.');
  const [, , mult, nV, nH, ptype, , , , , ballast] = header;
  const V = toks.slice(p, p + nV); p += nV;
  const H = toks.slice(p, p + nH); p += nH;
  const cd = [];
  for (let i = 0; i < nH; i++) { cd.push(toks.slice(p, p + nV).map(x => Math.max(0, x * mult * (ballast || 1)))); p += nV; }
  if (cd.length !== nH || cd[nH - 1].length !== nV || cd[nH - 1].some(isNaN)) throw new Error('Candela table is incomplete.');
  const typeName = { 1: 'C', 2: 'B', 3: 'A' }[ptype] || '?';
  let peak = 0; for (const row of cd) for (const v of row) if (v > peak) peak = v;
  const keywords = lines.slice(0, ti).filter(s => s.trim().startsWith('[')).slice(0, 4).map(s => s.trim());
  return { type: typeName, V, H, cd, nV, nH, peak, keywords };
}

/** Index i such that arr[i] <= x <= arr[i+1]; -1 if outside. arr must be ascending. */
export function idx(arr, x) {
  const n = arr.length;
  if (n === 1) return x === arr[0] ? 0 : -1;
  if (x < arr[0] - 1e-9 || x > arr[n - 1] + 1e-9) return -1;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (arr[m] <= x) lo = m; else hi = m; }
  return lo;
}

/** Bilinear lookup on the file grid. h = horizontal / C angle, v = vertical / gamma (degrees). 0 outside. */
export function lookupRaw(ies, h, v) {
  const { H, V, cd } = ies;
  const j = idx(V, v); if (j < 0) return 0;
  let i;
  if (H.length === 1) i = 0; else { i = idx(H, h); if (i < 0) return 0; }
  const j2 = Math.min(j + 1, V.length - 1), i2 = Math.min(i + 1, H.length - 1);
  const tv = j2 === j ? 0 : (v - V[j]) / (V[j2] - V[j]);
  const th = i2 === i ? 0 : (h - H[i]) / (H[i2] - H[i]);
  const a = cd[i][j] * (1 - tv) + cd[i][j2] * tv;
  const b = cd[i2][j] * (1 - tv) + cd[i2][j2] * tv;
  return a * (1 - th) + b * th;
}

/** Serialise a parsed/synthetic IES object back to LM-63-2002 text (absolute photometry, lumens = -1). */
export function writeIES(ies, { keywords = ies.keywords || [], decimals = 1 } = {}) {
  const ptype = { C: 1, B: 2, A: 3 }[ies.type];
  if (!ptype) throw new Error(`Unknown photometric type "${ies.type}"`);
  const wrap = arr => {
    const out = [];
    for (let k = 0; k < arr.length; k += 10) out.push(arr.slice(k, k + 10).join(' '));
    return out.join('\n');
  };
  const fmt = x => +x.toFixed(decimals);
  return [
    'IESNA:LM-63-2002',
    ...keywords,
    'TILT=NONE',
    `1 -1 1 ${ies.V.length} ${ies.H.length} ${ptype} 2 0 0 0`,
    '1 1 0',
    wrap(ies.V),
    wrap(ies.H),
    ...ies.cd.map(row => wrap(row.map(fmt))),
    '',
  ].join('\n');
}
