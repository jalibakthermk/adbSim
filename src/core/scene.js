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

/** Distance (m) of a target at time t (s) on a straight road, from its distance d at t = 0.
    v_kmh is the target's own speed along its heading, vEgo_kmh the ego speed.
    Oncoming: d(t) = d − (v_ego + v)·t. Own direction (preceding): d(t) = d + (v − v_ego)·t. */
export function distanceAt(t, d, direction, v_kmh, vEgo_kmh) {
  const v = (v_kmh || 0) / 3.6, ve = (vEgo_kmh || 0) / 3.6;
  return direction === 'oncoming' ? d - (ve + v) * t : d + (v - ve) * t;
}

/** Scene at time t: every target moved along its trajectory (1-D). cfg as buildScene plus vEgo_kmh;
    each target may carry speed_kmh. */
export function buildSceneAt(cfg, t) {
  const targets = cfg.targets.map(tg => {
    const def = cfg.typeDefs[tg.type];
    return def ? { ...tg, d: distanceAt(t, tg.d, def.direction, tg.speed_kmh, cfg.vEgo_kmh) } : tg;
  });
  return buildScene({ ...cfg, targets });
}
