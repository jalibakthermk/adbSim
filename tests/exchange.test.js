import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { near } from './helpers.js';
import { parseIES } from '../src/core/ies.js';
import { makeField } from '../src/core/grid.js';
import { buildLamp } from '../src/core/photometry.js';
import { stepAt } from '../src/core/scenario.js';
import { roadAngleSystem, frameTimes, buildRoadScenario, ROAD_FORMAT } from '../src/core/exchange.js';
import { createState } from '../src/ui/state.js';

const dir = new URL('../data/demo/', import.meta.url);
const txt = f => readFileSync(new URL(f, dir), 'utf8');
const meta = JSON.parse(txt('segments.json'));
const typeDefs = JSON.parse(readFileSync(new URL('../data/targets.json', import.meta.url), 'utf8')).types;
const lamp = buildLamp({ low: parseIES(txt(meta.lowBeam)), segments: meta.segments.map(s => parseIES(txt(s.file))) }, { hdirRight: true },
  makeField({ H: [-40, 40], V: [-12, 10], step: 0.1 }));
const lamps = { L: lamp, R: lamp };

function setup(dynamic) {
  const s = createState();
  s.photometry.sources = {
    lowL: { name: meta.lowBeam, text: txt(meta.lowBeam) }, lowR: null,
    segL: meta.segments.map(x => ({ name: x.file, text: txt(x.file) })), segR: [], hbL: null, hbR: null,
  };
  s.targets = [{ id: 1, type: 'oncoming_car', lane: 1, d: 200, speed_kmh: 100 }];
  const cfg = { vehicle: s.vehicle, road: s.road, targets: s.targets, typeDefs, vEgo_kmh: dynamic ? 100 : 0,
    controller: s.controller, auto: true, La: 1, limits: null };
  if (!dynamic) cfg.targets = s.targets.map(t => ({ ...t, d: 100, speed_kmh: 0 }));
  return { s, cfg };
}

test('roadAngleSystem: Type A → azel, Type B → elaz, override wins, Type C and mixed types refused', () => {
  assert.equal(roadAngleSystem(['A', 'A']), 'azel');
  assert.equal(roadAngleSystem(['B']), 'elaz');
  assert.equal(roadAngleSystem(['A', 'C'], 'B'), 'elaz');
  assert.throws(() => roadAngleSystem(['C']), /Type C/);
  assert.throws(() => roadAngleSystem(['A', 'B']), /mix/);
});

test('frameTimes: every step when few, thinned to the maximum with first and last kept', () => {
  assert.deepEqual(frameTimes(0.1, 0.02), [0, 0.02, 0.04, 0.06, 0.08, 0.1]);
  const t = frameTimes(10, 0.01, 101);
  assert.ok(t.length <= 102); near(t[0], 0, 0, 'first'); near(t.at(-1), 10, 1e-9, 'last');
  assert.deepEqual(frameTimes(0, 0.02), [0]);
});

test('static scenario: one frame, embedded IES, right lamp = left (null), weights match the controller', () => {
  const { s, cfg } = setup(false);
  const sc = buildRoadScenario({ photometry: s.photometry, types: ['A', 'A'], vehicle: s.vehicle, road: s.road, roadView: s.roadView,
    controller: s.controller, cfg, lampModels: lamps, times: [0], dynamic: false, generator: 'adbSim test' });
  assert.equal(sc.format, ROAD_FORMAT); assert.equal(sc.frames.length, 1);
  assert.equal(sc.photometry.angleSystem, 'azel');
  assert.equal(sc.photometry.lowBeam.R, null); assert.equal(sc.photometry.segments.R, null);
  assert.equal(sc.photometry.segments.L.length, 12);
  assert.ok(sc.photometry.segments.L[0].ies.startsWith('IESNA:LM-63'));
  const f = sc.frames[0], st = stepAt(cfg, lamps, 0, 0);
  assert.deepEqual(f.weights.L, st.weights.L);
  assert.deepEqual(f.weights.L.map((w, i) => (w ? 0 : i + 1)).filter(Boolean), [5, 6]);
  assert.equal(f.targets[0].d, 100); assert.equal(f.targets[0].outline.x0, 100);
  near(f.targets[0].points[0].E_lx, st.rows[0].E, 1e-3 * st.rows[0].E, 'E at the eye');
  assert.equal(f.targets[0].points[0].result, 'none');
  assert.deepEqual(sc.mounting, { height: 0.65, separation: 1.4, aimV_deg: 0, aimH_deg: 0 });
  assert.equal(sc.evaluation.method, 'vertical');
  assert.ok(JSON.stringify(sc).length < 3e6);
});

test('dynamic scenario: frames follow the target as it closes', () => {
  const { s, cfg } = setup(true);
  const times = frameTimes(3, 0.02, 31);
  const sc = buildRoadScenario({ photometry: s.photometry, types: ['A'], vehicle: s.vehicle, road: s.road, roadView: s.roadView,
    controller: { ...s.controller, latency_ms: 100 }, cfg, lampModels: lamps, times, latency_s: 0.1, dynamic: true, generator: 'adbSim test' });
  assert.equal(sc.frames.length, times.length); assert.equal(sc.controller.latency_ms, 100);
  const ds = sc.frames.map(f => f.targets[0].d);
  for (let k = 1; k < ds.length; k++) assert.ok(ds[k] < ds[k - 1]);
  near(ds.at(-1), 200 - 3 * 200 / 3.6, 1e-3, 'last distance');
});

test('synthetic mode exports the high beam with its boundaries and soft edge', () => {
  const { s, cfg } = setup(false);
  s.photometry.mode = 'synthetic'; s.photometry.sources.hbL = { name: meta.highBeam, text: txt(meta.highBeam) };
  const sc = buildRoadScenario({ photometry: s.photometry, types: ['A', 'A'], edges: meta.edges, vehicle: s.vehicle, road: s.road,
    roadView: s.roadView, controller: s.controller, cfg, lampModels: lamps, times: [0], generator: 'adbSim test' });
  assert.equal(sc.photometry.mode, 'synthetic'); assert.deepEqual(sc.photometry.edges, meta.edges);
  assert.equal(sc.photometry.softEdge_deg, 0.5); assert.equal(sc.photometry.segments, undefined);
  assert.equal(sc.photometry.highBeam.L.name, meta.highBeam);
});
