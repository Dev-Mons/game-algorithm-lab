# Actual-disk internal repair — P0–P2a protocol, version 1

Independent CPU Float64 experiment for repairing internal voids between actual
disks. It is not the production CrowdKernel. This file is the experiment's single
implementation/measurement contract; the production system starts at
[the project README](../../README.md).

## Run and inspect

Run from `Navigation/Crowd`:

```powershell
npm run research:repair -- --output=test-results/particle-repair
npm run research:repair -- --seeds=7,19,73 --replays=none --output=test-results/particle-holdout
npm run test:run -- tests/unit/particle-repair.test.ts
npm run test:e2e -- tests/browser/particle-repair.spec.ts
npm run dev
```

Open `/experiments/fluid-navigation/` for synchronized OFF/ON playback of uniform,
hole and crack scenes. Rendering uses actual disk radii, world/co-moving views
and an optional oracle-region overlay. The viewer and production build read the
preserved [particle-results](../../docs/research/fluid-navigation/particle-results)
JSON files, not a new `--output` directory automatically.

Keep [frozen inputs](fixtures) unchanged during candidate comparisons.
`npm run research:freeze` explicitly regenerates them; it is not a normal validation
step. `npm run research:audit` reads the preserved seed-42 replay files and rewrites
their `geometry-audit.json`; inspect the existing audit for a read-only review.
The older [field probe](field_probe.py) is a continuous-field diagnostic, not an
actual-disk qualification. Its deficit metric must not be compared to disk void area.

## Frozen input and scope

- Fixtures: `fixtures/{uniform,hole,crack}-{42,7,19,73}.json`. Both candidates read
  the same serialized disks; their SHA-256 must match. Seed 42 is development;
  seeds 7, 19, 73 are held out. No per-scene physics coefficients.
- Actual disks: diameter 1, radius 0.5; non-overlapping hexagonal initial packing
  at nominal area occupancy 0.72, jitter ±0.015. The 24 × 24 support has 492 disks
  before removing those intersecting the known defect. Exact counts are recorded.
- Circular defect: a radius-2 disk at (20,20). Open crack: width 1.5, from y=22 to
  the outer y=32 boundary. Removed particles are absent from both candidates.
- Free translation 5 d/s, absolute speed cap 6 d/s. Initial transport is (5,0).
  Time step 1/60 s, 12-second observation. Physical lengths do not change with N.
- Known support/donor region: radius 8 around the hole, or the rectangle
  [12,28] × [16,32] around the crack. The uniform control uses the circle region.
  These are provided oracle regions. Automatic masks and arbitrary corridors
  remain P2b/P3 work. No internal obstacles, arrivals, or route changes.

## Actual implementation

Area transfer uses a seven-point disk quadrature (matching disk second moments)
convolved with cubic B-splines on h=1. It is an approximation to integrated disk
footprints. Partition normalization and its analytic derivative conserve area,
including a truncated stencil. The reference grid translates with the known
5 d/s bulk motion: its predicted density uses J(v − v_grid). This avoids confusing
grid motion with material transport and does not replace individual velocities.
Subcell calibration and Jacobian finite-difference tests are separate checks.

The fixed convex projection jointly handles area cap 0.82, exact disk contact
halfspaces, world-boundary halfspaces and speed balls. Density slack penalty is
100 A_c. Weighted Dykstra retains each constraint's dual/correction against one
unchanged preferred velocity. Convergence requires primal violation, stationarity
and complementarity ≤1e-7. The prototype permits **200 iterations** and reports
actual iteration counts. No
warm start, GPU, bounded neighbor truncation, viscosity, or position correction.

The accepted path is checked with all-pairs exact closest approach, endpoint
geometry, and density re-scattered at the actual trial positions. Stored transport
is jointly projected at the endpoint; that velocity does not reintegrate position.
Retry with 2 or 4 substeps if needed, recording each failed attempt. A failed step
rolls back, stops, and fails the run. Bias displacement is identically zero.

Repair is conservative face diffusion, kappa=0.6 d²/s, with zero patch boundary
flux, donor mass and speed limits. Mean patch occupancy must be ≥0.60. Gathered
repair intent is limited to 0.15 v0 and its change to v0/s. The known outer
support attenuates normal intent over one diameter while retaining tangential
motion. This extra oracle boundary treatment is explicit; zero face flux alone
does not establish zero particle leakage. Drive time constant is 0.35 s and
preferred acceleration is limited to 2 v0/s. Contact safety takes precedence.

