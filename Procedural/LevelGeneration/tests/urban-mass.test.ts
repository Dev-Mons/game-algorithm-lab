import {expect,it} from 'vitest';
import {createDocument,replaceGrid} from '../src/core/document';
import {generateDocument} from '../src/core/generate-document';
import {URBAN_FIXTURES} from '../src/urban-fixtures';
import {box} from '../src/fixtures';
import {analyzeMass} from '../src/core/mass-relations';
import {URBAN_SHOP_STYLE} from '../src/core/building-style';

it.each(Object.entries(URBAN_FIXTURES))('priority 2: %s has exact SurfaceRegion zone masks and unique output ownership',(name,cells)=>{
  const doc=createDocument(cells,17,'urban-shop'),r=generateDocument(doc,{cache:false}),v=r.environment!.vertical![0];
  expect(r.status,name).toBe('ok');const walls=r.surfaces.filter(s=>s.role==='wall'),faces=new Map(walls.map(s=>[s.faceId,s]));
  expect(v.zones!.flatMap(z=>z.faceIds).sort()).toEqual(walls.map(s=>s.faceId).sort());
  for(const z of v.zones!)for(const id of z.faceIds){const face=faces.get(id)!;expect(face.architecture!.regionId).toBe(z.regionId);expect(face.cell[1]).toBeGreaterThanOrEqual(z.yMin);expect(face.cell[1]).toBeLessThan(z.yMaxExclusive);}
  expect(new Set(r.placements.map(p=>p.faceId)).size).toBe(r.surfaces.length);
  // No upper ground reactivation: every retail face remains at the actual ground program.
  for(const f of v.faceBands.filter(f=>f.band==='retail'))expect(faces.get(f.faceId)!.cell[1]).toBeLessThan(2);
  expect(v.mass!.counters.overlapChecks).toBe(cells.length);
  if(name==='towers'){expect(v.mass!.slices.some(s=>s.children.length===2)).toBe(true);expect(v.faceBands.find(f=>f.faceId==='10,7,4|PZ')!.band).toBe('upper');expect(v.faceBands.find(f=>f.faceId==='2,10,4|PZ')!.band).toBe('upper');}
  if(name==='towers')expect(v.mass!.scopes.map(s=>s.role).sort()).toEqual(['podium','tower','tower']);
  if(name==='annex'){expect(v.faceBands.find(f=>f.faceId==='8,3,3|PZ')!.band).toBe('upper');expect(v.mass!.scopes.some(s=>s.role==='annex')).toBe(true);}
  if(name==='remerge')expect(v.mass!.slices.some(s=>s.parents.length===2)).toBe(true);
  if(name==='sealed')expect(r.surfaces.some(s=>s.cell[0]===2&&s.cell[2]===2&&s.cell[1]>0&&s.cell[1]<5)).toBe(false);
});

it('priority 2: a one-cell notch is a geometric event, not a new architectural mass',()=>{
  const policy=URBAN_SHOP_STYLE.massPolicy!,a=analyzeMass(box(10,10,5),policy),b=analyzeMass(URBAN_FIXTURES.notch,policy);
  expect(b.events.some(e=>e.kind!=='persist')).toBe(true);expect(b.events.some(e=>e.significant)).toBe(false);expect(b.scopes).toEqual(a.scopes);
  const doc=createDocument(box(10,10,5),17,'urban-shop'),before=generateDocument(doc),after=generateDocument(replaceGrid(doc,URBAN_FIXTURES.notch));
  const distant=(r:typeof before)=>r.placements.filter(p=>p.faceId.endsWith('|NZ')).map(p=>[p.faceId,p.tileId,p.faceAssetKey]);expect(distant(after)).toEqual(distant(before));
});
