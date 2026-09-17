import {expect,it} from 'vitest';
import {applyEnvironmentEdit,rankSourceHits} from '../src/environment-editor';
import {createDocument,exportDocument,loadDocument,replaceGrid} from '../src/core/document';
import {DocumentHistory} from '../src/editor';
import {box} from '../src/fixtures';
import type {Vec3} from '../src/core/analysis';
it('edits masks by union/difference without consuming other layers; splits preserve ID and anchor through history',()=>{
  const original=createDocument([[0,0,0]],42,'office');
  const added=applyEnvironmentEdit(original,{kind:'parking-add',cells:box(6,1,5)});
  const area=added.document.sceneInputs.parkingAreas[0],targetId=area.id;
  expect(added.document.grid).toEqual(original.grid);expect(targetId).toBe('parking:0,0,0:1');
  const removed=applyEnvironmentEdit(added.document,{kind:'parking-remove',targetId,cells:box(1,1,5).map(([x,y,z])=>[x+2,y,z] as Vec3)});
  expect(removed.document.sceneInputs.parkingAreas[0]).toMatchObject({id:targetId,anchor:[0,0,0]});
  expect(removed.document.sceneInputs.parkingAreas[0].cells).toHaveLength(25);
  const history=new DocumentHistory(added.document);history.commit(removed.document);
  expect(history.peek('undo')).toEqual(added.document);expect(history.undo()).toEqual(added.document);expect(history.redo()).toEqual(removed.document);
  expect(loadDocument(exportDocument(removed.document))).toEqual(removed.document);
  const empty=applyEnvironmentEdit(removed.document,{kind:'parking-remove',targetId,cells:box(6,1,5)});expect(empty.document.sceneInputs.parkingAreas).toEqual([]);
  expect(added.delta.parkingIds).toEqual([targetId]);expect(removed.changed).toBe(true);
});
it('rejects overlapping independent masks, unsupported heights and unknown settings without mutation',()=>{
  const a=applyEnvironmentEdit(createDocument([]),{kind:'parking-add',cells:[[0,0,0]]}).document,before=exportDocument(a);
  for(const command of [
    {kind:'parking-add',cells:[[0,0,0]]},{kind:'parking-add',cells:[[0,1,0]]},
    {kind:'setting',settingPath:'parking.stallDepthCells',value:3},{kind:'setting',settingPath:'unknown.value',value:1},
    {kind:'setting',settingPath:'__proto__.polluted',value:true},
  ] as const)expect(()=>applyEnvironmentEdit(a,command as Parameters<typeof applyEnvironmentEdit>[1])).toThrow();
  expect(exportDocument(a)).toBe(before);
});
it('records actual road deltas and no-op signatures, and preserves settings across later input changes',()=>{
  const a=applyEnvironmentEdit(createDocument([]),{kind:'setting',settingPath:'access.maxWalkDistanceCells',value:31}).document;
  const road=applyEnvironmentEdit(a,{kind:'road-add',cells:[[0,0,0],[1,0,0]]});
  expect(road.delta.roadCells).toHaveLength(2);expect(road.beforeSignature).not.toBe(road.afterSignature);
  const repeated=applyEnvironmentEdit(road.document,{kind:'road-add',cells:[[1,0,0],[0,0,0]]});expect(repeated.changed).toBe(false);expect(repeated.beforeSignature).toBe(repeated.afterSignature);
  expect(replaceGrid(road.document,[[3,0,0]]).environment.access.maxWalkDistanceCells).toBe(31);
  const remove=applyEnvironmentEdit(road.document,{kind:'road-remove',cells:[[0,0,0]]});expect(remove.delta.roadCells).toEqual([[0,0,0]]);
});
it('edits independent building use and stored band policy while preserving theme and rule',()=>{
  const a=createDocument([[0,0,0]],42,'shop'),use=applyEnvironmentEdit(a,{kind:'building-design',targetId:'0,0,0',settingPath:'use',value:'industrial'}).document;
  const band=applyEnvironmentEdit(use,{kind:'building-design',targetId:'0,0,0',settingPath:'bandPolicy.baseCountOverride',value:2}).document;
  expect(band.buildings[0].rule).toEqual(a.buildings[0].rule);expect(band.buildings[0].design.use).toBe('industrial');expect(band.buildings[0].theme?.bandPolicy.baseCountOverride).toBe(2);
  expect(applyEnvironmentEdit(band,{kind:'building-design',targetId:'0,0,0',settingPath:'bandPolicy.baseCountOverride'}).document.buildings[0].theme?.bandPolicy.baseCountOverride).toBeUndefined();
});
it('source hit ties follow edit kind, distance, numeric anchor and ASCII ID, not input order',()=>{
  const hits=[{source:{kind:'object' as const,id:'object'},distance:1,anchor:[0,0,0] as Vec3},{source:{kind:'parking' as const,id:'b'},distance:2,anchor:[10,0,0] as Vec3},{source:{kind:'parking' as const,id:'a'},distance:2,anchor:[2,0,0] as Vec3}];
  expect(rankSourceHits(hits,'parking').map(h=>h.source.id)).toEqual(['a','b','object']);expect(rankSourceHits([...hits].reverse(),'parking')).toEqual(rankSourceHits(hits,'parking'));
});
