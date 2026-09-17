import {expect,it} from 'vitest';
import {createDocument,replaceSceneInputs} from '../src/core/document';
import {generateDocument} from '../src/core/generate-document';
import {emptySceneInputs,type ObjectInput} from '../src/core/scene-inputs';
import {box} from '../src/fixtures';
import {parkingFixture} from '../src/parking-fixtures';
import {boxesOverlap} from '../src/core/placement-bounds';
import type {Vec3} from '../src/core/analysis';
const input=(id:string,category:ObjectInput['category'],cells:Vec3[]):ObjectInput=>({id,category,cells,direction:'PY'});
function roadside(){const scene=emptySceneInputs();scene.roads=box(16,1,1).map(([x,y])=>[x,y,-1]);scene.objects=[input('facility','facility',box(16,1,1))];return createDocument([],42,'office',undefined,undefined,scene);}
function rest(){const scene=emptySceneInputs();scene.objects=[input('facility','facility',box(16,1,1)),input('trees','vegetation',box(16,1,1).map(([x,y])=>[x,y,-1]))];return createDocument([],42,'office',undefined,undefined,scene);}
const geometry=(result:ReturnType<typeof generateDocument>)=>result.environment!.fixtures!.placements.map(p=>({asset:p.asset,center:p.center,size:p.size,heading:p.yawQuarterTurns,color:p.color}));
it('interprets the same facility strip as local vegetation rest, public streetscape and a parking gate',()=>{
  const vegetation=generateDocument(rest()),street=generateDocument(roadside());
  expect(vegetation.environment!.fixtures!.placements.some(p=>p.asset==='fixture.bench')).toBe(true);
  expect(vegetation.environment!.fixtures!.placements.every(p=>JSON.parse(p.context).accessMode==='local-only')).toBe(true);
  expect(street.environment!.fixtures!.placements.some(p=>p.asset==='fixture.bin'||p.asset==='fixture.hydrant')).toBe(true);
  expect(street.environment!.fixtures!.placements.every(p=>JSON.parse(p.context).accessMode==='public')).toBe(true);
  expect(street.environment!.fixtures!.placements.length).toBeLessThan(16);expect(street.environment!.fixtures!.counters.emptySlots).toBeGreaterThan(0);
  const lot=parkingFixture('R12');lot.sceneInputs.objects=[input('facility','facility',box(12,1,1))];const parking=generateDocument(lot);
  expect(parking.environment!.fixtures!.placements.some(p=>p.asset==='fixture.raised-barrier-post')).toBe(true);
  expect(parking.environment!.parking![0].quality.acceptedStalls).toBe(18);
},30000);
it('uses absolute slots under front cropping, fragment IDs and input permutations',()=>{
  const document=roadside(),before=generateDocument(document),cropped=replaceSceneInputs(document,{...document.sceneInputs,objects:[input('renamed','facility',document.sceneInputs.objects[0].cells.filter(c=>c[0]>0))]});
  const after=generateDocument(cropped);expect(geometry(after).filter(p=>p.center[0]>4)).toEqual(geometry(before).filter(p=>p.center[0]>4));
  const split=replaceSceneInputs(document,{...document.sceneInputs,roads:[...document.sceneInputs.roads].reverse(),objects:[input('right','facility',box(8,1,1).map(([x,y,z])=>[x+8,y,z])),input('left','facility',box(8,1,1))]});
  expect(geometry(generateDocument(split))).toEqual(geometry(before));
});
it('keeps bodies and use spaces disjoint and respects spacing between winning clusters',()=>{
  const result=generateDocument(rest()),plan=result.environment!.fixtures!,body=plan.reservations.filter(r=>r.kind!=='walk'),use=plan.reservations.filter(r=>r.kind==='walk');
  expect(plan.counters.maxVariantsPerAnchor).toBeLessThanOrEqual(8);
  for(const a of body)for(const b of use)expect(a.boxes16.some(x=>b.boxes16.some(y=>boxesOverlap(x,y)))).toBe(false);
  for(let i=0;i<body.length;i++)for(let j=0;j<i;j++)expect(body[i].boxes16.some(x=>body[j].boxes16.some(y=>boxesOverlap(x,y)))).toBe(false);
  for(const p of plan.placements.filter(p=>p.asset==='fixture.bench'))expect(p.yawQuarterTurns).toBe(0);
  expect(plan.traces.flatMap(t=>t.candidates).some(c=>c.reasonCodes.includes('LOCAL_ACCESS_ONLY'))).toBe(true);
});
it('uses fixed height variants and marks roof service access unverified without inventing a stair',()=>{
  const scene=emptySceneInputs();scene.objects=[input('roof','facility',box(3,2,3).map(([x,y,z])=>[x,y+1,z]))];
  const result=generateDocument(createDocument(box(3,1,3),42,'office',undefined,undefined,scene));
  expect(result.environment!.fixtures!.placements.some(p=>p.asset==='fixture.water-tank')).toBe(true);
  expect(result.environment!.fixtures!.placements.every(p=>JSON.parse(p.context).accessMode==='service-unverified')).toBe(true);
  expect(result.environment!.fixtures!.traces.flatMap(t=>t.candidates).some(c=>c.reasonCodes.includes('MAINTENANCE_ROUTE_UNVERIFIED'))).toBe(true);
});

it('suppression uses all higher-priority potential clusters even when the intermediate cluster loses',()=>{
 const scene=emptySceneInputs();scene.roads=box(7,1,1).map(([x,y])=>[x,y,-1]);scene.objects=[0,4,6].map(x=>input(`lamp-${x}`,'lighting',[[x,0,0]]));
 const plan=generateDocument(createDocument([],15,'office',undefined,undefined,scene)).environment!.fixtures!;
 expect(plan.placements).toHaveLength(1);expect(plan.placements[0].id).toContain(':0,0,0:');
 const suppressed=plan.traces.flatMap(t=>t.candidates).filter(c=>c.reasonCodes.includes('LOCAL_PRIORITY_SUPPRESSED'));
 expect(suppressed.find(c=>c.candidateId.includes(':4,0,0:'))!.conflictIds[0]).toContain(':0,0,0:');
 expect(suppressed.find(c=>c.candidateId.includes(':6,0,0:'))!.conflictIds[0]).toContain(':4,0,0:');
});
it('roadless vegetation does not invent a usable local pocket inside a narrow blocked channel',()=>{
 const scene=emptySceneInputs();scene.objects=[input('rest','facility',[[0,0,0]]),input('tree','vegetation',[[0,0,-1]])];
 const cells=[[-1,0,0],[1,0,0],[-1,0,1],[1,0,1],[0,0,2]] as Vec3[],plan=generateDocument(createDocument(cells,42,'office',undefined,undefined,scene)).environment!.fixtures!;
 expect(plan.placements).toEqual([]);expect(plan.traces.flatMap(t=>t.candidates).some(c=>c.reasonCodes.includes('NO_USE_CLEARANCE'))).toBe(true);
});
