# Repository guidance

## Scope

- The active project is `Navigation/Crowd`; run its commands from that directory.
- Preserve existing working-tree changes and keep edits within the requested feature or fix.

## Navigation invariants

- Every scenario must use the same navigation-direction selection policy.
- Do not select or bypass a navigation algorithm based on scenario ID, obstacle count, flow count, or another map classification.
- A line-of-sight direct-goal contribution must be decided by the shared local inputs—density, counter-flow, and static clearance—and blended with the field direction through the common `FlowField` path.
- Scenario geometry and flow goals may change navigation data, but they must not change which direction-selection algorithm runs.
- Protect this invariant with regression coverage spanning obstacle-free, obstacle, and multi-flow scenarios when direction selection changes.

## Canonical checks

- Use `npm run verify` for type checking, unit/behavior tests, and the production build.
- Use `npm run test:e2e` for browser regression coverage.
- For navigation performance or quality changes, also run `npm run measure`, `npm run measure:flows`, and `npm run measure:quality` as appropriate.

## Completion

- Preserve determinism, bounded contact work, static collision safety, and `wallOverlapCount = 0` in affected scenarios.
- Stop when the requested behavior and its focused regression pass; report unrelated observations without expanding scope.
