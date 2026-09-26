import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { CrowdSimulation } from '../src/core/simulation';
import { getScenario } from '../src/scenarios/scenarios';
import { scaleScenario } from '../src/scenarios/lab-scenarios';

const arg=(name:string,fallback:string)=>process.argv.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3)??fallback;
const reference=resolve(arg('reference','test-results/native-reference'));
function sourceHash(root:string):string {
  const hash=createHash('sha256');
  const walk=(path:string)=>{for(const entry of readdirSync(path,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
    const file=`${path}/${entry.name}`;if(entry.isDirectory())walk(file);else{hash.update(file.slice(root.length));hash.update(readFileSync(file));}
  }};
  walk(`${root}/src`);return hash.digest('hex');
}
const actualSourceSha256=sourceHash(resolve('.')),referenceSourceSha256=sourceHash(reference);
const fixture=arg('fixture','baselines/frame-20260926/rocky-ui-quality.json.gz');
const mode=arg('mode','wind'),seed=Number(arg('seed','42'));
const selectedScenario=arg('scenario',''),selectedAgents=Number(arg('agents','0'));
const data=readFileSync(fixture),report=JSON.parse((fixture.endsWith('.gz')?gunzipSync(data):data).toString('utf8'));
const row=report.schema==='crowd-external-diagnostic-v1'
  ? {...report,agents:report.count,initial:{config:report.config}}
  : report.rows.find((r:{mode:string;seed:number;scenario:string;agents:number})=>r.mode===mode&&r.seed===seed
    &&(!selectedScenario||r.scenario===selectedScenario)&&(!selectedAgents||r.agents===selectedAgents));
if(!row||row.mode!==mode||row.seed!==seed||!Array.isArray(row.commands))throw new Error('No matching recorded input fixture.');
const legacy=await import(pathToFileURL(resolve(reference,'src/core/simulation.ts')).href);
if(legacy.CrowdSimulation===CrowdSimulation)throw new Error('Reference resolved to the candidate module.');
const scenario=scaleScenario(getScenario(row.scenario),Math.sqrt(row.agents/1000));
const actual=new CrowdSimulation(structuredClone(row.initial.config),structuredClone(scenario));
const expected=new legacy.CrowdSimulation(structuredClone(row.initial.config),structuredClone(scenario)) as CrowdSimulation;
const referenceBackend=arg('reference-backend','auto');
if(referenceBackend!=='auto'&&referenceBackend!=='js')throw new Error('Unknown reference backend.');
// Archived references may expose a historical execution backend selector.
if('backend' in expected.external)expected.external.backend=referenceBackend;
const hashes:string[]=[],ticks=Number(arg('ticks',String(row.steps?.length??row.ticks)));
let comparedBytes=0;
for(let tick=0;tick<ticks;tick++) {
  for(const command of row.commands)if(command.tick===tick) {
    actual.enqueueExternal(structuredClone(command));expected.enqueueExternal(structuredClone(command));
  }
  actual.step();expected.step();
  for(const owner of ['state','previousState'] as const)for(const [name,view] of Object.entries(actual[owner])) {
    if(!ArrayBuffer.isView(view))continue;
    const other=expected[owner][name as keyof typeof expected.state] as ArrayBufferView;
    const left=Buffer.from(view.buffer,view.byteOffset,view.byteLength),right=Buffer.from(other.buffer,other.byteOffset,other.byteLength);
    comparedBytes+=left.byteLength;
    if(!left.equals(right))throw new Error(`State byte difference at tick ${tick}: ${owner}.${name}`);
  }
  for(const name of ['direct'] as const)if(!Buffer.from(actual.external[name]).equals(Buffer.from(expected.external[name])))throw new Error(`Flag difference at tick ${tick}: ${name}`);
  const hash=actual.stateHash();
  if(hash!==expected.stateHash())throw new Error(`Hash difference at tick ${tick}`);
  hashes.push(hash);
}
if(JSON.stringify(actual.external.record())!==JSON.stringify(expected.external.record()))throw new Error('Recorded command mismatch.');
const output=arg('output','test-results/native-state-comparison.json');mkdirSync(dirname(output),{recursive:true});
writeFileSync(output,JSON.stringify({schema:'crowd-byte-comparison-v1',fixture,reference,actualSourceSha256,referenceSourceSha256,
  sourceStable:actualSourceSha256===sourceHash(resolve('.'))&&referenceSourceSha256===sourceHash(reference),scenario:row.scenario,agents:row.agents,seed,mode,ticks,
  comparedBytes,referenceBackend,actualActive:actual.metrics.activeCount,referenceActive:expected.metrics.activeCount,
  profile:`Headless exact optimization comparison; recorded ${row.inputSource??'HTTP UI'} inputs. Not a performance or independent geometry result.`,
  mismatches:0,commands:actual.external.record(),hashes},null,2));
console.log(JSON.stringify({ticks,comparedBytes,mismatches:0,hash:hashes.at(-1)}));
