# External forces — issue #32

## Profile fixed before final acceptance measurements

`external-v2`: pixels and seconds, dt <= 1/30, unit inertial mass for every body,
independent of radius-squared CrowdField area. Agent input Δv <= 600 px/s,
acceleration <= 1200 px/s², stored physical speed <= 600 px/s, proxy speed <= 300
px/s. Up to 8 circular proxies (radius 1.5–64), 32 scheduled/ongoing effects,
4096 recorded IDs between resets. Maximum 16 adaptive substeps. The 64-candidate
scratch is a fast buffer, not a truncation limit: overflow reruns the same query
into a count-sized buffer. Owned pairs grow up to 128 times the spawned count;
exceeding that explicit overload budget throws and pauses the app instead of
silently omitting contacts. Velocity projection runs 4–16 passes (one extra full
pass if the final swept-workset bound expires); split stabilization runs 4–128
passes until the published pair positions satisfy a 0.45px internal tolerance.
The independent acceptance limit remains 0.5px. Exhausted stabilization is
reported as `unresolvedCompression`. These rules do not change with population.

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
The physical broad phase uses a 12px contact grid, rebuilt each substep. A full
candidate fallback handles dense buckets on obstacle maps without truncation.
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

### Contact work reuse and native kernel

Warm impulses retain their world-space direction when the normal changes and
are projected onto the current friction cone. Without a prescribed moving body,
an energy-increasing warm trial is shortened to the minimum-energy point on its
velocity segment; a non-descent trial is discarded. Static constraints are then
reapplied. Warm guesses cannot be treated as a source of stored kinetic energy.

Persistent warm contact impulses are stored in two reusable open-addressed
tables. Each substep rechecks current geometry, rescales impulses by substep dt,
rejects a changed normal and drops absent contacts. Reset and return to the
ordinary movement path clear both generations. A third reusable table checkpoints the current warm state for an eligible
adaptive-step trial. A rejected trial restores the original hash mask and values;
its checkpoint is scratch storage, not extra physical state. Warm state contributes to the
state hash; replay tests also compare unquantized state arrays.

Velocity geometry is immutable during its iterations. A tight workset includes
all pairs whose current relative swept segment comes within a 1px halo of
contact. It remains valid only while the combined changed velocity travel is
below that halo. Changed frontiers are rebuilt in the same tick; the final
iteration falls back to the complete pair set if needed. Position stabilization
does not reuse that exclusion: it uses its own conservative pair superset,
tracks displacement from the query coordinates, and rebuilds after a repair
exceeds the margin. This is candidate work reuse, not a sparse island solver or
an external-radius cutoff. Dense scenes still execute the full physical path.

Residual dense chains can also receive a collective split projection after
passes 8, 16, 32, 64, 96 and 128, with at most 16 seed attempts at each point. Its iterative
frontier contains every body whose compression would worsen during the proposed
translation. Every member's entire static path and prescribed-circle clearance
are checked before publication. Internal group distances stay fixed; disjoint
opposing groups split the correction by their unit-mass totals. If radial motion
is blocked, bounded non-approaching axis translations are considered. Failed
attempts publish nothing. The correction is capped at half the minimum radius
per attempt and never becomes stored velocity. This does not treat a wall as a
node joining all contact groups or discard momentum by an expiry timer.

`StaticFreeSpace` stores exact empty-disk certificates including body clearance
and world bounds. Only segments contained in a certificate skip static queries.
Geometry revision, changed bounds and clearance invalidate their validity.
Static sweeps retain every obstacle inside the total-travel disk, including
obstacles reached after a slide turns away from the original chord. Surface
roundoff of at most 1e-8px is repaired consistently before a sweep; real inherited
overlaps still follow the recovery/overload contract.

`native/contact-kernel.ts` is an allocation-free AssemblyScript f64 kernel for
the same ordered velocity and position loops. Static geometry stays in the
TypeScript adapter and operates on shared views of the kernel's owned memory.
There is no worker or inter-thread transfer. State upload/publication, workset
packing, geometry callbacks and memory growth are included in step/frame timing.
The generated module is embedded locally; no remote runtime service is used.
`simulation.external.backend = 'js'` selects the reference path for comparison;
the default `auto` uses WebAssembly when available and otherwise falls back to
TypeScript. Backend choice is not a physical input or part of the state hash.

