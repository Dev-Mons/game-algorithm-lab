import {describe,it,expect} from 'vitest';
import {createDocument,exportDocument,loadDocument,setBuildingTheme,profileData} from '../src/core/document';
import {executeEnvironment} from '../src/core/environment-generation';
import {RESIDENTIAL_KIT,matchingHouse,planResidential} from '../src/core/residential-kit';
import {analyzeVolume} from '../src/core/regions';
import {type Vec3} from '../src/core/analysis';
import * as THREE from 'three';
import reproduction from './fixtures/residential-rotation.json' with {type:'json'};
import {scenePlacementBounds16,containedInUnion} from '../src/core/placement-bounds';
import {box} from '../src/fixtures';
import meshData from '../src/assets/residential/meshes.json' with {type:'json'};

describe('live Blender residential kit integration',()=>{
  const forbidden=/Porch|Carport|Chimney|Downpipe|DoorLanding|EntryLamp|Roof_Shed|Roof_PorchFascia/;
  const rotate=(cell:Vec3,turns:number):Vec3=>{
    const center=new THREE.Vector3(cell[0]+.5,cell[1]+.5,cell[2]+.5).applyMatrix4(new THREE.Matrix4().makeRotationY(turns*Math.PI/2));
    return [center.x,center.y,center.z].map(v=>Math.round(v-.5)) as Vec3;
  };
  it('reproduces the two user-edited houses with the same roof joins and no unrequested construction',()=>{
    const doc=createDocument(reproduction.grid,reproduction.seed,'residential-cream',undefined,reproduction.buildings as Parameters<typeof createDocument>[4]);
    const {result}=executeEnvironment(doc,{cache:false});
    expect(result.cells).toHaveLength(48);
    expect(result.surfaces).toHaveLength(112);
    expect(result.scenePlacements!.some(p=>forbidden.test(p.asset))).toBe(false);
    const original=result.scenePlacements!.filter(p=>p.componentId==='0,0,0'),turned=result.scenePlacements!.filter(p=>p.componentId==='6,0,1');
    expect(original.some(p=>p.asset.includes('ValleyJunction'))).toBe(true);
    expect(turned.map(p=>p.asset).sort()).toEqual(original.map(p=>p.asset).sort());
    expect(result.environment!.entrances!.map(p=>p.entrances[0].outward)).toEqual(['PZ','PX']);
  });
  it('preserves observed assemblies and complete ownership at all four rotations and negative coordinates',()=>{
    for(const example of RESIDENTIAL_KIT.examples)for(let turns=0;turns<4;turns++){
      const cells=example.cells.map(c=>rotate(c,turns).map((v,a)=>v+[-17,0,-13][a]) as Vec3);
      expect(matchingHouse(cells,`residential-${example.variant}`)?.id).toBe(example.id);
      const {result}=executeEnvironment(createDocument(cells,42,`residential-${example.variant}` as 'residential-cream'),{cache:false});
      expect(result.scenePlacements!.every(p=>p.context==='blender-assembly')).toBe(true);
      expect(result.scenePlacements!.some(p=>forbidden.test(p.asset))).toBe(false);
      expect(result.scenePlacements!.flatMap(p=>p.faceIds??[]).sort()).toEqual(result.surfaces.map(s=>s.faceId).sort());
      for(const p of result.scenePlacements!)expect(containedInUnion(scenePlacementBounds16(p),result.environment!.preflight[0].envelope.requiredBoxes16)).toBe(true);
    }
  });
  it('rotates complete module transforms, including free-volume roofs, rather than rebuilding in the world X direction',()=>{
    for(const cells of [RESIDENTIAL_KIT.examples[0].cells,box(3,2,4).filter(([x,,z])=>x<2||z<1)]){
      const original=planResidential(cells,analyzeVolume(cells).surfaces,'residential-cream','test');
      for(let turns=1;turns<4;turns++){
        const shift:Vec3=[11,3,-8],turned=cells.map(c=>rotate(c,turns).map((v,a)=>v+shift[a]) as Vec3);
        const actual=planResidential(turned,analyzeVolume(turned).surfaces,'residential-cream','test');
        const semantic=(p:typeof original[number])=>({asset:p.asset,center:p.center.map(v=>Math.round(v*1e6)/1e6),size:p.size,yaw:p.yawQuarterTurns});
        const expected=original.map(p=>({...p,center:new THREE.Vector3(...p.center).applyMatrix4(new THREE.Matrix4().makeRotationY(turns*Math.PI/2)).add(new THREE.Vector3(...shift)).toArray() as Vec3,yawQuarterTurns:((p.yawQuarterTurns??0)+turns)%4 as 0|1|2|3}));
        expect(actual.map(semantic)).toEqual(expected.map(semantic));
      }
    }
  });
  it('preserves complete source triangle, normal and UV buffers inside every declared bound',()=>{
    for(const [key,asset] of Object.entries(RESIDENTIAL_KIT.assets)){
      const mesh=(meshData as Record<string,{position:number[];normal:number[];uv:number[]}>)[key];
      expect(mesh.position.length,key).toBe(asset.triangles*9);
      expect(mesh.normal.length,key).toBe(mesh.position.length);
      expect(mesh.uv.length,key).toBe(asset.triangles*6);
      expect([...mesh.position,...mesh.normal,...mesh.uv].every(Number.isFinite),key).toBe(true);
      for(let a=0;a<3;a++)for(let i=a;i<mesh.position.length;i+=3){
        expect(mesh.position[i]*16,key).toBeGreaterThanOrEqual(asset.bounds16.min[a]-.00001);
        expect(mesh.position[i]*16,key).toBeLessThanOrEqual(asset.bounds16.max[a]+.00001);
      }
    }
  });
  for(const example of RESIDENTIAL_KIT.examples)it(`assembles ${example.id} with real source roof joins and complete coverage`,()=>{
    const doc=createDocument(example.cells,42,`residential-${example.variant}` as 'residential-cream');
    const {result}=executeEnvironment(doc,{cache:false});
    expect(result.status).toBe('ok');
    const instances=result.scenePlacements!.filter(p=>p.asset.startsWith('house-kit:'));
    expect(instances.some(p=>p.asset.includes(example.variant==='garage'?'GaragePortal':'ValleyJunction'))).toBe(true);
    expect(instances.some(p=>forbidden.test(p.asset))).toBe(false);
    const faces=instances.flatMap(p=>p.faceIds??[]);
    expect(new Set(faces).size).toBe(result.surfaces.length);
    expect(faces.length).toBe(result.surfaces.length);
    expect(result.environment!.entrances![0].entrances.length).toBeGreaterThan(0);
    if(example.variant==='garage')expect(result.environment!.entrances![0].entrances[0].outward).toBe('PZ');
    const envelope=result.environment!.preflight[0].envelope;
    for(const p of instances)expect(containedInUnion(scenePlacementBounds16(p),envelope.requiredBoxes16)).toBe(true);
    expect(executeEnvironment(loadDocument(exportDocument(doc)),{cache:false}).result.scenePlacements).toEqual(result.scenePlacements);
  });
  it('regenerates edited concave, stepped and raised volumes without filling gaps',()=>{
    for(const cells of [box(3,2,4).filter(([x,,z])=>x<2||z<2),
      [...box(2,1,3),...box(1,1,2).map(([x,y,z])=>[x,y+1,z] as [number,number,number])],
      box(1,1,2).map(([x,y,z])=>[x-100,y+3,z+90] as [number,number,number])]){
      expect(matchingHouse(cells,'residential-cream')).toBeUndefined();
      const {result}=executeEnvironment(createDocument(cells,42,'residential-cream'),{cache:false});
      expect(result.status).toBe('ok');
      const faces=result.scenePlacements!.flatMap(p=>p.faceIds??[]);
      expect([...faces].sort()).toEqual(result.surfaces.map(s=>s.faceId).sort());
      expect(result.scenePlacements!.some(p=>p.asset.includes('Roof_Slope'))).toBe(true);
    }
  });
  it('selects a house theme for one building while preserving the other concept',()=>{
    let doc=createDocument([...box(2,2,3),...box(2,2,3).map(([x,y,z])=>[x+7,y,z] as [number,number,number])],42,'office');
    doc=setBuildingTheme(doc,doc.buildings[0].componentId,profileData('residential-red').architecture);
    const {result}=executeEnvironment(doc,{cache:false});
    expect(result.placements.length).toBeGreaterThan(0);
    expect(result.scenePlacements!.some(p=>p.asset.includes('House_RedWindow'))).toBe(true);
  });
});
