/* UI wiring. Phase 1: segment photometry, lamp model, beam view, toggles.
   Phase 2: straight-road scene, targets, ADB controller (auto masking), glare table. */
import { parseIES } from './core/ies.js';
import { makeField, gridMax, cropGrid } from './core/grid.js';
import { buildLamp, lampGrid, sumGrids } from './core/photometry.js';
import { parseEdges, segmentAt, segmentSpans } from './core/segments.js';
import { createState } from './ui/state.js';
import { drawHVMap, drawLegend } from './ui/beamView.js';
import { readFiles, renderToggles, bindField, renderTargets, renderGlareTable } from './ui/panels.js';
import { buildScene } from './core/scene.js';
import { controllerUpdate } from './core/controller.js';
import { glareTable } from './core/glare.js';

const $ = id => document.getElementById(id);
const state = createState();
const P = state.photometry;
let lamps = null;   // { L, R } built lamp models
let mapApi = null;  // from drawHVMap, for click → H/V
let typeDefs = null; // from data/targets.json
let last = null;     // last computed { scene, ctrl, weights, rows }

/* ---------------- Loading ---------------- */

async function fetchText(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.text();
}

async function loadDemo() {
  const meta = JSON.parse(await fetchText('data/demo/segments.json'));
  const src = async f => ({ name: f, text: await fetchText(`data/demo/${f}`) });
  P.sources = {
    lowL: await src(meta.lowBeam), lowR: null,
    segL: await Promise.all(meta.segments.map(s => src(s.file))), segR: [],
    hbL: await src(meta.highBeam), hbR: null,
  };
  P.edgesText = meta.edges.join(', ');
  P.soft = meta.softEdge_deg;
  syncPanel();
  rebuild();
}

function parseSrc(s, label) {
  try { return parseIES(s.text); } catch (e) { throw new Error(`${label} (${s.name}): ${e.message}`); }
}

function lampSpec(side) {
  const S = P.sources, other = side === 'R';
  const lowSrc = (other && S.lowR) || S.lowL;
  const low = lowSrc ? parseSrc(lowSrc, `Low beam ${side}`) : null;
  if (P.mode === 'synthetic') {
    const hbSrc = (other && S.hbR) || S.hbL;
    if (!hbSrc) throw new Error('Load a high-beam IES for synthetic segmentation.');
    const { edges, errors } = parseEdges(P.edgesText);
    if (errors.length) throw new Error(errors.join(' '));
    if (!(P.soft >= 0)) throw new Error('Soft edge must be 0 or more degrees.');
    return { key: `${lowSrc?.name}|${hbSrc.name}`, spec: { low, highBeam: parseSrc(hbSrc, `High beam ${side}`), edges, soft: P.soft } };
  }
  const segSrc = (other && S.segR.length) ? S.segR : S.segL;
  return {
    key: `${lowSrc?.name}|${segSrc.map(s => s.name).join(',')}`,
    spec: { low, segments: segSrc.map((s, i) => parseSrc(s, `Segment ${side}${i + 1}`)) },
  };
}

function rebuild() {
  const msg = $('photoMsg');
  if (!P.sources.lowL && !P.sources.segL.length && !P.sources.hbL) { msg.textContent = 'Load the demo or your IES files.'; return; }
  msg.textContent = 'Building lamp model…';
  setTimeout(() => {
    try {
      const opt = { hdirRight: P.hdirRight, angleSys: P.angleSys, cForward: P.cForward };
      const field = makeField(P.field);
      const sL = lampSpec('L'), sR = lampSpec('R');
      const L = buildLamp(sL.spec, opt, field, P.supportFrac);
      const R = sR.key === sL.key ? L : buildLamp(sR.spec, opt, field, P.supportFrac);
      if (L.segs.length !== R.segs.length) throw new Error(`Left has ${L.segs.length} segments, right has ${R.segs.length}. Load the same number per side.`);
      lamps = { L, R };
      for (const k of ['L', 'R']) state.weights[k] = lamps[k].segs.map((_, i) => state.weights[k][i] ?? 1);
      const n = L.segs.length;
      msg.textContent = `${n} segment${n === 1 ? '' : 's'} per lamp (${L.mode === 'synthetic' ? 'synthetic segmentation' : 'segment files'}). ` +
        `Right lamp ${R === L ? 'uses the left files' : 'has its own files'}.`;
      msg.classList.remove('err');
      render();
    } catch (e) {
      msg.textContent = e.message; msg.classList.add('err');
    }
  }, 20);
}

/* ---------------- Rendering ---------------- */

const viewLamps = () => (state.view.lamp === 'LR' ? ['L', 'R'] : [state.view.lamp]);

/** Scene → controller → weights → glare rows. Numbers come only from src/core. */
function compute() {
  if (!lamps || !typeDefs) return null;
  const scene = buildScene({ vehicle: state.vehicle, road: state.road, targets: state.targets, typeDefs });
  const ctrl = controllerUpdate(scene, lamps, state.controller);
  const weights = state.controller.auto ? ctrl.weights : state.weights;
  const rows = glareTable(scene, lamps, weights, { La: state.glare.La });
  const n = Object.fromEntries(state.targets.map((t, i) => [t.id, i + 1]));
  rows.forEach(r => { r.n = n[r.targetId]; });
  return { scene, ctrl, weights, rows };
}

