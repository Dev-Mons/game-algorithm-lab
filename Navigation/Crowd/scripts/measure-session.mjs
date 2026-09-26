import { chromium } from '@playwright/test';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { cpus } from 'node:os';

const arg=(name,fallback)=>process.argv.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3)??fallback;
const url=arg('url','http://127.0.0.1:4275'),output=arg('output','test-results/session-memory.json.gz');
const source=await (await fetch(`${url}/__crowd_source`)).json();
if(source.app!=='crowd-navigation-lab')throw new Error('Unknown HTTP app.');
const sourceHash=()=>{
  const h=createHash('sha256');
  const walk=p=>{for(const e of readdirSync(p,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
    const f=`${p}/${e.name}`;if(e.isDirectory())walk(f);else {h.update(f.slice(source.root.length));h.update(readFileSync(f));}
  }};
  walk(`${source.root}/src`);return h.digest('hex');
};
const workingSourceSha256=sourceHash(),browser=await chromium.launch({headless:true});
const errors=[],snapshots=[];
try {
  const page=await browser.newPage({viewport:{width:1440,height:960}});
  page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(`${url}/?preset=legacy&scenario=open-field&agents=1000&scale=true&seed=42&paused=true`);
  await page.waitForFunction(()=>window.crowdDebug?.ready);
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.startSampling',{samplingInterval:32768,includeObjectsCollectedByMajorGC:true,includeObjectsCollectedByMinorGC:true});
  async function install(history) {
    await page.evaluate(history=>{
      const sim=window.crowdDebug.simulation(),step=sim.step.bind(sim);
      const p=window.sessionProbe={target:0,done:true,goalInputs:0,forceInputs:0,minimumActive:sim.state.count,
        maximumPending:0,maximumEffects:0,stepCalls:0};
      const click=(tool,x,y)=>{
        document.querySelector('#external-tool').value=tool;
        const canvas=document.querySelector('#crowd-canvas'),r=canvas.getBoundingClientRect();
        canvas.dispatchEvent(new MouseEvent('click',{clientX:r.left+x/sim.config.width*r.width,clientY:r.top+y/sim.config.height*r.height,bubbles:true}));
      };
      sim.step=()=>{
        step();p.stepCalls++;
        const tick=sim.stepCount;
        p.minimumActive=Math.min(p.minimumActive,sim.metrics.activeCount);
        p.maximumPending=Math.max(p.maximumPending,sim.external.pending.length);
        p.maximumEffects=Math.max(p.maximumEffects,sim.external.effects.length);
        if(tick<=history||tick%120===0) {
          const corners=[[1100,100],[1100,620],[100,620],[100,100]],goal=corners[Math.floor(tick/120)%4];
          click('goal',...goal);p.goalInputs++;
        }
        if(tick%120===0) {click('wind',600,360);p.forceInputs++;}
        if(tick>=p.target&&!p.done){p.done=true;document.querySelector('#run-toggle').click();}
      };
    },history);
  }
  async function runUntil(target) {
    await page.evaluate(target=>{Object.assign(window.sessionProbe,{target,done:false});document.querySelector('#run-toggle').click();},target);
    await page.waitForFunction(()=>window.sessionProbe.done||document.querySelector('#external-status').textContent.startsWith('입력 처리 중지'),null,{timeout:600000,polling:500});
    if(!await page.evaluate(()=>window.sessionProbe.done))throw new Error(await page.locator('#external-status').textContent());
  }
  async function snapshot(label) {
    // GC and exports happen while paused, outside all acceptance timing. Heap
    // sampling estimates allocation; this is not an exact allocation counter.
    await cdp.send('HeapProfiler.collectGarbage');
    const heap=await cdp.send('Runtime.getHeapUsage');
    const state=await page.evaluate(()=>{
      const sim=window.crowdDebug.simulation(),trace=window.crowdDebug.getFrameTrace();
      return {tick:sim.stepCount,active:sim.metrics.activeCount,records:sim.external.record().length,
        pending:sim.external.pending.length,effects:sim.external.effects.length,
        retainedFrames:trace.frames.length,frameCapacity:trace.capacity,probe:{...window.sessionProbe}};
    });
    const row={label,...state,heap};snapshots.push(row);console.log(JSON.stringify(row));
  }
  await install(4096);
  await snapshot('initial');
  for(const tick of [1000,4000,8000,12000]) {await runUntil(tick);await snapshot(`tick-${tick}`);}
  const recorded=await page.evaluate(()=>{
    document.querySelector('#save-result').click();
    const results=JSON.parse(localStorage.getItem('crowd-lab-results-v1'));
    return results.at(-1);
  });
  if(recorded.timing.measuredSteps!==12000||recorded.timing.retainedTimingSamples!==10000)throw new Error('Timing ring/lifetime count mismatch.');
  if(snapshots.at(-1).retainedFrames!==4096||recorded.commands.length<4096)throw new Error('Trace/history stress did not reach capacity.');
  await page.evaluate(()=>document.querySelector('#clear-results').click());
  for(let cycle=0;cycle<3;cycle++) {
    await page.evaluate(()=>{document.querySelector('#reset').click();delete window.sessionProbe;});
    await install(0);await snapshot(`reset-${cycle}`);await runUntil(1000);await snapshot(`rewarm-${cycle}`);
  }
  const {profile}=await cdp.send('HeapProfiler.stopSampling');
  const allocations=[];
  const visit=node=>{if(node.selfSize)allocations.push({function:node.callFrame.functionName,url:node.callFrame.url,line:node.callFrame.lineNumber,estimatedBytes:node.selfSize});for(const c of node.children)visit(c);};
  visit(profile.head);allocations.sort((a,b)=>b.estimatedBytes-a.estimatedBytes);
  const report={schema:'crowd-session-memory-v1',createdAt:new Date().toISOString(),workingSourceSha256,sourceStable:sourceHash()===workingSourceSha256,
    cpu:cpus()[0]?.model,node:process.version,browser:browser.version(),url,errors,
    profile:'Actual HTTP main RAF/clock/renderer/recorder/UI. 12,000 ticks, 4,096 initial UI goal records plus periodic goals/wind, then three reset/rewarm cycles. Heap sampling includes collected objects; explicit GC only while paused. Memory/history diagnostic, not a 60Hz or constant-active-population quality acceptance run.',
    snapshots,allocations,recorded};
  mkdirSync(dirname(output),{recursive:true});writeFileSync(output,gzipSync(JSON.stringify(report)));
  writeFileSync(`${output}.heapprofile.gz`,gzipSync(JSON.stringify(profile)));
  if(errors.length)throw new Error(errors.join('\n'));
} finally {await browser.close();}
