/** Headless isolation diagnostic. Intentionally relocates one body far from
 * the crowd; timings are simulation CPU, not browser frame measurements. */
import { CrowdSimulation, DEFAULT_CONFIG } from '../src/core/simulation';
import { scaleScenario } from '../src/scenarios/lab-scenarios';
import { getScenario } from '../src/scenarios/scenarios';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const arg=(name:string,fallback:string)=>process.argv.find(s=>s.startsWith(`--${name}=`))?.slice(name.length+3)??fallback;
const count=Number(arg('agents','6000')),ticks=Number(arg('ticks','300')),repeats=Number(arg('repeats','3'));
const output=arg('output','test-results/local-push.json');
function sourceHash(){
  const hash=createHash('sha256');
  const walk=(path:string)=>{for(const entry of readdirSync(path,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
    const file=`${path}/${entry.name}`;if(entry.isDirectory())walk(file);else{hash.update(`/${file}`);hash.update(readFileSync(file));}
  }};walk('src');return hash.digest('hex');
}
const workingSourceSha256=sourceHash(),rows=[];
for(let repeat=0;repeat<repeats;repeat++)for(const mode of ['none','blast']){
  const scale=Math.sqrt(count/1000);
  const sim=new CrowdSimulation({...DEFAULT_CONFIG,agentCount:count,width:1200*scale,height:720*scale},scaleScenario(getScenario('open-field'),scale));
  let nearestOtherAtInput=0,directHits=0;const samples=[];
  for(let tick=0;tick<ticks;tick++) {
    if(tick===30){
      const x=sim.config.width*.8,y=sim.config.height*.1;
      sim.state.x[0]=x;sim.state.y[0]=y;sim.state.vx[0]=0;sim.state.vy[0]=0;sim.state.heading[0]=0;
      nearestOtherAtInput=Infinity;
      for(let a=1;a<sim.state.count;a++)nearestOtherAtInput=Math.min(nearestOtherAtInput,Math.hypot(sim.state.x[a]!-x,sim.state.y[a]!-y));
      if(mode==='blast')sim.enqueueExternal({kind:'blast',id:'isolated',tick,generation:sim.external.generation,x:x-1,y,radius:10,speed:400});
    }
    const start=performance.now();sim.step();const ms=performance.now()-start;
    directHits+=sim.external.stats.affected;
    samples.push({tick,ms,active:sim.metrics.activeCount,direct:sim.external.stats.affected,
      ongoingInput:sim.external.active,candidates:sim.metrics.candidateChecks,
      constraints:sim.metrics.contactConstraints,iterations:sim.metrics.constraintIterations});
  }
  rows.push({repeat,mode,count,spawned:sim.state.count,nearestOtherAtInput,directHits,commands:sim.external.record(),samples});
  sim.dispose();
  mkdirSync(dirname(output),{recursive:true});
  writeFileSync(output,JSON.stringify({workingSourceSha256,sourceStable:sourceHash()===workingSourceSha256,
    profile:'Headless CPU; audit OFF; seed42; default radius/dt; one deliberately isolated body relocated at tick30 in both controls; not an HTTP/FPS measurement',rows}));
  console.log(JSON.stringify({repeat,mode,directHits,nearestOtherAtInput}));
}
