# External forces results and limits

## Current common crowd path — 2026-09-26

External inputs now change physical velocity and pass through the same crowd
movement solver as ordinary motion. The previous global external mode and its
sticky affected flags, warm state, retries and full-population substeps are gone.
All measured ticks retain the 24-candidate / 8-contact / 8-iteration budgets.
No blast left a continuing input after its one-shot tick. Actual populations stayed
at 6,000/10,000 in every measured frame and quality run, with no runtime errors.

Current runtime SHA-256: `8aa769012f420094644898cb972fdb0742cdd278b04bb8f83e07f88d9278bd25`.
The performance, geometry and isolated-input source hashes agree and stayed stable.
Evidence and summaries: [unified-20260926](../baselines/unified-20260926/summary.json).
The source and old baselines under reference-20260926 remain preserved.

### Actual HTTP frame measurements

Same Ryzen 9 9950X3D / Chromium 151.0.7922.34, seed42, default radius3.2
and dt1/60, scaled rocky-pass, actual UI radius100/speed400 blast at tick30.
Each case has three 360-tick runs, audit OFF. Values below are the median of three
run-level P95s; recovery is ticks120–359. The final harness pause/hash frame is
excluded. CPU timing includes the ordinary app clock, renderer and recorder.

| Population / input | Frame CPU P95 | Recovery CPU P95 | Simulated / wall |
|---|---:|---:|---:|
| 6,000 / none | 15.80ms | 15.90ms | 0.997 |
| 6,000 / blast | 16.10ms | 16.30ms | 0.991 |
| 10,000 / none | 25.70ms | 27.60ms | 0.648 |
| 10,000 / blast | 25.30ms | 25.60ms | 0.652 |

The immediately preceding TypeScript external-mode implementation measured 31.40ms
at 6K and 54.40ms at 10K for the same three-repeat single-blast setup. The common
path measures 16.10/25.30ms. These are intentionally different movement models,
not bit-identical optimizations. The comparison does not hide the changed quality
contract below. No measured acceptance RAF interval exceeded 100ms.

The 10K no-input P95s were 25.2, 25.7 and 32.7ms; the slow run is retained.
**10K is still CPU-bound without any force and is not a 60FPS result.** The blast
does not add a sustained global mode cost; ordinary scene cost remains. Clock
debt, dropped/clamped seconds and all raw frame/step records are retained.

### Isolated one-body input

Separate headless diagnostics use 6,000 bodies in open-field, deliberately relocate
one body 1,362.5px from its closest neighbor at tick30 in BOTH cases, and apply a
radius10/speed400 blast to that one body only. Across three repeats, the median of
the first30-tick mean CPU times is **8.10ms without input / 8.35ms with the blast**.
Exactly one body is directly hit in every blast run; the contact budgets stay fixed.
This is simulation CPU, not browser FPS. The previous diagnostic's 7.82/14.82ms
values were single runs and are retained as context, not a three-repeat comparison.
A separate state test verifies that a distant untouched crowd stays byte-identical;
another verifies 120 ticks of API impulse versus directly assigned physical velocity.

### Observed quality and changed guarantees

Separate audit-ON HTTP runs cover 6K/10K × none/single/repeated blast, 660ticks,
seed42, with independent geometry sampling every10ticks (66 samples per row).
Repeated blasts occur at30/60/90. All rows retain their full populations.

| Population / input | Maximum sampled overlap | Final overlap | Walls / nonfinite |
|---|---:|---:|---:|
| 6,000 / none | 1.324px | 0.546px | 0 / 0 |
| 6,000 / blast | 1.659px | 0.459px | 0 / 0 |
| 6,000 / blast-repeat | 1.120px | 0.566px | 0 / 0 |
| 10,000 / none | 1.652px | 1.346px | 0 / 0 |
| 10,000 / blast | 1.662px | 1.023px | 0 / 0 |
| 10,000 / blast-repeat | 1.477px | 0.797px | 0 / 0 |

