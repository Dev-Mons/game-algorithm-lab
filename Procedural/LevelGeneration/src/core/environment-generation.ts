import {ENVIRONMENT} from './environment-settings';
import type {BuildingRuleInput} from './building-rule-contract';
import {environmentCache,type EnvironmentCache,type ExecutionTelemetry} from './environment-cache';
import {cloneJSON,immutableJSON} from './canonical';
import {FACADE_ASSETS,type FacadeAssetKey} from "./facade-assets";
import {planFixtures} from "./fixture-plan";
import {planFacadeTrims} from "./facade-trims";
import {selectCompleteFaceAsset} from './complete-face-assets';
import {validateAssembly} from "./modules";
import {planParkingStalls} from "./parking-stalls";
import {parkingPlacements} from "./parking-placement";
import {planEntrances} from "./entrance-plan";
import {faceAssetBounds} from "./placement-bounds";
import {compareCells} from "./analysis";
import {planParkingCirculation} from "./parking-circulation";
import {vegetationPlacements} from "./scene-inputs";
import {sceneBounds16} from "./placement-bounds";
import {planVertical} from "./vertical-design";
import {planFacade} from './facade-plan';
import {planWallFacilities} from './wall-facilities';
import {planColumns} from './column-prototype';
import {faceBounds16} from "./placement-bounds";
import {faceCenter2} from "./analysis";
import {analyzeSpatial} from "./spatial-analysis";
import {AccessSearch} from "./access-graph";
import {cellId} from "./analysis";
import { loadDocument, canonicalJSON, documentOptions, type GenerationDocument } from "./document";
import { analyzeVolume } from "./regions";
import type {AnalysisComponent} from "./analysis";
import { resolveBuildingRule } from "./building-rules";
import { preflightRule, assertOutputBounds,envelopeIndex,preparePreflightAnalysis,preparePreflightInput } from "./rule-spatial-adapters";
import { scenePlacementBounds16 } from "./placement-bounds";
import { roadPlacements } from "./roads";
import type { GenerationResult } from "./generate";
import type { EnvironmentStage, StageReport } from "./environment-contract";

export interface ExecutionOptions {
  cache?:EnvironmentCache|false;
  telemetry?:(telemetry:ExecutionTelemetry)=>void;
  mode?: "complete" | "development-preview";
  stageHook?: (stage:EnvironmentStage | "analysis", edge:"start"|"end")=>void;
}
export interface EnvironmentExecution { mode:"complete"|"development-preview"; stages:StageReport[]; result:GenerationResult }
export interface AcceptedEditorState {document:GenerationDocument;execution:EnvironmentExecution}
const order:EnvironmentStage[]=["vertical","preflight","spatial","parkingCirculation","entrances","parkingStalls","facade","fixtures","attachments"];

