import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { near } from './helpers.js';
import { parseIES } from '../src/core/ies.js';
import { makeField, resampleHV, gridFlux } from '../src/core/grid.js';
import { buildLamp } from '../src/core/photometry.js';
import { buildScene } from '../src/core/scene.js';
import { controllerUpdate } from '../src/core/controller.js';
import { roadSources, roadE } from '../src/core/road.js';
import { keptFlux, defaultRoadPoints, comparePoints, detectionDistance, tunnelOnRoad } from '../src/core/metrics.js';

const R2D = 180 / Math.PI, D2R = Math.PI / 180;
const dir = new URL('../data/demo/', import.meta.url);
const rd = f => parseIES(readFileSync(new URL(f, dir), 'utf8'));
const meta = JSON.parse(readFileSync(new URL('segments.json', dir), 'utf8'));
const typeDefs = JSON.parse(readFileSync(new URL('../data/targets.json', import.meta.url), 'utf8')).types;
const vehicle = { spacing: 1.4, hLamp: 0.65, camera: { x: -1.8, y: 0, z: 1.3 } };
const road = { traffic: 'RHT', laneWidth: 3.5, lanesPerDir: 1 };
const ctrl = { marginH: 0.5, marginV: 0.5, minTunnel: 0, rule: 'off', dMin: 0, maxTargets: Infinity };
const demo = buildLamp({ low: rd(meta.lowBeam), segments: meta.segments.map(s => rd(s.file)) }, { hdirRight: true },
  makeField({ H: [-40, 40], V: [-12, 10], step: 0.1 }));
const demoLamps = { L: demo, R: demo };

// ---- Phase 3 acceptance ----
test('ACCEPT 3a · kept flux = 1 with no targets', () => {
  const s = buildScene({ vehicle, road, targets: [], typeDefs });
  near(keptFlux(demoLamps, controllerUpdate(s, demoLamps, ctrl).weights), 1, 1e-12, 'kept flux');
});

test('ACCEPT 3b · tunnel width on the road matches the box angle × distance', () => {
  // Fine synthetic segmentation (0.1° segments, hard edges) so the switched-off span follows the box closely.
  const f = makeField({ H: [-15, 15], V: [-3, 3], step: 0.05 });
  const hbIes = { type: 'A', H: [-15, 15], V: [-3, 3], cd: [[10000, 10000], [10000, 10000]], peak: 10000 };
  const edges = Array.from({ length: 201 }, (_, i) => +(-10 + i * 0.1).toFixed(2));
  const L = buildLamp({ low: null, highBeam: hbIes, edges, soft: 0 }, { hdirRight: true }, f);
  const R = buildLamp({ low: null, segments: [] }, { hdirRight: true }, f);   // left lamp only
  const lamps = { L, R };
  for (const d of [60, 100, 150]) {
    const s = buildScene({ vehicle, road, targets: [{ id: 1, type: 'oncoming_car', lane: 1, d }], typeDefs });
    const c = controllerUpdate(s, lamps, ctrl);
    const box = c.boxes[0].lamp.L;
    const adb = roadSources(s, lamps, c.weights), hb = roadSources(s, lamps, { L: [], R: [] });
    const t = tunnelOnRoad((x, y) => roadE(x, y, adb), (x, y) => roadE(x, y, hb), d);
    const expect = d * (Math.tan(box.hMax * D2R) - Math.tan(box.hMin * D2R));
    // The switched-off span is the box widened to whole 0.1° segments: at most 0.2° wider in total.
    assert.ok(t.width >= expect - 0.05 && t.width <= expect + d * Math.tan(0.2 * D2R) + 0.05,
      `d ${d}: tunnel ${t.width.toFixed(3)} m vs box ${expect.toFixed(3)} m`);
    // And it sits where the box points: centre at y = y_lamp − d·tan(H_centre).
    const yc = 0.7 - d * Math.tan((box.hMin + box.hMax) / 2 * D2R);
    near((t.yLeft + t.yRight) / 2, yc, d * Math.tan(0.1 * D2R) + 0.05, `d ${d}: tunnel centre`);
  }
});

// ---- Validation case 7 ----
test('VAL 7 · kept flux is 0 with every ADB segment off and 1 with none off', () => {
  near(keptFlux(demoLamps, { L: demo.segs.map(() => 0), R: demo.segs.map(() => 0) }), 0, 0, 'all off');
  near(keptFlux(demoLamps, { L: [], R: [] }), 1, 1e-12, 'none off');
  const half = keptFlux(demoLamps, { L: demo.segs.map(() => 0.5), R: demo.segs.map(() => 0.5) });
  near(half, 0.5, 1e-12, 'all at 50 %');
});

// ---- New ----
test('gridFlux of a uniform 1000 cd patch = I · ΔH · 2 sin(V)', () => {
  const g = resampleHV(() => 1000, makeField({ H: [-10, 10], V: [-10, 10], step: 0.05 }));
  const exact = 1000 * (20 * D2R) * 2 * Math.sin(10 * D2R);
  near(gridFlux(g), exact, 0.006, 'flux (cell sum, within 0.6 %)');
});

test('demo segments carry positive flux; central segments are the brightest per degree', () => {
  assert.ok(demo.segFlux.every(p => p > 0));
  const perDeg = demo.segFlux.map((p, i) => p / (meta.edges[i + 1] - meta.edges[i]));
  assert.ok(perDeg[5] > perDeg[0] && perDeg[6] > perDeg[11]);
});

test('defaultRoadPoints: near edge and oncoming lane mirror with the traffic side', () => {
  const r = defaultRoadPoints(road), l = defaultRoadPoints({ ...road, traffic: 'LHT' });
  near(r[0].y, -1.75, 0, 'RHT right edge'); near(l[0].y, 1.75, 0, 'LHT left edge');
  near(r[3].y, 3.5, 0, 'RHT oncoming'); near(l[3].y, -3.5, 0, 'LHT oncoming');
});

test('comparePoints and detectionDistance', () => {
  const [p] = comparePoints([{ label: 'p', x: 10, y: 0 }], () => 2, () => 8);
  near(p.ratio, 0.25, 0, 'ratio');
  near(detectionDistance(x => 100 / x, 0, 1), 100.5, 0, 'first drop below 1 lx');
  assert.equal(detectionDistance(() => 5, 0, 1), null);
});

test('tunnelOnRoad finds the widest dark run and null without one', () => {
  const t = tunnelOnRoad((x, y) => (y > -1 && y < 2 ? 0 : 1), () => 1, 50);
  near(t.width, 3, 0.05, 'width'); near(t.yRight, -1, 0.03, 'right');
  assert.equal(tunnelOnRoad(() => 1, () => 1, 50), null);
});
