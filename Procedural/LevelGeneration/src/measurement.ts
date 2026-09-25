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
  rendererStages?:Record<string,number>;
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
  return {result,execution,timings:{analysis:stages.analysis??0,selection:selected-start-(stages.analysis??0),rendererSync:synced-selected,total:synced-start,generationCalls:1,viewerSyncCalls:1,stages,rendererStages:viewer.lastSyncStages,telemetry}};
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

/** Opt-in UI latency samples. Time ends at CPU render submission, not GPU completion/paint. */
export interface BuildingEditSample {
  id:number; input:'key'|'drag'; mode:'add'|'remove'; selectionCells:number;
  inputStartedAt:number; handlerStartedAt:number; editStartedAt:number;
  inputQueueMs:number; inputHandlingMs:number; synchronousMs:number;
  cellsBefore:number; cellsAfter:number; initializationState:MeasurementSample['initializationState'];
  steps:Record<string,number>; generation?:Timings;
  inputToRenderMs?:number; renderSubmissionMs?:number; supersededBeforeRender?:boolean;
}

export class BuildingEditMeasurement {
  readonly samples:BuildingEditSample[]=[];
  active?:BuildingEditSample;
  private input?:{kind:'key'|'drag';startedAt:number;handlerAt:number};
  private pending:BuildingEditSample[]=[];
  private nextId=0;
  constructor(){
    // Capture precedes SurfaceInteraction's bubble handlers, including every drag step.
    document.addEventListener('keydown',event=>{
      if(!event.ctrlKey&&!event.metaKey&&!event.altKey&&['e','q'].includes(event.key.toLowerCase()))this.capture('key',event);
    },true);
    document.addEventListener('pointermove',event=>this.capture('drag',event),true);
  }
  private capture(kind:'key'|'drag',event:Event){this.input={kind,startedAt:event.timeStamp,handlerAt:performance.now()};}
  begin(mode:'add'|'remove',selectionCells:number,cellsBefore:number,initializationState:BuildingEditSample['initializationState']){
    const editStartedAt=performance.now(),input=this.input??{kind:'key' as const,startedAt:editStartedAt,handlerAt:editStartedAt};
    this.active={id:++this.nextId,input:input.kind,mode,selectionCells,inputStartedAt:input.startedAt,handlerStartedAt:input.handlerAt,editStartedAt,inputQueueMs:input.handlerAt-input.startedAt,inputHandlingMs:editStartedAt-input.handlerAt,synchronousMs:0,cellsBefore,cellsAfter:cellsBefore,initializationState,steps:{}};
  }
  time<T>(stage:string,run:()=>T):T{
    const sample=this.active;if(!sample)return run();const start=performance.now();
    try{return run();}finally{sample.steps[stage]=(sample.steps[stage]??0)+performance.now()-start;}
  }
  finish(cellsAfter:number,generation:Timings|undefined){
    const sample=this.active;this.active=undefined;if(!sample||cellsAfter===sample.cellsBefore)return;
    sample.cellsAfter=cellsAfter;sample.generation=generation;sample.synchronousMs=performance.now()-sample.inputStartedAt;
    this.samples.push(sample);if(this.samples.length>256)this.samples.shift();this.pending.push(sample);
  }
  rendered(renderSubmissionMs:number){
    const now=performance.now();for(const sample of this.pending){sample.inputToRenderMs=now-sample.inputStartedAt;sample.renderSubmissionMs=renderSubmissionMs;sample.supersededBeforeRender=sample!==this.pending.at(-1);}
    this.pending=[];
  }
  reset(){this.samples.length=0;this.pending=[];}
}
