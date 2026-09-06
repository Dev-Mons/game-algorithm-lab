# Crowd dynamics design decision

Decision recorded before replacing dynamics, 2026-09-06. Baseline commands and
raw outputs are in `artifacts/fluid-crowd/before-*`.

The current field computes `max(0, density / threshold - 1)^2`, but has no
transport flux or velocity solve. `planDesiredVelocities` adds its gradient,
per-agent offset pressure probes, viscosity, and a forward floor. XPBD position
corrections become next-frame velocity in `publishVelocities`; they therefore
organize motion as well as remove overlap. Contacts use population tiers
(16/12/8 contacts, 3/2/1 iterations, 96/32/8 queries, .05/.5/1 compliance).
The final state has thousands of reported overlaps in the 10k benchmarks even
though the bounded solver passes its safety tests. Dynamic rebuilds take only
36ms of the 2,232ms open / 4,135ms obstacle 360-step baselines.

## Candidates

These are architectural estimates, not measured GPU benchmarks. K is a bounded
particle neighborhood; G is grid cell count; I is a fixed solver iteration count.

| Criterion | Existing field + XPBD | Boids | SPH / PBF / DFSPH | Pure continuum | Selected particle/grid hybrid |
|---|---|---|---|---|---|
| 10k–100k work | N K I, tier-dependent quality | N K | N K I, multiple neighbor sweeps | N + G I | N + G I + bounded contacts |
| GPU suitability | Jacobi fits, pair writes conflict | parallel gather | good, expensive gathers | excellent stencil locality | scatter, stencil, gather |
| Bandwidth | contact lists every iteration | neighbor states | density/gradient/neighbor passes | grid buffers | 8 fixed directional channels + scalar pressure |
| Atomics | pair endpoint corrections | cell construction | grid construction, possibly pair work | scatter density/momentum | fixed 4-cell × 2-channel scatter; residual pair writes |
| Divergence | contacts, static geometry | neighbor filters | neighbor filters, convergence | blocked cells | active/blocked masks, fixed stencils |
| Neighbor query | bounded but biased truncation | bounded only with explicit cap | caps sacrifice incompressibility | none | bounded residual only |
| Iterations | 1–3 by population | 1 plus integration | density and/or divergence iterations | fixed pressure iterations | fixed pressure iterations |
| Obstacles | exact sweeps | still needs sweeps | boundary particles/SDF and sweeps | no-flux faces | no-flux faces + exact sweeps |
| Narrow gates | contact compression | stop waves | plausible, costly constraints | grid resolution sensitive | grid resolution sensitive; circle safety retained |
| Dense packing | contact-driven | repulsion/cohesion tuning | good at adequate neighbor support | no microscopic guarantee | projected flow + residual circles |
| Voids | pressure expansion/steering holes | separation produces holes | tensile artifacts need treatment | continuous density | unilateral pressure avoids attraction |
| Counter-flow | separate navigation | mixing without labels | one-fluid velocities cancel | needs multiple velocities | fixed directional momentum channels |
| Merge/split | contact collisions | cohesion can clump | fluid behavior, goal forces needed | natural | shared pressure, retained intents |
| Jitter | correction / dt feeds velocity | competing forces | density iteration dependent | low at grid scale | local momentum transfer + pressure |
| Complexity | existing but overlapping roles | simple initially, exceptions later | high | medium | medium |
| Exceptions | population tiers, pressure probes | likely corners/lanes | boundary/invalid density | navigation still required | common local inputs, no scenario dispatch |

Choose the hybrid: retain obstacle-aware navigation and route-choice costs,
replace agent pressure/viscosity steering with grid velocities, and retain
bounded circle contacts plus swept static collision. Route cost is a choice of
path, not another physical force. The projection is a fixed-budget, unilateral
density-capacity approximation, not an incompressible water solver. Compare
against unchanged acceptance thresholds before adopting it. Do not increase
contact iterations to compensate for a bad field.

Primary sources: [Continuum Crowds](https://grail.cs.washington.edu/projects/crowd-flows/78-treuille.pdf),
[Position Based Fluids](https://mmacklin.com/pbf_sig_preprint.pdf),
[DFSPH](https://diglib.eg.org/items/75ef5636-2431-4342-9939-5f51a200d54b).
