import {expect,it} from 'vitest';
import {createDocument,exportDocument,loadDocument,replaceGrid,replaceSceneInputs} from '../src/core/document';
import {generateDocument} from '../src/core/generate-document';
import {emptySceneInputs,type ObjectInput,type SceneInputs} from '../src/core/scene-inputs';
import {analyzeSidewalks} from '../src/core/sidewalks';
import {editRoads,editSidewalks} from '../src/scene-editor';
import {applyEnvironmentEdit} from '../src/environment-editor';
import {box,FIXTURES} from '../src/fixtures';
import type {Vec3} from '../src/core/analysis';

const strip=(x0:number,x1:number,z:number):Vec3[]=>Array.from({length:x1-x0+1},(_,i)=>[x0+i,0,z]);
const scene=(roads:Vec3[],sidewalks:Vec3[],objects:ObjectInput[]=[]):SceneInputs=>({...emptySceneInputs(),roads,sidewalks,objects});
const kinds=(grid:Vec3[],inputs:SceneInputs)=>analyzeSidewalks(createDocument(grid,42,'shop',undefined,undefined,inputs)).components.map(c=>[c.kind,c.reasonCodes[0]]);

it('upgrades SceneInputs 2 documents with an empty sidewalk mask and saves version 3',()=>{
  const legacy=createDocument([],42,'shop',undefined,undefined,{version:2,roads:strip(0,3,0),objects:[],parkingAreas:[]});
  expect(legacy.sceneInputs.version).toBe(3);expect(legacy.sceneInputs.sidewalks).toEqual([]);
  const raw=JSON.parse(exportDocument(legacy));raw.sceneInputs={version:2,roads:raw.sceneInputs.roads,objects:[],parkingAreas:[]};
  expect(loadDocument(JSON.stringify(raw))).toEqual(legacy);
  expect(()=>createDocument([],42,'shop',undefined,undefined,{...emptySceneInputs(),version:2} as never)).toThrow();
});
it('keeps roads and sidewalks exclusive while buildings, objects and parking may stand on pavement',()=>{
  expect(()=>createDocument([],42,'shop',undefined,undefined,scene(strip(0,2,0),strip(2,4,0)))).toThrow('인도와 도로');
  expect(()=>createDocument([],42,'shop',undefined,undefined,scene([],[[0,1,0]]))).toThrow('Y=0');
  const onTop=createDocument(box(2,2,2),42,'shop',undefined,undefined,{...scene([],box(4,1,4)),objects:[{id:'tree',category:'vegetation',direction:'PY',cells:[[3,0,3]]}],parkingAreas:[{id:'lot',cells:[[3,0,0]],anchor:[3,0,0]}]});
  const placements=generateDocument(onTop).scenePlacements!.filter(p=>p.kind==='sidewalk');
  // Pavement is hidden under the building footprint and the parking surface only.
  const paved=new Set(placements.filter(p=>p.asset==='sidewalk.paving').map(p=>`${Math.floor(p.center[0])},${Math.floor(p.center[2])}`));
  expect(paved.size).toBe(16-4-1);expect(paved.has('0,0')).toBe(false);expect(paved.has('3,0')).toBe(false);
  // Removing the building reveals the preserved pavement below it.
  expect(generateDocument(replaceGrid(onTop,[])).scenePlacements!.filter(p=>p.asset==='sidewalk.paving')).toHaveLength(15);
});
it('lets the last painted ground surface own a cell and reports the sidewalk delta',()=>{
  let doc=createDocument([],42,'shop');
  const ground=(cells:Vec3[])=>({direction:'PY' as const,cells:cells.map(([x,,z])=>[x,-1,z] as Vec3)});
  doc=editSidewalks(doc,ground(strip(0,5,0)),'add');
  doc=editRoads(doc,ground(strip(2,3,0)),'add');
  expect(doc.sceneInputs.sidewalks.map(c=>c[0])).toEqual([0,1,4,5]);expect(doc.sceneInputs.roads.map(c=>c[0])).toEqual([2,3]);
  doc=editSidewalks(doc,ground([[3,0,0]]),'add');
  expect(doc.sceneInputs.roads.map(c=>c[0])).toEqual([2]);expect(doc.sceneInputs.sidewalks.map(c=>c[0])).toEqual([0,1,3,4,5]);
  const edit=applyEnvironmentEdit(doc,{kind:'sidewalk-remove',cells:[[0,0,0],[9,0,9]]});
  expect(edit.changed).toBe(true);expect(edit.delta.sidewalkCells).toEqual([[0,0,0]]);expect(edit.delta.roadCells).toEqual([]);
});
it('derives traffic islands from roads instead of a separate painted kind',()=>{
  const roadsAround=(cells:Vec3[])=>{const own=new Set(cells.map(c=>`${c[0]},${c[2]}`)),out=new Map<string,Vec3>();
    for(const [x,,z] of cells)for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)if(!own.has(`${x+dx},${z+dz}`))out.set(`${x+dx},${z+dz}`,[x+dx,0,z+dz]);return [...out.values()];};
  // A median between two parallel roads, open to grass at both ends.
  expect(kinds([],scene([...strip(0,7,-1),...strip(0,7,1)],strip(1,6,0)))).toEqual([['island','BETWEEN_ROADS']]);
  // Wider than the squeeze limit: an ordinary sidewalk block between roads.
  expect(kinds([],scene([...strip(0,7,-1),...strip(0,7,4)],[...strip(1,6,0),...strip(1,6,1),...strip(1,6,2),...strip(1,6,3)]))).toEqual([['sidewalk','ROADSIDE_SIDEWALK']]);
  const pocket=box(2,1,2).map(([x,,z])=>[x+5,0,z+5] as Vec3);
  expect(kinds([],scene(roadsAround(pocket),pocket))).toEqual([['island','ENCLOSED_BY_ROADS']]);
  const plaza=box(6,1,6).map(([x,,z])=>[x+5,0,z+5] as Vec3);
  expect(kinds([],scene(roadsAround(plaza),plaza))).toEqual([['sidewalk','ENCLOSED_BLOCK_TOO_LARGE']]);
  // A building standing on the patch makes it a block, never an island.
  expect(kinds([[5,0,5]],scene(roadsAround(pocket),pocket))).toEqual([['sidewalk','COVERED_BY_BUILDING_OR_PARKING']]);
  expect(kinds([],scene(strip(0,5,-1),strip(0,5,0)))).toEqual([['sidewalk','ROADSIDE_SIDEWALK']]);
  expect(kinds([],scene([],strip(0,5,0)))).toEqual([['sidewalk','NO_ROAD_EDGE']]);
});
it('reads objects on an island as a median and lifts pavement objects for presentation only',()=>{
  const roads=[...strip(0,9,-1),...strip(0,9,1)],sidewalks=[...strip(1,8,0),...strip(0,9,3)];
  const objects:ObjectInput[]=[{id:'bed',category:'vegetation',direction:'PY',cells:[[2,0,0]]},{id:'posts',category:'facility',direction:'PY',cells:[[5,0,0],[6,0,0]]},
    {id:'grass-bench',category:'facility',direction:'PY',cells:[[4,0,5]]},{id:'walk-bench',category:'facility',direction:'PY',cells:[[4,0,3]]}];
  const result=generateDocument(createDocument([],42,'shop',undefined,undefined,scene(roads,sidewalks,objects))),placements=result.scenePlacements!;
  expect(placements.find(p=>p.id.startsWith('bed:'))!.asset).toBe('median-planter');
  const posts=result.environment!.fixtures!.placements.filter(p=>p.sourceRefs!.some(r=>r.id==='posts'));
  expect(posts.map(p=>p.asset)).toEqual(['fixture.safety-bollard','fixture.safety-bollard']);
  for(const p of posts)expect(p.surfaceOffset).toBe(2/16);
  const at=(x:number,z:number)=>result.environment!.fixtures!.placements.find(p=>Math.floor(p.center[0])===x&&Math.floor(p.center[2])===z)!;
  expect(at(4,3).surfaceOffset).toBe(2/16);expect(at(4,5).surfaceOffset).toBeUndefined();
  // Reservations and semantic centers stay on the Y=0 ground cell.
  for(const p of [at(4,3),at(4,5)])expect(p.center[1]).toBe(p.size[1]/2);
  expect(result.environment!.reservations.find(r=>r.id===at(4,3).id)!.boxes16[0].min[1]).toBe(0);
});
it('draws curbs only toward roads for sidewalks and on every outer edge of an island',()=>{
  const doc=createDocument([],42,'shop',undefined,undefined,scene([...strip(0,9,-1),...strip(0,9,1)],[...strip(2,4,0),...strip(2,4,3),...strip(2,4,2)]));
  const placements=generateDocument(doc).scenePlacements!.filter(p=>p.kind==='sidewalk');
  const median=placements.filter(p=>p.planId==='sidewalk:2,0'),block=placements.filter(p=>p.planId==='sidewalk:2,2');
  expect(median.filter(p=>p.asset==='sidewalk.island-curb')).toHaveLength(8);
  expect(median.filter(p=>p.asset==='sidewalk.island-planting')).toHaveLength(3);
  expect(block.filter(p=>p.asset==='sidewalk.curb')).toHaveLength(3);
  expect(block.filter(p=>p.asset==='sidewalk.paving')).toHaveLength(6);
  const result=generateDocument(doc);
  expect(result.environment!.traces.filter(t=>t.ruleId==='sidewalk-landscape').map(t=>t.candidates[0].reasonCodes[0])).toEqual(['BETWEEN_ROADS','ROADSIDE_SIDEWALK']);
});
it('regenerates the sidewalk example identically through JSON and leaves sidewalk-free output unchanged',()=>{
  const f=FIXTURES.sidewalkLandscape,doc=createDocument(f.cells,42,f.profile,undefined,undefined,f.sceneInputs),result=generateDocument(doc,{cache:false});
  expect(result.status).toBe('ok');
  expect(result.environment!.sidewalks!.components.map(c=>c.kind).sort()).toEqual(['island','island','sidewalk']);
  expect(generateDocument(loadDocument(exportDocument(doc)),{cache:false})).toEqual(result);
  const bare=replaceSceneInputs(doc,{...doc.sceneInputs,sidewalks:[]}),plain=generateDocument(bare,{cache:false});
  expect(plain.environment!.sidewalks).toBeUndefined();
  expect(plain.scenePlacements!.some(p=>p.kind==='sidewalk'||p.surfaceOffset!==undefined)).toBe(false);
});
