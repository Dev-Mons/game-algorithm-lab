# External forces — issue #32

## Profile fixed before final acceptance measurements

`external-v1`: pixels and seconds, dt <= 1/30, unit inertial mass for every body,
independent of radius-squared CrowdField area. Agent input Δv <= 600 px/s,
acceleration <= 1200 px/s², stored physical speed <= 600 px/s, proxy speed <= 300
px/s. Up to 8 circular proxies (radius 1.5–64), 32 scheduled/ongoing effects,
4096 recorded IDs between resets. Maximum 16 adaptive substeps, 64 candidates
and 32 owned pairs per agent/substep, four sequential contact passes and four
split stabilization passes. These limits do not change with population.

Quality gates: isolated Δv error < 1e-6 with drag/control disabled; zero static
wall crossings; small-scene pair compression <= 0.5 px; zero saturated queries
in normal scenes; 95% navigation speed within four seconds after a <=500 px/s
backward hit; exact replay arrays on the same CPU runtime. Invalid overlapping
initial conditions, trapping a body against an advancing proxy, and input
budget excess are overload cases, not normal quality successes.

Performance gates for this CPU experiment: median of three repeat P95 values
for no-input steps <= 110% of the same-machine baseline. Active profile P95
budgets are 20 / 120 / 240 ms for actual 1K / 10K / 20K agents. These are
headless simulation budgets, **not a 60 Hz claim**. 50K is exploratory. Full
independent spatial quality audits run separately and outside step timing.

## Architecture and choices

`npm run research:external` loads the exact baseline solver from Git and runs
backward impulse, 16-body chain, fast crossing, thin wall and recovery scenes.
The comparison includes the unchanged solver, an XPBD variant with walking
speed/turn limits removed, that variant with eight rebuilt substeps, the chosen
physical pass, and a separate motor/residual-velocity prototype using the same
physical contact pass. Raw results: `baselines/external-model-comparison.json`.

The unchanged path erased the backward impulse. Removing its walking limits
allowed endpoint crossing and increased chain energy beyond its initial value.
Eight substeps prevented crossing but produced rebound from position-derived
velocity. The selected physical pass stopped the equal/opposite crossing with
zero restitution, kept chain compression below 0.5 px and stored zero wall-normal
velocity immediately after the wall hit. The split prototype also passed these
calibrations when residual velocity was explicitly rebased after collisions.
Recovery to 95% took 3.18 s for split and 3.37 s for single velocity; both met
the predeclared four-second limit. Single velocity was selected for identical
contact quality without an additional 16 bytes/agent motor vector. This is a
bounded prototype comparison, not a claim that every possible split model or
XPBD formulation is inferior. Cold micro-experiment times are not speed gates.

The existing Legacy path remains the no-input baseline. External motion is an
optional mode inside the same `CrowdMovementSolver`; it does not update a second
position or run a recursive knockback propagation system. One physical vx/vy
pair is authoritative. A byte per agent marks externally driven motion, and a
second byte distinguishes this tick's direct targets from contact recipients.
No separate persistent external velocity is accumulated and recombined after
wall collision. Heading is voluntary orientation; it cannot erase sideways or
backwards physical motion.

The existing relaxed XPBD/contact correction cap is retained for ordinary
walking. For external motion, speculative swept-circle time-of-impact normals
drive zero-restitution pair velocity impulses, followed by split position
stabilization. Static sweeps handle both physical movement and stabilization.
Stored velocity is the terminal collision-projected velocity, not total
displacement divided by dt: wall travel before impact and nonphysical overlap
repairs are not continuing momentum. Actual displacement remains available as
current minus previous position. No post-collision walking-speed clamp is used
for externally driven agents.

