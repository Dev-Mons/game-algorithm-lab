# Local velocity and contact modules

`LocalMotionSolver.solve` reads an immutable `AgentBuffer` snapshot and writes a
different buffer. The caller owns navigation, goals, arrivals, commands and
stall accounting. Preferred velocity inputs are separate from the actual
displacement-derived `next.vx/vy`. The following tick uses that observed velocity,
including the bounded residual correction; it is not a correction-free momentum
state. All non-motion fields are copied.

Implemented alternatives:

- `none`: preferred velocity, shaped by the configured acceleration preference.
- `separation`: short-range distance-weighted disc repulsion.
- `boids`: separation plus weak same-group, same-heading alignment/cohesion,
  requiring a radius-clear line of sight between agents.
  `steeringBoids` enables this preference layer before another avoidance mode.
- `orca`: disc velocity-obstacle cutoff arc/tangent-ray projection, reciprocal
  half-planes and incremental 2D optimization inside the maximum-speed disc.
  Immovable bodies assign the moving agent full responsibility. An infeasible
  intersection uses 16 bisection rounds of uniform half-plane relaxation; this
  is a documented minimax approximation, not RVO2's exact LP3 fallback.
- `sampling`: exact preference, stop and 48 radial velocity samples, scored by
  preference deviation and relative swept-disc time to collision. This is a
  local sampling comparator, not DetourCrowd's complete algorithm.

ORCA geometry was independently implemented from the mathematical definition in
[Reciprocal n-body Collision Avoidance, §§4–5](https://gamma.cs.unc.edu/ORCA/publications/ORCA.pdf).
No public implementation source was copied. Static obstacle handling uses the
repository's existing rounded-rectangle continuous circle integrator; it is not
ORCA polygon obstacle constraint construction. ORCA is holonomic: acceleration
shapes its preference only, with no arbitrary post-projection acceleration clamp.

The avoidance neighborhood is the nearest `neighborLimit` bodies within
`neighborRadius + radius_i + radius_j`. Candidate selection itself is untruncated
and counted; `neighborTruncations` counts in-range bodies not selected. This
limited-radius/K variant does not inherit the paper's full-neighborhood guarantee.

All alternatives share radius-dependent substeps, continuous static sweeps, and
a swept-disc movement limiter with up to three rounds after trajectory
shortening. Touching discs first receive up to three normal-only displacement
projection passes, preserving shared tangential progress. Changed contact
segments and CCD-shortened segments are swept against static geometry again:
the straight chord between a sliding path's endpoints may otherwise cut a
rounded wall corner. `ccdStops` includes these normal projection interventions.
The substep count uses the selected velocities before contact sharing, which can
increase one body's individual travel. `contactIterations=0` disables residual position projection only;
these common crossing guards remain enabled. A chain longer than the limiter's
round budget, including a conflict created by the final static re-sweep, is not
certified continuously collision-free.

ORCA and sampling with retained arrivals additionally receive bounded route
recovery when stalled behind a parked body. Given actual `targets`, this builds
a local visibility graph around circumscribed 16-gons for nearby inactive discs,
chooses a deterministic shortest route, and caches its waypoints. Edges check
circle and rectangle clearance; the next leg is checked again against the
current immovable neighbors. Active queue-stopped agents do not create detour
nodes, although they remain collision constraints. The graph uses the existing
nearest-K neighborhood and is not complete global planning among all parked
bodies. ORCA feasibility projection, static sweeps and disc CCD still apply to
the resulting preference. A new solver on commands/terrain changes discards
these local route caches.

Residual contacts use simultaneous Jacobi corrections, deterministic ID normals
for collapsed centres, fixed immovable bodies, contact-count averaging and a
correction cap of `min(radius/2, maximumContactCorrection)`. Every iteration
rebuilds the contact grid. Contact queries have no K/cell-population cap and use
the actual maximum agent radius. Correction segments also undergo static sweep.
Finite iterations, correction caps and high-density infeasibility can leave
overlaps; the exact final physical overlap-pair count is returned each step.
The pass time includes this audit and must not be described as a cheap sampled
overlap estimate. Static overlap at the initial position is stopped/reported via
`invalidStaticStarts`; recovery from a building placed on an agent belongs to the
world/command policy. Only initial static penetration within a `1e-5` world-unit
numeric shell is locally projected out to prevent tangent roundoff from
permanently freezing a body; this is counted as a static contact.

`retainArrivals=true` keeps inactive bodies immovable in all spatial/contact
queries; false removes inactive bodies. An optional `immovable` mask can lock
active bodies. Boids grouping uses an optional `Uint16Array` of group IDs.

Metrics include timing of spatial/avoidance/integration/contact passes, candidate
checks, truncations, contact constraints and active contact bodies, exact final
overlap pairs, maximum per-pass correction, static contacts/invalid starts,
substeps, ORCA infeasibility and swept-disc checks/stops. Counters aggregate work
over substeps/passes; they are not unique pair counts unless explicitly named.
The solver is deterministic for the same inputs and JavaScript execution
environment; cross-engine bitwise determinism has not been established.

`tests/unit/lab-motion.test.ts` checks all alternatives, reciprocal head-on and
crossing passage without PBD/CCD intervention, the feasible and infeasible
velocity optimizers, fast pair swaps, thin walls, newly created contact candidates,
mixed radii/collapsed centres, retained arrivals and invalid static starts.
It also checks tangential contact progress and passage around parked discs,
including a world boundary and a cluster of retained arrival slots.
