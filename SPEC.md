# adbSim — ADB / Matrix Beam Simulator: Build Spec

> Put this file in the repo root as `SPEC.md` and copy the **Conventions** section into `CLAUDE.md`.
> Claude Code should build in the phase order below. Each phase ends with its acceptance tests passing.
> The working name `adbSim` is a placeholder; rename before Phase 0.

---

## 1. Purpose

A web tool to simulate an **Adaptive Driving Beam (ADB)** / matrix headlamp in a traffic scene:

1. Load segment intensity distributions (IES), one per LED segment and lamp side, plus the low-beam base.
2. Place traffic targets on the road: oncoming vehicles, preceding vehicles, and later pedestrians and signs.
3. Run an **ADB controller** that switches off or dims the segments hitting each target, with detection margins.
4. Report **glare at the target glare points** (driver eye, mirrors) against limits, and the **road illumination kept** compared with the full high beam.
5. Animate **dynamic scenarios** (approaching or overtaking vehicles over time) to show the effect of latency and margins.

It works alongside GLEn (glare), Road-illuminate (road isolux) and beamSynth (synthetic beams), and reuses their core maths.

---

## 2. Scope

| v1 (Phases 0–4) | Later (Phase 5+) |
|---|---|
| Straight road and constant-radius curves, flat road | Gradients, crests and sags |
| Oncoming and preceding cars and trucks | Pedestrians, cyclists, signs (dazzle from retro-reflection) |
| Ideal detection + angular margins + latency | Camera field of view, detection range, false negatives |
| Segment on/off and dimming (0–100 %) | Smooth pixel ADB (µAFS / DMD), pixel images |
| Static scene + 1-D dynamic scenarios | Full 2-D traffic, multiple targets crossing |
| Configurable glare limits (JSON) | Regulation preset library |

---

## 3. Inputs

### 3.1 Photometry
| Input | Format | Notes |
|---|---|---|
| Low-beam base, left and right | IES LM-63 (Type A/B/C) | Always on in ADB mode |
| Segment IES files, left and right | IES, N files per side | Each file is one segment at 100 % |
| **Alternative:** one full high-beam IES + segment boundaries | IES + table of H-angle intervals | Synthetic segmentation, for when per-segment files are not available. Each segment = high beam masked to [H_i, H_i+1] with an editable soft edge (°) |
| Angle system, H+ direction, C-forward plane | Settings | Same options as GLEn |
| Aim V/H per lamp | ° | Applied as a rotation, as in GLEn |
| Segment dimming curve | linear or table | Maps PWM % to flux %, optional |

### 3.2 Vehicle (ego)
- Lamp positions L/R: lateral ±s/2, mounting height h, longitudinal offset (m)
- Camera position (x, y, z): the detection origin, usually behind the windscreen near the mirror
- Speed v_ego (km/h), used in dynamic scenarios

### 3.3 Road
- Traffic: RHT / LHT; lane width; number of lanes per direction
- Geometry: straight, or curve with radius R (left or right)
- Road surface reflection (r-table class), only for the road-luminance output (Phase 5)

### 3.4 Targets (scene objects)
Each target has a type, a lane, and a distance d (or a time trajectory). It also has the glare points and lamp positions that set its geometry:

| Type | Glare points (x, y, z offsets in target frame) | Detected features |
|---|---|---|
| Oncoming car | Driver eye (h ≈ 1.1 m, seat offset) | Its 2 headlamps (h ≈ 0.65 m, spacing ≈ 1.4 m) |
| Oncoming truck | Driver eye (h ≈ 2.2–2.5 m) | Its headlamps |
| Preceding car | Interior mirror, left and right side mirrors, driver eye (via mirrors) | Its 2 rear lamps |
| Preceding truck | Side mirrors (h ≈ 2.0 m) | Rear lamps |

Default dimensions live in `data/targets.json` and are editable in the UI.

### 3.5 ADB controller settings
- Horizontal margin (°) on each side of the detected target box, and vertical margin (°)
- Minimum dark-tunnel width (°)
- Latency (ms), meaning the delay from target movement to segment update
- Segment rule: **off** when the segment overlaps the masked box, or **dim to x %** on partial overlap (option)
- Low-beam fallback: below distance d_min, or when there are more than N targets, switch all ADB segments off

