import {expect,it} from 'vitest';
import {analyze,type Vec3} from '../src/core/analysis';
import {createDocument,exportDocument,loadDocument,replaceGrid,setBuildingTheme,BUILDING_PROFILES} from '../src/core/document';
import {generateDocument} from '../src/core/generate-document';
import {DocumentHistory} from '../src/editor';
import {editObjects} from '../src/scene-editor';
import {surfaceOutline} from '../src/surface-outline';
import {box} from '../src/fixtures';
import {FACADE_TILE_SETS,type FacadeTileSet} from '../src/core/facade-tile-settings';

it.each([false,true])('a 2x2 facility area fills four fixed columns; deletion cannot move or spawn another model (roof=%s)',roof=>{
  const base=createDocument(roof?box(2,1,2):[],42,'shop');
  const cells=box(2,1,2).map(([x,,z])=>[x,roof?0:-1,z] as Vec3);
  const placed=editObjects(base,{direction:'PY',cells},'facility','add');
  const before=generateDocument(placed.document).environment!.fixtures!.placements;
  expect(before).toHaveLength(4);
  const cut=editObjects(placed.document,{direction:'PY',cells:[placed.selection.cells[0]]},'facility','remove');
  const after=generateDocument(cut.document).environment!.fixtures!.placements;
  expect(after).toHaveLength(3);
  const shape=(p:typeof before[number])=>({asset:p.asset,center:p.center,size:p.size});
  expect(after.map(shape)).toEqual(before.filter(p=>!(p.center[0]<1&&p.center[2]<1)).map(shape));
  const restored=loadDocument(exportDocument(cut.document));
  expect(generateDocument(restored)).toEqual(generateDocument(cut.document));
  const history=new DocumentHistory(base);history.commit(placed.document);history.commit(cut.document);
  expect(generateDocument(history.undo()!).environment!.fixtures!.placements).toEqual(before);
});

it('only the edited roof facility column changes height',()=>{
  const base=createDocument(box(2,1,2),42,'shop');
  const placed=editObjects(base,{direction:'PY',cells:box(2,1,2)},'facility','add');
  const tall=editObjects(placed.document,{direction:'PY',cells:[[0,1,0]]},'facility','add');
  const placements=generateDocument(tall.document).environment!.fixtures!.placements;
  expect(placements.filter(p=>p.asset==='fixture.water-tank')).toHaveLength(1);
  expect(placements.filter(p=>p.asset==='fixture.air-conditioner')).toHaveLength(3);
});

it('deleting a street facility cannot activate a suppressed model or change other poses',()=>{
  const cells=box(8,1,1),base=createDocument([],42,'shop',undefined,undefined,{version:2,roads:cells.map(([x])=>[x,0,-1]),parkingAreas:[],objects:[]});
  const installed=editObjects(base,{direction:'PY',cells:cells.map(([x])=>[x,-1,0])},'facility','add').document;
  const before=generateDocument(installed).environment!.fixtures!.placements;
  expect(before).toHaveLength(8);
  const cut=editObjects(installed,{direction:'PY',cells:[[3,0,0]]},'facility','remove').document;
  const after=generateDocument(cut).environment!.fixtures!.placements;
  const shape=(p:typeof before[number])=>({id:p.id,asset:p.asset,center:p.center,size:p.size,heading:p.yawQuarterTurns});
  expect(after.map(shape)).toEqual(before.filter(p=>Math.floor(p.center[0])!==3).map(shape));
});

