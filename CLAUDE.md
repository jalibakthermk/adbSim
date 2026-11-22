# CLAUDE.md

See [SPEC.md](SPEC.md) for the project specification.

## Conventions

* Angles are in degrees in the UI and in radians only inside the maths. Lengths in m, intensity in cd, illuminance in lx.
* Ego frame: x forward, y left, z up. H+ is right in all displays, labelled L and R; V+ is up.
* `src/core` stays pure: no DOM and no globals. Every new maths function gets a test.
* No regulation limit values in code. Limits come only from `limits.json`, and the shipped file has nulls.
* Status colours are never used alone: pass/fail always shows an icon and text.
* Keep the footer: "© 2026 Jalib Akther · MIT License". Bump the version in the footer and the CSV header on each release.
* Commit per phase, and run `node --test` before every push.
