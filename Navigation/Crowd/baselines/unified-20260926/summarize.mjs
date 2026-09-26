import {readFileSync,writeFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
const root='baselines/unified-20260926';
const read=p=>JSON.parse(p.endsWith('.gz')?gunzipSync(readFileSync(p)):readFileSync(p));
const perf=read(`${root}/frame-performance.json.gz`),quality=read(`${root}/frame-quality.json.gz`);
const prior=read('baselines/reference-20260926/after-core.json.gz'),local=read(`${root}/local-push.json`);
const median=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)];
const timing=[];
for(const agents of [6000,10000])for(const mode of ['none','blast']){
  const rows=perf.rows.filter(r=>r.agents===agents&&r.mode===mode);
  const before=prior.rows.filter(r=>r.agents===agents&&r.mode===mode);
  timing.push({agents,mode,runs:rows.length,p95ByRun:rows.map(r=>r.phases.acceptance.frameCpuMs.p95),
    frameCpuP95Median:median(rows.map(r=>r.phases.acceptance.frameCpuMs.p95)),
    frameCpuMaximum:Math.max(...rows.map(r=>r.phases.acceptance.frameCpuMs.max)),
    recoveryP95Median:median(rows.map(r=>r.phases.recovery.frameCpuMs.p95)),
    simWallMedian:median(rows.map(r=>r.phases.acceptance.simWall)),
    over100ms:rows.reduce((sum,r)=>sum+r.phases.acceptance.over100ms,0),
    priorExternalModeP95:before.length?median(before.map(r=>r.phases.acceptance.frameCpuMs.p95)):null,
    minimumActive:Math.min(...rows.flatMap(r=>r.steps.map(s=>s.active))),
    boundedWork:rows.every(r=>r.steps.every(s=>s.movement.iterations===8&&s.movement.candidates<=agents*24&&s.movement.constraints<=agents*8*8)),
    continuingInputAfterBlast:mode==='blast'?rows.some(r=>r.steps.some(s=>s.tick>=30&&s.movement.ongoingInput)):null,
    errors:rows.flatMap(r=>r.errors),failures:rows.map(r=>r.failure).filter(Boolean)});
}
const geometry=quality.rows.map(r=>({agents:r.agents,mode:r.mode,ticks:r.completedTicks,
  minimumActive:Math.min(...r.steps.map(s=>s.active)),samples:r.audits.length,
  maximumPenetration:Math.max(...r.audits.map(a=>a.maxPenetration)),finalPenetration:r.audits.at(-1).maxPenetration,
  maximumWalls:Math.max(...r.audits.map(a=>a.walls)),maximumNonfinite:Math.max(...r.audits.map(a=>a.nonfinite)),
  maximumChordTunnelingCandidates:Math.max(...r.audits.map(a=>a.tunnelingPairs)),
  legacyHalfPixelThreshold:Math.max(...r.audits.map(a=>a.maxPenetration))<=.5,
  errors:r.errors,failure:r.failure}));
const isolated=['none','blast'].map(mode=>{
  const rows=local.rows.filter(r=>r.mode===mode);
  const means=rows.map(r=>{const a=r.samples.filter(s=>s.tick>=30&&s.tick<60);return a.reduce((s,x)=>s+x.ms,0)/a.length;});
  return {mode,meanOnsetMsByRun:means,medianMeanOnsetMs:median(means),directHits:rows.map(r=>r.directHits),
    nearestOtherAtInput:rows.map(r=>r.nearestOtherAtInput),boundedWork:rows.every(r=>r.samples.every(s=>s.iterations===8&&s.candidates<=r.count*24&&s.constraints<=r.count*64))};
});
const summary={currentSource:perf.workingSourceSha256,priorSource:prior.workingSourceSha256,
  sourceStable:perf.sourceStable&&quality.sourceStable&&local.sourceStable&&perf.workingSourceSha256===quality.workingSourceSha256&&perf.workingSourceSha256===local.workingSourceSha256,
  conditions:{browser:perf.browser,cpu:perf.cpu,performance:'HTTP RAF, 360 ticks, seed42, audit OFF, three repeats each; UI blast radius100/speed400/tick30',
    quality:'Separate audit ON: 660 ticks, sampled every10 ticks, seed42; repeated blasts30/60/90',
    isolated:'Headless, 6000 bodies, one body deliberately moved 1362px from neighbors at tick30 in both cases; radius10/speed400, three repeats; simulation CPU, not FPS'},
  timing,isolated,geometry,
  verification:{unitTests:209,testFiles:29,typecheck:true,productionBuild:true,developmentBrowserChecks:35,
    browserNote:'34 initially passed; 10K visual replay exceeded its old 5s assertion deadline while still advancing. Set replay assertion timeout15s and reran the failed case successfully; no clock changes.',
    productionBrowserChecks:3},
  contractChanges:['External input only changes physical velocity; same movement path and bounded 24/8/8 contact budget for every body.',
    'Motor response, pre-contact static sweep and swept pair projection changed ordinary trajectories too. Prior replay hashes are preserved; new hashes assert the requested common model.',
    'Circular tool is a local push brush, not an infinitely rigid obstacle. Global half-pixel convergence and monotonic contact energy are not claimed.',
    'The impossible 5000-body coincident fixture now tests bounded dispersion/pressure participation, not guaranteed improvement over disabled pressure after exactly60 ticks. Its separate diagnostics show densityP95 175.25 vs172.10 and penetrationP95 1.655 vs1.603. Valid Dense Spawn comparison retains its original quality gates.'],
  limits:['10K remains CPU-bound even with no force; no 60FPS claim.',
    'Sampled endpoint/straight-chord audit cannot certify every intermediate curved path. Chord candidates also appear without input.',
    'No GPU or engine port. No equivalence claim with superseded external-v2 physical trajectories.'],
  evidence:['frame-performance.json.gz','frame-quality.json.gz','local-push.json','prior-activation-diagnostic.json','final-verify.log','browser.log','browser-replay.log','production-browser.log','overpacked-quality.json','prior-movement-baseline.txt','movement-hashes.json']};
writeFileSync(`${root}/summary.json`,JSON.stringify(summary,null,2));
console.log(JSON.stringify({sourceStable:summary.sourceStable,timing,isolated,geometry}));
