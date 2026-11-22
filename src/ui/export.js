/* Export: CSV (glare table, timeline), PNG of each view, project JSON (*.adb.json) save/load.
   The builders are pure (testable in Node); only download*() touch the DOM. The CSV header carries the version. */
import { VERSION, APP_NAME } from '../version.js';

const esc = v => {
  if (v == null || (typeof v === 'number' && !isFinite(v))) return '';
  const s = typeof v === 'number' ? String(+v.toPrecision(8)) : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV text: '# '-prefixed header lines, then a column row, then data rows. */
export function toCSV(headerLines, columns, rows) {
  return [...headerLines.map(l => `# ${l}`), columns.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))].join('\n') + '\n';
}

const header = (what, meta = {}) => [`${APP_NAME} v${VERSION} ${what}`, ...Object.entries(meta).map(([k, v]) => `${k}: ${v}`)];

/** Glare table rows (core glareTable + evaluateGlare) → CSV. */
export function glareCSV(rows, meta) {
  return toCSV(header('glare table', meta),
    ['target_no', 'target', 'type', 'point', 'point_id', 'd_m', 'E_adb_lx', 'E_low_only_lx', 'E_full_hb_lx', 'theta_deg', 'deBoer_W', 'E_max_lx', 'W_min', 'result'],
    rows.map(r => [r.n, r.target, r.type, r.point, r.pointId, r.d, r.E, r.E_low, r.E_hb, r.thDeg, r.W, r.E_max, r.W_min, r.status === 'none' ? 'no limit' : r.status]));
}

/** Scenario run (core runScenario) → CSV: one row per time step; per glare point d, E, limit, result;
    then kept flux and each segment's state per lamp. */
export function timelineCSV(run, meta) {
  const cols = ['t_s'];
  for (const s of run.series) cols.push(`${s.key}_d_m`, `${s.key}_E_lx`, `${s.key}_E_max_lx`, `${s.key}_result`);
  cols.push('kept_flux', 'fallback');
  const nSeg = { L: run.weights.L[0]?.length || 0, R: run.weights.R[0]?.length || 0 };
  for (const k of ['L', 'R']) for (let i = 0; i < nSeg[k]; i++) cols.push(`w_${k}${i + 1}`);
  const rows = run.t.map((t, n) => {
    const r = [t];
    for (const s of run.series) r.push(s.d[n], s.E[n], s.E_max[n], s.status[n] === 'none' ? 'no limit' : s.status[n]);
    r.push(run.kept[n], run.fallback[n] || '');
    for (const k of ['L', 'R']) r.push(...run.weights[k][n]);
    return r;
  });
  return toCSV(header('timeline', meta), cols, rows);
}

const PROJECT_KEYS = ['photometry', 'view', 'weights', 'vehicle', 'road', 'targets', 'controller', 'glare', 'roadView', 'metrics', 'scenario', 'limits'];

/** Project state → JSON text (*.adb.json). Embeds the IES text of every source file. Infinity is written as null. */
export function projectToJSON(state) {
  const out = { app: APP_NAME, format: 1, version: VERSION };
  for (const k of PROJECT_KEYS) out[k] = state[k];
  return JSON.stringify(out, (k, v) => (typeof v === 'number' && !isFinite(v) ? null : v), 1);
}

/** JSON text → partial state to merge over the defaults. Throws on a file that is not an adbSim project. */
export function projectFromJSON(text, defaults) {
  const o = JSON.parse(text);
  if (o.app !== APP_NAME || typeof o.format !== 'number') throw new Error('Not an adbSim project file (*.adb.json).');
  if (o.format > 1) throw new Error(`Project format ${o.format} is newer than this version of ${APP_NAME}.`);
  const st = {};
  for (const k of PROJECT_KEYS) if (o[k] !== undefined) {
    const d = defaults[k];
    st[k] = d && typeof d === 'object' && !Array.isArray(d) && o[k] && typeof o[k] === 'object' && !Array.isArray(o[k]) ? { ...d, ...o[k] } : o[k];
  }
  if (st.road && st.road.R == null) st.road.R = Infinity;
  if (st.controller && st.controller.maxTargets == null) st.controller.maxTargets = Infinity;
  return { state: st, version: o.version };
}

/* ---------------- DOM helpers ---------------- */

export function downloadText(name, text, type = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** PNG of a canvas, on the page background so it reads on its own. */
export function downloadCanvas(canvas, name) {
  const c = document.createElement('canvas'); c.width = canvas.width; c.height = canvas.height;
  const ctx = c.getContext('2d');
  ctx.fillStyle = getComputedStyle(document.body).backgroundColor || '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(canvas, 0, 0);
  c.toBlob(b => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, 'image/png');
}