Substeps adapt to nearby approaching velocities. Ordinary bodies use a conservative
relative-speed bound; only external recipients and proxy neighborhoods need extra
planning queries. Coherent fast translation can use one step. Near static geometry
or a saturated planning query, the original absolute-speed resolution is retained.
The broad phase uses a 12px contact grid in open space and the original finer
body-diameter grid on obstacle maps, rebuilt each substep. The finer obstacle-map
grid prevents dense wall-side buckets consuming the candidate budget.
Candidate ranges still include both agents' absolute travel and correction padding;
continuous circle tests handle crossings inside each substep. Pair ownership is
lower ID; iteration and proxy order are stable. Split corrections are swept
against static geometry and never fed back as velocity. A fixed solver budget
cannot guarantee arbitrary overpacking has a nonpenetrating solution.
The prediction reserves 1.5 times the maximum agent/proxy speed up to the profile
ceiling. If a later contact concentrates energy
beyond that travel bound, its velocity is clipped and `speedClamps` records it.
This preserves candidate validity without an unbounded substep restart. Predicted
static stops constrain each velocity iteration, so followers respond to a stopped
front before integration rather than compressing into it.

CrowdField observes physical velocity after inputs and before movement. Crowd
Flow alignment substitutes voluntary desired velocity for externally driven
agents so a backwards hit does not poison its forward intent channel. Density
pressure still limits the voluntary target; external transport is resolved by
contact. It is deliberately not injected again into the channel pressure pass.
The existing `dynamicRouting=false` default stays unchanged.

