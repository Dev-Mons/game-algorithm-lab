import {expect,it} from 'vitest';
import {add,BASES,cellId,type Vec3} from '../src/core/analysis';
import {createDocument,replaceGrid,replaceSceneInputs,loadDocument,exportDocument} from '../src/core/document';
import {generateDocument} from '../src/core/generate-document';
import {EnvironmentCache} from '../src/core/environment-cache';
import {analyzeVolume} from '../src/core/regions';
import {SupportIndex} from '../src/core/scene-relations';
import {emptySceneInputs,type ObjectInput} from '../src/core/scene-inputs';
import {box} from '../src/fixtures';
import {editObjects,editRoads} from '../src/scene-editor';
import {DocumentHistory} from '../src/editor';
import {planWallFacilities} from '../src/core/wall-facilities';
import {ReservationBook} from '../src/core/reservations';

const object=(id:string,category:ObjectInput['category'],cells:Vec3[],direction:ObjectInput['direction']='PY'):ObjectInput=>({id,category,cells,direction});
const moved=(cells:Vec3[],offset:Vec3)=>cells.map(c=>add(c,offset));
const geometry=(r:ReturnType<typeof generateDocument>)=>r.scenePlacements!.filter(p=>p.kind==='object').map(p=>({asset:p.asset,center:p.center,size:p.size,heading:p.yawQuarterTurns,context:p.context})).sort((a,b)=>cellId(a.center).localeCompare(cellId(b.center)));
const relations=(r:ReturnType<typeof generateDocument>)=>r.environment!.relations!;

const footprints = [
  ['L',box(5,2,5).filter(([x,,z])=>x<2||z<2)],
  ['U',box(5,2,5).filter(([x,,z])=>x===0||x===4||z===0)],
  ['hole',box(5,2,5).filter(([x,,z])=>x!==2||z!==2)],
  ['notch',box(5,2,5).filter(([x,,z])=>x!==2||z!==4)],
  ['bridge',[...box(2,4,3),...moved(box(2,4,3),[5,0,0]),...moved(box(3,1,3),[2,3,0])]],
  ['pillar',[...box(1,3,1),...moved(box(5,1,3),[-2,3,-1])]],
] as const;
it.each(footprints)('T03/T05: %s uses actual exposed support and retains every empty cell',(name,cells)=>{
  const analysis=analyzeVolume(cells,'region-context-v1'),tops=analysis.surfaces.filter(s=>s.direction==='PY');
  const scene=emptySceneInputs();scene.objects=tops.map((s,i)=>object(`roof-${i}`,'lighting',[add(s.cell,[0,1,0])]));
  const doc=createDocument(cells,42,'urban-shop',undefined,undefined,scene),result=generateDocument(doc);
  expect(result.cells).toEqual(doc.grid);
  expect(new Set(result.placements.map(p=>p.faceId)).size).toBe(result.surfaces.length);
  const supports=relations(result).supports;
  expect(supports).toHaveLength(tops.length);
  for(const r of supports){
    expect(r.accepted).toBe(true);expect(r.surface?.faceId).toBe(`${r.cell[0]},${r.cell[1]-1},${r.cell[2]}|PY`);
    expect(result.regions!.some(region=>region.regionId===r.surface!.regionId&&region.faceIds.includes(r.surface!.faceId))).toBe(true);
    expect(result.environment!.traces.some(t=>t.ruleId==='contextual-fixtures'&&t.relationIds?.includes(r.id))).toBe(true);
  }
  if(name==='bridge'||name==='pillar')expect(result.surfaces.some(s=>s.role==='underside'&&s.undersideKind==='overhang')).toBe(true);
});