Run `npm run build:contact` after editing the kernel. `npm run verify` checks the
generated bytes without silently updating them. The compiler is a pinned dev
dependency; a built app needs only browser WebAssembly support. Compiler and
memory semantics: [AssemblyScript compiler](https://www.assemblyscript.org/compiler.html)
and [raw memory operations](https://www.assemblyscript.org/stdlib/globals.html#memory).

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
Candidate scratch overflow uses a complete requery. Exceeding the global pair
capacity increments `saturatedQueries` and throws instead of publishing omitted
contacts; exhausted position budgets remain explicit quality failures. An advancing proxy against a static wall may overlap the agent;
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

Agent flags cost 2 bytes/agent. Physical pair IDs initially reserve 8 pairs/agent
(64 bytes/agent for both ends) and grow geometrically up to the explicit global
budget. Geometry, workset IDs, anchors, full-query scratch and collective
projection queues use reusable typed arrays. Each warm-cache slot uses 52 bytes
(key, five f64 values and used-slot ID); two power-of-two working tables and one trial checkpoint retain their
high-water capacity, sized from touching contacts rather than broad-phase pairs.
`external.stats.retainedBytes` reports the owned typed scratch, warm tables,
empty-space certificates and kernel memory; `kernelBytes` reports the active
WebAssembly memory reservation separately and is already included in that total.
These are capacities sampled on an external-contact tick, not allocation-site
counts or total application heap. Zero on an ordinary-path tick means this
diagnostic was not populated; it does not prove those retained buffers were freed.

Additional owners outside that scratch total are the contact and region indices
(4 bytes/agent + 12 bytes/grid cell + 4 bytes each), the static BVH/JS candidate
maps, existing simulation buffers, and one byte/agent per active wave. Ordinary
movement's certificates cost 32 bytes/agent. CrowdFlow reuses its exact scatter
stencil during gather with 57 bytes/agent, avoiding a second connectivity and
heading computation; channel mass still costs 8 bytes per field cell. Input,
frame, callback, capacity-growth and explicit export allocations remain. Node
and browser heap readings include their runtime, recorder and measurement data.

Sequential pair updates are deterministic on CPU but **not parallel safe**.
A GPU port needs graph coloring or explicit Jacobi read/write buffers with
deterministic reductions. It cannot blindly scatter both endpoints in parallel.

## Reproduction

```
npm run verify
npm run test:e2e -- tests/browser/external-influences.spec.ts
npx vite-node scripts/measure-external.ts --mode=none --output=test-results/external-after.json
npx vite-node scripts/measure-external.ts --mode=blast --agents=1000,10000,20000 --quality=on --repeats=1 --output=test-results/external-blast-quality.json
```

Other measurement modes: `few`, `global`, `proxy`, `overlap`. Audit OFF timings
and audit ON quality results must be reported separately. The initial acceptance snapshot is in `external-forces-results.md`; subsequent optimization evidence and limits follow below.

## Performance evidence and limits

The later CPU optimization uses approaching neighbors' relative speed for substeps, with conservative absolute-speed fallback near walls or saturated queries. Small contacts do not propagate external state when normal walking control can absorb the residual motion. This does not expire impulses by timer or reset momentum.

Historical measurement: Ryzen 9 9950X3D / Node v22.22.0, open field, seed 42, radius 3.2, dt 1/60, equal-density scaling, 30 warmup + 90 measured ticks, median P95 across three repeats, audit OFF. For 10,000 agents and a contacting radius-18 proxy moving at 240 px/s, step P95 changed from 53.85ms to 22.02ms. Raw samples remain in `baselines/external-optimization-before.json` and `baselines/external-optimized-*.json`. The old before-run source hash was read at shutdown and includes early edits; it is not an exact snapshot of the executed code.

In the separate headless Chromium observation, 10k proxy simulation P95 was 21.60ms, render CPU P95 1.00ms, and frame interval P50/P95 16.70/33.40ms. Rendering measures Canvas CPU submission, not GPU completion or native display FPS. Raw data is `baselines/external-optimized-browser.json`.

**The rocky-pass 10k dense external-force case failed contact quality:** the audit-ON run had 6.209px maximum sampled penetration, six saturated candidate queries and step P95 128.06ms (wall overlaps zero). Open-field 20k also does not guarantee sustained 60FPS. These historical results are not current all-scenario acceptance.

```sh
npm run measure:external -- --mode=proxy --agents=10000 --output=baselines/my-external-performance.json
npm run measure:external -- --mode=blast --agents=1000,10000,20000 --quality=on --repeats=1 --output=baselines/my-external-quality.json
```

The older `measure-external-browser.ts` deliberately calls one simulation step
per RAF and remains a historical diagnostic. For actual HTTP app acceptance,
start `npm run dev -- --host 127.0.0.1 --port 4273 --strictPort` and use:

```sh
node scripts/measure-frame.mjs --url=http://127.0.0.1:4273 --ticks=660 --repeats=3 --output=test-results/frames.json.gz
node scripts/measure-frame.mjs --url=http://127.0.0.1:4273 --quality=on --seeds=42,7 --repeats=1 --output=test-results/frame-quality.json.gz
```

The real main RAF/FixedClock/timedStep/renderer/recorder/UI stay active. Input is
dispatched through the canvas handler after tick 29 and consumed at tick 30.
The report retains commands, actual active counts, source identity/hash, raw
frames/steps, phase summaries and explicit input spikes. Quality mode audits all
spatial neighbors every ten ticks and every exhausted position budget. It also
checks prescribed circles and nonfinite values. Chord sweeps between published
states do not prove the complete curved path inside each substep. Quality-mode
frame timings are not performance results. `--backend=js` compares the reference
solver and `--trace=off` measures tracing overhead on the same application path.
`--profile=on` additionally writes one CDP `.cpuprofile` per row; profiled frame
timings are diagnostics, not performance acceptance.

`getFrameTrace()` returns the most recent 4,096 main-loop frames. Clock time is
accounted as simulated + debt + dropped + clamped, in requested simulation
seconds; wall elapsed is recorded separately. Pauses add no wall time and retain
existing debt. Catch-up requires spare measured CPU budget, with at most four
steps/frame and bounded debt. Overload remains visible instead of being called
real-time success. Recorder timing windows retain 10,000 samples; full measured
step counts remain separate. Hashing is deferred while the simulation runs;
explicit snapshots and result exports still compute it.


## Issue #33 candidate — 2026-09-26

**This candidate has not passed the 10K 60Hz acceptance gate.** It includes
product frame/time accounting, exact LOS witnesses and empty-space certificates,
bounded recording, contact overflow handling, stronger split stabilization, a
swept velocity workset and an f64 WebAssembly kernel with a JS fallback. It is a
reviewable implementation candidate, not a completed performance claim for
issues #32 or #33.

Environment: Windows, AMD Ryzen 9 9950X3D, Node 22.22.0, Playwright Chromium
151.0.7922.34, actual localhost HTTP main loop, viewport 1440×960 and DPR 1.
The baseline is `a04aa21c5ef09b8ad557eb62776d3dbeda877cf5`; its Crowd runtime is
unchanged from `6570166`. The main performance and quality reports carry source fingerprint
`fd15caaa60526cf024e2ad196752b3231365e50e775f4dc1f1a6b2768a4460a1`
and verify that the source did not change during each run. The evidence is in
[`baselines/frame-20260926`](../baselines/frame-20260926/); previous baselines
remain unchanged. The source ZIP preserves executed bytes independently of Git
checkout line-ending conversion. After those measurements, the recorder export
was extended to retain nonfinite and proxy-penetration audit failures and the
audit return type was made explicit. This does not change simulation, clock or
rendering behavior; later backend/trace reports identify that source separately.
`candidate-source.zip` remains the original measured source, not an overwritten
copy of subsequent edits.

### Same-machine no-input comparison

Each cell below is the median of three run-level step P95 values, audit OFF,
ticks 30–179 of the real HTTP application. The short interval establishes the
no-input regression comparison, not the final ten-second frame acceptance.
All rows retained their requested active population. Baseline and candidate use
the same browser/CPU/settings; candidate changes include frame scheduling and UI
hash deferral, so this is a combined-build comparison rather than LOS alone.

| Scene | Active agents | Baseline step P95 | Candidate step P95 | Change |
|---|---:|---:|---:|---:|
| open-field | 1,000 | 1.8ms | 1.5ms | −16.7% |
| open-field | 10,000 | 15.1ms | 12.9ms | −14.6% |
| open-field | 20,000 | 31.4ms | 28.2ms | −10.2% |
| rocky-pass | 1,000 | 3.6ms | 2.7ms | −25.0% |
| rocky-pass | 10,000 | 28.8ms | 20.2ms | −29.9% |
| rocky-pass | 20,000 | 58.1ms | 41.0ms | −29.4% |

The +10% no-force regression gate passes on these six comparisons. CPU callback
and RAF distributions, all repeats and phase boundaries remain in the raw files.

### Whole-frame external-input result: FAIL

Audit OFF, seed 42, ticks 30–659 (10.5 simulation seconds), existing UI input at
tick 30, all 10,000 agents active throughout. CPU is callback work including the
real renderer/recorder/UI; RAF intervals are not a GPU-completion measurement.

| Scene / input | Frame CPU P95 | RAF P95 / P99 | Step P95 | sim/wall | >100ms frames | >50ms fraction |
|---|---:|---:|---:|---:|---:|---:|
| open-field blast | 17.4ms | 33.3 / 33.4ms | 16.2ms | 0.9013 | 0 | 0.16% |
| open-field wind | 18.2ms | 33.3 / 33.4ms | 17.0ms | 0.8975 | 0 | 0.00% |
| rocky-pass blast | 89.6ms | 100.0 / 116.7ms | 88.2ms | 0.2302 | 14 | 88.10% |
| rocky-pass wind | 95.2ms | 100.0 / 116.7ms | 93.6ms | 0.2254 | 24 | 92.54% |

Every row fails the simultaneous 16.67ms CPU / 16.9ms RAF / 0.98–1.02
sim/wall criteria. These are one performance run per condition, sufficient to
reject this candidate; the required final three-repeat/two-seed acceptance was
not claimed. Input-onset spikes, other phases and raw samples remain in
`active.json.gz`. Rocky contact work still needs a substantial solver/throughput
change; scheduler catch-up cannot compensate for this cost.

Three lightweight clock observations with 1,000 initially spawned open-field
agents reached sim/wall 0.99846 / 0.99846 / 1.00004, RAF P95 16.7–16.8ms and no
>50ms frame. Agents reached the goal (minimum active 306), so these establish a
lightweight timing observation, **not a sustained-active-1K performance gate**.
Fixed-cadence force integration is separately covered by the automated tests.

### Independent quality evidence

Rocky-pass UI blast/wind used the actual canvas handler at tick 30, the existing
radius-100 input, seed 42 and seed 7, 10,000 spawned and active agents, and 660
ticks per run. The 66 independent all-neighbor audits per run inspected published
positions every ten ticks. All four runs had maximum published penetration
0.449999px or less, zero sampled wall overlap/nonfinite state and zero runtime
candidate saturation, unresolved compression or exhausted stabilization budgets.
The latter diagnostics cover every substep; they are solver-dependent and are
not an independent proof of every intermediate path.

The independent chord-sweep diagnostic still reports 2–4 grazing candidates per
audited tick at its 0.01px threshold, with maximum chord penetration of
0.525607 / 0.682453 / 0.604990 / 0.910026px for blast42 / wind42 / blast7 / wind7.
A chord across a curved collision response can intersect another body even when
the actual path avoids it. These observations remain unresolved path-coverage
work, not a claim of zero tunneling. The small exhaustive high-speed/crossing
fixtures pass, but do not establish the full 10K trajectory guarantee.

A separate rocky-pass prescribed-circle diagnostic used radius 18, 240px/s,
seed 42, ticks 0–179, motion during 30–119 and removal at 120:

| Actual/minimum active agents | Max sampled agent penetration | Max sampled proxy penetration | Runtime walls / saturation / unresolved compression |
|---:|---:|---:|---|
| 1,000 | 0.108320px | <1e-12px | 0 / 0 / 0 |
| 10,000 | 0.449991px | <1e-12px | 0 / 0 / 0 |
| 20,000 | 0.449991px | 0.158729px | 0 / 0 / 0 |

These diagnostic runs include independent audits, so their step times are not
performance acceptance results. Their source/configuration, every-tick diagnostic
peaks and sampled worst-pair witnesses are retained in `proxy-*.json`.

Retained contact scratch reached 19,593,068 bytes in the four 10K UI runs and
32,369,356 bytes in the 20K proxy diagnostic. This includes reserved WASM memory;
it excludes the other owners described above and is not an allocation/GC study.

### Kernel and tracing diagnostics

At the later source fingerprint
`c05c69693c6a8518e8b919006b4256b3f4237bfc33ed001c1b72d4bf4db60832`
(`backend-source.zip`), three rocky-pass 10K wind runs per backend, ticks 30–179,
audit OFF, gave median step P95 98.8ms in JS and 71.6ms in WASM (27.5% lower).
All six final state hashes were `550633d6`. Hash equality is supporting evidence;
the small mixed-radius regression separately compares all state bytes. This is
a short backend comparison, not the ten-second final frame gate.

A separate CDP profile still places native velocity and position projection,
pair generation/spatial queries and warm-contact preparation among the largest
costs. `contact.cpuprofile.gz` retains the profile; `final-profile.json.gz` retains
the associated profiled execution and is excluded from performance acceptance.
The profiler includes initialization and recovery as well as the force interval.

Tracing ON/OFF was compared in three lightweight 660-tick wind runs per setting.
The same declining population and fixed input were used, so this is an overhead
observation only. Full CPU/RAF samples and state hashes are in `clock.json.gz`
and `trace-off.json.gz`; no zero-overhead or all-population bound is inferred.

### Exact native pair-pass follow-up

The next candidate moves exhaustive center-first pair generation, immutable
pair geometry, displacement bounds and residual-compression checks into the
existing f64 kernel. Pair order and all current physical iteration/force/step
limits are preserved. Capacity misses retry the complete query after growth;
the original global capacity failure remains explicit. Native arrays are shared
with the host and are counted once in retained-memory diagnostics.

Source `2a24fc671be354e4466a5f1d5a816f9c0109f3c2f2bdef669feb6e79302e8d00`
is preserved in `native-source.zip`. Three rocky 10K wind runs, ticks 30–179, audit
OFF, gave step P95 63.0 / 63.8 / 64.4ms (median 63.8ms, compared with 71.6ms for
the previous native candidate). This is a short exact optimization comparison,
not a newly passed whole-frame gate.

The complete follow-up verify passed 209 tests, typecheck and production build;
the three affected browser tests also passed.

The recorded UI wind and blast inputs were also replayed against the archived
previous candidate for 660 ticks each, with 10,000 agents. Every tick compared every
byte of both current and previous AgentBuffers, direct/affected flags and state
hashes, followed by the complete command record. Both runs had zero mismatches
(858,000,000 state bytes compared per run). `byte-wind.json` and `byte-blast.json`
identify both source fingerprints and retain every tick hash. The reference
module is required to be distinct from the candidate module. These headless
comparisons are not timing or independent geometry audits.

An additional attempt to move the warm-impulse tables into native memory was
rejected: median mean step time rose from 48.68ms to 49.59ms, while P95 was nearly
unchanged. Its raw result and source are retained as `native-warm.json.gz` and
`rejected-native-warm-source.zip`; the current implementation keeps the prior
cache ownership. An instrumented relative-speed planner probe also showed that
simply removing the ordinary-speed upper bound could affect only 88 of 630 wind
ticks before considering stronger wall bounds, so this is not a demonstrated
solution for the expensive recovery interval.

To repeat the byte comparison, extract the `src/` tree from `backend-source.zip`
into an isolated directory and run:

```sh
npx vite-node scripts/compare-frame-state.ts --reference=test-results/native-reference --mode=wind --ticks=660
npx vite-node scripts/compare-frame-state.ts --reference=test-results/native-reference --mode=blast --ticks=660
```

### Adaptive contact trial and exact index reuse

The next candidate fixes a friction-release energy defect and verifies a cheaper
temporal resolution before publishing it. A shrinking friction cone could force
a cached tangential impulse to be released against the current slip. That update
could increase kinetic energy even without input. When that happens, the normal
and tangent impulse update is shortened to the energy minimum on the segment
between the old and proposed feasible impulses. The segment stays in the convex
friction cone. A new 64-body wall-bounded, multidirectional impulse fixture checks
monotonic energy and the original compression limit without relaxing either.

When the conservative response reserve suggests two substeps but actual input
speeds fit the half-radius travel bound, the solver tries one. It checks solved
velocities before motion; excessive concentrated speed selects two intervals.
If any attempt exhausts position stabilization, its unpublished result is
discarded, warm/activation/correction state is restored, and finer subdivisions
are tried from the same tick input. There are at most five attempts and at most
16 intervals in an accepted attempt; `attemptedSubsteps` includes discarded
intervals and can exceed 16. A failed attempt stops after its first exhausted
interval. External forces and voluntary prediction run once.
`substepRetries`, `rejectedTrialBudgetExhaustions` and
`rejectedTrialPenetration` retain discarded work; accepted residual diagnostics
stay separate. All actual CPU work and pair/iteration work remain measured.

The four rocky 10K blast/wind runs (seed 42/7, 660 ticks each) had published
penetration ≤0.45px, sampled walls/nonfinite values 0 and accepted unresolved
compression 0. Wind42 rejected one trial with 2.946450px compression and accepted
the retried result. Every retried tick receives an independent audit. A 660-tick
JS/WASM replay exercised the same retry in both implementations, comparing
858,000,000 AgentBuffer bytes and 56,057,875 exact finite warm-cache values, with
zero mismatches. These quality records use source
`8199ef2a1b4157a1711a832dc1351093a138e4fa9929c9030e1a04c8bd57bd7b`.

Collective position groups now share a frozen spatial index during their
attempts. Queries expand by the largest body displacement from the index's
anchor positions; exact current-position tests still determine the full
frontier. The caller receives a fresh index after the group batch. An exhaustive
frontier fixture covers dense groups, overflow and cell crossings. Full-state
wind/blast comparisons also found zero differences from the earlier candidate.
Native pair construction additionally skips the suffix of descending IDs once
pair ownership proves it irrelevant. `pairOwnershipSkips` distinguishes those
IDs from the full query population; `pairCapacityRetries` reports buffer-growth
retries. Neither optimization caps the physical frontier.

At source `d6b9cbfa3c3c1223dbf850f13c5ae20f093a85aa7381814ad028de995b125fa8`,
three real HTTP runs per input (rocky 10K, seed42, ticks30–659, audit OFF) gave:

| Input | Earlier adaptive frame CPU P95 median | Batched-index frame CPU P95 median | sim/wall median |
|---|---:|---:|---:|
| wind | 85.0ms | 72.5ms | 0.3496 |
| blast | 79.1ms | 67.5ms | 0.3619 |

The first wind run averaged 5.47 index rebuilds/tick, down from 32.16 before the
batch, with the same simulation state. Owned retained contact capacity peaked
at 29,492,940 bytes; that includes the trial checkpoint and reserved native memory,
with the exclusions stated above. Seed7 was independently re-audited after the
exact changes: both inputs remained ≤0.45px with walls/nonfinite values 0.
**The whole-frame/real-time gate still fails.** These improvements do not justify
closing issue #33 or hiding the earlier failed candidates.

The 20K rocky moving-proxy audit exposed a later failure at tick161: a two-step
attempt left 1.8455px compression inside its first interval, although the final
published endpoint had recovered. General refinement now discards such attempts.
The same input accepted 16 substeps after three rejected attempts (19 intervals
actually computed), with accepted unresolved compression 0. A separate 180-tick
JS/WASM replay compared 468,000,000 AgentBuffer bytes and every warm-cache value
without differences, including all three retries. `refined-proxy-20000.json` and
`refined-proxy-byte.json` preserve this evidence. Intermediate paths still need
independent verification; runtime residual checks alone do not establish it.

At source `53c72faae223ed144b7624873148c7eac8df998b2540a9005d5a412bd6f7e9db`,
all six real HTTP flat 10K runs (blast/wind, seed42, three repeats each) met the
frame gate over ticks30–659 with all 10,000 agents active. Median frame CPU P95
was 13.7ms/14.4ms, RAF P95 ≤16.8ms, RAF P99 ≤16.8ms, no >50ms RAF frames, and
sim/wall 0.9922/0.9953 over 10.55–10.59 seconds. The rocky gate remains failed.
One flat 1K blast reproduction also passed its short timing check; its 2.52-second
window does not count as final acceptance. Raw frames and executed source are
in `refined-flat-performance.json.gz`, `refined-1k-blast.json.gz` and
`refined-source.zip` in the existing evidence folder.

The #32 flat matrix was run at the batched source: few-target impulses, blast,
global impulse, moving proxy and overlapping inputs at 1K/10K/20K. All 15
independently sampled quality cases passed (120 ticks; audit every10 plus any
retry/exhaustion). Agent penetration was 0, proxy penetration ≤0.000516px,
walls/nonfinite/unresolved compression 0, and the proxy affected 41–55 bodies.
Audit-OFF three-repeat median step P95 ranged 1.99–3.01ms at 1K, 15.35–21.63ms
at 10K and 32.62–44.36ms at 20K, within the historical 20/120/240ms headless
budgets. This is separate from #33's whole-frame gate. The 50K blast exploration
also passed sampled quality while retaining all 50,000 agents. `matrix-*` records
carry source identities; their historical source hash uses `src/...` paths,
whereas frame/diagnostic records use `/src/...` paths. Do not compare these hash
strings without accounting for the stated format.

An audit-OFF rocky proxy replay includes the difficult recovery tick161: 180
ticks, motion30–119, removal120, three repeats at 10K and 20K. All requested bodies
remained active. Median step P95 was 53.1943ms/107.6430ms, within the #32 historical
120/240ms budgets, with accepted unresolved compression 0. The 20K three-retry
tick cost 929.7–952.4ms in the contact phase alone. Its single outlier falls above
P99 in this short run and must not be hidden by the percentile gate. The raw
`refined-rocky-proxy-performance.json` preserves every peak counter and the cost
of discarded trials. It is not a #33 frame acceptance result.

Two subsequent exact position optimizations were rejected. A displacement-
certified pair subset resumed the original ordered suffix immediately when a
correction invalidated its frontier. A second experiment reused conservative
empty-disk travel budgets inside the native position pass. Both matched every
state byte and warm value through the 660-tick wind replay. Nevertheless the
subset's three-repeat wind/blast CPU P95 medians were 73.7/68.9ms versus
72.5/67.5ms before it; the travel-budget experiment's first wind run was 77.4ms.
The added filtering/bookkeeping did not pay for itself. Neither remains in the
runtime. Their executed source and raw results are retained under `rejected-
position-*` in the same evidence folder.

### Verification and remaining gates

The complete type/test/build check passed 205 tests and the browser suite passed
32 tests. After the recorder-export correction and three additional regression
fixtures, typecheck and all 44 tests in the affected external/cache/recorder
suites passed. The new cases cover explicit pair-budget rejection before state
publication, impulse-basis rotation and exported nonfinite failures. Additional
exact checks compare every AgentBuffer byte and hashes
between JS/exhaustive geometry and WASM/cached geometry through mixed radii,
external input, goal edits and obstacle edits. Fixed-clock tests cover
30/60/120/144Hz, jitter, pause/reset, speed changes, failed steps and explicit
lost-time accounting. Regression fixtures cover zero-input energy amplification,
stationary-proxy rebound and scaled-wall roundoff.

The refined candidate passed the complete type/test/build check with 214 tests.
Three affected browser tests passed before general refinement; that later change
does not alter UI handling. The subsequent full-history capacity regression
passed separately, as did typecheck and the session measurement script syntax
check. Remaining work is the rocky 10K whole-frame throughput gate, final three-
repeat/two-seed simultaneous acceptance, and review/integration. Keep the stated
intermediate-path audit limits visible when assessing physical acceptance.
The kernel/workset changes do not make those remaining gates optional.
No population, input force, radius or fixed delta was reduced to manufacture a
pass. Neither issue should be closed from the sampled quality improvements alone.

The required physical scenarios map to the following regression evidence. These
small-scene checks and the large sampled matrix have different coverage; a test
count alone is not the physical acceptance argument.

| Contract | Regression evidence |
|---|---|
| Impulse calibration, one-shot input, sustained integration | `external-influences.test.ts`: weak momentum without motor control; fixed-tick acceleration/end/cancel; deduplication |
| Blast/wave direction, falloff and lifetime | deterministic center direction and linear falloff; a wave hits each target once |
| Chains, mixed radii and energy | randomized approaching contacts, mixed-radius crossing, dense multidirectional wall-bounded energy test |
| Thin walls and removed normal velocity | swept thin-wall test; no transmission through the wall; static sweep/index unit regressions |
| Dynamic crossing | small all-pair penetration audit and mixed-radius no-side-swap crossing fixture |
| Recovery and new goals | four-second 95% recovery; repeated hits/new goal without a position jump; displaced-navigation corner regressions |
| Moving/stopped/removed proxies | continuous prescribed motion, stationary follow-up tick, removal, and the wall-authoritative crush fixture |
| Overload and finite state | full candidate fallback, explicit global pair-budget rejection before publication, combined speed limit and nonfinite rejection |
| Field feedback | `crowd-flow-solver.test.ts`: physical knockback versus voluntary alignment; mass/momentum conservation; thin-wall masks |
| Replay, pause/reset, render cadence | exact sorted-input arrays/hash, fixed-clock cadence tests and browser external-input/clock tests |
| History lifetime | 4,096 accepted records, idempotent old retransmission at capacity, atomic overflow rejection, stale-generation rejection and reset reuse |

The cases above are in [external simulation tests](../tests/simulation/external-influences.test.ts),
[field tests](../tests/unit/crowd-flow-solver.test.ts),
[displaced navigation tests](../tests/simulation/displaced-navigation.test.ts) and
[browser tests](../tests/browser/external-influences.spec.ts). Large-scene chord
audits are a diagnostic approximation: grazing chords do not prove that a
piecewise swept path crossed a body, and endpoint safety does not prove every
intermediate path safe. Keep that coverage limit alongside the raw results.

### Session memory and input history

`scripts/measure-session.mjs` runs the real HTTP main loop with Chromium heap
allocation sampling enabled, changing goals through the Canvas handler every
tick for the first 4,096 ticks and then periodically, with periodic UI wind.
The 12,000-tick session kept all 1,000 agents active and recorded 4,262 commands.
The lifetime measured count remained 12,000 while timing/pass samples stopped at
10,000 and the frame trace stopped at 4,096. Owned contact capacity peaked at
2,579,948 bytes and stayed there from tick 1,000 through 12,000. CDP backing storage
was 6,213,103 bytes at all four sampled running checkpoints. Post-GC used heap
rose from 4,562,244 at tick 1,000 to 5,208,120 at tick 12,000, including the intentionally
retained command log and bounded recorder rows.

Three reset/1,000-tick rewarm cycles cleared external history, pending inputs and
effects to 0 at each reset. Backing storage returned to about 4.19MB, then 6.21MB
after rewarm. Rewarmed used heap was 4.588/4.604/4.611MB; the small drift is not a
proof of zero allocations or zero leaks. No page errors occurred. The source and
raw snapshots are `session-source.zip` and `session-memory.json.gz`; the full
allocation profile is `session-memory.heapprofile.gz`.

Sampling estimated 32.59GB of allocation over the combined long run and reset
cycles, including objects collected by minor/major GC. Large allocation stacks
included contact solving and FlowField potential/direction iteration during
thousands of goal rebuilds. This is an allocation estimate under instrumentation,
not an exact allocator count or a normal-user allocation rate. The sampler and
explicit paused GC make this a memory/history diagnostic, not performance
acceptance. It does not establish long-session dense 10K throughput or attribute
an individual long frame to GC. The earlier dedicated CPU profile observed GC
samples, but similarly does not establish per-frame GC causality.

Reproduce with `node scripts/measure-session.mjs --url=http://127.0.0.1:4275`.
The separate full-history test exercises all 4,096 external records (the UI goal
log is a different store), rejects overflow without mutation, accepts an
identical old retransmission, then verifies reset and stale-generation behavior.


### Colored shared-memory contact workers

The worker candidate orders the complete contact list into stable greedy edge
colors. Endpoints within one color are disjoint; colors run sequentially, and
each color is split into contiguous ranges across the main thread and at most
three workers. A 64-color overflow retains the complete original pair order and
uses the scalar path. No contact is dropped. This changes the original solver
order, so the new equivalence reference is the same colored TypeScript solver.

Workers share f64 linear memory and scalar operation order. Static-wall queries
remain authoritative on the main thread: swept velocity worksets are classified
before parallel execution, and unsafe position corrections are deferred until
the color barrier. The main thread drains those corrections before the next
color. Memory growth preserves the fixed control prefix; one arena owns all
shared state. Workers sleep between frames and use bounded one-second watchdogs
inside synchronous phases. A failed phase stops the pool, discards its shared
arena and partial state, restores the attempt checkpoint, and recomputes the
same tick through the CPU path without applying the external input twice.

Browser support requires cross-origin isolation, SharedArrayBuffer and workers.
The Vite development and preview servers set COOP `same-origin` and COEP
`require-corp`; other hosts must supply them. Unsupported environments retain
scalar WASM/TypeScript. Simulation steps prewarm the pool before an external
input. Replacing a simulation requires `dispose()`; the app does this on reset
and comparison. A worker failure leaves that simulation on the CPU fallback;
creating a new simulation permits workers again. `workerThreads` reports ready
capacity, while `parallelPasses` proves actual execution. Failed-attempt time is
reported separately and is already included in overall contact/frame time.

The 660-tick rocky 10K wind replay compared 858,000,000 state bytes and
54,776,215 warm values with the isolated colored JS reference: no mismatch,
27,122 parallel passes, all 10,000 agents active. Separate injected failures
before velocity and during the third position pass both recovered exactly.
A rocky 20K moving-proxy replay compared 468,000,000 bytes through 180 ticks;
independent sampled penetration was at most 0.449991px, with zero wall overlap,
nonfinite values or mismatches. The four colored 660-tick wind/blast quality
runs (seeds 42 and 7) also remained within 0.45px. These are quality/equivalence
checks, not RAF performance measurements.

Actual HTTP RAF runs at 10K, seed 42, 660 ticks and three repetitions reduced
wind/blast CPU P95 medians from the previous 72.5/67.5ms to 56.81/55.68ms.
Simulated/wall time remained about 0.43: **the 60Hz gate still fails**. Restricting
geometry preclassification to the velocity workset gave 57.105ms in one wind
run, with no demonstrated further gain. A main-thread CPU profile still finds
pair construction and position solving dominant; worker CPU is outside that
profile. The current source is `worker-workset-source.zip` and measurement
source hash `e3807926aaa92c63ad9bf6893ec4cacc6af3a662f98caf397c27ff74edc41294`.

The full generated-source/type/test/build verification passed 217 tests; four
production-preview browser tests passed, including three reset/rewarm cycles
with every old worker closed. The earlier full flat matrix, no-force comparison
and long-session memory results predate the new coloring/worker path and must
not be treated as final validation of it. Final matrix, memory/copy accounting
and repeated two-seed simultaneous acceptance remain required.

Scalar f64x2 SIMD experiments preserved exact state but did not improve the
three-repeat frame measurements; a 1.5 position over-relaxation experiment
increased convergence work. Both were removed. Their source and raw evidence
are preserved with the worker evidence in `baselines/frame-20260926/`.


### Parallel candidate construction and collective convergence

Pair generation now partitions agent ownership across the ready contact workers.
Each chunk receives the full global pair capacity, so a dense cluster entirely
inside one chunk does not encounter an artificial fraction-of-capacity limit.
The main thread concatenates chunks in original agent order, checks the total
against the global capacity and retries after growth on an explicit overflow.
The skewed browser fixture compares every pair and diagnostic counter with the
scalar query (2,415 pairs, including a deliberately insufficient 32-pair buffer).
Actual 660-tick state/warm equivalence and injected pair-phase failure recovery
also pass. Two scratch ID arrays reserve four times the global pair capacity;
these are included in reported kernel/retained bytes, not hidden worker copies.

Dense collective repairs now begin after the minimum four ordinary position
passes. Up to 512 group attempts per round, for at most four consecutive rounds,
finish a nearly converged repair before returning to local sweeps. Every round
retains the exact swept frontier/static checks, rebuilds the complete pair list
and checks the published positions. Failure resumes the existing bounded local
solver and finer-substep retry. Population, force, radius, dt, minimum local
iterations and penetration thresholds are unchanged. `projectionPasses` and the
existing attempt/group/candidate counters expose this extra work.

The residual probe explains the change: at several long wind ticks, a group
pass left only one or two violating pairs, but the following ordinary sweeps
redistributed compression over hundreds of pairs. More group attempts alone
reduced cost yet retained >100ms stalls; consecutive bounded group rounds
removed those stalls in the first measured run. The probe is a diagnostic on
the archived `wide-projection-source.zip`, not performance evidence.

With source hash `c9f72338dcea8b59c219ccb1415029d8b8730cca336e7d14edc3dc094c24d2a2`,
one audit-OFF 660-tick rocky wind run measured CPU P95 29.475ms, sim/wall 0.58881,
zero >100ms pauses and >50ms ratio 0.001588. **60Hz still fails**, and one run is
not the final repeated gate. Four separate audit-ON runs (wind/blast, seeds 42
and 7) stayed below 0.449998px penetration with zero walls/nonfinite values.
A 660-tick wind worker/JS comparison matched 858 MB of state and 55,844,375 warm
values; a 20K proxy replay matched 468 MB through 180 ticks. The complete
217-test/type/build/generated-source verification passed. Current source/raw
results are under `residual-rounds-*`; the earlier 16/128/512-attempt variants
are retained as source-identified comparisons, not interchangeable results.
The original complete #32 matrix predates this structural change and remains
a historical comparison until the final matrix is rerun.
