import {add,BASES,cellId,compareCells,type Direction,type Vec3} from './analysis';
import type {VolumeAnalysis} from './regions';
import type {GenerationDocument} from './document';
import {HEADING_VECTORS} from "./environment-contract";
import type {Box16,Reservation,SourceRef} from './environment-contract';
import type {RuleSpatialEnvelope} from './rule-spatial-contract';
import {cellBox16,mergeBoxes16} from './placement-bounds';
import {objectContext} from './scene-inputs';
import {BoundsIndex,ReservationBook} from './reservations';
import {buildAccessGraph,bodyBox16,type AccessGraphData,walkSweep16} from './access-graph';

export interface BoundaryRun {id:string;owner:SourceRef;footY:number;direction:'PX'|'NX'|'PZ'|'NZ';plane:number;cells:Vec3[];lengthCells:number}
export interface SpatialRelation {from:SourceRef;to:SourceRef;contactLengthCells:number;planarDistanceCells:number;deltaY:number;containedCellCount:number;sourceCellCount:number;occluded:boolean}
export interface SpatialAnalysis extends AccessGraphData {
  roadFrontages:BoundaryRun[];buildingRuns:BoundaryRun[];staticReservations:Reservation[];
  relations:SpatialRelation[];diagnostics:{ownerId:string;code:string;message:string}[];
}
const directions=['PZ','PX','NZ','NX'] as const;
export function boundaryRuns(cells:Vec3[],owner:SourceRef,exposed?:Set<string>):BoundaryRun[] {
  const own=new Set(cells.map(cellId)),groups=new Map<string,{direction:BoundaryRun['direction'];plane:number;cells:Vec3[]}>();
  for(const c of cells)for(const direction of directions)if(exposed?exposed.has(`${cellId(c)}|${direction}`):!own.has(cellId(add(c,BASES[direction].n)))){
    const a=direction==='PX'||direction==='NX'?0:2,plane=c[a]+(BASES[direction].n[a]>0?1:0),key=`${c[1]}:${direction}:${plane}`;
    const group=groups.get(key)??{direction,plane,cells:[]};group.cells.push(c);groups.set(key,group);
  }
  const runs:BoundaryRun[]=[];
  for(const group of groups.values()){
    const a=group.direction==='PX'||group.direction==='NX'?2:0,ordered=group.cells.sort((a,b)=>compareCells(a,b));
    let run:Vec3[]=[];
    const store=()=>{if(!run.length)return;runs.push({id:`boundary:${owner.kind}:${owner.id}:${group.direction}:${cellId(run[0])}`,owner,footY:run[0][1],direction:group.direction,plane:group.plane,cells:run,lengthCells:run.length});run=[];};
    for(const c of ordered){if(run.length&&c[a]!==run[run.length-1][a]+1)store();run.push(c);}store();
  }
  return runs.sort((a,b)=>compareCells(a.cells[0],b.cells[0])||directions.indexOf(a.direction)-directions.indexOf(b.direction));
}
export function analyzeSpatial(document:GenerationDocument,analysis:VolumeAnalysis,envelopes:{buildingId:string;envelope:RuleSpatialEnvelope}[],knownComponents?:{id:string;cells:Vec3[]}[]):{spatial:SpatialAnalysis;book:ReservationBook;solidIndex:BoundsIndex<string>} {
  const fixed:Reservation[]=[],solidIndex=new BoundsIndex<string>(),diagnostics:SpatialAnalysis['diagnostics']=[];
  for(const b of document.buildings) {
    const envelope=envelopes.find(p=>p.buildingId===b.componentId)?.envelope;
    if(!envelope)throw new Error('RULE_SPATIAL_CONTRACT_REQUIRED');
    const r:Reservation={id:`solid:building:${b.componentId}`,ownerId:b.componentId,sourceRefs:[{kind:'building',id:b.componentId}],kind:'solid',priority:1000,cells:[],boxes16:[...envelope.requiredBoxes16]};fixed.push(r);
  }
  const components=new Map<string,Vec3[]>();
  const owner=new Map<string,string>();
  for(const s of analysis.surfaces)owner.set(cellId(s.cell),s.componentId);
  // Flood ownership also includes interior voxels, which have no exterior face.
  const remaining=new Set(analysis.cells.map(cellId));
  for(const b of document.buildings){const known=knownComponents?.find(c=>c.id===b.componentId);const root=b.componentId.split(',').map(Number) as Vec3,queue=known?.cells??[root];remaining.delete(cellId(root));
    if(!known)for(let i=0;i<queue.length;i++)for(const d of ['PX','NX','PY','NY','PZ','NZ'] as Direction[]){const c=add(queue[i],BASES[d].n);if(remaining.delete(cellId(c)))queue.push(c);}
    components.set(b.componentId,known?queue:queue.sort(compareCells));
    const r=fixed.find(r=>r.ownerId===b.componentId)!;r.cells=queue;r.boxes16=mergeBoxes16([...r.boxes16,...mergeBoxes16(queue.map(cellBox16))]);
  }
  for(const object of document.sceneInputs.objects) {
    try{objectContext(object,document.grid,document.sceneInputs.roads,analysis);}catch(error){diagnostics.push({ownerId:object.id,code:'UNSUPPORTED_OBJECT_SUPPORT',message:String(error)});continue;}
    if(object.category==='vegetation')fixed.push({id:`solid:object:${object.id}`,ownerId:object.id,sourceRefs:[{kind:'object',id:object.id}],kind:'solid',priority:1000,cells:object.cells,boxes16:object.cells.map(cellBox16)});
  }
  for(const r of fixed)for(const box of r.boxes16)solidIndex.add(box,r.id);
  const graph=buildAccessGraph(document,analysis,solidIndex);
  diagnostics.push(...graph.diagnostics);
  if(document.sceneInputs.roads.length)fixed.push({id:'public:roads',ownerId:'roads',sourceRefs:[{kind:'road',id:'roads'}],kind:'public-vehicle',priority:900,cells:document.sceneInputs.roads,boxes16:document.sceneInputs.roads.map(cellBox16)});
  const arrivals=new Set(graph.roadArrivals.map(a=>a.nodeId));
  const publicNodes=graph.walkNodes.filter(n=>arrivals.has(n.id));
  const boxes=publicNodes.map(n=>bodyBox16(n.foot,document.environment.access));
  const byId=new Map(graph.walkNodes.map(n=>[n.id,n]));
  for(const [a,b] of graph.walkEdges)if(arrivals.has(a)&&arrivals.has(b))boxes.push(walkSweep16(byId.get(a)!.foot,byId.get(b)!.foot,document.environment.access));
  if(boxes.length)fixed.push({id:'public:walk',ownerId:'roads',sourceRefs:[{kind:'road',id:'roads'}],kind:'walk',priority:900,cells:publicNodes.map(n=>n.foot),boxes16:boxes});
  const buildingRuns:BoundaryRun[]=[];
  for(const b of document.buildings){
    const faces=analysis.surfaces.filter(s=>s.componentId===b.componentId&&s.role==='wall');
    const faceKeys=new Set(faces.map(s=>`${cellId(s.cell)}|${s.direction}`));
    for(const run of boundaryRuns([...new Map(faces.map(f=>[cellId(f.cell),f.cell])).values()],{kind:'building',id:b.componentId},faceKeys)) {
      const cells=run.cells.filter(c=>faceKeys.has(`${cellId(c)}|${run.direction}`));
      // boundaryRuns already splits disconnected masks; enclosed-air faces are removed.
      let fragment:Vec3[]=[];const axis=run.direction==='PX'||run.direction==='NX'?2:0;
      const flush=()=>{if(fragment.length)buildingRuns.push({...run,id:`${run.id}:${cellId(fragment[0])}`,cells:fragment,lengthCells:fragment.length});fragment=[];};
      for(const c of cells){if(fragment.length&&c[axis]!==fragment[fragment.length-1][axis]+1)flush();fragment.push(c);}flush();
    }
  }
  const spatial:SpatialAnalysis={...graph,diagnostics,roadFrontages:boundaryRuns(document.sceneInputs.roads,{kind:'road',id:'roads'}),buildingRuns,staticReservations:fixed,relations:[]};
  for(const arrival of spatial.roadArrivals){
    const outward=HEADING_VECTORS[(arrival.direction+2)%4];
    const direction=outward[0]===1?'PX':outward[0]===-1?'NX':outward[2]===1?'PZ':'NZ';
    const run=spatial.roadFrontages.find(r=>r.direction===direction&&r.cells.some(c=>cellId(c)===cellId(arrival.roadCell)));
    if(run)arrival.frontageId=run.id;
  }
  const sources:{ref:SourceRef;cells:Vec3[]}[]=[
    ...[...components].map(([id,cells])=>({ref:{kind:'building' as const,id},cells})),
    ...document.sceneInputs.objects.map(o=>({ref:{kind:'object' as const,id:o.id},cells:o.cells})),
    ...document.sceneInputs.parkingAreas.map(p=>({ref:{kind:'parking' as const,id:p.id},cells:p.cells})),
    ...(document.sceneInputs.roads.length?[{ref:{kind:'road' as const,id:'roads'},cells:document.sceneInputs.roads}]:[]),
  ];
  const byCell=new Map<string,Set<number>>();
  sources.forEach((source,i)=>source.cells.forEach(c=>{const key=`${c[0]},${c[2]}`;let owners=byCell.get(key);if(!owners)byCell.set(key,owners=new Set());owners.add(i);}));
  const radius=Math.max(document.environment.fixtures.vegetationRadiusCells,document.environment.fixtures.roadsideRadiusCells);
  sources.forEach((source,i)=>{
    if(source.ref.kind!=='object')return;
    const near=new Set<number>();
    for(const c of source.cells)for(let dx=-radius;dx<=radius;dx++)for(let dz=-radius+Math.abs(dx);dz<=radius-Math.abs(dx);dz++)for(const owner of byCell.get(`${c[0]+dx},${c[2]+dz}`)??[])if(owner!==i)near.add(owner);
    for(const j of [...near].sort((a,b)=>a-b)){
      const relation=spatialRelation(source.ref,source.cells,sources[j].ref,sources[j].cells,solidIndex);
      if(relation&&relation.planarDistanceCells<=radius)spatial.relations.push(relation);
    }
  });
  return {spatial,book:new ReservationBook(fixed),solidIndex};
}
export function spatialRelation(from:SourceRef,a:Vec3[],to:SourceRef,b:Vec3[],solid:BoundsIndex<string>,width16=8,height16=12):SpatialRelation|undefined {
  if(!a.length||!b.length)return undefined;
  const bSet=new Set(b.map(cellId));let distance=Infinity,deltaY=Infinity,nearestA=a[0],nearestB=b[0],contact=0,contained=0;
  // A bounded 2D distance transform avoids the Cartesian product of input volumes.
  const projections=new Map<string,Vec3[]>();for(const c of b){const key=`${c[0]},${c[2]}`;const list=projections.get(key)??[];list.push(c);projections.set(key,list);}
  const minX=Math.min(...a.map(c=>c[0]),...b.map(c=>c[0])),maxX=Math.max(...a.map(c=>c[0]),...b.map(c=>c[0]));
  const minZ=Math.min(...a.map(c=>c[2]),...b.map(c=>c[2])),maxZ=Math.max(...a.map(c=>c[2]),...b.map(c=>c[2]));
  const nearest=new Map<string,{distance:number;cell:Vec3}>(),queue:Vec3[]=[];
  for(const c of [...b].sort(compareCells)){const k=`${c[0]},${c[2]}`;if(!nearest.has(k)){nearest.set(k,{distance:0,cell:c});queue.push(c);}}
  for(let i=0;i<queue.length;i++){const c=queue[i],v=nearest.get(`${c[0]},${c[2]}`)!;for(const d of directions){const n=add(c,BASES[d].n),k=`${n[0]},${n[2]}`;if(n[0]<minX||n[0]>maxX||n[2]<minZ||n[2]>maxZ||nearest.has(k))continue;nearest.set(k,{distance:v.distance+1,cell:v.cell});queue.push(n);}}
  for(const c of [...a].sort(compareCells)){
    if(bSet.has(cellId(c)))contained++;
    for(const d of directions)if(!bSet.has(cellId(c))&&bSet.has(cellId(add(c,BASES[d].n))))contact++;
    const near=nearest.get(`${c[0]},${c[2]}`)!;const candidates=projections.get(`${near.cell[0]},${near.cell[2]}`)!;
    const target=[...candidates].sort((u,v)=>Math.abs(u[1]-c[1])-Math.abs(v[1]-c[1])||compareCells(u,v))[0];
    const dy=Math.abs(target[1]-c[1]);if(near.distance<distance||near.distance===distance&&dy<deltaY){distance=near.distance;deltaY=dy;nearestA=c;nearestB=target;}
  }
  return {from,to,contactLengthCells:contact,planarDistanceCells:distance,deltaY:nearestB[1]-nearestA[1],containedCellCount:contained,sourceCellCount:a.length,occluded:segmentOccluded(nearestA,nearestB,solid,width16,height16)};
}
export function segmentOccluded(a:Vec3,b:Vec3,solid:BoundsIndex<string>,width16=8,height16=12,ignoreIds:ReadonlySet<string>=new Set()):boolean {
  if(a[1]!==b[1])return true;
  // Supercover: at a grid-corner crossing visit both orthogonal neighboring cells.
  const dx=b[0]-a[0],dz=b[2]-a[2],sx=Math.sign(dx),sz=Math.sign(dz),nx=Math.abs(dx),nz=Math.abs(dz);
  let x=a[0],z=a[2],ix=0,iz=0;
  const check=(c:Vec3)=>solid.query(bodyBox16(c,{pedestrianWidth16:width16,pedestrianHeight16:height16})).some(h=>!(ignoreIds.has(h.value)&&cellId(c)===cellId(b)));
  while(ix<nx||iz<nz){const left=(1+2*ix)*nz,right=(1+2*iz)*nx;if(left===right){if(check([x+sx,a[1],z])||check([x,a[1],z+sz]))return true;x+=sx;z+=sz;ix++;iz++;}else if(left<right){x+=sx;ix++;}else{z+=sz;iz++;}if(check([x,a[1],z]))return true;}
  return false;
}
