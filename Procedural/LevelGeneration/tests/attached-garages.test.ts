import {it,expect} from 'vitest';
import {createDocument,replaceGrid,replaceSceneInputs,exportDocument,loadDocument} from '../src/core/document';
import {executeEnvironment} from '../src/core/environment-generation';
import {emptySceneInputs} from '../src/core/scene-inputs';
import {box} from '../src/fixtures';
import {applyEnvironmentEdit} from '../src/environment-editor';
import {scenePlacementBounds16,containedInUnion} from '../src/core/placement-bounds';
import {type Vec3} from '../src/core/analysis';
import {DocumentHistory} from '../src/editor';

const footprint:Vec3[]=[[2,0,1],[2,0,2],[3,0,1],[3,0,2]];
const install=(profile:'residential-cream'|'office'='residential-cream',cells=footprint)=>{
  const doc=createDocument(box(2,2,3),42,profile);
  return applyEnvironmentEdit(doc,{kind:'parking-add',cells}).document;
};
const run=(doc:ReturnType<typeof createDocument>)=>executeEnvironment(doc,{cache:false}).result;

it('parking painted against a house constructs a selectable attached garage and closes only its shared ground wall',()=>{
  const doc=install(),result=run(doc),garage=result.environment!.attachedGarages![0];
  expect(garage).toMatchObject({buildingId:'0,0,0',cells:footprint,doorDirection:'PZ',bayCount:2,access:'local',vehicleProof:'not-verified'});
  expect(doc.grid).toEqual(createDocument(box(2,2,3)).grid);
  expect(result.environment!.parking).toBeUndefined();
  expect(result.environment!.stages.find(s=>s.stage==='garages')?.state).toBe('ready');
  expect(result.environment!.stages.find(s=>s.stage==='parkingCirculation')?.state).toBe('not-applicable');
  expect(result.environment!.reservations.some(r=>r.kind==='solid'&&r.sourceRefs.some(s=>s.kind==='parking'&&s.id===garage.areaId))).toBe(true);
  for(const id of garage.contactFaceIds){
    expect(result.scenePlacements!.find(p=>p.faceIds?.includes(id))!.asset).toContain('Plain');
    expect(result.environment!.entrances!.flatMap(p=>p.entrances).every(e=>!e.faceIds.includes(id))).toBe(true);
  }
  expect(garage.placements.filter(p=>p.asset.includes('GaragePortal'))).toHaveLength(2);
  expect(garage.placements.every(p=>p.sourceRefs![0].kind==='parking')).toBe(true);
  const envelope=result.environment!.preflight.find(p=>p.buildingId===garage.buildingId)!.envelope;
  for(const p of garage.placements)expect(containedInUnion(scenePlacementBounds16(p),envelope.requiredBoxes16)).toBe(true);
  const owners=result.scenePlacements!.flatMap(p=>p.faceIds??[]);
  expect(owners.length).toBe(result.surfaces.length);
  expect(new Set(owners).size).toBe(result.surfaces.length);
  expect(result.scenePlacements!.some(p=>/Chimney|Porch|Carport/.test(p.asset))).toBe(false);
});

it('one-bay garages use a 1 by 2 parking mask and entries follow a road without claiming a vehicle proof',()=>{
  let doc=install('residential-cream',[[2,0,1],[2,0,2]]);
  doc=replaceSceneInputs(doc,{...doc.sceneInputs,roads:[[2,0,4],[2,0,5]]});
  const garage=run(doc).environment!.attachedGarages![0];
  expect(garage).toMatchObject({bayCount:1,doorDirection:'PZ',access:'road-facing',vehicleProof:'not-verified'});
});

it('deletion, undo/redo, JSON and removing the host restore input ownership rather than leaving an orphan garage',()=>{
  const initial=createDocument(box(2,2,3),42,'residential-cream'),history=new DocumentHistory(initial);
  const doc=applyEnvironmentEdit(initial,{kind:'parking-add',cells:footprint}).document;
  history.commit(doc);
  const before=run(initial),after=run(doc);
  expect(run(loadDocument(exportDocument(doc))).scenePlacements).toEqual(after.scenePlacements);
  expect(run(history.undo()!).scenePlacements).toEqual(before.scenePlacements);
  expect(run(history.redo()!).scenePlacements).toEqual(after.scenePlacements);
  const removed=applyEnvironmentEdit(doc,{kind:'parking-remove',targetId:doc.sceneInputs.parkingAreas[0].id,cells:footprint}).document;
  expect(run(removed).scenePlacements).toEqual(before.scenePlacements);
  expect(run(replaceGrid(doc,[])).environment!.attachedGarages).toBeUndefined();
  expect(run(replaceGrid(doc,[])).scenePlacements!.some(p=>p.context==='attached-garage')).toBe(false);
});

it('detached masks, commercial hosts, large lots and nonrectangular masks retain open parking rules',()=>{
  const detached=install('residential-cream',footprint.map(([x,y,z])=>[x+3,y,z]));
  const office=install('office');
  const large=install('residential-cream',box(5,1,3).map(([x,y,z])=>[x+2,y,z]));
  const irregular=install('residential-cream',footprint.slice(0,3));
  for(const doc of [detached,office,large,irregular]){
    const result=run(doc);expect(result.environment!.attachedGarages).toBeUndefined();
    expect(result.environment!.parking).toBeDefined();
    expect(result.scenePlacements!.some(p=>p.context==='attached-garage')).toBe(false);
  }
});

it('respects existing road/object inputs and refuses to connect two houses',()=>{
  const obstructed=install();
  const scene=emptySceneInputs();scene.parkingAreas=obstructed.sceneInputs.parkingAreas;
  scene.objects=[{id:'keep',category:'facility',direction:'PY',cells:[[2,0,1]]}];
  const result=run(replaceSceneInputs(obstructed,scene));
  expect(result.environment!.attachedGarages).toBeUndefined();
  expect(result.environment!.traces.some(t=>t.candidates.some(c=>c.reasonCodes.includes('GARAGE_INPUT_OBSTRUCTION')))).toBe(true);
  const two=replaceGrid(obstructed,[...obstructed.grid,...box(2,2,3).map(([x,y,z])=>[x+4,y,z] as Vec3)]);
  expect(run(two).environment!.attachedGarages).toBeUndefined();
});

it('rotates attached footprints and matches uncached output after a parking edit',()=>{
  for(let turns=0;turns<4;turns++){
    const rotate=(c:Vec3):Vec3=>{let[x,y,z]=c;for(let i=0;i<turns;i++)[x,z]=[z,-x-1];return[x-9,y,z-7];};
    const doc=createDocument(box(2,2,3).map(rotate),42,'residential-cream');
    const next=applyEnvironmentEdit(doc,{kind:'parking-add',cells:footprint.map(rotate)}).document;
    expect(run(next).environment!.attachedGarages).toHaveLength(1);
    expect(executeEnvironment(next).result).toEqual(run(next));
  }
});
