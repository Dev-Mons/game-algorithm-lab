import {expect,it} from 'vitest';
import {createDocument,replaceGrid,exportDocument,loadDocument} from '../src/core/document';
import {generateDocument} from '../src/core/generate-document';
import {planFacade,validateFacadeJoints} from '../src/core/facade-plan';
import {FRAME_ASSETS} from '../src/core/urban-facade-assets';
import {buildCraftedGeometry} from '../src/crafted-geometry';
import {box} from '../src/fixtures';
import {URBAN_FIXTURES} from '../src/urban-fixtures';
import type {Vec3} from '../src/core/analysis';

it.each([2,3,4])('priority 3: period %i produces actual multi-floor meshes with compatible U/V joins',period=>{
  const d=createDocument(box(14,12,4),17,'urban-office');d.buildings[0].design.overrides={familyId:`bay-${period}`};
  const r=generateDocument(d,{cache:false}),plan=r.environment!.facades![0];expect(plan.counters.completeGroups).toBeGreaterThan(0);validateFacadeJoints(plan);
  expect(plan.counters.faceChecks).toBeLessThanOrEqual(r.surfaces.length);
  const placements=new Map(r.placements.map(p=>[p.faceId,p]));
  for(const f of plan.faces)expect(placements.get(f.faceId)!.faceAssetKey).toContain(f.assetKey);
  expect(generateDocument(loadDocument(exportDocument(d)))).toEqual(r);
});

it('priority 3: actual frame geometry has matching rails on both horizontal and vertical interior seams',()=>{
  const d=createDocument(box(12,10,4),3,'urban-office'),r=generateDocument(d),plan=r.environment!.facades![0];
  const geometries=new Map(Object.keys(FRAME_ASSETS).map(key=>[key,buildCraftedGeometry(key)]));
  const seam=(key:string,axis:number,side:number)=>{const g=geometries.get(key)!,p=g.getAttribute('position'),idx=g.getIndex()!,result=new Set<string>();for(const group of g.groups.filter(g=>g.materialIndex===1))for(let j=group.start;j<group.start+group.count;j++){const i=idx.getX(j);if(Math.abs(p.getComponent(i,axis)-side)<1e-6)result.add([p.getComponent(i,1-axis),p.getZ(i)].map(n=>n.toFixed(6)).join(','));}return [...result].sort();};
  const faces=new Map(plan.faces.map(f=>[`${f.panelId}:${f.u}:${f.v}`,f]));let joins=0;
  for(const f of plan.faces)for(const axis of [0,1]){const next=faces.get(`${f.panelId}:${f.u+(axis===0?1:0)}:${f.v+(axis===1?1:0)}`);if(next){expect(seam(f.assetKey,axis,.5)).toEqual(seam(next.assetKey,axis,-.5));joins++;}}
  expect(joins).toBeGreaterThan(0);
  for(const [key,g] of geometries){const descriptor=FRAME_ASSETS[key as keyof typeof FRAME_ASSETS],p=g.getAttribute('position');for(let i=0;i<p.count;i++)for(let a=0;a<3;a++){expect(p.getComponent(i,a)*16).toBeGreaterThanOrEqual(descriptor.bounds16.min[a]-1e-5);expect(p.getComponent(i,a)*16).toBeLessThanOrEqual(descriptor.bounds16.max[a]+1e-5);}g.dispose();}
});

it('priority 3: a deleted face repairs its complete group and preserves distant groups and the opposite wall',()=>{
  const doc=createDocument(box(14,12,4),17,'urban-office');doc.buildings[0].design.overrides={familyId:'bay-3'};
  const before=generateDocument(doc),next=replaceGrid(doc,doc.grid.filter(c=>c.join(',')!=='4,5,3')),after=generateDocument(next,{cache:false});
  const a=before.environment!.facades![0],b=after.environment!.facades![0],changed=a.faces.find(f=>f.faceId==='4,5,3|PZ')!;
  expect(changed).toBeDefined();expect(b.faces.some(f=>f.panelId===changed.panelId)).toBe(false);
  const surviving=new Map(b.faces.map(f=>[f.faceId,f]));for(const f of a.faces.filter(f=>f.panelId!==changed.panelId&&f.faceId.endsWith('|NZ')))expect(surviving.get(f.faceId)).toEqual(f);
  const map=new Map(after.placements.map(p=>[p.faceId,p]));let distant=0;
  for(const p of before.placements){const c=p.faceId.split('|')[0].split(',').map(Number);if(p.faceId.endsWith('|NZ')||p.faceId.endsWith('|PZ')&&Math.abs(c[0]-4)>4){expect(map.get(p.faceId)?.tileId,p.faceId).toBe(p.tileId);distant++;}}
  expect(distant).toBeGreaterThan(100);expect(generateDocument(next)).toEqual(after);
});

it('priority 3: physical holes, fixed portals, minimum size and budget exhaustion close complete groups without search',()=>{
  const d=createDocument(URBAN_FIXTURES.openCourt,5,'urban-office'),r=generateDocument(d),v=r.environment!.vertical![0],g=d.buildingDefinition.facadeGrammar!;
  const base=planFacade(r.surfaces,v,g),face=base.faces[0];expect(face).toBeDefined();
  const fixed=planFacade(r.surfaces,v,g,new Set([face.faceId]));expect(fixed.panels.find(p=>p.id===face.panelId)?.reason).toBe('FIXED_CONSTRAINT');expect(fixed.faces.some(f=>f.panelId===face.panelId)).toBe(false);
  const limited=planFacade(r.surfaces,v,{...g,maxGroups:1});expect(limited.counters.budgetExceeded).toBe(true);expect(limited.panels.some(p=>p.reason==='BUDGET_EXCEEDED')).toBe(true);
  expect(planFacade(r.surfaces,v,{...g,minWidth:8}).panels.every(p=>p.reason==='MINIMUM_SIZE')).toBe(true);
  const negative=createDocument(box(10,8,4).map(([x,y,z])=>[x-10,y,z-5] as Vec3),5,'urban-office');expect(generateDocument(negative).status).toBe('ok');
});