The ordinary fixed-work crowd model permits residual compression to relax over
multiple ticks. **The previous external-v2 global 0.5px threshold is not met and
is not claimed.** Circle tools are local push brushes, not infinitely rigid bodies.
Strict monotonic kinetic energy is likewise not an XPBD overlap-repair guarantee;
small pushed-chain tests check input-energy bounds and compression instead.
Large straight-chord audits report up to two crossing candidates, including no-input
runs. These samples do not prove every intermediate curved trajectory; dedicated
small mixed-radius crossing and thin-wall tests remain part of verification.

The common motor/sweep/contact rules also change ordinary trajectories. Replay
hashes were intentionally rebased after independent behavior checks; previous
values are preserved in prior-movement-baseline.txt. The invalid 5,000-body
coincident-spawn diagnostic has density P95 175.25 with pressure / 172.10 without,
penetration P95 1.655 / 1.603px and one less occupied boundary cell after60ticks.
That test now checks pressure participation, dispersion and fixed work, rather
than promising monotonic improvement over disabled pressure for an impossible
spawn. Valid Dense Spawn, turning, wall clearance, progress and mixed-size gates
retain their behavioral checks. See overpacked-quality.json for the full result.

### Verification

- npm run verify: typecheck, 209 tests in29 files and production build pass.
- Development browser: 34 checks initially passed; the 10K visual replay continued
  progressing but exceeded the former5s assertion deadline. With a15s replay/UI
  timeout, that failed check passed on rerun. This is not an FPS gate or clock change.
- Production preview: all3 external-reference checks pass (partial spawn, repeated
  6K blasts/reset without Worker/WASM, persistent errors/reset recovery).
- Exact API/direct-velocity equivalence, distant-body independence, fixed work under
  overload, weaker/coherent impulses, wave one-hit lifetime, input history, smaller
  reset, thin walls and mixed-radius crossing are covered by focused tests.

Reproduce with npm run dev on4283, then:

```powershell
node scripts/measure-frame.mjs --url=http://127.0.0.1:4283 --agents=6000,10000 --scenarios=rocky-pass --modes=none,blast --ticks=360 --repeats=3 --quality=off --output=test-results/common-performance.json.gz
node scripts/measure-frame.mjs --url=http://127.0.0.1:4283 --agents=6000,10000 --scenarios=rocky-pass --modes=none,blast,blast-repeat --ticks=660 --repeats=1 --quality=on --output=test-results/common-quality.json.gz
npx vite-node scripts/measure-local-push.ts --output=test-results/local-push.json
```

## Historical external-mode results

Everything below refers to the superseded external-mode implementations and their
original sources. It does not certify the current common crowd contract.

## Archived TypeScript external-mode reference — 2026-09-26

Two distinct stops were reproduced and fixed:

1. **Requested capacity versus actual population.** Unscaled rocky-pass requested
   5,000 bodies but spawned 1,256. The old code stopped at the tick30 UI blast with
   `RangeError: offset is out of bounds`: capacity-sized radius/flag data entered
   spawned-count buffers. Statistics then overwrote the error message. The current
   single TypeScript path copies only the spawned prefix, including checkpoint
   restoration after a smaller reset; failures remain visible until reset. The
   same requested/spawned population now advances normally. No body was removed
   to manufacture this result.
2. **Synchronous Worker barriers under CPU contention.** The measured Chromium
   instance was restricted to four logical CPUs, with hardwareConcurrency still 32.
   The old >=5K path launched seven Workers plus the main participant. Its per-color
   one-second watchdog did not bound an entire tick. In a separate instrumented
   6K blast, a 59,115ms tick spent 59,027ms inside main-thread color barriers and
   another 33ms waiting for job completion. The next tick failed and repeated work
   on CPU. The current runtime has no Worker/shared-memory/WASM execution or wait.