it('T04: exact overhead cover differs from region classification and local-cap; scopes remain the vertical plan’s scopes',()=>{
  const cells=[...box(5,1,4),...moved(box(2,6,4),[3,1,0]),...moved(box(3,1,2),[0,4,0])];
  const scene=emptySceneInputs();scene.objects=[object('covered','facility',[[1,1,0]]),object('sky','facility',[[1,1,3]])];
  const doc=createDocument(cells,42,'urban-shop',undefined,undefined,scene),r=generateDocument(doc),view=relations(r);
  const covered=view.supports.find(s=>s.cell[2]===0)!,sky=view.supports.find(s=>s.cell[2]===3)!;
  expect(covered).toMatchObject({accepted:true,support:'roof',coveredBy:{cell:[1,4,0],faceId:'1,4,0|NY'}});
  expect(sky.coveredBy).toBeUndefined();
  expect(covered.surface!.regionId).toBe(sky.surface!.regionId);
  expect(covered.surface!.interpretation).toBe('covered-terrace');
  expect(covered.surface!.massScopeIds.length).toBeGreaterThan(0);
  expect(r.environment!.vertical!.flatMap(v=>v.mass?.scopes.map(s=>s.id)??[])).toEqual(expect.arrayContaining(covered.surface!.massScopeIds));
  expect(r.environment!.fixtures!.placements.every(p=>p.asset==='fixture.air-conditioner'&&JSON.parse(p.context).accessMode==='service-unverified')).toBe(true);
  const tall=replaceSceneInputs(doc,{...scene,objects:[object('too-tall','lighting',[[1,1,0],[1,2,0],[1,3,0],[1,4,0]])]});
  const denied=generateDocument(tall);expect(relations(denied).supports[0].reasonCodes).toEqual(['OBJECT_BUILDING_OVERLAP']);
  expect(denied.environment!.fixtures!.placements).toEqual([]);
});

it.each(['vegetation','lighting','facility'] as const)('T09/T11: %s keeps unaffected columns after support loss and restoration',category=>{
  const scene=emptySceneInputs();scene.objects=[object('area',category,moved(box(2,1,2),[1,1,1]))];
  const doc=createDocument(box(4,1,4),42,'office',undefined,undefined,scene),before=generateDocument(doc);
  const lost=replaceGrid(doc,doc.grid.filter(c=>cellId(c)!=='1,0,1')),after=generateDocument(lost);
  expect(lost.sceneInputs.objects).toEqual(doc.sceneInputs.objects);
  expect(relations(after).supports.filter(r=>!r.accepted)).toHaveLength(1);
  expect(relations(after).supports.find(r=>!r.accepted)!.reasonCodes).toEqual(['NO_SUPPORTED_SURFACE']);
  expect(geometry(after)).toEqual(geometry(before).filter(p=>!(Math.floor(p.center[0])===1&&Math.floor(p.center[2])===1)));
  const diagnostic=after.environment!.spatial!.diagnostics.find(d=>d.ownerId==='area')!;
  expect(diagnostic.reasonCodes).toEqual(['NO_SUPPORTED_SURFACE']);
  expect(after.environment!.traces.find(t=>t.id===diagnostic.relationIds![0])!.candidates[0].accepted).toBe(false);
  if(category==='vegetation')expect(after.environment!.spatial!.staticReservations.find(r=>r.ownerId==='area')!.cells).toHaveLength(3);
  expect(geometry(generateDocument(replaceGrid(lost,doc.grid)))).toEqual(geometry(before));
});

it.each(['vegetation','lighting','facility'] as const)('T09: %s reads one continuous height across vertically split fragments',category=>{
  const scene=emptySceneInputs();scene.objects=[object('whole',category,moved(box(2,3,2),[0,1,0]))];
  const doc=createDocument(box(2,1,2),42,'office',undefined,undefined,scene),before=generateDocument(doc);
  const split=replaceSceneInputs(doc,{...scene,objects:[object('upper',category,moved(box(2,2,2),[0,2,0])),object('lower',category,moved(box(2,1,2),[0,1,0]))]});
  const after=generateDocument(split);
  expect(geometry(after)).toEqual(geometry(before));
  expect(relations(after).supports.every(r=>r.cells.length===3&&r.accepted)).toBe(true);
  expect(relations(after).supports[0].sourceRefs).toEqual(expect.arrayContaining([{kind:'object',id:'lower'},{kind:'object',id:'upper'}]));
});

