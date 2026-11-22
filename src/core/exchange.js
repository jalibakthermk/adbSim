/* Exchange file for Road-illuminate: an ADB road scenario (*.json, format "adbsim-road-scenario").
   Road-illuminate and virtualNightDrive rebuild each lamp as low beam + Σ w_i·segment_i per frame from the embedded
   IES files and place the targets (direction 'oncoming' or 'own') on the road. Pure: no DOM, no globals.

   Conventions (same in both tools): x forward, y left, z up (m), origin on the road under the midpoint between
   the lamps; photometric H right-positive, V up (degrees). */
import { stepAt } from './scenario.js';
import { keptFlux } from './metrics.js';

export const ROAD_FORMAT = 'adbsim-road-scenario';
export const ROAD_FORMAT_VERSION = 1;
export const MAX_FRAMES = 241;

/** Road-illuminate angle system from the IES photometric types ('A' | 'B' | 'C') and adbSim's override.
    Type A = H about the vertical axis first ('azel'); Type B = V planes about the lateral axis ('elaz'). */
export function roadAngleSystem(types, override = 'auto') {
  const ts = override && override !== 'auto' ? [override] : [...new Set(types)];
  if (ts.includes('C')) throw new Error('Road-illuminate needs H-V photometry (Type A or B); Type C files cannot be exported.');
  if (ts.length !== 1) throw new Error(`The beam files mix photometric types (${ts.join(', ')}). Use files of one type, or set the angle system.`);
  return { A: 'azel', B: 'elaz' }[ts[0]] || (() => { throw new Error(`Unknown photometric type "${ts[0]}".`); })();
}

/** Frame times: every step from 0 to tMax, thinned to at most maxFrames (first and last kept). */
export function frameTimes(tMax, dt, maxFrames = MAX_FRAMES) {
  const n = Math.max(1, Math.floor(tMax / dt + 1e-9) + 1);
  const stride = Math.max(1, Math.ceil((n - 1) / Math.max(1, maxFrames - 1)));
  const ks = []; for (let k = 0; k < n; k += stride) ks.push(k);
  if (ks.at(-1) !== n - 1) ks.push(n - 1);
  return ks.map(k => +(k * dt).toFixed(9));
}

const r4 = x => (x == null || !isFinite(x) ? null : +(+x).toPrecision(4));
const r3 = x => +(+x).toFixed(3);
const src = s => (s ? { name: s.name, ies: s.text } : null);

/** Build the scenario object.
    p: { photometry (adbSim state.photometry), types: [IES types of every embedded file], vehicle, road, roadView, controller,
         cfg (scenario config for stepAt), lampModels, times: [s], latency_s, dynamic, generator, nOf: id → number } */
export function buildRoadScenario(p) {
  const P = p.photometry, S = P.sources;
  const photometry = {
    mode: P.mode,
    angleSystem: roadAngleSystem(p.types, P.angleSys),
    fileHPlusRight: !!P.hdirRight,
    lowBeam: { L: src(S.lowL), R: src(S.lowR) },              // R null = same file as L
  };
  if (P.mode === 'synthetic') {
    Object.assign(photometry, { highBeam: { L: src(S.hbL), R: src(S.hbR) }, edges: p.edges, softEdge_deg: P.soft });
  } else {
    photometry.segments = { L: S.segL.map(src), R: S.segR.length ? S.segR.map(src) : null };
  }
  if (aimHWarn(p.vehicle)) photometry.note = 'Horizontal aim is applied to both lamps in adbSim; Road-illuminate shows it as toe and may differ.';

  const frames = p.times.map(t => {
    const st = stepAt(p.cfg, p.lampModels, t, p.latency_s || 0);
    const byTarget = new Map();
    for (const r of st.rows) {
      if (!byTarget.has(r.targetId)) byTarget.set(r.targetId, []);
      byTarget.get(r.targetId).push(r);
    }
    return {
      t: r3(t),
      weights: { L: st.weights.L.map(r3), R: st.weights.R.map(r3) },
      fallback: st.ctrl.fallback,
      keptFlux: r4(keptFlux(p.lampModels, st.weights)),
      targets: st.scene.targets.map((tg, i) => ({
        n: p.nOf ? p.nOf(tg.id) : i + 1, id: tg.id, type: tg.type, label: tg.label, direction: tg.direction, d: r3(tg.d),
        detected: !!st.ctrl.boxes[i]?.visible,
        outline: Object.fromEntries(Object.entries(tg.outline).map(([k, v]) => [k, r3(v)])),
        points: tg.glarePoints.map(g => {
          const row = (byTarget.get(tg.id) || []).find(r => r.pointId === g.id) || {};
          return { id: g.id, label: g.label, x: r3(g.p[0]), y: r3(g.p[1]), z: r3(g.p[2]), E_lx: r4(row.E), E_max_lx: r4(row.E_max), result: row.status || 'none' };
        }),
      })),
    };
  });

  return {
    format: ROAD_FORMAT, formatVersion: ROAD_FORMAT_VERSION, generator: p.generator,
    conventions: 'x forward, y left, z up (m); origin on the road under the midpoint between the lamps; H right-positive, V up (deg)',
    mounting: { height: p.vehicle.hLamp, separation: p.vehicle.spacing, aimV_deg: p.vehicle.aimV || 0, aimH_deg: p.vehicle.aimH || 0 },
    road: { traffic: p.road.traffic, laneWidth: p.road.laneWidth, lanesPerDir: p.road.lanesPerDir },
    evaluation: { method: p.roadView.method === 'road' ? 'road' : 'vertical', evalHeight: p.roadView.evalH, xMax: p.roadView.xMax },
    controller: { marginH_deg: p.controller.marginH, marginV_deg: p.controller.marginV, rule: p.controller.rule,
      latency_ms: p.dynamic ? p.controller.latency_ms : 0, auto: p.controller.auto !== false },
    dynamic: !!p.dynamic,
    egoSpeed_kmh: p.dynamic ? (p.cfg.vEgo_kmh || 0) : 0,     // ego speed along the road (for viewers that move the ego car)
    photometry,
    frames,
  };
}

const aimHWarn = v => Math.abs(v.aimH || 0) > 1e-9;