The contention setup changes only tool-owned Chromium process affinity; it does
not change system settings, input strength, dt or population. The unrestricted
matrix did not reproduce a permanent deadlock. It did show ordinary CPU overload,
which must be distinguished from the long scheduling stall and the bounds error.

### Recorded conditions

Windows, Ryzen 9 9950X3D, Node 22.22.0, Chromium 151.0.7922.34, viewport 1440×960/DPR 1,
actual HTTP app RAF → fixed clock → canvas input → simulation → renderer/recorder.
Performance audit OFF; independent quality runs ON. Seed 42 for timing, 42/7 for
quality. Default body radius 3.2, dt 1/60, unchanged gap/speed/iteration/quality limits.

The full unrestricted matrix covers actual 1K/5K/6K/10K, open-field/rocky-pass,
no input/single blast/repeated blast, 360 ticks each. Blasts use UI radius 100 and
peak 400 px/s at tick 30; repeated inputs also occur at 60/90. Separate core files
contain three repetitions for rocky 6K/10K, single/repeated blasts. Every row records
actual spawned/minimum active counts, world/spawn density, dimensions, commands,
source hash, phases, raw steps/frames and clock losses. No favorable repeat is omitted.

Example contention case: 6,000 active bodies, world 2939.387691×1763.632615,
world density 0.0011574074 and spawn density 0.0188707729 bodies/px²; actual recorded
blast center (146.969385,851.313228), radius 100, speed 400, tick 30, seed 42. The actual
canvas event coordinate is retained, including pixel-coordinate rounding.

### Before / after

CPU P95 is the median of three run-level P95s. Maxima include all three runs.
Frame summaries include the first frame containing the input tick and exclude
the harness's final pause/hash callback. Input latency is canvas dispatch to
simulation publication; it is not an OS-input-to-display measurement.

| Case | Before | After |
|---|---:|---:|
| 6K rocky, four logical CPUs, 180 ticks: frame CPU maximum | 56,764.6ms | 98.8ms |
| Same: CPU P95 / P99 | 70.7 / 9,730.4ms | 33.3 / 42.4ms |
| Same: maximum input latency | 56,770.5ms | 105.0ms |
| Same: median sim/wall | 0.0347 | 0.6261 |
| Same: Worker failures across three runs | 3 | 0 (path removed) |
| Unrestricted 6K rocky single blast, 360 ticks: CPU P95 | 17.46ms | 31.40ms |
| Unrestricted 10K rocky single blast, 360 ticks: CPU P95 | 29.57ms | 54.40ms |
| Unrestricted 10K rocky repeated blast: CPU P95 | 28.42ms | 53.70ms |
| Unrestricted 10K peak owned contact scratch | 48.24MB | 17.59MB |