it('T09: a corner deletion cannot reclassify the untouched columns of an automatic wall assembly',()=>{
  const scene=emptySceneInputs();scene.objects=[{...object('wall','facility',moved(box(3,3,1),[1,2,3]),'PZ'),facilityKind:'auto'}];
  const doc=createDocument(box(5,6,3),42,'shop',undefined,undefined,scene),before=generateDocument(doc);
  const removed=editObjects(doc,{direction:'PZ',cells:[[1,4,3]]},'facility','remove').document;
  expect(removed.sceneInputs.objects.length).toBeGreaterThan(1);
  const after=generateDocument(removed),survivors=after.environment!.wallFacilities!.placements;
  expect(survivors).toHaveLength(8);expect(survivors.every(p=>p.asset.startsWith('wall-facility.fire-escape.'))).toBe(true);
  expect(survivors.map(p=>p.center).sort()).toEqual(before.environment!.wallFacilities!.placements.filter(p=>Math.floor(p.center[0])!==1||Math.floor(p.center[1])!==4).map(p=>p.center).sort());
  expect(after.environment!.wallFacilities!.traces.every(t=>t.candidates[0].reasonCodes.includes('MOVEMENT_NOT_IMPLEMENTED'))).toBe(true);
  expect(relations(after).supports.every(s=>s.boundaryRunIds!.length===1&&s.surface!.zoneIds.length===0)).toBe(true);
});

it('T09: mixed-height wall fragments keep explicit kind, and automatic columns use their own ground connection',()=>{
  const scene=emptySceneInputs();scene.objects=[{...object('base','facility',[[1,0,3],[2,0,3]],'PZ'),facilityKind:'auto'},
    {...object('tall','facility',[[2,1,3],[2,2,3]],'PZ'),facilityKind:'auto'},
    {...object('explicit','facility',[[3,0,3]],'PZ'),facilityKind:'fire-escape'}];
  const doc=createDocument(box(5,5,3),42,'shop',undefined,undefined,scene),r=generateDocument(doc);
  // Isolate classification from the independently tested protected ground portal.
  const plan=planWallFacilities(doc,r.surfaces,r.environment!.vertical!,new Set(),new ReservationBook(r.environment!.spatial!.staticReservations));
  expect(plan.placements).toHaveLength(5);
  expect(plan.placements.filter(p=>Math.floor(p.center[0])===2).every(p=>p.asset.startsWith('wall-facility.elevator.'))).toBe(true);
  expect(plan.placements.find(p=>Math.floor(p.center[0])===1)!.asset).toContain('balcony');
  expect(plan.placements.find(p=>Math.floor(p.center[0])===3)!.asset).toContain('fire-escape');
});

it.each(['PX','NX','PZ','NZ'] as const)('T11/T15: %s support, owner and rejection refer to the actual wall under translation',direction=>{
  const offset:Vec3=[999990,-4,-999990],cells=moved(box(3,3,3),offset),host=add(offset,direction==='PX'?[2,1,1]:direction==='NX'?[0,1,1]:direction==='PZ'?[1,1,2]:[1,1,0]);
  const scene=emptySceneInputs();scene.objects=[object('wall','facility',[add(host,BASES[direction].n)],direction)];
  const doc=createDocument(cells,42,'office',undefined,undefined,scene),before=generateDocument(doc),s=relations(before).supports[0];
  expect(s.surface?.faceId).toBe(`${cellId(host)}|${direction}`);expect(s.surface?.supportOwner).toBe(doc.buildings[0].componentId);
  expect(before.environment!.wallFacilities!.placements).toHaveLength(1);
  const lost=generateDocument(replaceGrid(doc,cells.filter(c=>cellId(c)!==cellId(host))));
  expect(relations(lost).supports[0].reasonCodes).toEqual(['NO_WALL_SUPPORT']);
  expect(lost.environment!.wallFacilities!.groups[0].reason).toBe('NO_WALL_SUPPORT');
  expect(lost.environment!.wallFacilities!.placements).toEqual([]);
});

it('T10: median vegetation context belongs to each absolute column, independent of rectangle splitting',()=>{
  const scene=emptySceneInputs();scene.roads=[[0,0,-1],[0,0,1]];scene.objects=[object('green','vegetation',[[0,0,0],[1,0,0]])];
  const doc=createDocument([],42,'office',undefined,undefined,scene),a=generateDocument(doc);
  expect(geometry(a).map(p=>p.asset)).toEqual(['median-planter','shrub']);
  const b=generateDocument(replaceSceneInputs(doc,{...scene,objects:scene.objects[0].cells.map((c,i)=>object(`part-${i}`,'vegetation',[c]))}));
  expect(geometry(b)).toEqual(geometry(a));
});