/** Authoritative document execution. Unimplemented stages never produce pretend plans. */
export function executeEnvironment(input:GenerationDocument, options:ExecutionOptions={}):EnvironmentExecution {
  const cache=options.cache===false?undefined:options.cache??environmentCache;let actualExpansions=0;
  let resolvedDocument=cache?.getByIdentity<GenerationDocument>('document',input);
  if(!resolvedDocument){const inputText=canonicalJSON(input),documentKey='document:'+inputText,hit=cache?.get<GenerationDocument>(documentKey);resolvedDocument=hit??loadDocument(inputText);if(cache&&!hit)cache.putImmutable(documentKey,resolvedDocument,resolvedDocument);}
  const document=resolvedDocument;
  const mode=options.mode??"complete";
  const measure=<T>(stage:EnvironmentStage|"analysis",run:()=>T):T=>{
    options.stageHook?.(stage,"start");try{return run();}finally{options.stageHook?.(stage,"end");}
  };
  const {analysis,components}=measure('analysis',()=>{
    type Snapshot={summary:Omit<ReturnType<typeof analyzeVolume>,'cells'>;components:{id:string;indices:number[]}[]};
    const identityHit=cache?.getByIdentity<Snapshot>('analysis-partition',document.grid),key=identityHit?undefined:cache?.key('analysis-partition',{grid:document.grid,policy:'region-context-v1'});
    const hit=identityHit??(key?cache!.get<Snapshot>(key):undefined);
    if(hit)return {analysis:{...hit.summary,cells:document.grid},components:hit.components.map(p=>({id:p.id,cells:p.indices.map(i=>document.grid[i])}))};
    let components:AnalysisComponent[]=[];const analysis=analyzeVolume(document.grid,'region-context-v1',parts=>components=parts);
    if(key){const {cells,...summary}=analysis,indices=new Map(cells.map((c,i)=>[c,i]));cache!.putImmutable(key,{summary,components:components.map(p=>({id:p.id,indices:p.cells.map(c=>indices.get(c)!)}))},document.grid);}
    return {analysis,components};
  });
  const originals=[...document.grid,...document.sceneInputs.roads,...document.sceneInputs.objects.flatMap(o=>o.cells),...document.sceneInputs.parkingAreas.flatMap(p=>p.cells)];
  const reports=new Map<EnvironmentStage,StageReport>();
  const report=(stage:EnvironmentStage,state:StageReport["state"],...reasonCodes:string[])=>reports.set(stage,{stage,state,reasonCodes});
  const contextual=document.buildings.some(b=>b.rule.definition.portals==="planned");
  const vertical=measure('vertical',()=>components.filter(c=>document.buildings.find(b=>b.componentId===c.id)!.rule.definition.portals==='planned').map(c=>{
    const b=document.buildings.find(b=>b.componentId===c.id)!;return planVertical(c.id,c.cells,analysis.surfaces,b.design,b.theme??document.buildingDefinition,document.seed);
  }));
  report('vertical',vertical.length?'ready':'not-applicable');
  const preflight:NonNullable<GenerationResult["environment"]>["preflight"]=[];
  let preflightCalls=0;
  measure("preflight",()=>{
    if(components.length)preparePreflightAnalysis(analysis);
    for(const component of components) {
      const entry=document.buildings.find(b=>b.componentId===component.id)!;
      resolveBuildingRule(entry.rule);
      try {
        preflightCalls++;
        const envelope=preflightRule(entry.rule,entry.spatialAdapterRef,preparePreflightInput({componentId:component.id,cells:component.cells,analysis,options:{...documentOptions(document),architecture:entry.theme??document.buildingDefinition},metadata:entry.rule.metadata,design:entry.design}),originals);
        preflight.push({buildingId:component.id,envelope});
      } catch(error) {
        if(!(error instanceof Error)||!error.message.startsWith("ENV_PIPELINE_NOT_READY:")) throw error;
        report("preflight","not-implemented",error.message);
      }
    }
    if(!reports.has("preflight")) report("preflight",components.length?"ready":"not-applicable");
  });
  const hasSpatial=originals.length>0, hasParking=document.sceneInputs.parkingAreas.length>0, hasFixtures=document.sceneInputs.objects.some(o=>o.category!=="vegetation");
  const spatialReady=preflight.length===components.length;
  const spatialRun=spatialReady?measure('spatial',()=>analyzeSpatial(document,analysis,preflight,components)):undefined;
  report('spatial',!hasSpatial?'not-applicable':spatialReady?'ready':'blocked',...(spatialReady?[]:['PREFLIGHT_NOT_READY']));
  const parkingGraphKey=spatialRun?{walkNodes:spatialRun.spatial.walkNodes,walkEdges:spatialRun.spatial.walkEdges,roadArrivals:spatialRun.spatial.roadArrivals}:undefined;
  const circulation=spatialRun&&hasParking?measure('parkingCirculation',()=>{
    const key=cache?.key('circulation',{areas:document.sceneInputs.parkingAreas,roads:document.sceneInputs.roads,settings:{parking:ENVIRONMENT.parking,access:ENVIRONMENT.access,intersectionKeepoutCells:ENVIRONMENT.fixtures.intersectionKeepoutCells},spatial:parkingGraphKey,reservations:spatialRun.book.snapshot()});
    type Cached={areas:ReturnType<typeof planParkingCirculation>['areas'];book:typeof spatialRun.book};
    const hit=key?cache!.get<Cached>(key):undefined;if(hit)return {...hit,domains:undefined};
    const run=planParkingCirculation(document,spatialRun.spatial,spatialRun.book,spatialRun.solidIndex);
    actualExpansions+=run.areas.reduce((n,a)=>n+a.components.reduce((v,c)=>v+c.counters.stateExpansions,0),0);
    if(key)cache!.put<Cached>(key,{areas:run.areas,book:run.book},v=>({areas:cloneJSON(v.areas),book:v.book.clone()}));return run;
  }):undefined;
  const activeBook=circulation?.book??spatialRun?.book;
  report('parkingCirculation',!hasParking?'not-applicable':circulation?'ready':'blocked',...(hasParking&&!circulation?['SPATIAL_PLAN_NOT_READY']:[]));
  const search=spatialRun?new AccessSearch(spatialRun.spatial,document,activeBook!,spatialRun.solidIndex):undefined;
  const probeInputs=[...document.sceneInputs.objects.map(o=>({ref:{kind:'object' as const,id:o.id},cell:o.cells[0]})),...document.sceneInputs.parkingAreas.map(p=>({ref:{kind:'parking' as const,id:p.id},cell:p.cells[0]}))];
  const probes=search?probeInputs.map(p=>({...p,access:search.query(p.cell)})):[];
  const entrances=spatialRun&&activeBook?measure('entrances',()=>document.buildings.filter(b=>b.rule.definition.portals==='planned').sort((a,b)=>compareCells(a.design.anchor,b.design.anchor)||compareCells(components.find(c=>c.id===a.componentId)!.cells[0],components.find(c=>c.id===b.componentId)!.cells[0])).map(b=>planEntrances(document,b,components.find(c=>c.id===b.componentId)!.cells,analysis.surfaces,spatialRun.spatial,activeBook,spatialRun.solidIndex))):[];
  report('entrances',!contextual?'not-applicable':spatialRun?'ready':'blocked',...(contextual&&!spatialRun?['SPATIAL_PLAN_NOT_READY']:[]));
  let finalBook=activeBook;
  const parking=circulation&&spatialRun&&activeBook?measure('parkingStalls',()=>{
    const key=cache?.key('stalls',{roads:document.sceneInputs.roads,areas:document.sceneInputs.parkingAreas,settings:ENVIRONMENT.access,circulation:circulation.areas,spatial:parkingGraphKey,reservations:activeBook.snapshot()});
    type Cached={plans:ReturnType<typeof planParkingStalls>;book:typeof activeBook};
    const hit=key?cache!.get<Cached>(key):undefined;if(hit){finalBook=hit.book;return hit.plans;}
    const plans=planParkingStalls(document,circulation.areas,spatialRun.spatial,activeBook,spatialRun.solidIndex,circulation.domains);
    actualExpansions+=plans.reduce((n,a)=>n+a.plans.reduce((v,p)=>v+p.counters.stateExpansions,0),0);
    if(key)cache!.put<Cached>(key,{plans,book:activeBook},v=>({plans:cloneJSON(v.plans),book:v.book.clone()}));return plans;
  }):undefined;
  report('parkingStalls',!hasParking?'not-applicable':parking?'ready':'blocked',...(hasParking&&!parking?['CIRCULATION_NOT_READY']:[]));
  report("fixtures",hasFixtures?"blocked":"not-applicable",...(hasFixtures?["FIXTURE_PLAN_NOT_IMPLEMENTED"]:[]));
  report("attachments",contextual?"blocked":"not-applicable",...(contextual?["ATTACHMENT_PLAN_NOT_IMPLEMENTED"]:[]));
  const tileLookup=new Map(document.catalog.tiles.map(t=>[t.tileId,t]));
  const portalFacesForFacilities=new Set(entrances.flatMap(e=>e.entrances.flatMap(p=>p.faceIds)));
  const wallFacilities=finalBook?planWallFacilities(document,analysis.surfaces,vertical,portalFacesForFacilities,finalBook):undefined;
  const facadeFixed=new Set([...portalFacesForFacilities,...(wallFacilities?.changes.map(c=>c.faceId)??[])]);
  const columnFixed=new Set([...facadeFixed,...analysis.surfaces.filter(s=>s.architecture?.interpretation==='unsupported').map(s=>s.faceId),...(wallFacilities?.groups.filter(g=>g.accepted).flatMap(g=>g.faceIds)??[])]);
  const columns=vertical.map(v=>{const b=document.buildings.find(b=>b.componentId===v.buildingId)!,style=b.theme??document.buildingDefinition;return planColumns(v.buildingId,components.find(c=>c.id===v.buildingId)!.cells,analysis.surfaces,style.programs?'auto':'building',columnFixed);});
  const columnFaces=new Set(columns.flatMap(c=>c.faces.map(f=>f.faceId)));columnFaces.forEach(id=>facadeFixed.add(id));
  const facades=vertical.flatMap(v=>{const style=document.buildings.find(b=>b.componentId===v.buildingId)!.theme??document.buildingDefinition;return style.facadeGrammar?[planFacade(analysis.surfaces,v,style.facadeGrammar,facadeFixed)]:[];});
  const generated:GenerationResult[]=[];
  measure("facade",()=>{
    for(const component of components) {
      const entry=document.buildings.find(b=>b.componentId===component.id)!;
      const envelope=preflight.find(p=>p.buildingId===component.id)?.envelope;
      if(!envelope) continue;const outputBounds=envelopeIndex(envelope);
      const part={...analysis,...(entry.rule.id==='standard-contextual'?{cells:component.cells,features:[]}:{}),surfaces:analysis.surfaces.filter(s=>s.componentId===component.id),regions:analysis.regions?.filter(r=>r.componentId===component.id)};
      const currentVertical=vertical.find(v=>v.buildingId===component.id),currentEntrances=entrances.find(e=>e.buildingId===component.id);
      const geometryVertical=currentVertical?(({traces,...plan})=>plan)(currentVertical):undefined,geometryEntrances=currentEntrances?(({traces,reservations,...plan})=>plan)(currentEntrances):undefined;
      const ruleInput:BuildingRuleInput={componentId:component.id,cells:component.cells,analysis:part,options:{...documentOptions(document),architecture:entry.theme??document.buildingDefinition},metadata:entry.rule.metadata,context:{design:entry.design,columns:columns.find(c=>c.buildingId===component.id),facadeChanges:wallFacilities?.changes,facadePlan:facades.find(f=>f.buildingId===component.id),sourceRefs:[{kind:"building",id:component.id}],reservations:finalBook?.snapshot(entry.rule.id==='standard-contextual'?new Set([`solid:building:${component.id}`]):undefined)??[],envelope,verticalBands:entry.rule.id==='standard-contextual'?geometryVertical:currentVertical,entrances:entry.rule.id==='standard-contextual'?geometryEntrances:currentEntrances}};
      immutableJSON(ruleInput);
      // Panel templates contain only a few role/direction decisions. Evaluate
      // them inline without a full-catalog cache key; retain the bounded cache
      // for document/volume analysis and spatial plans.
      const result:GenerationResult=resolveBuildingRule(entry.rule).generate(ruleInput);
      if(result.status==='error')throw new Error('INVALID_BUILDING_OUTPUT');
      if(result.modules?.length)throw new Error('RULE_OUTPUT_BOUNDS_UNKNOWN');
      const portalFaces=new Set(entrances.find(e=>e.buildingId===component.id)?.entrances.flatMap(e=>e.faceIds)??[]);
      for(const p of result.placements){
        const tile=tileLookup.get(p.tileId);if(!tile)throw new Error('RULE_OUTPUT_BOUNDS_UNKNOWN');
        assertOutputBounds(tile.assetKey,faceBounds16(faceAssetBounds(tile.assetKey),p.position2,p.orientationId),envelope,false,outputBounds);
        if((tile.assetKey.includes('portal-')||tile.assetKey.includes('entry'))&&!portalFaces.has(p.faceId))throw new Error('UNPLANNED_PORTAL_OUTPUT');
      }
      for(const p of result.scenePlacements??[]) {
        const bounds=scenePlacementBounds16(p);
        assertOutputBounds(p.asset,bounds,envelope,false,outputBounds);
        p.worldBounds16=bounds;p.sourceRefs=[{kind:"building",id:component.id}];p.planId=`structure:${component.id}`;p.yawQuarterTurns??=0;
      }
      generated.push(result);
    }
    report("facade",!components.length?"not-applicable":generated.length===components.length?"ready":"blocked",...(generated.length<components.length?["PREFLIGHT_NOT_READY"]:[]));
  });
  const wallMounts=new Map<string,{outset16:number;ownerId:string}>();
  const faceLookup=new Map(analysis.surfaces.map(s=>[s.faceId,s]));
  for(const r of generated)for(const p of r.placements){const tile=tileLookup.get(p.tileId)!,asset=FACADE_ASSETS[tile.assetKey as FacadeAssetKey],face=faceLookup.get(p.faceId);
    if(!face||face.role!=='wall')continue;
    if(tile.assetKey==='facade.wall'||tile.assetKey==='crafted.plaster')wallMounts.set(p.faceId,{outset16:0,ownerId:face.componentId});
    else if(asset&&'pierWidth16' in asset&&asset.pierWidth16)wallMounts.set(p.faceId,{outset16:2,ownerId:face.componentId});
  }
  const fixtures=hasFixtures&&spatialRun&&finalBook?measure('fixtures',()=>planFixtures(document,analysis,spatialRun.spatial,finalBook!,spatialRun.solidIndex,parking??[],wallMounts)):undefined;
  report('fixtures',!hasFixtures?'not-applicable':fixtures?'ready':'blocked',...(hasFixtures&&!fixtures?['SPATIAL_PLAN_NOT_READY']:[]));
  const trims=contextual&&spatialRun&&finalBook&&(!hasFixtures||fixtures)?measure('attachments',()=>planFacadeTrims(document,analysis.surfaces,vertical.map(v=>({...v,boundaries:v.boundaries.filter(b=>!columnFaces.has(b.hostFaceId))})),preflight,finalBook!)):undefined;
  report('attachments',!contextual?'not-applicable':trims?'ready':'blocked',...(contextual&&!trims?['FIXTURE_PLAN_NOT_READY']:[]));
  for(const generatedResult of generated)if(generatedResult.placements.length){const faces=new Set(generatedResult.surfaces.map(s=>s.faceId));validateAssembly([...faces],generatedResult.placements,[]);}
  const stages=order.map(s=>reports.get(s)!);
  if(mode==="complete"&&stages.some(s=>s.state==="blocked"||s.state==="not-implemented")) throw new Error("ENV_PIPELINE_NOT_READY:"+stages.filter(s=>s.state==="blocked"||s.state==="not-implemented").map(s=>s.stage).join(","));
  // The joint planner reserves fixed finish alternatives, then transfers their
  // ownership to complete faces. Its candidates are not output/render modules.
  const finishesByFace=new Map<string,NonNullable<typeof trims>['finishes']>();
  for(const finish of trims?.finishes??[]){const list=finishesByFace.get(finish.hostFaceId)??[];list.push(finish);finishesByFace.set(finish.hostFaceId,list);}
  const placedFaceIds=new Set(generated.flatMap(r=>r.placements.map(p=>p.faceId)));
  if([...finishesByFace.keys()].some(id=>!placedFaceIds.has(id)))throw new Error('MISSING_FACE_FINISH_OWNER');
  const placements=generated.flatMap(r=>r.placements).map(p=>{
    const finishes=(finishesByFace.get(p.faceId)??[]).sort((a,b)=>a.assetKey<b.assetKey?-1:a.assetKey>b.assetKey?1:0),baseAssetKey=tileLookup.get(p.tileId)!.assetKey;
    if(finishes.some(f=>f.orientationId!==p.orientationId||f.position2.some((n,a)=>n!==p.position2[a])))throw new Error('INVALID_FACE_FINISH_TRANSFORM');
    return {...p,faceAssetKey:selectCompleteFaceAsset(baseAssetKey,finishes.map(f=>f.assetKey)),finishIds:finishes.map(f=>f.finishId)};
  }),modules=generated.flatMap(r=>r.modules??[]);
  const zoneColors:Record<string,string>={base:'#edb76c',retail:'#edb76c',body:'#70c5bf',office:'#70c5bf',crown:'#c69be7',upper:'#c69be7',mechanical:'#9babb5'};
  const verticalOverlays=vertical.flatMap(v=>(v.zones??v.bands.map(b=>({id:`band:${v.buildingId}:${b.band}`,sectionId:b.band,faceIds:v.faceBands.filter(f=>f.band===b.band).map(f=>f.faceId)}))).map(z=>({id:z.id,sourceRefs:[{kind:'building' as const,id:v.buildingId}],boxes16:z.faceIds.map(id=>{const s=faceLookup.get(id)!;return faceBounds16({min:[-8,-8,0],max:[8,8,1]},faceCenter2(s.cell,s.direction),s.direction);}),color:zoneColors[z.sectionId]??'#99b6c5'})));
  const result:GenerationResult={...analysis,status:analysis.diagnostics.length?"degraded":"ok",placements,modules,traces:generated.flatMap(r=>r.traces),
    scenePlacements:[...(wallFacilities?.placements??[]),...(fixtures?.placements??[]),...parkingPlacements(parking??[]),...generated.flatMap(r=>r.scenePlacements??[]),...roadPlacements(document.sceneInputs.roads),...(spatialRun?vegetationPlacements(document.grid,{...document.sceneInputs,objects:document.sceneInputs.objects.filter(o=>o.category==='vegetation')},analysis).map(p=>({...p,planId:`vegetation:${p.input!.id}`,sourceRefs:[{kind:'object' as const,id:p.input!.id}],yawQuarterTurns:0 as const,worldBounds16:sceneBounds16(p.center,p.size)})):[])],
    counters:{...analysis.counters,fallbackCount:0,ruleEvaluations:generated.reduce((n,r)=>n+r.counters.ruleEvaluations,0),placementCount:placements.length,moduleCount:modules.filter(m=>m.kind==="structure").length,attachmentCount:modules.filter(m=>m.kind==="attachment").length,ownedFaceCount:generated.reduce((n,r)=>n+(r.counters.ownedFaceCount??0),0)},
    environment:{stages,preflight,vertical,facades,wallFacilities,columns,entrances,...(fixtures?{fixtures}:{}),...(parking?{parking}:{}),...(circulation?{parkingCirculation:circulation.areas}:{}),reservations:finalBook?.snapshot()??[],
      ...(spatialRun?{spatial:spatialRun.spatial}:{}),
      overlays:[...entrances.flatMap(p=>p.entrances.map(e=>({id:e.id,sourceRefs:[{kind:"building" as const,id:p.buildingId}],path:e.pathCells,color:"#f6d968"}))),...(circulation?.areas??[]).flatMap(a=>a.components.flatMap(p=>[
      {id:`aisle:${p.componentKey}`,sourceRefs:[{kind:'parking' as const,id:a.areaId}],boxes16:p.aisleCells.map(c=>({min:[c[0]*16,0,c[2]*16] as [number,number,number],max:[(c[0]+1)*16,1,(c[2]+1)*16] as [number,number,number]})),color:'#ec9866'},
      {id:`walk:${p.componentKey}`,sourceRefs:[{kind:'parking' as const,id:a.areaId}],boxes16:p.walkCells.map(c=>({min:[c[0]*16,1,c[2]*16] as [number,number,number],max:[(c[0]+1)*16,2,(c[2]+1)*16] as [number,number,number]})),color:'#83cfb9'},
      ...p.gates.map(g=>({id:g.id,sourceRefs:[{kind:'parking' as const,id:a.areaId}],path:g.openingCells,color:'#fff082'}))])),...verticalOverlays,...probes.filter(p=>p.access.reachable).map(p=>({id:`access:${p.ref.id}`,sourceRefs:[p.ref],path:p.access.path,color:'#ffe887'}))],
      traces:[...(wallFacilities?.traces??[]),...(fixtures?.traces??[]),...(trims?.traces??[]),...(parking??[]).flatMap(a=>a.plans.flatMap(p=>p.traces)),...entrances.flatMap(p=>p.traces),...(circulation?.areas??[]).flatMap(a=>a.components.flatMap(c=>c.traces)),...vertical.flatMap(v=>v.traces),...probes.map(p=>({id:`access:${p.ref.id}`,ownerId:p.ref.id,ruleId:'spatial-access',ruleVersion:'1.0.0',sourceRefs:[p.ref],selectedIds:p.access.reachable?[cellId(p.cell)]:[],candidates:[{candidateId:cellId(p.cell),accepted:p.access.reachable,reasonCodes:p.access.reasonCodes,metrics:{distance:p.access.distanceCells??-1},conflictIds:[]}]}))],
      counters:{preflightCalls,generationCalls:1}}};
  options.telemetry?.({cacheStats:cache?.stats()??{hits:0,misses:0,writes:0,evictions:0,entries:0,bytes:0},actualExpansions,logicalExpansions:(circulation?.areas??[]).reduce((n,a)=>n+a.components.reduce((v,c)=>v+c.counters.stateExpansions,0),0)+(parking??[]).reduce((n,a)=>n+a.plans.reduce((v,p)=>v+p.counters.stateExpansions,0),0),layoutTrials:(circulation?.areas??[]).reduce((n,a)=>n+a.components.reduce((v,c)=>v+c.counters.layoutCandidates,0),0)});
  return {mode,stages,result};
}
