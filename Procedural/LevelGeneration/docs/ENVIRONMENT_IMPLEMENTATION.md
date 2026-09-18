# Environment implementation — issues #16–#27

Scope: `Procedural/LevelGeneration`. Baseline `381fb0b94d40bb077ce8953e12e978ec2e50f1d5`.
The latest issue bodies and comments were fetched on 2026-09-17. Local reference snapshots are in the repository's `.git/environment-issues/` (not shipped).

## Decisions and dependencies

- Input/document contract is schema 5 / environment-plans-v1 / SceneInputs 2. No migration or old document dispatch.
- The banded style **format and validator** from #22 were pulled into #17 because #17 must reject previous styles. Vertical algorithms remain in the prescribed #22 slot. C07's dedicated geometry was subsequently completed in #23.
- Contextual rule and adapter are now implemented. Earlier development slots used explicit `ENV_PIPELINE_NOT_READY` errors instead of successful empty output. Complete execution refuses unfinished stages; development preview explicitly identifies each unfinished/blocked stage.
- #25 adds a proven geometric upper-bound filter to #19's existing ordered descriptor evaluation: connecting/reserving can only remove bays, so a descriptor strictly below an already fully validated best cannot win. Every such descriptor receives `PROVEN_POTENTIAL_DOMINATED` with both bounds; ties still receive full proofs. The allocated quotas/tickets and candidate order are unchanged; only started expensive graph trials consume tickets. This is not a time cutoff or relaxed safety condition.
- Existing untracked `.codex-remote-attachments/` is user-owned and untouched.

## Progress

| Issue | Implementation / verification |
| --- | --- |
| #17 | Current input/settings/design/adapter references; strict load; preserved intent on support loss; union clipping; open-deck actual output containment. Typecheck and 21 focused tests passed (document/buildings/rules/environment-document/spatial-adapters/style). Runtime publish rejection is connected through #26. |
| #26 | Single document execution, one analysis, preflight before generate, explicit stage reports, supported real structure plus separate input/plan overlays. Typecheck; five pipeline/rule tests; production build; one actual JSON→Viewer browser regression passed. Screenshot inspected. Invalid load preserves displayed result and saved accepted document. |
| #18 | Support graph, deterministic multi-source BFS, actual body/sweep clearance, bounded spatial relations, priority reservations, certified crossings. 30 focused tests passed after adapting the road ownership regression; two pipeline/spatial browser cases passed. |
| #22 | Proportional bands, absolute anchor phase, complete pattern groups and real local cap/belt edges. 15 focused tests and H1/H2/H12 Viewer regression passed. Dedicated C07 geometry is verified under #23. |
| #27 | Parking union/difference commands, settings/design edits, source input selection, lazy common Inspector, no-op and edit telemetry, atomic history. 16 focused tests; seven environment/object-area browser cases passed after fixing Redo cursor advancement. |
| #19 | Vehicle footprint/4×4 sweep, parent U_i protection and quota/ticket allocation, gate/strip/corridor/crossing plans connected to Viewer and Inspector. Nine focused tests plus real R12 circulation browser case passed. |
| #20 | Common candidate access/count/gap/role plans, actual single/paired portal descriptors, contextual rule + preflight adapter and facade consumption. Eleven focused tests and actual portal/road-removal browser case passed. |
| #21 | Reused base graph + two BFS passes and at most 16 local states per candidate; stall reservations, exact area/candidate accounting, actual shared paint/arrow geometry. Thirteen focused tests + real R12 browser case passed. R12=18, R30=96, L16=19, O30=86, D12=36; all aisle ratios within target and untested=0. Report: benchmarks/parking-quality.json. |
| #23 | Real row-specific base/body/crown openings/piers/plinth/frieze, clear portals, cut straight trims and unique convex/concave terminals. Twenty-one focused tests; two gallery + current edit/history browser regressions passed; gallery screenshot inspected. Raw voxel and inter-trim volume checks pass. |
| #24 | Context-derived absolute slots, public/local/service clearance, nonrecursive spacing, clusters, companion traces and 13 authored prototypes. Thirteen focused tests and actual facility/road-removal browser regression passed; screenshot inspected. |
| #25 | Complete: shared 64-entry/16MiB FIFO, parking logical-budget replay, current facade trace reconstruction, compiled motion domains, exact indexed envelope clipping, application-cold/warm/real drag measurement. Cache/reference and positive parking regressions pass. All 16 final production cold/warm/independent-first-edit distributions pass, including dense32³ cold458.7ms/warm214.9ms p95 and R30 road-add148.4ms (150ms limit). Failed earlier raw samples remain separate evidence, never substituted for acceptance. |

## Final verification

- `npm run verify`: typecheck, 153 tests in 33 files, production build passed.
- `npm run test:e2e`: all 23 browser regressions passed. Current screenshots are in `benchmarks/screenshots/`; they are inspection evidence, not frozen-output golden tests.
- `npm run build` followed by `npx playwright test e2e/environment.spec.ts --grep @measure`: all 16 distributions passed, with 470 measured samples and 50 separate warm-up runs. The complete p50/p95/max table, machine/build identity, protocol and failed earlier evidence are in [benchmarks/README.md](../benchmarks/README.md).
- `git diff --check`: passed. No unrelated project files or user attachments are included. Remote main commit and issue closure records are reported in GitHub #16–#27 after push verification.

## Safety and optimization notes

- Every execution validates rule/adapter registration, runs preflight and checks actual output containment, including cache hits.
- Immutable document/analysis identities only accelerate lookups within the same bounded FIFO. Mutable callers still validate through canonical content; no extra unbounded result cache exists. Current facade/fixture/attachment traces are rebuilt.
- Vehicle domains use the same full footprint/sweep model and deterministic transition order as the reference graph. A decrease-key radix queue and indexed occupancy reduce work without altering clearance.
- Secondary-gate candidates compare against the same validated primary plan, retain at most two gates, and must improve maximum exit distance for the primary reachable states by at least four. Each trial uses the existing protected parent ledger.
- Canonical serialization delegates JSON assembly to the runtime after sorted normalization and finite-number validation. Integer property names retain lexical ordering through an explicit fallback. Input/history signatures remain included in performance timing.
- Geometry/material instances are shared; optional debug overlays are lazy. Accepted document/history publication and visible Viewer synchronization remain inside each measured transaction.

## Parking acceptance

| Fixture | Validated stalls | Minimum | Aisle ratio | Maximum | Untested |
| --- | ---: | ---: | ---: | ---: | ---: |
| R12 | 18 | 8 | 30.56% | 60% | 0 |
| R30 | 96 | 40 | 42.67% | 60% | 0 |
| L16 | 19 | 10 | 31.25% | 65% | 0 |
| O30 | 86 | 32 | 43.32% | 65% | 0 |
| D12 | 36 (18 each) | 16 (8 each) | 30.56% each | 65% each | 0 |

All accepted stalls have entry, exit and walking proofs. Exact input, excluded/eligible/vehicle/walk/stall/unallocated area, rejection reasons, and protected/used budget are retained in `benchmarks/parking-quality.json`. The roadless negative control has zero stalls and `NO_ROAD_GATE`; it is not a positive usefulness success.

## Scope of verification

Acceptance is for the specified integer-cell model and span32. Physical vehicle dimensions/meters per cell, terrain/stairs, multi-level ramps, indoor access and jurisdictional regulations are explicitly outside these issues and have not been validated. No unfinished feature within #17–#27 is represented by a placeholder or a previous algorithm.
