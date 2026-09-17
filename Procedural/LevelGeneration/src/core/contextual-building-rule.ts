import {cloneJSON,immutableJSON} from './canonical';
import type {BuildingRuleInput} from './building-rule-contract';
import {applyFacadeStyle} from './facade-patterns';
import type {BuildingGenerationRule} from './building-rule-contract';
import type {RuleSpatialAdapter} from './rule-spatial-contract';
import {selectTiles,DEFAULT_RULES,hash33,type FaceTrace} from './selection';
import {cellBox16,faceBounds16,faceAssetBounds,mergeBoxes16} from './placement-bounds';
import {faceCenter2} from './analysis';
import type {Vec3} from './analysis';
import {TRIM_ASSETS} from './banded-facade-assets';

export const CONTEXTUAL_RULE_DEFINITION={pipeline:'environment-contextual-v1',portals:'planned',facade:'banded'};
/** Cache only the required panel decision templates; facade decisions/traces are rebuilt from current plans. */
export function contextualTemplates(input:BuildingRuleInput):FaceTrace[]{
 const surfaces=[...new Map(input.analysis.surfaces.map(s=>[`${s.role}:${s.direction}`,s])).values()];
 return immutableJSON(selectTiles({...input.analysis,surfaces},{...input.options,architecture:undefined,rules:input.analysis.diagnostics.length?DEFAULT_RULES:input.options.rules?.filter(r=>r.predicate==='supported'),context:input.context}).traces);
}
export function contextualBase(input:BuildingRuleInput,templates=contextualTemplates(input)){
 const decisions=new Map(templates.map(t=>[`${t.role}:${t.direction}`,t]));
 const traces=input.analysis.surfaces.map(surface=>{const t=decisions.get(`${surface.role}:${surface.direction}`)!;
  if(t.selection.candidateCount!==1||t.fallback)throw new Error('CONTEXTUAL_PANEL_CONTRACT');
  return {...t,faceId:surface.faceId,componentId:surface.componentId,...(surface.undersideKind?{undersideKind:surface.undersideKind}:{}),...(surface.architecture?{architecture:{...surface.architecture,palette:t.architecture!.palette,paletteHash:t.architecture!.paletteHash}}:{}),selection:{...t.selection,hash:hash33(input.options.seed??0,`${surface.faceId}|${t.selection.ruleId}`)}};
 });
 const placements=traces.map((t,i)=>({placementId:`p:${t.faceId}`,faceId:t.faceId,tileId:t.selection.tileId,position2:faceCenter2(input.analysis.surfaces[i].cell,t.direction),orientationId:t.direction,ruleId:t.selection.ruleId}));
 return {...input.analysis,status:input.analysis.diagnostics.length?'degraded' as const:'ok' as const,placements,traces,diagnostics:[...input.analysis.diagnostics],counters:{...input.analysis.counters,ruleEvaluations:traces.reduce((n,t)=>n+t.rules.length,0),fallbackCount:0,placementCount:placements.length}};
}
export function contextualOutput(input:BuildingRuleInput,base:ReturnType<typeof contextualBase>){
 if(!input.context.entrances||!input.context.verticalBands)throw new Error('CONTEXTUAL_BUILDING_PLAN_REQUIRED');
 const result=applyFacadeStyle(base,{...input.options,context:input.context});
 return {...result,modules:[],counters:{...result.counters,moduleCount:0,attachmentCount:0,ownedFaceCount:result.surfaces.length}};
}
export const CONTEXTUAL_BUILDING_RULE:BuildingGenerationRule={
  id:'standard-contextual',version:'1.0.0',label:'환경 계획 건물',definition:CONTEXTUAL_RULE_DEFINITION,
  validateMetadata(metadata){if(Object.keys(metadata).length)throw new Error('Contextual rule accepts no metadata.');},
  generate(input){return contextualOutput(input,contextualBase(input));},
};
export const CONTEXTUAL_SPATIAL_ADAPTER:RuleSpatialAdapter={
  reference:{id:'contextual-envelope',version:'1.0.0',definition:{bounds:'facade-descriptors-v1'}},
  ruleId:'standard-contextual',ruleVersion:'1.0.0',ruleDefinition:CONTEXTUAL_RULE_DEFINITION,
  describeEnvelope(input){
    const faces=input.analysis.surfaces.filter(s=>s.componentId===input.componentId),supportedAssetKeys=[...new Set([...(input.options.catalog??[]).map(t=>t.assetKey),...Object.keys(TRIM_ASSETS)])];
    for(const asset of supportedAssetKeys)faceAssetBounds(asset);
    return {version:1,requiredBoxes16:mergeBoxes16([...input.cells.map(cellBox16),...faces.map(s=>faceBounds16(s.role==='wall'?{min:[-8,-8,0],max:[8,8,2]}:{min:[-8,-8,-1],max:[8,8,0]},faceCenter2(s.cell as Vec3,s.direction),s.direction))]),
      deferredAttachmentBounds16:mergeBoxes16(faces.filter(s=>s.role==='wall').map(s=>faceBounds16({min:[-10,-8,-2],max:[10,8,2]},faceCenter2(s.cell as Vec3,s.direction),s.direction))),supportedAssetKeys,diagnostics:[]};
  },
};
