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
recovery when stalled behind a parked body. In a neighborhood containing only
parked bodies, absence of new progress toward the same route target also
triggers recovery, even if avoidance keeps the body moving in an orbit. Progress
uses one body radius (reduced near the target) and the configured stall interval;
returning to a previously reached distance does not count as new progress.
Given actual `targets`, this builds
a local visibility graph around circumscribed 16-gons for nearby inactive discs,
chooses a deterministic shortest route, and caches its waypoints. Edges check
circle and rectangle clearance; the next leg is checked again against the
current immovable neighbors. An actual visible `navigationTargets` waypoint
takes precedence over the final slot when the global route still goes around a
wall. Coordinate changes invalidate the cached route even if the caller mutates
the same waypoint object. A nearby first vertex remains until the following leg
is visible; proximity alone must not remove a necessary corner. Active queue-stopped agents do not create detour
nodes, although they remain collision constraints. The graph uses the existing
nearest-K neighborhood and is not complete global planning among all parked
bodies. ORCA feasibility projection, static sweeps and disc CCD still apply to
the resulting preference. A new solver on commands/terrain changes discards
these local route caches. Acceleration shapes the selected route preference,
including a required retreat, before ORCA projection. Shaping toward the blocked
goal first would repeatedly brake a detour that initially moves away from it.
With moving neighbors, this remains the original vector preference ramp. In a
parked-only neighborhood the cached route follower points along its visible leg
and ramps speed magnitude by `maxAcceleration * fixedDelta`; this holonomic
follower does not carry the preceding leg's heading past a tight vertex. Neither
preference rule is a physical acceleration guarantee after ORCA/contact solving.
Q's common-handed yield acts after local route selection and before that ramp,
so cached routes cannot discard it and opposing travelers choose opposite world
sides. The rotation magnitude remains the existing 0.8/0.3 rule.
When active neighbors remain stalled against each other, the same bounded graph
also provides deterministic priority recovery: only the lower-priority mover
(larger stable agent index) routes around the higher-priority stalled peer as a
temporary routing obstacle. That concession lasts while the peer remains in the
local neighborhood, rather than expiring as soon as it begins to move. Peers
remain active and reciprocal in ORCA; their radii, contact response and actual
motion are unchanged. Fixed queue reservations cannot become priority detour
nodes. `priorityRecovery=false` isolates the other recovery policies for module
tests. This finite local policy is not complete multi-agent path finding or a
guarantee of deadlock freedom.
An occupied static-grid waypoint may reconnect to a later *actual* vertex in the
supplied `navigationPaths` suffix. This does not require the agent to enter a
parked disc or invent a straight ray through a wall; every connecting edge still
passes the same static and disc clearance checks.
For an actual intermediate cached turn, parked-body ORCA planes predict only
until that planned turn, using `max(fixedDelta, legDistance / preferredSpeed)`
capped by the configured horizon. Predicting a constant velocity farther down
the current ray can otherwise avoid an obstacle lying beyond the planned turn
and flatten a safe turn indefinitely. Active peers retain the full configured
reciprocal horizon, final destinations do not shorten it, and physical CCD/contact
guards remain enabled. This is an explicit route-aware static prediction variant.
The graph additionally includes up to eight analytical axis/circle intersections
per routing body, through the source and selected target. They connect valid
wall-tangent endpoints that lie inside the conservative polygon-node envelope,
where regular vertices alone can all be blocked by the wall or disc. These
entry points receive the same physical clearance checks; polygon resolution and
body radii are unchanged.
Slot allocation shares `retainedBodyDetourRadius` with this graph and reserves
twice that clearance plus both arrival tolerances; otherwise settled neighbors
can leave a physical lane narrower than ORCA's configured gap and the graph's
circumscribed polygon clearance.

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
permanently freezing a body or bypassing a slow inward wall sweep. This happens
before the sweep, since its start-validity and normalized-time tolerances have
different units; it is counted as a static contact.

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
An active queue stopper with an unrelated nearby parked body does not initiate
this parked-body route recovery.
The low-acceleration U-shaped parked-body test requires an initial retreat and
fails under the old acceleration-before-detour ordering.
The captured bottom-boundary stall checks a necessary first vertex only 0.307
units away; discarding it by proximity previously kept the agent stationary.
The moving-orbit fixture and a moving-peer-to-retained transition check this
follower without weakening ORCA, static sweeps, or disc contacts.
