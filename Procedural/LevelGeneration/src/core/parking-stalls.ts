import {VehicleDomain} from './vehicle-domain';
import {add,cellId,compareCells,type Vec3} from './analysis';
import {HEADING_VECTORS,type Heading,type Reservation,type CandidateTrace} from './environment-contract';
import type {GenerationDocument} from './document';
import type {SpatialAnalysis} from './spatial-analysis';
import {BoundsIndex,ReservationBook} from './reservations';
import {AccessSearch} from './access-graph';
import {cellBox16} from './placement-bounds';
import {buildVehicleGraph,vehicleBFS,vehiclePath,vehicleTransitions,validState,stateKey,compareStates,type VehicleGraph,type VehicleState,type VehicleReachability} from './vehicle-motion';
import {ParkingCharge} from './parking-budget';
import {parkingQuality,areaParkingQuality} from './parking-quality';
import type {ParkingCirculationPlan,ParkingStall,ParkingPlan,ParkingAreaPlan,ParkingCirculationArea} from './parking-contract';

interface LocalProof {path:VehicleState[];gateId:string;states:number}
function localProof(parked:VehicleState,own:Vec3[],baseMask:Set<string>,graph:VehicleGraph,reach:VehicleReachability,rootGates:Map<number,string>,reverse:boolean,charge:ParkingCharge,domain?:VehicleDomain,numericMask?:Uint8Array):LocalProof|undefined {
  const allowed=domain?undefined:new Set([...baseMask,...own.map(cellId)]),extra=new Map<string,VehicleState>();
  for(const c of own)for(let h=0;h<4;h++)for(const rear of [c,add(c,HEADING_VECTORS[h].map(n=>-n) as Vec3)]){
    const s={rear,heading:h as Heading},key=stateKey(s);if(!graph.index.has(key)&&(domain?domain.stateValid(s,numericMask!):validState(s,allowed!)))extra.set(key,s);
  }
  if(extra.size>16)throw new Error('STALL_BUDGET_CONTRACT_VIOLATION');
  const start=stateKey(parked),queue=[start],distance=new Map([[start,0]]),previous=new Map<string,string>();
  if(!extra.has(start))throw new Error('INVALID_BAY_STRIP_PARTITION');
  let best:{length:number;gateId:string;base:number;local:string}|undefined;
  for(let at=0;at<queue.length;at++){
    const key=queue[at],state=extra.get(key)!;charge.stall();
    // The model includes exact inverse turns, so its transition graph is symmetric.
    // This also enumerates incoming edges for the entry proof without a third pass.
    for(const nextState of domain?domain.transitions(state,numericMask!):vehicleTransitions(state).filter(e=>e.sweep.every(c=>allowed!.has(cellId(c)))).map(e=>e.state)){
      const next=stateKey(nextState),base=graph.index.get(next);
      if(base!==undefined){if(reach.distance[base]<0)continue;const length=distance.get(key)!+1+reach.distance[base],gateId=rootGates.get(reach.root[base])!;
        if(!best||length<best.length||length===best.length&&(gateId<best.gateId||gateId===best.gateId&&compareStates(graph.states[base],graph.states[best.base])<0))best={length,gateId,base,local:key};
      }else if(extra.has(next)&&!distance.has(next)){distance.set(next,distance.get(key)!+1);previous.set(next,key);queue.push(next);}
    }
  }
  if(!best)return undefined;
  const local:VehicleState[]=[];for(let key:string|undefined=best.local;key!==undefined;key=previous.get(key))local.push(extra.get(key)!);
  const global=vehiclePath(graph,reach,best.base,reverse);
  return {path:reverse?[...local.reverse(),...global]:[...global,...local],gateId:best.gateId,states:extra.size};
}
export function validateStallProof(stall:ParkingStall,baseMask:Set<string>,domain?:VehicleDomain,numericMask?:Uint8Array):number {
  const allowed=domain?undefined:new Set([...baseMask,...stall.cells.map(cellId)]);let checks=0;
  for(const path of [stall.entryPath,stall.exitPath]){
    if(!path.length||path.some(s=>!(domain?domain.stateValid(s,numericMask!):validState(s,allowed!))))throw new Error('INVALID_STALL_PROOF');
    for(let i=1;i<path.length;i++){checks++;const valid=domain?domain.transitions(path[i-1],numericMask!).some(s=>stateKey(s)===stateKey(path[i])):vehicleTransitions(path[i-1]).some(t=>stateKey(t.state)===stateKey(path[i])&&t.sweep.every(c=>allowed!.has(cellId(c))));if(!valid)throw new Error('INVALID_STALL_PROOF');}
  }
  return checks;
}
function planComponent(document:GenerationDocument,circulation:ParkingCirculationPlan,spatial:SpatialAnalysis,book:ReservationBook,solid:BoundsIndex<string>,domain?:VehicleDomain):ParkingPlan {
  const startChecks=solid.checks,charge=new ParkingCharge(circulation.budget),stalls:ParkingStall[]=[],reservations:Reservation[]=[],traces:CandidateTrace[]=[],rejected:Record<string,number>={},rejectedCells:Record<string,string>={};
  let graphBuilds=0,bfsPasses=0,maxLocalStates=0,proofEdgeChecks=0;
  if(circulation.gates.length){
    const cells=[...new Map([...document.sceneInputs.roads,...circulation.aisleCells,...circulation.gates.flatMap(g=>[...g.openingCells,...g.connectorCells])].map(c=>[cellId(c),c])).values()].sort(compareCells),baseMask=new Set(cells.map(cellId));
    const numericBase=domain?.mask(cells);
    const N=(circulation.budget.stallStateUpperBound-32*Math.floor(circulation.eligibleCells.length/2))/12;
    if(cells.length>N)throw new Error('STALL_BUDGET_CONTRACT_VIOLATION');
    const graph=domain?domain.graph(cells,charge.stall):buildVehicleGraph(cells,charge.stall);graphBuilds++;
    const rootGates=new Map<number,string>(),roots:number[]=[];
    for(const gate of [...circulation.gates].sort((a,b)=>a.id<b.id?-1:1))for(const state of [...gate.roadStates].sort(compareStates)){
      const index=graph.index.get(stateKey(state));if(index!==undefined&&!rootGates.has(index)){rootGates.set(index,gate.id);roots.push(index);}
    }
    const entry=vehicleBFS(graph,roots,false,charge.stall),exit=vehicleBFS(graph,roots,true,charge.stall);bfsPasses=2;
    const search=new AccessSearch(spatial,document,book,solid),walk=new Set(circulation.walkCells.map(cellId)),eligible=new Set(circulation.eligibleCells.map(cellId)),used=new Set<string>();
    if(circulation.bayStrips.length>Math.floor(eligible.size/2))throw new Error('INVALID_BAY_STRIP_PARTITION');
    const cross=circulation.axis==='X'?2:0,long=circulation.axis==='X'?0:2;
    const candidates=[...circulation.bayStrips].sort((a,b)=>a.cells[0][cross]-b.cells[0][cross]||a.cells[0][long]-b.cells[0][long]||a.exitHeading-b.exitHeading);
    for(const bay of candidates){
      const rear=bay.cells[0],heading=bay.exitHeading,expected=add(rear,HEADING_VECTORS[heading]);
      if(bay.cells.length!==2||cellId(bay.cells[1])!==cellId(expected)||bay.cells.some(c=>!eligible.has(cellId(c))||used.has(cellId(c))))throw new Error('INVALID_BAY_STRIP_PARTITION');
      bay.cells.forEach(c=>used.add(cellId(c)));
      const id=`stall:${circulation.areaId}:${cellId(rear)}:${heading}`,trace:CandidateTrace={candidateId:id,accepted:false,reasonCodes:[],metrics:{},conflictIds:[]};traces.push(trace);
      const reject=(reason:string,conflictIds:string[]=[])=>{trace.reasonCodes=[reason];trace.conflictIds=conflictIds;rejected[reason]=(rejected[reason]??0)+1;for(const c of bay.cells)rejectedCells[cellId(c)]=reason;};
      const proposal:Reservation={id,ownerId:circulation.areaId,sourceRefs:[{kind:'parking',id:circulation.areaId}],kind:'stall',priority:600,cells:bay.cells,boxes16:bay.cells.map(cellBox16)},conflicts=book.conflicts(proposal);
      if(conflicts.length){reject('RESERVED_ACCESS',conflicts);continue;}
      const walkAccessCell=add(rear,HEADING_VECTORS[heading].map(n=>-n) as Vec3);
      if(!walk.has(cellId(walkAccessCell))||!search.reachable(walkAccessCell,100000)){reject('NO_PEDESTRIAN_STALL_ACCESS');continue;}
      const numericMask=domain?.extendMask(numericBase!,bay.cells);
      const state={rear,heading},entryProof=localProof(state,bay.cells,baseMask,graph,entry,rootGates,false,charge,domain,numericMask);
      if(!entryProof){reject('NO_VEHICLE_ENTRY');continue;}
      const exitProof=localProof(state,bay.cells,baseMask,graph,exit,rootGates,true,charge,domain,numericMask);
      if(!exitProof){reject('NO_VEHICLE_EXIT');continue;}
      maxLocalStates=Math.max(maxLocalStates,entryProof.states,exitProof.states);
      const stall:ParkingStall={id,areaId:circulation.areaId,cells:bay.cells,rear,heading,walkAccessCell,entryPath:entryProof.path,exitPath:exitProof.path,gateIds:{entry:entryProof.gateId,exit:exitProof.gateId},traceId:`stalls:${circulation.componentKey}`};
      proofEdgeChecks+=validateStallProof(stall,baseMask,domain,numericMask);
      const reserved=book.tryReserveBatch([proposal]);if(!reserved.accepted)throw new Error('STALL_RESERVATION_CHANGED');
      stalls.push(stall);reservations.push(proposal);trace.accepted=true;trace.metrics.entryTransitions=stall.entryPath.length-1;trace.metrics.exitTransitions=stall.exitPath.length-1;
    }
  }
  const {quality,unallocatedCells}=parkingQuality(circulation,stalls,book.snapshot(),rejected,charge.stallUsed,rejectedCells);
  const rowEnds:ParkingPlan['rowEnds']=[];const groups=new Map<string,ParkingStall[]>(),cross=circulation.axis==='X'?2:0,long=circulation.axis==='X'?0:2;
  for(const s of stalls){const key=`${s.rear[cross]}:${s.heading}`,list=groups.get(key)??[];list.push(s);groups.set(key,list);}
  for(const [rowId,list] of groups){list.sort((a,b)=>a.rear[long]-b.rear[long]);let start=0;for(let end=1;end<=list.length;end++){if(end<list.length&&list[end].rear[long]===list[end-1].rear[long]+1)continue;for(const s of [list[start],list[end-1]])if(!rowEnds.some(e=>cellId(e.cell)===cellId(s.rear)&&e.heading===s.heading))rowEnds.push({cell:s.rear,heading:s.heading,rowId:`${circulation.areaId}:${rowId}`});start=end;}}
  return {areaId:circulation.areaId,circulation,stalls,unallocatedCells,rowEnds,reservations,reasonCodes:stalls.length?[]:['NO_USABLE_STALLS'],traces:[{id:`stalls:${circulation.componentKey}`,ownerId:circulation.areaId,ruleId:'parking-stall-proofs',ruleVersion:'1.0.0',sourceRefs:[{kind:'parking',id:circulation.areaId}],selectedIds:stalls.map(s=>s.id),candidates:traces}],quality,counters:{potentialStalls:quality.potentialStalls,acceptedStalls:stalls.length,stateExpansions:charge.stallUsed,graphBuilds,bfsPasses,maxLocalStates,proofEdgeChecks,boundsChecks:solid.checks-startChecks}};
}
export function planParkingStalls(document:GenerationDocument,circulation:ParkingCirculationArea[],spatial:SpatialAnalysis,book:ReservationBook,solid:BoundsIndex<string>,domains?:Map<string,VehicleDomain>):ParkingAreaPlan[]{
  return circulation.map(area=>{const plans=area.components.map(c=>planComponent(document,c,spatial,book,solid,domains?.get(`${area.areaId}:${c.componentKey}`)));return {areaId:area.areaId,plans,quality:areaParkingQuality(document.sceneInputs.parkingAreas.find(p=>p.id===area.areaId)!,area,plans)};});
}
