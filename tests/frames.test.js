import { test } from 'node:test';
import { near } from './helpers.js';
import { toLampFrame, dirToHV, hvToDir } from '../src/core/frames.js';

// ---- Ported from GLEn test 6 ----
test('GLEn 6a · vertical aim sign: lamp aimed 1° down sees a horizontal ray 1° up', () => {
  const v = toLampFrame(1, 0, 0, -1, 0);
  near(Math.asin(v[2]) * 180 / Math.PI, 1, 1e-9, 'V');
});
test('GLEn 6b · horizontal aim sign: lamp aimed right → ray appears left', () => {
  const h = toLampFrame(1, 0, 0, 0, 1);
  near(Math.atan2(h[1], h[0]) * 180 / Math.PI, -1, 1e-9, 'H');
});

// ---- New ----
test('toLampFrame flips y: a point to the left (yL > 0) has H < 0 (H+ is right)', () => {
  const [H] = dirToHV(...toLampFrame(10, 1, 0, 0, 0));
  near(H, -Math.atan2(1, 10) * 180 / Math.PI, 1e-12, 'H');
});
test('hvToDir and dirToHV are inverse', () => {
  for (const [H, V] of [[0, 0], [12.5, -3], [-30, 7.25]]) {
    const [h, v] = dirToHV(...hvToDir(H, V));
    near(h, H, 1e-12, 'H'); near(v, V, 1e-12, 'V');
  }
});
