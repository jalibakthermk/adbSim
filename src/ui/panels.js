/* Input panels: small DOM helpers. No maths here. */

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Read the files chosen in an <input type=file> as [{ name, text }], in natural name order (seg_2 before seg_10). */
export async function readFiles(input) {
  const files = [...input.files].sort((a, b) => collator.compare(a.name, b.name));
  return Promise.all(files.map(async f => ({ name: f.name, text: await f.text() })));
}

/** Render one row of segment toggle buttons.
    states[i]: 'on' | 'off' | 'mixed'; labels[i]: text; onToggle(i) on click. */
export function renderToggles(container, { title, states, labels, onToggle }) {
  const row = document.createElement('div');
  row.className = 'toggle-row';
  if (title) { const t = document.createElement('span'); t.className = 'toggle-title'; t.textContent = title; row.append(t); }
  states.forEach((st, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `seg seg-${st}`;
    b.setAttribute('aria-pressed', st === 'on' ? 'true' : st === 'mixed' ? 'mixed' : 'false');
    b.title = `Segment ${labels[i]}: ${st === 'on' ? 'on' : st === 'off' ? 'off' : 'on in one lamp only'} (click to toggle)`;
    b.innerHTML = `<span class="seg-n">${labels[i]}</span><span class="seg-s">${st === 'on' ? 'on' : st === 'off' ? 'off' : 'mix'}</span>`;
    b.addEventListener('click', () => onToggle(i));
    row.append(b);
  });
  container.append(row);
}

/** Bind an <input>/<select> to obj[key]. parse: 'num' | 'int' | 'str' | 'bool'. Calls onChange after a valid edit. */
export function bindField(el, obj, key, parse, onChange) {
  const show = () => { if (parse === 'bool') el.checked = !!obj[key]; else el.value = obj[key] === Infinity ? '' : obj[key]; };
  show();
  el.addEventListener('change', () => {
    let v;
    if (parse === 'bool') v = el.checked;
    else if (parse === 'str') v = el.value;
    else { v = parse === 'int' ? parseInt(el.value, 10) : parseFloat(el.value); if (!isFinite(v)) { show(); return; } }
    obj[key] = v; onChange();
  });
  return show;
}

/** Editable target list: type, lane, distance, remove. */
export function renderTargets(container, targets, typeDefs, onChange) {
  container.textContent = '';
  targets.forEach((t, n) => {
    const row = document.createElement('div');
    row.className = 'target-row';
    const opts = Object.entries(typeDefs).map(([k, d]) => `<option value="${k}"${k === t.type ? ' selected' : ''}>${d.label}</option>`).join('');
    row.innerHTML = `<span class="tnum" title="Target ${n + 1}">${n + 1}</span>
      <select aria-label="Target ${n + 1} type">${opts}</select>
      <label class="l-lane">Lane <input type="number" min="1" step="1" value="${t.lane}" aria-label="Target ${n + 1} lane"></label>
      <label class="l-d">d (m) <input type="number" min="1" step="5" value="${t.d}" aria-label="Target ${n + 1} distance in m"></label>
      <button type="button" class="rm" aria-label="Remove target ${n + 1}" title="Remove">×</button>`;
    const [sel, lane, d] = row.querySelectorAll('select, input');
    sel.addEventListener('change', () => { t.type = sel.value; onChange(); });
    lane.addEventListener('change', () => { const v = parseInt(lane.value, 10); if (v >= 1) { t.lane = v; onChange(); } else lane.value = t.lane; });
    d.addEventListener('change', () => { const v = parseFloat(d.value); if (v > 0) { t.d = v; onChange(); } else d.value = t.d; });
    row.querySelector('.rm').addEventListener('click', () => { targets.splice(n, 1); onChange(true); });
    container.append(row);
  });
}

