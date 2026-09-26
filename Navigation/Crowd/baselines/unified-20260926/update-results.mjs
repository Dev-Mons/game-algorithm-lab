import {readFileSync,writeFileSync} from 'node:fs';
const path='docs/external-forces-results.md',old=readFileSync(path,'utf8');
const s=JSON.parse(readFileSync('baselines/unified-20260926/summary.json','utf8'));
const rows=s.timing.map(r=>`| ${r.agents.toLocaleString('en-US')} / ${r.mode} | ${r.frameCpuP95Median.toFixed(2)}ms | ${r.recoveryP95Median.toFixed(2)}ms | ${r.simWallMedian.toFixed(3)} |`).join('\n');
const geometry=s.geometry.map(r=>`| ${r.agents.toLocaleString('en-US')} / ${r.mode} | ${r.maximumPenetration.toFixed(3)}px | ${r.finalPenetration.toFixed(3)}px | ${r.maximumWalls} / ${r.maximumNonfinite} |`).join('\n');
const intro=`# External forces results and limits

## Current common crowd path — 2026-09-26

External inputs now change physical velocity and pass through the same crowd
movement solver as ordinary motion. The previous global external mode and its
sticky affected flags, warm state, retries and full-population substeps are gone.
All measured ticks retain the 24-candidate / 8-contact / 8-iteration budgets.
No blast left a continuing input after its one-shot tick. Actual populations stayed
at 6,000/10,000 in every measured frame and quality run, with no runtime errors.

Current runtime SHA-256: \`${s.currentSource}\`.
The performance, geometry and isolated-input source hashes agree and stayed stable.
Evidence and summaries: [unified-20260926](../baselines/unified-20260926/summary.json).
The source and old baselines under reference-20260926 remain preserved.

### Actual HTTP frame measurements

Same Ryzen 9 9950X3D / Chromium ${s.conditions.browser}, seed42, default radius3.2
and dt1/60, scaled rocky-pass, actual UI radius100/speed400 blast at tick30.
Each case has three 360-tick runs, audit OFF. Values below are the median of three
run-level P95s; recovery is ticks120–359. The final harness pause/hash frame is
excluded. CPU timing includes the ordinary app clock, renderer and recorder.

| Population / input | Frame CPU P95 | Recovery CPU P95 | Simulated / wall |
|---|---:|---:|---:|
${rows}

The immediately preceding TypeScript external-mode implementation measured 31.40ms
at 6K and 54.40ms at 10K for the same three-repeat single-blast setup. The common
path measures 16.10/25.30ms. These are intentionally different movement models,
not bit-identical optimizations. The comparison does not hide the changed quality
contract below. No measured acceptance RAF interval exceeded 100ms.

The 10K no-input P95s were 25.2, 25.7 and 32.7ms; the slow run is retained.
**10K is still CPU-bound without any force and is not a 60FPS result.** The blast
does not add a sustained global mode cost; ordinary scene cost remains. Clock
debt, dropped/clamped seconds and all raw frame/step records are retained.

### Isolated one-body input

Separate headless diagnostics use 6,000 bodies in open-field, deliberately relocate
one body 1,362.5px from its closest neighbor at tick30 in BOTH cases, and apply a
radius10/speed400 blast to that one body only. Across three repeats, the median of
the first30-tick mean CPU times is **8.10ms without input / 8.35ms with the blast**.
Exactly one body is directly hit in every blast run; the contact budgets stay fixed.
This is simulation CPU, not browser FPS. The previous diagnostic's 7.82/14.82ms
values were single runs and are retained as context, not a three-repeat comparison.
A separate state test verifies that a distant untouched crowd stays byte-identical;
another verifies 120 ticks of API impulse versus directly assigned physical velocity.

### Observed quality and changed guarantees

Separate audit-ON HTTP runs cover 6K/10K × none/single/repeated blast, 660ticks,
seed42, with independent geometry sampling every10ticks (66 samples per row).
Repeated blasts occur at30/60/90. All rows retain their full populations.

| Population / input | Maximum sampled overlap | Final overlap | Walls / nonfinite |
|---|---:|---:|---:|
${geometry}

The ordinary fixed-work crowd model permits residual compression to relax over
multiple ticks. **The previous external-v2 global 0.5px threshold is not met and
is not claimed.** Circle tools are local push brushes, not infinitely rigid bodies.
Strict monotonic kinetic energy is likewise not an XPBD overlap-repair guarantee;
small pushed-chain tests check input-energy bounds and compression instead.
Large straight-chord audits report up to two crossing candidates, including no-input
runs. These samples do not prove every intermediate curved trajectory; dedicated
small mixed-radius crossing and thin-wall tests remain part of verification.

The common motor/sweep/contact rules also change ordinary trajectories. Replay
hashes were intentionally rebased after independent behavior checks; previous
values are preserved in prior-movement-baseline.txt. The invalid 5,000-body
coincident-spawn diagnostic has density P95 175.25 with pressure / 172.10 without,
penetration P95 1.655 / 1.603px and one less occupied boundary cell after60ticks.
That test now checks pressure participation, dispersion and fixed work, rather
than promising monotonic improvement over disabled pressure for an impossible
spawn. Valid Dense Spawn, turning, wall clearance, progress and mixed-size gates
retain their behavioral checks. See overpacked-quality.json for the full result.

### Verification

- npm run verify: typecheck, 209 tests in29 files and production build pass.
- Development browser: 34 checks initially passed; the 10K visual replay continued
  progressing but exceeded the former5s assertion deadline. With a15s replay/UI
  timeout, that failed check passed on rerun. This is not an FPS gate or clock change.
- Production preview: all3 external-reference checks pass (partial spawn, repeated
  6K blasts/reset without Worker/WASM, persistent errors/reset recovery).
- Exact API/direct-velocity equivalence, distant-body independence, fixed work under
  overload, weaker/coherent impulses, wave one-hit lifetime, input history, smaller
  reset, thin walls and mixed-radius crossing are covered by focused tests.

Reproduce with npm run dev on4283, then:

\`\`\`powershell
node scripts/measure-frame.mjs --url=http://127.0.0.1:4283 --agents=6000,10000 --scenarios=rocky-pass --modes=none,blast --ticks=360 --repeats=3 --quality=off --output=test-results/common-performance.json.gz
node scripts/measure-frame.mjs --url=http://127.0.0.1:4283 --agents=6000,10000 --scenarios=rocky-pass --modes=none,blast,blast-repeat --ticks=660 --repeats=1 --quality=on --output=test-results/common-quality.json.gz
npx vite-node scripts/measure-local-push.ts --output=test-results/local-push.json
\`\`\`

## Historical external-mode results

Everything below refers to the superseded external-mode implementations and their
original sources. It does not certify the current common crowd contract.

`;
const historicalStart=old.indexOf('## Archived TypeScript external-mode reference')>=0
  ?old.indexOf('## Archived TypeScript external-mode reference'):old.indexOf('## Current TypeScript reference');
if(historicalStart<0)throw new Error('Missing historical section; refusing to overwrite results.');
writeFileSync(path,intro+old.slice(historicalStart).replace('## Current TypeScript reference','## Archived TypeScript external-mode reference'));
