import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCSV, glareCSV, timelineCSV, projectToJSON, projectFromJSON } from '../src/ui/export.js';
import { VERSION } from '../src/version.js';
import { createState } from '../src/ui/state.js';

test('toCSV quotes text with commas and quotes; blanks for null/NaN', () => {
  const t = toCSV(['h'], ['a', 'b'], [['x, y', 'say "hi"'], [null, NaN]]);
  assert.equal(t, '# h\na,b\n"x, y","say ""hi"""\n,\n');
});

test('glare CSV header carries the version; "none" is written as "no limit"', () => {
  const csv = glareCSV([{ n: 1, target: 'Oncoming car', type: 'oncoming_car', point: 'Driver eye', pointId: 'driver_eye', d: 100,
    E: 0.0418, E_low: 0.0418, E_hb: 11.6, thDeg: 1.39, W: 6.12, E_max: null, W_min: null, status: 'none' }], { traffic: 'RHT' });
  const lines = csv.trim().split('\n');
  assert.equal(lines[0], `# adbSim v${VERSION} glare table`);
  assert.equal(lines[1], '# traffic: RHT');
  assert.ok(lines[3].endsWith(',,,no limit'));
});

test('timeline CSV: one row per step, series columns, kept flux and segment states', () => {
  const run = {
    t: [0, 0.1], kept: [0.8, 0.7], fallback: [null, 'distance'],
    weights: { L: [[1, 0], [0, 0]], R: [[1, 1], [0, 1]] },
    series: [{ key: '1:driver_eye', d: [100, 95], E: [0.04, 0.05], E_max: [null, 1], status: ['none', 'pass'] }],
  };
  const lines = timelineCSV(run).trim().split('\n');
  assert.equal(lines[0], `# adbSim v${VERSION} timeline`);
  assert.equal(lines[1], 't_s,1:driver_eye_d_m,1:driver_eye_E_lx,1:driver_eye_E_max_lx,1:driver_eye_result,kept_flux,fallback,w_L1,w_L2,w_R1,w_R2');
  assert.equal(lines[3], '0.1,95,0.05,1,pass,0.7,distance,0,0,0,1');
});

test('project JSON round-trips the state, embeds sources, restores Infinity', () => {
  const s = createState();
  s.photometry.sources.lowL = { name: 'low.ies', text: 'IESNA:LM-63-2002\nTILT=NONE\n…' };
  s.targets.push({ id: 2, type: 'preceding_car', lane: 1, d: 60, speed_kmh: 80 });
  s.controller.maxTargets = Infinity;
  const text = projectToJSON(s);
  const o = JSON.parse(text);
  assert.equal(o.app, 'adbSim'); assert.equal(o.version, VERSION); assert.equal(o.road.R, null);
  const { state } = projectFromJSON(text, createState());
  assert.deepEqual(state.targets, s.targets);
  assert.equal(state.photometry.sources.lowL.text, s.photometry.sources.lowL.text);
  assert.equal(state.road.R, Infinity); assert.equal(state.controller.maxTargets, Infinity);
  assert.deepEqual(state.vehicle, s.vehicle);
});

test('projectFromJSON rejects other files and newer formats', () => {
  assert.throws(() => projectFromJSON('{"glare":[]}', createState()), /Not an adbSim project/);
  assert.throws(() => projectFromJSON('{"app":"adbSim","format":9}', createState()), /newer/);
});
