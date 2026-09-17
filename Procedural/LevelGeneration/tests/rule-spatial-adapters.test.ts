import {expect,it} from 'vitest';
import {createDocument,documentOptions,setBuildingRule} from '../src/core/document';
import {PARKING_RULE} from '../src/core/parking-rule';
import {ruleReference} from '../src/core/building-rules';
import {adapterReferenceFor,preflightRule,registerRuleSpatialAdapter,assertOutputBounds} from '../src/core/rule-spatial-adapters';
import {cellBox16,containedInUnion,faceBounds16,scenePlacementBounds16} from '../src/core/placement-bounds';
import {analyzeVolume} from '../src/core/regions';
import type {RuleSpatialAdapter} from '../src/core/rule-spatial-contract';
import {box} from '../src/fixtures';

it('contains actual open deck/column/bay output in cell envelopes, including negative coordinates',()=>{
  const cells=box(3,2,3).map(([x,y,z])=>[x-2,y,z-2] as [number,number,number]);
  const doc=setBuildingRule(createDocument(cells),'-2,0,-2','parking');
  const entry=doc.buildings[0],analysis=analyzeVolume(cells,'region-context-v1');
  const input={componentId:entry.componentId,cells,analysis,options:documentOptions(doc),metadata:entry.rule.metadata,design:entry.design};
  const before=JSON.stringify(input),envelope=preflightRule(entry.rule,entry.spatialAdapterRef,input,cells);
  expect(JSON.stringify(input)).toBe(before);
  const output=PARKING_RULE.generate({...input,context:{design:entry.design,sourceRefs:[],reservations:[],envelope}});
  expect(output.scenePlacements!.length).toBeGreaterThan(cells.length);
  for(const placement of output.scenePlacements!) expect(()=>assertOutputBounds(placement.asset,scenePlacementBounds16(placement),envelope)).not.toThrow();
});
it('subtracts a union rather than filling its AABB holes; transforms all four relief directions',()=>{
  const union=[cellBox16([0,0,0]),cellBox16([2,0,0])];
  expect(containedInUnion({min:[0,0,0],max:[48,16,16]},union)).toBe(false);
  expect(containedInUnion({min:[0,0,0],max:[32,16,16]},[...union,cellBox16([1,0,0])])).toBe(true);
  for(const direction of ['PX','NX','PZ','NZ'] as const) {
    const transformed=faceBounds16({min:[-8,-8,0],max:[8,8,2]},[-7,1,-7],direction);
    expect(transformed.min.every((n,a)=>Number.isInteger(n)&&n<transformed.max[a])).toBe(true);
    expect(transformed.max.map((n,a)=>n-transformed.min[a]).sort((a,b)=>a-b)).toEqual([2,16,16]);
  }
});
it('rejects missing/mismatched adapters, unknown assets, halo escape and actual output escape',()=>{
  const reference=ruleReference('parking'),doc=createDocument([[0,0,0]]),analysis=analyzeVolume(doc.grid,'region-context-v1');
  const input={componentId:'0,0,0',cells:doc.grid,analysis,options:documentOptions(doc),metadata:{},design:doc.buildings[0].design};
  expect(()=>adapterReferenceFor({...reference,id:'unregistered'})).toThrow(/RULE_SPATIAL_CONTRACT_REQUIRED/);
  expect(()=>preflightRule(reference,{...adapterReferenceFor(reference),version:'9.0.0'},input,doc.grid)).toThrow(/RULE_SPATIAL_VERSION_MISMATCH/);
  for(const [id,assets,bounds,reason] of [
    ['unknown',['unknown'],[cellBox16([0,0,0])],'RULE_OUTPUT_BOUNDS_UNKNOWN'],
    ['extent',['parking-deck'],[cellBox16([2,0,0])],'RULE_SPATIAL_EXTENT_UNSUPPORTED'],
  ] as const) {
    const adapter:RuleSpatialAdapter={reference:{id:`test-${id}`,version:'1.0.0',definition:{}},ruleId:reference.id,ruleVersion:reference.version,ruleDefinition:reference.definition,describeEnvelope:()=>({version:1,requiredBoxes16:[...bounds],deferredAttachmentBounds16:[],supportedAssetKeys:[...assets],diagnostics:[]})};
    registerRuleSpatialAdapter(adapter);expect(()=>preflightRule(reference,adapter.reference,input,doc.grid)).toThrow(reason);
  }
  const envelope=preflightRule(reference,adapterReferenceFor(reference),input,doc.grid);
  expect(()=>assertOutputBounds('parking-deck',cellBox16([1,0,0]),envelope)).toThrow(/RULE_ENVELOPE_VIOLATION/);
  expect(input.analysis).toEqual(analysis);
});
