import { writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { cpus } from 'node:os';
import { execSync } from 'node:child_process';
import { CrowdSimulation, DEFAULT_CONFIG } from '../src/core/simulation';
import { scaleScenario } from '../src/scenarios/lab-scenarios';
import { getScenario } from '../src/scenarios/scenarios';
import { auditGeometry } from '../src/core/lab-results';
import { EXTERNAL_PROFILE } from '../src/core/external-influences';

const arg = (name: string, fallback: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const rows: unknown[] = [];
const mode=arg('mode','none'), quality=arg('quality','off') === 'on', fixed=arg('density','scaled') === 'fixed';
const scenarioName=arg('scenario','open-field');
const ticks=Number(arg('ticks','120')),proxyEnd=Number(arg('proxy-end',String(ticks)));
if(!Number.isSafeInteger(ticks)||ticks<=30||!Number.isSafeInteger(proxyEnd)||proxyEnd<=30||proxyEnd>ticks)throw new Error('Invalid measurement interval.');
const measuredSourceSha256=sourceHash();
for (const count of arg('agents', '1000,10000,20000,50000').split(',').map(Number)) {
  for (let repeat = 0; repeat < Number(arg('repeats','3')); repeat++) {
    const scale = fixed ? 1 : Math.sqrt(count / 1000);
    const scenario=fixed ? {...getScenario(scenarioName),spawn:{x:5,y:5,width:1190,height:710},goal:{x:5000,y:360}} : scaleScenario(getScenario(scenarioName), scale);
    const sim = new CrowdSimulation({ ...DEFAULT_CONFIG, agentCount: count, width: 1200 * scale, height: 720 * scale }, scenario);
    const times: number[] = [], passes: Record<string, number[]> = {};
    const before = process.memoryUsage();
    let minActive = count, maxPenetration=0, maxWalls=0, directHits=0, proxyStartX=0, proxyDrivenPeak=0;
    let maxProxyPenetration=0,maxNonfinite=0,maxSweptPenetration=0,maxTunnelingPairs=0;
    const audits:Array<ReturnType<typeof auditGeometry>&{step:number}>=[];
    const peaks:Record<string,number>={};
    for (let step = 0; step < ticks; step++) {
      const generation=sim.external.generation;
      if (step === 30) {
        if(mode === 'proxy') proxyStartX=sim.state.x.reduce((minimum,x)=>Math.min(minimum,x),Infinity)-24;
        if (mode === 'few') for (let a=0;a<Math.min(5,count);a++) sim.enqueueExternal({kind:'impulse',id:`hit${a}`,tick:step,generation,target:{agent:a},dvx:-400,dvy:0});
        if (mode === 'blast') sim.enqueueExternal({kind:'blast',id:'blast',tick:step,generation,x:235*scale,y:360*scale,radius:160*scale,speed:400});
        if (mode === 'global') sim.enqueueExternal({kind:'impulse',id:'global',tick:step,generation,target:{x:600*scale,y:360*scale,radius:1000*scale},dvx:0,dvy:400});
        if (mode === 'overlap') for(let i=0;i<8;i++) sim.enqueueExternal({kind:'acceleration',id:`wind${i}`,tick:step,generation,target:{x:235*scale,y:360*scale,radius:160*scale},ax:50,ay:0,endTick:120});
      }
      if(mode === 'proxy' && step>=30&&step<proxyEnd) sim.enqueueExternal({kind:'proxy',id:`proxy${step}`,body:'vehicle',tick:step,generation,x:proxyStartX+(step-30)*4,y:360*scale,toX:proxyStartX+(step-29)*4,toY:360*scale,radius:18});
      if(mode === 'proxy' && step===proxyEnd)sim.enqueueExternal({kind:'remove-proxy',id:'remove-proxy',body:'vehicle',tick:step,generation});
      const start = performance.now(); sim.step(); const elapsed = performance.now() - start;
      minActive = Math.min(minActive, sim.metrics.activeCount);
      if (step < 30) continue;
      times.push(elapsed);
      for (const [key, value] of Object.entries(sim.experimentStats.passMs)) (passes[key] ??= []).push(value);
      for(const [key,value] of Object.entries(sim.external.stats)) {
        peaks[key]=Math.max(peaks[key]??0,value);
        if(key.endsWith('Ms'))(passes[`external.${key}`]??=[]).push(value);
      }
      directHits+=sim.external.stats.affected;
      if(mode === 'proxy')proxyDrivenPeak=Math.max(proxyDrivenPeak,sim.external.affected.reduce((sum,v)=>sum+v,0));
      maxWalls=Math.max(maxWalls,sim.metrics.wallOverlapCount);
      if(quality&&(step%10===0||sim.external.stats.positionBudgetExhaustions||sim.external.stats.substepRetries)) {
        const audit=auditGeometry(sim);audits.push({step:sim.stepCount,...audit});
        maxPenetration=Math.max(maxPenetration,audit.maxPenetration);maxWalls=Math.max(maxWalls,audit.walls);
        maxProxyPenetration=Math.max(maxProxyPenetration,audit.maxProxyPenetration);maxNonfinite=Math.max(maxNonfinite,audit.nonfinite);
        maxSweptPenetration=Math.max(maxSweptPenetration,audit.maxSweptPenetration);maxTunnelingPairs=Math.max(maxTunnelingPairs,audit.tunnelingPairs);
      }
    }
    const quantiles = (a: number[]) => { a.sort((x,y) => x-y); return { p50: a[Math.floor(a.length*.5)], p95: a[Math.floor(a.length*.95)], p99: a[Math.floor(a.length*.99)] }; };
    const sampledQualityGate=quality?maxPenetration<=.5&&maxProxyPenetration<=.5&&maxWalls===0&&maxNonfinite===0&&(peaks.saturatedQueries??0)===0&&(peaks.unresolvedCompression??0)===0&&(mode!=='proxy'||proxyDrivenPeak>=2):null;
    const row = { count, repeat, mode, scenario:scenarioName, quality, fixedSpace:fixed, ticks,proxyEnd, spawned: sim.state.count, minActive, stepMs: quantiles(times), peaks, directHits,proxyDrivenPeak, maxPenetration:quality?maxPenetration:null,maxWalls,
      maxProxyPenetration:quality?maxProxyPenetration:null,maxNonfinite:quality?maxNonfinite:null,maxSweptPenetration:quality?maxSweptPenetration:null,maxTunnelingPairs:quality?maxTunnelingPairs:null,sampledQualityGate,audits,
      passes: Object.fromEntries(Object.entries(passes).map(([k,v]) => [k,quantiles(v)])), memoryBefore: before, memoryAfter: process.memoryUsage(), hash: sim.stateHash() };
    rows.push(row); console.log(JSON.stringify({ count, repeat, mode, spawned: row.spawned, minActive, stepMs: row.stepMs, maxPenetration:row.maxPenetration,peaks }));
  }
}
function sourceHash() {
  const hash=createHash('sha256');
  const walk=(path:string) => { for(const entry of readdirSync(path,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
    const name=`${path}/${entry.name}`;if(entry.isDirectory())walk(name);else { hash.update(name);hash.update(readFileSync(name)); }
  } }; walk('src'); return hash.digest('hex');
}
writeFileSync(arg('output', 'baselines/external-measurement.json'), JSON.stringify({ commit: execSync('git rev-parse HEAD').toString().trim(), workingSourceSha256:measuredSourceSha256,sourceStable:sourceHash()===measuredSourceSha256,
  sourceHashFormat:'SHA-256 of localeCompare-sorted src/... paths without leading slash, followed by raw file bytes',runtime: process.version, cpu: cpus()[0]?.model, support:EXTERNAL_PROFILE,
  profile: `${scenarioName}; ${fixed?'fixed 1200x720; spawn fills world; goal outside world to prevent sinks (overpacking stress)':'same density'}; seed 42; dt 1/60; radius 3.2; warmup 30; measured ${ticks-30}; proxy stops/removes at ${proxyEnd}; quality ${quality ? 'independent all-neighbor/chord audit every 10 ticks and every exhausted/retried tick; timings are diagnostic only' : 'OFF'}; no rendering; allocation samples include Vite/Node/GC and are not allocator counts`, rows }, null, 2));
