import {expect,it} from 'vitest';
import {analyzeRoads,isRoadJunction,roadPlacements,type RoadModule,type RoadSide} from '../src/core/roads';
import {cellId,normalizeGrid,type Vec3} from '../src/core/analysis';
import {createDocument,exportDocument,loadDocument} from '../src/core/document';
import {generateDocument} from '../src/core/generate-document';
import {emptySceneInputs,type ScenePlacement} from '../src/core/scene-inputs';
import {editRoads} from '../src/scene-editor';
import {EnvironmentCache} from '../src/core/environment-cache';
import {DocumentHistory} from '../src/editor';

const rect=(x:number,z:number,w:number,d:number):Vec3[]=>Array.from({length:w*d},(_,i)=>[x+i%w,0,z+Math.floor(i/w)]);
const normals:Record<RoadSide,Vec3>={east:[1,0,0],west:[-1,0,0],north:[0,0,1],south:[0,0,-1]};
const opposite:Record<RoadSide,RoadSide>={east:'west',west:'east',north:'south',south:'north'};
const rotate=(cells:Vec3[],turns:number)=>cells.map(([a,y,b])=>{for(let i=0;i<turns;i++)[a,b]=[-b-1,a];return [a-7,y,b-5] as Vec3;});
const inSpan=(module:RoadModule,c:Vec3,side:RoadSide)=>{
  const at=side==='east'||side==='west'?c[2]:c[0];
  return (span:{side:RoadSide;start:number;end:number})=>span.side===side&&at>=span.start&&at<span.end;
};
function verifyMask(cells:Vec3[],modules=analyzeRoads(cells)){
  const normalized=normalizeGrid(cells),own=new Map(modules.flatMap(m=>m.cells.map(c=>[cellId(c),m] as const)));
  expect(modules.reduce((n,m)=>n+m.cells.length,0)).toBe(normalized.length);
  expect(normalizeGrid(modules.flatMap(m=>m.cells))).toEqual(normalized);
  let exposed=0;
  for(const c of normalized)for(const side of Object.keys(normals) as RoadSide[]){
    const step=normals[side],neighbor=own.get(cellId(c.map((n,i)=>n+step[i]) as Vec3)),host=own.get(cellId(c))!;
    if(neighbor?.id===host.id)continue;
    if(!neighbor){exposed++;expect(host.boundarySpans!.filter(inSpan(host,c,side))).toHaveLength(1);}
    else{
      const port=host.portSpans!.filter(inSpan(host,c,side));expect(port).toHaveLength(1);expect(port[0].neighborIds).toContain(neighbor.id);
      expect(neighbor.portSpans!.some(p=>inSpan(neighbor,c,opposite[side])(p)&&p.neighborIds.includes(host.id))).toBe(true);
    }
  }
  expect(modules.flatMap(m=>m.boundarySpans!).reduce((n,s)=>n+s.end-s.start,0)).toBe(exposed);
}
const xzBounds=(p:ScenePlacement)=>({x0:p.center[0]-p.size[0]/2,x1:p.center[0]+p.size[0]/2,z0:p.center[2]-p.size[2]/2,z1:p.center[2]+p.size[2]/2});
const overlaps=(a:ReturnType<typeof xzBounds>,b:ReturnType<typeof xzBounds>)=>Math.min(a.x1,b.x1)-Math.max(a.x0,b.x0)>1e-7&&Math.min(a.z1,b.z1)-Math.max(a.z0,b.z0)>1e-7;
function verifyPaint(cells:Vec3[],placements=roadPlacements(cells)){
  const occupied=new Set(cells.map(cellId));expect(new Set(placements.map(p=>p.id)).size).toBe(placements.length);
  for(const p of placements){
    const b=xzBounds(p);expect(p.size.every(n=>n>0)).toBe(true);
    for(let x=Math.floor(b.x0+1e-7);x<Math.ceil(b.x1-1e-7);x++)for(let z=Math.floor(b.z0+1e-7);z<Math.ceil(b.z1-1e-7);z++)expect(occupied.has(`${x},0,${z}`),p.id).toBe(true);
  }
}

it.each([1,2,3,4,5,6,7,8])('arbitrary lengths of a width %i straight retain width and never become bends/junctions',width=>{
  for(let length=width;length<=Math.min(32,3*width+2);length++)for(const turn of [0,1]){
    const cells=rotate(rect(0,0,width,length),turn),modules=analyzeRoads(cells);
    expect(modules.every(m=>m.width===width&&['end','straight'].includes(m.shape)),`${width}x${length}/${turn}`).toBe(true);
    verifyMask(cells,modules);expect(roadPlacements(cells).some(p=>p.asset.startsWith('crosswalk-'))).toBe(false);
  }
});

