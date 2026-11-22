import { test } from 'node:test';
import assert from 'node:assert/strict';
import { near } from './helpers.js';
import { parseIES, writeIES, lookupRaw, idx } from '../src/core/ies.js';
import { intensityDir } from '../src/core/photometry.js';

// ---- Ported from GLEn tests 7–8 ----
const txt = 'IESNA:LM-63-2002\n[TEST] c\nTILT=NONE\n1 1000 1 3 3 1 2 0 0 0\n1 1 0\n0 90 180\n0 90 180\n100 500 100\n100 800 100\n100 300 100\n';
const ic = parseIES(txt);

test('GLEn 7a · Type C: ahead = C0, γ90', () => near(intensityDir(ic, 1, 0, 0, { hdirRight: true }), 500, 1e-12, 'C0'));
test('GLEn 7b · Type C: ahead = C90 option', () => near(intensityDir(ic, 1, 0, 0, { hdirRight: true, cForward: 90 }), 800, 1e-12, 'C90'));
test('GLEn 7c · Type C: nadir γ0', () => near(intensityDir(ic, 0, 0, -1, { hdirRight: true }), 100, 1e-12, 'nadir'));

const grid = { type: 'A', H: [-10, 0, 10], V: [-10, 0, 10], cd: [[1, 2, 3], [4, 5, 6], [7, 8, 9]], peak: 9 };
test('GLEn 8a · Type A on axis', () => near(intensityDir(grid, 1, 0, 0, { hdirRight: true }), 5, 1e-12, 'A'));
test('GLEn 8b · Type B on axis', () => near(intensityDir({ ...grid, type: 'B' }, 1, 0, 0, { hdirRight: true }), 5, 1e-12, 'B'));

// ---- New ----
test('parseIES rejects a file without TILT', () => assert.throws(() => parseIES('IESNA:LM-63-2002\n1 2 3'), /TILT/));

test('idx brackets values and returns -1 outside', () => {
  assert.equal(idx([0, 1, 2, 3], 1.5), 1);
  assert.equal(idx([0, 1, 2, 3], 3), 2);
  assert.equal(idx([0, 1, 2, 3], -0.1), -1);
});

test('lookupRaw is bilinear between grid points', () => near(lookupRaw(grid, 5, 5), (5 + 6 + 8 + 9) / 4, 1e-12, 'centre of cell'));

test('writeIES → parseIES round-trips type, grid and values', () => {
  const back = parseIES(writeIES(grid, { decimals: 3 }));
  assert.equal(back.type, 'A');
  assert.deepEqual(back.H, grid.H);
  assert.deepEqual(back.V, grid.V);
  assert.deepEqual(back.cd, grid.cd);
  const backC = parseIES(writeIES(ic));
  assert.equal(backC.type, 'C');
  assert.deepEqual(backC.cd, ic.cd);
});