it('a wall strip automatically becomes stairs then an elevator and reverses after deleting the ground cell',()=>{
  const base=createDocument(box(5,6,3),42,'shop');
  let doc=editObjects(base,{direction:'NX',cells:[[0,3,1]]},'facility','add').document;
  const assets=()=>generateDocument(doc).environment!.wallFacilities!.placements.map(p=>p.asset);
  expect(assets()).toHaveLength(1);expect(assets().every(a=>a.includes('.balcony.'))).toBe(true);
  doc=editObjects(doc,{direction:'NX',cells:[[0,2,1],[0,1,1]]},'facility','add').document;
  expect(doc.sceneInputs.objects).toHaveLength(1);
  expect(assets()).toHaveLength(3);expect(assets().every(a=>a.includes('.fire-escape.'))).toBe(true);
  doc=editObjects(doc,{direction:'NX',cells:[[0,0,1]]},'facility','add').document;
  expect(assets()).toHaveLength(4);expect(assets().every(a=>a.includes('.elevator.'))).toBe(true);
  doc=editObjects(doc,{direction:'NX',cells:[[-1,0,1]]},'facility','remove').document;
  expect(assets()).toHaveLength(3);expect(assets().every(a=>a.includes('.fire-escape.'))).toBe(true);
  expect(loadDocument(exportDocument(doc))).toEqual(doc);
});

it('selection outlines exclude coplanar seams and retain stepped concave edges',()=>{
  const cube=analyze(box(2,2,2)),outline=surfaceOutline(cube.surfaces);
  expect(outline).toHaveLength(24*6); // Twelve outer edges, two unit segments each.
  const raised=surfaceOutline(cube.surfaces,.14),ends=new Map<string,number>();
  for(let i=0;i<raised.length;i+=3){const key=raised.slice(i,i+3).join(',');ends.set(key,(ends.get(key)??0)+1);}
  expect([...ends.values()].every(n=>n>=2)).toBe(true); // Relief clearance must not open gaps at corners.
  const step=analyze([...box(3,1,2),...box(1,1,2).map(([x,,z])=>[x,1,z] as Vec3)]);
  const expected=step.features.filter(e=>e.kind!=='flat');
  expect(surfaceOutline(step.surfaces)).toHaveLength(expected.length*6);
});

it.each(Object.keys(FACADE_TILE_SETS) as FacadeTileSet[])('role tile replacement %s preserves entrances, persists and follows building edits',set=>{
  const base=createDocument(box(6,8,3),42,'shop');
  const theme={...base.buildingDefinition,tileSettings:{base:set,corner:set,body:set,crown:set}};
  const doc=setBuildingTheme(base,base.buildings[0].componentId,theme),before=generateDocument(base),after=generateDocument(doc);
  expect(after.placements.filter(p=>p.ruleId==='building.entrance')).toEqual(before.placements.filter(p=>p.ruleId==='building.entrance'));
  const custom=after.traces.filter(t=>t.facade?.reason.startsWith('custom'));
  expect(custom.length).toBeGreaterThan(30);
  for(const role of ['base','body','crown','corner'])expect(custom.some(t=>t.facade!.reason===`custom ${role} tile: ${set}`)).toBe(true);
  expect(after.placements).not.toEqual(before.placements);
  expect(generateDocument(loadDocument(exportDocument(doc)))).toEqual(after);
  expect(replaceGrid(doc,[...doc.grid,[-1,0,0]]).buildings[0].theme?.tileSettings).toEqual(theme.tileSettings);
});

it.each(Object.keys(BUILDING_PROFILES) as (keyof typeof BUILDING_PROFILES)[])('all concepts accept custom low/corner/middle tiles (%s)',profile=>{
  const base=createDocument(box(5,7,3),42,profile);
  const doc=setBuildingTheme(base,base.buildings[0].componentId,{...base.buildingDefinition,tileSettings:{base:'D',corner:'B',body:'C',crown:'A'}});
  expect(generateDocument(doc).traces.some(t=>t.facade?.reason==='custom corner tile: B')).toBe(true);
});

it('corner tile settings apply even on walls shorter than the concept corner pattern minimum',()=>{
  const base=createDocument(box(2,5,2),42,'shop');
  const doc=setBuildingTheme(base,base.buildings[0].componentId,{...base.buildingDefinition,tileSettings:{corner:'D'}});
  const traces=generateDocument(doc).traces.filter(t=>t.role==='wall'&&t.facade&&!t.facade.portalId);
  expect(traces.length).toBeGreaterThan(0);
  expect(traces.every(t=>t.facade!.reason==='custom corner tile: D')).toBe(true);
});
