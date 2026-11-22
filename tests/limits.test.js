import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { near } from './helpers.js';
import { validateLimits, entryMatches, limitAt, evaluateGlare, overallStatus } from '../src/core/limits.js';

const shipped = JSON.parse(readFileSync(new URL('../data/limits.json', import.meta.url), 'utf8'));
const row = (o = {}) => ({ type: 'oncoming_car', pointId: 'driver_eye', d: 100, E: 0.5, W: 6, ...o });

test('shipped limits.json is valid and holds no limit values (all null)', () => {
  assert.deepEqual(validateLimits(shipped), []);
  assert.ok(shipped.glare.every(g => g.E_max_lx.every(v => v === null)));
  assert.equal(shipped.deBoer_min, null);
  const ev = evaluateGlare([row()], shipped);
  assert.equal(ev[0].status, 'none'); assert.equal(ev[0].E_max, null);
  assert.equal(overallStatus(ev), 'none');
});

test('validateLimits reports structural problems', () => {
  assert.ok(validateLimits(null).length);
  assert.ok(validateLimits({ glare: [{ target: 'x', point: 'y', dist_m: [100, 50], E_max_lx: [1, 1] }] }).length);
  assert.ok(validateLimits({ glare: [{ target: 'x', point: 'y', dist_m: [50], E_max_lx: [1, 2] }] }).length);
  assert.ok(validateLimits({ glare: [], deBoer_min: 12 }).length);
});

test('entryMatches: exact point, and "mirror" matches every mirror point', () => {
  const m = { target: 'preceding_car', point: 'mirror' };
  assert.ok(entryMatches(m, 'preceding_car', 'mirror_L') && entryMatches(m, 'preceding_car', 'mirror_interior'));
  assert.ok(!entryMatches(m, 'preceding_car', 'driver_eye') && !entryMatches(m, 'oncoming_car', 'mirror_L'));
});

// Test values only (not regulation values): limits come from the file at run time.
const test1 = { target: 'oncoming_car', point: 'driver_eye', dist_m: [50, 100, 200], E_max_lx: [2, 1, null] };

test('limitAt: exact, linear in between, null outside or next to a null', () => {
  near(limitAt(test1, 100), 1, 0, 'exact'); near(limitAt(test1, 75), 1.5, 1e-12, 'between');
  assert.equal(limitAt(test1, 150), null); assert.equal(limitAt(test1, 30), null); assert.equal(limitAt(test1, 250), null);
});

test('evaluateGlare: pass/fail on E and de Boer, strictest entry wins', () => {
  const L = { glare: [test1, { ...test1, E_max_lx: [1, 0.4, null] }], deBoer_min: 5 };
  const [a, b, c] = evaluateGlare([row(), row({ E: 0.3 }), row({ E: 0.3, W: 4 })], L);
  near(a.E_max, 0.4, 0, 'strictest'); assert.equal(a.eStatus, 'fail'); assert.equal(a.status, 'fail');
  assert.equal(b.status, 'pass');
  assert.equal(c.eStatus, 'pass'); assert.equal(c.wStatus, 'fail'); assert.equal(c.status, 'fail');
  assert.equal(overallStatus([b]), 'pass'); assert.equal(overallStatus([a, b]), 'fail');
});
