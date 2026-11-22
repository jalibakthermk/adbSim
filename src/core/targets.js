/* Targets: target types → lamp and glare-point positions in the ego frame. Pure: no DOM, no globals.
   Type definitions come from data/targets.json (target frame: x along its own heading, y to its left, z up). */

/** Centre y (ego frame, y left) of a lane. Ego drives in own-direction lane 1 (y = 0).
    RHT: own lanes 1…n go leftwards, oncoming lane 1 is next to the centre line. LHT mirrors y. */
export function laneCenterY(road, direction, lane) {
  const w = road.laneWidth, n = road.lanesPerDir, s = road.traffic === 'LHT' ? -1 : 1;
  const y = direction === 'oncoming' ? (n - 0.5) * w + (lane - 0.5) * w : (lane - 1) * w;
  return s * y;
}

/** Place a target of type `def` on a straight road at distance d (m) from the ego origin, in `lane` of its direction.
    Oncoming: d is to its front. Own direction (preceding): d is to its rear.
    Returns { lamps: [{ id, p }], glarePoints: [{ id, label, p, tau }] } with p = [x, y, z] in the ego frame. */
export function placeTarget(def, { lane = 1, d }, road) {
  const yc = laneCenterY(road, def.direction, lane);
  const lht = road.traffic === 'LHT' ? -1 : 1;       // seat offsets are given for RHT
  const oncoming = def.direction === 'oncoming';
  const toEgo = ({ x, y, z }) => (oncoming
    ? [d - x, yc - lht * y, z]                          // heading −x: its left is ego right
    : [d + x, yc + lht * y, z]);
  return {
    lamps: def.lamps.map(l => ({ id: l.id, p: toEgo(l) })),
    glarePoints: def.glarePoints.map(g => ({ id: g.id, label: g.label, p: toEgo(g), tau: g.tau ?? 1 })),
  };
}

/** Plan-view outline of a placed target on a straight road: { x0, x1, y0, y1 } in the ego frame (m).
    Oncoming: from its front at d back to d + length. Preceding: from its rear at d forward to d + length. */
export function targetOutline(def, { lane = 1, d }, road) {
  const { length = 4.5, width = 1.8 } = def.size || {};
  const yc = laneCenterY(road, def.direction, lane);
  return { x0: d, x1: d + length, y0: yc - width / 2, y1: yc + width / 2 };
}
