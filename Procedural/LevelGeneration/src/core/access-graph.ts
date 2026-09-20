import {ENVIRONMENT} from './environment-settings';
import {add,cellId,compareCells,type Vec3} from './analysis';
import type {VolumeAnalysis} from './regions';
import type {GenerationDocument} from './document';
import type {Box16,Heading,Reservation} from './environment-contract';
import {HEADING_VECTORS} from './environment-contract';
import {BoundsIndex,ReservationBook,type CrossingCertificate} from './reservations';
import {boxesOverlap,cellBox16} from './placement-bounds';

export interface WalkNode {id:string;foot:Vec3;support:'ground'|'roof';supportOwner?:string}
export interface RoadArrival {nodeId:string;roadCell:Vec3;frontageId:string;direction:Heading}
export interface AccessResult {reachable:boolean;path:Vec3[];distanceCells?:number;targetRoadCell?:Vec3;targetFrontageId?:string;reasonCodes:string[]}
export interface AccessGraphData {
  walkNodes:WalkNode[];walkEdges:[string,string][];roadArrivals:RoadArrival[];
  counters:{nodeCandidates:number;nodesAccepted:number;edgeChecks:number;boundsChecks:number};
  diagnostics:{ownerId:string;code:string;message:string}[];
}
export interface BodySettings {pedestrianWidth16:number;pedestrianHeight16:number}
export function bodyBox16(c:Vec3,s:BodySettings):Box16 {
  const lo=Math.floor(s.pedestrianWidth16/2),hi=Math.ceil(s.pedestrianWidth16/2);
  return {min:[c[0]*16+8-lo,c[1]*16,c[2]*16+8-lo],max:[c[0]*16+8+hi,c[1]*16+s.pedestrianHeight16,c[2]*16+8+hi]};
}
export function walkSweep16(a:Vec3,b:Vec3,s:BodySettings):Box16 {
  const lo=Math.floor(s.pedestrianWidth16/2),hi=Math.ceil(s.pedestrianWidth16/2);
  return {min:[Math.min(a[0],b[0])*16+8-lo,Math.min(a[1],b[1])*16,Math.min(a[2],b[2])*16+8-lo],max:[Math.max(a[0],b[0])*16+8+hi,Math.max(a[1],b[1])*16+s.pedestrianHeight16,Math.max(a[2],b[2])*16+8+hi]};
}
export function buildAccessGraph(document:GenerationDocument,analysis:VolumeAnalysis,solid:BoundsIndex<string>):AccessGraphData {
  const original=[...document.grid,...document.sceneInputs.roads,...document.sceneInputs.objects.flatMap(o=>o.cells),...document.sceneInputs.parkingAreas.flatMap(p=>p.cells)];
  const result:AccessGraphData={walkNodes:[],walkEdges:[],roadArrivals:[],counters:{nodeCandidates:0,nodesAccepted:0,edgeChecks:0,boundsChecks:0},diagnostics:[]};
  if(!original.length)return result;
  let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
  for(const c of original){minX=Math.min(minX,c[0]);maxX=Math.max(maxX,c[0]);minZ=Math.min(minZ,c[2]);maxZ=Math.max(maxZ,c[2]);}
  if(minX===-1000000||maxX===1000000||minZ===-1000000||maxZ===1000000)result.diagnostics.push({ownerId:'scene',code:'ANALYSIS_BOUNDARY_LIMIT',message:'Coordinate limit clips the analysis halo.'});
  minX=Math.max(-1000000,minX-1);maxX=Math.min(1000000,maxX+1);minZ=Math.max(-1000000,minZ-1);maxZ=Math.min(1000000,maxZ+1);
  const candidates=new Map<string,WalkNode>(),road=new Set(document.sceneInputs.roads.map(cellId));
  const addNode=(foot:Vec3,support:WalkNode['support'],supportOwner?:string)=>{const id=cellId(foot);if(!candidates.has(id))candidates.set(id,{id,foot,support,...(supportOwner?{supportOwner}:{})});};
  for(let x=minX;x<=maxX;x++)for(let z=minZ;z<=maxZ;z++)addNode([x,0,z],'ground');
  for(const face of analysis.surfaces)if(face.direction==='PY')addNode(add(face.cell,[0,1,0]),'roof',face.componentId);
  result.counters.nodeCandidates=candidates.size;
  const settings=ENVIRONMENT.access;
  for(const node of [...candidates.values()].sort((a,b)=>compareCells(a.foot,b.foot)))if(!road.has(node.id)&&!solid.query(bodyBox16(node.foot,settings)).length)result.walkNodes.push(node);
  const nodes=new Map(result.walkNodes.map(n=>[n.id,n]));
  for(const node of result.walkNodes)for(let h=0;h<4;h++){
    const c=add(node.foot,HEADING_VECTORS[h]),id=cellId(c);
    if(nodes.has(id)&&compareCells(node.foot,c)<0){result.counters.edgeChecks++;if(!solid.query(walkSweep16(node.foot,c,settings)).length)result.walkEdges.push([node.id,id]);}
  }
  for(const node of result.walkNodes){
    if(node.foot[1]!==0)continue;
    const adjacent=HEADING_VECTORS.map(d=>road.has(cellId(add(node.foot,d))));
    if(adjacent[0]&&adjacent[2]||adjacent[1]&&adjacent[3])continue;
    const arrivals:RoadArrival[]=[];
    adjacent.forEach((yes,h)=>{if(yes){const roadCell=add(node.foot,HEADING_VECTORS[h]);arrivals.push({nodeId:node.id,roadCell,direction:h as Heading,frontageId:`road:${cellId(roadCell)}:${h}`});}});
    result.roadArrivals.push(...arrivals.sort((a,b)=>compareCells(a.roadCell,b.roadCell)||a.direction-b.direction));
  }
  result.counters.nodesAccepted=result.walkNodes.length;result.counters.boundsChecks=solid.checks;return result;
}
/** One multi-source search per reservation snapshot; all later landing queries are O(path). */
export class AccessSearch {
  readonly nodes=new Map<string,WalkNode>();
  readonly neighbors=new Map<string,string[]>();
  private roots=new Map<string,RoadArrival>();
  private predecessor=new Map<string,string>();
  private distances=new Map<string,number>();
  readonly counters={nodeVisits:0,edgeChecks:0};private publicWalk?:Vec3[];
  get publicWalkCells(){return this.publicWalk??=this.book.snapshot().filter(r=>r.kind==='walk'&&r.priority===900).flatMap(r=>r.cells);}
  constructor(readonly graph:AccessGraphData,readonly document:GenerationDocument,readonly book:ReservationBook,readonly solid:BoundsIndex<string>) {
    const settings=ENVIRONMENT.access,certificates=book.crossingSnapshot();
    const walk=(box:Box16):Reservation=>({id:'query',ownerId:'query',sourceRefs:[],kind:'walk',priority:700,cells:[],boxes16:[box],...(certificates.find(c=>c.boxes16.some(b=>boxesOverlap(box,b)))?{crossingId:certificates.find(c=>c.boxes16.some(b=>boxesOverlap(box,b)))!.id}:{})});
    const all=new Map(graph.walkNodes.map(n=>[n.id,n]));
    for(const c of certificates)for(const foot of c.cells)if(!all.has(cellId(foot)))all.set(cellId(foot),{id:cellId(foot),foot,support:'ground'});
    for(const n of all.values())if(!book.conflicts(walk(bodyBox16(n.foot,settings))).length)this.nodes.set(n.id,n);
    const edges=graph.walkEdges.slice(),seen=new Set<string>();
    for(const certificate of certificates)for(const foot of certificate.cells){const id=cellId(foot);for(const d of HEADING_VECTORS){const next=cellId(add(foot,d));if(!this.nodes.has(next))continue;const key=id<next?`${id}|${next}`:`${next}|${id}`;if(!seen.has(key)){seen.add(key);edges.push([id,next]);}}}
    for(const id of this.nodes.keys())this.neighbors.set(id,[]);
    for(const [a,b] of edges){const na=this.nodes.get(a),nb=this.nodes.get(b);if(!na||!nb)continue;
      this.counters.edgeChecks++;const sweep=walkSweep16(na.foot,nb.foot,settings);
      if(solid.query(sweep).length||book.conflicts(walk(sweep)).length)continue;
      const an=this.neighbors.get(a)!,bn=this.neighbors.get(b)!;if(!an.includes(b))an.push(b);if(!bn.includes(a))bn.push(a);
    }
    for(const [id,neighbors] of this.neighbors){const c=this.nodes.get(id)!.foot;const heading=(id:string)=>{const n=this.nodes.get(id)!.foot;return n[2]>c[2]?0:n[0]>c[0]?1:n[2]<c[2]?2:3;};neighbors.sort((a,b)=>heading(a)-heading(b));}
    const queue:string[]=[];
    for(const root of graph.roadArrivals)if(this.nodes.has(root.nodeId)&&!this.distances.has(root.nodeId)){this.roots.set(root.nodeId,root);this.distances.set(root.nodeId,0);queue.push(root.nodeId);}
    for(let i=0;i<queue.length;i++){
      const id=queue[i];this.counters.nodeVisits++;
      for(const next of this.neighbors.get(id)??[])if(!this.distances.has(next)){this.distances.set(next,this.distances.get(id)!+1);this.predecessor.set(next,id);this.roots.set(next,this.roots.get(id)!);queue.push(next);}
    }
  }
  /** The immutable search remains valid for certification against the same base snapshot. */
  withBook(book:ReservationBook):AccessSearch {return Object.assign(Object.create(AccessSearch.prototype),this,{book});}
  reachable(foot:Vec3,maxDistance=ENVIRONMENT.access.maxWalkDistanceCells){const distance=this.distances.get(cellId(foot));return !!this.document.sceneInputs.roads.length&&distance!==undefined&&distance<=maxDistance;}
  query(foot:Vec3,maxDistance=ENVIRONMENT.access.maxWalkDistanceCells):AccessResult {
    const failure=(...reasonCodes:string[]):AccessResult=>({reachable:false,path:[],reasonCodes});
    if(!this.document.sceneInputs.roads.length)return failure('NO_ROAD');
    const id=cellId(foot);
    if(!this.nodes.has(id))return failure(this.graph.walkNodes.some(n=>n.id===id)?'RESERVATION_CONFLICT':foot[1]!==0&&!this.graph.walkNodes.some(n=>n.foot[1]===foot[1])?'NO_SUPPORTED_LANDING':'BLOCKED_CLEARANCE');
    const distance=this.distances.get(id);
    if(distance===undefined)return failure(foot[1]!==0?'HEIGHT_DISCONNECTED':'NO_REACHABLE_ROAD');
    if(distance>maxDistance)return failure('PATH_TOO_LONG');
    const path:Vec3[]=[];let next:string|undefined=id;
    while(next!==undefined){path.push(this.nodes.get(next)!.foot);next=this.predecessor.get(next);}
    const root=this.roots.get(id)!;
    return {reachable:true,path,distanceCells:distance,targetRoadCell:root.roadCell,targetFrontageId:root.frontageId,reasonCodes:[]};
  }
}
export {authorizeCrossing, type CrossingRequest} from "./reservations";
