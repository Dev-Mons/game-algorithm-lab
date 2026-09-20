import {it,expect} from 'vitest';
import {writeFileSync} from 'node:fs';
import {replaceGrid,canonicalJSON} from '../src/core/document';
import {createDocument} from '../tests/custom-frame-document';
import {generateDocument} from '../src/core/generate-document';
import {EnvironmentCache} from '../src/core/environment-cache';
import {URBAN_FIXTURES} from '../src/urban-fixtures';
import {box} from '../src/fixtures';
import {analyzeMass} from '../src/core/mass-relations';
import {URBAN_SHOP_STYLE} from '../src/core/building-style';

it('records measured urban generation, diversity, repair and deterministic work',()=>{
  const samples:unknown[]=[],diversity=new Set<string>();
  for(const [name,cells] of Object.entries({rectangle:box(14,12,4),...URBAN_FIXTURES}))for(const seed of [0,7,17]){
    const doc=createDocument(cells,seed,'urban-shop'),start=performance.now(),result=generateDocument(doc,{cache:false}),coldMs=performance.now()-start;
    const cache=new EnvironmentCache();generateDocument(doc,{cache});const warmStart=performance.now(),warm=generateDocument(doc,{cache}),warmMs=performance.now()-warmStart;
    expect(warm).toEqual(result);const v=result.environment!.vertical![0],f=result.environment!.facades![0];diversity.add(canonicalJSON(v.profile));
    const pairs=new Map<string,string[]>();for(const t of result.traces)if(t.facade?.groupId&&!t.facade.portalId){const p=pairs.get(t.facade.groupId)??[];p.push(t.facade.part!);pairs.set(t.facade.groupId,p);}
    for(const p of pairs.values())expect(p.sort()).toEqual(['left','right']);
    samples.push({name,seed,cells:cells.length,faces:result.surfaces.length,coldMs,warmMs,profile:v.profile,slices:v.mass!.slices.length,scopes:v.mass!.scopes.length,overlapChecks:v.mass!.counters.overlapChecks,...f.counters,frameFaceShare:f.faces.length/v.faceBands.length,fillerFaces:result.traces.filter(t=>t.facade?.patternId==='single-fallback').length});
  }
  const doc=createDocument(box(14,12,4),17,'urban-office');
  const a=generateDocument(doc),next=replaceGrid(doc,doc.grid.filter(c=>c.join(',')!=='4,5,3')),t=performance.now(),b=generateDocument(next),editMs=performance.now()-t,map=new Map(b.placements.map(p=>[p.faceId,p]));
  const changed=a.placements.filter(p=>map.has(p.faceId)&&map.get(p.faceId)!.faceAssetKey!==p.faceAssetKey).map(p=>p.faceId),far=changed.filter(id=>{const [x,y,z]=id.split('|')[0].split(',').map(Number);return Math.abs(x-4)>4||Math.abs(y-5)>2||z===0;});
  expect(far).toEqual([]);
  const policySweep=[1,4,8].flatMap(minArea=>[1,2,4].map(minPersistence=>{const policy={...URBAN_SHOP_STYLE.massPolicy!,minArea,minPersistence},notch=analyzeMass(URBAN_FIXTURES.notch,policy),tower=analyzeMass(URBAN_FIXTURES.towers,policy);return {policy,notchSignificantEvents:notch.events.filter(e=>e.significant).length,towerScopes:tower.scopes.length,towerSignificantEvents:tower.events.filter(e=>e.significant).length};}));
  const maxDoc=createDocument(box(32,32,32),17,'urban-office'),maxStart=performance.now(),maxResult=generateDocument(maxDoc,{cache:false}),maxMs=performance.now()-maxStart;
  expect(maxResult.placements).toHaveLength(6144);
  const report={issue:29,measuredAt:new Date().toISOString(),runtime:process.version,logicalFloor:'one voxel row',protocol:{runtime:'Node/Vitest, same process',cold:'cache:false; document creation excluded',warm:'fresh cache primed once',samplesPerInput:1,viewerIncluded:false,performanceSlaValidated:false},samples,profileCount:diversity.size,policySweep,maxSolid:{cells:maxDoc.grid.length,faces:maxResult.surfaces.length,coldMs:maxMs,facade:maxResult.environment!.facades![0].counters},edit:{removed:'4,5,3',editMs,changedSurvivingFaces:changed,changesOutsideRepairNeighborhood:far.length},limits:['Wall times are local observations, not latency guarantees.','Frame fallback is deterministic and bounded; no search or WFC is used.','Mass thresholds are calibrated against this finite fixture set; architectural meaning is heuristic.']};
  writeFileSync('benchmarks/urban-generation.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({samples:samples.length,profiles:diversity.size,edit:report.edit}));
},60000);
