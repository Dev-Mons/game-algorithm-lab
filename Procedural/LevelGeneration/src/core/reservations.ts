import {ENVIRONMENT} from './environment-settings';
import { walkSweep16, type AccessSearch } from "./access-graph";
import {HEADING_VECTORS} from "./environment-contract";
import { add, cellId, compareCells, type Vec3 } from "./analysis";
import type { Box16, Reservation, Heading } from "./environment-contract";
import { boxesOverlap, containedInUnion, validateBox16, cellBox16 } from "./placement-bounds";
import { cloneJSON } from "./canonical";

const ascii=(a:string,b:string)=>a<b?-1:a>b?1:0;
const bucketKeys=(box:Box16)=>{
  const keys:string[]=[];
  for(let x=Math.floor(box.min[0]/16);x<Math.ceil(box.max[0]/16);x++)
    for(let y=Math.floor(box.min[1]/16);y<Math.ceil(box.max[1]/16);y++)
      for(let z=Math.floor(box.min[2]/16);z<Math.ceil(box.max[2]/16);z++)keys.push(`${x},${y},${z}`);
  return keys;
};
export class BoundsIndex<T> {
  private buckets=new Map<string,Set<number>>();private largeItems:number[]=[];
  private items:{box:Box16;value:T}[]=[];
  checks=0;private extent?:Box16;
  add(box:Box16,value:T){validateBox16(box);if(!this.extent)this.extent={min:[...box.min],max:[...box.max]};else for(let a=0;a<3;a++){this.extent.min[a]=Math.min(this.extent.min[a],box.min[a]);this.extent.max[a]=Math.max(this.extent.max[a],box.max[a]);}const index=this.items.push({box,value})-1;const bucketCount=[0,1,2].reduce((n,a)=>n*(Math.ceil(box.max[a]/16)-Math.floor(box.min[a]/16)),1);if(bucketCount>64){this.largeItems.push(index);return;}for(const key of bucketKeys(box)){let set=this.buckets.get(key);if(!set)this.buckets.set(key,set=new Set());set.add(index);}}
  query(box:Box16):{box:Box16;value:T}[]{
    if(!this.extent||!boxesOverlap(box,this.extent))return [];
    const keys=bucketKeys(box);let ids:Iterable<number>;
    if(keys.length===1)ids=this.buckets.get(keys[0])??[];
    else {const unique=new Set<number>();for(const key of keys)for(const id of this.buckets.get(key)??[])unique.add(id);ids=unique;}
    const hits:{box:Box16;value:T}[]=[];
    for(const id of [...ids,...this.largeItems]){const item=this.items[id];this.checks++;if(boxesOverlap(box,item.box))hits.push(item);}
    return hits;
  }
}
export interface CrossingCertificate {id:string;cells:Vec3[];boxes16:Box16[]}
/** A catalog-declared attachment joint, restricted to an exact reservation and volume. */
export interface AssemblyJoint {attachmentId:string;solidReservationId:string;boxes16:Box16[];family:'facade-trim-v1'}
const vehicle=(kind:Reservation['kind'])=>kind==='public-vehicle'||kind==='vehicle-aisle';
const intersection=(a:Box16,b:Box16):Box16=>({min:[Math.max(a.min[0],b.min[0]),Math.max(a.min[1],b.min[1]),Math.max(a.min[2],b.min[2])],max:[Math.min(a.max[0],b.max[0]),Math.min(a.max[1],b.max[1]),Math.min(a.max[2],b.max[2])]});
function copyReservation(r:Reservation):Reservation{return {...r,sourceRefs:r.sourceRefs.map(s=>({...s})),cells:r.cells.map(c=>[c[0],c[1],c[2]]),boxes16:r.boxes16.map(b=>({min:[b.min[0],b.min[1],b.min[2]],max:[b.max[0],b.max[1],b.max[2]]}))};}
const alwaysShare=(a:Reservation,b:Reservation)=>a.kind==='walk'&&b.kind==='walk'||a.kind==='entrance'&&b.kind==='walk'||b.kind==='entrance'&&a.kind==='walk'||vehicle(a.kind)&&vehicle(b.kind);
export function reservationsShare(a:Reservation,b:Reservation,overlap:Box16,certificates:ReadonlyMap<string,CrossingCertificate>):boolean {
  if(a.kind==='walk'&&b.kind==='walk'||a.kind==='entrance'&&b.kind==='walk'||b.kind==='entrance'&&a.kind==='walk')return true;
  if(vehicle(a.kind)&&vehicle(b.kind))return true;
  if((vehicle(a.kind)&&b.kind==='walk'||vehicle(b.kind)&&a.kind==='walk')&&a.crossingId&&a.crossingId===b.crossingId){
    const c=certificates.get(a.crossingId);return !!c&&containedInUnion(overlap,c.boxes16);
  }
  return false;
}
export class ReservationBook {
  private items:Reservation[]=[];
  private index=new BoundsIndex<Reservation>();private walkBlockingIndex=new BoundsIndex<Reservation>();
  private certificates=new Map<string,CrossingCertificate>();
  revision=0;
  constructor(fixed:Reservation[]=[]){for(const r of fixed)this.insert(copyReservation(r));}
  private insert(r:Reservation){this.items.push(r);for(const box of r.boxes16){this.index.add(box,r);if(r.kind!=='walk'&&r.kind!=='entrance')this.walkBlockingIndex.add(box,r);}}
  toJSON(){return cloneJSON({items:this.items,certificates:[...this.certificates.values()]});}
  snapshot(excludedIds?:ReadonlySet<string>){return this.items.filter(r=>!excludedIds?.has(r.id)).map(copyReservation).sort((a,b)=>b.priority-a.priority||ascii(a.ownerId,b.ownerId)||ascii(a.id,b.id));}
  crossingSnapshot(){return cloneJSON([...this.certificates.values()]).sort((a,b)=>ascii(a.id,b.id));}
  get boundsChecks(){return this.index.checks+this.walkBlockingIndex.checks;}
  conflicts(candidate:Reservation,joints:readonly AssemblyJoint[]=[]):string[]{
    const ids=new Set<string>();
    for(const box of candidate.boxes16)for(const {box:other,value} of (candidate.kind==='walk'?this.walkBlockingIndex:this.index).query(box))
      if(!alwaysShare(candidate,value)&&!reservationsShare(candidate,value,intersection(box,other),this.certificates)&&
        !(candidate.kind==='attachment'&&value.kind==='solid'&&joints.some(j=>j.attachmentId===candidate.id&&j.solidReservationId===value.id&&j.family==='facade-trim-v1'&&containedInUnion(intersection(box,other),j.boxes16))))ids.add(value.id);
    return [...ids].sort(ascii);
  }
  tryReserveBatch(proposals:Reservation[],joints:readonly AssemblyJoint[]=[]):{accepted:boolean;conflictIds:string[]}{
    const proposed=proposals.map(copyReservation).sort((a,b)=>b.priority-a.priority||compareCells(a.cells[0]??[0,0,0],b.cells[0]??[0,0,0])||ascii(a.id,b.id));
    const ids=new Set(this.items.map(r=>r.id)),conflicts=new Set<string>();
    for(let i=0;i<proposed.length;i++) {
      const a=proposed[i];if(ids.has(a.id))throw new Error(`DUPLICATE_RESERVATION:${a.id}`);ids.add(a.id);
      a.boxes16.forEach(validateBox16);this.conflicts(a,joints).forEach(id=>conflicts.add(id));
      for(let j=0;j<i;j++)if(!alwaysShare(a,proposed[j]))for(const box of a.boxes16)for(const other of proposed[j].boxes16)
        if(boxesOverlap(box,other)&&!reservationsShare(a,proposed[j],intersection(box,other),this.certificates))conflicts.add(proposed[j].id);
    }
    if(conflicts.size)return {accepted:false,conflictIds:[...conflicts].sort(ascii)};
    proposed.forEach(r=>this.insert(r));if(proposed.length)this.revision++;
    return {accepted:true,conflictIds:[]};
  }
  /** Only a certificate produced by access-graph authorization may reach this method. */
  applyCrossing(certificate:CrossingCertificate, proof: symbol){
    if(proof!==CROSSING_PROOF)throw new Error('UNAUTHORIZED_CROSSING');
    if(this.certificates.has(certificate.id))throw new Error('DUPLICATE_CROSSING');
    // Split public channels into exact crossing cells; reservations retain their priority.
    const next:Reservation[]=[];
    for(const r of this.items) {
      if(!vehicle(r.kind)&&r.kind!=='walk'){next.push(r);continue;}
      let pieces=r.boxes16.map(box=>({box,inside:false}));
      for(const cut of certificate.boxes16) pieces=pieces.flatMap(({box,inside})=>{
        if(inside||!boxesOverlap(box,cut))return [{box,inside}];
        return [{box:intersection(box,cut),inside:true},...subtract(box,cut).map(box=>({box,inside:false}))];
      });
      const outside=pieces.filter(p=>!p.inside).map(p=>p.box),inside=pieces.filter(p=>p.inside).map(p=>p.box);
      if(outside.length)next.push({...r,boxes16:outside});
      if(inside.length)next.push({...r,id:`${r.id}:cross:${certificate.id}`,boxes16:inside,crossingId:certificate.id});
    }
    this.certificates.set(certificate.id,cloneJSON(certificate));this.items=[];this.index=new BoundsIndex();this.walkBlockingIndex=new BoundsIndex();next.forEach(r=>this.insert(r));this.revision++;
  }
  clone(){const copy=new ReservationBook();this.items.forEach(r=>copy.insert(r));copy.certificates=new Map(this.certificates);copy.revision=this.revision;return copy;}
}
// Module-private identity cannot be supplied by a string ID or serialized input.
const CROSSING_PROOF=Symbol('validated-crossing');
import {subtractBox as subtract} from './placement-bounds';
export function walkReservation(id:string,cells:Vec3[],boxes16:Box16[],priority:700|900=700):Reservation {
  return {id,ownerId:id,sourceRefs:[],kind:'walk',priority,cells:[...cells].sort(compareCells),boxes16};
}
export function reserveCandidates(book:ReservationBook,candidates:{id:string;anchor:Vec3;reservations:Reservation[]}[]) {
  return [...candidates].sort((a,b)=>Math.max(...b.reservations.map(r=>r.priority))-Math.max(...a.reservations.map(r=>r.priority))||compareCells(a.anchor,b.anchor)||ascii(a.id,b.id))
    .map(c=>({id:c.id,...book.tryReserveBatch(c.reservations)}));
}

