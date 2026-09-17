import {Matrix4,Vector3} from "three";
import {setPlacementMatrix} from "../src/display-transform";
import {expect,it} from 'vitest';
import {BANDED_FACADE_ASSETS,TRIM_ASSETS,portalDescriptor} from '../src/core/banded-facade-assets';
import {FACADE_ASSETS} from '../src/core/facade-assets';
import {buildCraftedGeometry,CraftedGeometryLibrary} from '../src/crafted-geometry';
import {createDocument} from '../src/core/document';
import {generateDocument} from '../src/core/generate-document';
import {box} from '../src/fixtures';
import {faceBounds16,boxesOverlap,cellBox16} from '../src/core/placement-bounds';
import {BoundsIndex,ReservationBook} from '../src/core/reservations';
import {planFacadeTrims} from '../src/core/facade-trims';
import {BASES,type Vec3} from '../src/core/analysis';

it('all authored band, portal and trim vertices fit their numeric descriptors',()=>{
  const descriptors={...BANDED_FACADE_ASSETS,'facade.portal-single':portalDescriptor('single'),'facade.portal-left':portalDescriptor('left'),'facade.portal-right':portalDescriptor('right'),...TRIM_ASSETS};
  for(const [key,descriptor] of Object.entries(descriptors)){
    const parts=buildCraftedGeometry(key);
    for(const g of [parts.panel,parts.relief,parts.glass].filter(Boolean)){
      const p=g!.getAttribute('position');for(let i=0;i<p.count;i++)for(let a=0;a<3;a++){const value=p.getComponent(i,a)*16;expect(value,key).toBeGreaterThanOrEqual(descriptor.bounds16.min[a]-1e-5);expect(value,key).toBeLessThanOrEqual(descriptor.bounds16.max[a]+1e-5);}
      g!.dispose();
    }
  }
});
it('band openings and piers differ geometrically, plinth appears only on the base foot, and glass joints meet in four directions',()=>{
  const sizes=['base','body','crown'].map(b=>{const a=BANDED_FACADE_ASSETS[`facade.banded-shop-${b as 'base'|'body'|'crown'}-repeat-single`];return [a.opening16!.maxU-a.opening16!.minU,a.opening16!.maxV-a.opening16!.minV];});
  expect(sizes).toEqual([[12,12],[10,9],[8,6]]);
  expect(['base','body','crown'].map(b=>BANDED_FACADE_ASSETS[`facade.banded-shop-${b as 'base'|'body'|'crown'}-repeat-pier`].pierWidth16)).toEqual([4,2,3]);
  for(const row of ['foot','repeat','head','single'] as const){const descriptor=BANDED_FACADE_ASSETS[`facade.banded-shop-base-${row}-single`];expect(descriptor.reliefBoxes16.some(b=>b.min[0]===-8&&b.max[0]===8&&b.min[1]===-8&&b.max[1]===-6)).toBe(row==='foot'||row==='single');}
  for(const style of ['shop','office'] as const)for(const band of ['base','body','crown'] as const)for(const row of ['foot','repeat','head','single'] as const)for(const direction of ['PX','NX','PZ','NZ'] as const){
    const left=BANDED_FACADE_ASSETS[`facade.banded-${style}-${band}-${row}-left`],right=BANDED_FACADE_ASSETS[`facade.banded-${style}-${band}-${row}-right`];
    expect(left.jointFamily).toBe(right.jointFamily);expect(left.opening16!.minV).toBe(right.opening16!.minV);expect(left.opening16!.maxV).toBe(right.opening16!.maxV);
    const leftGeometry=buildCraftedGeometry(`facade.banded-${style}-${band}-${row}-left`),rightGeometry=buildCraftedGeometry(`facade.banded-${style}-${band}-${row}-right`);
    const leftMatrix=setPlacementMatrix(new Matrix4(),[1,1,1],direction,new Vector3()),rightMatrix=setPlacementMatrix(new Matrix4(),BASES[direction].u.map(n=>1+2*n) as Vec3,direction,new Vector3());
    const seam=(geometry:typeof leftGeometry,edge:number,matrix:Matrix4)=>{const p=geometry.glass!.getAttribute('position'),points:string[]=[];for(let i=0;i<p.count;i++)if(Math.abs(p.getX(i)-edge)<1e-6)points.push(new Vector3().fromBufferAttribute(p,i).applyMatrix4(matrix).toArray().map(n=>n.toFixed(6)).join(','));return [...new Set(points)].sort();};
    expect(seam(leftGeometry,.5,leftMatrix)).toEqual(seam(rightGeometry,-.5,rightMatrix));
    for(const geometry of [leftGeometry,rightGeometry]){geometry.panel.dispose();geometry.relief?.dispose();geometry.glass?.dispose();}
    expect(left.opening16!.openRight).toBe(true);expect(right.opening16!.openLeft).toBe(true);
    expect(left.reliefBoxes16.some(b=>b.min[0]>=7&&b.min[1]===left.opening16!.minV)).toBe(false);
  }
});
it('the portal clearance is outside frames, including the floor edge',()=>{
  for(const part of ['single','left','right'] as const){const descriptor=portalDescriptor(part),o=descriptor.opening16!;
    const aperture={min:[o.minU,o.minV,0] as Vec3,max:[o.maxU,o.maxV,2] as Vec3};
    expect(descriptor.reliefBoxes16.some(b=>boxesOverlap(b,aperture))).toBe(false);
    expect(descriptor.portalClearance16).toEqual({width:part==='single'?12:24,height:14});
  }
});
it('convex/concave terminals close cut strips without duplicate volume and attachments never own faces',()=>{
  for(const cells of [box(3,4,3),box(3,4,3).filter(([x,,z])=>x!==2||z!==2)]){
    const result=generateDocument(createDocument(cells,42,'shop'));
    const geometry=result.modules!.flatMap(m=>TRIM_ASSETS[m.assetKey].boxes16.map(b=>({id:m.moduleId,box:faceBounds16(b,m.position2,m.orientationId)})));
    expect(result.modules!.some(m=>m.assetKey.includes('outer-'))).toBe(true);
    if(cells.length<36)expect(result.modules!.some(m=>m.assetKey.includes('inner-'))).toBe(true);
    for(let i=0;i<geometry.length;i++)for(let j=0;j<i;j++)expect(boxesOverlap(geometry[i].box,geometry[j].box),`${geometry[i].id} / ${geometry[j].id}`).toBe(false);
    const solid=new BoundsIndex<string>();cells.forEach(c=>solid.add(cellBox16(c),c.join(',')));for(const g of geometry)expect(solid.query(g.box)).toEqual([]);
    expect(result.modules!.every(m=>m.kind==='attachment'&&m.faceIds.length===0)).toBe(true);expect(result.placements).toHaveLength(result.surfaces.length);
    const terminals=result.modules!.filter(m=>m.moduleId.startsWith('terminal:'));expect(new Set(terminals.map(m=>m.moduleId)).size).toBe(terminals.length);
  }
});
it('a protected clearance rejects decoration atomically and shared prototypes are cached by asset key',()=>{
  const document=createDocument(box(3,4,3),42,'shop'),result=generateDocument(document),target=result.modules![0],clearanceBox=faceBounds16(TRIM_ASSETS[target.assetKey].bounds16,target.position2,target.orientationId);
  // Fault-inject an authoritative higher-priority clearance to exercise final-stage rejection.
  const book=new ReservationBook([...result.environment!.spatial!.staticReservations,{id:'protected-clearance',ownerId:'path',sourceRefs:[],kind:'walk',priority:700,cells:[],boxes16:[clearanceBox]}]);
  const plan=planFacadeTrims(document,result.surfaces,result.environment!.vertical!,result.environment!.preflight,result.traces,book);
  expect(plan.modules.some(m=>m.moduleId===target.moduleId)).toBe(false);expect(plan.traces.flatMap(t=>t.candidates).some(c=>c.conflictIds.includes('protected-clearance'))).toBe(true);
  const library=new CraftedGeometryLibrary();expect(library.get(target.assetKey)).toBe(library.get(target.assetKey));library.dispose();
});
