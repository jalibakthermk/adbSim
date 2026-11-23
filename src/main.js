/* UI wiring. Phase 1: segment photometry, lamp model, beam view, toggles.
   Phase 2: straight-road scene, targets, ADB controller (auto masking), glare table.
   Phase 3: road view, kept-illumination metrics, limits. Phase 4: dynamic scenarios, latency, timeline, export. */
import { parseIES } from './core/ies.js';
import { makeField, gridMax, cropGrid } from './core/grid.js';
import { buildLamp, lampGrid, sumGrids } from './core/photometry.js';
import { parseEdges, segmentAt, segmentSpans } from './core/segments.js';
import { createState } from './ui/state.js';
import { drawHVMap, drawLegend } from './ui/beamView.js';
import { readFiles, renderToggles, bindField, renderTargets, renderGlareTable, renderMetrics, fmtE } from './ui/panels.js';
import { buildScene } from './core/scene.js';
import { controllerUpdate } from './core/controller.js';
import { glareTable } from './core/glare.js';
import { roadSources, roadE, roadGrid, diffGrid, laneMarkings } from './core/road.js';
import { keptFlux, defaultRoadPoints, comparePoints, detectionDistance, tunnelOnRoad } from './core/metrics.js';
import { validateLimits, evaluateGlare, overallStatus } from './core/limits.js';
import { drawRoad, roadLegendHTML } from './ui/roadView.js';
import { stepAt, runScenario, timeToDistance } from './core/scenario.js';
import { drawTimeline, drawSegmentStrip, timelineLegendHTML } from './ui/timeline.js';
import { glareCSV, timelineCSV, projectToJSON, projectFromJSON, downloadText, downloadCanvas } from './ui/export.js';
import { VERSION, APP_NAME } from './version.js';
import { buildRoadScenario, frameTimes } from './core/exchange.js';

const $ = id => document.getElementById(id);
const state = createState();
const P = state.photometry;
let lamps = null;   // { L, R } built lamp models
let mapApi = null;  // from drawHVMap, for click → H/V
let typeDefs = null; // from data/targets.json
let last = null;     // last computed { scene, ctrl, weights, rows, road }
let roadApi = null;  // from drawRoad, for hover → x/y
let run = null;      // last scenario run (dynamic mode)
let runDirty = true; // inputs changed since the last run
let tlApi = null;    // from drawTimeline, for scrubbing
const shows = [];    // re-display functions of bound fields (after loading a project)

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

/** Configuration for the core scenario step, from the UI state. */
function scenarioCfg() {
  return {
    vehicle: state.vehicle, road: state.road, targets: state.targets, typeDefs,
    vEgo_kmh: state.scenario.vEgo_kmh, controller: state.controller,
    auto: state.controller.auto, manualWeights: state.weights, La: state.glare.La, limits: state.limits,
  };
}
const dynamic = () => !!state.scenario.dynamic;
const latency = () => (dynamic() ? (state.controller.latency_ms || 0) / 1000 : 0);

/** Scene (at the playback time) → delayed controller → weights → glare rows. Numbers come only from src/core. */
function compute() {
  if (!lamps || !typeDefs) return null;
  const t = dynamic() ? state.scenario.time : 0;
  const cfg = scenarioCfg();
  // Static mode: targets stand still at d (speeds ignored).
  const st = stepAt(dynamic() ? cfg : { ...cfg, vEgo_kmh: 0, targets: state.targets.map(x => ({ ...x, speed_kmh: 0 })) }, lamps, t, latency());
  const { scene, ctrl, weights, rows } = st;
  const n = Object.fromEntries(state.targets.map((x, i) => [x.id, i + 1]));
  rows.forEach(r => { r.n = n[r.targetId]; });
  // Road: ADB and full high beam (all segments on), same lamps and geometry.
  const opt = { method: state.roadView.method, evalH: state.roadView.evalH };
  const srcA = roadSources(scene, lamps, weights), srcH = roadSources(scene, lamps, { L: [], R: [] });
  const fA = (x, y) => roadE(x, y, srcA, opt), fH = (x, y) => roadE(x, y, srcH, opt);
  return { t, scene, ctrl, weights, rows, n, fA, fH };
}

