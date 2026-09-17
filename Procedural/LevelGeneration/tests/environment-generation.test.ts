import {expect,it} from 'vitest';
import {createDocument,setBuildingRule} from '../src/core/document';
import {generateDocument} from '../src/core/generate-document';
import {registerBuildingRule} from '../src/core/building-rules';
import {registerRuleSpatialAdapter,PARKING_SPATIAL_REFERENCE} from '../src/core/rule-spatial-adapters';
import {PARKING_RULE} from '../src/core/parking-rule';
import {cellBox16} from '../src/core/placement-bounds';
import {emptySceneInputs} from '../src/core/scene-inputs';

it('uses one complete execution for an empty document and exposes no invented plans',()=>{
  const edges:string[]=[],result=generateDocument(createDocument([]),{stageHook:(s,e)=>edges.push(`${s}:${e}`)});
  expect(result.environment?.stages.every(s=>s.state==='not-applicable')).toBe(true);
  expect(result.environment?.counters.generationCalls).toBe(1);
  expect(edges.filter(e=>e==='analysis:start')).toHaveLength(1);
  expect(result.scenePlacements).toEqual([]);
});
it('executes roadless and ordinary inputs through current explicit stages',()=>{
  const scene=emptySceneInputs();scene.parkingAreas=[{id:'lot',anchor:[0,0,0],cells:[[0,0,0]]}];
  const doc=createDocument([],42,'office',undefined,undefined,scene);
  expect(generateDocument(doc).environment?.parking?.[0].quality.acceptedStalls).toBe(0);
  const result=generateDocument(doc,{mode:'development-preview'});
  expect(result.environment?.stages.find(s=>s.stage==='spatial')?.state).toBe('ready');
  expect(result.environment?.stages.find(s=>s.stage==='parkingStalls')?.state).toBe('ready');
  expect(result.scenePlacements?.every(p=>p.asset==='parking.paving')).toBe(true);
  const contextual=generateDocument(createDocument([[0,0,0]]),{mode:'development-preview'});
  expect(contextual.placements).toHaveLength(contextual.surfaces.length);
  expect(contextual.environment?.entrances?.[0].entrances).toEqual([]);
  expect(contextual.environment?.stages.find(s=>s.stage==='preflight')?.state).toBe('ready');
});
it('runs preflight before generation, without dry generation or cached output, and rejects bounds escape',()=>{
  const events:string[]=[];
  registerBuildingRule({...PARKING_RULE,id:'ordered-test',generate(input){events.push('generate');return PARKING_RULE.generate(input);}});
  registerRuleSpatialAdapter({reference:{...PARKING_SPATIAL_REFERENCE,id:'ordered-adapter'},ruleId:'ordered-test',ruleVersion:PARKING_RULE.version,ruleDefinition:PARKING_RULE.definition,describeEnvelope(input){events.push('preflight');return {version:1,requiredBoxes16:input.cells.map(cellBox16),deferredAttachmentBounds16:[],supportedAssetKeys:['parking-deck','parking-roof-deck','parking-column','parking-bay'],diagnostics:[]};}});
  const doc=setBuildingRule(createDocument([[0,0,0]]),'0,0,0','ordered-test');
  const first=generateDocument(doc,{mode:'development-preview'}),second=generateDocument(doc,{mode:'development-preview'});
  expect(events).toEqual(['preflight','generate','preflight','generate']);expect(second).toEqual(first);
  expect(first.scenePlacements!.every(p=>p.worldBounds16&&p.sourceRefs?.length)).toBe(true);
  registerBuildingRule({...PARKING_RULE,id:'escaping-test',generate(input){const output=PARKING_RULE.generate(input);output.scenePlacements![0].center[0]+=1;return output;}});
  registerRuleSpatialAdapter({reference:{...PARKING_SPATIAL_REFERENCE,id:'escaping-adapter'},ruleId:'escaping-test',ruleVersion:PARKING_RULE.version,ruleDefinition:PARKING_RULE.definition,describeEnvelope(input){return {version:1,requiredBoxes16:input.cells.map(cellBox16),deferredAttachmentBounds16:[],supportedAssetKeys:['parking-deck','parking-roof-deck','parking-column','parking-bay'],diagnostics:[]};}});
  expect(()=>generateDocument(setBuildingRule(createDocument([[0,0,0]]),'0,0,0','escaping-test'),{mode:'development-preview'})).toThrow(/RULE_ENVELOPE_VIOLATION/);
});

it('reports an unavailable adapter as unimplemented, blocks its consumers and rejects complete publication',()=>{
 registerBuildingRule({...PARKING_RULE,id:'pending-rule'});
 registerRuleSpatialAdapter({reference:{...PARKING_SPATIAL_REFERENCE,id:'pending-adapter'},ruleId:'pending-rule',ruleVersion:PARKING_RULE.version,ruleDefinition:PARKING_RULE.definition,describeEnvelope(){throw new Error('ENV_PIPELINE_NOT_READY:external-adapter');}});
 const doc=setBuildingRule(createDocument([[0,0,0]]),'0,0,0','pending-rule');
 expect(()=>generateDocument(doc)).toThrow('ENV_PIPELINE_NOT_READY');const preview=generateDocument(doc,{mode:'development-preview'});
 expect(preview.environment!.stages.find(s=>s.stage==='preflight')!.state).toBe('not-implemented');expect(preview.environment!.stages.find(s=>s.stage==='facade')!.state).toBe('blocked');
});

it('a custom generator cannot expand its preflight envelope or rewrite shared plans to validate itself',()=>{
 registerBuildingRule({...PARKING_RULE,id:'mutating-envelope',generate(input){(input.context.envelope.requiredBoxes16 as any).push({min:[-100,-100,-100],max:[100,100,100]});return PARKING_RULE.generate(input);}});
 registerRuleSpatialAdapter({reference:{...PARKING_SPATIAL_REFERENCE,id:'immutable-envelope'},ruleId:'mutating-envelope',ruleVersion:PARKING_RULE.version,ruleDefinition:PARKING_RULE.definition,describeEnvelope(input){return {version:1,requiredBoxes16:input.cells.map(cellBox16),deferredAttachmentBounds16:[],supportedAssetKeys:['parking-deck','parking-roof-deck','parking-column','parking-bay'],diagnostics:[]};}});
 const doc=setBuildingRule(createDocument([[0,0,0]]),'0,0,0','mutating-envelope'),before=JSON.stringify(doc);expect(()=>generateDocument(doc)).toThrow();expect(JSON.stringify(doc)).toBe(before);
});