/** Pass/fail badge: always icon + text, never colour alone. */
export function statusBadge(st, title = '') {
  const t = { pass: ['✓', 'Pass'], fail: ['✗', 'Fail'], none: ['–', 'No limit'] }[st] || ['–', 'No limit'];
  return `<span class="st st-${st}" title="${title}"><span aria-hidden="true">${t[0]}</span> ${t[1]}</span>`;
}

export const fmtE = x => (x == null || !isFinite(x) ? '—' : x === 0 ? '0' : Math.abs(x) >= 100 ? x.toFixed(0) : x.toPrecision(3));

/** Glare table. rows from core glareTable() + evaluateGlare(). Numbers are formatted only. */
export function renderGlareTable(tbody, rows) {
  const f = fmtE;
  tbody.innerHTML = rows.length ? rows.map(r => {
    const why = [`E ${f(r.E)} lx vs limit ${r.E_max == null ? 'none' : f(r.E_max) + ' lx'}`,
      `de Boer W ${r.W.toFixed(2)} vs min ${r.W_min == null ? 'none' : r.W_min}`].join('; ');
    return `<tr>
    <td>${r.n} · ${r.target}</td><td>${r.point}</td><td class="num">${f(r.d)}</td>
    <td class="num strong">${f(r.E)}</td><td class="num">${f(r.E_low)}</td><td class="num">${f(r.E_hb)}</td>
    <td class="num">${isFinite(r.thDeg) ? r.thDeg.toFixed(2) : '—'}</td><td class="num">${r.W.toFixed(2)}</td>
    <td class="num">${r.E_max == null ? '—' : f(r.E_max)}</td><td>${statusBadge(r.status, why)}</td></tr>`;
  }).join('')
    : '<tr><td colspan="10" class="empty">No targets. Add one in the Targets panel.</td></tr>';
}

/** Metrics panel: tiles + road-point table. m from main (core numbers only). */
export function renderMetrics(el, m) {
  const pct = x => (isFinite(x) ? `${(100 * x).toFixed(1)} %` : '—');
  const dist = x => (x == null ? `> ${m.xMax} m` : `${x.toFixed(1)} m`);
  el.innerHTML = `
    <div class="tiles">
      <div class="tile"><div class="t-head">Glare verdict</div><div class="t-big">${statusBadge(m.verdict)}</div>
        <div class="t-sub">${m.verdict === 'none' ? 'No limit values in limits.json' : `${m.nFail} of ${m.nRows} points fail`}</div></div>
      <div class="tile"><div class="t-head">Kept flux (high-beam zone)</div><div class="t-big">${pct(m.kept)}</div>
        <div class="t-sub">Segment flux kept by ADB vs full high beam</div></div>
      <div class="tile"><div class="t-head">Detection distance proxy</div><div class="t-big">${dist(m.det.adb)}</div>
        <div class="t-sub">${m.det.label}: E first below ${m.thr} lx · full HB ${dist(m.det.hb)}</div></div>
      <div class="tile"><div class="t-head">Dark tunnel</div><div class="t-big">${m.tunnel ? `${m.tunnel.width.toFixed(2)} m` : '—'}</div>
        <div class="t-sub">${m.tunnel ? `Across the road at target ${m.tunnel.n} (${fmtE(m.tunnel.d)} m)` : 'No target in view'}</div></div>
    </div>
    <div class="table-wrap"><table class="glare">
      <thead><tr><th>Road point</th><th class="num">x (m)</th><th class="num">y (m)</th><th class="num">E ADB (lx)</th><th class="num">E full HB (lx)</th><th class="num">Kept</th></tr></thead>
      <tbody>${m.points.map(p => `<tr><td>${p.label}</td><td class="num">${p.x}</td><td class="num">${Math.abs(p.y).toFixed(2)} ${p.y < 0 ? 'R' : p.y > 0 ? 'L' : ''}</td>
        <td class="num strong">${fmtE(p.E_adb)}</td><td class="num">${fmtE(p.E_hb)}</td><td class="num">${pct(p.ratio)}</td></tr>`).join('')}</tbody>
    </table></div>`;
}
