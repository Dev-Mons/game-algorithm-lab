import {ENVIRONMENT} from '../src/core/environment-settings';
import {expect,it} from 'vitest';
import {BUILDING_PROFILES,createDocument,replaceSceneInputs,setBuildingRule,type Profile} from '../src/core/document';
import {generateDocument} from '../src/core/generate-document';
import {emptySceneInputs} from '../src/core/scene-inputs';
import {desiredEntranceCount} from '../src/core/entrance-plan';
import {registerBuildingRule} from '../src/core/building-rules';
import {registerRuleSpatialAdapter} from '../src/core/rule-spatial-adapters';
import {CONTEXTUAL_SPATIAL_ADAPTER} from '../src/core/contextual-building-rule';
import {PARKING_RULE} from '../src/core/parking-rule';
import {faceCenter2,type Vec3} from '../src/core/analysis';
import {box} from '../src/fixtures';
const run=(grid:Vec3[],roads:Vec3[])=>{const scene=emptySceneInputs();scene.roads=roads;const document=createDocument(grid,42,'shop',undefined,undefined,scene);return {document,result:generateDocument(document,{mode:'development-preview'})};};
it('counts validated frontage union and limits small-volume buildings',()=>{
  const settings=ENVIRONMENT.entrances;
  expect(desiredEntranceCount(22,1152,settings)).toBe(2);expect(desiredEntranceCount(22,128,settings)).toBe(1);expect(desiredEntranceCount(0,2000,settings)).toBe(0);
});
it('builds planned road portals and retains a ground entrance when roads disappear',()=>{
  const {document,result}=run(box(24,8,6),box(24,1,1).map(([x,y])=>[x,y,8]));
  const plan=result.environment!.entrances![0];
  expect(plan.entrances.length).toBeGreaterThanOrEqual(2);expect(plan.entrances.filter(e=>e.role==='main')).toHaveLength(1);
  expect(plan.entrances.some(e=>e.widthCells===2)).toBe(true);
  const faces=new Set(plan.entrances.flatMap(e=>e.faceIds));
  expect(result.placements.filter(p=>p.ruleId==='building.entrance').map(p=>p.faceId).sort()).toEqual([...faces].sort());
  expect(new Set(result.placements.map(p=>p.faceId)).size).toBe(result.surfaces.length);
  for(const e of plan.entrances){expect(e.pathCells.length).toBeGreaterThan(0);expect(e.pathCells.length-1).toBeLessThanOrEqual(24);expect(e.faceIds).toHaveLength(e.widthCells);}
  const without=generateDocument(replaceSceneInputs(document,{...document.sceneInputs,roads:[]}),{mode:'development-preview'});
  expect(without.environment!.entrances![0].entrances).toHaveLength(1);
  expect(without.environment!.entrances![0].entrances[0]).toMatchObject({access:'local',pathCells:[]});
  expect(without.environment!.entrances![0].entrances[0].roadTargetCell).toBeUndefined();
  expect(without.placements.some(p=>p.ruleId==='building.entrance')).toBe(true);
  expect(without.environment!.entrances![0].traces[0].candidates.some(c=>c.reasonCodes.includes('NO_ROAD'))).toBe(true);
});

it.each(Object.keys(BUILDING_PROFILES) as Profile[])('%s gives every separate ground building a door without inventing road access',profile=>{
  const grid=[...box(6,5,4),...box(1,3,1).map(([x,y,z])=>[x+10,y,z] as Vec3)];
  const document=createDocument(grid,42,profile),result=generateDocument(document);
  const faces=new Map(result.surfaces.map(s=>[s.faceId,s]));
  expect(result.environment!.entrances).toHaveLength(2);
  for(const plan of result.environment!.entrances!){
    expect(plan.entrances).toHaveLength(1);
    const entry=plan.entrances[0];expect(entry.access).toBe('local');expect(entry.pathCells).toEqual([]);
    expect(entry.roadTargetCell).toBeUndefined();expect(entry.roadFrontageId).toBeUndefined();
    for(const id of entry.faceIds){expect(faces.get(id)!.cell[1]).toBe(0);expect(result.placements.find(p=>p.faceId===id)!.ruleId).toBe('building.entrance');}
    expect(result.environment!.reservations.some(r=>r.id===entry.id&&r.kind==='entrance')).toBe(true);
  }
  expect(generateDocument({...document,grid:[...document.grid].reverse()},{cache:false})).toEqual(result);
});
it('rejects immediate road landings; allows narrow single-cell facades',()=>{
  const ring:Vec3[]=[];for(let n=0;n<3;n++)ring.push([n,0,-1],[n,0,3],[-1,0,n],[3,0,n]);
  const direct=run(box(3,3,3),ring).result.environment!.entrances![0];expect(direct.entrances).toEqual([]);expect(direct.traces[0].candidates.some(c=>c.reasonCodes.includes('NO_LANDING_SETBACK'))).toBe(true);
  const narrow=run([[0,0,0]],[[0,0,2]]);expect(narrow.result.environment!.entrances![0].entrances).toHaveLength(1);expect(narrow.result.environment!.entrances![0].entrances[0].widthCells).toBe(1);
});
it('does not connect floating landings or clip paired windows next to portals',()=>{
  const floating=run(box(4,2,3).map(([x,y,z])=>[x,y+2,z]),[[0,0,5]]).result;expect(floating.environment!.entrances![0].entrances).toEqual([]);
  const {result}=run(box(12,6,4),box(12,1,1).map(([x,y])=>[x,y,6]));
  const groups=new Map<string,string[]>();for(const t of result.traces)if(t.facade?.groupId){const parts=groups.get(t.facade.groupId)??[];parts.push(t.facade.part??'single');groups.set(t.facade.groupId,parts);}
  for(const parts of groups.values())expect(parts.sort()).toEqual(parts.includes('single')?['single']:['left','right']);
});
it('rejects a custom rule that emits a portal outside the common plan',()=>{
  registerBuildingRule({...PARKING_RULE,id:'unplanned-door',generate(input){const output=PARKING_RULE.generate(input),face=input.analysis.surfaces.find(s=>s.role==='wall')!;return {...output,scenePlacements:[],placements:[{placementId:'unplanned',faceId:face.faceId,tileId:'facade.portal-single.clay',position2:faceCenter2(face.cell,face.direction),orientationId:face.direction,ruleId:'unplanned'}]};}});
  registerRuleSpatialAdapter({...CONTEXTUAL_SPATIAL_ADAPTER,reference:{...CONTEXTUAL_SPATIAL_ADAPTER.reference,id:'unplanned-door-adapter'},ruleId:'unplanned-door',ruleDefinition:PARKING_RULE.definition});
  const document=setBuildingRule(createDocument([[0,0,0]]),'0,0,0','unplanned-door');
  expect(()=>generateDocument(document,{mode:'development-preview'})).toThrow('UNPLANNED_PORTAL_OUTPUT');
});
