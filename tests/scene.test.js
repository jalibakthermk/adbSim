import { test } from 'node:test';
import assert from 'node:assert/strict';
import { near } from './helpers.js';
import { laneCenterY, placeTarget, targetOutline } from '../src/core/targets.js';
import { buildScene } from '../src/core/scene.js';
import { makeField } from '../src/core/grid.js';
import { buildLamp } from '../src/core/photometry.js';
import { glareAtPoint, glareTable } from '../src/core/glare.js';

const road = { traffic: 'RHT', laneWidth: 3.5, lanesPerDir: 2 };
const car = {
  label: 'Car', direction: 'oncoming',
  glarePoints: [{ id: 'eye', label: 'Eye', x: -2, y: 0.37, z: 1.1, tau: 0.9 }],
  lamps: [{ id: 'hl', x: 0, y: 0.7, z: 0.65 }, { id: 'hr', x: 0, y: -0.7, z: 0.65 }],
};

test('laneCenterY: RHT own lanes go left, oncoming lane 1 next to the centre line; LHT mirrors', () => {
  near(laneCenterY(road, 'own', 1), 0, 0, 'ego lane');
  near(laneCenterY(road, 'own', 2), 3.5, 0, 'overtaking lane');
  near(laneCenterY(road, 'oncoming', 1), 7, 0, 'first oncoming lane (2 lanes per direction)');
  near(laneCenterY({ ...road, traffic: 'LHT' }, 'oncoming', 1), -7, 0, 'LHT');
});

test('placeTarget: oncoming heads −x (its left is ego right); preceding heads +x', () => {
  const on = placeTarget(car, { lane: 1, d: 100 }, { ...road, lanesPerDir: 1 });
  assert.deepEqual(on.lamps[0].p, [100, 3.5 - 0.7, 0.65]);
  assert.deepEqual(on.glarePoints[0].p, [102, 3.5 - 0.37, 1.1]);
  near(on.glarePoints[0].tau, 0.9, 0, 'tau');
  const pre = placeTarget({ ...car, direction: 'own' }, { lane: 1, d: 50 }, road);
  assert.deepEqual(pre.glarePoints[0].p, [48, 0.37, 1.1]);
  const preL = placeTarget({ ...car, direction: 'own' }, { lane: 1, d: 50 }, { ...road, traffic: 'LHT' });
  assert.deepEqual(preL.glarePoints[0].p, [48, -0.37, 1.1]);
});

test('buildScene rejects unknown target types', () => {
  assert.throws(() => buildScene({ vehicle: { spacing: 1.4, hLamp: 0.65, camera: { x: 0, y: 0, z: 1 } }, road, targets: [{ type: 'ufo', d: 1 }], typeDefs: {} }), /ufo/);
});

test('VAL 1 · inverse square: uniform 1000 cd segment, eye at 50 m → E = Σ τ·I/r² over both lamps', () => {
  const field = makeField({ H: [-20, 20], V: [-10, 10], step: 0.5 });
  const uniform = { type: 'A', H: [-90, 90], V: [-90, 90], cd: [[1000, 1000], [1000, 1000]], peak: 1000 };
  const lamp = buildLamp({ low: null, segments: [uniform] }, { hdirRight: true }, field);
  const vehicle = { spacing: 1.4, hLamp: 0.65, camera: { x: -1.8, y: 0, z: 1.3 } };
  const scene = buildScene({ vehicle, road: { ...road, lanesPerDir: 1 }, targets: [{ id: 1, type: 'car', lane: 1, d: 48 }], typeDefs: { car } });
  const [eye] = scene.targets[0].glarePoints;                  // at x = 50 m
  const lamps = { L: lamp, R: lamp };
  const r2 = k => (50 - 0) ** 2 + (eye.p[1] - (k === 'L' ? 0.7 : -0.7)) ** 2 + (1.1 - 0.65) ** 2;
  const g = glareAtPoint(eye.p, eye.tau, scene, lamps, { L: [1], R: [1] });
  near(g.E, 0.9 * 1000 / r2('L') + 0.9 * 1000 / r2('R'), 1e-6, 'E');
  near(glareAtPoint(eye.p, eye.tau, scene, lamps, { L: [0], R: [0] }).E, 0, 0, 'segment off');
  const [row] = glareTable(scene, lamps, { L: [1], R: [1] });
  near(row.E_low, 0, 0, 'low-only (no low beam)'); near(row.E_hb, g.E, 1e-12, 'full high beam');
  assert.ok(row.W >= 1 && row.W <= 9);
});

test('targetOutline: oncoming starts at its front, uses the size from the type', () => {
  const o = targetOutline({ ...car, size: { length: 4.5, width: 1.8 } }, { lane: 1, d: 100 }, { ...road, lanesPerDir: 1 });
  assert.deepEqual([o.x0, o.x1], [100, 104.5]); near(o.y0, 3.5 - 0.9, 1e-12, 'y0'); near(o.y1, 3.5 + 0.9, 1e-12, 'y1');
});