function segState(i, weights) {
  const ws = viewLamps().map(k => weights[k][i] > 0);
  return ws.every(Boolean) ? 'on' : ws.some(Boolean) ? 'mixed' : 'off';
}

function render({ rerun = true } = {}) {
  if (!lamps) return;
  if (rerun) runDirty = true;
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
  if (last) last.ctrl.boxes.forEach((b, n) => b.visible && ks.forEach(k => {
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
  renderRoad();
  renderMetricsPanel();
  renderTimeline();
}

/* ---------------- Dynamic scenario: run, timeline, playback (Phase 4) ---------------- */

function renderTimeline() {
  $('timelinePanel').hidden = !dynamic();
  if (!dynamic() || !lamps || !typeDefs) return;
  const sc = state.scenario;
  if (runDirty || !run) {
    try { run = runScenario(scenarioCfg(), lamps, { tMax: sc.tMax, dt: sc.dt, latency_s: latency() }); runDirty = false; }
    catch (e) { $('tlInfo').textContent = e.message; return; }
  }
  const nOf = id => (last ? last.n[id] : '?');
  tlApi = drawTimeline($('timeline'), run, { tNow: sc.time });
  drawSegmentStrip($('stripL'), run, 'L', { tNow: sc.time, label: 'L' });
  drawSegmentStrip($('stripR'), run, 'R', { tNow: sc.time, label: 'R' });
  $('tlLegend').innerHTML = timelineLegendHTML(run, nOf);
  const slider = $('tSlider'); slider.max = sc.tMax; slider.step = sc.dt; slider.value = sc.time;
  $('tNow').textContent = `t = ${sc.time.toFixed(2)} s`;
  const pk = run.peaks.map((p, k) => `${nOf(run.series[k].targetId)} · ${run.series[k].point}: peak ${fmtE(p.E)} lx at ${p.t.toFixed(2)} s (${p.d.toFixed(1)} m)`);
  $('tlInfo').textContent = `${run.t.length} steps of ${sc.dt} s, latency ${state.controller.latency_ms} ms. ${pk.join(' · ')}`;
}

function setTime(t) {
  const sc = state.scenario;
  sc.time = Math.max(0, Math.min(sc.tMax, Math.round(t / sc.dt) * sc.dt));
  render({ rerun: false });
}

let playing = null;
function togglePlay() {
  if (playing) { cancelAnimationFrame(playing.raf); playing = null; $('play').textContent = '▶ Play'; return; }
  const sc = state.scenario;
  if (sc.time >= sc.tMax - 1e-9) sc.time = 0;
  playing = { last: performance.now() };
  $('play').textContent = '❚❚ Pause';
  const tick = now => {
    const dtReal = (now - playing.last) / 1000; playing.last = now;
    const next = sc.time + dtReal * parseFloat($('playRate').value);
    if (next >= sc.tMax) { setTime(sc.tMax); togglePlay(); return; }
    setTime(next);
    playing.raf = requestAnimationFrame(tick);
  };
  playing.raf = requestAnimationFrame(tick);
}

/** tMax so that every closing target reaches 10 m (capped at 30 s). */
function fitDuration() {
  if (!typeDefs) return;
  const ts = state.targets.map(t => timeToDistance(t.d, 10, typeDefs[t.type].direction, t.speed_kmh, state.scenario.vEgo_kmh)).filter(isFinite);
  state.scenario.tMax = +Math.min(30, Math.max(1, ...(ts.length ? ts : [4]))).toFixed(2);
  state.scenario.time = Math.min(state.scenario.time, state.scenario.tMax);
  shows.forEach(f => f()); render();
}

/* ---------------- Export and project files ---------------- */

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
function exportMeta() {
  return {
    traffic: state.road.traffic, 'lane width m': state.road.laneWidth, 'margin H/V deg': `${state.controller.marginH}/${state.controller.marginV}`,
    'latency ms': dynamic() ? state.controller.latency_ms : 0, 'time s': last ? last.t : 0, limits: state.limits?.name || 'none',
  };
}

/** Road-illuminate scenario: embedded beams + frames (one frame for a static scene, the timeline when dynamic). */
function exportRoadScenario() {
  const msg = $('exportMsg');
  try {
    if (!lamps || !last) throw new Error('Load the beams first.');
    const S = P.sources, synth = P.mode === 'synthetic';
    const files = [S.lowL, S.lowR, ...(synth ? [S.hbL, S.hbR] : [...S.segL, ...S.segR])].filter(Boolean);
    const types = files.map(f => parseIES(f.text).type);
    const cfg = scenarioCfg(), dyn = dynamic();
    const runCfg = dyn ? cfg : { ...cfg, vEgo_kmh: 0, targets: state.targets.map(x => ({ ...x, speed_kmh: 0 })) };
    const times = dyn ? frameTimes(state.scenario.tMax, state.scenario.dt) : [0];
    const sc = buildRoadScenario({
      photometry: P, types, edges: synth ? parseEdges(P.edgesText).edges : undefined,
      vehicle: state.vehicle, road: state.road, roadView: state.roadView, controller: state.controller,
      cfg: runCfg, lampModels: lamps, times, latency_s: latency(), dynamic: dyn, generator: `${APP_NAME} ${VERSION}`,
      nOf: id => last.n[id],
    });
    const text = JSON.stringify(sc);
    downloadText(`adbsim-road-${stamp()}.json`, text, 'application/json');
    msg.textContent = `Road scenario: ${sc.frames.length} frame${sc.frames.length === 1 ? '' : 's'}, ${(text.length / 1e6).toFixed(1)} MB. Load it under "ADB scenario" in Road-illuminate or virtualNightDrive.` +
      (dyn ? '' : ' This is a still scene (one frame): switch on "Targets move" under Dynamic scenario to export a scenario that plays.');
    msg.classList.remove('err');
  } catch (e) { msg.textContent = `Road-illuminate scenario: ${e.message}`; msg.classList.add('err'); }
}

function saveProject() { downloadText(`adbsim-${stamp()}.adb.json`, projectToJSON(state), 'application/json'); }

function openProject(text, name) {
  const msg = $('exportMsg');
  try {
    const { state: st, version } = projectFromJSON(text, createState());
    for (const [k, v] of Object.entries(st)) {
      if (state[k] && typeof state[k] === 'object' && !Array.isArray(state[k]) && v && typeof v === 'object' && !Array.isArray(v)) {
        if (k === 'vehicle') { Object.assign(state.vehicle.camera, v.camera || {}); const { camera, ...rest } = v; Object.assign(state.vehicle, rest); }
        else Object.assign(state[k], v);
      } else if (Array.isArray(state[k]) && Array.isArray(v)) { state[k].splice(0, state[k].length, ...v); }
      else state[k] = v;
    }
    if (st.limits !== undefined) { state.limitsText = JSON.stringify(st.limits, null, 2); $('limitsText').value = state.limitsText; }
    shows.forEach(f => f()); syncPanel(); showTargets();
    $('view').value = state.view.lamp; $('zoom').value = state.view.zoom;
    msg.textContent = `Opened ${name}${version && version !== VERSION ? ` (saved with v${version})` : ''}.`; msg.classList.remove('err');
    rebuild();
  } catch (e) { msg.textContent = `${name}: ${e.message}`; msg.classList.add('err'); }
}

/* ---------------- Road view and metrics (Phase 3) ---------------- */

function renderRoad() {
  if (!last) return;
  const { scene, fA, fH } = last, rv = state.roadView;
  const markings = laneMarkings(state.road);
  const ys = markings.map(m => m.y);
  const spec = { x0: 0, x1: rv.xMax, y0: Math.min(...ys) - 4, y1: Math.max(...ys) + 4 };
  const W = $('road').clientWidth || 600;
  spec.nx = Math.max(80, Math.min(360, Math.round(W / 2)));
  spec.ny = Math.max(40, Math.min(130, Math.round(spec.nx * 0.4)));       // ≤ 47k points: no worker needed
  const gA = rv.mode !== 'hb' ? roadGrid(spec, fA) : null, gH = rv.mode !== 'adb' ? roadGrid(spec, fH) : null;
  const g = rv.mode === 'hb' ? gH : rv.mode === 'adb' ? gA : diffGrid(gH, gA);
  roadApi = drawRoad($('road'), g, {
    markings,
    targets: scene.targets.map(t => ({ ...t.outline, label: String(last.n[t.id]) })),
    lamps: [scene.lamps.L.pos, scene.lamps.R.pos],
  });
  $('roadLegend').innerHTML = roadLegendHTML();
  $('roadInfo').textContent = `${{ hb: 'Full high beam', adb: 'ADB (current segment states)', diff: 'Difference: full high beam − ADB' }[rv.mode]} · ` +
    `${rv.method === 'vertical' ? `vertical planes on road at ${rv.evalH} m` : 'road surface'} · max ${fmtE(g.emax)} lx at ${g.at[0].toFixed(0)} m.`;
}

function renderMetricsPanel() {
  if (!last) return;
  const { fA, fH, scene, rows, n } = last, thr = state.metrics.thr, xMax = 400;
  const pts = comparePoints(defaultRoadPoints(state.road), fA, fH);
  const edge = pts[0];
  const det = { label: edge.label.replace(/, .*/, ''), adb: detectionDistance(fA, edge.y, thr, { xMax }), hb: detectionDistance(fH, edge.y, thr, { xMax }) };
  const t0 = scene.targets[0];
  const tun = t0 ? tunnelOnRoad(fA, fH, t0.d) : null;
  renderMetrics($('metrics'), {
    kept: keptFlux(lamps, last.weights), points: pts, det, thr, xMax,
    tunnel: tun && { ...tun, n: n[t0.id], d: t0.d },
    verdict: overallStatus(rows), nFail: rows.filter(r => r.status === 'fail').length, nRows: rows.length,
  });
}

/* ---------------- Limits ---------------- */

function applyLimits(text, from) {
  const msg = $('limitsMsg');
  try {
    const L = JSON.parse(text), errs = validateLimits(L);
    if (errs.length) throw new Error(errs.join(' '));
    state.limits = L; state.limitsText = text;
    const nVal = L.glare.reduce((s, g) => s + g.E_max_lx.filter(v => v != null).length, 0) + (L.deBoer_min != null ? 1 : 0);
    msg.textContent = `${from}: "${L.name || 'unnamed'}", ${L.glare.length} glare entries, ${nVal} limit value${nVal === 1 ? '' : 's'} set.` +
      (nVal ? '' : ' All values are null, so every point shows "No limit".');
    msg.classList.remove('err');
    render();
  } catch (e) { msg.textContent = `${from}: ${e.message}`; msg.classList.add('err'); }
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
// beamKit theme toggle: redraw the canvases so their colours follow the theme
if (window.beamKit) window.beamKit.theme.onChange(() => render({ rerun: false }));

/* ---------------- Scene, targets, controller ---------------- */
const rerender = () => render();
[['vSpacing', state.vehicle, 'spacing', 'num'], ['vHeight', state.vehicle, 'hLamp', 'num'],
 ['vAimV', state.vehicle, 'aimV', 'num'], ['vAimH', state.vehicle, 'aimH', 'num'],
 ['camX', state.vehicle.camera, 'x', 'num'], ['camY', state.vehicle.camera, 'y', 'num'], ['camZ', state.vehicle.camera, 'z', 'num'],
 ['rTraffic', state.road, 'traffic', 'str'], ['rLaneW', state.road, 'laneWidth', 'num'], ['rLanes', state.road, 'lanesPerDir', 'int'],
 ['cAuto', state.controller, 'auto', 'bool'], ['cMarginH', state.controller, 'marginH', 'num'], ['cMarginV', state.controller, 'marginV', 'num'],
 ['cTunnel', state.controller, 'minTunnel', 'num'], ['cRule', state.controller, 'rule', 'str'],
 ['cDmin', state.controller, 'dMin', 'num'], ['cMaxT', state.controller, 'maxTargets', 'int'], ['gLa', state.glare, 'La', 'num'],
].forEach(([id, obj, key, parse]) => shows.push(bindField($(id), obj, key, parse, rerender)));

[['rvMode', state.roadView, 'mode', 'str'], ['rvMethod', state.roadView, 'method', 'str'], ['rvEvalH', state.roadView, 'evalH', 'num'],
 ['rvXmax', state.roadView, 'xMax', 'num'], ['mThr', state.metrics, 'thr', 'num'],
 ['scDynamic', state.scenario, 'dynamic', 'bool'], ['scVego', state.scenario, 'vEgo_kmh', 'num'], ['scTmax', state.scenario, 'tMax', 'num'],
 ['scDt', state.scenario, 'dt', 'num'], ['cLatency', state.controller, 'latency_ms', 'num'],
].forEach(([id, obj, key, parse]) => shows.push(bindField($(id), obj, key, parse, rerender)));

$('play').addEventListener('click', togglePlay);
$('tSlider').addEventListener('input', e => setTime(parseFloat(e.target.value)));
$('fitT').addEventListener('click', fitDuration);
$('timeline').addEventListener('click', e => { if (!tlApi) return; const r = e.currentTarget.getBoundingClientRect(), t = tlApi.toT(e.clientX - r.left); if (t != null) setTime(t); });
$('saveProject').addEventListener('click', saveProject);
$('roadScenario').addEventListener('click', exportRoadScenario);
$('fProject').addEventListener('change', async e => { const [f] = await readFiles(e.target); e.target.value = ''; if (f) openProject(f.text, f.name); });
$('csvGlare').addEventListener('click', () => last && downloadText(`adbsim-glare-${stamp()}.csv`, glareCSV(last.rows, exportMeta()), 'text/csv'));
$('csvTimeline').addEventListener('click', () => {
  if (!dynamic() || !run) { $('exportMsg').textContent = 'Switch on the dynamic scenario to export a timeline.'; return; }
  downloadText(`adbsim-timeline-${stamp()}.csv`, timelineCSV(run, exportMeta()), 'text/csv');
});
$('pngBeam').addEventListener('click', () => downloadCanvas($('beam'), `adbsim-beam-${stamp()}.png`));
$('pngRoad').addEventListener('click', () => downloadCanvas($('road'), `adbsim-road-${stamp()}.png`));
$('pngTimeline').addEventListener('click', () => {
  if (!dynamic()) { $('exportMsg').textContent = 'Switch on the dynamic scenario to export the timeline.'; return; }
  downloadCanvas($('timeline'), `adbsim-timeline-${stamp()}.png`);
});
$('road').addEventListener('mousemove', e => {
  if (!roadApi || !last) return;
  const r = e.currentTarget.getBoundingClientRect(), xy = roadApi.toXY(e.clientX - r.left, e.clientY - r.top);
  $('roadCursor').textContent = xy
    ? `x ${xy[0].toFixed(1)} m, y ${Math.abs(xy[1]).toFixed(2)} m ${xy[1] < 0 ? 'R' : 'L'} · ADB ${fmtE(last.fA(...xy))} lx · HB ${fmtE(last.fH(...xy))} lx` : '';
});
$('limitsApply').addEventListener('click', () => applyLimits($('limitsText').value, 'Edited limits'));
$('limitsReset').addEventListener('click', () => fetchText('data/limits.json').then(t => { $('limitsText').value = t; applyLimits(t, 'data/limits.json'); }));
$('fLimits').addEventListener('change', async e => {
  const [f] = await readFiles(e.target); e.target.value = '';
  if (f) { $('limitsText').value = f.text; applyLimits(f.text, f.name); }
});
fetchText('data/limits.json').then(t => { $('limitsText').value = t; applyLimits(t, 'data/limits.json'); })
  .catch(err => { $('limitsMsg').textContent = `Could not load data/limits.json (${err.message}).`; });

function showTargets() { renderTargets($('targetList'), state.targets, typeDefs, structural => { if (structural) showTargets(); render(); }); }
$('addTarget').addEventListener('click', () => {
  const id = Math.max(0, ...state.targets.map(t => t.id)) + 1;
  state.targets.push({ id, type: $('newType').value, lane: 1, d: 100, speed_kmh: typeDefs[$('newType').value].direction === 'oncoming' ? 100 : 80 });
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
