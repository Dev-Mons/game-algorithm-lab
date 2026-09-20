# Crowd algorithm experiment map

Design recorded on 2026-09-20 before the experiment pipeline refactor. The source
is [the research report](rts-defense-crowd-research-2026-09-20.md), especially
sections 4–6 and 8–9. This file distinguishes implementation work from measured
results; research targets are not achieved performance claims.

## Imported baseline and boundaries

The initial worktree did not contain the original directory's latest uncommitted
Crowd work. Relevant files were imported once without changing the original
directory; the main task's import manifest records provenance. The imported
implementation is retained as the legacy directional grid hybrid.

Initial verification: type checking passed and 117 of 118 tests passed. The
inherited `movement-v2.test.ts` obstacle-gate test reported a maximum bounded
overlap count of 55 against an existing limit of 16. This failure preceded the
pipeline changes. Its fixture and measurement semantics require investigation;
raising the threshold to match the observation is not a correction.

Investigation isolated a fixture configuration drift: before the imported change,
dynamic congestion routing was always enabled; the imported UI default disables
it. Keeping the same solver and seed and enabling only `dynamicRouting` produced
13 maximum bounded overlap pairs, 979 crossings in 10 simulated seconds, 86
arrivals, and zero wall overlaps. Routing off produced 55, 893, 85, and zero,
respectively. The historical acceptance fixture now explicitly enables routing
and retains its original overlap limit of 16. The routing-off quality limitation
remains visible here; this fixture correction does not repair or hide it.

`tests/simulation/legacy-baseline.test.ts` freezes the imported state hashes for
120-agent seed-42 open field, winding corners, and 5% double-radius corner runs,
including 120 steps, a reversal command, 60 more steps, reset and replay. Hashes
were captured before changes to the numerical simulation path.

The current data path is `CrowdSimulation` -> shared `FlowField` ->
`CrowdField`/`CrowdFlowSolver` -> `CrowdMovementSolver` -> published `AgentBuffer`.
Seeded spawn, per-agent radii and flow IDs belong to world state. `SpatialHash`
provides queries; quality trackers observe published state independently.
`main.ts` owns the fixed clock, UI, renderer and browser debugging interface.
The editor provides scenario data, while scripts construct the same simulation
without rendering. These boundaries should remain available after refactoring.

## Layer and preset contracts

| Layer | Inputs and output | Cost and validity contract |
|---|---|---|
| World and commands | Seed, geometry, sizes, goals, fixed-tick replay -> stable agent IDs and state | Reset recreates all solver state; terrain changes invalidate dependent routes immediately |
| Navigation | Position, goal or group, radius, geometry version -> route tangent | A* requests are cached per corridor; a shared field is keyed by goal and clearance, not spawn cohort |
| Intent | Route, formation, arrival state -> preferred velocity | Slots are stable; impossible or occluded slots fall back to valid routing |
| Local avoidance | Snapshot positions/velocities and preferred velocity -> selected velocity | Neighbor caps are explicit approximations; ORCA and velocity sampling are alternatives |
| Contact and integration | Selected velocity, radii, geometry -> valid next state | Residual PBD, swept static collision and dynamic tunneling protection are separate concerns |
| Traffic and congestion | Density, route progress, portal occupancy -> speed or entry policy | Lease expiry cannot clear physical occupancy; waiting differs from arrival and disconnected routes |
| Measurement | Published state and pass timers -> inspectable results | Quality audit is independent of truncated solver candidates; audit overhead is reported separately |

| Preset | Exact comparison intent | Important limits |
|---|---|---|
| Legacy | Existing directional grid velocity/capacity hybrid and residual contact | Not full Continuum Crowds; preserve imported behavior and exit-style arrivals |
| B0 | Individual Grid A* corridor + seek/arrival + weak separation + common contact | Individual request cost is exposed; local avoidance does not guarantee a route |
| B1 | Shared reverse Dijkstra/Flow Field + the same B0 local layers | B0/B1 changes navigation only; number of distinct goals and radius classes affects cost |
| R | Shared group route/corridor + virtual leader and stable slots + ORCA + residual contact | ORCA is half-planes and velocity optimization, not renamed separation; no global deadlock guarantee |
| Q | R or B1 with direction batches, aging, waiting areas and blockage recovery | Retain occupancy until agents exit; refuse entry when the exit is full |
| D | B1 with local density slowdown, smoothed low-frequency route costs and optional queue | Density force, route cost and continuum dynamics are distinct; congestion should permit zero speed |

Module replacement should support controlled ablations: A*/shared field,
separation/ORCA/velocity sampling, contact iterations, formation, density speed,
density route cost and queue. Unsupported combinations must fail at the runtime
boundary and be explained in the UI rather than silently substituted.

