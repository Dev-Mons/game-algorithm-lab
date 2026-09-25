import { chromium } from '@playwright/test';
import { readFileSync,writeFileSync } from 'node:fs';
import {gunzipSync} from 'node:zlib';
const row=JSON.parse(gunzipSync(readFileSync('test-results/issue33-wide-projection-performance.json.gz'))).rows[0];
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage();await page.goto('http://127.0.0.1:4275/?paused=true&agents=1');
 const result=await page.evaluate(async row=>{
  const {CrowdSimulation}=await import('/src/core/simulation.ts');
  const {getScenario}=await import('/src/scenarios/scenarios.ts');const {scaleScenario}=await import('/src/scenarios/lab-scenarios.ts');
  const sim=new CrowdSimulation(structuredClone(row.initial.config),scaleScenario(getScenario(row.scenario),Math.sqrt(row.agents/1000)));
  sim.step();
  const solver=sim.movement.externalContact,projection=solver.projection,original=projection.solve.bind(projection),rows=[];
  const targets=new Set([332,354,411,505]);
  projection.solve=(...args)=>{
    const input=args[0],s=input.next,a=args[3],b=args[4],count=args[5],tolerance=args[6];
    const scan=()=>{const bad=[];for(let p=0;p<count;p++){
      const ia=a[p],ib=b[p],ra=input.agentRadii?.[ia]??input.agentRadius,rb=input.agentRadii?.[ib]??input.agentRadius;
      const d=Math.hypot(s.x[ia]-s.x[ib],s.y[ia]-s.y[ib]);if(d<ra+rb-tolerance)bad.push({pair:p,a:ia,b:ib,depth:ra+rb-d,separated:solver.wallSeparates(input,s.x[ia],s.y[ia],s.x[ib],s.y[ib]),ax:s.x[ia],ay:s.y[ia],bx:s.x[ib],by:s.y[ib],ra,rb});
    }return bad;};
    if(!targets.has(sim.stepCount))return original(...args);
    const before=scan(),attempts=sim.external.stats.projectionAttempts,groups=sim.external.stats.projectionGroups;
    const result=original(...args),after=scan();
    rows.push({tick:sim.stepCount,beforeCount:before.length,afterCount:after.length,attempts:sim.external.stats.projectionAttempts-attempts,groups:sim.external.stats.projectionGroups-groups,before:before.slice(0,8),after:after.slice(0,8)});return result;
  };
  while(!solver.kernel.workerThreads)await new Promise(r=>setTimeout(r,10));
  try {for(let tick=1;tick<520;tick++){
   for(const c of row.commands)if(c.tick===tick)sim.enqueueExternal(structuredClone(c));sim.step();
   if(tick===0){while(!solver.kernel.workerThreads)await new Promise(r=>setTimeout(r,10));}
  }return rows;}finally{sim.dispose();}
 },row);
 writeFileSync('test-results/issue33-projection-residual-probe.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result.map(r=>({...r,before:r.before.slice(0,1),after:r.after.slice(0,1)}))));
}finally{await browser.close();}