## Independent measurement and acceptance

The geometry diagnostic reads only actual circles, never the repair region,
density field or pressure. At h_diag=0.25 it rasterizes the physical union, then
closes normal packing gaps using a radius-0.5 disk. It flood-fills closed cavities
and bridges horizontally between occupied samples at most 6d apart to recognize
the open crack in this single horizontal stream. Large empty components must have
area ≥pi/4 and contain a directly verified empty disk with radius ≥0.5. This bridge
rule does not generalize to branches/walls. Component area is **post-closing void
area**, not a field-deficit metric or a general automatic-mask score.

The acceptance constants were used unchanged in development and are frozen before
holdout. Every ON/OFF run must satisfy all of the following:

- Complete the requested observation without failed steps.
- Exhaustive pair/world penetration and swept pair penetration ≤1e-7 d.
- Both transport and observed speed ≤6 d/s (+1e-7 tolerance).
- Primal/KKT metrics ≤1e-7, actual density excess beyond cap+slack ≤1e-3,
  and maximum slack ≤0.02 (stricter than a sustained-slack allowance).
- Relative scatter mass error ≤1e-10 and actual disk area change ≤1e-10.
- Maximum support/footprint area change from the identical initial cohort ≤5%.
- Uniform: no large void detected at any recorded sample.
- Hole ON: total large-void area reduction ≥80% at 8 seconds; crack ON: ≥80% at
  10 seconds. Measure all components so a replacement hole counts against recovery.
- OFF: void area remains within 5% of its initial value.

Geometry samples every 0.5 s; maximum solver/contact/speed quantities every
substep. Replays contain world coordinates every 0.1 s. This does not qualify
per-frame void lifetime or 60-fps failure video. Repeat geometry at
h_diag=0.125 on target snapshots to assess raster sensitivity.

Timing is a CPU reference profile: no warm-up, one run per input, and includes
the mandatory exhaustive geometry verification and retry work. The separate
raster diagnostic and replay serialization are outside `stepMs`. It is **not** a
1k/10k performance qualification or a promise of 60 Hz. Execution environment,
fixture hashes, source hashes, retry reasons, actual population, tolerances and
pass timings accompany the result. Do not tune parameters on the held-out seeds.

## Evidence and unresolved limits

Preserved [development results](../../docs/research/fluid-navigation/particle-results/summary.json),
[holdout results](../../docs/research/fluid-navigation/particle-holdout/summary.json)
and [resolution audit](../../docs/research/fluid-navigation/particle-results/geometry-audit.json)
record the evaluated source hashes and conditions. The 3 scenes × 4 seeds × OFF/ON
runs met the scoped criteria above. These are source-specific evidence, not an
acceptance statement for a future implementation.

- Seed 42's hole recovery changes from 93.07% at h_diag=.25d to 88.96% at .125d.
  Both passed the 80% criterion, but the 4.11 percentage-point sensitivity remains.
  Fine-grid checks did not cover every holdout seed. Replay coordinates round to
  1e-6d; tiny replay overlaps are distinct from runtime Float64 geometry checks.
- The recorded CPU P95 is roughly 20–23ms for about 500 disks, including mandatory
  exhaustive safety work. This is not a scalable 10k backend or a 60Hz result.
- A ~10d-wide compressed disk patch with preferred velocity `-3(x-center)` does
  not converge in 200 iterations. Even a 2,000-iteration diagnostic retained
  primal ~.00368 and complementarity ~.0348. The failure is retained in the unit
  suite; do not loosen tolerances or silently integrate an unconverged solution.
- Repair runs used zero density slack. They do not establish long-range pressure
  transport in saturated crowds; analytic block tests and dynamic scenes differ.
- Automatic interior masks, walls, branches, corridors, multiple routes and
  arrival policies are unimplemented. Known support/oracle boundary treatment is
  part of the current experiment, not an inferred general solution.

Before production integration, compare automatic masks against the same oracle
inputs, test walls/branches for misclassification, and resolve strong-compression
convergence. Filling a cavity requires donor area: exterior size, surrounding
density and a large void cannot all be held fixed when mass is insufficient.
Do not replace the default backend before those boundaries are validated.
