import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { near } from './helpers.js';
import { parseIES } from '../src/core/ies.js';
import { makeField } from '../src/core/grid.js';
import { buildLamp } from '../src/core/photometry.js';
import { buildScene, distanceAt, buildSceneAt } from '../src/core/scene.js';
import { controllerUpdate } from '../src/core/controller.js';
import { glareTable } from '../src/core/glare.js';
import { stepAt, runScenario, timeToDistance } from '../src/core/scenario.js';

const R2D = 180 / Math.PI;
const dir = new URL('../data/demo/', import.meta.url);
const rd = f => parseIES(readFileSync(new URL(f, dir), 'utf8'));
const meta = JSON.parse(readFileSync(new URL('segments.json', dir), 'utf8'));
const typeDefs = JSON.parse(readFileSync(new URL('../data/targets.json', import.meta.url), 'utf8')).types;
const lamp = buildLamp({ low: rd(meta.lowBeam), segments: meta.segments.map(s => rd(s.file)) }, { hdirRight: true },
  makeField({ H: [-40, 40], V: [-12, 10], step: 0.1 }));
const lamps = { L: lamp, R: lamp };
const base = {
  vehicle: { spacing: 1.4, hLamp: 0.65, camera: { x: -1.8, y: 0, z: 1.3 } },
  road: { traffic: 'RHT', laneWidth: 3.5, lanesPerDir: 1 }, typeDefs, limits: null,
  controller: { marginH: 0.5, marginV: 0.5, minTunnel: 0, rule: 'off', dMin: 0, maxTargets: 8 },
};
const oncoming = (closing_kmh, d = 200) => ({
  ...base, vEgo_kmh: closing_kmh / 2, targets: [{ id: 1, type: 'oncoming_car', lane: 1, d, speed_kmh: closing_kmh / 2 }],
});

// ---- Phase 4 acceptance ----
test('ACCEPT 4a · latency 0: the dynamic glare equals the static value at the same distance (so the peaks match)', () => {
  const cfg = oncoming(200);
  const run = runScenario(cfg, lamps, { tMax: 3, dt: 0.05, latency_s: 0 });
  const s = run.series[0];
  s.d.forEach((d, i) => {
    const sc = buildScene({ ...base, targets: [{ id: 1, type: 'oncoming_car', lane: 1, d }] });
    const [row] = glareTable(sc, lamps, controllerUpdate(sc, lamps, base.controller).weights);
    near(s.E[i], row.E, 1e-9, `t = ${run.t[i]}`);
  });
  const peakStatic = Math.max(...s.d.map(d => {
    const sc = buildScene({ ...base, targets: [{ id: 1, type: 'oncoming_car', lane: 1, d }] });
    return glareTable(sc, lamps, controllerUpdate(sc, lamps, base.controller).weights)[0].E;
  }));
  near(run.peaks[0].E, peakStatic, 1e-9, 'peak');
});

test('ACCEPT 4b · latency > 0: the glare spike grows with closing speed', () => {
  const excess = [];
  for (const v of [100, 150, 200, 300]) {
    const cfg = oncoming(v), tMax = (200 - 8) / (v / 3.6), dt = 0.005;
    const r0 = runScenario(cfg, lamps, { tMax, dt, latency_s: 0 }).series[0].E;
    const r1 = runScenario(cfg, lamps, { tMax, dt, latency_s: 0.2 }).series[0].E;
    excess.push(Math.max(...r1.map((e, i) => e - r0[i])));
  }
  for (let k = 1; k < excess.length; k++) assert.ok(excess[k] >= excess[k - 1] - 1e-9, `excess ${excess.map(e => e.toFixed(2))}`);
  assert.ok(excess.at(-1) > excess[0] + 10, `excess ${excess.map(e => e.toFixed(2))}`);
});

// ---- Validation case 6 ----
test('VAL 6 · oncoming car closing at 2 × 100 km/h, 100 ms latency: box lag = analytic angular rate × 0.1 s', () => {
  const cfg = oncoming(200, 200), lat = 0.1, ve = 200 / 3.6;
  for (const t of [1.5, 2.5, 3.0]) {
    const now = stepAt(cfg, lamps, t, 0).ctrl.boxes[0].cam, late = stepAt(cfg, lamps, t, lat).ctrl.boxes[0].cam;
    // hMin comes from the car's right headlamp: y = 3.5 + 0.7, x = d(t) + 1.8 from the camera.
    const y = 4.2, H = tt => -Math.atan2(y, distanceAt(tt, 200, 'oncoming', 100, 100) + 1.8) * R2D;
    near(now.hMin - late.hMin, H(t) - H(t - lat), 1e-9, `t = ${t}: exact lag`);
    const xMid = distanceAt(t - lat / 2, 200, 'oncoming', 100, 100) + 1.8;
    const rate = y * -ve / (xMid * xMid + y * y) * R2D;                 // dH/dt (°/s), negative while closing
    near(now.hMin - late.hMin, rate * lat, 0.01 * Math.abs(rate * lat), `t = ${t}: rate × latency (first order)`);
  }
});

// ---- New ----
test('distanceAt: oncoming closes at v_ego + v; preceding moves at v − v_ego', () => {
  near(distanceAt(1, 100, 'oncoming', 90, 90), 100 - 50, 1e-12, 'oncoming');
  near(distanceAt(2, 50, 'own', 108, 72), 50 + 2 * 10, 1e-12, 'preceding pulls away');
  near(distanceAt(1, 50, 'own', 0, 0), 50, 0, 'static');
});

test('buildSceneAt moves targets; timeToDistance inverts it', () => {
  const cfg = oncoming(180, 150);
  near(buildSceneAt(cfg, 1).targets[0].d, 100, 1e-12, 'd at 1 s');
  near(timeToDistance(150, 100, 'oncoming', 90, 90), 1, 1e-12, 't');
  assert.equal(timeToDistance(50, 10, 'own', 100, 80), Infinity);
});

test('a target that has passed is not detected and gets no glare', () => {
  const s = stepAt(oncoming(200, 2), lamps, 0.5, 0);
  assert.equal(s.ctrl.boxes[0].visible, false);
  assert.ok(s.weights.L.every(w => w === 1));
  near(s.rows[0].E, 0, 0, 'behind the lamps');
});

test('runScenario: step count, segment-state strip and kept flux per step', () => {
  const run = runScenario(oncoming(200), lamps, { tMax: 1, dt: 0.1 });
  assert.equal(run.t.length, 11); near(run.t.at(-1), 1, 0, 'last t');
  assert.equal(run.weights.L.length, 11); assert.equal(run.weights.L[0].length, 12);
  assert.ok(run.kept.every(k => k > 0 && k < 1));
  assert.equal(run.series.length, 1);
});

test('manual weights are used when ADB auto is off', () => {
  const off = { L: lamp.segs.map(() => 0), R: lamp.segs.map(() => 0) };
  const s = stepAt({ ...oncoming(200), auto: false, manualWeights: off }, lamps, 0, 0);
  assert.deepEqual(s.weights, off);
  near(s.rows[0].E, s.rows[0].E_low, 1e-12, 'low only');
});
