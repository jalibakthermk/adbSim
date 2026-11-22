/* Single project state object. Load/save of *.adb.json arrives in Phase 4. */
import { VERSION } from '../version.js';

export function createState() {
  return {
    version: VERSION,
    photometry: { lowBeam: null, segments: [], edges: [], angleSys: 'auto', hdirRight: true, cForward: 0, aimV: 0, aimH: 0 },
    vehicle: { spacing: 1.4, hLamp: 0.65, camera: { x: 0.5, y: 0, z: 1.3 }, speed_kmh: 100 },
    road: { traffic: 'RHT', laneWidth: 3.5, lanesPerDir: 1, geometry: 'straight', R: Infinity },
    targets: [],
    controller: { marginH: 0.5, marginV: 0.5, minTunnel: 0, latency_ms: 0, rule: 'off', dMin: 0, maxTargets: Infinity },
    limits: null,
  };
}
