import {BASES,faceCenter2,cellId,compareCells,type Surface,type Vec3} from './analysis';
import type {GenerationDocument} from './document';
import type {VerticalPlan} from './vertical-design';
import type {Direction} from './analysis';
import type {RuleSpatialEnvelope} from './rule-spatial-contract';
import type {Reservation,DecisionTrace} from './environment-contract';
import {TRIM_ASSETS} from './banded-facade-assets';
import {FACADE_ASSETS} from './facade-assets';
import {BoundsIndex,ReservationBook} from './reservations';
import {cellBox16,faceBounds16} from './placement-bounds';
import {assertOutputBounds,envelopeIndex} from './rule-spatial-adapters';
/** Selected fixed finish on a host face, never an independently renderable module. */
export interface FacadeFinishSelection {finishId:string;assetKey:string;hostFaceId:string;position2:Vec3;orientationId:Direction;reason:string}
export interface FacadeTrimPlan {finishes:FacadeFinishSelection[];reservations:Reservation[];traces:DecisionTrace[]}
interface Edge {boundary:VerticalPlan['boundaries'][number];buildingId:string;host:Surface;kind:'cap'|'belt';cutStart:boolean;cutEnd:boolean}
export function planFacadeTrims(document:GenerationDocument,surfaces:Surface[],vertical:VerticalPlan[],envelopes:{buildingId:string;envelope:RuleSpatialEnvelope}[],book:ReservationBook):FacadeTrimPlan {
  const indices=new Map(envelopes.map(e=>[e.buildingId,envelopeIndex(e.envelope,true)]));
  const integrated=new Set(vertical.filter(v=>{
    const style=document.buildings.find(b=>b.componentId===v.buildingId)?.theme??document.buildingDefinition;
    const module=style.modules.find(m=>m.id===style.fallback)!;
    const asset=FACADE_ASSETS[module.assetId];
    return 'integratedTrims' in asset&&asset.integratedTrims;
  }).map(v=>v.buildingId));
  const faces=new Map(surfaces.map(s=>[s.faceId,s])),raw=new BoundsIndex<string>();for(const c of document.grid)raw.add(cellBox16(c),cellId(c));
  const edges:Edge[]=vertical.filter(v=>!integrated.has(v.buildingId)).flatMap(v=>v.boundaries.filter(b=>faces.get(b.hostFaceId)!.architecture?.interpretation!=='unsupported').map(boundary=>({boundary,buildingId:v.buildingId,host:faces.get(boundary.hostFaceId)!,kind:boundary.kind==='local-cap'?'cap' as const:'belt' as const,cutStart:false,cutEnd:false}))),endpoints=new Map<string,{edge:Edge;side:-1|1}[]>();
  for(const edge of edges)for(const point of [edge.boundary.edgeStart2,edge.boundary.edgeEnd2]){
    const center=faceCenter2(edge.host.cell,edge.host.direction),u=BASES[edge.host.direction].u,side=point.reduce((n,v,i)=>n+(v-center[i])*u[i],0)>0?1:-1,key=`${edge.buildingId}:${cellId(point)}:${edge.kind}`;
    const list=endpoints.get(key)??[];list.push({edge,side});endpoints.set(key,list);
  }
  const candidates:{edge:Edge;asset:string;id:string}[]=[];
  for(const [key,joins] of endpoints){
    if(joins.length!==2)continue;
    const a=BASES[joins[0].edge.host.direction].n,b=BASES[joins[1].edge.host.direction].n;
    if(a.reduce((n,v,i)=>n+v*b[i],0)!==0)continue;
    joins.sort((a,b)=>compareCells(a.edge.host.cell,b.edge.host.cell)||['PZ','PX','NZ','NX'].indexOf(a.edge.host.direction)-['PZ','PX','NZ','NX'].indexOf(b.edge.host.direction));
    for(const join of joins)if(join.side===-1)join.edge.cutStart=true;else join.edge.cutEnd=true;
    const host=joins[0],other=joins[1],u=BASES[host.edge.host.direction].u,normal=BASES[other.edge.host.direction].n;
    const convex=normal.reduce((n,v,i)=>n+v*u[i],0)===host.side;
    candidates.push({edge:host.edge,asset:`trim.${host.edge.kind}.${convex?'outer':'inner'}-${host.side>0?'positive':'negative'}`,id:`terminal:${key}`});
  }
  for(const edge of edges)candidates.push({edge,asset:`trim.${edge.kind}.${edge.cutStart&&edge.cutEnd?'both':edge.cutStart?'start':edge.cutEnd?'end':'plain'}`,id:`trim:${edge.buildingId}:${edge.boundary.id}`});
  const rank=(e:Edge)=>e.boundary.kind==='local-cap'?3:e.boundary.kind==='crown-belt'?2:1;
  candidates.sort((a,b)=>rank(b.edge)-rank(a.edge)||compareCells(a.edge.boundary.edgeStart2,b.edge.boundary.edgeStart2)||compareCells(a.edge.boundary.edgeEnd2,b.edge.boundary.edgeEnd2)||(a.id<b.id?-1:1));
  const finishes:FacadeFinishSelection[]=[],reservations:Reservation[]=[],traces=new Map<string,DecisionTrace>();
  for(const candidate of candidates){
    const {edge,asset,id}=candidate,descriptor=TRIM_ASSETS[asset];if(!descriptor)throw new Error('RULE_OUTPUT_BOUNDS_UNKNOWN');
    const position2=faceCenter2(edge.host.cell,edge.host.direction),boxes=descriptor.boxes16.map(box=>faceBounds16(box,position2,edge.host.direction)),envelope=envelopes.find(e=>e.buildingId===edge.buildingId)!.envelope;
    assertOutputBounds(asset,faceBounds16(descriptor.bounds16,position2,edge.host.direction),envelope,true,indices.get(edge.buildingId));
    let trace=traces.get(edge.buildingId);if(!trace){trace={id:`trims:${edge.buildingId}`,ownerId:edge.buildingId,ruleId:'facade-trim-joints',ruleVersion:'1.0.0',sourceRefs:[{kind:'building',id:edge.buildingId}],selectedIds:[],candidates:[]};traces.set(edge.buildingId,trace);}
    const proposal:Reservation={id,ownerId:edge.buildingId,sourceRefs:[{kind:'building',id:edge.buildingId}],kind:'attachment',priority:200,cells:[edge.host.cell],boxes16:boxes};
    const occupied=[...new Set(boxes.flatMap(box=>raw.query(box).map(hit=>hit.value)))];
    const reserved=occupied.length?{accepted:false,conflictIds:occupied.map(c=>`voxel:${c}`)}:book.tryReserveBatch([proposal],[{family:descriptor.jointFamily,attachmentId:id,solidReservationId:`solid:building:${edge.buildingId}`,boxes16:boxes}]);
    trace.candidates.push({candidateId:id,accepted:reserved.accepted,reasonCodes:reserved.accepted?[]:['ATTACHMENT_CLEARANCE_CONFLICT'],conflictIds:reserved.conflictIds,metrics:{asset,host:edge.host.faceId,kind:edge.boundary.kind}});
    if(!reserved.accepted)continue;
    reservations.push(proposal);trace.selectedIds.push(id);
    finishes.push({finishId:id,assetKey:asset,hostFaceId:edge.host.faceId,position2,orientationId:edge.host.direction,reason:`${edge.boundary.kind}; ${descriptor.jointFamily}; shared world-edge owner`});
  }
  return {finishes,reservations,traces:[...traces.values()]};
}