## Candidate traceability and validation

| Research candidate | Implementation target | Required evidence |
|---|---|---|
| Individual Grid A* | Navigation module, B0 | Maze/corner arrival, large-radius blocked passage, re-command, deterministic tie-breaking |
| Integration/Flow Field | Existing field through navigation interface, B1/D | Shared goals reuse fields; static geometry version invalidates all dependent fields |
| Boids/steering/separation | Intent/local module | Same-group alignment/cohesion only, no attraction through walls, finite coincident positions |
| ORCA | Local avoidance module, R/Q | Pair head-on, crossing, overlapping initial state, stationary agent, infeasible set and caps |
| Velocity sampling | Alternative local module | Time-to-collision changes the selected candidate; coarse samples expose their limitation |
| PBD/XPBD | Shared contact module | Mixed radii, static correction safety, candidate completeness reference, bounded correction |
| Density movement/cost | Speed and navigation modules, D | Bottleneck compression and route-choice effects tested separately; smoothing reduces reversal |
| Group/formation/arrival slots | Intent/arrival module, R/Q | Stable slot IDs, obstacle fallback, narrow-passage compression and reform, retained arrivals collide |
| Passage queue/deadlock recovery | Traffic module, Q/D | Direction fairness, blocked exit, cancellation, expired lease with occupied passage |
| Directional fluid hybrid | Existing grid module, Legacy | Golden replay hashes and existing behavioral regression tests |
| Simple potential fields | Seek and separation implement local attraction/repulsion primitives; no standalone global potential planner preset | Existing A*/flow planners supply routes; local forces have no U-shaped-obstacle/global reachability guarantee |
| Full Continuum Crowds | Separate future implementation if warranted | Current density costs and directional hybrid must not be named a full reproduction |
| Hierarchical portal/partial cache | Extension after route cost measurement | Radius/class/version keys, upstream invalidation and cache hit/memory evidence |
| NavMesh, jobs/SIMD, GPU, LOD | Representation/execution extensions | Actual 50k bottleneck first; maintain equal active population, physics and measurement scope |

The implementation now follows this mapping:

| Files | Implemented responsibility | Verification files |
|---|---|---|
| `src/algorithms/lab/contracts.ts`, `registry.ts` | Borrowed world state, pass/count contracts, six presets and validated module combinations | `tests/simulation/lab-pipeline.test.ts`, `tests/browser/algorithm-lab.spec.ts` |
| `src/algorithms/lab/grid-astar.ts` | Stable 8-connected A*, per-radius safe edges and visible waypoint simplification | `tests/unit/lab-navigation.test.ts` |
| `src/algorithms/flow-field/flow-field.ts`, `lab/pipeline.ts` | Goal/radius shared fields, per-agent paths, group corridors and full version invalidation | `tests/simulation/lab-pipeline.test.ts` and existing flow-field/mixed-size suites |
| `src/algorithms/lab/pipeline.ts` | Arrival slots, virtual group leader, formation fallback, density slowdown, periodic congestion costs, progress-based replanning | `tests/simulation/lab-pipeline.test.ts`, measured scene runs |
| `src/algorithms/lab/traffic.ts` | Direction batches, age/front ordering, exit occupancy check and leases distinct from physical occupancy | `tests/unit/lab-navigation.test.ts`, bidirectional corridor measurements |
| `src/algorithms/lab-motion/orca.ts` | Disc velocity-obstacle projection, half-plane optimization and documented infeasible relaxation | `tests/unit/lab-motion.test.ts` |
| `src/algorithms/lab-motion/local-motion.ts` | Separation, same-group Boids, velocity sampling, swept integration, refreshed untruncated Jacobi contacts | `tests/unit/lab-motion.test.ts` |
| `src/core/simulation.ts` | Legacy/lab orchestration, commands, seed/reset, topology replacement and compatibility API | `tests/simulation/legacy-baseline.test.ts`, `tests/simulation/lab-pipeline.test.ts` |
| `src/core/lab-results.ts`, `scripts/measure-lab.ts` | Independent geometry audit, timing/population records, isolated sequential CLI, source manifest and timeouts | `tests/unit/lab-results.test.ts`, [measurement results](lab-measurements.md) |
| `src/ui/lab-panel.ts`, `src/scenarios/lab-scenarios.ts` | Preset/module controls, result persistence/export, sequential comparisons and replayable scenes | `tests/browser/algorithm-lab.spec.ts` |

Exact variants and limits:

- ORCA covers disc-agent half-planes. Infeasible sets use 16 rounds of uniform
  constraint relaxation, not RVO2's exact LP3 fallback. Static collision uses the
  existing circle sweep, not ORCA's polygon obstacle constraints. It is a
  holonomic, finite-neighborhood variant, with preferred acceleration shaping.
