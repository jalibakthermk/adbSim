import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { near } from './helpers.js';
import { parseIES } from '../src/core/ies.js';
import { makeField } from '../src/core/grid.js';
import { buildLamp } from '../src/core/photometry.js';
import { anglesFrom, cameraBoxToLamp, lampPositions } from '../src/core/frames.js';
import { buildScene } from '../src/core/scene.js';
import { featureBox, addMargins, coverH, maskWeights, controllerUpdate } from '../src/core/controller.js';
import { glareTable } from '../src/core/glare.js';

const R2D = 180 / Math.PI;
const dir = new URL('../data/demo/', import.meta.url);
const rd = f => parseIES(readFileSync(new URL(f, dir), 'utf8'));
const meta = JSON.parse(readFileSync(new URL('segments.json', dir), 'utf8'));
const typeDefs = JSON.parse(readFileSync(new URL('../data/targets.json', import.meta.url), 'utf8')).types;
const field = makeField({ H: [-40, 40], V: [-12, 10], step: 0.1 });
const lamp = buildLamp({ low: rd(meta.lowBeam), segments: meta.segments.map(s => rd(s.file)) }, { hdirRight: true }, field);
const lamps = { L: lamp, R: lamp };
const vehicle = { spacing: 1.4, hLamp: 0.65, camera: { x: -1.8, y: 0, z: 1.3 } };
const road = { traffic: 'RHT', laneWidth: 3.5, lanesPerDir: 1 };
const ctrl = { marginH: 0.5, marginV: 0.5, minTunnel: 0, rule: 'off', dMin: 0, maxTargets: Infinity };
const scene = (targets, rd_ = road, veh = vehicle) => buildScene({ vehicle: veh, road: rd_, targets, typeDefs });
const offList = w => w.map((x, i) => (x === 0 ? i : -1)).filter(i => i >= 0);

// ---- Phase 2 acceptance ----
test('ACCEPT 2a · oncoming car at 100 m, 0.5° margin switches off exactly segments 5 and 6 (−4.5…−2°, −2…0°)', () => {
  const s = scene([{ id: 1, type: 'oncoming_car', lane: 1, d: 100 }]);
  const c = controllerUpdate(s, lamps, ctrl);
  // Hand check of the camera box: headlamps at y = 3.5 ∓ 0.7, eye 2 m behind the front; camera 1.8 m behind the lamps.
  near(c.boxes[0].cam.hMin, -Math.atan2(4.2, 101.8) * R2D, 1e-9, 'camera hMin (right headlamp of the car = far left in H)');
  // Each lamp's box lies across the −2° boundary, inside segments 5 and 6 only.
  for (const k of ['L', 'R']) {
    const b = c.boxes[0].lamp[k];
    assert.ok(b.hMin > -4.5 + 0.25 && b.hMax < 0 - 0.25, `${k} box ${b.hMin}…${b.hMax}`);
    assert.deepEqual(offList(c.weights[k]), [4, 5], `lamp ${k}`);
  }
  assert.equal(c.fallback, null);
});

test('ACCEPT 2b · E at the oncoming driver eye drops to the low-beam-only value + ε', () => {
  const s = scene([{ id: 1, type: 'oncoming_car', lane: 1, d: 100 }]);
  const c = controllerUpdate(s, lamps, ctrl);
  const [row] = glareTable(s, lamps, c.weights);
  assert.ok(row.E <= row.E_low * 1.001 + 1e-6, `E ${row.E} vs low ${row.E_low}`);
  assert.ok(row.E_hb > 50 * row.E, 'full high beam is far brighter');
});

// ---- Validation cases (SPEC §8) ----
test('VAL 2 · parallax: camera 0.5 m above the lamp, target at 10 m → box V differs by atan(0.5/10)', () => {
  const cam = [0, 0, 1.15], lampPos = [0, 0, 0.65], P = [10, 0, 1.15];
  const box = featureBox([P], cam);
  const lb = cameraBoxToLamp(box, box.depth, cam, lampPos);
  near(box.vMin, 0, 1e-12, 'camera V');
  near(lb.vMin - box.vMin, Math.atan(0.5 / 10) * R2D, 1e-9, 'V shift');
  near(lb.vMax - box.vMax, Math.atan(0.5 / 10) * R2D, 1e-9, 'V shift (top)');
});

test('VAL 3 · margin monotonicity: increasing the H margin never switches a segment back on', () => {
  for (const t of [{ type: 'oncoming_car', d: 60 }, { type: 'preceding_car', d: 120 }, { type: 'oncoming_truck', d: 200 }]) {
    const s = scene([{ id: 1, lane: 1, ...t }]);
    let prev = { L: [], R: [] };
    for (let m = 0; m <= 4; m += 0.25) {
      const c = controllerUpdate(s, lamps, { ...ctrl, marginH: m });
      for (const k of ['L', 'R']) {
        const off = offList(c.weights[k]);
        assert.ok(prev[k].every(i => off.includes(i)), `${t.type} margin ${m} lamp ${k}: ${prev[k]} ⊄ ${off}`);
        prev[k] = off;
      }
    }
  }
});

