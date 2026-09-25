import type {ParkingAreaPlan} from './parking-contract';
import type {ScenePlacement} from './scene-inputs';
import {HEADING_VECTORS,type Heading} from './environment-contract';
import {cellId,type Vec3} from './analysis';
import {sceneBounds16} from './placement-bounds';
export function parkingPlacements(plans:ParkingAreaPlan[]):ScenePlacement[]{
  const output:ScenePlacement[]=[],edges=new Map<string,{areaId:string;a:Vec3;b:Vec3}>(),paved=new Set<string>(),arrows=new Set<string>();
  const place=(areaId:string,id:string,asset:string,center:Vec3,size:Vec3,color:string,heading:Heading=0)=>output.push({id,kind:'parking',asset,center,size,color,context:'surface-parking',planId:id,sourceRefs:[{kind:'parking',id:areaId}],yawQuarterTurns:heading,worldBounds16:sceneBounds16(center,size,heading)});
  const edge=(areaId:string,a:Vec3,b:Vec3)=>{const key=[cellId(a),cellId(b)].sort().join('|');if(!edges.has(key))edges.set(key,{areaId,a,b});};
  for(const area of plans)for(const plan of area.plans){
    const circulation=plan.circulation,walk=new Set(circulation.walkCells.map(cellId)),aisle=new Set(circulation.aisleCells.map(cellId));
    for(const c of [...circulation.eligibleCells,...circulation.gates.flatMap(g=>g.connectorCells),...circulation.walkCells]){
      const id=`parking|${area.areaId}|${cellId(c)}|paving`;if(paved.has(id))continue;paved.add(id);
      place(area.areaId,id,'parking.paving',[c[0]+.5,1/128,c[2]+.5],[1,1/64,1],aisle.has(cellId(c))?'#41474b':walk.has(cellId(c))?'#a4a99d':'#51595d');
    }
    for(const crossing of circulation.crossings){
      const minX=Math.min(...crossing.cells.map(c=>c[0])),maxX=Math.max(...crossing.cells.map(c=>c[0])),minZ=Math.min(...crossing.cells.map(c=>c[2])),maxZ=Math.max(...crossing.cells.map(c=>c[2]));
      const alongX=maxX-minX>=maxZ-minZ;
      for(const c of crossing.cells)for(const offset of [.15,.65])place(area.areaId,`parking|${crossing.id}|${cellId(c)}|stripe:${offset}`,'parking.crossing',[c[0]+(alongX?offset:.5),3/128,c[2]+(alongX?.5:offset)],alongX?[.2,1/64,.8]:[.8,1/64,.2],'#e4e7dc');
    }
    for(const island of plan.islands){
      const minX=Math.min(...island.cells.map(c=>c[0])),maxX=Math.max(...island.cells.map(c=>c[0]))+1,minZ=Math.min(...island.cells.map(c=>c[2])),maxZ=Math.max(...island.cells.map(c=>c[2]))+1;
      place(area.areaId,`${island.id}|curb`,'parking.island',[(minX+maxX)/2,1/16,(minZ+maxZ)/2],[maxX-minX-.08,1/8,maxZ-minZ-.08],'#b5b7a8');
      place(area.areaId,`${island.id}|planting`,'parking.island',[(minX+maxX)/2,9/128,(minZ+maxZ)/2],[maxX-minX-.32,1/8,maxZ-minZ-.32],'#657b49');
    }
    for(const gate of circulation.gates){const x=gate.openingCells.reduce((n,c)=>n+c[0]+.5,0)/gate.openingCells.length,z=gate.openingCells.reduce((n,c)=>n+c[2]+.5,0)/gate.openingCells.length;
      place(area.areaId,`parking|${area.areaId}|${gate.id}|arrow`,'parking.arrow',[x,3/64,z],[1,1/64,1],'#eddc9d',gate.inwardHeading);
    }
    for(const stall of plan.stalls){
      const [x,,z]=stall.rear,d=HEADING_VECTORS[stall.heading],minX=Math.min(x,x+d[0]),maxX=Math.max(x,x+d[0])+1,minZ=Math.min(z,z+d[2]),maxZ=Math.max(z,z+d[2])+1;
      // Opposing arrows describe the bidirectional aisle; a row's orientation
      // comes from its stalls, not the component's primary layout axis.
      const laneAxis=stall.heading%2?2:0;
      if(((stall.rear[laneAxis]%8)+8)%8===4){
        const center:Vec3=[x+.5+d[0]*3.5,3/64,z+.5+d[2]*3.5],key=`${area.areaId}:${cellId(center)}`;
        if(!arrows.has(key)){
          const pair=[-1,1].map(side=>{const c=[...center] as Vec3;c[laneAxis===0?2:0]+=side*.8;return {center:c,heading:(laneAxis===0?(side>0?1:3):(side>0?2:0)) as Heading};});
          if(pair.every(a=>[-.35,.35].every(dx=>[-.35,.35].every(dz=>aisle.has(cellId([Math.floor(a.center[0]+dx),0,Math.floor(a.center[2]+dz)])))))){
            arrows.add(key);pair.forEach((a,i)=>place(area.areaId,`parking|${key}|aisle-arrow:${i}`,'parking.arrow',a.center,[.65,1/64,.85],'#dadfda',a.heading));
          }
        }
      }
      if(d[2]){edge(area.areaId,[minX,0,minZ],[minX,0,maxZ]);edge(area.areaId,[maxX,0,minZ],[maxX,0,maxZ]);const rear=d[2]>0?minZ:maxZ;edge(area.areaId,[minX,0,rear],[maxX,0,rear]);}
      else {edge(area.areaId,[minX,0,minZ],[maxX,0,minZ]);edge(area.areaId,[minX,0,maxZ],[maxX,0,maxZ]);const rear=d[0]>0?minX:maxX;edge(area.areaId,[rear,0,minZ],[rear,0,maxZ]);}
    }
  }
  for(const [key,{areaId,a,b}] of edges){const horizontal=a[0]!==b[0];place(areaId,`parking|${areaId}|edge|${key}`,'parking.line',[(a[0]+b[0])/2,3/128,(a[2]+b[2])/2],[horizontal?Math.abs(a[0]-b[0]):1/32,1/64,horizontal?1/32:Math.abs(a[2]-b[2])],'#f1e4c2');}
  return output;
}