- The sampling comparator uses the exact preference, stop and 48 radial samples;
  it does not claim DetourCrowd's complete adaptive sampler. Boids alignment and
  cohesion require same group/heading and obstacle visibility.
- New contact solving refreshes untruncated spatial queries every iteration and
  reports exact final overlap pairs. Avoidance still has a configurable K cap.
  Substeps and a bounded swept-disc limiter reduce tunneling; finite guard rounds
  and finite PBD iterations do not constitute a universal non-overlap guarantee.
- Group corridors are grid paths with a virtual leader, not hierarchical sector
  portals or a NavMesh funnel. Shared fields have an explicit 128 goal/size cap;
  high-D stress must use individual A* rather than silently allocating N fields.
- Slots retain arrived bodies. Stable approach-aware assignment and a full-body
  ingress lane leave room to reach later slots; the footprint is intentionally
  larger than close-packed discs. Placement is bounded by visible free space
  near the goal, and unavailable slots are recorded. A blocked destination is
  rejected for slot placement without searching millions of impossible slots.
  The gate policy operates only on
  declared regions and can lower throughput. No general MAPF or deadlock proof is
  claimed.
- Topology edits invalidate every field/corridor conservatively. Construction
  overlapping an active or retained body is rejected atomically; the caller must
  choose another placement or wait for vacancy. Exit-removed agents do not block
  construction. This policy is distinct from recovering pre-existing invalid
  geometry or moving bodies through a newly built wall.
- Density slowdown and shared-field congestion costs are implemented. The
  existing field constrains dynamic direction choices to static path progress;
  D does not claim unrestricted congestion-optimal detours that initially move
  uphill in the static potential. Full
  Continuum Crowds, SPH/PBF/DFSPH, hierarchical portal caching, NavMesh, GPU,
  workers/SIMD and simulation LOD remain separate follow-ups after measured need.
  A standalone attractive/repulsive potential planner is deliberately not added:
  seek/separation provide its relevant local preferences without presenting a
  local-minimum-prone force as a global pathfinding alternative.

The initial 50k B0/B1 performance runs put the largest cost in local avoidance
(about 112ms average per tick), followed by contact solving and its built-in exact
overlap diagnostic (about 41ms). Shared open-space route initialization was not
the dominant repeated cost. The measured next step is to profile candidate
enumeration/selection and swept/contact work before selecting workers, SIMD or
GPU migration; adding a portal hierarchy or a full continuum solver would not
automatically address this measured local-computation cost. CPU/GPU execution
changes also require matching the same active population and collision quality.

The implementation's [local-motion notes](../src/algorithms/lab-motion/README.md)
define its numerical and collision scope. Measured results, including failures,
are recorded separately from this implementation map.

## Safety and measurement requirements

- Retained arrived agents stay present in contact queries. Exit-style removal is
  an explicit gameplay/benchmark mode, never an unreported speed optimization.
- ORCA preferred speed can be acceleration-limited before solving; arbitrary
  acceleration clamping after solving invalidates its original feasible-set
  claim. Static obstacle sweeps alone are not RVO2's obstacle half-plane solver.
- Contact ownership cannot discard a pair discovered only by the other endpoint.
  Correction padding or rebuilding covers contacts created by previous passes.
  An independent unbounded audit must not reuse truncated solver neighbors.
- Static sweeps cover the entire corrected move. Agent-to-agent swept motion or
  conservative substeps handle trajectories that exchange sides within a tick.
- Terrain changes update collision immediately, then publish complete new route
  versions. Invalidating only the changed tile does not update dependent routes.
- Fix dt, seed, IDs, neighbor order and iteration counts. Timing is observational;
  elapsed milliseconds must not decide deterministic route work budgets.
- Record requested, spawned, moving, waiting, arrived and contact-active counts;
  pass ms, movement Hz, render FPS and total frame separately. Browser memory is
  reported only when actually available, with its scope identified.
- Start with 1k behavioral/quality runs, then distinguish fixed-density expansion
  from fixed-area overload at 10k and 50k. Performance runs and exhaustive quality
  audits are separate. A 50k failure is a result; 100k remains conditional.

ORCA references: [original paper](https://gamma.cs.unc.edu/ORCA/publications/ORCA.pdf)
and [official RVO2 implementation at pinned SHA](https://github.com/snape/RVO2/blob/1c25b27258d191e26c2df83ff6e31abc8efbdaed/src/Agent.cc).
If source is adapted, preserve its Apache-2.0 license and attribution. The research
report's section 9 documents other candidate licenses; unknown-license code must
not be copied.
