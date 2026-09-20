import {expect,it} from 'vitest';
import {verticalCounts,planVertical} from '../src/core/vertical-design';
import {SHOP_STYLE,OFFICE_STYLE} from '../src/core/building-style';
import {createDocument,documentOptions,replaceGrid} from '../src/core/document';
import {analyzeVolume,BASES,type Vec3} from '../src/core/generate';
import {selectTiles} from '../src/core/selection';
import {box} from '../src/fixtures';
it.each([[1,1,0,0],[2,1,1,0],[3,1,2,0],[8,2,5,1],[12,3,8,1]])('retail H%i has the required integer bands',(h,b,m,c)=>{
  expect(verticalCounts(h,SHOP_STYLE)).toMatchObject({base:b,body:m,crown:c});
});
it('preserves height, tall minimum, preset proportions, and resize clamping',()=>{
  expect(verticalCounts(16,OFFICE_STYLE)).toMatchObject({base:3,body:10,crown:3});
  for(let h=1;h<=32;h++){const v=verticalCounts(h,OFFICE_STYLE);expect(v.base+v.body+v.crown).toBe(h);if(h>=8)expect(v.base).toBeGreaterThanOrEqual(2);}
});
function selection(grid:Vec3[],document=createDocument(grid,42,'shop')){
  const analysis=analyzeVolume(grid,'region-context-v1'),b=document.buildings[0];
  const vertical=planVertical(b.componentId,grid,analysis.surfaces,b.design,document.buildingDefinition);
  const result=selectTiles(analysis,{...documentOptions(document),context:{design:b.design,sourceRefs:[],reservations:[],envelope:{version:1,requiredBoxes16:[],deferredAttachmentBounds16:[],supportedAssetKeys:[],diagnostics:[]},verticalBands:vertical,entrances:{buildingId:b.componentId,entrances:[],frontages:[],desiredCount:0,unmetCount:0,reservations:[],traces:[]}}});
  return {vertical,result,document};
}
it('uses whole-building bands, caps a low annex locally and aligns setback planes at absolute columns',()=>{
  const grid=[...box(7,12,3),...box(3,4,3).map(([x,y,z])=>[x+7,y,z] as Vec3)];
  const {vertical,result}=selection(grid);
  expect(vertical.bands.map(b=>b.yMaxExclusive-b.yMin)).toEqual([3,8,1]);
  const annexFace='8,3,2|PZ';
  expect(vertical.faceBands.find(f=>f.faceId===annexFace)?.band).toBe('body');
  expect(vertical.boundaries.some(b=>b.hostFaceId===annexFace&&b.kind==='local-cap')).toBe(true);
  expect(result.traces.filter(t=>t.facade?.patternId==='entrance')).toEqual([]);
  const stepped=box(9,12,5).filter(([x,y,z])=>y<6||x>=1&&x<=7&&z<3),s=selection(stepped);
  for(const t of s.result.traces)if(t.facade?.part==='left'){
    const face=s.result.surfaces.find(f=>f.faceId===t.faceId)!,u=face.cell.reduce((n,v,i)=>n+v*BASES[face.direction].u[i],0);
    expect(((u-t.facade.phase!)%3+3)%3).toBe(0);
  }
  for(const edge of s.vertical.boundaries.filter(b=>b.kind!=='local-cap')){
    const face=s.result.surfaces.find(f=>f.faceId===edge.hostFaceId)!;
    expect(s.result.surfaces.some(f=>f.direction===face.direction&&f.cell[0]===face.cell[0]&&f.cell[2]===face.cell[2]&&f.cell[1]===face.cell[1]-1)).toBe(true);
  }
});
it('does not rephase unaffected rows when the widest row grows and the component root changes',()=>{
  const grid=box(8,8,3),a=selection(grid),next=replaceGrid(a.document,[...grid,[-1,0,0]]),b=selection(next.grid,next);
  expect(b.vertical.alignment).toEqual(a.vertical.alignment);
  const project=(r:typeof a.result)=>r.traces.filter(t=>t.faceId.includes(',4,')).map(t=>({faceId:t.faceId,module:t.facade?.moduleId,phase:t.facade?.phase,palette:t.architecture?.palette}));
  expect(project(b.result)).toEqual(project(a.result));
});
it.each([0,-5])('aligns bands with different authored starts at offset %i',offset=>{
  const style=structuredClone(SHOP_STYLE);
  style.patterns.find(p=>p.id==='base-rhythm')!.start=['base-pier'];
  style.patterns.find(p=>p.id==='crown-rhythm')!.start=['crown-pier','crown-pier'];
  const grid=box(12,8,12).map(([x,y,z])=>[x+offset,y,z+offset] as Vec3);
  const {result}=selection(grid,createDocument(grid,42,'shop',style));
  const faces=new Map(result.surfaces.map(s=>[s.faceId,s]));
  const starts=result.traces.filter(t=>t.facade?.part==='left');
  for(const direction of ['PX','NX','PZ','NZ'] as const)for(const band of ['base','body','crown'] as const){
    const rowStarts=starts.filter(t=>t.direction===direction&&t.facade!.level===band);
    expect(rowStarts.length,`${direction}:${band}`).toBeGreaterThan(0);
    for(const trace of rowStarts){
      const face=faces.get(trace.faceId)!,u=face.cell.reduce((n,v,i)=>n+v*BASES[direction].u[i],0);
      expect(((u-trace.facade!.phase!)%3+3)%3,trace.faceId).toBe(0);
    }
  }
  for(const y of [0,2,7]){
    const columns=starts.filter(t=>t.direction==='PZ'&&faces.get(t.faceId)!.cell[1]===y)
      .map(t=>faces.get(t.faceId)!.cell[0]).sort((a,b)=>a-b);
    expect(columns).toEqual([offset+3,offset+6]);
  }
  const moduleAt=(x:number,y:number)=>result.traces.find(t=>t.faceId===`${x+offset},${y},${11+offset}|PZ`)!.facade!.moduleId;
  expect(moduleAt(1,0)).toBe('base-pier');
  expect([moduleAt(1,7),moduleAt(2,7)]).toEqual(['crown-pier','crown-pier']);
});
it('never clips a connected pair at a missing wall cell',()=>{
  const {result}=selection(box(9,8,3).filter(c=>c.join(',')!=='4,4,2'));
  const groups=new Map<string,string[]>();
  for(const t of result.traces)if(t.facade?.groupId){const g=groups.get(t.facade.groupId)??[];g.push(t.facade.part!);groups.set(t.facade.groupId,g);}
  for(const parts of groups.values())expect(parts.sort()).toEqual(['left','right']);
  expect(new Set(result.placements.map(p=>p.faceId)).size).toBe(result.surfaces.length);
});

it('empty volume has an empty vertical plan rather than a fictitious band',()=>{
 const doc=createDocument([]),plan=planVertical('empty',[],[],{version:1,anchor:[0,0,0]},doc.buildingDefinition);
 expect(plan.heightCells).toBe(0);expect(plan.bands).toEqual([]);expect(plan.faceBands).toEqual([]);expect(plan.boundaries).toEqual([]);
});
