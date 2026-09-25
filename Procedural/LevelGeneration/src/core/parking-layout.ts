import {add,cellId,compareCells,type Vec3} from './analysis';
import {HEADING_VECTORS,type Heading,type ParkingAreaInput} from './environment-contract';
import type {BayStrip} from './parking-contract';
import type {VehicleState} from './vehicle-motion';

export interface ParkingLayout {
  id:string;axis:'X'|'Z';offset:number;incompleteBayCells:Vec3[];
  aisle:Vec3[];walk:Vec3[];bays:BayStrip[];representatives:VehicleState[];potential:number;
}
const sorted=(cells:Iterable<Vec3>)=>[...new Map([...cells].map(c=>[cellId(c),c])).values()].sort(compareCells);
const mask=(cells:Vec3[])=>new Set(cells.map(cellId));
interface RowModule {id:string;axis:'X'|'Z';aisle:Vec3[];bays:BayStrip[];representative:VehicleState}

/** Fit independent single/double-loaded rows to the actual mask, including its
 * concave wings. No bounding rectangle is filled and no obstacle is bridged.
 * The caller supplies supported, unoccupied walking landings; outside landings
 * are only adjacent ground, never extra vehicle/stall space. */
export function localParkingLayouts(area:ParkingAreaInput,cells:Vec3[],walking:Set<string>,width:number):ParkingLayout[] {
  const own=mask(cells),modules:RowModule[]=[];
  for(const axis of ['X','Z'] as const){
    const cross=axis==='X'?2:0,long=axis==='X'?0:2;
    const at=(u:number,v:number):Vec3=>axis==='X'?[v,0,u]:[u,0,v];
    const crossValues=[...new Set(cells.map(c=>c[cross]))].sort((a,b)=>a-b);
    const longValues=[...new Set(cells.map(c=>c[long]))].sort((a,b)=>a-b);
    const profiles=new Map(longValues.map(v=>[v,cells.filter(c=>c[long]===v).map(c=>c[cross]).join(',')]));
    for(const base of crossValues){
      const positions=longValues.filter(v=>Array.from({length:width},(_,i)=>at(base+i,v)).every(c=>own.has(cellId(c))));
      const ranges:[number,number][]=[];
      for(let start=0;start<positions.length;){
        let end=start+1;while(end<positions.length&&positions[end]===positions[end-1]+1)end++;
        ranges.push([positions[start],positions[end-1]]);
        let split=start;
        for(let i=start+1;i<=end;i++)if(i===end||profiles.get(positions[i])!==profiles.get(positions[i-1])){
          if(split!==start||i!==end)ranges.push([positions[split],positions[i-1]]);split=i;
        }
        start=end;
      }
      for(const [begin,end] of ranges){
        // Leave a transverse edge band. It becomes a distributor/crossing only
        // if a proved connection needs it; otherwise it is a pedestrian end cap.
        const low=begin+1,high=end-1;
        if(high-low<3)continue;
        const aisle:Vec3[]=[],bays:BayStrip[]=[];
        for(let v=low;v<=high;v++){
          for(let i=0;i<width;i++)aisle.push(at(base+i,v));
          for(const side of [-1,1]){
            const heading=(axis==='X'?(side<0?0:2):(side<0?1:3)) as Heading;
            const rear=at(side<0?base-2:base+width+1,v),front=add(rear,HEADING_VECTORS[heading]),back=add(rear,HEADING_VECTORS[(heading+2)%4]);
            if(own.has(cellId(rear))&&own.has(cellId(front))&&walking.has(cellId(back)))bays.push({id:`bay:${area.id}:${cellId(rear)}:${heading}`,cells:[rear,front],exitHeading:heading,rearWalkCells:[back]});
          }
        }
        if(!bays.length)continue;
        const rear=at(base+(axis==='X'?2:1),low);
        modules.push({id:`${axis}:${base}:${low}:${high}`,axis,aisle,bays,representative:{rear,heading:axis==='X'?1:0}});
      }
    }
  }
  const result:ParkingLayout[]=[],seen=new Set<string>();
  // Different first rows expose different packings; subsequent rows may turn
  // through 90 degrees to use a second wing of an L/U-shaped site.
  const ordered=[...modules].sort((a,b)=>b.bays.length-a.bays.length||a.aisle.length-b.aisle.length||(a.id<b.id?-1:a.id>b.id?1:0));
  const seeds=sortedSeeds(ordered);
  for(const seed of seeds){
    const lane=new Map<string,Vec3>(),walk=new Map<string,Vec3>(),occupied=new Set<string>(),bays:BayStrip[]=[],representatives:VehicleState[]=[];
    let next:RowModule|undefined=seed;
    const remaining=new Set(modules);
    while(next){
      remaining.delete(next);
      const fresh=next.bays.filter(b=>b.cells.every(c=>!occupied.has(cellId(c))&&!lane.has(cellId(c))&&!walk.has(cellId(c)))&&b.rearWalkCells.every(c=>!lane.has(cellId(c))&&!occupied.has(cellId(c))));
      if(fresh.length){next.aisle.forEach(c=>lane.set(cellId(c),c));fresh.forEach(b=>{bays.push(b);b.cells.forEach(c=>occupied.add(cellId(c)));b.rearWalkCells.forEach(c=>walk.set(cellId(c),c));});representatives.push(next.representative);}
      let score=-Infinity;next=undefined;
      for(const m of remaining){
        if(m.aisle.some(c=>occupied.has(cellId(c))||walk.has(cellId(c))))continue;
        const usable=m.bays.filter(b=>b.cells.every(c=>!occupied.has(cellId(c))&&!lane.has(cellId(c))&&!walk.has(cellId(c)))&&b.rearWalkCells.every(c=>!lane.has(cellId(c))&&!occupied.has(cellId(c))));
        if(!usable.length)continue;
        const added=m.aisle.filter(c=>!lane.has(cellId(c))).length,value=usable.length*8-added;
        if(value>score){score=value;next=m;}
      }
    }
    if(!bays.length)continue;
    // Reserve only free edge cells, not an unconditional rim across a driveway.
    for(const c of cells)if(!lane.has(cellId(c))&&!occupied.has(cellId(c))&&HEADING_VECTORS.some(d=>!own.has(cellId(add(c,d)))))walk.set(cellId(c),c);
    const signature=bays.map(b=>b.id).sort().join('|');if(seen.has(signature))continue;seen.add(signature);
    result.push({id:`rows:${seed.id}`,axis:seed.axis,offset:0,incompleteBayCells:[],aisle:sorted(lane.values()),walk:sorted(walk.values()),bays,representatives,potential:bays.length});
  }
  return result;
}
function sortedSeeds(modules:RowModule[]):RowModule[]{
  // Round-robin orientations and spread seeds along each cross axis. The list
  // is bounded independently of the number of mask cells.
  const result:RowModule[]=[];
  for(const axis of ['X','Z'] as const){
    const list=modules.filter(m=>m.axis===axis);
    for(const m of list.slice(0,4))if(!result.includes(m))result.push(m);
    for(const m of [list[0],list[Math.floor(list.length/2)],list.at(-1)])if(m&&!result.includes(m))result.push(m);
  }
  return result;
}
