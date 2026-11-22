import { test } from 'node:test';
import { near, base, uniform } from './helpers.js';
import { deBoerW, veilingLum, evaluate, checkCfg } from '../src/core/glare.js';

// ---- Ported from GLEn tests 1–5, 9, 11 ----
test('GLEn 1 · de Boer W, E = 0.1 lx, θ = 1°, La = 1', () => {
  const den = 0.003 * (1 + Math.sqrt(1 / 0.04)) * Math.pow(60, 0.46);
  near(deBoerW([{ E: 0.1, thDeg: 1 }], 1).raw, 5 - 2 * Math.log10(0.1 / den), 1e-12, 'W');
});

const r = evaluate({ ...base, iesL: uniform }).at(0).rows[0];
const eHand = 1000 / (50 ** 2 + 2.4 ** 2 + 0.45 ** 2) + 1000 / (50 ** 2 + 3.8 ** 2 + 0.45 ** 2);
test('GLEn 2 · eye illuminance, uniform 1000 cd at 50 m (inverse square, both lamps)', () => near(r.E, eHand, 1e-12, 'E'));

test('GLEn 3a · τ = 0.8 scales E', () => near(evaluate({ ...base, iesL: uniform, tau: 0.8 })[0].rows[0].E, 0.8 * eHand, 1e-12, 'E'));
const cosL = 50 / Math.hypot(50, 2.4, 0.45), cosR = 50 / Math.hypot(50, 3.8, 0.45);
test('GLEn 3b · E·cosθ (line-of-sight) plane', () => {
  const rl = evaluate({ ...base, iesL: uniform, eyePlane: 'los' })[0].rows[0];
  near(rl.E, 1000 / (50 ** 2 + 2.4 ** 2 + 0.45 ** 2) * cosL + 1000 / (50 ** 2 + 3.8 ** 2 + 0.45 ** 2) * cosR, 1e-12, 'E');
});

const thL = Math.acos(cosL) / (Math.PI / 180), thR = Math.acos(cosR) / (Math.PI / 180);
const lvHand = 10 * (1000 / (50 ** 2 + 2.4 ** 2 + 0.45 ** 2)) / thL ** 2 + 10 * (1000 / (50 ** 2 + 3.8 ** 2 + 0.45 ** 2)) / thR ** 2;
test('GLEn 4a · Stiles–Holladay Lv', () => near(r.Lv, lvHand, 1e-12, 'Lv'));
test('GLEn 4b · TI at La = 1', () => near(r.TI, 65 * lvHand, 1e-12, 'TI'));

test('GLEn 5 · CIE 146 at θ = 1°, A = 0, p = 0 gives 15 × E', () => near(veilingLum([{ E: 1, thDeg: 1 }], 'cie', 0, 0), 15, 1e-12, 'Lv'));

const rows = evaluate({ ...base, iesL: uniform, dmin: 10, dmax: 200, dstep: 0.1 })[0].rows;
test('GLEn 9a · row count 10…200 m step 0.1', () => near(rows.length, 1901, 0, 'n'));
test('GLEn 9b · last distance exactly 200', () => near(rows.at(-1).d, 200, 0, 'd'));

test('GLEn 11 · checkCfg rejects a bad range', () => near(checkCfg({ ...base, dmin: 100, dmax: 50 }).length > 0 ? 1 : 0, 1, 0, 'errors'));

// ---- New ----
test('de Boer is clamped to 1…9 and is 9 with no light', () => {
  near(deBoerW([], 1).W, 9, 0, 'no light');
  near(deBoerW([{ E: 1e6, thDeg: 1 }], 1).W, 1, 0, 'huge E');
});
test('checkCfg accepts a valid distance range', () => near(checkCfg({ ...base, dmin: 25, dmax: 200 }).length, 0, 0, 'errors'));
