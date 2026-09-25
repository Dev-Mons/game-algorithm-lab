import { normalizeGrid, type Vec3 } from './analysis';
import type { ScenePlacement } from './scene-inputs';

export type RoadSide = 'east' | 'west' | 'north' | 'south';
export interface RoadSpan {
  side: RoadSide;
  /** Absolute transverse coordinates, start inclusive / end exclusive. */
  start: number; end: number;
}
export interface RoadPort extends RoadSpan { neighborIds: string[] }
export interface RoadModule {
  id: string; origin: Vec3; size: Vec3; width: number;
  shape: 'end' | 'straight' | 'corner' | 'tee' | 'cross' | 'transition';
  ports: RoadSide[]; cells: Vec3[];
  axis?: 'X' | 'Z';
  portSpans?: RoadPort[];
  boundarySpans?: RoadSpan[];
}
interface Rect { x: number; z: number; w: number; d: number }
interface Region extends Rect { axis?: 'X' | 'Z'; junction?: RoadSide[] }
const sides: readonly RoadSide[] = ['east','west','north','south'];
const normals: Record<RoadSide, readonly [number,number]> = {east:[1,0],west:[-1,0],north:[0,1],south:[0,-1]};
const key = (x:number,z:number) => `${x},${z}`;
const horizontalSide = (side:RoadSide) => side==='east'||side==='west';
const cellsOf = ({x,z,w,d}:Rect):Vec3[] => {
  const cells:Vec3[]=[];
  for(let a=x;a<x+w;a++)for(let b=z;b<z+d;b++)cells.push([a,0,b]);
  return cells;
};

/** Merge equal cross sections. Rectangle tiling is never used to infer turns. */
function strips(cells:readonly Vec3[],axis:'X'|'Z'):Rect[] {
  const rows=new Map<number,number[]>(),long=axis==='X'?0:2,cross=axis==='X'?2:0;
  for(const c of cells){const row=rows.get(c[long])??[];row.push(c[cross]);rows.set(c[long],row);}
  const result:Rect[]=[],active=new Map<string,{rect:Rect;last:number}>();
  for(const [at,row] of [...rows].sort(([a],[b])=>a-b)){
    row.sort((a,b)=>a-b);
    for(let i=0;i<row.length;){
      const start=row[i++];let end=start+1;
      while(i<row.length&&row[i]===end){i++;end++;}
      const id=`${start}:${end}`,previous=active.get(id);
      if(previous?.last===at-1){if(axis==='X')previous.rect.w++;else previous.rect.d++;previous.last=at;}
      else{
        const rect=axis==='X'?{x:at,z:start,w:1,d:end-start}:{x:start,z:at,w:end-start,d:1};
        active.set(id,{rect,last:at});result.push(rect);
      }
    }
  }
  return result;
}

/** Actual occupied or exposed portions of one side; partial ports stay partial. */
function sideSpans(rect:Rect,side:RoadSide,occupied:ReadonlySet<string>,connected:boolean):RoadSpan[] {
  const h=horizontalSide(side),start=h?rect.z:rect.x,end=start+(h?rect.d:rect.w),[dx,dz]=normals[side];
  const spans:RoadSpan[]=[];let first:number|undefined;
  for(let at=start;at<=end;at++){
    const x=h?(side==='east'?rect.x+rect.w-1:rect.x):at;
    const z=h?at:(side==='north'?rect.z+rect.d-1:rect.z);
    const selected=at<end&&occupied.has(key(x+dx,z+dz))===connected;
    if(selected&&first===undefined)first=at;
    if(!selected&&first!==undefined){spans.push({side,start:first,end:at});first=undefined;}
  }
  return spans;
}

