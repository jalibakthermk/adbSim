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

/** Glare table. rows from core glareTable(). Numbers are formatted only. */
export function renderGlareTable(tbody, rows) {
  const f = x => (!isFinite(x) ? '—' : x === 0 ? '0' : x >= 100 ? x.toFixed(0) : x.toPrecision(3));
  tbody.innerHTML = rows.length ? rows.map(r => `<tr>
    <td>${r.n} · ${r.target}</td><td>${r.point}</td><td class="num">${f(r.d)}</td>
    <td class="num strong">${f(r.E)}</td><td class="num">${f(r.E_low)}</td><td class="num">${f(r.E_hb)}</td>
    <td class="num">${isFinite(r.thDeg) ? r.thDeg.toFixed(2) : '—'}</td><td class="num">${r.W.toFixed(2)}</td></tr>`).join('')
    : '<tr><td colspan="8" class="empty">No targets. Add one in the Targets panel.</td></tr>';
}
