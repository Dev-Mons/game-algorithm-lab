import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Historical external-v1 data renderer. Never regenerate a current design document.
const output = resolve(process.argv.find(value => value.startsWith('--output='))?.slice(9)
  ?? 'test-results/external-v1-report.md');

const read=(name:string)=>JSON.parse(readFileSync(`baselines/external-${name}.json`,'utf8'));
const before=read('before'),after=read('after');
const median=(v:number[])=>v.sort((a,b)=>a-b)[Math.floor(v.length/2)]!;
const f=(v:number)=>v.toFixed(2);
const lines=[`# Historical external-v1 measurements`, '',
  'These results describe the archived external-v1 implementation and its original gates. They do not certify the current CrowdKernel.', '',
  `Baseline: \`${before.commit}\`. Implementation: working tree source SHA-256 \`${after.workingSourceSha256}\`.`,
  `Measured on ${after.cpu.trim()}, Node ${after.runtime}. Headless CPU results exclude rendering.`, '',
  'No-input baseline was captured before implementation. Each normal timing case uses seed 42, default radius 3.2, dt 1/60, 30 warmup ticks and 90 measured ticks, with three repeats. Active inputs begin at tick 30. All reported counts are actual created and minimum active counts, not requested-only counts.', '',
  '## No-input regression gate', '',
  '| Actual agents | Before P95 ms | After P95 ms | Change | State hashes |',
  '|---:|---:|---:|---:|---|'];
let failed=false;
for(const count of [1000,10000,20000,50000]) {
  const b=before.rows.filter((r:any)=>r.count===count),a=after.rows.filter((r:any)=>r.count===count);
  const bp=median(b.map((r:any)=>r.stepMs.p95)),ap=median(a.map((r:any)=>r.stepMs.p95));
  const match=a.every((r:any)=>r.hash===b.find((q:any)=>q.repeat===r.repeat).hash);
  const change=100*(ap/bp-1);
  lines.push(`| ${count} | ${f(bp)} | ${f(ap)} | ${f(change)}% | ${match?'all equal':'MISMATCH'} |`);
  if(count<=20000&&(change>10||!match))failed=true;
}
lines.push('', 'P95 columns are the median of three per-run P95 values. The 10% regression gate applies to 1K/10K/20K; 50K is exploratory.', '',
  '## Active input profiles', '', '| Input | Actual agents | P50 / P95 / P99 ms | P95 budget ms | Direct target applications | Max substeps | Max pairs/tick | Saturated queries |',
  '|---|---:|---:|---:|---:|---:|---:|---:|');
const modes=['few','blast','global','proxy','overlap'];
for(const mode of modes) {
  const data=read(`${mode}-performance`);
  if(data.workingSourceSha256!==after.workingSourceSha256)throw new Error(`Stale measurement: ${mode}`);
  for(const count of [1000,10000,20000]) {
    const rows=data.rows.filter((r:any)=>r.count===count);
    const p50=median(rows.map((r:any)=>r.stepMs.p50)),p95=median(rows.map((r:any)=>r.stepMs.p95)),p99=median(rows.map((r:any)=>r.stepMs.p99));
    const budget=count===1000?20:count===10000?120:240;
    const peak=(key:string)=>Math.max(...rows.map((r:any)=>r.peaks[key]));
    lines.push(`| ${mode} | ${count} | ${f(p50)} / ${f(p95)} / ${f(p99)} | ${budget} | ${mode==='proxy'?`proxy affected: ${rows[0].proxyDrivenPeak}`:rows[0].directHits} | ${peak('substeps')} | ${peak('pairs')} | ${peak('saturatedQueries')} |`);
    if(rows.length!==3||rows.some((r:any)=>r.spawned!==count||r.minActive!==count||r.maxWalls>0||(mode==='proxy'&&!(r.proxyDrivenPeak>=2)))||p95>budget||peak('saturatedQueries')>0)failed=true;
  }
}
lines.push('', '`few`: five backwards 400 px/s hits; `blast`: linear radial 400 px/s peak; `global`: whole-world +y 400 px/s; `proxy`: one radius-18 circle moving right at 240 px/s from 24 px behind the current leftmost agent; `overlap`: eight overlapping 50 px/s² acceleration regions. Direct applications sum per-tick unique targets; proxy recipients appear in contact counters, not direct input counts. Each proxy run must affect at least two agents (`proxyDrivenPeak`) or the gate fails. An earlier empty-space proxy trial was discarded after its zero candidate count exposed the invalid measurement setup.', '',
  'Full pass distributions, cell-query work, speed caps, physical/contact recipients, static sweeps and process memory samples are in the corresponding `baselines/external-*-performance.json` files. Interpret timing boundaries against the recorded source version, not the current solver.', '',
  '## Independent quality runs', '', '| Input | Actual agents | Maximum sampled penetration px | Maximum wall overlaps | Query saturation | Speed caps |',
  '|---|---:|---:|---:|---:|---:|');