export function analyzeRoads(input:Vec3[]):RoadModule[] {
  const cells=normalizeGrid(input);
  if(cells.some(c=>c[1]!==0))throw new Error('Road cells must be at ground level.');
  const occupied=new Set(cells.map(([x,,z])=>key(x,z)));
  // A bend/junction is an overlap of extending orthogonal corridors.
  const horizontal=strips(cells,'Z').filter(r=>r.w>r.d),vertical=strips(cells,'X').filter(r=>r.d>r.w);
  const hs=new Map<string,Rect>(),vs=new Map<string,Rect>();
  for(const r of horizontal)for(const [x,,z] of cellsOf(r))hs.set(key(x,z),r);
  for(const r of vertical)for(const [x,,z] of cellsOf(r))vs.set(key(x,z),r);
  const junctionCells=new Set<string>(),regions:Region[]=[];
  for(const h of horizontal)for(const v of vertical){
    const x=Math.max(h.x,v.x),z=Math.max(h.z,v.z),w=Math.min(h.x+h.w,v.x+v.w)-x,d=Math.min(h.z+h.d,v.z+v.d)-z;
    if(w<=0||d<=0)continue;
    const ports=sides.filter(side=>side==='east'?h.x+h.w>x+w:side==='west'?h.x<x:side==='north'?v.z+v.d>z+d:v.z<z);
    if(ports.length<2||!ports.some(horizontalSide)||!ports.some(s=>!horizontalSide(s)))continue;
    const r:Region={x,z,w,d,junction:ports};regions.push(r);
    for(const [a,,b] of cellsOf(r))junctionCells.add(key(a,b));
  }
  const remainder:{X:Vec3[];Z:Vec3[]}={X:[],Z:[]};
  for(const c of cells){
    const id=key(c[0],c[2]);if(junctionCells.has(id))continue;
    const h=hs.get(id),v=vs.get(id);
    // Isolated square patches have no inferred turn. The canonical tie is Z.
    const axis=h&&!v?'X':'Z';remainder[axis].push(c);
  }
  for(const axis of ['X','Z'] as const)for(const r of strips(remainder[axis],axis)){
    const width=axis==='X'?r.d:r.w,length=axis==='X'?r.w:r.d;
    // Split only along the established axis; a short last segment keeps its width.
    for(let offset=0;offset<length;offset+=width){
      const size=Math.min(width,length-offset);
      regions.push(axis==='X'?{...r,x:r.x+offset,w:size,axis}:{...r,z:r.z+offset,d:size,axis});
    }
  }
  regions.sort((a,b)=>a.x-b.x||a.z-b.z);
  const owner=new Map<string,string>();
  for(const r of regions)for(const c of cellsOf(r))owner.set(key(c[0],c[2]),`road:${r.x},${r.z}`);
  return regions.map(r=>{
    const id=`road:${r.x},${r.z}`,portSpans:RoadPort[]=sides.flatMap(side=>sideSpans(r,side,occupied,true).map(span=>{
      const h=horizontalSide(side),[dx,dz]=normals[side],neighbors=new Set<string>();
      for(let at=span.start;at<span.end;at++){
        const x=h?(side==='east'?r.x+r.w-1:r.x):at,z=h?at:(side==='north'?r.z+r.d-1:r.z);
        neighbors.add(owner.get(key(x+dx,z+dz))!);
      }
      return {...span,neighborIds:[...neighbors].sort()};
    }));
    const ports=sides.filter(side=>portSpans.some(p=>p.side===side));
    const expected=r.axis==='X'?['east','west']:['north','south'];
    const partial=portSpans.some(p=>p.end-p.start!==(horizontalSide(p.side)?r.d:r.w));
    const shape:RoadModule['shape']=r.junction?(r.junction.length===4?'cross':r.junction.length===3?'tee':'corner'):
      partial||ports.some(p=>!expected.includes(p))?'transition':ports.length===2?'straight':'end';
    return {id,origin:[r.x,0,r.z],size:[r.w,.08,r.d],width:r.axis==='X'?r.d:r.axis==='Z'?r.w:Math.min(r.w,r.d),shape,
      ...(r.axis?{axis:r.axis}:{}),ports,cells:cellsOf(r),portSpans,boundarySpans:sides.flatMap(side=>sideSpans(r,side,occupied,false))};
  });
}

export const isRoadJunction=(m:RoadModule)=>m.shape==='tee'||m.shape==='cross';
const isTurning=(m:RoadModule)=>m.shape==='corner'||isRoadJunction(m);
const rectOf=(m:RoadModule):Rect=>({x:m.origin[0],z:m.origin[2],w:m.size[0],d:m.size[2]});
interface Crossing { host:RoadModule; boxes:ScenePlacement[]; keepout:{x0:number;x1:number;z0:number;z1:number} }
const overlaps=(a:Crossing['keepout'],b:Crossing['keepout'])=>a.x0<b.x1&&b.x0<a.x1&&a.z0<b.z1&&b.z0<a.z1;

