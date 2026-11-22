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
    view: { lamp: 'LR' },                 // 'L' | 'R' | 'LR'
    weights: { L: [], R: [] },            // manual segment states w_i ∈ [0, 1] per lamp
    vehicle: { spacing: 1.4, hLamp: 0.65, camera: { x: 0.5, y: 0, z: 1.3 }, speed_kmh: 100 },
    road: { traffic: 'RHT', laneWidth: 3.5, lanesPerDir: 1, geometry: 'straight', R: Infinity },
    targets: [],
    controller: { marginH: 0.5, marginV: 0.5, minTunnel: 0, latency_ms: 0, rule: 'off', dMin: 0, maxTargets: Infinity },
    limits: null,
  };
}
