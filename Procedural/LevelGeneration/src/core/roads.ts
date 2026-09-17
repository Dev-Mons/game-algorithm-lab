import { add, cellId, normalizeGrid, type Vec3 } from "./analysis";
import type { ScenePlacement } from "./scene-inputs";
export type RoadSide = "east" | "west" | "north" | "south";
export interface RoadModule {
  id: string; origin: Vec3; size: Vec3; width: number;
  shape: "end" | "straight" | "corner" | "tee" | "cross";
  ports: RoadSide[]; cells: Vec3[];
}
const sides: [RoadSide,Vec3][] = [["east",[1,0,0]],["west",[-1,0,0]],["north",[0,0,1]],["south",[0,0,-1]]];
// Cover the road by largest filled squares, using numeric coordinate ties.
// A wide junction remains a single region even when a distant boundary changes.
export function analyzeRoads(input: Vec3[]): RoadModule[] {
  const cells = normalizeGrid(input), occupied = new Set(cells.map(cellId)), remaining = new Set(occupied);
  if (cells.some(c => c[1] !== 0)) throw new Error("Road cells must be at ground level.");
  const rectangles: {x:number;z:number;w:number;d:number}[]=[];
  while(remaining.size) {
    const sizes=new Map<string,number>();
    let best={x:0,z:0,w:0,d:0};
    // Dynamic programming counts the largest occupied square starting at each cell.
    for(const [x,,z] of [...cells].reverse()) {
      if(!remaining.has(cellId([x,0,z]))) continue;
      const size=1+Math.min(sizes.get(`${x+1},${z}`)??0,sizes.get(`${x},${z+1}`)??0,sizes.get(`${x+1},${z+1}`)??0);
      sizes.set(`${x},${z}`,size);
      if(size>best.w || size===best.w&&(x<best.x || x===best.x&&z<best.z)) best={x,z,w:size,d:size};
    }
    rectangles.push(best);
    for(let x=best.x;x<best.x+best.w;x++) for(let z=best.z;z<best.z+best.d;z++) remaining.delete(cellId([x,0,z]));
  }
  // Residual narrow caps along a common wide module belong to its full width.
  for(const wide of [...rectangles].filter(r=>r.w>1)) for(const axis of [0,2]) for(const sign of [-1,1]) {
    const band=rectangles.filter(r=>r.w===1&&r.d===1&&(axis===0 ? r.x===wide.x+(sign<0?-1:wide.w)&&r.z>=wide.z&&r.z<wide.z+wide.d : r.z===wide.z+(sign<0?-1:wide.d)&&r.x>=wide.x&&r.x<wide.x+wide.w));
    if(band.length!==(axis===0?wide.d:wide.w)) continue;
    for(const r of band) rectangles.splice(rectangles.indexOf(r),1);
    rectangles.push(axis===0?{x:band[0].x,z:wide.z,w:1,d:wide.d}:{x:wide.x,z:band[0].z,w:wide.w,d:1});
  }
  return rectangles.map(({x,z,w,d}) => {
    const members: Vec3[]=[];
    for(let dx=0;dx<w;dx++) for(let dz=0;dz<d;dz++) members.push([x+dx,0,z+dz]);
    const own=new Set(members.map(cellId));
    const ports=sides.filter(([,n])=>members.some(c=>{const key=cellId(add(c,n));return !own.has(key)&&occupied.has(key);})).map(([side])=>side);
    const horizontal=ports.includes("east")||ports.includes("west"), vertical=ports.includes("north")||ports.includes("south");
    const opposed=ports.includes("east")&&ports.includes("west") || ports.includes("north")&&ports.includes("south");
    return {id:`road:${x},${z}`,origin:[x,0,z] as Vec3,size:[w,.08,d] as Vec3,width:horizontal&&!vertical?d:vertical&&!horizontal?w:Math.min(w,d),shape:ports.length>=4?"cross" as const:ports.length===3?"tee" as const:ports.length===2?(opposed?"straight" as const:"corner" as const):"end" as const,ports,cells:members};
  }).sort((a,b)=>a.origin[0]-b.origin[0]||a.origin[2]-b.origin[2]);
}
export function roadPlacements(cells: Vec3[]): ScenePlacement[] {
  return analyzeRoads(cells).flatMap(m=>{
    const [x,,z]=m.origin,[w,,d]=m.size, center:Vec3=[x+w/2,.04,z+d/2];
    const make=(asset:string,at:Vec3,size:Vec3,color:string):ScenePlacement=>({id:`${m.id}:${asset}`,kind:"road",asset,center:at,size,color,context:`${m.width}-lane:${m.ports.join(",")}`});
    const result=[make(`road.${m.shape}.${m.width}-lane`,center,m.size,"#46515a")];
    const horizontal=m.ports.includes("east")||m.ports.includes("west")||w>d;
    if(m.shape === "straight" || m.shape === "end") {
      const span=horizontal?d:w;
      for(let lane=1;lane<span;lane++) result.push(make(`lane-${lane}`,horizontal?[center[0],.087,z+lane]:[x+lane,.087,center[2]],horizontal?[w*.85,.012,.045]:[.045,.012,d*.85],lane===span/2?"#e5c46c":"#dde2df"));
    } else {
      // Junction markings stop inside the junction; corner ports form an L.
      for(const port of m.ports) {
        const h=port === "east"||port === "west", positive=port === "east"||port === "north";
        const at:Vec3=[center[0]+(h?(positive?1:-1)*w/4:0),.087,center[2]+(!h?(positive?1:-1)*d/4:0)];
        result.push(make(`junction-${port}`,at,h?[w/2,.012,.045]:[.045,.012,d/2],"#e5c46c"));
      }
    }
    for(const [side] of sides) if(!m.ports.includes(side)) {
      const h=side === "east"||side === "west";
      result.push(make(`edge-${side}`,h?[side==="east"?x+w-.04:x+.04,.088,center[2]]:[center[0],.088,side==="north"?z+d-.04:z+.04],h?[.04,.014,d]:[w,.014,.04],"#d3d7d2"));
    }
    return result;
  });
}
