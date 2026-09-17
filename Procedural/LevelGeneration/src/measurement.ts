import {generateDocument,documentCatalog} from './core/generate-document';
import type {EnvironmentExecution} from './core/environment-generation';
import type {ExecutionTelemetry} from './core/environment-cache';
import type {GenerationResult} from './core/generate';
import type {GenerationDocument} from './core/document';
import type {Viewer} from './viewer';
export interface Timings {
  analysis: number;
  selection: number;
  rendererSync: number;
  total: number;
  generationCalls: number;
  viewerSyncCalls: number;
  stages: Record<string,number>;
  telemetry?:ExecutionTelemetry;
}
export function measuredGeneration(
  document: GenerationDocument,
  viewer: Viewer,
): { result: GenerationResult; timings: Timings; execution:EnvironmentExecution } {
  const start=performance.now(),starts:Record<string,number>={},stages:Record<string,number>={};
  let telemetry:ExecutionTelemetry|undefined;
  const result=generateDocument(document,{mode:"complete",telemetry:t=>telemetry=t,stageHook(stage,edge){
    if(edge==='start') starts[stage]=performance.now(); else stages[stage]=performance.now()-starts[stage];
  }});
  const execution:EnvironmentExecution={mode:"complete",stages:result.environment!.stages,result};
  const selected=performance.now();
  viewer.sync(result,documentCatalog(document),document);
  const synced=performance.now();
  return {result,execution,timings:{analysis:stages.analysis??0,selection:selected-start-(stages.analysis??0),rendererSync:synced-selected,total:synced-start,generationCalls:1,viewerSyncCalls:1,stages,telemetry}};
}

export const percentile=(values:number[],p:number)=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*p)-1];
export interface MeasurementSample {
 runKind:'application-cold'|'warm-repeat'|'first-road-edit'|'first-area-edit';operation:'none'|'road-add'|'road-remove'|'area-remove';
 inputBeforeSignature:string;inputAfterSignature:string;outputSignature:string;editId?:number;
 initializationState:{plannerCacheEntries:number;geometryCacheEntries:number;startupGenerationCount:number};
 totalMs:number;commandAndHistoryMs:number;rendererSyncMs:number;stages:Record<string,number>;
 generationCalls:number;viewerSyncCalls:number;historyCommitCalls:number;telemetry?:ExecutionTelemetry;parkingQuality:unknown;
}
export async function benchmark(run:()=>MeasurementSample,progress:(text:string)=>void){const samples:MeasurementSample[]=[];for(let i=0;i<60;i++){progress(`현재 입력 · 준비 10회 / 측정 50회 (${i+1}/60)`);const sample=run();if(i>=10)samples.push(sample);await new Promise<void>(r=>requestAnimationFrame(()=>r()));}const totals=samples.map(s=>s.totalMs);return {protocol:{warmup:10,samples:50,scope:'acceptance through generation, Viewer sync, history and accepted publication'},rows:[{name:'current-input',timings:{total:{p50:percentile(totals,.5),p95:percentile(totals,.95),max:Math.max(...totals)}},samples}]};}
export type BenchmarkReport=Awaited<ReturnType<typeof benchmark>>;
