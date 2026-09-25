import { CrowdSimulation, DEFAULT_CONFIG } from '../src/core/simulation';
import { ExternalContactSolver } from '../src/core/external-contact-solver';
import { ContactKernel } from '../src/core/contact-kernel';
import type { CrowdMovementInput } from '../src/core/crowd-movement-solver';
import { getScenario } from '../src/scenarios/scenarios';
import { scaleScenario } from '../src/scenarios/lab-scenarios';
import { readFileSync,writeFileSync,mkdirSync,readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

const arg=(n:string,d:string)=>process.argv.find(a=>a.startsWith(`--${n}=`))?.slice(n.length+3)??d;
const hash=()=>{
  const h=createHash('sha256');
  const walk=(p:string)=>{for(const e of readdirSync(p,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
    const f=`${p}/${e.name}`;if(e.isDirectory())walk(f);else{h.update(`/${f}`);h.update(readFileSync(f));}
  }};walk('src');return h.digest('hex');
};
const sourceSha256=hash();
const fixture=arg('fixture','baselines/frame-20260926/adaptive-quality.json.gz');
const report=JSON.parse(gunzipSync(readFileSync(fixture)).toString('utf8'));
const mode=arg('mode','wind'),row=report.rows.find((r:{mode:string;seed:number})=>r.mode===mode&&r.seed===42);
if(!row)throw new Error('Missing recorded input.');
const sim=new CrowdSimulation({...DEFAULT_CONFIG,...row.initial.config},scaleScenario(getScenario(row.scenario),Math.sqrt(row.agents/1000)));
const seen=new WeakSet<ContactKernel>();
const rows:Array<{tick:number;pass:number;agents:number;pairs:number;unchangedBodies:number;quietPairs:number}>=[];
let pass=0;
type ProbePrototype={buildVelocityWorkset:(input:CrowdMovementInput,dt:number,kernel?:ContactKernel)=>void;
  buildPairs:(input:CrowdMovementInput,...args:unknown[])=>void;
  pairA:Int32Array;pairB:Int32Array;pairCount:number};
const proto=ExternalContactSolver.prototype as unknown as ProbePrototype,original=proto.buildVelocityWorkset;
const originalPairs=proto.buildPairs,colorRows:Array<{tick:number;pairs:number;colors:number;maximumDegree:number;counts:number[];overflow:boolean}>=[];
const masks=new Uint32Array(sim.state.count*8),degrees=new Uint32Array(sim.state.count),counts=new Uint32Array(256);
proto.buildPairs=function(input,...args) {
  originalPairs.call(this,input,...args);masks.fill(0);degrees.fill(0);counts.fill(0);
  let colors=0,overflow=false;
  for(let pair=0;pair<this.pairCount;pair++) {
    const a=this.pairA[pair]!,b=this.pairB[pair]!;degrees[a]=degrees[a]!+1;degrees[b]=degrees[b]!+1;
    let word=0,available=0;
    for(;word<8;word++){available=~(masks[a*8+word]!|masks[b*8+word]!);if(available)break;}
    if(word===8){overflow=true;continue;}
    const bit=available&-available,color=word*32+31-Math.clz32(bit);
    masks[a*8+word]=masks[a*8+word]!|bit;masks[b*8+word]=masks[b*8+word]!|bit;
    counts[color]=counts[color]!+1;colors=Math.max(colors,color+1);
  }
  let maximumDegree=0;for(const d of degrees)maximumDegree=Math.max(maximumDegree,d);
  colorRows.push({tick:sim.stepCount,pairs:this.pairCount,colors,maximumDegree,counts:[...counts.subarray(0,colors)],overflow});
};
proto.buildVelocityWorkset=function(input,dt,kernel) {
  if(kernel&&!seen.has(kernel)) {
    seen.add(kernel);const exports=kernel.exports,oldX=new Float64Array(sim.state.count),oldY=new Float64Array(sim.state.count);
    Object.defineProperty(kernel,'exports',{value:{...exports,velocity:(count:number,delta:number,friction:number,motor:number)=>{
      const a=kernel.arrays;oldX.set(a.vx);oldY.set(a.vy);
      const result=exports.velocity(count,delta,friction,motor);
      let unchangedBodies=0,quietPairs=0;
      for(let i=0;i<oldX.length;i++)if(oldX[i]===a.vx[i]&&oldY[i]===a.vy[i])unchangedBodies++;
      for(let slot=0;slot<count;slot++) {
        const pair=a.velocityPairs[slot]!,i=a.a[pair]!,j=a.b[pair]!;
        if(oldX[i]===a.vx[i]&&oldY[i]===a.vy[i]&&oldX[j]===a.vx[j]&&oldY[j]===a.vy[j])quietPairs++;
      }
      rows.push({tick:sim.stepCount,pass:pass++,agents:oldX.length,pairs:count,unchangedBodies,quietPairs});return result;
    }}});
  }
  original.call(this,input,dt,kernel);
};
const ticks=Number(arg('ticks','180'));
try {
  for(let tick=0;tick<ticks;tick++) {
    pass=0;
    for(const command of row.commands)if(command.tick===tick)sim.enqueueExternal(structuredClone(command));
    sim.step();
  }
} finally {proto.buildVelocityWorkset=original;proto.buildPairs=originalPairs;}
const output=arg('output','test-results/contact-activity.json');mkdirSync(dirname(output),{recursive:true});
writeFileSync(output,JSON.stringify({schema:'crowd-contact-activity-probe-v1',sourceSha256,sourceStable:hash()===sourceSha256,
  fixture,mode,ticks,hash:sim.stateHash(),active:sim.metrics.activeCount,
  caveat:'Diagnostic only. End-of-pass equality is an optimistic upper bound for exact dirty-pair skipping: intermediate changes/cancellation and later static/proxy responses are not captured. Greedy graph colors do not change actual iteration order in this probe. No computation was skipped; timings are not acceptance data.',colorRows,rows},null,2));
console.log(JSON.stringify({rows:rows.length,quietRatio:rows.reduce((n,r)=>n+r.quietPairs,0)/rows.reduce((n,r)=>n+r.pairs,0),hash:sim.stateHash()}));
