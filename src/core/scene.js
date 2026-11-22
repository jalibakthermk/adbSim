/* Scene: ego lamps and camera, targets placed on the road. Straight road only in v1 (curves are Phase 5).
   Pure: no DOM, no globals. */
import { lampPositions } from './frames.js';
import { placeTarget, targetOutline } from './targets.js';

/** cfg: { vehicle: { spacing, hLamp, xLamp, aimV, aimH, camera: { x, y, z } }, road, targets: [{ id, type, lane, d }], typeDefs }
    Returns { lamps: { L: { pos, aimV, aimH }, R }, camera: [x, y, z], targets: [{ id, type, label, lane, d, direction, lamps, glarePoints, outline }] } */
export function buildScene({ vehicle, road, targets, typeDefs }) {
  const pos = lampPositions(vehicle);
  const aim = { aimV: vehicle.aimV || 0, aimH: vehicle.aimH || 0 };
  const cam = vehicle.camera;
  return {
    lamps: { L: { pos: pos.L, ...aim }, R: { pos: pos.R, ...aim } },
    camera: [cam.x, cam.y, cam.z],
    road,
    targets: targets.map(t => {
      const def = typeDefs[t.type];
      if (!def) throw new Error(`Unknown target type "${t.type}"`);
      return { id: t.id, type: t.type, label: def.label, lane: t.lane, d: t.d, direction: def.direction, ...placeTarget(def, t, road), outline: targetOutline(def, t, road) };
    }),
  };
}
