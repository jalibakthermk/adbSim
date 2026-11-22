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
