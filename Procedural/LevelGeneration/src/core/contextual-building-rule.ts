import {cloneJSON,immutableJSON} from './canonical';
import type {BuildingRuleInput} from './building-rule-contract';
import {applyFacadeStyle} from './facade-patterns';
import type {BuildingGenerationRule} from './building-rule-contract';
import type {RuleSpatialAdapter} from './rule-spatial-contract';
import {selectTiles,DEFAULT_RULES,hash33,type FaceTrace} from './selection';
import {cellBox16,faceBounds16,faceAssetBounds,mergeBoxes16} from './placement-bounds';
import {faceCenter2} from './analysis';
import type {Vec3} from './analysis';
import type {Surface} from './analysis';
import {TRIM_ASSETS} from './banded-facade-assets';

export const CONTEXTUAL_RULE_DEFINITION={pipeline:'environment-contextual-v1',portals:'planned',facade:'banded'};
const decisionKey=(surface:Pick<Surface,'role'|'direction'|'wallKind'|'architecture'>)=>`${surface.role}:${surface.direction}:${surface.wallKind??''}:${surface.architecture&&surface.architecture.interpretation!=='unsupported'?'supported':'basic'}`;
const decisionSurfaces=(input:BuildingRuleInput)=>[...new Map(input.analysis.surfaces.map(s=>[decisionKey(s),s])).values()];
/** Dependencies of the panel-only template selection. Derived mass/facade plans and
 * reservation bodies are consumed later; serializing them here evicts the analysis
 * cache on large urban volumes. Keep actual representative surfaces, style/catalog,
 * diagnostics, design and palette so reuse cannot change a template decision. */
export function contextualTemplateDependencies(input:BuildingRuleInput){
  return {surfaces:decisionSurfaces(input),diagnostics:input.analysis.diagnostics,rolePolicy:input.analysis.rolePolicy,options:input.options,design:input.context.design,palette:input.context.verticalBands?.profile?.palette};
}
/** Cache only the required panel decision templates; facade decisions/traces are rebuilt from current plans. */
export function contextualTemplates(input:BuildingRuleInput):FaceTrace[]{
 const surfaces=decisionSurfaces(input);
 const supportedRules=input.options.rules?.filter(r=>r.predicate==='supported')??[];
 return immutableJSON(selectTiles({...input.analysis,surfaces},{...input.options,architecture:undefined,rules:input.analysis.diagnostics.length?[...supportedRules,...DEFAULT_RULES]:supportedRules,context:input.context}).traces);
}
export function contextualBase(input:BuildingRuleInput,templates=contextualTemplates(input)){
 const decisions=new Map(templates.map(t=>[decisionKey(t),t]));
 const traces=input.analysis.surfaces.map(surface=>{const t=decisions.get(decisionKey(surface))!;
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
    const rooftopHeight=Math.max(8,...(input.options.architecture?.modules??[]).flatMap(m=>Object.values(m.rooftopAssets??{}).map(asset=>faceAssetBounds(asset).max[1])));
    return {version:1,requiredBoxes16:mergeBoxes16([...input.cells.map(cellBox16),...faces.map(s=>faceBounds16(s.role==='wall'?{min:[-8,-8,0],max:[8,s.wallKind==='rooftop'?rooftopHeight:8,2]}:{min:[-8,-8,-1],max:[8,8,0]},faceCenter2(s.cell as Vec3,s.direction),s.direction))]),
      deferredAttachmentBounds16:mergeBoxes16(faces.filter(s=>s.role==='wall').map(s=>faceBounds16({min:[-10,-8,-2],max:[10,8,2]},faceCenter2(s.cell as Vec3,s.direction),s.direction))),supportedAssetKeys,diagnostics:[]};
  },
};
