import {ENVIRONMENT} from './environment-settings';
import {add,BASES,cellId,compareCells,type Vec3,type Direction} from './analysis';
import type {GenerationDocument} from './document';
import type {VolumeAnalysis} from './regions';
import {type ObjectInput,type ScenePlacement} from './scene-inputs';
import {HEADING_VECTORS,type Heading,type Box16,type SourceRef,type Reservation,type DecisionTrace,type CandidateTrace} from './environment-contract';
import {FIXTURE_CATALOG,transformFixtureBox,type FixturePrototypeId} from './fixture-catalog';
import {BoundsIndex,ReservationBook} from './reservations';
import {AccessSearch,bodyBox16,walkSweep16} from './access-graph';
import {segmentOccluded,type SpatialAnalysis} from './spatial-analysis';
import {boxesOverlap,sceneBounds16} from './placement-bounds';
import {hash33} from './selection';
import {positiveMod} from './vertical-design';
import {SceneRelationIndex,SupportIndex} from './scene-relations';
import type {ParkingAreaPlan} from './parking-contract';

export interface FixtureContext {
  support:'ground'|'roof'|'wall';parkingAreaId?:string;parkingZone?:'gate'|'row-end'|'edge'|'interior';gateId?:string;
  roadDistanceCells?:number;roadHeading?:Heading;vegetationDistanceCells?:number;vegetationDirection?:Heading;
  median:boolean;accessMode:'public'|'local-only'|'service-unverified';
}
export interface FixtureCandidate {
  id:string;sourceRefs:SourceRef[];anchorCell:Vec3;center16:Vec3;heading:Heading;prototypeId:FixturePrototypeId;context:FixtureContext;
  bodyBoxes16:Box16[];useBoxes16:Box16[];serviceCells:Vec3[];priority:500|400|300;rankHash:number;offset:number;publicDistance:number;frontFree:number;
}
export interface FixturePlan {placements:ScenePlacement[];reservations:Reservation[];traces:DecisionTrace[];counters:{slots:number;emptySlots:number;candidates:number;accepted:number;maxVariantsPerAnchor:number;companionCandidates:number;neighborChecks:number}}
interface Column {cell:Vec3;height:number}
interface Patch {category:'facility'|'lighting';direction:Direction;support:FixtureContext['support'];footY:number;columns:Column[];inputs:ObjectInput[];volume:Set<string>}
interface Slot {id:string;columns:Column[];patch:Patch;family:string;prototype:FixturePrototypeId|'lamp'|'empty';center2:Vec3}
interface Cluster {id:string;items:FixtureCandidate[];main:FixtureCandidate;trace:CandidateTrace}
const ascii=(a:string,b:string)=>a<b?-1:a>b?1:0;
const manhattan=(a:Vec3,b:Vec3)=>a.reduce((n,v,i)=>n+Math.abs(v-b[i]),0);
const sameHeightDistance=(a:Vec3,b:Vec3)=>a[1]===b[1]?Math.abs(a[0]-b[0])+Math.abs(a[2]-b[2]):Infinity;
const intersects=(a:Box16[],b:Box16[])=>a.some(x=>b.some(y=>boxesOverlap(x,y)));
function occupiedCells(box:Box16):Vec3[]{const cells:Vec3[]=[];for(let x=Math.floor(box.min[0]/16);x<Math.ceil(box.max[0]/16);x++)for(let y=Math.floor(box.min[1]/16);y<Math.ceil(box.max[1]/16);y++)for(let z=Math.floor(box.min[2]/16);z<Math.ceil(box.max[2]/16);z++)cells.push([x,y,z]);return cells;}
function makePatches(support:SupportIndex):Patch[]{
  const groups=new Map<string,Patch>();
  for(const relation of support.records){if(!relation.accepted||relation.category==='vegetation'||relation.category==='facility'&&relation.direction!=='PY')continue;
    const footY=relation.cell[1],key=`${relation.category}:${relation.direction}:${relation.support}:${footY}`;
    const patch=groups.get(key)??{category:relation.category,direction:relation.direction,support:relation.support,footY,columns:[],inputs:[],volume:new Set<string>()};
    for(const c of relation.cells){const input=support.ownerAt(c)!;if(!patch.inputs.includes(input))patch.inputs.push(input);patch.volume.add(cellId(c));}
    groups.set(key,patch);
  }
  const patches:Patch[]=[];
  for(const group of groups.values()){
    const columns=new Map<string,Column>();
    group.inputs.sort((a,b)=>ascii(a.id,b.id));
    for(const id of group.volume){const c=id.split(',').map(Number) as Vec3;if(group.support==='wall'||c[1]===group.footY)columns.set(id,{cell:c,height:group.support==='wall'?1:support.columnAt(c)!.height});}
    const remaining=new Set(columns.keys());
    for(const root of [...columns.values()].sort((a,b)=>compareCells(a.cell,b.cell))){if(!remaining.delete(cellId(root.cell)))continue;const queue=[root];for(let i=0;i<queue.length;i++)for(const d of HEADING_VECTORS){const id=cellId(add(queue[i].cell,d));if(remaining.delete(id))queue.push(columns.get(id)!);}patches.push({...group,columns:queue.sort((a,b)=>compareCells(a.cell,b.cell))});}
  }
  return patches;
}
export function planFixtures(document:GenerationDocument,analysis:VolumeAnalysis,spatial:SpatialAnalysis,book:ReservationBook,solid:BoundsIndex<string>,parking:ParkingAreaPlan[],wallMounts:Map<string,{outset16:number;ownerId:string}>=new Map(),relations=new SceneRelationIndex(new SupportIndex(document,analysis),document,spatial)):FixturePlan {
  const counters:FixturePlan['counters']={slots:0,emptySlots:0,candidates:0,accepted:0,maxVariantsPerAnchor:0,companionCandidates:0,neighborChecks:0},placements:ScenePlacement[]=[],reservations:Reservation[]=[],traces:DecisionTrace[]=[];
  const settings=ENVIRONMENT.fixtures,search=new AccessSearch(spatial,document,book,solid),fixed=book.snapshot(),protectedWalk=new Set(fixed.filter(r=>r.kind==='walk'&&(r.priority===900||r.priority===700)).flatMap(r=>r.cells.map(cellId))),roadSet=new Set(document.sceneInputs.roads.map(cellId));
  const trees=relations.support.records.filter(r=>r.category==='vegetation'&&r.accepted).map(r=>({cell:r.cell,id:relations.support.ownerAt(r.cell)!.id}));
  const areas=document.sceneInputs.parkingAreas.map(a=>({...a,mask:new Set(a.cells.map(cellId)),plans:parking.find(p=>p.areaId===a.id)?.plans??[]}));
  const vegetationSources=new Map<string,string>();
  const horizontalHeading=(from:Vec3,to:Vec3):Heading=>{
    const ranked=HEADING_VECTORS.map((d,h)=>({h,score:d[0]*(to[0]-from[0])+d[2]*(to[2]-from[2])})).sort((a,b)=>b.score-a.score||a.h-b.h);return ranked[0].h as Heading;
  };
  const contextAt=(cell:Vec3,patch:Patch):FixtureContext=>{
    const context:FixtureContext={support:patch.support,median:false,accessMode:'service-unverified'};
    const area=areas.find(a=>a.mask.has(cellId(cell)));
    if(area){context.parkingAreaId=area.id;const gates=area.plans.flatMap(p=>p.circulation.gates).map(g=>({gate:g,distance:Math.min(...g.openingCells.map(c=>sameHeightDistance(c,cell)))})).sort((a,b)=>a.distance-b.distance||ascii(a.gate.id,b.gate.id));
      if(gates[0]?.distance<=2){context.parkingZone='gate';context.gateId=gates[0].gate.id;}
      else if(area.plans.some(p=>p.rowEnds.some(e=>sameHeightDistance(e.cell,cell)<=2)))context.parkingZone='row-end';
      else if(HEADING_VECTORS.some(d=>!area.mask.has(cellId(add(cell,d)))))context.parkingZone='edge';else context.parkingZone='interior';
    }
    const road=relations.roadAt(cell,settings.intersectionKeepoutCells);
    if(road.distanceCells!==undefined){context.roadDistanceCells=road.distanceCells;context.roadHeading=road.heading;}
    const adjacent=HEADING_VECTORS.map(d=>roadSet.has(cellId(add(cell,d))));context.median=adjacent[0]&&adjacent[2]||adjacent[1]&&adjacent[3];
    const nearby=trees.map(t=>({...t,distance:sameHeightDistance(cell,t.cell)})).filter(t=>t.distance<=settings.vegetationRadiusCells).sort((a,b)=>a.distance-b.distance||compareCells(a.cell,b.cell));
    const tree=nearby.find(t=>!segmentOccluded(cell,t.cell,solid,ENVIRONMENT.access.pedestrianWidth16,ENVIRONMENT.access.pedestrianHeight16,new Set([`solid:object:${t.id}`])));
    if(tree){context.vegetationDistanceCells=tree.distance;context.vegetationDirection=horizontalHeading(cell,tree.cell);vegetationSources.set(cellId(cell),tree.id);}
    return context;
  };
  const contextCache=new Map<string,FixtureContext>();
  const getContext=(column:Column,patch:Patch)=>{const key=`${patch.support}:${cellId(column.cell)}`;let c=contextCache.get(key);if(!c){c=contextAt(column.cell,patch);contextCache.set(key,c);}return c;};
  const familyAt=(context:FixtureContext,patch:Patch)=>patch.support==='wall'?'wall':patch.category==='lighting'?'lamp':context.parkingAreaId?`parking-${context.parkingZone}${context.gateId?`:${context.gateId}`:''}`:patch.support==='roof'?'roof-utility':context.vegetationDistanceCells!==undefined?'rest':(context.roadDistanceCells??Infinity)<=settings.roadsideRadiusCells?'street':'utility';
  const choose=(family:string,index:number,columns:Column[]):{prototype:Slot['prototype']}=>{
    if(family==='wall')return {prototype:'wall-lamp'};
    if(family==='lamp'||family.startsWith('parking-edge')||family.startsWith('parking-interior'))return {prototype:'lamp'};
    if(family.startsWith('parking-gate'))return {prototype:'raised-barrier-post'};
    if(family.startsWith('parking-row-end'))return {prototype:'safety-bollard'};
    if(family==='roof-utility')return {prototype:columns.some(c=>c.height>=2)?'water-tank':'air-conditioner'};
    if(family==='utility')return {prototype:'utility-cabinet'};
    if(family==='rest'){const i=positiveMod(index,4);return i===1||i===3?{prototype:'empty'}:{prototype:i===2?'bin':'bench'};}
    return {prototype:(['bench','empty','bin','empty','hydrant','empty'] as const)[positiveMod(index,6)]};
  };
  const slots:Slot[]=[];
  for(const patch of makePatches(relations.support)){
    // Painted lighting owns one fixture per support cell; vertical ground/roof cells set pole height.
    if(patch.category==='lighting'){
      for(const column of patch.columns)slots.push({id:`cell:lighting:${patch.direction}:${cellId(column.cell)}`,columns:[column],patch,family:familyAt(getContext(column,patch),patch),center2:column.cell.map(n=>2*n) as Vec3,prototype:patch.support==='wall'?'wall-lamp':'lamp'});
      continue;
    }
    for (const column of patch.columns) {
      const context=getContext(column,patch),family=familyAt(context,patch);
      const index=hash33(document.seed,`painted-facility:${cellId(column.cell)}`);
      const choice=choose(family,index,[column]);
      const prototype=choice.prototype==='empty'?'bench':choice.prototype;
      slots.push({id:`cell:facility:${cellId(column.cell)}`,columns:[column],patch,family,
        center2:column.cell.map(n=>2*n) as Vec3,prototype});
    }
  }

  let finalBodyIndex:BoundsIndex<string>|undefined;
  const bodyClear=(box:Box16,bodies:Box16[])=>!bodies.some(b=>boxesOverlap(box,b))&&!finalBodyIndex?.query(box).length;
  const publicAccess=(start:Vec3,bodies:Box16[])=>{
    const id=cellId(start);if(!search.nodes.has(id)||!bodyClear(bodyBox16(start,ENVIRONMENT.access),bodies))return undefined;
    const queue=[{id,path:[start]}],seen=new Set([id]);
    for(let i=0;i<queue.length;i++){const node=queue[i];if(protectedWalk.has(node.id))return node.path;if(node.path.length>2)continue;
      for(const next of search.neighbors.get(node.id)??[]){const foot=search.nodes.get(next)!.foot;if(seen.has(next)||!bodyClear(bodyBox16(foot,ENVIRONMENT.access),bodies)||!bodyClear(walkSweep16(node.path[node.path.length-1],foot,ENVIRONMENT.access),bodies))continue;seen.add(next);queue.push({id:next,path:[...node.path,foot]});}
    }return undefined;
  };
  const localPocket=(start:Vec3,bodies:Box16[])=>{
    for(const dx of [-1,0])for(const dz of [-1,0]){const cells:Vec3[]=[[start[0]+dx,start[1],start[2]+dz],[start[0]+dx,start[1],start[2]+dz+1],[start[0]+dx+1,start[1],start[2]+dz],[start[0]+dx+1,start[1],start[2]+dz+1]];
      if(cells.some(c=>!search.nodes.has(cellId(c))))continue;
      const boxes=cells.map(c=>bodyBox16(c,ENVIRONMENT.access));let valid=true;
      for(const [a,b] of [[0,1],[0,2],[1,3],[2,3]]){if(!search.neighbors.get(cellId(cells[a]))?.includes(cellId(cells[b]))){valid=false;break;}boxes.push(walkSweep16(cells[a],cells[b],ENVIRONMENT.access));}
      if(valid&&boxes.every(box=>bodyClear(box,bodies)))return {cells,boxes};
    }return undefined;
  };
  const attempt=(slot:Slot,column:Column,prototype:FixturePrototypeId,heading:Heading,offset:number):{candidate?:FixtureCandidate;reason?:string;conflicts?:string[]}=>{
    counters.candidates++;const c=column.cell,context={...getContext(column,slot.patch)},descriptor=FIXTURE_CATALOG[prototype],d=HEADING_VECTORS[heading];
    if(slot.patch.support==='wall'&&!relations.support.face(`${cellId(add(c,BASES[slot.patch.direction].n.map(n=>-n) as Vec3))}|${slot.patch.direction}`))return {reason:'NO_WALL_SUPPORT'};
    if(!relations.support.at(c)?.accepted)return {reason:relations.support.at(c)?.reasonCodes[0]??'NO_SUPPORTED_SURFACE'};
    const center16:Vec3=[c[0]*16+8+offset*d[0],c[1]*16,c[2]*16+8+offset*d[2]];
    let supportOwner:string|undefined;
    if(slot.patch.support==='wall'){
      const hostFace=`${cellId(add(c,BASES[slot.patch.direction].n.map(n=>-n) as Vec3))}|${slot.patch.direction}`,mount=wallMounts.get(hostFace);
      if(!mount)return {reason:'NO_COMPATIBLE_WALL_MOUNT'};supportOwner=mount.ownerId;
      const outset=mount.outset16+descriptor.size16[2]/2-8;
      center16[0]=c[0]*16+8+outset*d[0];center16[2]=c[2]*16+8+outset*d[2];center16[1]+=5;
    }
    const bodies=descriptor.bodyBoxes16.map(b=>transformFixtureBox(b,center16,heading));
    if(bodies.some(b=>occupiedCells(b).some(cell=>!slot.patch.volume.has(cellId(cell)))))return {reason:'BODY_OUTSIDE_INTENT'};
    if(relations.roadAt(c,settings.intersectionKeepoutCells).junctionIds.length)return {reason:'INTERSECTION_KEEPOUT'};
    if(context.median&&['bench','bin','pay-station'].includes(prototype))return {reason:'MEDIAN_NOT_FOR_REST'};
    const bodyReservation:Reservation={id:'fixture-query',ownerId:'fixture-query',sourceRefs:[],kind:descriptor.priority===500?'safety':descriptor.priority===400?'lighting':'fixture',priority:descriptor.priority,cells:[c],boxes16:bodies};
    const conflicts=book.conflicts(bodyReservation);
    if(conflicts.length){const kind=fixed.find(r=>r.id===conflicts[0])?.kind;return {reason:kind==='entrance'?'ENTRANCE_KEEPOUT':kind==='vehicle-aisle'?'PARKING_AISLE_CONFLICT':kind==='stall'?'STALL_CONFLICT':'BODY_RESERVATION_CONFLICT',conflicts};}
    let use=offset===-6?c:add(c,d);
    if(slot.patch.support==='wall')use=search.graph.walkNodes.filter(n=>n.foot[0]===c[0]&&n.foot[2]===c[2]&&n.foot[1]<=c[1]).sort((a,b)=>b.foot[1]-a.foot[1])[0]?.foot??c;
    let serviceCells:Vec3[]=[],useBoxes:Box16[]=[],publicDistance=Infinity;
    // Painted cells own their models. Access is reported after every body is
    // placed; it must not relocate a model or permanently consume a neighbor.
    context.accessMode='service-unverified';
    let frontFree=0;const tangent=HEADING_VECTORS[(heading+1)%4];
    for(let forward=0;forward<=1;forward++)for(let side=-1;side<=1;side++){const cell:Vec3=[use[0]+forward*d[0]+side*tangent[0],use[1],use[2]+forward*d[2]+side*tangent[2]];if(search.nodes.has(cellId(cell))&&bodyClear(bodyBox16(cell,ENVIRONMENT.access),bodies))frontFree++;}
    const refs:SourceRef[]=slot.patch.inputs.filter(input=>bodies.some(b=>input.cells.some(cell=>occupiedCells(b).some(c=>cellId(c)===cellId(cell))))).map(input=>({kind:'object' as const,id:input.id})).sort((a,b)=>ascii(a.id,b.id));
    if(supportOwner)refs.push({kind:'building',id:supportOwner});refs.sort((a,b)=>ascii(a.kind,b.kind)||ascii(a.id,b.id));
    const rankHash=hash33(document.seed,`fixtures-v1|${cellId(c)}|${slot.patch.footY}|${prototype}`),id=`fixture:${prototype}:${cellId(c)}:${heading}:${offset}`;
    return {candidate:{id,sourceRefs:refs,anchorCell:c,center16,heading,prototypeId:prototype,context,bodyBoxes16:bodies,useBoxes16:useBoxes,serviceCells,priority:descriptor.priority,rankHash,offset,publicDistance,frontFree}};
  };
  const preference=(a:FixtureCandidate,b:FixtureCandidate)=>Number(b.context.accessMode==='public')-Number(a.context.accessMode==='public')||b.frontFree-a.frontFree||Number(a.context.vegetationDirection===a.heading)-Number(b.context.vegetationDirection===b.heading)||a.publicDistance-b.publicDistance||a.heading-b.heading||compareCells(a.center16,b.center16);
  const clusters:Cluster[]=[];
  for(const slot of slots){
    const support=relations.support.at(slot.columns[0].cell)!,road=relations.roadAt(slot.columns[0].cell,settings.intersectionKeepoutCells);
    counters.slots++;const trace:DecisionTrace={id:`slot:${slot.id}`,ownerId:relations.support.ownerAt(slot.columns[0].cell)!.id,ruleId:'contextual-fixtures',ruleVersion:'1.0.0',sourceRefs:[...support.sourceRefs],selectedIds:[],candidates:[]};traces.push(trace);
    trace.relationIds=[support.id,...(road.moduleId?[road.moduleId]:[]),...road.frontageIds,...road.junctionIds];
    trace.readDependencies=[...support.readDependencies,'scene:objects','spatial:roadFrontages','spatial:roadArrivals','reservations:prior-stages','parking:plans'];
    const tree=vegetationSources.get(cellId(slot.columns[0].cell)),area=getContext(slot.columns[0],slot.patch).parkingAreaId;
    for(const ref of [...(road.moduleId?[{kind:'road' as const,id:'roads'}]:[]),...(tree?[{kind:'object' as const,id:tree}]:[]),...(area?[{kind:'parking' as const,id:area}]:[])])if(!trace.sourceRefs.some(r=>r.kind===ref.kind&&r.id===ref.id))trace.sourceRefs.push(ref);
    if(slot.prototype==='empty'){counters.emptySlots++;trace.candidates.push({candidateId:slot.id,accepted:false,reasonCodes:['EMPTY_PATTERN_SLOT'],metrics:{family:slot.family},conflictIds:[]});continue;}
    const columns=[...slot.columns].sort((a,b)=>manhattan(a.cell.map(n=>2*n) as Vec3,slot.center2)-manhattan(b.cell.map(n=>2*n) as Vec3,slot.center2)||hash33(document.seed,`fixtures-v1|${cellId(a.cell)}|${slot.prototype}`)-hash33(document.seed,`fixtures-v1|${cellId(b.cell)}|${slot.prototype}`)||compareCells(a.cell,b.cell));
    let main:FixtureCandidate|undefined;
    for(const column of columns){
      const prototype=slot.prototype==='lamp'?(column.height>=4?'lamp-64':column.height>=2?'lamp-32':'lamp-16'):slot.prototype;
      const paintedFacility=slot.patch.category==='facility',context=getContext(column,slot.patch);
      const headings:Heading[]=paintedFacility?[context.roadHeading??(context.vegetationDirection===undefined?0:(context.vegetationDirection+2)%4 as Heading)]:slot.patch.support==='wall'?[({'PZ':0,'PX':1,'NZ':2,'NX':3} as Record<string,Heading>)[slot.patch.direction]]:[context.roadHeading??0];
      const poses:FixtureCandidate[]=[];let count=0;
      for(const h of headings)for(const offset of paintedFacility?[FIXTURE_CATALOG[prototype].size16[2]<=4?-6:0]:slot.patch.support==='wall'?[-6]:[0,-6]){
        count++;const result=attempt(slot,column,prototype,h,offset);if(result.candidate)poses.push(result.candidate);
        else trace.candidates.push({candidateId:`${slot.id}:${cellId(column.cell)}:${h}:${offset}`,accepted:false,reasonCodes:[result.reason!],metrics:{prototype,family:slot.family,context:JSON.stringify(getContext(column,slot.patch)),heading:h,offset},conflictIds:result.conflicts??[]});
      }
      // A walk pocket is an access result, not permission to move a painted light.
      counters.maxVariantsPerAnchor=Math.max(counters.maxVariantsPerAnchor,count);if(poses.length){main=poses.sort(slot.patch.category==='lighting'?(a,b)=>a.heading-b.heading||a.offset-b.offset:preference)[0];break;}
    }
    if(!main)continue;
    const items=[main];
    const candidateTrace:CandidateTrace={candidateId:main.id,accepted:false,reasonCodes:[],metrics:{prototype:main.prototypeId,heading:main.heading,offset:main.offset,accessMode:main.context.accessMode,frontFree:main.frontFree,family:slot.family,context:JSON.stringify(main.context),companionCount:items.length-1},conflictIds:[]};trace.candidates.push(candidateTrace);clusters.push({id:slot.id,main,items,trace:candidateTrace});
  }
  const unique=new Map<string,Cluster>();
  for(const cluster of clusters){const key=`${cluster.main.prototypeId}:${cluster.main.center16.join(',')}:${cluster.main.heading}`,previous=unique.get(key);
    if(previous){previous.main.sourceRefs=[...new Map([...previous.main.sourceRefs,...cluster.main.sourceRefs].map(r=>[`${r.kind}:${r.id}`,r])).values()].sort((a,b)=>ascii(a.kind,b.kind)||ascii(a.id,b.id));cluster.trace.reasonCodes=['DUPLICATE_FAMILY'];}
    else unique.set(key,cluster);
  }
  const ranked=[...unique.values()].sort((a,b)=>b.main.priority-a.main.priority||a.main.rankHash-b.main.rankHash||compareCells(a.main.center16,b.main.center16)||ascii(a.main.prototypeId,b.main.prototypeId));
  const conflict=(a:Cluster,b:Cluster)=>{
    counters.neighborChecks++;
    return a.items.some(x=>b.items.some(y=>intersects(x.bodyBoxes16,y.bodyBoxes16)));
  };
  const spatialCandidates=new BoundsIndex<number>();
  ranked.forEach((cluster,i)=>{for(const item of cluster.items)for(const box of item.bodyBoxes16)spatialCandidates.add(box,i);});
  for(let i=0;i<ranked.length;i++){
    const cluster=ranked[i],neighbors=new Set<number>();
    for(const item of cluster.items)for(const box of item.bodyBoxes16)for(const hit of spatialCandidates.query(box))if(hit.value<i)neighbors.add(hit.value);
    const winner=[...neighbors].sort((a,b)=>a-b).find(j=>conflict(cluster,ranked[j]));
    if(winner!==undefined){cluster.trace.reasonCodes=['LOCAL_PRIORITY_SUPPRESSED'];cluster.trace.conflictIds=[ranked[winner].main.id];continue;}
    const proposals:Reservation[]=[];
    for(const item of cluster.items){proposals.push({id:item.id,ownerId:item.sourceRefs[0]?.id??item.id,sourceRefs:item.sourceRefs,kind:item.priority===500?'safety':item.priority===400?'lighting':'fixture',priority:item.priority,cells:[item.anchorCell],boxes16:item.bodyBoxes16});

    }
    const reserved=book.tryReserveBatch(proposals);if(!reserved.accepted)throw new Error(`FIXTURE_SUPPRESSION_INVARIANT:${reserved.conflictIds.join(',')}`);
    cluster.trace.accepted=true;cluster.trace.reasonCodes=cluster.main.context.accessMode==='local-only'?['LOCAL_ACCESS_ONLY']:cluster.main.context.accessMode==='service-unverified'?['MAINTENANCE_ROUTE_UNVERIFIED']:[];
    reservations.push(...proposals);
    for(const item of cluster.items){const d=FIXTURE_CATALOG[item.prototypeId],center:Vec3=[item.center16[0]/16,(item.center16[1]+d.size16[1]/2)/16,item.center16[2]/16],size=d.size16.map(n=>n/16) as Vec3;
      placements.push({id:item.id,kind:'object',asset:`fixture.${item.prototypeId}`,center,size,color:d.color,context:JSON.stringify(item.context),sourceRefs:item.sourceRefs,planId:cluster.id,yawQuarterTurns:item.heading,worldBounds16:sceneBounds16(center,size,item.heading)});counters.accepted++;
    }
  }
  const allBodies=new BoundsIndex<string>();
  for(const r of reservations)for(const box of r.boxes16)allBodies.add(box,r.id);
  finalBodyIndex=allBodies;
  const finalBodyClear=(box:Box16)=>allBodies.query(box).length===0;
  for(const cluster of ranked)if(cluster.trace.accepted)for(const item of cluster.items){
    const d=HEADING_VECTORS[item.heading],use=item.offset===-6?item.anchorCell:add(item.anchorCell,d);
    const path=publicAccess(use,[]);
    const publiclyReachable=item.context.support!=='wall'&&path&&path.every(c=>finalBodyClear(bodyBox16(c,ENVIRONMENT.access)))&&path.slice(1).every((c,i)=>finalBodyClear(walkSweep16(path[i],c,ENVIRONMENT.access)));
    const pocket=!document.sceneInputs.roads.length&&item.context.vegetationDistanceCells!==undefined?localPocket(use,[]):undefined;
    item.context.accessMode=publiclyReachable?'public':pocket&&pocket.boxes.every(finalBodyClear)?'local-only':'service-unverified';
    const placement=placements.find(p=>p.id===item.id)!;placement.context=JSON.stringify(item.context);
    cluster.trace.metrics.accessMode=item.context.accessMode;cluster.trace.metrics.context=placement.context;
    cluster.trace.reasonCodes=item.context.accessMode==='public'?[]:item.context.accessMode==='local-only'?['LOCAL_ACCESS_ONLY']:['MAINTENANCE_ROUTE_UNVERIFIED'];
  }
  for(const trace of traces)trace.selectedIds=trace.candidates.filter(c=>c.accepted).map(c=>c.candidateId);
  return {placements,reservations,traces,counters};
}
