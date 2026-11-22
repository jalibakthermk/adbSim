/* Glare maths: de Boer, veiling luminance, TI and GLEn's straight-road oncoming evaluation.
   Ported unchanged from GLEn v0.2. Pure: no DOM, no globals. No limit values live here. */
import { DEG, toLampFrame, dirToHV } from './frames.js';
import { intensityDir } from './photometry.js';

/** de Boer discomfort W (Schmidt-Clausen & Bindels). terms: [{ E (lx), thDeg }], La in cd/m². */
export function deBoerW(terms, La) {
  const Cp00 = 0.003, CpL = 0.04;
  let S = 0;
  for (const t of terms) S += t.E / (Cp00 * (1 + Math.sqrt(La / CpL)) * Math.pow(t.thDeg * 60, 0.46));
  if (S <= 0) return { W: 9, raw: Infinity };
  const raw = 5 - 2 * Math.log10(S);
  return { W: Math.max(1, Math.min(9, raw)), raw };
}

/** Veiling luminance (cd/m²). model 'sh' = Stiles–Holladay, otherwise CIE 146 with age and pigmentation p. */
export function veilingLum(terms, model, age, p) {
  let Lv = 0;
  for (const { E, thDeg: t } of terms) {
    if (model === 'sh') Lv += 10 * E / (t * t);
    else Lv += E * (10 / (t ** 3) + (5 / (t * t) + 0.1 * p / t) * (1 + (age / 62.5) ** 4) + 0.0025 * p);
  }
  return Lv;
}

/** Threshold increment (%). */
export function TIpct(Lv, La) { return 65 * Lv / Math.pow(La, 0.8); }

/** Model validity ranges for glare angle θ (degrees). */
export const LV_RANGE = { cie: [0.1, 100], sh: [1, 30] };
export const DEBOER_RANGE = [0.1, 15]; // approx. range of the Schmidt-Clausen & Bindels experiments

/** Input check for evaluate(). Returns a list of human-readable problems (empty = OK). */
export function checkCfg(c) {
  const e = [], num = (k, lbl) => { if (!isFinite(c[k])) e.push(lbl + ' is not a number'); };
  num('hLamp', 'Lamp height'); num('spacing', 'Lamp spacing'); num('lat', 'Lateral offset'); num('La', 'Adaptation luminance');
  num('dmin', 'Distance from'); num('dmax', 'Distance to'); num('dstep', 'Step'); num('age', 'Age'); num('tau', 'Windscreen transmission');
  if (c.hLamp <= 0) e.push('Lamp height must be > 0');
  if (c.spacing < 0) e.push('Lamp spacing cannot be negative');
  if (c.dmin <= 0 || c.dmax <= c.dmin) e.push('Distance range must satisfy 0 < from < to');
  if (c.dstep <= 0) e.push('Step must be > 0');
  if (c.La <= 0) e.push('Adaptation luminance must be > 0');
  if (c.La > 5) e.push('TI formula is defined for La ≤ 5 cd/m²');
  if (c.tau <= 0 || c.tau > 1) e.push('Windscreen transmission must be in (0, 1]');
  if (!c.eyes.length) e.push('Enter at least one eye height');
  return e;
}

/** GLEn straight-road evaluation of an oncoming driver's eye versus distance.
    cfg: { iesL, iesR, hdirRight, angleSys, cForward, aimV, aimH, hLamp, spacing, rht, lat, eyes[], dmin, dmax, dstep,
           La, age, pig, lvModel, thMin, tau, eyePlane: 'lamp'|'los' } */
export function evaluate(cfg) {
  const s = cfg.spacing / 2, side = cfg.rht ? 1 : -1, tau = cfg.tau ?? 1;
  const opt = { hdirRight: cfg.hdirRight, angleSys: cfg.angleSys || 'auto', cForward: cfg.cForward || 0 };
  const lamps = [{ name: 'L', y: +s, ies: cfg.iesL }, { name: 'R', y: -s, ies: cfg.iesR || cfg.iesL }];
  const n = Math.min(5000, Math.floor((cfg.dmax - cfg.dmin) / cfg.dstep + 1e-9) + 1); // index-based: no float drift
  const lvR = LV_RANGE[cfg.lvModel] || LV_RANGE.cie;
  const out = [];
  for (const he of cfg.eyes) {
    const rows = [];
    for (let k = 0; k < n; k++) {
      const d = +(cfg.dmin + k * cfg.dstep).toFixed(6);
      const yEye = side * cfg.lat;
      const terms = []; let Etot = 0; const per = {}; let valid = true, deBoerValid = true;
      for (const lp of lamps) {
        const dx = d, dy = yEye - lp.y, dz = he - cfg.hLamp;
        const r = Math.hypot(dx, dy, dz);
        const [lx, lyR, lz] = toLampFrame(dx, dy, dz, cfg.aimV, cfg.aimH);
        const I = intensityDir(lp.ies, lx, lyR, lz, opt);
        const th0 = Math.acos(dx / r) / DEG; // true glare angle to the line of sight
        const th = Math.max(cfg.thMin, th0);
        const E = tau * I / (r * r) * (cfg.eyePlane === 'los' ? Math.cos(th0 * DEG) : 1);
        const [Hd, Vd] = dirToHV(lx, lyR, lz);
        if (th < lvR[0] || th > lvR[1]) valid = false;
        if (th < DEBOER_RANGE[0] || th > DEBOER_RANGE[1]) deBoerValid = false;
        per[lp.name] = { I, E, th, H: Hd, V: Vd };
        terms.push({ E, thDeg: th }); Etot += E;
      }
      const w = deBoerW(terms, cfg.La);
      const Lv = veilingLum(terms, cfg.lvModel, cfg.age, cfg.pig);
      rows.push({ d, E: Etot, W: w.W, Wraw: w.raw, Lv, TI: TIpct(Lv, cfg.La), L: per.L, R: per.R, lvValid: valid, wValid: deBoerValid });
    }
    out.push({ eye: he, rows });
  }
  return out;
}
