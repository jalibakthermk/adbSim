/* Single project state object. Load/save of *.adb.json arrives in Phase 4.
   Source files are kept as { name, text } so a project can embed them. */
import { VERSION } from '../version.js';

export function createState() {
  return {
    version: VERSION,
    photometry: {
      mode: 'files',                      // 'files' | 'synthetic'
      sources: { lowL: null, lowR: null, segL: [], segR: [], hbL: null, hbR: null },
      edgesText: '', soft: 0.5,           // synthetic segmentation: H boundaries (°) and soft edge (°)
      angleSys: 'auto', hdirRight: true, cForward: 0,
      field: { H: [-40, 40], V: [-12, 10], step: 0.1 },
      supportFrac: 0.05,                  // S_i = region above 5 % of the segment's own peak
    },
    view: { lamp: 'LR', zoom: 'full' },   // lamp: 'L' | 'R' | 'LR'; zoom: 'full' | 'zoom'
    weights: { L: [], R: [] },            // manual segment states w_i ∈ [0, 1] per lamp
    // Ego origin: road surface under the midpoint between the lamps. Camera behind the windscreen near the mirror.
    vehicle: { spacing: 1.4, hLamp: 0.65, xLamp: 0, aimV: 0, aimH: 0, camera: { x: -1.8, y: 0, z: 1.3 }, speed_kmh: 100 },
    road: { traffic: 'RHT', laneWidth: 3.5, lanesPerDir: 1, geometry: 'straight', R: Infinity },
    targets: [{ id: 1, type: 'oncoming_car', lane: 1, d: 100 }],
    controller: { auto: true, marginH: 0.5, marginV: 0.5, minTunnel: 0, latency_ms: 0, rule: 'off', dMin: 0, maxTargets: 8 },
    glare: { La: 1 },                     // adaptation luminance for de Boer (cd/m²)
    roadView: { mode: 'adb', method: 'vertical', evalH: 0, xMax: 200 },   // mode: 'hb' | 'adb' | 'diff'
    metrics: { thr: 1 },                  // detection-distance threshold (lx)
    limits: null,                         // loaded from data/limits.json (null values = no limit)
    limitsText: '',
  };
}
