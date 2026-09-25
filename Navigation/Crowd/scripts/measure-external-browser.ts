import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { cpus } from 'node:os';

const browser=await chromium.launch({headless:true});
const rows=[];
const arg=(name:string,fallback:string)=>process.argv.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3)??fallback;
try {
  for(const count of arg('agents','1000,10000,20000').split(',').map(Number)) for(const mode of arg('modes','none,blast').split(',')) {
    const page=await browser.newPage({viewport:{width:1440,height:960}});
    await page.goto(`http://127.0.0.1:4274/?agents=${count}&scale=true&paused=true`);
    const result=await page.evaluate(async(mode)=>{
      const sim=window.crowdDebug.simulation(),scale=Math.sqrt(sim.state.count/1000);
      const times:number[]=[],cpu:number[]=[];let previous=0,proxyStartX=0;
      // One fixed step per animation frame; the normal app RAF draws the actual canvas
      // between samples. This separates browser+render throughput from clock catch-up.
      for(let tick=0;tick<120;tick++) {
        const now=await new Promise<number>(resolve=>requestAnimationFrame(resolve));
        if(tick>30)times.push(now-previous);previous=now;
        if(tick===30&&mode==='blast')sim.enqueueExternal({kind:'blast',id:'browser-blast',tick:sim.stepCount,generation:sim.external.generation,x:235*scale,y:360*scale,radius:160*scale,speed:400});
        if(tick===30&&mode==='proxy')proxyStartX=sim.state.x.reduce((min,x)=>Math.min(min,x),Infinity)-24;
        if(tick>=30&&mode==='proxy')sim.enqueueExternal({kind:'proxy',id:`browser-proxy${tick}`,body:'car',tick:sim.stepCount,generation:sim.external.generation,x:proxyStartX+(tick-30)*4,y:360*scale,toX:proxyStartX+(tick-29)*4,toY:360*scale,radius:18});
        const start=performance.now();sim.step();if(tick>=30)cpu.push(performance.now()-start);
      }
      const summary=(values:number[])=>{values.sort((a,b)=>a-b);return {p50:values[Math.floor(values.length*.5)],p95:values[Math.floor(values.length*.95)],p99:values[Math.floor(values.length*.99)]};};
      return {spawned:sim.state.count,active:sim.metrics.activeCount,frameMs:summary(times),stepMs:summary(cpu),renderMs:window.crowdDebug.getFrameTimings().renderMs,walls:sim.metrics.wallOverlapCount};
    },mode);
    rows.push({count,mode,...result});console.log(JSON.stringify(rows.at(-1)));
    await page.close();
  }
  writeFileSync(arg('output','baselines/external-browser.json'),JSON.stringify({browser:browser.version(),cpu:cpus()[0]?.model,viewport:{width:1440,height:960},profile:'Headless Chromium; app CanvasRenderer; one fixed step per RAF (not catch-up); 30 warmup + 90 measurement; single observational run per case; frame intervals include display pacing, rendering and UI; no quality audit',rows},null,2));
} finally {await browser.close();}
