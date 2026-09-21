# Algorithm lab measurement protocol and results

> 과거 실험 기록: B0/B1/R/Q/D는 현재 구현에서 제거되었습니다. 현재 등록·실행 구조는 [알고리즘 계약](algorithm-design-map.md)을 참고하세요.

This report preserves the measurements made **before the winding-corner repairs**.
Those repairs change experimental route following, touching-disc motion and retained-body
detours; the old timings and quality numbers are not requalified results for the repaired solver.
See [the corner regression report](corner-regression.md) for the targeted before/after runs.

The runner is `scripts/measure-lab.ts` (`npm run measure:lab -- ...`). It creates
an isolated Node child process for every preset/scenario/population and writes a
JSON matrix incrementally. A hard wall-time cap includes child startup, route
initialization, warmup, simulation and optional quality auditing. A timeout keeps
the last progress record and is not reported as a completed run. After saving all
cases, timeout/error/capacity-reduced matrices return a nonzero exit code.

```sh
# 1k behavior and sampled independent geometry audit, all six presets.
npm run measure:lab -- --agents=1000 --scenario=open-field,narrow-door,bidirectional-corridor,crossing-streams,crowded-goal,dynamic-blocking --steps=600 --warmup=60 --quality=10 --scale=true --timeout=60 --output=baselines/lab-quality-1000.json

# Performance excludes independent quality auditing; physical radius is unchanged.
npm run measure:lab -- --agents=10000,50000 --presets=legacy,B0,B1,R,Q,D --scenario=open-field --steps=180 --warmup=30 --quality=0 --scale=true --timeout=90 --output=baselines/lab-performance.json

# Expensive per-tick geometry audit belongs in a separate quality run.
npm run measure:lab -- --agents=1000 --presets=R,D --scenario=narrow-door --steps=900 --warmup=60 --quality=1 --output=baselines/lab-contact-audit.json

# Reproducible destination-count stress, using one batch of explicit goals.
npm run measure:lab -- --agents=1000 --presets=B0,B1 --scenario=open-field --destinations=32 --steps=180 --warmup=30 --quality=0 --output=baselines/lab-destinations.json
```

`--presets`, `--scenario` and `--agents` accept comma-separated values. Every
combination runs sequentially. `--seed` defaults to 42. `--quality=0|1|10` means
disabled, every measured tick, or every tenth measured tick. `--steps` includes
warmup; timing distributions exclude the first `--warmup` ticks. Quality sampling
also starts after warmup, so use `--warmup=0` when initial contact behavior matters.

`--scale=true` is the default. It multiplies world and scenario coordinates by
`sqrt(N/1000)` and preserves agent radius, gap, speed, fixed dt and grid cell size.
This is equal-density scaling, not an equal travel-time test: longer routes need
longer simulated time. `--scale=false` leaves the world fixed and may produce
explicit `capacity-reduced` results. No requested population is silently reported
as actually spawned. Exit/slot semantics are part of the preset and recorded.

`--destinations=1|4|32|N` assigns a deterministic goal lattice in the right side
of `open-field`; the exact batch is stored as `setupCommands`. It does not alter
other scenarios. The shared-field implementation has a documented goal/size
field cap; exceeding that cap produces a recorded error rather than switching to
another algorithm. Dynamic-blocking commands install a wall at tick 180 and
remove it at tick 540, and are recorded for replay.

## What each number means

- `timing.initMs` includes scenario construction and navigation initialization.
  `stepMs` is only `simulation.step()`. Pass times are component observations;
  do not add inclusive timing categories as though they were disjoint.
- `simulationCapacityHz` is `1000 / mean step ms`, not a paced solver frequency
  and not render FPS. `instrumentation.measuredHz` includes commands, recorder,
  audit, memory sampling and progress output during the measured interval.
- `observerMs`, `commandMs` and `snapshotProtocolMs` expose harness overhead.
  The independent geometry audit is outside step timing. New local-motion
  solvers also count exact final overlaps every tick; that built-in diagnostic
  remains inside their contact timing even with `--quality=0`.
- `activeMinimum/Maximum`, tick traces, `spawned`, `moving`, `waiting`, `arrived`
  and `contactActive` distinguish active movement from retained contact bodies.
  Arrivals are measured against the actual spawned count, not requested count.
