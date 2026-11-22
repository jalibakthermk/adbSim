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

## Status
Phase 0 (setup) done: repo skeleton, core ports (IES, frames, de Boer), demo beams, tests. Later phases are listed in SPEC.md §7.

## Licence
MIT © 2026 Jalib Akther
