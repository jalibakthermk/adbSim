/* Intensity toward a direction. intensityDir ported from GLEn v0.2. Pure: no DOM, no globals.
   The lamp model (low + Σ w_i·seg_i) arrives in Phase 1. */
import { lookupRaw } from './ies.js';
import { DEG, hvToDir } from './frames.js';

/** Lamp-frame direction (x fwd, yR right-positive, z up) → intensity (cd).
    opt: { hdirRight, angleSys: 'auto'|'A'|'B'|'C', cForward: C-plane pointing straight ahead (Type C only) } */
export function intensityDir(ies, x, yR, z, opt) {
  opt = typeof opt === 'object' ? opt : { hdirRight: !!opt };
  const r = Math.hypot(x, yR, z); if (r === 0) return 0;
  const yF = opt.hdirRight ? yR : -yR; // lateral in the file's H+ sense
  const sys = opt.angleSys && opt.angleSys !== 'auto' ? opt.angleSys : ies.type;
  if (sys === 'C') {
    const g = Math.acos(Math.max(-1, Math.min(1, -z / r))) / DEG;
    let c = (opt.cForward || 0) + Math.atan2(yF, x) / DEG; c = ((c % 360) + 360) % 360;
    const H = ies.H, Hmax = H[H.length - 1];
    if (H.length === 1) return lookupRaw(ies, H[0], g);
    if (Math.abs(Hmax - 90) < 1e-6) { c = c % 180; if (c > 90) c = 180 - c; }
    else if (Math.abs(Hmax - 180) < 1e-6) { if (c > 180) c = 360 - c; }
    else if (c > Hmax && H[0] === 0 && Hmax < 360) { // wrap gap between last plane and 360° (= C0)
      const t = (c - Hmax) / (360 - Hmax);
      return lookupRaw(ies, Hmax, g) * (1 - t) + lookupRaw(ies, 0, g) * t;
    }
    return lookupRaw(ies, c, g);
  }
  let h, v;
  if (sys === 'B') { v = Math.atan2(z, x) / DEG; h = Math.asin(yF / r) / DEG; } // planes about the lateral axis
  else { h = Math.atan2(yF, x) / DEG; v = Math.asin(z / r) / DEG; }            // Type A: H about vertical axis, V elevation
  if (ies.H[0] >= 0 && h < 0) h = -h; // file stores one half only (left/right symmetric)
  return lookupRaw(ies, h, v);
}

/** Sample f(H, V) on a regular H-V grid (degrees, H+ right). Returns { H[], V[], val[iV][iH], max }. */
export function sampleHV(f, [h0, h1], [v0, v1], step) {
  const nH = Math.round((h1 - h0) / step) + 1, nV = Math.round((v1 - v0) / step) + 1;
  const H = Array.from({ length: nH }, (_, i) => +(h0 + i * step).toFixed(6));
  const V = Array.from({ length: nV }, (_, j) => +(v0 + j * step).toFixed(6));
  let max = 0;
  const val = V.map(v => H.map(h => { const x = f(h, v); if (x > max) max = x; return x; }));
  return { H, V, val, max };
}

/** Intensity of an IES at display angles (H right-positive, V up) in the lamp frame. */
export function intensityHV(ies, Hdeg, Vdeg, opt = { hdirRight: true }) {
  return intensityDir(ies, ...hvToDir(Hdeg, Vdeg), opt);
}