### 3.6 Limits
`data/limits.json`, loaded and editable. **The values must be filled in from the regulation or customer specification; the tool ships placeholders only.**
```json
{
  "name": "Project limits (fill in from UN R149 ADB / customer spec)",
  "glare": [
    { "target": "oncoming_car",  "point": "driver_eye",  "dist_m": [50, 100, 200], "E_max_lx": [null, null, null] },
    { "target": "preceding_car", "point": "mirror",      "dist_m": [50, 100, 200], "E_max_lx": [null, null, null] }
  ],
  "deBoer_min": null
}
```

### 3.7 Project file
The whole setup saves and loads as `*.adb.json`: file references (as names plus embedded IES text), vehicle, road, targets, controller and limits. Saving it reproduces a run exactly.

---

## 4. Outputs

1. **Beam view (H-V map):** total intensity in the ego lamp frame, segment boundaries drawn over it, target boxes (detected box and box with margins), and switched-off segments hatched. Isocandela lines are optional.
2. **Road view (bird's eye):** isolux of the full high beam, of ADB, and of the difference. Targets drawn to scale, with the dark tunnel visible. Reuse Road-illuminate's grid and plot code.
3. **Glare table:** for each target and glare point, the illuminance E (lx), the glare angle, de Boer W (GLEn formula) and the limit, with **pass/fail** shown as icon and text.
4. **Kept illumination metrics:**
   - Ratio of luminous flux (lm) emitted inside the high-beam zone with ADB to the flux with the full high beam
   - Illuminance at defined road points (e.g. right edge at 100 m and 150 m) with ADB compared with the full high beam
   - Detection distance proxy: the distance at which E on the road edge first drops below a threshold (e.g. 1 lx)
5. **Dynamic timeline:**
   - Each target's eye illuminance against time, with the limit shown
   - A strip showing each segment's state over time
   - A playback slider that drives views 1–2
6. **Export:** CSV (glare table and timeline), PNG of each view, and the project JSON.

---

## 5. Core maths

**Frames.** Ego frame: x forward, y left, z up, origin at the road surface under the midpoint between the lamps. A direction from a lamp is rotated into the lamp frame (aim), then converted to the file's angle system. This is the same code as GLEn (`toLampFrame`, `intensityDir`).

**Total intensity** toward a direction from lamp k:
`I_k(dir) = I_low,k(dir) + Σ_i  w_i(t) · I_seg,k,i(dir)`, where w_i ∈ [0, 1] is the dim state of segment i.

**Glare illuminance** at a glare point P: `E_P = Σ_k τ · I_k(dir_kP) / r_kP²`. τ is the windscreen or rear-window transmission, set per point type.

**Target box (detection).** Seen from the camera, the angular extent of the target's lamps and glare points is [H_min, H_max] × [V_min, V_max]. Add the margins, then transform into each lamp's frame. There is parallax between the camera and the lamps, which matters at short distances and must be handled.

**Controller.** For segment i with angular support S_i (the H-V region where it contributes more than x % of its peak), set w_i = 0 when S_i overlaps any masked box, and 1 otherwise. Optionally, w_i = 1 − overlap fraction for dimming. Precompute S_i once per load.

**Latency.** The controller sees the target position at time t − latency, while the photometry uses the true position at time t. The resulting under-cover is what shows up as glare spikes.

**Curve geometry.** A target in a lane on a curve of radius R at arc length s has position (R sin(s/R), ±(R − R cos(s/R)) + lane offset). The ego heading is tangent at s = 0.

**Discomfort.** de Boer W uses the GLEn function unchanged.

---

## 6. Architecture

Plain HTML and ES modules with no build step, so it runs on GitHub Pages like the other tools. Plotting uses Canvas 2D (Plotly from the CDN is allowed if needed). Tests use `node --test`.

```
adbSim/
├─ index.html              # layout and UI wiring only
├─ src/
│  ├─ core/                # pure functions, no DOM: everything testable in Node
│  │  ├─ ies.js            # parseIES, lookup, symmetry (port from GLEn)
│  │  ├─ frames.js         # toLampFrame, dir↔HV, camera→lamp parallax
│  │  ├─ photometry.js     # intensityDir, lamp model = low + Σ w_i·seg_i
│  │  ├─ segments.js       # per-file segments or synthetic segmentation, support S_i
│  │  ├─ scene.js          # road geometry (straight/curve), target placement, trajectories
│  │  ├─ targets.js        # target types → lamp and glare-point positions
│  │  ├─ controller.js     # masked boxes → w_i, latency buffer, low-beam fallback
│  │  ├─ glare.js          # E at points, de Boer (port from GLEn)
│  │  ├─ road.js           # road isolux grid (port from Road-illuminate)
│  │  ├─ metrics.js        # kept-flux ratio, road points, detection distance proxy
│  │  └─ limits.js         # load and evaluate limits.json
│  ├─ ui/
│  │  ├─ state.js          # single project state object, load/save .adb.json
│  │  ├─ panels.js         # input panels
│  │  ├─ beamView.js       # H-V map + segments + boxes
│  │  ├─ roadView.js       # bird's eye
│  │  ├─ timeline.js       # charts + playback
│  │  └─ export.js         # CSV / PNG / JSON
│  └─ main.js
├─ data/
│  ├─ targets.json         # default target dimensions
│  ├─ limits.json          # placeholder limits (null values)
│  └─ demo/                # synthetic low beam + 12-segment high beam (generated)
├─ tests/
│  ├─ ies.test.js
│  ├─ frames.test.js
│  ├─ controller.test.js
│  ├─ glare.test.js
│  └─ scenario.test.js
├─ SPEC.md
├─ CLAUDE.md
└─ README.md
```

**Data flow:** UI state → `scene.build(state, t)` → `controller.update(scene, t)` → `photometry` with weights → `glare`, `road` and `metrics` → views. Only the core produces numbers; views only draw.

**Performance:** precompute each segment as a resampled grid (for example 0.1° over the high-beam field), so that `I(dir)` is a weighted sum of grid lookups. Run the road isolux grid in a Web Worker when it exceeds about 50k points.

---

## 7. Build phases

| Phase | Deliverable | Acceptance tests |
|---|---|---|
| **0 Setup** | Repo skeleton, core ports from GLEn (IES, frames, de Boer), `node --test` running, demo beams generated | GLEn's 18 tests ported and passing |
| **1 Static beam** | Segment loading (files and synthetic), lamp model, beam view with segment overlay, manual segment toggles | Sum of all segments at w = 1 equals the high-beam file within 1 %; a toggled segment disappears from the map |
| **2 Targets + controller** | Straight road, oncoming and preceding targets, camera → lamp boxes with parallax, auto masking, glare table | A target at 100 m with a 0.5° margin switches off exactly the expected segment(s); E at the target eye drops below the low-beam-only value + ε |
| **3 Road + metrics** | Road view (full HB / ADB / difference), kept-flux ratio, road points, limits pass/fail | Kept flux = 1 with no targets; tunnel width on the road matches the box angle × distance |
| **4 Dynamic** | Trajectories, latency buffer, timeline charts, playback, CSV/PNG/JSON export | With latency 0, peak glare ≈ the static values; with latency > 0, the glare spike grows with closing speed |
| 5 Extensions | Curves, gradients, pedestrians/signs, road luminance, regulation presets | Per feature |

---

## 8. Validation cases (tests)

1. **Inverse square:** a uniform 1000 cd segment, eye at 50 m: E = I/r² summed over the lamps.
2. **Parallax:** a camera 0.5 m above the lamps. For a target at 10 m, the box V angles seen from the lamp and from the camera must differ by atan(0.5/10).
3. **Margin monotonicity:** increasing the H margin never switches a segment back on.
4. **Symmetry:** with RHT ↔ LHT and the scene mirrored, the beam view and glare values mirror.
5. **Curve:** at R → ∞, curve results equal straight-road results.
6. **Latency:** for an oncoming car closing at 2 × 100 km/h with 100 ms latency, the angular lag of the box equals the analytical rate × 0.1 s.
7. **Kept flux:** 0 when every ADB segment is off, 1 with none off.

---

## 9. Conventions (copy into CLAUDE.md)

- Angles are in degrees in the UI and in radians only inside the maths. Lengths in m, intensity in cd, illuminance in lx.
- Ego frame: x forward, y left, z up. H+ is right in all displays, labelled L and R; V+ is up.
- `src/core` stays pure: no DOM and no globals. Every new maths function gets a test.
- No regulation limit values in code. Limits come only from `limits.json`, and the shipped file has nulls.
- Status colours are never used alone: pass/fail always shows an icon and text.
- Keep the footer: "© 2026 Jalib Akther · MIT License". Bump the version in the footer and the CSV header on each release.
- Commit per phase, and run `node --test` before every push.
