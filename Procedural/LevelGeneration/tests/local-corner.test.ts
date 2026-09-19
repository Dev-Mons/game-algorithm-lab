import {expect,it} from 'vitest';
import {BUILDING_PROFILES,createDocument,exportDocument,loadDocument,replaceGrid,type Profile} from '../src/core/document';
import {generateDocument} from '../src/core/generate-document';
import {EnvironmentCache} from '../src/core/environment-cache';
import {faceCorners,cellId,type Vec3} from '../src/core/analysis';
import {box} from '../src/fixtures';
import {LOCAL_CORNER_CELLS} from './fixtures/local-corner';

it.each(Object.keys(BUILDING_PROFILES) as Profile[])('%s isolates the edited corner while retaining healthy facades, doors and face ownership',profile=>{
  const doc=createDocument(LOCAL_CORNER_CELLS,42,profile),result=generateDocument(doc);
  expect(result.cells).toHaveLength(86);expect(result.surfaces).toHaveLength(140);
  expect(result.status).toBe('degraded');
  expect(result.diagnostics).toContainEqual(expect.objectContaining({code:'NON_MANIFOLD_EDGE',location:'2,3,1:2,4,1'}));
  const vertexIds=new Set(['2,3,1','2,4,1']);
  const expected=new Set(result.surfaces.filter(s=>faceCorners(s.cell,s.direction).some(v=>vertexIds.has(cellId(v)))).map(s=>s.faceId));
  const affected=new Set(result.surfaces.filter(s=>s.architecture?.interpretation==='unsupported').map(s=>s.faceId));
  expect(affected).toEqual(expected);expect(affected.size).toBeLessThan(20);
  expect(new Set(result.placements.map(p=>p.faceId)).size).toBe(result.surfaces.length);
  for(const p of result.placements){
    expect(p.tileId.startsWith('panel.'),p.faceId).toBe(affected.has(p.faceId));
    if(affected.has(p.faceId))expect(p.finishIds).toEqual([]);
  }
  expect(result.environment!.entrances![0].entrances.length).toBeGreaterThan(0);
  for(const entry of result.environment!.entrances![0].entrances)for(const id of entry.faceIds)expect(affected.has(id)).toBe(false);
  expect(generateDocument({...doc,grid:[...doc.grid].reverse()},{cache:false})).toEqual(result);
  expect(generateDocument(loadDocument(exportDocument(doc)))).toEqual(result);
});

it('a bad corner does not change an unrelated building, including its frame groups',()=>{
  const healthy=box(6,8,4).map(([x,y,z])=>[x+12,y,z] as Vec3);
  const before=generateDocument(createDocument(healthy,42,'urban-office'));
  const mixed=generateDocument(createDocument([...LOCAL_CORNER_CELLS,...healthy],42,'urban-office'));
  const ids=new Set(before.surfaces.map(s=>s.faceId));
  expect(mixed.placements.filter(p=>ids.has(p.faceId))).toEqual(before.placements);
  expect(mixed.environment!.facades!.find(p=>p.buildingId==='12,0,0')).toEqual(before.environment!.facades![0]);
});

it('cached supported and basic faces stay distinct through defect creation and repair',()=>{
  const broken=createDocument(LOCAL_CORNER_CELLS,42,'office');
  const repaired=replaceGrid(broken,[...broken.grid,[2,3,0]]),cache=new EnvironmentCache();
  for(const doc of [repaired,broken,broken,repaired]){
    const result=generateDocument(doc,{cache});
    expect(result).toEqual(generateDocument(doc,{cache:false}));
    if(doc===repaired){expect(result.status).toBe('ok');expect(result.placements.some(p=>p.tileId.startsWith('panel.'))).toBe(false);}
  }
});
