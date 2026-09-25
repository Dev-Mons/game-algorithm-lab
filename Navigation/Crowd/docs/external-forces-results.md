# External forces acceptance results — issue #32

This is the initial acceptance snapshot. Subsequent CPU optimization and external-state recovery fixes are recorded in [the contract’s performance evidence and limits](external-forces.md#performance-evidence-and-limits).

Baseline: `db4608916a5199f20e76ee55c2b77cd9a396e90b`. Implementation: working tree source SHA-256 `4028e04954481e290b8cf95e1a1d1b8fee71006d5216be4f9ec6db06bf36b99d`.
Measured on AMD Ryzen 9 9950X3D 16-Core Processor, Node v22.22.0. Headless CPU results exclude rendering.

No-input baseline was captured before implementation. Each normal timing case uses seed 42, default radius 3.2, dt 1/60, 30 warmup ticks and 90 measured ticks, with three repeats. Active inputs begin at tick 30. All reported counts are actual created and minimum active counts, not requested-only counts.

## No-input regression gate

| Actual agents | Before P95 ms | After P95 ms | Change | State hashes |
|---:|---:|---:|---:|---|
| 1000 | 1.47 | 1.55 | 4.87% | all equal |
| 10000 | 18.27 | 18.63 | 1.99% | all equal |
| 20000 | 35.52 | 36.80 | 3.61% | all equal |
| 50000 | 98.87 | 107.36 | 8.58% | all equal |

P95 columns are the median of three per-run P95 values. The 10% regression gate applies to 1K/10K/20K; 50K is exploratory.

## Active input profiles

| Input | Actual agents | P50 / P95 / P99 ms | P95 budget ms | Direct target applications | Max substeps | Max pairs/tick | Saturated queries |
|---|---:|---:|---:|---:|---:|---:|---:|
| few | 1000 | 2.05 / 4.52 / 5.64 | 20 | 5 | 5 | 6915 | 0 |
| few | 10000 | 25.90 / 38.63 / 49.10 | 120 | 5 | 5 | 68083 | 0 |
| few | 20000 | 50.38 / 89.83 / 93.47 | 240 | 5 | 5 | 134622 | 0 |
| blast | 1000 | 2.67 / 4.65 / 6.20 | 20 | 447 | 7 | 10003 | 0 |
| blast | 10000 | 30.73 / 54.09 / 56.83 | 120 | 4512 | 7 | 98597 | 0 |
| blast | 20000 | 58.21 / 109.46 / 118.62 | 240 | 9085 | 7 | 190357 | 0 |
| global | 1000 | 2.64 / 5.71 / 7.10 | 20 | 1000 | 7 | 9448 | 0 |
| global | 10000 | 26.03 / 49.86 / 57.10 | 120 | 10000 | 7 | 95312 | 0 |
| global | 20000 | 55.84 / 99.50 / 112.90 | 240 | 20000 | 7 | 188412 | 0 |
| proxy | 1000 | 5.05 / 5.66 / 13.56 | 20 | proxy affected: 146 | 7 | 12570 | 0 |
| proxy | 10000 | 56.68 / 61.24 / 81.33 | 120 | proxy affected: 103 | 7 | 103137 | 0 |
| proxy | 20000 | 113.17 / 120.10 / 135.54 | 240 | proxy affected: 105 | 7 | 191604 | 0 |
| overlap | 1000 | 2.98 / 4.64 / 5.64 | 20 | 25965 | 4 | 9591 | 0 |
| overlap | 10000 | 32.85 / 40.47 / 46.77 | 120 | 373874 | 4 | 63878 | 0 |
| overlap | 20000 | 63.23 / 84.54 / 107.81 | 240 | 775664 | 4 | 119385 | 0 |

`few`: five backwards 400 px/s hits; `blast`: linear radial 400 px/s peak; `global`: whole-world +y 400 px/s; `proxy`: one radius-18 circle moving right at 240 px/s from 24 px behind the current leftmost agent; `overlap`: eight overlapping 50 px/s² acceleration regions. Direct applications sum per-tick unique targets; proxy recipients appear in contact counters, not direct input counts. Each proxy run must affect at least two agents (`proxyDrivenPeak`) or the gate fails. An earlier empty-space proxy trial was discarded after its zero candidate count exposed the invalid measurement setup.

Full pass distributions, cell-query work, speed caps, physical/contact recipients, static sweeps and process memory samples are in the corresponding `baselines/external-*-performance.json` files. Query-cell upper bounds are explicitly labeled; prediction/contact/static timing boundaries are documented in [the design](external-forces.md).

## Independent quality runs

| Input | Actual agents | Maximum sampled penetration px | Maximum wall overlaps | Query saturation | Speed caps |
|---|---:|---:|---:|---:|---:|
| few | 1000 | 0.00 | 0 | 0 | 0 |
| few | 10000 | 0.00 | 0 | 0 | 0 |
| few | 20000 | 0.00 | 0 | 0 | 0 |
| blast | 1000 | 0.00 | 0 | 0 | 0 |
| blast | 10000 | 0.00 | 0 | 0 | 0 |
| blast | 20000 | 0.00 | 0 | 0 | 0 |
| global | 1000 | 0.00 | 0 | 0 | 0 |
| global | 10000 | 0.00 | 0 | 0 | 0 |
| global | 20000 | 0.00 | 0 | 0 | 0 |
| proxy | 1000 | 0.00 | 0 | 0 | 0 |
| proxy | 10000 | 0.00 | 0 | 0 | 0 |
| proxy | 20000 | 0.00 | 0 | 0 | 0 |
| overlap | 1000 | 0.00 | 0 | 0 | 0 |
| overlap | 10000 | 0.00 | 0 | 0 | 0 |
| overlap | 20000 | 0.00 | 0 | 0 | 0 |

Quality runs rebuild a separate spatial index and visit all pairs in range every ten ticks; they never use the solver pair list or a neighbor cap. This covers all active bodies at sampled ticks, not every intermediate substep. Small automated scenes exhaustively audit all pairs each tick and separately test swept crossings, thin-wall safety, trapping, mixed radii, event lifetimes, exact replay, energy non-amplification, and recovery.

## Overpacking and 50K exploration

| Run | Actual/minimum active | P95 ms (audit ON run) | Sampled penetration px | Walls | Saturated queries |
|---|---:|---:|---:|---:|---:|
| fixed-stress 1000 | 1000/1000 | 4.77 | 0.00 | 0 | 0 |
| fixed-stress 10000 | 10000/10000 | 87.14 | 6.37 | 0 | 8 |
| fixed-stress 20000 | 20000/20000 | 364.19 | 6.40 | 0 | 1948 |
| 50k-exploration 50000 | 50000/50000 | 317.13 | 0.00 | 0 | 0 |

Fixed-space stress fills a 1200×720 world at unchanged radius/speed/dt and keeps the goal outside the world to disable arrival sinks. It is deliberately separate from equal-density normal gates. Query saturation and unresolved compression must be treated as overload, not evidence of collision-free support. 50K has no 60 Hz acceptance claim.

## Browser rendering observation

| Actual agents | Mode | Frame P50 / P95 / P99 ms | Simulation P95 ms |
|---:|---|---:|---:|
| 1000 | none | 16.70 / 16.80 / 16.80 | 1.50 |
| 1000 | blast | 16.70 / 16.80 / 16.80 | 4.50 |
| 10000 | none | 16.70 / 16.80 / 33.40 | 13.90 |
| 10000 | blast | 33.30 / 50.00 / 83.30 | 43.20 |
| 20000 | none | 33.30 / 50.00 / 50.10 | 30.80 |
| 20000 | blast | 66.60 / 100.00 / 133.40 | 82.90 |

Chromium 151.0.7922.34, 1440×960, headless, one fixed step per animation frame with the actual CanvasRenderer and UI. Frame intervals include pacing/render/UI and are distinct from headless simulation timings. These are single observational runs, not native-display FPS guarantees.

## Design evidence, verification and limits

- `external-model-comparison.json` compares the original solver, unclamped XPBD, eight-substep XPBD, single physical velocity and a separate motor/residual model. The separate model needs 16 extra bytes/agent and post-contact rebasing; it offered no contact quality advantage in these calibrations. The chosen model preserves backward impulses and immediately removes wall-normal momentum.
- `npm run verify`: typecheck, 175 automated tests and production build. `npm run test:e2e`: 31 browser tests, including paused external input, recorded export, reset, visible overload rejection and existing movement/editor regressions.
- Additional typed memory: 2 bytes/agent flags; 256 bytes/agent lazy pair buffers; 260-byte candidate buffer; optional region index 4 bytes/agent plus 12 bytes/cell; one byte/agent for each active wave. Existing movement scratch is reused. No new per-agent objects in the step; callback/input allocations remain. Process heap samples include Node/Vite/GC, not exact allocator counts.
- The physical mode currently runs across the whole population while external motion is active. Local hits therefore pay a global contact-pass cost and distant ordinary contacts use the physical contact law during that interval. Sparse contact islands and a unified always-on physical walking model are future optimization/design work.
- Supported moving shapes are circles. Rotation-dependent box/capsule contact, two-way vehicle reaction, damage, GPU execution and engine porting are outside this profile. Region forces ignore wall occlusion. Stationary bodies retain collision geometry until removed.
- Candidate truncation, initial overlap and crushing have bounded/diagnosed behavior, not an unlimited nonpenetration guarantee. Pair updates are sequential and require a new reduction/coloring design before parallelization.

**Normal-profile gate: PASS for the declared CPU profile and sampled quality scope.**
