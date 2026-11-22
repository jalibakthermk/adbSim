/* Coordinate frames. Ported from GLEn v0.2. Pure: no DOM, no globals.
   Ego/world frame: x forward, yL left, z up. Lamp frame: x forward, yR right-positive, z up. */

export const DEG = Math.PI / 180;

/** World vector (x fwd, yL left, z up) → lamp frame [x, yR, z], applying aim (degrees; aimV + = up, aimH + = right). */
export function toLampFrame(x, yL, z, aimV, aimH) {
  const yR = -yL;
  const p = -aimV * DEG; // pitch
  const x1 = x * Math.cos(p) - z * Math.sin(p), z1 = x * Math.sin(p) + z * Math.cos(p);
  const q = aimH * DEG;  // yaw, right-positive
  const x2 = x1 * Math.cos(q) + yR * Math.sin(q), yR2 = yR * Math.cos(q) - x1 * Math.sin(q);
  return [x2, yR2, z1];
}

/** Lamp-frame direction → [H right-positive, V up] display angles in degrees (Type-A style). */
export function dirToHV(x, yR, z) {
  const r = Math.hypot(x, yR, z);
  return [Math.atan2(yR, x) / DEG, Math.asin(z / r) / DEG];
}

/** [H, V] display angles in degrees → unit lamp-frame direction [x, yR, z]. */
export function hvToDir(Hdeg, Vdeg) {
  return [Math.cos(Vdeg * DEG) * Math.cos(Hdeg * DEG), Math.cos(Vdeg * DEG) * Math.sin(Hdeg * DEG), Math.sin(Vdeg * DEG)];
}
