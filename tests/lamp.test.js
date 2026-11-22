import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { near } from './helpers.js';
import { parseIES } from '../src/core/ies.js';
import { makeField, gridAt, gridMax } from '../src/core/grid.js';
import { buildLamp, lampGrid, lampIntensityHV, sumGrids, intensityHV } from '../src/core/photometry.js';
import { demoLowBeam, demoHighBeam, DEMO_SEGMENT_EDGES, DEMO_SOFT_EDGE } from '../src/core/demo.js';

const opt = { hdirRight: true, angleSys: 'auto', cForward: 0 };
const field = makeField({ H: [-30, 30], V: [-8, 8], step: 0.25 });
const dir = new URL('../data/demo/', import.meta.url);
const read = f => parseIES(readFileSync(new URL(f, dir), 'utf8'));
const meta = JSON.parse(readFileSync(new URL('segments.json', dir), 'utf8'));
const lowIes = read(meta.lowBeam), hbIes = read(meta.highBeam);
const filesLamp = buildLamp({ low: lowIes, segments: meta.segments.map(s => read(s.file)) }, opt, field);
const synthLamp = buildLamp({ low: lowIes, highBeam: hbIes, edges: meta.edges, soft: meta.softEdge_deg }, opt, field);
const hbOnly = buildLamp({ low: hbIes }, opt, field).low;

function worstDiff(a, b) {
  let w = 0; for (let p = 0; p < a.data.length; p++) w = Math.max(w, Math.abs(a.data[p] - b.data[p]));
  return w;
}

// ---- Phase 1 acceptance ----
test('ACCEPT 1a · segment files: Σ segments at w = 1 equals the high-beam file within 1 %', () => {
  const sum = sumGrids(filesLamp.segs), peak = gridMax(hbOnly);
  const worst = worstDiff(sum, hbOnly);
  assert.ok(worst <= 0.01 * peak, `worst ${worst} cd vs peak ${peak} cd`);
});

test('ACCEPT 1b · synthetic segmentation: Σ segments at w = 1 equals the high-beam file within 1 %', () => {
  const sum = sumGrids(synthLamp.segs), peak = gridMax(hbOnly);
  const worst = worstDiff(sum, hbOnly);
  assert.ok(worst <= 0.01 * peak, `worst ${worst} cd vs peak ${peak} cd`);
});

test('ACCEPT 1c · a toggled segment disappears from the map (and nothing else changes)', () => {
  for (const lamp of [filesLamp, synthLamp]) {
    const k = 6; // segment 7, 0° … 2°
    const w = lamp.segs.map((_, i) => (i === k ? 0 : 1));
    const on = lampGrid(lamp), off = lampGrid(lamp, w);
    for (let p = 0; p < on.data.length; p++) near(on.data[p] - off.data[p], lamp.segs[k].data[p], 1e-3, `cell ${p}`);
    // Mid-segment, only the low beam and the (zero) neighbour tails remain.
    near(gridAt(off, 1, 0.5), gridAt(lamp.low, 1, 0.5), 1e-3, `${lamp.mode}: mid-segment is low beam only`);
    assert.ok(gridAt(on, 1, 0.5) > 10 * gridAt(off, 1, 0.5));
  }
});

// ---- New ----
test('lamp model: low + Σ w_i·seg_i, with dimming weights and clamping', () => {
  const w = synthLamp.segs.map(() => 0.5);
  const h = 3, v = 0.25;
  const expect = gridAt(synthLamp.low, h, v) + 0.5 * synthLamp.segs.reduce((s, g) => s + gridAt(g, h, v), 0);
  near(lampIntensityHV(synthLamp, w, h, v), expect, 1e-6, 'w = 0.5');
  near(gridAt(lampGrid(synthLamp, w), h, v), expect, 1e-4, 'grid matches point lookup');
  near(lampIntensityHV(synthLamp, synthLamp.segs.map(() => 7), h, v), lampIntensityHV(synthLamp, [], h, v), 1e-9, 'w > 1 clamps to 1');
});

test('resampled low beam matches the IES lookup at grid points', () => {
  near(gridAt(synthLamp.low, -2, -1.5), intensityHV(lowIes, -2, -1.5, opt), 1e-3, 'low');
});

test('buildLamp: per-file and synthetic modes give matching boundaries close to the demo edges', () => {
  assert.equal(filesLamp.mode, 'files'); assert.equal(synthLamp.mode, 'synthetic');
  assert.equal(filesLamp.boundaries.length, 11);
  filesLamp.boundaries.forEach((b, k) => near(b.H, DEMO_SEGMENT_EDGES[k + 1], 0.3, `files boundary ${k}`));
  synthLamp.boundaries.forEach((b, k) => near(b.H, DEMO_SEGMENT_EDGES[k + 1], 0.3, `synthetic boundary ${k}`));
  assert.deepEqual(filesLamp.order, [...Array(12).keys()]);
});

test('buildLamp rejects synthetic mode without boundaries; low-only lamp works', () => {
  assert.throws(() => buildLamp({ highBeam: demoHighBeam(), edges: [1] }, opt, field), /two boundaries/);
  const lo = buildLamp({ low: demoLowBeam() }, opt, field);
  assert.equal(lo.segs.length, 0);
  near(gridAt(lampGrid(lo), 0, -2), gridAt(lo.low, 0, -2), 0, 'low only');
  assert.equal(DEMO_SOFT_EDGE, meta.softEdge_deg);
});