it.each([1,2,4])('T07/T10: width %i road module/ports, frontage and junction keepout update after a cut',width=>{
  const scene=emptySceneInputs();scene.roads=[...box(width,1,width*3),...moved(box(width*3,1,width),[-width,0,width])];
  const slot:Vec3=[-1,0,width*2];scene.objects=[object('lamp','lighting',[slot])];
  const doc=createDocument([],42,'office',undefined,undefined,scene),r=generateDocument(doc);
  const view=relations(r),junction=view.roads.find(r=>r.module.shape==='cross')!;
  expect(junction.module.ports).toHaveLength(4);
  expect(view.roads.flatMap(r=>r.module.cells).map(cellId).sort()).toEqual(doc.sceneInputs.roads.map(cellId).sort());
  for(const road of view.roads)for(const id of road.frontageIds){
    const frontage=r.environment!.spatial!.roadFrontages.find(f=>f.id===id)!;
    expect(frontage.cells.some(c=>road.module.cells.some(m=>cellId(m)===cellId(c)))).toBe(true);
  }
  expect(r.environment!.fixtures!.traces.some(t=>t.relationIds?.includes(junction.module.id)&&t.candidates.some(c=>c.reasonCodes.includes('INTERSECTION_KEEPOUT')))).toBe(true);
  const cut=editRoads(doc,{direction:'PY',cells:doc.sceneInputs.roads.filter(c=>c[0]<0||c[0]>=width).map(c=>[c[0],-1,c[2]])},'remove');
  const after=generateDocument(cut);expect(relations(after).roads.some(r=>r.module.shape==='tee'||r.module.shape==='cross')).toBe(false);
  expect(after.environment!.fixtures!.traces.some(t=>t.candidates.some(c=>c.reasonCodes.includes('INTERSECTION_KEEPOUT')))).toBe(false);
  const noRoad=generateDocument(replaceSceneInputs(cut,{...cut.sceneInputs,roads:[]}));
  expect(relations(noRoad).roads).toEqual([]);
  expect(noRoad.environment!.fixtures!.placements.every(p=>JSON.parse(p.context).accessMode==='service-unverified')).toBe(true);
});

it('T02/T14: relations and decisions are immutable, deterministic across cache/order/history/JSON without document fields',()=>{
  const scene=emptySceneInputs();scene.roads=moved(box(6,1,1),[0,0,-2]);scene.objects=[object('plants','vegetation',[[0,0,1]]),object('facility','facility',[[1,0,1],[2,0,1]])];
  const doc=createDocument(moved(box(2,3,2),[4,0,2]),42,'urban-shop',undefined,undefined,scene),cache=new EnvironmentCache();
  const a=generateDocument(doc,{cache:false});expect(generateDocument(doc,{cache})).toEqual(a);expect(generateDocument(doc,{cache})).toEqual(a);
  const permutation=structuredClone(doc);permutation.grid.reverse();permutation.sceneInputs.roads.reverse();permutation.sceneInputs.objects.reverse().forEach(o=>o.cells.reverse());
  expect(generateDocument(permutation,{cache:false})).toEqual(a);
  expect(()=>relations(a).supports[0].reasonCodes.push('tamper')).toThrow();
  expect(()=>relations(a).roads[0].module.ports.push('north')).toThrow();
  expect(generateDocument(loadDocument(exportDocument(doc)))).toEqual(a);
  expect(JSON.parse(exportDocument(doc))).not.toHaveProperty('relations');
  const edit=editObjects(doc,{direction:'PY',cells:[[1,0,1]]},'facility','remove'),history=new DocumentHistory(doc);history.commit(edit.document);
  expect(generateDocument(history.undo()!)).toEqual(a);expect(generateDocument(history.redo()!)).toEqual(generateDocument(edit.document));
  expect(editObjects(edit.document,{direction:'PY',cells:[[1,0,1]]},'facility','remove').changed).toBe(false);
});

it('T03/T15: an enclosed air cavity is not exposed installation support',()=>{
  const grid=box(3,3,3).filter(c=>cellId(c)!=='1,1,1'),scene=emptySceneInputs();scene.objects=[object('sealed','facility',[[1,1,1]])];
  const doc=createDocument(grid,42,'office',undefined,undefined,scene),index=new SupportIndex(doc,analyzeVolume(grid,'region-context-v1'));
  expect(index.records[0]).toMatchObject({accepted:false,reasonCodes:['NO_SUPPORTED_SURFACE']});
  expect(index.records[0].surface).toBeUndefined();
});