export interface CrossingRequest {
  id:string;cells:Vec3[];walkEndpoints:[Vec3,Vec3];vehicleEndpoints:[{rear:Vec3;heading:Heading},{rear:Vec3;heading:Heading}];
  vehicleCells:Vec3[];intersectionKeepout:Vec3[];
}
export function authorizeCrossing(request:CrossingRequest,search:AccessSearch):CrossingCertificate|undefined {
  const cells=[...new Map(request.cells.map(c=>[cellId(c),c])).values()].sort(compareCells);
  if(!cells.length||cells.some(c=>c[1]!==0))return undefined;
  const minX=Math.min(...cells.map(c=>c[0])),maxX=Math.max(...cells.map(c=>c[0])),minZ=Math.min(...cells.map(c=>c[2])),maxZ=Math.max(...cells.map(c=>c[2]));
  // A straight crossing is a complete rectangle between opposite walking endpoints.
  if(cells.length!==(maxX-minX+1)*(maxZ-minZ+1))return undefined;
  const [a,b]=request.walkEndpoints,axis=a[0]===b[0]?2:a[2]===b[2]?0:-1;
  if(axis===-1||a[1]!==0||b[1]!==0||!search.nodes.has(cellId(a))||!search.nodes.has(cellId(b)))return undefined;
  const tangent=axis===0?2:0,min=axis===0?minX:minZ,max=axis===0?maxX:maxZ;
  if(Math.min(a[axis],b[axis])!==min-1||Math.max(a[axis],b[axis])!==max+1||a[tangent]<(axis===0?minZ:minX)||a[tangent]>(axis===0?maxZ:maxX))return undefined;
  if(!search.reachable(a)||!search.reachable(b))return undefined;
  const vehicle=new Set(request.vehicleCells.map(cellId)),mask=new Set(cells.map(cellId));
  const normal=HEADING_VECTORS[request.vehicleEndpoints[0].heading];
  if(normal[axis]!==0)return undefined;
  for(const state of request.vehicleEndpoints){
    if(state.rear[1]!==0||HEADING_VECTORS[state.heading][axis]!==0)return undefined;
    for(const c of [state.rear,add(state.rear,HEADING_VECTORS[state.heading])])if(!vehicle.has(cellId(c))||search.solid.query(cellBox16(c)).length)return undefined;
  }
  const rearA=request.vehicleEndpoints[0].rear[tangent],rearB=request.vehicleEndpoints[1].rear[tangent];
  const tangentMin=tangent===0?minX:minZ,tangentMax=tangent===0?maxX:maxZ;
  if(Math.min(rearA,rearB)>=tangentMin||Math.max(rearA,rearB)<=tangentMax)return undefined;
  const first=request.vehicleEndpoints[0],last=request.vehicleEndpoints[1];
  if(first.rear[axis]!==last.rear[axis]||first.rear[axis]<min||first.rear[axis]>max)return undefined;
  for(let value=Math.min(rearA,rearB);value<=Math.max(rearA,rearB);value++){
    const rear=[...first.rear] as Vec3;rear[tangent]=value;
    for(const c of [rear,add(rear,HEADING_VECTORS[first.heading])])if(!vehicle.has(cellId(c))||search.solid.query(cellBox16(c)).length)return undefined;
  }
  for(const c of cells)if(!vehicle.has(cellId(c))||search.solid.query(cellBox16(c)).length||request.intersectionKeepout.some(k=>Math.abs(k[0]-c[0])+Math.abs(k[2]-c[2])<=ENVIRONMENT.fixtures.intersectionKeepoutCells))return undefined;
  // Walk every crossing edge with the same body/sweep model used by ordinary access.
  const step=Math.sign(b[axis]-a[axis]),current=[...a] as Vec3;
  while(current[axis]!==b[axis]){const next=[...current] as Vec3;next[axis]+=step;if(search.solid.query(walkSweep16(current,next,ENVIRONMENT.access)).length)return undefined;current[axis]=next[axis];}
  const certificate:CrossingCertificate={id:request.id,cells,boxes16:cells.map(cellBox16)};
  search.book.applyCrossing(certificate,CROSSING_PROOF);
  return certificate;
}