function segState(i, weights) {
  const ws = viewLamps().map(k => weights[k][i] > 0);
  return ws.every(Boolean) ? 'on' : ws.some(Boolean) ? 'mixed' : 'off';
}

function render() {
  if (!lamps) return;
  try { last = compute(); } catch (e) { $('sceneMsg').textContent = e.message; $('sceneMsg').classList.add('err'); return; }
  $('sceneMsg').textContent = ''; $('sceneMsg').classList.remove('err');
  const weights = last ? last.weights : state.weights;
  const ks = viewLamps();
  const grids = ks.map(k => lampGrid(lamps[k], weights[k]));
  const grid = grids.length > 1 ? sumGrids(grids) : grids[0];
  // Fixed colour scale: the all-on beam, so switching segments off visibly darkens the map.
  const fullMax = gridMax(ks.length > 1 ? sumGrids(ks.map(k => lampGrid(lamps[k]))) : lampGrid(lamps[ks[0]]));
  const ref = lamps[ks[0]];
  const spans = segmentSpans(ref.supports, ref.order, ref.boundaries).map((s, i) => { const st = segState(i, weights); return s && { ...s, label: String(i + 1), off: st !== 'on', mixed: st === 'mixed' }; });
  const boxes = [];
  if (last) last.ctrl.boxes.forEach((b, n) => ks.forEach(k => {
    const tag = ks.length > 1 ? `${n + 1}${k}` : String(n + 1);
    boxes.push({ ...b.lampRaw[k], kind: 'detected' }, { ...b.lamp[k], kind: 'margin', label: tag });
  }));
  const shown = state.view.zoom === 'zoom' ? cropGrid(grid, [-10, 10], [-4, 4]) : grid;
  mapApi = drawHVMap($('beam'), shown, fullMax, { boundaries: ref.boundaries.map(b => b.H), spans, boxes });
  drawLegend($('legend'), fullMax);
  const nOff = spans.filter(s => s && s.off).length;
  const fb = last?.ctrl.fallback && state.controller.auto
    ? ` Low-beam fallback active (${last.ctrl.fallback === 'distance' ? 'a target is closer than d_min' : 'more targets than the maximum'}).` : '';
  $('beamInfo').textContent = `${{ L: 'Left lamp', R: 'Right lamp', LR: 'Both lamps (sum)' }[state.view.lamp]} · ` +
    `peak ${Math.round(gridMax(grid)).toLocaleString()} cd · ${nOff} of ${spans.length} segments off ` +
    `(${state.controller.auto ? 'ADB auto' : 'manual'}).${fb} Solid box: detected target; dashed box: with margins.`;

  const box = $('toggles'); box.textContent = '';
  renderToggles(box, {
    title: ks.join(' + '),
    states: ref.segs.map((_, i) => segState(i, weights)),
    labels: ref.segs.map((_, i) => String(i + 1)),
    onToggle: toggle,
  });
  renderGlareTable($('glareBody'), last ? last.rows : []);
}

/** Manual toggle. In ADB auto mode the first toggle switches to manual, starting from the controller's weights. */
function toManual() {
  if (state.controller.auto && last) {
    state.weights = { L: [...last.ctrl.weights.L], R: [...last.ctrl.weights.R] };
    state.controller.auto = false; $('cAuto').checked = false;
  }
}

function toggle(i) {
  toManual();
  const turnOn = segState(i, state.weights) !== 'on';
  for (const k of viewLamps()) state.weights[k][i] = turnOn ? 1 : 0;
  render();
}

function setAll(on) {
  if (!lamps) return;
  toManual();
  for (const k of viewLamps()) state.weights[k] = state.weights[k].map(() => (on ? 1 : 0));
  render();
}

/* ---------------- Panel wiring ---------------- */

function syncPanel() {
  $('mode').value = P.mode;
  $('filesMode').hidden = P.mode !== 'files';
  $('synthMode').hidden = P.mode !== 'synthetic';
  $('edges').value = P.edgesText;
  $('soft').value = P.soft;
  $('angleSys').value = P.angleSys;
  $('hdir').value = P.hdirRight ? 'right' : 'left';
  $('cfwd').value = P.cForward;
  const S = P.sources, nm = (s, dflt) => (s ? s.name : dflt);
  $('nameLowL').textContent = nm(S.lowL, 'none');
  $('nameLowR').textContent = nm(S.lowR, 'same as left');
  $('nameSegL').textContent = S.segL.length ? `${S.segL.length} files: ${S.segL[0].name} … ${S.segL.at(-1).name}` : 'none';
  $('nameSegR').textContent = S.segR.length ? `${S.segR.length} files: ${S.segR[0].name} … ${S.segR.at(-1).name}` : 'same as left';
  $('nameHbL').textContent = nm(S.hbL, 'none');
  $('nameHbR').textContent = nm(S.hbR, 'same as left');
}

