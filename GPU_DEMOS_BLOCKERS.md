# GPU demos — status

_Updated 2026-07-10. Historical blockers below are resolved; kept for context._

The `/gpu-demos/` page shows the **real, CI-tested** Miri source next to each
demo. Source of truth: `../miri/examples/gpu/web/*.mi`, each pinned by an
integration test in `../miri/tests/integration/gpu/demos.rs`. Copies for the
website live in `assets/demos/*.mi`, regenerated with
`python3 tools/gen_displayed_demos.py`.

## Shipped — real, runnable (8/8)

| Demo | `.mi` file | Test |
|------|-----------|------|
| Mandelbrot | `mandelbrot.mi` | `demo_mandelbrot_web` |
| Game of Life | `game_of_life.mi` | `demo_game_of_life_web` |
| Particle Flow | `particles.mi` | `demo_particles_web` |
| Fluid | `fluid.mi` | `demo_fluid_web` |
| Ray Marching | `raymarch.mi` | `demo_raymarch_web` |
| Neural Net | `neural.mi` | `demo_neural_web` |
| Black Hole | `blackhole.mi` | `demo_blackhole_web` |
| Wormhole | `wormhole.mi` | `demo_wormhole_web` |

No blockers. A user can:

```
miri build <demo>.mi --target web-gpu --out <demo>-web   # open <demo>-web/index.html
miri run   <demo>.mi                                      # prints the native smoke line
```

## No-drift guarantee

The displayed source is the **verbatim repo slice** of each demo (from the first
`use` line to the line before the `// Native smoke` tail). The Miri repo's
`tests/integration/gpu/wgsl_identity.rs` gate asserts, for all 8 demos, that

1. the website copy in `assets/demos/` is a byte-identical repo slice, and
2. the full repo `.mi` and the displayed slice compile to identical web-gpu
   manifests (kernels / WGSL / buffers).

So the code on the page is exactly the code that CI compiles and runs.

## Resolved history

- **Black Hole / Wormhole Miri ports** — authored 2026-07-08 (previously
  WebGL-only eye-candy). Both now compile through `--target web-gpu` like the
  other six.
- **"Displayed code is a cleaned copy, not byte-identical"** — resolved by the
  wgsl_identity gate + `gen_displayed_demos.py` slice convention (2026-07-08).
- **`Array<f32, W * W>` / named-`const` array sizes don't parse** — resolved:
  value-generic slots accept named consts and const arithmetic.
- **Host scalars can't be captured into kernels** — resolved: host `int` /
  `bool` / `f32` scalars are captured as read-only uniforms.

Still true: `gpu frame` passes must be spelled `gpu forall` (a bare `forall`
inside a frame block is rejected), so the displayed demos keep the explicit
form.
