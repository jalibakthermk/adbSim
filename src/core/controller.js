/* ADB controller: detected boxes (camera) → margins → lamp boxes (parallax) → segment weights; low-beam fallback.
   Latency is applied by the scenario step (scenario.js): the controller sees the scene at t − latency. Pure: no DOM, no globals. */
import { anglesFrom, cameraBoxToLamp } from './frames.js';

/** Targets closer than this ahead of the camera (m) are not detected: they are passing or behind. */
export const MIN_DEPTH = 1;

/** Angular box of points seen from the camera (camera axes = ego axes). Also the nearest depth (x ahead of camera). */
export function featureBox(points, cam) {
  const b = { hMin: Infinity, hMax: -Infinity, vMin: Infinity, vMax: -Infinity, depth: Infinity };
  for (const p of points) {
    const [H, V] = anglesFrom(cam, p);
    b.hMin = Math.min(b.hMin, H); b.hMax = Math.max(b.hMax, H);
    b.vMin = Math.min(b.vMin, V); b.vMax = Math.max(b.vMax, V);
    b.depth = Math.min(b.depth, p[0] - cam[0]);
  }
  return b;
}

/** Add margins (degrees) on each side; widen symmetrically to the minimum dark-tunnel width. */
export function addMargins(box, marginH, marginV, minTunnel = 0) {
  let hMin = box.hMin - marginH, hMax = box.hMax + marginH;
  if (hMax - hMin < minTunnel) { const c = (hMin + hMax) / 2; hMin = c - minTunnel / 2; hMax = c + minTunnel / 2; }
  return { ...box, hMin, hMax, vMin: box.vMin - marginV, vMax: box.vMax + marginV };
}

/** Fraction of segment support s's H extent covered by box b (0 when the V ranges do not overlap). */
export function coverH(s, b) {
  if (!s || b.vMax < s.vMin || b.vMin > s.vMax) return 0;
  const o = Math.min(s.hMax, b.hMax) - Math.max(s.hMin, b.hMin);
  if (o < 0) return 0;
  return s.hMax > s.hMin ? Math.min(1, o / (s.hMax - s.hMin)) : 1;
}

/** Segment weights from boxes. rule 'off': w_i = 0 if S_i overlaps any box. rule 'dim': w_i = 1 − covered H fraction
    (largest over the boxes); a segment whose support is fully covered is off. */
export function maskWeights(supports, boxes, rule = 'off') {
  return supports.map(s => {
    if (!s) return 1;
    let c = 0, touch = false;
    for (const b of boxes) {
      if (b.hMax >= s.hMin && b.hMin <= s.hMax && b.vMax >= s.vMin && b.vMin <= s.vMax) touch = true;
      c = Math.max(c, coverH(s, b));
    }
    if (!touch) return 1;
    return rule === 'dim' ? 1 - c : 0;
  });
}

/** One controller step on a scene.
    lampModels: { L, R } from buildLamp; ctrl: { marginH, marginV, minTunnel, rule, dMin, maxTargets }.
    Returns { boxes: [{ id, visible, cam, camM, lamp: { L, R } (with margins), lampRaw: { L, R } (detected) }], weights: { L, R }, fallback: null | 'distance' | 'count' } */
export function controllerUpdate(scene, lampModels, ctrl) {
  const boxes = scene.targets.map(t => {
    const cam = featureBox([...t.lamps.map(l => l.p), ...t.glarePoints.map(g => g.p)], scene.camera);
    // A target is detected only when all its features are ahead of the camera (it has not passed yet).
    const visible = cam.depth > MIN_DEPTH;
    if (!visible) return { id: t.id, visible, cam, camM: null, lamp: null, lampRaw: null };
    const camM = addMargins(cam, ctrl.marginH, ctrl.marginV, ctrl.minTunnel);
    const lamp = {}, lampRaw = {};
    for (const k of ['L', 'R']) {
      const L = scene.lamps[k];
      lamp[k] = cameraBoxToLamp(camM, cam.depth, scene.camera, L.pos, L.aimV, L.aimH);
      lampRaw[k] = cameraBoxToLamp(cam, cam.depth, scene.camera, L.pos, L.aimV, L.aimH);
    }
    return { id: t.id, visible, cam, camM, lamp, lampRaw };
  });
  const seen = scene.targets.filter((_, i) => boxes[i].visible);
  let fallback = null;
  if (seen.some(t => t.d < (ctrl.dMin || 0))) fallback = 'distance';
  else if (seen.length > (ctrl.maxTargets ?? Infinity)) fallback = 'count';
  const weights = {};
  for (const k of ['L', 'R']) {
    const sup = lampModels[k].supports;
    weights[k] = fallback ? sup.map(() => 0) : maskWeights(sup, boxes.filter(b => b.visible).map(b => b.lamp[k]), ctrl.rule);
  }
  return { boxes, weights, fallback };
}