for(const mode of modes)for(const r of read(`${mode}-quality`).rows) {
  lines.push(`| ${mode} | ${r.spawned} | ${f(r.maxPenetration)} | ${r.maxWalls} | ${r.peaks.saturatedQueries} | ${r.peaks.speedClamps} |`);
  if(r.maxPenetration>.5||r.maxWalls>0||r.peaks.saturatedQueries>0||r.spawned!==r.count||r.minActive!==r.count)failed=true;
}
lines.push('', 'Quality runs rebuild a separate spatial index and visit all pairs in range every ten ticks; they never use the solver pair list or a neighbor cap. This covers all active bodies at sampled ticks, not every intermediate substep. Small automated scenes exhaustively audit all pairs each tick and separately test swept crossings, thin-wall safety, trapping, mixed radii, event lifetimes, exact replay, energy non-amplification, and recovery.', '',
  '## Overpacking and 50K exploration', '', '| Run | Actual/minimum active | P95 ms (audit ON run) | Sampled penetration px | Walls | Saturated queries |',
  '|---|---:|---:|---:|---:|---:|');
for(const name of ['fixed-stress','50k-exploration'])for(const r of read(name).rows)
  lines.push(`| ${name} ${r.count} | ${r.spawned}/${r.minActive} | ${f(r.stepMs.p95)} | ${f(r.maxPenetration)} | ${r.maxWalls} | ${r.peaks.saturatedQueries} |`);
lines.push('', 'Fixed-space stress fills a 1200×720 world at unchanged radius/speed/dt and keeps the goal outside the world to disable arrival sinks. It is deliberately separate from equal-density normal gates. Query saturation and unresolved compression must be treated as overload, not evidence of collision-free support. 50K has no 60 Hz acceptance claim.', '',
  '## Browser rendering observation', '', '| Actual agents | Mode | Frame P50 / P95 / P99 ms | Simulation P95 ms |', '|---:|---|---:|---:|');
const browser=read('browser');
for(const r of browser.rows)lines.push(`| ${r.spawned} | ${r.mode} | ${f(r.frameMs.p50)} / ${f(r.frameMs.p95)} / ${f(r.frameMs.p99)} | ${f(r.stepMs.p95)} |`);
lines.push('', `Chromium ${browser.browser}, 1440×960, headless, one fixed step per animation frame with the actual CanvasRenderer and UI. Frame intervals include pacing/render/UI and are distinct from headless simulation timings. These are single observational runs, not native-display FPS guarantees.`, '',
  '## Design evidence, verification and limits', '',
  '- `external-model-comparison.json` compares the original solver, unclamped XPBD, eight-substep XPBD, single physical velocity and a separate motor/residual model. The separate model needs 16 extra bytes/agent and post-contact rebasing; it offered no contact quality advantage in these calibrations. The chosen model preserves backward impulses and immediately removes wall-normal momentum.',
  '- `npm run verify`: typecheck, 175 automated tests and production build. `npm run test:e2e`: 31 browser tests, including paused external input, recorded export, reset, visible overload rejection and existing movement/editor regressions.',
  '- Additional typed memory: 2 bytes/agent flags; 256 bytes/agent lazy pair buffers; 260-byte candidate buffer; optional region index 4 bytes/agent plus 12 bytes/cell; one byte/agent for each active wave. Existing movement scratch is reused. No new per-agent objects in the step; callback/input allocations remain. Process heap samples include Node/Vite/GC, not exact allocator counts.',
  '- The physical mode currently runs across the whole population while external motion is active. Local hits therefore pay a global contact-pass cost and distant ordinary contacts use the physical contact law during that interval. Sparse contact islands and a unified always-on physical walking model are future optimization/design work.',
  '- Supported moving shapes are circles. Rotation-dependent box/capsule contact, two-way vehicle reaction, damage, GPU execution and engine porting are outside this profile. Region forces ignore wall occlusion. Stationary bodies retain collision geometry until removed.',
  '- Candidate truncation, initial overlap and crushing have bounded/diagnosed behavior, not an unlimited nonpenetration guarantee. Pair updates are sequential and require a new reduction/coloring design before parallelization.', '',
  `**Normal-profile gate: ${failed?'FAIL — do not close the issue on these results.':'PASS for the declared CPU profile and sampled quality scope.'}**`, '');
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output,lines.join('\n'));
console.log(`Wrote ${output}; historical normal-profile gate ${failed?'FAIL':'PASS'}`);
if(failed)process.exitCode=1;
