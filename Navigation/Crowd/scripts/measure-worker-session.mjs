import { chromium } from '@playwright/test';
import { readFileSync,readdirSync,writeFileSync,mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
const arg=(name,value)=>process.argv.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3)??value;
const url=arg('url','http://127.0.0.1:4275'),output=arg('output','test-results/worker-session.json.gz');
const source=await (await fetch(`${url}/__crowd_source`)).json();
if(source.app!=='crowd-navigation-lab')throw new Error('Unknown HTTP app.');
const sourceHash=()=>{
  const hash=createHash('sha256');
  const walk=p=>{for(const e of readdirSync(p,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const f=`${p}/${e.name}`;if(e.isDirectory())walk(f);else{hash.update(f.slice(source.root.length));hash.update(readFileSync(f));}}};
  walk(`${source.root}/src`);return hash.digest('hex');
};
const workingSourceSha256=sourceHash(),browser=await chromium.launch({headless:true});
const live=new Set(),snapshots=[],errors=[];let created=0,retired=0;
try {
  const page=await browser.newPage({viewport:{width:1440,height:960}});
  page.on('worker',worker=>{live.add(worker);created++;worker.once('close',()=>{live.delete(worker);retired++;});});
  page.on('pageerror',error=>errors.push(String(error)));
  await page.goto(`${url}/?preset=legacy&scenario=rocky-pass&agents=10000&scale=true&seed=42&paused=true`);
  await page.waitForFunction(()=>window.crowdDebug?.ready);
  const cdp=await page.context().newCDPSession(page);await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.startSampling',{samplingInterval:32768,includeObjectsCollectedByMajorGC:true,includeObjectsCollectedByMinorGC:true});
  async function install() {
    await page.evaluate(()=>{
      const sim=window.crowdDebug.simulation(),step=sim.step.bind(sim);
      const p=window.workerSession={target:0,done:true,minimumActive:sim.state.count,maximumContactInstrumentedBytes:0,maximumContactKernelBytes:0,maximumFlowKernelBytes:0,workerFailures:0,parallelPasses:0};
      sim.step=()=>{
        step();const stats=sim.external.stats,tick=sim.stepCount;
        p.minimumActive=Math.min(p.minimumActive,sim.metrics.activeCount);p.workerFailures+=stats.workerFailures;p.parallelPasses+=stats.parallelPasses;
        p.maximumContactInstrumentedBytes=Math.max(p.maximumContactInstrumentedBytes,stats.retainedBytes);
        p.maximumContactKernelBytes=Math.max(p.maximumContactKernelBytes,stats.kernelBytes);p.maximumFlowKernelBytes=Math.max(p.maximumFlowKernelBytes,sim.crowdFlow.kernelBytes);
        if(tick===30||tick%120===0) {
          const spawn=sim.scenario.spawn,canvas=document.querySelector('#crowd-canvas'),bounds=canvas.getBoundingClientRect();
          document.querySelector('#external-tool').value='wind';
          canvas.dispatchEvent(new MouseEvent('click',{clientX:bounds.left+(spawn.x+spawn.width*.5)/sim.config.width*bounds.width,clientY:bounds.top+(spawn.y+spawn.height*.5)/sim.config.height*bounds.height,bubbles:true}));
        }
        if(tick>=p.target&&!p.done){p.done=true;document.querySelector('#run-toggle').click();}
      };
    });
  }
  async function runUntil(target) {
    await page.evaluate(target=>{Object.assign(window.workerSession,{target,done:false});document.querySelector('#run-toggle').click();},target);
    await page.waitForFunction(()=>window.workerSession.done,null,{timeout:600000,polling:250});
  }
  async function snapshot(label) {
    await cdp.send('HeapProfiler.collectGarbage');const heap=await cdp.send('Runtime.getHeapUsage');
    const data=await page.evaluate(()=>{
      const sim=window.crowdDebug.simulation(),trace=window.crowdDebug.getFrameTrace();
      return {tick:sim.stepCount,active:sim.metrics.activeCount,records:sim.external.record().length,pending:sim.external.pending.length,effects:sim.external.effects.length,
        retainedFrames:trace.frames.length,frameCapacity:trace.capacity,contactKernelBytes:sim.movement.externalContact?.kernel?.memory.buffer.byteLength??0,
        flowKernelBytes:sim.crowdFlow.kernelBytes,workerThreads:sim.movement.externalContact?.kernel?.workerThreads??0,probe:{...window.workerSession}};
    });
    if(data.probe.workerFailures)throw new Error('Unexpected worker failure.');
    const row={label,...data,observedLiveWorkers:live.size,created,retired,heap};snapshots.push(row);console.log(JSON.stringify(row));
  }
  await install();await snapshot('initial');
  for(const tick of [500,1000,1500,2000]){await runUntil(tick);await snapshot(`tick-${tick}`);}
  for(let cycle=0;cycle<3;cycle++) {
    await page.locator('#reset').click();
    const start=Date.now();while(live.size&&Date.now()-start<5000)await new Promise(resolve=>setTimeout(resolve,20));
    if(live.size)throw new Error('Reset left workers alive.');
    await install();await snapshot(`reset-${cycle}`);await runUntil(200);await snapshot(`rewarm-${cycle}`);
    if(!snapshots.at(-1).workerThreads||!snapshots.at(-1).probe.parallelPasses)throw new Error('Rewarm did not resume worker computation.');
  }
  const {profile}=await cdp.send('HeapProfiler.stopSampling');
  const report={schema:'crowd-worker-session-v1',createdAt:new Date().toISOString(),workingSourceSha256,sourceStable:sourceHash()===workingSourceSha256,browser:browser.version(),url,errors,snapshots,
    scope:'Actual HTTP RAF/clock/recorder/renderer/UI; 10K rocky repeated wind, 2,000 ticks plus three reset/200-tick rewarm cycles. GC only while paused. Timings are not performance evidence. Heap sampling covers the page isolate; worker isolates and GPU device memory are not fully measured. Contact retainedBytes is instrumented typed/linear capacity, not total process memory. Frame/timing rings are still filling; the earlier 12K session separately tested their bounds.'};
  mkdirSync(dirname(output),{recursive:true});writeFileSync(output,gzipSync(JSON.stringify(report)));writeFileSync(`${output}.heapprofile.gz`,gzipSync(JSON.stringify(profile)));
  if(errors.length)throw new Error(errors.join('\n'));
}finally{await browser.close();}
