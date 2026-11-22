import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { near } from './helpers.js';
import { hvToDir } from '../src/core/frames.js';
import { intensityDir, intensityHV, sampleHV } from '../src/core/photometry.js';
import { parseIES } from '../src/core/ies.js';
import {
  demoLowBeam, demoHighBeam, demoSegments, segmentMask, edgeStep, highBeamProfile, DEMO_SEGMENT_EDGES,
} from '../src/core/demo.js';

// ---- Ported from GLEn test 10 ----
test('GLEn 10 · demo low beam: LHT is the mirror of RHT', () => {
  const dR = demoLowBeam(false), dL = demoLowBeam(true);
  near(intensityDir(dL, ...hvToDir(3.43, 0.57), { hdirRight: true }),
    intensityDir(dR, ...hvToDir(-3.43, 0.57), { hdirRight: true }), 1e-9, 'mirror');
});

// ---- New ----
test('edgeStep is 0 / 0.5 / 1 left of, at and right of the boundary', () => {
  near(edgeStep(-1, 0, 0.5), 0, 0, 'left'); near(edgeStep(0, 0, 0.5), 0.5, 1e-12, 'at'); near(edgeStep(1, 0, 0.5), 1, 0, 'right');
});

test('segment masks form a partition of unity inside the high-beam field', () => {
  for (let h = -24; h <= 24; h += 0.37) {
    let s = 0; for (let i = 0; i < DEMO_SEGMENT_EDGES.length - 1; i++) s += segmentMask(h, i);
    near(s, 1, 1e-12, `h = ${h}`);
  }
});

test('demo: 12 segments whose sum equals the high beam everywhere', () => {
  const segs = demoSegments(), hb = demoHighBeam();
  assert.equal(segs.length, 12);
  for (let a = 0; a < hb.nH; a += 7) for (let b = 0; b < hb.nV; b += 5) {
    let s = 0; for (const g of segs) s += g.cd[a][b];
    near(s, hb.cd[a][b], 1e-9, `cell ${a},${b}`);
  }
});

test('demo high beam peaks near the axis and is brighter there than the low beam', () => {
  const hb = demoHighBeam(), lb = demoLowBeam();
  near(intensityHV(hb, 0, 0.5), highBeamProfile(0, 0.5), 1e-9, 'on-grid point near the axis');
  assert.ok(intensityHV(hb, 0, 0.5) > 10 * intensityHV(lb, 0, 0.5));
});

test('sampleHV covers the range inclusively and tracks the max', () => {
  const g = sampleHV((h, v) => h + v, [-1, 1], [0, 2], 0.5);
  assert.deepEqual(g.H, [-1, -0.5, 0, 0.5, 1]);
  assert.deepEqual(g.V, [0, 0.5, 1, 1.5, 2]);
  near(g.max, 3, 0, 'max');
  near(g.val[1][3], 1, 0, 'val[V=0.5][H=0.5]');
});

test('shipped data/demo files match the generator (sum of segments = high beam within 1 %)', () => {
  const dir = new URL('../data/demo/', import.meta.url);
  const meta = JSON.parse(readFileSync(new URL('segments.json', dir), 'utf8'));
  assert.deepEqual(meta.edges, DEMO_SEGMENT_EDGES);
  const hb = parseIES(readFileSync(new URL(meta.highBeam, dir), 'utf8'));
  const segs = meta.segments.map(s => parseIES(readFileSync(new URL(s.file, dir), 'utf8')));
  let worst = 0;
  for (let a = 0; a < hb.nH; a++) for (let b = 0; b < hb.nV; b++) {
    let s = 0; for (const g of segs) s += g.cd[a][b];
    worst = Math.max(worst, Math.abs(s - hb.cd[a][b]));
  }
  assert.ok(worst <= 0.01 * hb.peak, `worst deviation ${worst} cd vs peak ${hb.peak} cd`);
});
