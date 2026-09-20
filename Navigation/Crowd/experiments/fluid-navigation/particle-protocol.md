# Actual-disk internal repair — P0–P2a protocol, version 1

This is a scoped implementation of the research recommendation, not qualification
of every metric in `docs/fluid-navigation-research.md`.

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
and complementarity ≤1e-7. The initial prototype permits **200 iterations**, an
explicit change from the report's proposed 100; iterations are reported. No
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
area**, not the earlier field-deficit metric or a general automatic-mask score.

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
substep. Replays contain world coordinates every 0.1 s. This is not the report's
per-frame void-lifetime or 60-fps failure-video qualification. Repeat geometry at
h_diag=0.125 on target snapshots to assess raster sensitivity.

Timing is a CPU reference profile: no warm-up, one run per input, and includes
the mandatory exhaustive geometry verification and retry work. The separate
raster diagnostic and replay serialization are outside `stepMs`. It is **not** a
1k/10k performance qualification or a promise of 60 Hz. Execution environment,
fixture hashes, source hashes, retry reasons, actual population, tolerances and
pass timings accompany the result. Do not tune parameters on the held-out seeds.