test('VAL 4 · symmetry: RHT ↔ LHT mirrors the boxes (H → −H, left lamp ↔ right lamp)', () => {
  for (const t of [{ type: 'oncoming_car', d: 80 }, { type: 'preceding_car', d: 50 }]) {
    const a = controllerUpdate(scene([{ id: 1, lane: 1, ...t }]), lamps, ctrl).boxes[0];
    const b = controllerUpdate(scene([{ id: 1, lane: 1, ...t }], { ...road, traffic: 'LHT' }), lamps, ctrl).boxes[0];
    near(b.cam.hMin, -a.cam.hMax, 1e-9, 'camera hMin'); near(b.cam.vMax, a.cam.vMax, 1e-9, 'camera V');
    near(b.lamp.L.hMin, -a.lamp.R.hMax, 1e-9, 'lamp L ↔ R');
    near(b.lamp.R.hMax, -a.lamp.L.hMin, 1e-9, 'lamp R ↔ L');
  }
});

// ---- New ----
test('featureBox depth is the nearest point ahead of the camera', () => {
  const cam = [-2, 0, 1.3], P1 = [50, 1, 1], P2 = [52, -1, 0.5];
  const b = featureBox([P1, P2], cam);
  near(b.depth, 52, 1e-12, 'depth');
  near(b.hMin, anglesFrom(cam, P1)[0], 1e-12, 'hMin from the left point (y > 0 → H < 0)');
  near(b.hMax, anglesFrom(cam, P2)[0], 1e-12, 'hMax from the right point');
  near(b.vMin, anglesFrom(cam, P2)[1], 1e-12, 'vMin');
});

test('addMargins adds on each side and widens to the minimum tunnel', () => {
  const b = addMargins({ hMin: -1, hMax: -0.8, vMin: 0, vMax: 0.2 }, 0.5, 0.25);
  [[b.hMin, -1.5], [b.hMax, -0.3], [b.vMin, -0.25], [b.vMax, 0.45]].forEach(([a, e]) => near(a, e, 1e-12, 'margin'));
  const t = addMargins({ hMin: -1, hMax: -0.8, vMin: 0, vMax: 0.2 }, 0, 0, 2);
  near(t.hMax - t.hMin, 2, 1e-12, 'tunnel'); near((t.hMin + t.hMax) / 2, -0.9, 1e-12, 'centred');
});

test('coverH and maskWeights: off rule, dim rule, V separation and empty segments', () => {
  const s = { hMin: 0, hMax: 4, vMin: -1, vMax: 1 };
  near(coverH(s, { hMin: 1, hMax: 2, vMin: 0, vMax: 0.5 }), 0.25, 1e-12, 'quarter');
  near(coverH(s, { hMin: 1, hMax: 2, vMin: 2, vMax: 3 }), 0, 0, 'above');
  const boxes = [{ hMin: 3, hMax: 9, vMin: 0, vMax: 0.5 }];
  assert.deepEqual(maskWeights([s, null, { hMin: 5, hMax: 6, vMin: -1, vMax: 1 }, { hMin: 10, hMax: 11, vMin: -1, vMax: 1 }], boxes, 'off'), [0, 1, 0, 1]);
  assert.deepEqual(maskWeights([s, { hMin: 5, hMax: 6, vMin: -1, vMax: 1 }], boxes, 'dim'), [0.75, 0]);
});

test('low-beam fallback: below d_min, or more than N targets, all ADB segments go off', () => {
  const s = scene([{ id: 1, type: 'oncoming_car', lane: 1, d: 20 }, { id: 2, type: 'preceding_car', lane: 1, d: 60 }]);
  const a = controllerUpdate(s, lamps, { ...ctrl, dMin: 25 });
  assert.equal(a.fallback, 'distance'); assert.ok(a.weights.L.every(w => w === 0));
  const b = controllerUpdate(s, lamps, { ...ctrl, maxTargets: 1 });
  assert.equal(b.fallback, 'count'); assert.ok(b.weights.R.every(w => w === 0));
  assert.equal(controllerUpdate(s, lamps, ctrl).fallback, null);
});

test('no targets → every segment stays on', () => {
  const c = controllerUpdate(scene([]), lamps, ctrl);
  assert.ok(c.weights.L.every(w => w === 1) && c.weights.R.every(w => w === 1));
});

test('lampPositions: left lamp at +s/2 (y left)', () => {
  assert.deepEqual(lampPositions({ spacing: 1.4, hLamp: 0.65 }), { L: [0, 0.7, 0.65], R: [0, -0.7, 0.65] });
});
