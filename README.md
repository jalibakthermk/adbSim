# adbSim — ADB / Matrix Beam Simulator

Web tool to simulate an Adaptive Driving Beam (matrix headlamp) in a traffic scene: segment photometry, traffic targets, an ADB controller with margins and latency, glare at the target glare points and the road illumination kept. See [SPEC.md](SPEC.md).

Plain HTML and ES modules with no build step. The core maths (`src/core`) is ported from [GLEn](https://github.com/jalibakthermk/Glen) and runs in Node and the browser.

## Run
ES modules need HTTP, so serve the folder rather than opening `index.html` directly:
```
python3 -m http.server 8000
```
Then open http://localhost:8000. GitHub Pages works as is.

## Tests
```
node --test
```
Includes GLEn's 18 tests, ported to `node:test`.

## Demo beams
`data/demo/` holds a synthetic low beam (from GLEn) and a 12-segment high beam (Type A, H+ right). The segments sum exactly to `high_beam.ies`. Regenerate them with:
```
node tools/gen-demo.js
```

## Use (v0.5.1)
- **Photometry:** the demo loads on start. Load your own low beam (left/right) and either one IES file per segment, or one high-beam IES plus H boundaries (synthetic segmentation with a soft edge). The right lamp uses the left files unless you load its own.
- **Beam view:** total intensity in the lamp frame for the left lamp, the right lamp or both. Dashed lines are segment boundaries; switched-off segments are hatched and labelled "off".
- **Segment toggles:** click a segment button or click the map to switch that segment off or on (switches ADB auto off).
- **Targets:** oncoming and preceding cars and trucks on a straight road, by lane and distance. Default dimensions are in `data/targets.json`.
- **ADB controller:** the camera sees each target's lamps and glare points, adds the H/V margins and the minimum tunnel, and re-projects the box into each lamp's frame (parallax). Segments whose support overlaps a box switch off (or dim). Low-beam fallback below d_min or above N targets.
- **Glare table:** illuminance at every glare point with ADB, with the low beam only and with full high beam, the glare angle, de Boer W, the limit and the result (✓ Pass / ✗ Fail / – No limit).
- **Road view:** bird's-eye isolux of ADB, full high beam or the difference, with lane markings and targets to scale. Vertical planes on road (HSPR, default) or road-surface illuminance, ported from [Road-illuminate](https://github.com/jalibakthermk/Road-illuminate).
- **Kept illumination:** kept-flux ratio (segment flux with ADB / full high beam), illuminance at road points, a detection-distance proxy (where E on the near road edge first drops below the threshold) and the dark-tunnel width at the first target.
- **Dynamic scenario:** switch on "Targets move" to give each target a speed. Oncoming targets close at ego + target speed, preceding ones move at target − ego speed. The controller sees each target from t − latency, while the light follows the true position, so latency shows up as glare spikes. The timeline plots E against time per glare point with its limit, plus each lamp's segment states over time; the slider and Play drive every view.
- **Export:** project file (`*.adb.json`, with the IES files embedded, reproduces the run), glare-table and timeline CSV (header carries the version), and PNG of the beam, road and timeline views.
- **Road-illuminate scenario:** exports the beams (embedded IES), mounting, road and one frame per time step (segment weights of each lamp, target outlines, glare points and their illuminance) for [Road-illuminate](https://jalibakthermk.github.io/Road-illuminate/). Load it there under "ADB scenario" to see the ADB beam on the road, frame by frame. The same file opens in [virtualNightDrive](https://jalibakthermk.github.io/virtualNightDrive/), which drives the scenario in a night view with the cars and trucks on the road. Format `adbsim-road-scenario` v1 (with the ego speed and each target's direction), built by `src/core/exchange.js`.
- **Limits:** `data/limits.json` is loaded and editable in the page. The shipped file has no values (null = no limit); fill them in from the regulation or customer specification.

## Status
- Phase 0 (setup): repo skeleton, core ports from GLEn (IES, frames, de Boer), demo beams, tests.
- Phase 1 (static beam): segment loading (files and synthetic), lamp model `low + Σ wᵢ·segᵢ` on a shared 0.1° H-V grid, beam view with segment overlay, manual toggles.
- Phase 2 (targets + controller): straight road, oncoming/preceding targets, camera → lamp boxes with parallax, auto masking, glare table.
- Phase 3 (road + metrics): road view (full HB / ADB / difference), kept-flux ratio, road points, detection-distance proxy, limits pass/fail.
- Phase 4 (dynamic): 1-D trajectories, latency, timeline and segment strips, playback, CSV/PNG/JSON export and project load.
- Road-illuminate scenario export (v0.5).

Later phases are listed in SPEC.md §7.

## Licence
MIT © 2026 Jalib Akther