it.each([1,2,3,4,5])('L/T/cross width %i have one genuine node with arbitrary arm lengths and rotations',w=>{
  for(const [shape,roads,portCount] of [
    ['corner',[...rect(0,0,w+w+1,w),...rect(0,0,w,w+w+2)],2],
    ['tee',[...rect(-w-2,0,3*w+3,w),...rect(0,0,w,2*w+2)],3],
    ['cross',[...rect(-w-2,0,3*w+3,w),...rect(0,-w-1,w,3*w+3)],4],
  ] as const)for(let turn=0;turn<4;turn++){
    const cells=normalizeGrid(rotate([...roads],turn)),modules=analyzeRoads(cells),nodes=modules.filter(m=>m.shape==='corner'||isRoadJunction(m));
    expect(nodes).toHaveLength(1);expect(nodes[0]).toMatchObject({shape,width:w});expect(nodes[0].ports).toHaveLength(portCount);
    expect(modules.every(m=>m.width===w)).toBe(true);verifyMask(cells,modules);
    expect(analyzeRoads([...cells].reverse())).toEqual(modules);
    const placements=roadPlacements(cells,modules);verifyPaint(cells,placements);
    expect(placements.filter(p=>p.asset.startsWith('stop-'))).toHaveLength(w>=2?portCount:0);
    const node=nodes[0],bounds={x0:node.origin[0],x1:node.origin[0]+node.size[0],z0:node.origin[2],z1:node.origin[2]+node.size[2]};
    for(const p of placements.filter(p=>/^(center-|lane-|crosswalk-|stop-)/.test(p.asset)))expect(overlaps(xzBounds(p),bounds),p.id).toBe(false);
    const lanePaint=placements.filter(p=>/^(center-|lane-)/.test(p.asset)),crossPaint=placements.filter(p=>/^(crosswalk-|stop-)/.test(p.asset));
    for(const a of lanePaint)for(const b of crossPaint)expect(overlaps(xzBounds(a),xzBounds(b)),`${a.id}/${b.id}`).toBe(false);
  }
});

it('unequal-width L/T approaches retain their actual opening spans',()=>{
  const cells=normalizeGrid([...rect(-6,0,14,4),...rect(0,0,2,10)]),modules=analyzeRoads(cells),node=modules.find(isRoadJunction)!;
  expect(node.shape).toBe('tee');expect(node.size).toEqual([2,.08,4]);
  expect(node.portSpans!.map(p=>[p.side,p.end-p.start])).toEqual([['east',4],['west',4],['north',2]]);
  verifyMask(cells,modules);verifyPaint(cells);
});

it('the notch keeps every exposed boundary and records partial ports without inventing branches',()=>{
  const cells=rect(0,0,2,5).filter(([x,,z])=>x!==1||z!==3),modules=analyzeRoads(cells);
  verifyMask(cells,modules);verifyPaint(cells);
  expect(modules.some(isRoadJunction)).toBe(false);
  const host=modules.find(m=>m.cells.some(c=>cellId(c)==='1,0,2'))!;
  expect(host.boundarySpans!.some(p=>p.side==='north'&&p.start<=1&&p.end>=2)).toBe(true);
});

it('all 511 small masks retain holes, exact ownership, reciprocal ports and paint bounds',()=>{
  const square=rect(-1,-1,3,3);
  for(let bits=1;bits<512;bits++){
    const cells=square.filter((_,i)=>bits&(1<<i));verifyMask(cells);verifyPaint(cells);
  }
});

it('a one-cell link between two junctions does not stack opposing crossings or stop lines',()=>{
  const cells=normalizeGrid([...rect(0,0,10,2),...rect(2,0,2,6),...rect(5,0,2,6)]),modules=analyzeRoads(cells),nodes=modules.filter(isRoadJunction);
  expect(nodes).toHaveLength(2);verifyMask(cells,modules);verifyPaint(cells);
  const paint=roadPlacements(cells).filter(p=>/^(crosswalk-|stop-)/.test(p.asset));
  for(let i=0;i<paint.length;i++)for(let j=0;j<i;j++)expect(overlaps(xzBounds(paint[i]),xzBounds(paint[j]))).toBe(false);
  expect(paint.some(p=>p.id.startsWith(nodes[0].id+':crosswalk-east'))).toBe(false);
  expect(paint.some(p=>p.id.startsWith(nodes[1].id+':crosswalk-west'))).toBe(false);
});

it('a straight 5x7 road no longer invents a tee or rejects a nearby painted light',()=>{
  for(const length of [6,7]){
    const scene=emptySceneInputs();scene.roads=rect(0,0,5,length);scene.objects=[{id:'light',category:'lighting',direction:'PY',cells:[[2,0,7]]}];
    const result=generateDocument(createDocument([],42,'office',undefined,undefined,scene));
    expect(result.environment!.relations!.roads.some(r=>isRoadJunction(r.module))).toBe(false);
    expect(result.environment!.fixtures!.placements).toHaveLength(1);
    expect(result.environment!.fixtures!.traces.some(t=>t.candidates.some(c=>c.reasonCodes.includes('INTERSECTION_KEEPOUT')))).toBe(false);
  }
});

it('cropping a 4x8 straight to 4x6 preserves topology through cache, history and JSON',()=>{
  const scene=emptySceneInputs();scene.roads=rect(0,0,4,8);const doc=createDocument([],42,'office',undefined,undefined,scene),cache=new EnvironmentCache(),history=new DocumentHistory(doc);
  const cut=editRoads(doc,{direction:'PY',cells:rect(0,6,4,2).map(([x,,z])=>[x,-1,z])},'remove');history.commit(cut);
  const result=generateDocument(cut,{cache});expect(result.environment!.relations!.roads.every(r=>r.module.width===4&&!isRoadJunction(r.module)&&r.module.shape!=='corner')).toBe(true);
  expect(generateDocument(cut,{cache:false})).toEqual(result);expect(generateDocument(loadDocument(exportDocument(cut)),{cache})).toEqual(result);
  expect(generateDocument(history.undo()!,{cache})).toEqual(generateDocument(doc,{cache:false}));expect(generateDocument(history.redo()!,{cache})).toEqual(result);
});
