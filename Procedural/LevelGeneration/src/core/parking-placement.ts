import type {ParkingAreaPlan} from './parking-contract';
import type {ScenePlacement} from './scene-inputs';
import {HEADING_VECTORS,type Heading} from './environment-contract';
import {cellId,type Vec3} from './analysis';
import {sceneBounds16} from './placement-bounds';
export function parkingPlacements(plans:ParkingAreaPlan[]):ScenePlacement[]{
  const output:ScenePlacement[]=[],edges=new Map<string,{areaId:string;a:Vec3;b:Vec3}>();
  const place=(areaId:string,id:string,asset:string,center:Vec3,size:Vec3,color:string,heading:Heading=0)=>output.push({id,kind:'parking',asset,center,size,color,context:'surface-parking',planId:id,sourceRefs:[{kind:'parking',id:areaId}],yawQuarterTurns:heading,worldBounds16:sceneBounds16(center,size,heading)});
  const edge=(areaId:string,a:Vec3,b:Vec3)=>{const key=[cellId(a),cellId(b)].sort().join('|');if(!edges.has(key))edges.set(key,{areaId,a,b});};
  for(const area of plans)for(const plan of area.plans){
    const circulation=plan.circulation,walk=new Set(circulation.walkCells.map(cellId)),aisle=new Set(circulation.aisleCells.map(cellId));
    for(const c of circulation.eligibleCells)place(area.areaId,`parking|${area.areaId}|${cellId(c)}|paving`,'parking.paving',[c[0]+.5,1/128,c[2]+.5],[1,1/64,1],walk.has(cellId(c))?'#547a6c':aisle.has(cellId(c))?'#414e56':'#536068');
    for(const gate of circulation.gates){const x=gate.openingCells.reduce((n,c)=>n+c[0]+.5,0)/gate.openingCells.length,z=gate.openingCells.reduce((n,c)=>n+c[2]+.5,0)/gate.openingCells.length;
      place(area.areaId,`parking|${area.areaId}|${gate.id}|arrow`,'parking.arrow',[x,3/64,z],[1,1/64,1],'#eddc9d',gate.inwardHeading);
    }
    for(const stall of plan.stalls){
      const [x,,z]=stall.rear,d=HEADING_VECTORS[stall.heading],minX=Math.min(x,x+d[0]),maxX=Math.max(x,x+d[0])+1,minZ=Math.min(z,z+d[2]),maxZ=Math.max(z,z+d[2])+1;
      if(d[2]){edge(area.areaId,[minX,0,minZ],[minX,0,maxZ]);edge(area.areaId,[maxX,0,minZ],[maxX,0,maxZ]);const rear=d[2]>0?minZ:maxZ;edge(area.areaId,[minX,0,rear],[maxX,0,rear]);}
      else {edge(area.areaId,[minX,0,minZ],[maxX,0,minZ]);edge(area.areaId,[minX,0,maxZ],[maxX,0,maxZ]);const rear=d[0]>0?minX:maxX;edge(area.areaId,[rear,0,minZ],[rear,0,maxZ]);}
    }
  }
  for(const [key,{areaId,a,b}] of edges){const horizontal=a[0]!==b[0];place(areaId,`parking|${areaId}|edge|${key}`,'parking.line',[(a[0]+b[0])/2,3/128,(a[2]+b[2])/2],[horizontal?Math.abs(a[0]-b[0]):1/32,1/64,horizontal?1/32:Math.abs(a[2]-b[2])],'#f1e4c2');}
  return output;
}
