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

/* ---------------- Ego geometry (Phase 2) ---------------- */

/** Lamp positions in the ego frame: { L: [x, y, z], R: [...] }. Origin on the road under the lamps' midpoint. */
export function lampPositions({ spacing, hLamp, xLamp = 0 }) {
  return { L: [xLamp, spacing / 2, hLamp], R: [xLamp, -spacing / 2, hLamp] };
}

/** Display angles [H right+, V up] (degrees) of point `to` seen from `from` (ego frame), in a frame aimed by aimV/aimH. */
export function anglesFrom(from, to, aimV = 0, aimH = 0) {
  const d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  return dirToHV(...toLampFrame(d[0], d[1], d[2], aimV, aimH));
}

/** Re-observe a camera-frame angular box from a lamp (parallax).
    Points on the box outline are projected along their camera rays to depth `depth` (m ahead of the camera, in x),
    then seen from the lamp at `lampPos` with aim aimV/aimH. Returns the lamp-frame bounding box. */
export function cameraBoxToLamp(box, depth, cam, lampPos, aimV = 0, aimH = 0) {
  const hs = [box.hMin, (box.hMin + box.hMax) / 2, box.hMax], vs = [box.vMin, (box.vMin + box.vMax) / 2, box.vMax];
  const out = { hMin: Infinity, hMax: -Infinity, vMin: Infinity, vMax: -Infinity };
  for (const h of hs) for (const v of vs) {
    const [x, yR, z] = hvToDir(h, v);                 // camera frame = ego axes (camera not aimed)
    const k = depth / x;
    const p = [cam[0] + k * x, cam[1] - k * yR, cam[2] + k * z];
    const [H, V] = anglesFrom(lampPos, p, aimV, aimH);
    out.hMin = Math.min(out.hMin, H); out.hMax = Math.max(out.hMax, H);
    out.vMin = Math.min(out.vMin, V); out.vMax = Math.max(out.vMax, V);
  }
  return out;
}