- `maximumOverlapPairs` uses a separate untruncated spatial search. The reported
  maximum penetration is in world units; normalize by pair diameter before
  comparing differently sized bodies. Counts use the documented 0.01-unit
  reporting threshold. Chord tunneling checks use endpoints of published ticks;
  they cannot reconstruct curved/substepped paths.
- `stalledMax` is a low-speed-duration proxy that includes normal queues. It is
  not proof of a connected deadlocked group. Gate counts deduplicate agent ID and
  crossing direction, and throughput uses the measured simulated interval.
- `processMemory` covers the entire Node child, including Vite/runtime overhead.
  Peaks sampled every ten ticks can miss spikes; no GPU or solver-only memory
  estimate is substituted. Headless frame/render sample counts are zero.
- The manifest includes OS/CPU/Node/V8, hardware memory, repository HEAD and
  per-file SHA-256 values. Each child records its execution-source digest. Source
  changes during a matrix are flagged; UI-only changes are distinguished from
  changes to simulation, scenarios or measurement code.

These finite engineering runs do **not** execute the research report's proposed
10-second warmup, 60-second steady-state, five-seed acceptance protocol. They do
not establish 60 FPS, long-run fairness, eventual arrival, platform-independent
determinism or 50k production readiness. No 100k run is part of this task.

## Harness verification

`tests/unit/lab-results.test.ts` checks all 496 pairs in a 32-agent coincident
cluster without a solver neighbor list, crossing trajectories with separated
endpoints, parallel motion, retained inactive bodies, exit removal transitions,
and distribution summaries. Six tests passed when the harness was introduced.
An explicit strict TypeScript check of `scripts/measure-lab.ts` passed.

Final project verification passed `npm run verify`: typecheck, **171 tests in 23
files**, and the production build. Browser verification covered **29 passing
tests** across the existing and new flows. After the final numerical changes, all
six algorithm-lab browser cases passed again: preset switching/reset, sequential
comparison/export, invalid and valid ablations, actual 10k scaling, dynamic replay,
and an individual command. No additional blanket test reruns were performed after
these checks passed.

Execution/output plumbing was checked with 40 agents/12 ticks on every preset,
and the batch-goal path with 40 agents/four goals. A deliberate one-second hard
timeout stopped a long worker and produced an explicit timeout result. Temporary
smoke artifacts were removed after these checks.
`lab-exploratory-quality.json` was produced while implementations were changing
and is flagged accordingly; it is diagnostic history, not the final comparison.

## 1k quality and arrival results

Measured on 2026-09-20, seed 42, radius 3.2, gap 0.4, dt 1/60. Every run spawned
all 1,000 agents. Open-field used 1,200 ticks (20 simulated seconds), no warmup,
and an independent audit every tick. Six additional scenes used 600 ticks (10
seconds), no warmup, and independent audits every ten ticks: winding corners,
narrow door, bidirectional corridor, four-way crossing, crowded goal, and dynamic
blocking. These shorter scene windows test interaction and command behavior,
not eventual arrival along long routes.

| Preset | Open arrivals at 20s | Maximum audited overlap pairs across these scenes | Maximum endpoint penetration (px) | Audited wall overlaps | Detected chord-crossing pairs |
|---|---:|---:|---:|---:|---:|
| Legacy | 991/1,000 | 986 | 1.3515 | 0 | 3 |
| B0 | 1,000/1,000 | 2 | 0.0294 | 0 | 0 |
| B1 | 1,000/1,000 | 7 | 0.0367 | 0 | 0 |
| R | 777/1,000 | 9 | 0.0465 | 0 | 0 |
| Q | 777/1,000 | 2 | 0.0416 | 0 | 0 |
| D | 1,000/1,000 | 0 | 0.0062 | 0 | 0 |

The arrival semantics differ deliberately: Legacy/B0/B1/D remove exits, while
R/Q retain bodies in individual slots. Therefore this table does not rank all
six as interchangeable gameplay rules. B0 versus B1 does preserve local layers
and exit semantics. Zero observed crossings in sampled scenes is not proof that
every intermediate tick or substep path was collision-free.

