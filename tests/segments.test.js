import { test } from 'node:test';
import assert from 'node:assert/strict';
import { near } from './helpers.js';
import { makeField, resampleHV, gridAt, weightedSum, gridMax, colSums } from '../src/core/grid.js';
import {
  parseEdges, syntheticSegments, supportBox, centroidH, segmentBoundaries, segmentAt, segmentSpans,
} from '../src/core/segments.js';

const field = makeField({ H: [-10, 10], V: [-2, 2], step: 0.5 });

// ---- grid.js ----
test('makeField counts end points inclusively and rejects bad ranges', () => {
  assert.equal(field.nH, 41); assert.equal(field.nV, 9);
  assert.throws(() => makeField({ H: [1, 0], V: [0, 1], step: 0.1 }));
});

test('gridAt is exact on bilinear functions and 0 outside the field', () => {
  const g = resampleHV((h, v) => 2 * h + 3 * v + 1, field);
  near(gridAt(g, 1.3, -0.7), 2 * 1.3 + 3 * -0.7 + 1, 1e-5, 'inside');
  near(gridAt(g, 10, 2), 20 + 6 + 1, 1e-5, 'corner');
  near(gridAt(g, 10.5, 0), 0, 0, 'outside');
});

test('weightedSum, gridMax and colSums', () => {
  const a = resampleHV(() => 1, field), b = resampleHV(() => 2, field);
  const s = weightedSum(a, [b, b], [0.5, 0]);
  near(gridAt(s, 0, 0), 2, 1e-12, 'base + 0.5·b');
  near(gridMax(s), 2, 1e-12, 'max');
  near(colSums(a)[0], field.nV, 1e-12, 'column sum');
});

// ---- segments.js ----
test('parseEdges accepts commas/spaces and rejects bad lists', () => {
  assert.deepEqual(parseEdges('-5, 0  5;10').edges, [-5, 0, 5, 10]);
  assert.ok(parseEdges('0 0 1').errors.length);
  assert.ok(parseEdges('3').errors.length);
  assert.ok(parseEdges('1 x 3').errors.length);
});

const hb = resampleHV((h, v) => 1000 * Math.exp(-(h * h) / 50 - v * v), field);
const edges = [-8, -3, 0, 3, 8];

test('syntheticSegments sum to the high beam inside the outer edges', () => {
  const segs = syntheticSegments(hb, edges, 1);
  assert.equal(segs.length, 4);
  for (const h of [-7, -2.9, 0, 0.2, 5.5]) {
    near(segs.reduce((s, g) => s + gridAt(g, h, 0.5), 0), gridAt(hb, h, 0.5), 1e-4, `h = ${h}`);
  }
});

test('supportBox brackets the segment and is null for an empty one', () => {
  const [s0] = syntheticSegments(hb, edges, 0);
  const box = supportBox(s0, 0.05);
  assert.ok(box.hMin >= -8 && box.hMax <= -3 + 1e-9, JSON.stringify(box));
  assert.equal(supportBox(resampleHV(() => 0, field)), null);
});

test('segmentBoundaries recovers the synthetic edges and orders segments left → right', () => {
  const segs = syntheticSegments(hb, edges, 1);
  const shuffled = [segs[2], segs[0], segs[3], segs[1]];
  const { order, boundaries } = segmentBoundaries(shuffled);
  assert.deepEqual(order, [1, 3, 0, 2]);
  boundaries.forEach((b, k) => near(b.H, edges[k + 1], 0.26, `boundary ${k}`));
});

test('centroidH is NaN for an empty segment', () => assert.ok(Number.isNaN(centroidH(resampleHV(() => 0, field)))));

test('segmentAt picks the dominant segment and −1 where nothing shines', () => {
  const segs = syntheticSegments(hb, edges, 1);
  assert.equal(segmentAt(segs, -5, 0), 0);
  assert.equal(segmentAt(segs, 1.5, 0), 2);
  assert.equal(segmentAt(segs, 9.5, 0), -1);
});

test('segmentSpans tile the field between boundaries and use the support at the outer sides', () => {
  const segs = syntheticSegments(hb, edges, 1);
  const supports = segs.map(g => supportBox(g, 0.05));
  const { order, boundaries } = segmentBoundaries(segs);
  const spans = segmentSpans(supports, order, boundaries);
  near(spans[0].h0, supports[0].hMin, 0, 'outer left');
  near(spans[0].h1, spans[1].h0, 0, 'shared boundary');
  near(spans[3].h1, supports[3].hMax, 0, 'outer right');
  near(spans[1].hc, (spans[1].h0 + spans[1].h1) / 2, 1e-12, 'centre');
});
