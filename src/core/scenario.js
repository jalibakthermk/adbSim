/* Dynamic scenarios: one time step with controller latency, and a whole run over time.
   Pure: no DOM, no globals. The controller sees the scene at t − latency; the photometry uses the true scene at t. */
import { buildSceneAt } from './scene.js';
import { controllerUpdate } from './controller.js';
import { glareTable } from './glare.js';
import { keptFlux } from './metrics.js';
import { evaluateGlare } from './limits.js';

/** One step. cfg: { vehicle, road, targets, typeDefs, vEgo_kmh, controller, auto, manualWeights, La, limits }.
    Returns { t, scene, detScene, ctrl, weights, rows } — ctrl boxes are the delayed (detected) ones. */
export function stepAt(cfg, lampModels, t, latency_s = 0) {
  const scene = buildSceneAt(cfg, t);
  const detScene = latency_s > 0 ? buildSceneAt(cfg, t - latency_s) : scene;
  const ctrl = controllerUpdate(detScene, lampModels, cfg.controller);
  const weights = cfg.auto === false && cfg.manualWeights ? cfg.manualWeights : ctrl.weights;
  const rows = evaluateGlare(glareTable(scene, lampModels, weights, { La: cfg.La ?? 1 }), cfg.limits);
  return { t, scene, detScene, ctrl, weights, rows };
}

/** Run t = 0 … tMax in steps of dt (index-based, no float drift).
    Returns { t: [], series: [{ key, targetId, pointId, target, point, type, d: [], E: [], E_low: [], E_hb: [], E_max: [], status: [] }],
              weights: { L: [[w_i] per step], R }, kept: [], fallback: [], peaks: [{ key, E, t, d }] } */
export function runScenario(cfg, lampModels, { tMax, dt, latency_s = 0 }) {
  const n = Math.max(1, Math.floor(tMax / dt + 1e-9) + 1);
  const out = { t: [], series: [], weights: { L: [], R: [] }, kept: [], fallback: [] };
  const byKey = new Map();
  for (let k = 0; k < n; k++) {
    const t = +(k * dt).toFixed(9);
    const s = stepAt(cfg, lampModels, t, latency_s);
    out.t.push(t);
    out.weights.L.push(s.weights.L.slice()); out.weights.R.push(s.weights.R.slice());
    out.kept.push(keptFlux(lampModels, s.weights));
    out.fallback.push(s.ctrl.fallback);
    for (const r of s.rows) {
      const key = `${r.targetId}:${r.pointId}`;
      let ser = byKey.get(key);
      if (!ser) {
        ser = { key, targetId: r.targetId, pointId: r.pointId, target: r.target, point: r.point, type: r.type, d: [], E: [], E_low: [], E_hb: [], E_max: [], status: [] };
        byKey.set(key, ser); out.series.push(ser);
      }
      ser.d.push(r.d); ser.E.push(r.E); ser.E_low.push(r.E_low); ser.E_hb.push(r.E_hb); ser.E_max.push(r.E_max); ser.status.push(r.status);
    }
  }
  out.peaks = out.series.map(s => {
    let k = 0; s.E.forEach((e, i) => { if (e > s.E[k]) k = i; });
    return { key: s.key, E: s.E[k], t: out.t[k], d: s.d[k], index: k };
  });
  return out;
}

/** Time at which a target reaches distance dEnd (m), for choosing tMax. Infinity if it never closes. */
export function timeToDistance(d0, dEnd, direction, v_kmh, vEgo_kmh) {
  const v = (v_kmh || 0) / 3.6, ve = (vEgo_kmh || 0) / 3.6;
  const rate = direction === 'oncoming' ? ve + v : ve - v;      // closing speed (m/s)
  return rate > 0 && d0 > dEnd ? (d0 - dEnd) / rate : Infinity;
}
