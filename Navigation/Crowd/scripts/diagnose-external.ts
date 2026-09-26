import { CrowdSimulation, DEFAULT_CONFIG } from '../src/core/simulation';
import { scaleScenario } from '../src/scenarios/lab-scenarios';
import { getScenario } from '../src/scenarios/scenarios';
import { auditGeometry } from '../src/core/lab-results';
import { distanceSquaredToRect } from '../src/core/obstacle-collision';
import { writeFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { cpus } from 'node:os';
import { execFileSync } from 'node:child_process';
import { ExternalContactSolver } from '../src/core/external-contact-solver';
import type { CrowdMovementInput } from '../src/core/crowd-movement-solver';
const arg=(name:string,fallback:string)=>process.argv.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3)??fallback;
const count=Number(arg('agents','10000')), scale=Math.sqrt(count/1000), ticks=Number(arg('ticks','180'));
const mode=arg('mode','wind');
const sourceHash=()=>{
  const hash=createHash('sha256');
  const walk=(path:string)=>{for(const entry of readdirSync(path,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
    const file=`${path}/${entry.name}`;if(entry.isDirectory())walk(file);else{hash.update(`/${file}`);hash.update(readFileSync(file));}
  }};
  walk('src');return hash.digest('hex');
};
const workingSourceSha256=sourceHash();
const commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(arg('trace-wall','')!=='') {
  const proto=ExternalContactSolver.prototype as unknown as {move:(input:CrowdMovementInput,a:number,dx:number,dy:number,physical:boolean,dt:number)=>void};
  const original=proto.move,target=Number(arg('trace-wall','0'));
  proto.move=function(input,a,dx,dy,physical,dt) {
    const x=input.next.x[a]!,y=input.next.y[a]!;
    original.call(this,input,a,dx,dy,physical,dt);
    if(a!==target)return;
    const radius=(input.agentRadii?.[a]??input.agentRadius)+input.wallClearance-input.agentRadius;
    for(const rect of input.obstacles) {
      const before=radius-Math.sqrt(distanceSquaredToRect(x,y,rect));
      const after=radius-Math.sqrt(distanceSquaredToRect(input.next.x[a]!,input.next.y[a]!,rect));
      if(before<=1e-6&&after>1e-6)throw new Error(JSON.stringify({x,y,dx,dy,physical,dt,radius,rect,endX:input.next.x[a],endY:input.next.y[a],before,after}));
    }
  };
}
const sim=new CrowdSimulation({...DEFAULT_CONFIG,agentCount:count,width:1200*scale,height:720*scale,seed:Number(arg('seed','42'))},scaleScenario(getScenario(arg('scenario','rocky-pass')),scale));
const rows=[];
const peaks:Record<string,number>={};
let minimumActive=count,maximumRuntimeWalls=0;
let proxyX=0, foundWall=false;
for(let tick=0;tick<ticks;tick++) {
  const spawn=sim.scenario.spawn,x=Number(arg('x',String(spawn.x+spawn.width*.5))),y=Number(arg('y',String(spawn.y+spawn.height*.5))),generation=sim.external.generation;
  if(tick===30) {
    if(mode==='wind')sim.enqueueExternal({kind:'acceleration',id:'wind',tick,generation,target:{x,y,radius:100},ax:500,ay:0,endTick:90});
    if(mode==='blast')sim.enqueueExternal({kind:'blast',id:'blast',tick,generation,x,y,radius:100,speed:400});
    proxyX=Math.min(...sim.state.x)-24;
  }
  if(mode==='proxy'&&tick>=30&&tick<120)sim.enqueueExternal({kind:'proxy',id:`proxy-${tick}`,body:'vehicle',tick,generation,x:proxyX+(tick-30)*4,y:360*scale,toX:proxyX+(tick-29)*4,toY:360*scale,radius:18});
  if(mode==='proxy'&&tick===120)sim.enqueueExternal({kind:'remove-proxy',id:'remove',body:'vehicle',tick,generation});
  const start=performance.now();sim.step();const ms=performance.now()-start;
  minimumActive=Math.min(minimumActive,sim.metrics.activeCount);
  maximumRuntimeWalls=Math.max(maximumRuntimeWalls,sim.metrics.wallOverlapCount);
  for(const [key,value] of Object.entries(sim.external.stats))peaks[key]=Math.max(peaks[key]??0,value);
  if(sim.metrics.wallOverlapCount&&!foundWall) {
    foundWall=true;
    for(let a=0;a<count;a++)for(const rect of sim.scenario.obstacles) {
      const clearance=sim.agentRadii[a]!+sim.config.wallMargin;
      const depth=clearance-Math.sqrt(distanceSquaredToRect(sim.state.x[a]!,sim.state.y[a]!,rect));
      if(depth>1e-6)console.log(JSON.stringify({firstWall:{tick,a,depth,x:sim.state.x[a],y:sim.state.y[a],previousX:sim.previousState.x[a],previousY:sim.previousState.y[a],rect}}));
    }
  }
  if(tick%10!==0&&tick!==29&&tick!==30&&!sim.external.stats.positionBudgetExhaustions&&!sim.external.stats.substepRetries)continue;
  const audit=auditGeometry(sim);
  const witness=audit.maxPair,pair=witness?[witness.a,witness.b]:[];
  const row={tick,ms,penetration:audit.maxPenetration,maxProxyPenetration:audit.maxProxyPenetration,nonfinite:audit.nonfinite,
    pair,positions:pair.map(a=>({x:sim.state.x[a],y:sim.state.y[a],vx:sim.state.vx[a],vy:sim.state.vy[a]})),
    walls:audit.walls,active:sim.metrics.activeCount,stats:{...sim.external.stats},passes:{...sim.experimentStats.passMs}};
  rows.push(row);console.log(JSON.stringify(row));
}
const output=arg('output','test-results/external-diagnostic.json');mkdirSync(dirname(output),{recursive:true});
writeFileSync(output,JSON.stringify({schema:'crowd-external-diagnostic-v1',createdAt:new Date().toISOString(),commit,
  workingSourceSha256,sourceStable:sourceHash()===workingSourceSha256,cpu:cpus()[0]?.model,node:process.version,
  quality:'ON; all-neighbor published-state audit every 10 ticks and every position-budget exhaustion or retried tick; timing is diagnostic only',
  count,spawned:sim.state.count,minimumActive,maximumRuntimeWalls,ticks,scenario:sim.scenario.id,
  inputSource:'headless external API',commands:sim.external.record(),
  mode,seed:sim.config.seed,config:sim.config,peaks,rows},null,2));
