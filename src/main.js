/* UI wiring. Phase 0: load the demo beams and show the full ADB beam (low + all segments at 100 %). */
import { parseIES } from './core/ies.js';
import { intensityHV, sampleHV } from './core/photometry.js';
import { createState } from './ui/state.js';
import { drawHVMap } from './ui/beamView.js';

const $ = id => document.getElementById(id);
const state = createState();

async function loadText(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.text();
}

async function loadDemo() {
  const meta = JSON.parse(await loadText('data/demo/segments.json'));
  state.photometry.lowBeam = parseIES(await loadText(`data/demo/${meta.lowBeam}`));
  state.photometry.segments = await Promise.all(meta.segments.map(async s => parseIES(await loadText(`data/demo/${s.file}`))));
  state.photometry.edges = meta.edges;
}

function render() {
  const { lowBeam, segments, edges } = state.photometry;
  const total = (h, v) => intensityHV(lowBeam, h, v) + segments.reduce((s, g) => s + intensityHV(g, h, v), 0);
  const grid = sampleHV(total, [-30, 30], [-8, 8], 0.25);
  drawHVMap($('beam'), grid, { edges });
  $('beamInfo').textContent = `Demo: low beam + ${segments.length} segments at 100 %. Peak ${Math.round(grid.max).toLocaleString()} cd. Dashed lines are segment boundaries.`;
}

loadDemo().then(() => {
  render();
  let t; addEventListener('resize', () => { clearTimeout(t); t = setTimeout(render, 150); });
}).catch(err => {
  $('beamInfo').textContent = `Could not load the demo beams (${err.message}). Serve the folder over HTTP, e.g. python3 -m http.server.`;
});
