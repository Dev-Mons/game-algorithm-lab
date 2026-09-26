import { chromium } from '@playwright/test';
import { readFileSync,writeFileSync } from 'node:fs';
import {gunzipSync} from 'node:zlib';
const row=JSON.parse(gunzipSync(readFileSync('test-results/issue33-worker-eight-performance.json.gz'))).rows[0];
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage();await page.goto('http://127.0.0.1:4275/?paused=true&agents=1');
 const result=await page.evaluate(async row=>{
  const {CrowdSimulation}=await import('/src/core/simulation.ts');
  const {getScenario}=await import('/src/scenarios/scenarios.ts');const {scaleScenario}=await import('/src/scenarios/lab-scenarios.ts');
  const sim=new CrowdSimulation(structuredClone(row.initial.config),scaleScenario(getScenario(row.scenario),Math.sqrt(row.agents/1000)));
  sim.step();
  const {SpatialHash}=await import('/src/algorithms/spatial-hash/spatial-hash.ts');
  const solver=sim.movement.externalContact,kernel=solver.kernel,original=kernel.solvePosition.bind(kernel),rows=[];
  const grid=new SpatialHash(sim.config.width,sim.config.height,12,sim.state.count);
  const scan=()=>{
    const input=solver.kernelInput,s=input.next;grid.rebuild(s.x,s.y,s.active);let count=0,maximum=0;
    for(let a=0;a<s.count;a++)if(s.active[a]){
      const radius=input.agentRadii?.[a]??input.agentRadius;
      grid.forEachCandidate(s.x[a],s.y[a],radius+input.maxAgentRadius,b=>{
        if(b<=a)return;const depth=radius+(input.agentRadii?.[b]??input.agentRadius)-Math.hypot(s.x[a]-s.x[b],s.y[a]-s.y[b]);
        if(depth>.45)count++;maximum=Math.max(maximum,depth);
      });
    }
    return {count,maximum};
  };
  kernel.solvePosition=(...args)=>{
    const pass=sim.external.stats.stabilizationPasses;
    if(pass===1)rows.push({tick:sim.stepCount,before:scan()});
    const result=original(...args);
    if(pass===4)rows.at(-1).afterFour=scan();
    return result;
  };
  while(!solver.kernel.workerThreads)await new Promise(r=>setTimeout(r,10));
  try {for(let tick=1;tick<520;tick++){
   for(const c of row.commands)if(c.tick===tick)sim.enqueueExternal(structuredClone(c));sim.step();
   if(tick===0){while(!solver.kernel.workerThreads)await new Promise(r=>setTimeout(r,10));}
  }return rows;}finally{sim.dispose();}
 },row);
 writeFileSync('test-results/issue33-initial-compression-probe.json',JSON.stringify(result,null,2));console.log(JSON.stringify({ticks:result.length,beforeMean:result.reduce((n,r)=>n+r.before.count,0)/result.length,afterFourMean:result.reduce((n,r)=>n+(r.afterFour?.count??0),0)/result.length,first:result.slice(0,3),last:result.slice(-3)}));
}finally{await browser.close();}