R's 20-second result improved from 73 to 777 arrivals after stable
approach-aware slot assignment and a geometric ingress lane spacing replaced
packed slots that fenced off later arrivals. A single justified extension to
2,400 ticks (40 seconds), with every-tick independent audit, reached 970 arrivals,
6 moving and 24 waiting agents. Maximum penetration remained 0.0132px in this
open-field run, with zero audited walls or chord crossings. The remaining 30
agents mean the proposed 99% arrival target was **not** met within 40 seconds;
the run was not extended indefinitely.

| Preset | Narrow door forward crossings / 10s | Bidirectional corridor + / − crossings / 10s |
|---|---:|---:|
| Legacy | 808 | 13 / 11 |
| B0 | 400 | 8 / 7 |
| B1 | 418 | 9 / 4 |
| R | 351 (also 1 reverse) | 43 / 16 |
| Q | 45 | 7 / 0 |
| D | 72 | 47 / 28 |

These are startup-window counts, not steady-state capacity. Q's direction
reservation policy still substantially reduces throughput here and did not
demonstrate bidirectional fairness in this finite window. D improved the observed
two-way passage count relative to B1 but reduced one-way door throughput. These
tradeoffs prevent claiming that queueing is an unconditional improvement.

Dynamic-blocking now inserts its wall at x=720 on tick 180 and removes it on tick
540. All six current runs observed zero wall overlaps. The original x=576 command
overlapped 46 B1 agents at construction time; the preserved diagnostic records
that failure. Occupied construction is now rejected atomically, and the replay
scenario places its wall ahead of the current front. This separates an invalid
building placement from stale navigation-field behavior.

Inspectable sources:

- [Open-field baseline and pre-slot-fix R/Q](../baselines/lab-quality-open-1000.json)
- [Current R/Q open-field](../baselines/lab-quality-open-slots-1000.json)
- [R 40-second retained-slot tail](../baselines/lab-quality-slot-longtail-1000.json)
- [Legacy/B0/B1/D six-scene matrix](../baselines/lab-quality-scenes-1000.json)
- [R/Q six-scene matrix](../baselines/lab-quality-scenes-slots-1000.json)
- [Superseded occupied-construction diagnostic](../baselines/lab-dynamic-insertion-diagnostic.json)

The quality matrices intentionally retain per-case execution digests and source
change flags. Queue, slot and construction fixes were developed during these
diagnostics; affected R/Q cases were rerun, and dynamic cases used the corrected
scheduled wall. Unexecuted changes (gate logic in open-field, occupied-building
guard in runs without construction, impossible-goal guard with valid goals) did
not justify rerunning unaffected trajectories. Quality-run timings may overlap
browser tests or other quality runs and are **not** the performance comparison.

## 10k and 50k isolated performance

The separate performance matrix uses every preset, 180 ticks with 30 warmup ticks,
no independent geometry audit, and a 90-second hard wall-time cap per case. No
other project tests or quality runs executed concurrently. This is a 3-second
simulated run with 150 measured ticks (2.5 simulated seconds), not a steady-state
or long-run crowd audit. World dimensions grow by sqrt(10) and sqrt(50); agent
radius remains 3.2 and gap remains 0.4. Every case completed all 180 ticks, spawned
the requested population and retained **10,000 or 50,000 active agents throughout
the measured window**. No exit removals produced these timings. Active includes
temporary waiting; it does not mean every body moved on every tick. Moving/waiting
traces are sampled every ten ticks (plus the first measured tick): across presets,
sampled moving counts ranged from 9,994–10,000 at 10k and 49,974–50,000 at 50k,
with at most 26 sampled waiting agents. These samples do not establish extrema
for unsampled ticks.

Environment: AMD Ryzen 9 9950X3D, 32 logical processors, Windows kernel
10.0.26200, Node 22.22.0 / V8 12.4, one simulation thread. The raw manifest records
66,156,453,888 bytes of system memory. CPU clocks/power were not controlled.
There was no GPU compute, canvas rendering, browser layout, combat or animation.