All repeated core and contention runs kept their full active populations and
matched endpoint hashes. The scratch figure excludes simulation/rendering buffers,
static indices and process/GPU memory. Contact pair counts and physical iteration
work were preserved; savings come from removing synchronization, duplicated backend
storage/transfers, repeated overflow searches, per-iteration pressure-grid copies
and per-RAF affected-body scans. Exact geometry certificates and typed-buffer reuse
remain. See the [current stage/ownership contract](external-forces.md#current-typescript-reference).

**CPU throughput is a tradeoff, not a passed 60Hz target.** Unrestricted 10K rocky
single/repeated blast sim/wall fell from 0.674/0.659 to 0.397/0.389. The single-blast
maximum was 148.1ms. The unchanged clock reported up to 8.22s of dropped requested
simulation time (8.60s for repeated blasts) across the 360-tick runs. Clock debt,
dropped/clamped time and RAF P50/P95/P99/max are retained in the raw traces and
summary. Neither smoother rendering nor discarded time is claimed as a solution
to real-time CPU throughput.

The historical no-input <=110% gate was also retained. Three-repeat headless
step-P95 medians changed as follows; the two narrow failures are reported rather
than rounded into passes or measured repeatedly until favorable.

| No-input case | Before / after P95 | Change | Gate |
|---|---:|---:|---|
| Open / 1K | 1.1668 / 1.2251ms | +5.00% | pass |
| Open / 10K | 13.4369 / 13.7896ms | +2.62% | pass |
| Open / 20K | 24.8537 / 26.4208ms | +6.31% | pass |
| Rocky / 1K | 2.4405 / 2.6853ms | +10.0307% | **fail** |
| Rocky / 10K | 17.8341 / 19.6356ms | +10.1014% | **fail** |
| Rocky / 20K | 36.1180 / 37.4598ms | +3.72% | pass |

Extra contiguous impulse copies, exact quiescent-pair caching and a residual-based
skip experiment were rejected: measured frame gains did not justify extra state
or changed numerical behavior. They are absent from the final runtime. Diagnostic
results and the rejected residual source are retained separately from final evidence.

### Quality and verification

- `npm run verify`: 225 tests in 33 files, typecheck and production build passed.
- Development browser suite: 35 passed. Production preview: three external-reference
  checks passed, including absent Worker/WebAssembly APIs, partial spawning,
  reset/repeated input and persistent error visibility.
- Independent 1K/10K/20K × five-input headless quality matrix: 15/15 passed.
- Rocky 6K/10K × single/repeated blast × seeds 42/7, 660 ticks: 8/8 passed;
  maximum sampled penetration 0.449998768px, zero walls/nonfinite/unresolved compression.
- Unscaled 5K request / 1,256 actual bodies × single/repeated blast × seeds 42/7,
  360 ticks: 4/4 passed; sampled penetration <0.45px, zero walls/nonfinite values.
- Exact 10K rocky repeated-blast replay over 660 ticks compared 858,000,000 state
  bytes and 55,224,030 used warm values: zero mismatches, including flags, hashes
  and recorded commands. Prefix-copy regressions cover a smaller reset followed
  by a deliberately rejected physical trial.

Large audits sample published states every 10 ticks and on failed/retried physical
trials; they do not prove every curved intermediate path. Existing crossing,
thin-wall, chain, energy, proxy, overload and recovery tests complement these audits.
No GPU code was executed; stage separation is port preparation, not a GPU performance
claim or completed engine port.

Evidence: [summary.json](../baselines/reference-20260926/summary.json),
[raw files and source snapshots](../baselines/reference-20260926/).
Before source SHA256:`b2105c7763f267bb621be69845d4dfd1c59212f006f7f2f3cd49415d6e51cb26`;
after:`d23a5954f672b2f2698a6c5e9ad2c5ab4743da41beabc64d710f641ec2b1d0ca`.
Source snapshots contain the main runtime/tools; restore over the recorded Git
checkout for the complete research/test tree. Original baselines were not overwritten.
The early exploratory 660-tick raw matrix was cleared by Playwright's default output
cleanup; final figures above use the preserved replacement 360-tick matrix/core runs.

```powershell
node scripts/measure-frame.mjs --url=http://127.0.0.1:4273 --scenarios=rocky-pass --agents=6000 --modes=blast --ticks=180 --repeats=3 --cpu-cores=4 --process-cpu=on --output=baselines/my-contention.json.gz
node scripts/measure-frame.mjs --url=http://127.0.0.1:4273 --scenarios=rocky-pass --agents=5000 --scale=off --modes=blast --ticks=360 --repeats=1 --quality=on --output=baselines/my-partial-spawn.json.gz
```

## Historical external-v1 acceptance — issue #32

Historical #32/#33 completion evidence and the user-accepted 60Hz limitation are in
[the final completion section](external-forces.md#completion-under-amended-scope--2026-09-26).

This is the historical external-v1 acceptance snapshot. Its PASS statements do
not certify the current external-v2 solver or the later issue #33 real-frame
60Hz target. Subsequent changes and their limits are recorded in
[the contract’s performance evidence and limits](external-forces.md#performance-evidence-and-limits).

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
