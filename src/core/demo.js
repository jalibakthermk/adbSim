/* Synthetic demo beams (Type A, H+ = right). Pure: no DOM, no globals.
   - demoLowBeam: ported from GLEn v0.2 (cut-off 0.57° D on the left, 15° rise on the right).
   - demoHighBeam / demoSegments: a 12-segment matrix high beam. Segment i is the high beam masked to
     [edges[i], edges[i+1]] with a smoothstep edge of `soft` degrees. The masks telescope, so the segments
     sum exactly to the high beam. */
import { DEG } from './frames.js';
import { edgeStep, segmentMask } from './segments.js';

const smooth = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);

function range(a, b, step) {
  const n = Math.round((b - a) / step) + 1;
  return Array.from({ length: n }, (_, i) => +(a + i * step).toFixed(4));
}

function typeA(H, V, f, keyword) {
  const cd = H.map(h => V.map(v => f(h, v)));
  let peak = 0; for (const r of cd) for (const v of r) peak = Math.max(peak, v);
  return { type: 'A', H, V, cd, nV: V.length, nH: H.length, peak, keywords: [`[TEST] ${keyword}`], demo: true };
}

/** Synthetic low beam (GLEn demo). lht = true mirrors it for left-hand traffic. */
export function demoLowBeam(lht = false) {
  const H = range(-40, 40, 0.5), V = range(-15, 10, 0.1);
  const out = typeA(H, V, (h0, v) => {
    const h = lht ? -h0 : h0;
    const hot = 22000 * Math.exp(-((h - 1.5) ** 2) / (2 * 4 ** 2) - ((v + 1.6) ** 2) / (2 * 1.2 ** 2));
    const wide = 4500 * Math.exp(-(h * h) / (2 * 18 ** 2) - ((v + 3.5) ** 2) / (2 * 3 ** 2));
    const fore = 1500 * Math.exp(-(h * h) / (2 * 30 ** 2)) * (v < -4 ? 1 : Math.exp(-((v + 4) ** 2) / 2));
    let cut = -0.57; if (h > 0) cut = Math.min(-0.57 + Math.tan(15 * DEG) * h, 1.0);
    const below = 1 - smooth((v - cut + 0.15) / 0.3); // transition over ~0.3°
    const glareFloor = 250 * Math.exp(-Math.max(0, v - cut) / 6) * Math.exp(-(h * h) / (2 * 25 ** 2));
    return (hot + wide + fore) * below + glareFloor;
  }, 'GLEn synthetic low beam');
  out.lht = lht;
  return out;
}

/** Default segment boundaries (H, degrees, H+ right): 12 segments, narrower near the axis. */
export const DEMO_SEGMENT_EDGES = [-25, -16, -11, -7.5, -4.5, -2, 0, 2, 4.5, 7.5, 11, 16, 25];
export const DEMO_SOFT_EDGE = 0.5;
const HB_GRID = { H: [-30, 30], V: [-12, 12], step: 0.25 };

/** Unmasked high-beam profile (cd) at (h, v). */
export function highBeamProfile(h, v) {
  return 55000 * Math.exp(-(h * h) / (2 * 5 ** 2) - ((v - 0.3) ** 2) / (2 * 1.4 ** 2))
       + 9000 * Math.exp(-(h * h) / (2 * 14 ** 2) - ((v + 0.5) ** 2) / (2 * 3 ** 2));
}

/** Full synthetic high beam = profile masked to [edges[0], edges.at(-1)]. */
export function demoHighBeam(edges = DEMO_SEGMENT_EDGES, soft = DEMO_SOFT_EDGE) {
  const H = range(HB_GRID.H[0], HB_GRID.H[1], HB_GRID.step), V = range(HB_GRID.V[0], HB_GRID.V[1], HB_GRID.step);
  const n = edges.length - 1;
  return typeA(H, V, (h, v) => highBeamProfile(h, v) * (edgeStep(h, edges[0], soft) - edgeStep(h, edges[n], soft)),
    'adbSim synthetic high beam');
}

/** The synthetic segments, one IES object per segment at 100 %. */
export function demoSegments(edges = DEMO_SEGMENT_EDGES, soft = DEMO_SOFT_EDGE) {
  const H = range(HB_GRID.H[0], HB_GRID.H[1], HB_GRID.step), V = range(HB_GRID.V[0], HB_GRID.V[1], HB_GRID.step);
  return edges.slice(0, -1).map((_, i) =>
    typeA(H, V, (h, v) => highBeamProfile(h, v) * segmentMask(h, i, edges, soft),
      `adbSim synthetic segment ${i + 1} of ${edges.length - 1} (${edges[i]}° to ${edges[i + 1]}°)`));
}