| Preset | 10k step p95 (ms) | 50k step p95 (ms) | 50k step p99 (ms) | 50k achieved headless Hz including observer | 50k observed child RSS peak (MiB) |
|---|---:|---:|---:|---:|---:|
| Legacy | 17.78 | 102.77 | 108.43 | 10.39 | 257.8 |
| B0 | 38.10 | 206.44 | 230.14 | 5.21 | 223.1 |
| B1 | 42.05 | 203.76 | 213.47 | 5.24 | 217.9 |
| R | 56.66 | 288.55 | 302.07 | 3.66 | 226.0 |
| Q | 57.67 | 326.14 | 342.92 | 3.63 | 219.6 |
| D | 47.09 | 273.89 | 303.30 | 4.50 | 229.2 |

Source: [complete performance matrix and per-pass distributions](../baselines/lab-performance.json).
All twelve cases completed without timeout or capacity reduction. They nevertheless
**miss the research's proposed 4ms p95 movement budget at both population tiers**.
These results do not establish whole-game 60 FPS. Open-field R/Q follow identical
motion without gate regions; their timing spread is not evidence of queue cost.

At 50k, mean B1 avoidance cost was 112.02ms and contact plus its built-in exact
overlap count was 40.56ms. R spent 178.20ms in avoidance and 45.12ms in contact.
D spent 124.47ms in avoidance, 44.99ms in contact and 6.48ms in periodic navigation.
The spatial-index build itself averaged less than 1ms in these new presets;
neighbor enumeration/selection belongs to avoidance, so a cheap grid build does
not mean cheap neighborhood processing. First profile that repeated local work
and ORCA fallback before considering workers/SIMD/GPU. The open-space A* direct
visibility fast path makes this **not** a maze/path-request benchmark.

The final R/Q tick reported 10,647 infeasible ORCA intersections out of 50,000
agents and used the documented relaxed fallback. Avoidance also truncated its
selected-neighbor set; these observations forbid claiming the unrestricted
ORCA paper's collision-free guarantee. The performance matrix has no independent
geometry audit, so the 1k quality results must not be extrapolated to 50k safety.

Observed 50k initialization ranged from approximately 127 to 185ms. Recorder and
memory-sampling overhead over the complete 180-tick runs was approximately
153–190ms per case and is outside step timing; independent geometry audit time
was zero. RSS includes runtime, transformed modules and buffers, and its sampled
peak can miss short allocation spikes.

The performance manifest intentionally retains `sourceChangedDuringRun`: the two
changed files were `local-motion.ts` and `lab/pipeline.ts`, which added/wired actual
neighbor-count instrumentation during the matrix. Motion algorithms, geometry,
seed, dt and trajectories were unchanged; the extra counter operations are still
a source revision. Per-worker execution digests identify each case. Treat the
table as a diagnostic timing comparison with declared instrumentation revisions,
not a certified single-build benchmark. It was not rerun to manufacture a clean
manifest or a stronger performance claim.

## Individual destination-count validation

One additional short diagnostic used 1,000 agents, seed 42, open-field, 60 ticks,
no warmup and no independent geometry audit. B0 and B1 both executed a batch of
32 distinct destinations. B0 also executed 1,000 distinct destinations. B1
rejected that batch with its explicit 128 distinct goal/size field limit; the
runner saved the `error` record and returned exit code 1. That expected unsupported
case was not replaced by another solver or reported as a successful B1 run.
These runs may overlap final project tests and provide API/workload coverage,
not additional performance or arrival qualification.

- [32-goal diagnostic](../baselines/lab-destinations-32.json)
- [1,000-goal diagnostic and expected B1 rejection](../baselines/lab-destinations-individual.json)

Failure, incomplete arrival and timing budget misses remain valid reported
outcomes; completing the harness is not the same as meeting quality targets.

Important unperformed qualification: five-seed long-duration/steady-state runs,
independent per-tick geometry auditing at 10k/50k, large-population command or
construction bursts, long-run queue fairness/deadlock certification, formation
RMS/reform-time thresholds, full browser/game-frame percentile measurements at
50k, and cross-engine/platform deterministic replay. Mixed radii are covered by
targeted correctness tests; this measurement matrix uses one radius. No 100k,
GPU, SIMD or worker-parallel performance result is claimed.
