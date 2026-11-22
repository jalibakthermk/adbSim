import assert from 'node:assert/strict';

/** GLEn-style tolerance check: |a − b| ≤ tol · max(1, |b|). */
export function near(a, b, tol, msg = '') {
  const ok = Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
  assert.ok(ok, `${msg}: got ${a}, expected ${b} (tol ${tol})`);
}

/** GLEn's base config and uniform 1000 cd beam, shared by the ported tests. */
export const base = {
  hdirRight: true, angleSys: 'auto', cForward: 0, aimV: 0, aimH: 0, hLamp: 0.65, spacing: 1.4, rht: true, lat: 3.1,
  eyes: [1.1], dmin: 50, dmax: 50, dstep: 1, La: 1, age: 40, pig: 0.5, lvModel: 'sh', thMin: 0.1, tau: 1, eyePlane: 'lamp',
};
export const uniform = { type: 'A', H: [-90, 90], V: [-90, 90], cd: [[1000, 1000], [1000, 1000]], peak: 1000 };