/** Paint is visual; it never certifies a pedestrian/vehicle crossing. */
export function roadPlacements(cells:Vec3[],modules:readonly RoadModule[]=analyzeRoads(cells)):ScenePlacement[] {
  const occupied=new Set(cells.map(([x,,z])=>key(x,z))),crossings:Crossing[]=[];
  const make=(m:RoadModule,asset:string,center:Vec3,size:Vec3,color:string):ScenePlacement=>({
    id:`${m.id}:${asset}`,kind:'road',asset,center,size,color,context:`${m.width}-lane:${m.ports.join(',')}`,
  });
  const inside=(center:Vec3,size:Vec3)=>{
    for(let x=Math.floor(center[0]-size[0]/2+1e-8);x<Math.ceil(center[0]+size[0]/2-1e-8);x++)
      for(let z=Math.floor(center[2]-size[2]/2+1e-8);z<Math.ceil(center[2]+size[2]/2-1e-8);z++)if(!occupied.has(key(x,z)))return false;
    return true;
  };
  for(const m of modules)if(isTurning(m)){
    const r=rectOf(m),ports=m.portSpans??sides.flatMap(side=>sideSpans(r,side,occupied,true));
    for(const [index,port] of ports.entries()){
      const span=port.end-port.start;if(span<2)continue;
      const h=horizontalSide(port.side),positive=port.side==='east'||port.side==='north',sign=positive?1:-1;
      const edge=h?(positive?r.x+r.w:r.x):(positive?r.z+r.d:r.z),middle=(port.start+port.end)/2;
      const pose=(along:number,across:number,y:number):Vec3=>h?[edge+sign*along,y,across]:[across,y,edge+sign*along];
      const size=(along:number,across:number):Vec3=>h?[along,.012,across]:[across,.012,along];
      // Stop line is on the approach side of the crossing; the node stays clear.
      if(!inside(pose(.48,middle,.098),size(.96,span-.2)))continue;
      const boxes:ScenePlacement[]=[],count=Math.max(2,Math.floor((span-.4)/.28)),step=(span-.4)/count;
      for(let stripe=0;stripe<count;stripe++)boxes.push(make(m,`crosswalk-${port.side}-${index}-${stripe}`,pose(.3,port.start+.2+(stripe+.5)*step,.098),size(.38,Math.min(.14,step*.52)),'#e0dfd0'));
      boxes.push(make(m,`stop-${port.side}-${index}`,pose(.7,middle,.099),size(.045,span-.26),'#d9d8ca'));
      for(const end of [port.start+.11,port.end-.11])boxes.push(make(m,`crossing-corner-${port.side}-${index}-${end}`,pose(.3,end,.104),size(.22,.14),'#d9b754'));
      const along0=Math.min(edge,edge+sign*.92),along1=Math.max(edge,edge+sign*.92);
      const keepout=h?{x0:along0,x1:along1,z0:port.start,z1:port.end}:{x0:port.start,x1:port.end,z0:along0,z1:along1};
      if(modules.some(other=>other!==m&&isTurning(other)&&overlaps(keepout,{x0:other.origin[0],x1:other.origin[0]+other.size[0],z0:other.origin[2],z1:other.origin[2]+other.size[2]})))continue;
      crossings.push({host:m,boxes,keepout});
    }
  }
  // A short link may not fit two opposing crossings. Omit both as one decision,
  // rather than overlapping paint or choosing a winner by iteration order.
  const acceptedCrossings=crossings.filter((c,i)=>!crossings.some((other,j)=>i!==j&&overlaps(c.keepout,other.keepout)));
  const results:ScenePlacement[]=[];
  for(const m of modules){
    const r=rectOf(m),center:Vec3=[r.x+r.w/2,.04,r.z+r.d/2];
    results.push(make(m,`road.${m.shape}.${m.width}-lane`,center,m.size,'#4d514e'));
    const axis=m.axis??(m.ports.includes('east')||m.ports.includes('west')||r.w>r.d?'X':'Z');
    const h=axis==='X',length=h?r.w:r.d,width=h?r.d:r.w,start=h?r.x:r.z,crossStart=h?r.z:r.x;
    if(!isTurning(m)&&m.shape!=='transition'&&width>=2){
      const paint=(asset:string,along:number,across:number,span:number,thickness:number,color:string)=>{
        let intervals:[number,number][]=[[along-span/2,along+span/2]];
        for(const crossing of acceptedCrossings){
          const k=crossing.keepout,c0=h?k.z0:k.x0,c1=h?k.z1:k.x1;
          if(across+thickness/2<=c0||across-thickness/2>=c1)continue;
          const lo=h?k.x0:k.z0,hi=h?k.x1:k.z1;
          intervals=intervals.flatMap(([a,b])=>b<=lo||a>=hi?[[a,b]]:[[a,Math.min(b,lo)],[Math.max(a,hi),b]].filter(([x,y])=>y-x>1e-6) as [number,number][]);
        }
        for(const [i,[a,b]] of intervals.entries())results.push(make(m,`${asset}-${i}`,h?[(a+b)/2,.089,across]:[across,.089,(a+b)/2],h?[b-a,.012,thickness]:[thickness,.012,b-a],color));
      };
      for(const side of [-1,1])paint(`center-${side}`,start+length/2,crossStart+width/2+side*.045,length,.03,'#d9b754');
      if(width>=4)for(let lane=1;lane<width;lane++)if(Math.abs(lane-width/2)>.3){
        for(let at=start;at<start+length;at++)paint(`lane-${lane}-dash-${at}`,at+.5,crossStart+lane,.58,.035,'#d3d3c6');
      }
    }
    const boundary=m.boundarySpans??sides.flatMap(side=>sideSpans(r,side,occupied,false));
    for(const [i,span] of boundary.entries()){
      const horizontal=horizontalSide(span.side),positive=span.side==='east'||span.side==='north';
      const across=(span.start+span.end)/2,edge=horizontal?(positive?r.x+r.w-.04:r.x+.04):(positive?r.z+r.d-.04:r.z+.04);
      results.push(make(m,`edge-${span.side}-${i}`,horizontal?[edge,.09,across]:[across,.09,edge],horizontal?[.08,.04,span.end-span.start]:[span.end-span.start,.04,.08],'#b1b2a4'));
    }
    results.push(...acceptedCrossings.filter(c=>c.host.id===m.id).flatMap(c=>c.boxes));
  }
  return results;
}
