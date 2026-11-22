import { test } from 'node:test';
import assert from 'node:assert/strict';
import { near } from './helpers.js';
import { makeField, resampleHV } from '../src/core/grid.js';
import { roadE, roadGrid, diffGrid, contourSegs, rangeOn, widthAt, laneMarkings } from '../src/core/road.js';

const field = makeField({ H: [-45, 45], V: [-15, 15], step: 0.5 });
const uniform = resampleHV(() => 1000, field);
const src = [{ pos: [0, 0.7, 0.65], aimV: 0, aimH: 0, grid: uniform }, { pos: [0, -0.7, 0.65], aimV: 0, aimH: 0, grid: uniform }];

test('roadE, vertical planes (HSPR): E = Σ I·x / D³ at the evaluation height', () => {
  const x = 50, y = -2, D = py => Math.hypot(x, y - py, 0.65);
  near(roadE(x, y, src), 1000 * x / D(0.7) ** 3 + 1000 * x / D(-0.7) ** 3, 1e-9, 'E');
  const Dz = py => Math.hypot(x, y - py, 0.25 - 0.65);
  near(roadE(x, y, src, { evalH: 0.25 }), 1000 * x / Dz(0.7) ** 3 + 1000 * x / Dz(-0.7) ** 3, 1e-9, 'evalH 0.25');
});

test('roadE, road surface: E = Σ I·h / D³; nothing behind the lamps', () => {
  const x = 20, y = 1, D = py => Math.hypot(x, y - py, 0.65);
  near(roadE(x, y, src, { method: 'road' }), 1000 * 0.65 / D(0.7) ** 3 + 1000 * 0.65 / D(-0.7) ** 3, 1e-9, 'E');
  near(roadE(-5, 0, src), 0, 0, 'behind');
});

test('roadGrid samples cell centres, tracks the maximum; diffGrid subtracts', () => {
  const g = roadGrid({ x0: 0, x1: 10, y0: -2, y1: 2, nx: 10, ny: 4 }, (x, y) => x + y);
  near(g.E[0], 0.5 + -1.5, 1e-6, 'first cell'); near(g.emax, 9.5 + 1.5, 1e-6, 'max');
  assert.deepEqual(g.at, [9.5, 1.5]);
  const d = diffGrid(g, roadGrid({ x0: 0, x1: 10, y0: -2, y1: 2, nx: 10, ny: 4 }, () => 1));
  near(d.E[0], -2, 1e-6, 'diff');
});

test('contourSegs: a linear ramp gives one straight isoline at the right place', () => {
  const g = roadGrid({ x0: 0, x1: 10, y0: 0, y1: 4, nx: 10, ny: 4 }, x => x);
  const segs = contourSegs(g, 5);
  assert.equal(segs.length, 3);                       // one per row pair
  for (const [a, b] of segs) { near(a[0], 4.5, 1e-6, 'i at x = 5'); near(b[0], 4.5, 1e-6, 'i'); }
});

test('rangeOn and widthAt (Road-illuminate definitions)', () => {
  const f = (x, y) => (Math.abs(y) <= 3 ? 1000 / x : 0);
  near(rangeOn(f, 0, 10), 100, 1e-9, 'range');
  assert.equal(rangeOn(f, 5, 1), null);
  const w = widthAt(f, 50, 1);
  near(w[0], -3, 1e-9, 'right'); near(w[1], 3, 1e-9, 'left');
});

test('laneMarkings: RHT edges and centre line, LHT mirrors', () => {
  const m = laneMarkings({ traffic: 'RHT', laneWidth: 3.5, lanesPerDir: 1 });
  assert.deepEqual(m.map(x => [x.name, x.y]), [['Right edge', -1.75], ['Centre line', 1.75], ['Left edge', 5.25]]);
  const l = laneMarkings({ traffic: 'LHT', laneWidth: 3.5, lanesPerDir: 2 });
  assert.deepEqual(l.map(x => x.y), [1.75, -1.75, -5.25, -8.75, -12.25]);
  assert.equal(l[0].name, 'Left edge');
});
