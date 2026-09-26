import { chromium } from '@playwright/test';
import { readFileSync,writeFileSync,mkdirSync,readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const arg=(name,value)=>process.argv.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3)??value;
const url=arg('url','http://127.0.0.1:4275'),reference=arg('reference','test-results/colored-reference');
const fixture=arg('fixture','baselines/frame-20260926/adaptive-quality.json.gz'),mode=arg('mode','wind'),seed=Number(arg('seed','42'));
const raw=readFileSync(fixture),report=JSON.parse((fixture.endsWith('.gz')?gunzipSync(raw):raw).toString('utf8'));
const row=report.schema==='crowd-external-diagnostic-v1'?{...report,agents:report.count,initial:{config:report.config}}:report.rows.find(r=>r.mode===mode&&r.seed===seed);
if(!row||!row.commands)throw new Error('Missing input fixture.');
const ticks=Number(arg('ticks',String(row.steps?.length??row.ticks))),failTick=Number(arg('fail-tick','-1'));
const failPhase=arg('fail-phase','velocity'),failPass=Number(arg('fail-pass','3'));
const quality=arg('quality','off')==='on';
if(!['pairs','workset','velocity','position'].includes(failPhase))throw new Error('Unknown failure phase.');
function sourceHash(root) {
 const h=createHash('sha256');
 const walk=p=>{for(const e of readdirSync(p,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const f=`${p}/${e.name}`;if(e.isDirectory())walk(f);else{h.update(f.slice(root.length));h.update(readFileSync(f));}}};
 walk(`${root}/src`);return h.digest('hex');
}
const actualRoot=(await(await fetch(`${url}/__crowd_source`)).json()).root,referenceRoot=`${actualRoot}/${reference}`;
const actualSourceSha256=sourceHash(actualRoot),referenceSourceSha256=sourceHash(referenceRoot);
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage();await page.goto(`${url}/?paused=true&agents=1`);
 const result=await page.evaluate(async({row,reference,ticks,failTick,failPhase,failPass,quality})=>{
  const {CrowdSimulation}=await import('/src/core/simulation.ts');
  const {CrowdSimulation:Reference}=await import(`/${reference}/src/core/simulation.ts`);
  const {getScenario}=await import('/src/scenarios/scenarios.ts'),{scaleScenario}=await import('/src/scenarios/lab-scenarios.ts');
  const audit=quality?(await import('/src/core/lab-results.ts')).auditGeometry:null;
  const scenario=scaleScenario(getScenario(row.scenario),Math.sqrt(row.agents/1000));
  const actual=new CrowdSimulation(structuredClone(row.initial.config),structuredClone(scenario));
  const expected=new Reference(structuredClone(row.initial.config),structuredClone(scenario));expected.external.backend='js';
  if(!crossOriginIsolated)throw new Error('Shared worker precondition missing.');
  let comparedBytes=0,comparedWarmValues=0,parallelPasses=0,workerFailures=0,maximumWorkers=0;
  const hashes=[],audits=[];
  try {
   for(let tick=0;tick<ticks;tick++) {
    if(tick===failTick) {
      const kernel=actual.movement.externalContact.kernel,control=kernel.arrays.control;
      const fail=()=>{Atomics.store(control,6,1);Atomics.store(control,2,1);};
      if(failPhase==='pairs')fail();
      else {
        const method=failPhase==='workset'?'buildWorkset':failPhase==='velocity'?'solveVelocity':'solvePosition';
        const solve=kernel[method].bind(kernel);let passes=0;
        kernel[method]=(...args)=>{if(++passes===failPass)fail();return solve(...args);};
      }
    }
    for(const command of row.commands)if(command.tick===tick){actual.enqueueExternal(structuredClone(command));expected.enqueueExternal(structuredClone(command));}
    actual.step();expected.step();
    parallelPasses+=actual.external.stats.parallelPasses;workerFailures+=actual.external.stats.workerFailures;
    maximumWorkers=Math.max(maximumWorkers,actual.external.stats.workerThreads);
    for(const owner of ['state','previousState'])for(const [name,left] of Object.entries(actual[owner])) {
      if(!ArrayBuffer.isView(left))continue;const right=expected[owner][name];comparedBytes+=left.byteLength;
      for(let i=0;i<left.length;i++)if(!Number.isFinite(left[i])||!Object.is(left[i],right[i]))throw new Error(`State difference: tick${tick}, ${owner}.${name}[${i}]`);
    }
    if(actual.overlapFlags&&expected.overlapFlags)for(let i=0;i<actual.overlapFlags.length;i++)if(actual.overlapFlags[i]!==expected.overlapFlags[i])throw new Error(`Overlap flag difference at tick${tick}, agent${i}`);
    for(const name of ['affected','direct'])for(let i=0;i<actual.external[name].length;i++)if(actual.external[name][i]!==expected.external[name][i])throw new Error(`Flag difference: tick${tick}, ${name}[${i}]`);
    const a=actual.movement.externalContact?.contactCache.current,b=expected.movement.externalContact?.contactCache.current;
    if((a?.count??0)!==(b?.count??0))throw new Error(`Warm count difference at tick${tick}`);
    if(a&&b)for(let i=0;i<a.count;i++) {
      const x=a.used[i],y=b.used[i];if(a.keys[x]!==b.keys[y])throw new Error(`Warm key order difference at tick${tick}`);
      for(let j=0;j<5;j++){const value=a.values[x*5+j];comparedWarmValues++;if(!Number.isFinite(value)||!Object.is(value,b.values[y*5+j]))throw new Error(`Warm value difference at tick${tick}, entry${i}:${j}`);}
    }
    const hash=actual.stateHash();if(hash!==expected.stateHash())throw new Error(`Hash difference at tick${tick}`);hashes.push(hash);
    if(audit&&(tick%10===0||actual.external.stats.substepRetries||actual.external.stats.workerFailures))audits.push({tick,...audit(actual)});
    if(tick===0) {
      const started=performance.now();
      while(!actual.movement.externalContact?.kernel?.workerThreads) {
        if(performance.now()-started>5000)throw new Error('Workers did not become ready.');
        await new Promise(resolve=>setTimeout(resolve,10));
      }
    }
   }
   if(!parallelPasses||!maximumWorkers)throw new Error('No actual worker computation.');
   if(workerFailures!==(failTick>=0?1:0))throw new Error(`Unexpected worker failures: ${workerFailures}`);
   if(JSON.stringify(actual.external.record())!==JSON.stringify(expected.external.record()))throw new Error('Command difference.');
   return {comparedBytes,comparedWarmValues,parallelPasses,maximumWorkers,workerFailures,active:actual.metrics.activeCount,hashes,audits,mismatches:0};
  }finally{actual.dispose();expected.dispose?.();}
 },{row,reference,ticks,failTick,failPhase,failPass,quality});
 const output=arg('output','test-results/worker-state-comparison.json');mkdirSync(dirname(output),{recursive:true});
 writeFileSync(output,JSON.stringify({schema:'crowd-worker-state-comparison-v1',actualSourceSha256,referenceSourceSha256,
  sourceStable:sourceHash(actualRoot)===actualSourceSha256&&sourceHash(referenceRoot)===referenceSourceSha256,
  fixture,scenario:row.scenario,agents:row.agents,mode,seed,ticks,failTick,failPhase,failPass,quality,
  profile:'Real browser shared-memory workers versus isolated JS reference, every finite numeric state value including signed zero, warm cache, flags, command record and hash. Manual fixed steps; not a RAF performance result.',...result},null,2));
 console.log(JSON.stringify({...result,hashes:undefined,audits:undefined,hash:result.hashes.at(-1)}));
}finally{await browser.close();}
