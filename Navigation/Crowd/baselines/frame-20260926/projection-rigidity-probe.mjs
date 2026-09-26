import { chromium } from '@playwright/test';
import { readFileSync,writeFileSync } from 'node:fs';
import {gunzipSync} from 'node:zlib';
const row=JSON.parse(gunzipSync(readFileSync('test-results/issue33-residual-rounds-performance.json.gz'))).rows[0];
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage();await page.goto('http://127.0.0.1:4275/?paused=true&agents=1');
 const result=await page.evaluate(async row=>{
  const {CrowdSimulation}=await import('/src/core/simulation.ts');
  const {getScenario}=await import('/src/scenarios/scenarios.ts');const {scaleScenario}=await import('/src/scenarios/lab-scenarios.ts');
  const sim=new CrowdSimulation(structuredClone(row.initial.config),scaleScenario(getScenario(row.scenario),Math.sqrt(row.agents/1000)));
  sim.step();
  const solver=sim.movement.externalContact,projection=solver.projection,original=projection.translate.bind(projection),rows=[];
  const beforeX=new Float64Array(sim.state.count),beforeY=new Float64Array(sim.state.count);
  let groups=0,members=0,changed=0,maximumError=0;
  projection.translate=(input,ids,count,dx,dy,move)=>{
    const s=input.next;groups++;members+=count;
    for(let i=0;i<count;i++){const a=ids[i];beforeX[i]=s.x[a];beforeY[i]=s.y[a];}
    original(input,ids,count,dx,dy,move);
    for(let i=0;i<count;i++){
      const a=ids[i],ex=s.x[a]-(beforeX[i]+dx),ey=s.y[a]-(beforeY[i]+dy),error=Math.hypot(ex,ey);
      if(error>1e-8){changed++;maximumError=Math.max(maximumError,error);if(rows.length<25)rows.push({tick:sim.stepCount,a,count,dx,dy,x:beforeX[i],y:beforeY[i],ex,ey,error});}
    }
  };
  while(!solver.kernel.workerThreads)await new Promise(r=>setTimeout(r,10));
  try {for(let tick=1;tick<520;tick++){
   for(const c of row.commands)if(c.tick===tick)sim.enqueueExternal(structuredClone(c));sim.step();
   if(tick===0){while(!solver.kernel.workerThreads)await new Promise(r=>setTimeout(r,10));}
  }return {groups,members,changed,maximumError,rows};}finally{sim.dispose();}
 },row);
 writeFileSync('test-results/issue33-projection-rigidity-probe.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();}
