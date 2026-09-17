import {BASES,add,cellId,compareCells,type Vec3,type Surface} from './analysis';
import type {GenerationDocument} from './document';
import type {ResolvedBuildingMetadata} from './buildings';
import type {SpatialAnalysis,BoundaryRun} from './spatial-analysis';
import {AccessSearch,bodyBox16,walkSweep16,type AccessResult} from './access-graph';
import {BoundsIndex,ReservationBook} from './reservations';
import type {Reservation,CandidateTrace} from './environment-contract';
import type {Entrance,EntrancePlan} from './entrance-contract';
import {FACADE_ASSETS} from './facade-assets';
import type {BuildingStyle} from './building-style';
import type {ParkingCirculationArea} from './parking-contract';

export const desiredEntranceCount=(frontageCells:number,volumeCells:number,settings:GenerationDocument['environment']['entrances'])=>frontageCells===0?0:Math.min(settings.maxCount,Math.ceil(frontageCells/settings.facadeCellsPerEntry),Math.max(1,Math.ceil(volumeCells/settings.volumeCellsPerEntry)));
interface Candidate {id:string;run:BoundaryRun;faces:Surface[];landing:Vec3[];path:AccessResult;centerDistance2:number;trace:CandidateTrace}
const dotU=(s:Surface)=>s.cell.reduce((n,v,i)=>n+v*BASES[s.direction].u[i],0);
function supportsPortal(style:BuildingStyle,width:1|2,bodyWidth:number,bodyHeight:number):boolean {
  const keys=width===1?[style.entrance]:style.entrancePair,modules=keys.map(k=>style.modules.find(m=>m.id===k));
  if(modules.some(m=>!m||m.semantic!=='entrance'))return false;
  const assets=modules.map(m=>FACADE_ASSETS[m!.assetId]);
  if(assets.some(a=>!('opening' in a)))return false;
  const openings=assets.map(a=>(a as {opening:{minX:number;maxX:number;minY:number;maxY:number;openLeft?:boolean;openRight?:boolean}}).opening);
  if(width===2&&(!openings[0].openRight||!openings[1].openLeft||openings[0].minY!==openings[1].minY||openings[0].maxY!==openings[1].maxY))return false;
  const clearanceWidth=(width===1?openings[0].maxX-openings[0].minX:1+openings[1].maxX-openings[0].minX)*16;
  return clearanceWidth>=bodyWidth&&openings.every(o=>o.minY<=-.5&&(o.maxY+.5)*16>=bodyHeight);
}
export function planEntrances(document:GenerationDocument,building:ResolvedBuildingMetadata,cells:Vec3[],surfaces:Surface[],spatial:SpatialAnalysis,book:ReservationBook,solid:BoundsIndex<string>,parking:ParkingCirculationArea[]):EntrancePlan {
  const style=building.theme??document.buildingDefinition,settings=document.environment,search=new AccessSearch(spatial,document,book,solid),roads=new Set(document.sceneInputs.roads.map(cellId)),faceMap=new Map(surfaces.map(s=>[s.faceId,s])),candidates:Candidate[]=[],traces:CandidateTrace[]=[];
  const runs=spatial.buildingRuns.filter(r=>r.owner.id===building.componentId);
  for(const run of runs){
    const faces=run.cells.map(c=>faceMap.get(`${cellId(c)}|${run.direction}`)!).filter(Boolean).sort((a,b)=>dotU(a)-dotU(b));
    const low=faces.length>=3?1:0,high=faces.length>=3?faces.length-1:faces.length;
    for(const width of [2,1] as const){if(faces.length<=2&&width===2)continue;
      for(let start=low;start+width<=high;start++){
        const group=faces.slice(start,start+width),id=`portal:${building.componentId}:${group.map(f=>f.faceId).join('+')}`,landing=group.map(s=>add(s.cell,BASES[s.direction].n)),trace:CandidateTrace={candidateId:id,accepted:false,reasonCodes:[],metrics:{width,frontageLength:run.lengthCells},conflictIds:[]};traces.push(trace);
        if(group.some(f=>f.architecture?.interpretation==='unsupported')){trace.reasonCodes=['UNSUPPORTED_FACADE_TOPOLOGY'];continue;}
        const reject=(reason:string)=>trace.reasonCodes.push(reason);
        if(!supportsPortal(style,width,settings.access.pedestrianWidth16,settings.access.pedestrianHeight16)){reject('NO_COMPATIBLE_PORTAL_ASSET');continue;}
        if(landing.some(c=>roads.has(cellId(c)))){reject('NO_LANDING_SETBACK');continue;}
        const access=landing.map(c=>({cell:c,result:search.query(c)})).sort((a,b)=>(a.result.distanceCells??Infinity)-(b.result.distanceCells??Infinity)||compareCells(a.cell,b.cell));
        if(access.some(a=>!a.result.reachable)){reject(access.find(a=>!a.result.reachable)!.result.reasonCodes[0]);continue;}
        if(landing.length===2&&!search.neighbors.get(cellId(landing[0]))?.includes(cellId(landing[1]))){reject('BLOCKED_CLEARANCE');continue;}
        const reservation:Reservation={id,ownerId:building.componentId,sourceRefs:[{kind:'building',id:building.componentId}],kind:'entrance',priority:700,cells:landing,boxes16:landing.map(c=>bodyBox16(c,settings.access))};
        const conflicts=book.conflicts(reservation);if(conflicts.length){trace.reasonCodes=['RESERVATION_CONFLICT'];trace.conflictIds=conflicts;continue;}
        trace.metrics.pathLength=access[0].result.distanceCells!;trace.metrics.hardValid=true;
        candidates.push({id,run,faces:group,landing,path:access[0].result,centerDistance2:Math.abs(dotU(group[0])+dotU(group[group.length-1])-dotU(faces[0])-dotU(faces[faces.length-1])),trace});
      }
    }
  }
  const frontage=new Set(candidates.flatMap(c=>c.faces.map(f=>f.faceId))),desiredCount=desiredEntranceCount(frontage.size,cells.length,settings.entrances),selected:Candidate[]=[],reservations:Reservation[]=[];
  const distance=(a:Candidate,b:Candidate)=>Math.min(...a.landing.flatMap(c=>b.landing.map(d=>Math.abs(c[0]-d[0])+Math.abs(c[1]-d[1])+Math.abs(c[2]-d[2]))));
  const separated=(a:Candidate,b:Candidate)=>a.run.id===b.run.id?
    Math.max(dotU(a.faces[0])-dotU(b.faces[b.faces.length-1])-1,dotU(b.faces[0])-dotU(a.faces[a.faces.length-1])-1)>=settings.entrances.minGapCells:distance(a,b)>=settings.entrances.minGapCells;
  const position=(a:Candidate,b:Candidate)=>compareCells(a.faces[0].cell,b.faces[0].cell)||style.frontOrder.indexOf(a.run.direction)-style.frontOrder.indexOf(b.run.direction);
  const mainOrder=(a:Candidate,b:Candidate)=>a.path.distanceCells!-b.path.distanceCells!||b.run.lengthCells-a.run.lengthCells||b.faces.length-a.faces.length||a.centerDistance2-b.centerDistance2||style.frontOrder.indexOf(a.run.direction)-style.frontOrder.indexOf(b.run.direction)||position(a,b);
  const remaining=[...candidates];
  while(selected.length<desiredCount&&remaining.length){
    const frontages=new Set(selected.map(c=>c.path.targetFrontageId)),planes=new Set(selected.map(c=>`${c.run.direction}:${c.run.plane}`));
    remaining.sort(selected.length?(a,b)=>Number(frontages.has(a.path.targetFrontageId))-Number(frontages.has(b.path.targetFrontageId))||Number(planes.has(`${a.run.direction}:${a.run.plane}`))-Number(planes.has(`${b.run.direction}:${b.run.plane}`))||Math.min(...selected.map(c=>distance(b,c)))-Math.min(...selected.map(c=>distance(a,c)))||a.path.distanceCells!-b.path.distanceCells!||b.faces.length-a.faces.length||position(a,b):mainOrder);
    const candidate=remaining.shift()!;
    if(selected.some(s=>!separated(candidate,s))){candidate.trace.reasonCodes=['MIN_ENTRANCE_GAP'];continue;}
    const refs=[{kind:'building' as const,id:building.componentId}],path=candidate.path.path;
    const proposal:Reservation[]=[{id:candidate.id,ownerId:building.componentId,sourceRefs:refs,kind:'entrance',priority:700,cells:candidate.landing,boxes16:candidate.landing.map(c=>bodyBox16(c,settings.access))}];
    const pathBoxes=path.map(c=>({box:bodyBox16(c,settings.access),cells:[c]}));
    for(let i=1;i<path.length;i++)pathBoxes.push({box:walkSweep16(path[i-1],path[i],settings.access),cells:[path[i-1],path[i]]});
    const certificates=book.crossingSnapshot();
    for(const [i,p] of pathBoxes.entries()){
      const cert=certificates.find(c=>c.boxes16.some(b=>b.min.every((v,a)=>Math.max(v,p.box.min[a])<Math.min(b.max[a],p.box.max[a]))));
      proposal.push({id:`${candidate.id}:path:${i}`,ownerId:building.componentId,sourceRefs:refs,kind:'walk',priority:700,cells:p.cells,boxes16:[p.box],...(cert?{crossingId:cert.id}:{})});
    }
    const accepted=book.tryReserveBatch(proposal);if(!accepted.accepted){candidate.trace.reasonCodes=['RESERVATION_CONFLICT'];candidate.trace.conflictIds=accepted.conflictIds;continue;}
    candidate.trace.accepted=true;selected.push(candidate);reservations.push(...proposal);
  }
  for(const c of candidates)if(!c.trace.accepted&&!c.trace.reasonCodes.length)c.trace.reasonCodes=['LOWER_RANKED'];
  const entrances:Entrance[]=selected.map((c,i)=>({id:c.id,buildingId:building.componentId,faceIds:c.faces.map(f=>f.faceId),widthCells:c.faces.length as 1|2,role:i===0?'main':'secondary',outward:c.run.direction,landingCells:c.landing,pathCells:c.path.path,roadTargetCell:c.path.targetRoadCell!,roadFrontageId:c.path.targetFrontageId!,traceId:`entrances:${building.componentId}`}));
  if(building.design.use==='industrial'&&entrances.length>1){
    const parkingWalk=new Set(parking.flatMap(a=>a.components.flatMap(p=>p.walkCells.map(cellId))));
    const service=entrances.slice(1).filter(e=>e.roadFrontageId!==entrances[0].roadFrontageId).map(e=>{
      const queue=e.landingCells.map(c=>({id:cellId(c),distance:0})),seen=new Set(queue.map(n=>n.id));
      for(let i=0;i<queue.length;i++){const n=queue[i];if(parkingWalk.has(n.id))return {e,distance:n.distance};if(n.distance>=settings.access.maxWalkDistanceCells)continue;for(const id of search.neighbors.get(n.id)??[])if(!seen.has(id)){seen.add(id);queue.push({id,distance:n.distance+1});}}
      return {e,distance:Infinity};
    }).sort((a,b)=>a.distance-b.distance||(a.e.id<b.e.id?-1:1))[0];
    if(service&&Number.isFinite(service.distance))service.e.role='service';
  }
  return {buildingId:building.componentId,entrances,frontages:[...new Map(selected.map(c=>[`${c.run.direction}:${c.run.plane}`,{direction:c.run.direction,plane:c.run.plane}])).values()],desiredCount,unmetCount:desiredCount-entrances.length,reservations,traces:[{id:`entrances:${building.componentId}`,ownerId:building.componentId,ruleId:'accessible-portals',ruleVersion:'1.0.0',sourceRefs:[{kind:'building',id:building.componentId}],selectedIds:entrances.map(e=>e.id),candidates:traces}]};
}