The physical separation follows the force/impulse and kinematic-body concepts
in [Box2D's simulation documentation](https://box2d.org/documentation/md_simulation.html).
[Small Steps](https://matthias-research.github.io/pages/publications/smallsteps.pdf)
motivates comparing smaller steps; this implementation additionally rebuilds
candidates and tests swept contacts. Neither source's performance is used as
this application's measured performance.

## Input and lifetime contract

Call `simulation.enqueueExternal(input)`. Every input has `id`, integer `tick`,
and `generation: simulation.external.generation`. Inputs use the world canvas
coordinate system, +x right, +y down. Inputs are copied on acceptance and sorted
by tick then lexical ID. Identical ID retransmission returns false; conflicting
ID, stale generation/tick, invalid/nonfinite values and input budget overflow
throw `RangeError`. Reset changes generation and clears IDs, pending inputs,
effects, hit masks and proxies. Old agent indices must not be reused after reset.
There is no wall-clock expiry while paused.

* `impulse`: target agent or circular region, `dvx/dvy` in px/s. Applied once
  before substeps. This is a direct velocity change, not mass-scaled N·s.
* `acceleration`: same target, `ax/ay` in px/s², `[tick,endTick)` duration.
  Regions resample current positions each tick. `cancel` names an input ID;
  cancellation removes its pending/ongoing influence, not acquired momentum.
  Cancellation requires an already accepted influence ID; body lifetime uses
  the separate remove command.
* `blast`: center, radius, peak `speed`, linear falloff `1-distance/radius`.
  Optional `expansionSpeed` turns it into a wave of at most 60 seconds. Each
  agent is hit at most once when first sampled inside the expanding radius.
  This is expanding disk sampling, not a fluid wave or continuous moving-agent
  wavefront intersection. Center direction uses a stable agent-ID hash.
* Region filters optionally specify a spawn `flow`; agent targets select one
  live index. **Blasts and regions have no wall occlusion**. The caller must
  select individual targets if gameplay requires occlusion or other filters.
* `proxy`: stable `body`, radius, start `x/y`, endpoint `toX/toY` for one tick.
  New bodies are created at start pose. Future updates must start at the last
  endpoint and retain radius. Missing updates stop at the last endpoint. Use
  `remove-proxy` then a new create for teleport/resize. Circular orientation has
  no effect; oriented boxes/capsules, angular friction and vehicle physics are
  outside this profile. A proxy does not edit static obstacles or rebuild paths.
  Only one pose per body per tick is accepted. Initial overlap at creation is
  a stabilization/overload case; normal prescribed motion starts in free space.

Arrival sinks run before input targeting and after final movement. Inactive
agents ignore hits and stay inactive. Goal changes preserve acquired momentum;
existing explicit goal commands can reactivate arrivals as before.

Drag (1.5/s when moving backwards or above walking speed) and limited voluntary
control (25% acceleration) recover navigation from the displaced position.
The external flag clears when the ordinary motor can handle the actual velocity
under its acceleration, speed and heading limits. Exact agreement with desired
velocity is not required: contacts can prevent it indefinitely. Small contact
impulses within the ordinary motor's per-tick budget still affect velocity but
do not propagate external mode. Disabling voluntary control retains the
undamped calibration path, including weak impulses below walking speed.
Zero drag and zero acceleration give the analytical calibration profile.

Overload policy: reject oversized individual inputs; clamp combined initial
speed to the smaller of 600 and the 16-substep travel budget, with `speedClamps`.
Candidate truncation increments `saturatedQueries`; those ticks do not establish
nonpenetration. An advancing proxy against a static wall may overlap the agent;
static walls win and `crushed` reports residual proxy penetration. There is no
damage/despawn policy. Consumers must inspect these diagnostics.
`affected` counts unique direct targets this tick; `contactAffected` counts
unique agents whose velocity or position was changed by contact, and may overlap
the direct set. `contactCellUpperBound` is the contact-query AABB cell budget
(early candidate termination can visit fewer cells); `queryCells` and
`proxyCells` count the full region/proxy cell visits. Static slide exhaustion is
reported separately. Contact timing includes split corrections' static sweeps;
`staticMs` measures the physical integration pass only.

## UI and replay

The canvas click tool selects goal, blast, expanding wave, one-second wind, or
a one-second moving circular body. External-motion and proxy debug outlines are
not rendered. Paused clicks queue fixed-tick commands; step/run applies them. The
existing lab replay/export records `external` commands including all proxy
poses. Reset removes them. `external.record()` returns a defensive input log;
state hashes include pending events, hit masks, body poses, affected flags and
settings. Tests also compare unquantized arrays, not only hashes.

## Work and memory boundaries

Input region queries build a current-position index only when necessary. They
visit every target, independently of contact candidate limits. Cost includes
visited cells even for empty regions; world size and 32 effects bound this work.
The contact index is rebuilt for each substep and never reused as a current
position input index. Full-grid rebuilds and full-population physical passes
remain costs even for a local hit; sparse physical islands are a future
optimization, not implemented here.

New persistent agent flags cost 2 bytes/agent (20 KB at 10K). The lazily allocated
physical pair buffers cost 256 bytes/agent (2.56 MB at 10K); candidate scratch is
260 bytes, with another 516 bytes for bounded planning queries. Static-neighbor
IDs cost 4 bytes/agent. The 12px open-space physical index and optional 32px region index
each use 4 bytes/agent plus 12 bytes/grid cell and 4 bytes. Channel-major Crowd
Flow aggregation uses an additional 8 bytes per CrowdField cell for channel mass.
Each active wave uses one byte/agent. Existing movement scratch is reused. Typed
buffers retain their high-water capacity. Inputs and per-region/proxy callbacks
allocate per input/pass; no new per-agent object is allocated in a step. Node
heap samples include the runtime and GC and do not prove zero allocation.

Sequential pair updates are deterministic on CPU but **not parallel safe**.
A GPU port needs graph coloring or explicit Jacobi read/write buffers with
deterministic reductions. It cannot blindly scatter both endpoints in parallel.

## Reproduction

```
npm run verify
npm run test:e2e -- tests/browser/external-influences.spec.ts
npx vite-node scripts/measure-external.ts --mode=none --output=baselines/external-after.json
npx vite-node scripts/measure-external.ts --mode=blast --agents=1000,10000,20000 --quality=on --repeats=1 --output=baselines/external-blast-quality.json
```

Other measurement modes: `few`, `global`, `proxy`, `overlap`. Audit OFF timings
and audit ON quality results must be reported separately. Results and final
acceptance status are recorded in `external-forces-results.md`.