function onFile(id, key, multi = false) {
  $(id).addEventListener('change', async e => {
    const files = await readFiles(e.target);
    P.sources[key] = multi ? files : files[0] || null;
    e.target.value = '';
    syncPanel(); rebuild();
  });
}

onFile('fLowL', 'lowL'); onFile('fLowR', 'lowR');
onFile('fSegL', 'segL', true); onFile('fSegR', 'segR', true);
onFile('fHbL', 'hbL'); onFile('fHbR', 'hbR');

$('mode').addEventListener('change', e => { P.mode = e.target.value; syncPanel(); rebuild(); });
$('edges').addEventListener('change', e => { P.edgesText = e.target.value; rebuild(); });
$('soft').addEventListener('change', e => { P.soft = parseFloat(e.target.value); rebuild(); });
$('angleSys').addEventListener('change', e => { P.angleSys = e.target.value; rebuild(); });
$('hdir').addEventListener('change', e => { P.hdirRight = e.target.value === 'right'; rebuild(); });
$('cfwd').addEventListener('change', e => { P.cForward = parseFloat(e.target.value) || 0; rebuild(); });
$('demo').addEventListener('click', () => loadDemo().catch(err => { $('photoMsg').textContent = err.message; }));
$('clearR').addEventListener('click', () => { Object.assign(P.sources, { lowR: null, segR: [], hbR: null }); syncPanel(); rebuild(); });

$('view').addEventListener('change', e => { state.view.lamp = e.target.value; render(); });
$('zoom').addEventListener('change', e => { state.view.zoom = e.target.value; render(); });
$('allOn').addEventListener('click', () => setAll(true));
$('allOff').addEventListener('click', () => setAll(false));
$('beam').addEventListener('click', e => {
  if (!lamps || !mapApi) return;
  const r = e.currentTarget.getBoundingClientRect();
  const hv = mapApi.toHV(e.clientX - r.left, e.clientY - r.top);
  if (!hv) return;
  const i = segmentAt(lamps[viewLamps()[0]].segs, hv[0], hv[1]);
  if (i >= 0) toggle(i);
});
$('beam').addEventListener('mousemove', e => {
  if (!mapApi) return;
  const r = e.currentTarget.getBoundingClientRect();
  const hv = mapApi.toHV(e.clientX - r.left, e.clientY - r.top);
  $('cursor').textContent = hv ? `H ${Math.abs(hv[0]).toFixed(1)}° ${hv[0] < 0 ? 'L' : 'R'}, V ${hv[1].toFixed(1)}°` : '';
});

let resizeT; addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(render, 150); });

/* ---------------- Scene, targets, controller ---------------- */
const rerender = () => render();
[['vSpacing', state.vehicle, 'spacing', 'num'], ['vHeight', state.vehicle, 'hLamp', 'num'],
 ['vAimV', state.vehicle, 'aimV', 'num'], ['vAimH', state.vehicle, 'aimH', 'num'],
 ['camX', state.vehicle.camera, 'x', 'num'], ['camY', state.vehicle.camera, 'y', 'num'], ['camZ', state.vehicle.camera, 'z', 'num'],
 ['rTraffic', state.road, 'traffic', 'str'], ['rLaneW', state.road, 'laneWidth', 'num'], ['rLanes', state.road, 'lanesPerDir', 'int'],
 ['cAuto', state.controller, 'auto', 'bool'], ['cMarginH', state.controller, 'marginH', 'num'], ['cMarginV', state.controller, 'marginV', 'num'],
 ['cTunnel', state.controller, 'minTunnel', 'num'], ['cRule', state.controller, 'rule', 'str'],
 ['cDmin', state.controller, 'dMin', 'num'], ['cMaxT', state.controller, 'maxTargets', 'int'], ['gLa', state.glare, 'La', 'num'],
].forEach(([id, obj, key, parse]) => bindField($(id), obj, key, parse, rerender));

function showTargets() { renderTargets($('targetList'), state.targets, typeDefs, structural => { if (structural) showTargets(); render(); }); }
$('addTarget').addEventListener('click', () => {
  const id = Math.max(0, ...state.targets.map(t => t.id)) + 1;
  state.targets.push({ id, type: $('newType').value, lane: 1, d: 100 });
  showTargets(); render();
});

syncPanel();
fetchText('data/targets.json').then(t => {
  typeDefs = JSON.parse(t).types;
  $('newType').innerHTML = Object.entries(typeDefs).map(([k, d]) => `<option value="${k}">${d.label}</option>`).join('');
  showTargets(); render();
}).catch(err => { $('sceneMsg').textContent = `Could not load data/targets.json (${err.message}).`; });
loadDemo().catch(err => {
  $('photoMsg').textContent = `Could not load the demo beams (${err.message}). Serve the folder over HTTP, e.g. python3 -m http.server.`;
});
