import {ENVIRONMENT} from './environment-settings';
import {VehicleDomain} from './vehicle-domain';
import {add,cellId,compareCells,type Vec3} from './analysis';
import {HEADING_VECTORS,type Heading,type ParkingAreaInput,type Reservation,type DecisionTrace,type ParkingBudgetAllocation} from './environment-contract';
import type {GenerationDocument} from './document';
import {boundaryRuns,type SpatialAnalysis} from './spatial-analysis';
import {AccessSearch,authorizeCrossing,bodyBox16,walkSweep16} from './access-graph';
import {BoundsIndex,ReservationBook,type CrossingCertificate} from './reservations';
import {boxesOverlap,cellBox16} from './placement-bounds';
import {analyzeRoads} from './roads';
import {allocateParkingBudget,ParkingCharge,ParkingBudgetExceeded,type BudgetComponent} from './parking-budget';
import {positiveMod} from './vertical-design';
import {buildVehicleGraph,vehicleBFS,vehicleFootprint,vehicleTransitions,vehicleCorridor,corridorTransition,validState,stateKey,compareStates,StateHeap,type VehicleState} from './vehicle-motion';
import type {ParkingGate,BayStrip,ParkingCirculationPlan,ParkingCirculationArea} from './parking-contract';

const sorted=(cells:Iterable<Vec3>)=>[...new Map([...cells].map(c=>[cellId(c),c])).values()].sort(compareCells);
const mask=(cells:Vec3[])=>new Set(cells.map(cellId));
const headingFor=(direction:string):Heading=>({'PZ':0,'PX':1,'NZ':2,'NX':3} as Record<string,Heading>)[direction];
function components(cells:Vec3[]):Vec3[][] {
  const remaining=mask(cells),parts:Vec3[][]=[];
  for(const root of sorted(cells)){if(!remaining.delete(cellId(root)))continue;const queue=[root];for(let i=0;i<queue.length;i++)for(const d of HEADING_VECTORS){const c=add(queue[i],d);if(remaining.delete(cellId(c)))queue.push(c);}parts.push(queue.sort(compareCells));}
  return parts;
}
interface GateCandidate {gate:ParkingGate;gap:number;frontageLength:number;prepared?:{allowed:Uint8Array;roots:VehicleState[]}}
interface StripDescriptor {incompleteBayCells:Vec3[];axis:'X'|'Z';offset:number;aisle:Vec3[];walk:Vec3[];bays:BayStrip[];representatives:VehicleState[];potential:number}
class LayoutRejected extends Error {constructor(readonly reason:string,readonly conflictIds:string[]=[]){super(reason);}}
interface Trial {plan:ParkingCirculationPlan;book:ReservationBook;potential:number;additionalAisle:number;maxExitDistance:number;stateIndex:Map<string,number>;exitDistances:Int32Array}
function gateCandidates(area:ParkingAreaInput,cells:Vec3[],document:GenerationDocument,solid:BoundsIndex<string>,keepout:Vec3[]):GateCandidate[]{
  const own=mask(cells),roads=mask(document.sceneInputs.roads),other=mask(document.sceneInputs.parkingAreas.filter(p=>p.id!==area.id).flatMap(p=>p.cells)),settings=ENVIRONMENT.parking,W=settings.aisleWidthCells,candidates:GateCandidate[]=[];
  for(const run of boundaryRuns(cells,{kind:'parking',id:area.id}))for(let start=0;start+W<=run.cells.length;start++){
    const opening=run.cells.slice(start,start+W),out=HEADING_VECTORS[headingFor(run.direction)],inward=((headingFor(run.direction)+2)%4) as Heading;
    if(opening.some(c=>!own.has(cellId(add(c,HEADING_VECTORS[inward])))))continue;
    for(let gap=0;gap<=settings.maxConnectorDistanceCells;gap++){
      const end=opening.map(c=>add(c,out.map(n=>n*(gap+1)) as Vec3));if(!end.every(c=>roads.has(cellId(c))))continue;
      const connector:Vec3[]=[];for(let n=1;n<=gap;n++)connector.push(...opening.map(c=>add(c,out.map(v=>v*n) as Vec3)));
      if(connector.some(c=>own.has(cellId(c))||other.has(cellId(c))||solid.query(cellBox16(c)).length)||[...opening,...connector,...end].some(c=>keepout.some(k=>Math.abs(c[0]-k[0])+Math.abs(c[2]-k[2])<=ENVIRONMENT.fixtures.intersectionKeepoutCells)))continue;
      candidates.push({gap,frontageLength:run.lengthCells,gate:{id:`gate:${area.id}:${cellId(opening[0])}:${inward}`,areaId:area.id,openingCells:opening,inwardHeading:inward,connectorCells:sorted(connector.filter(c=>!roads.has(cellId(c)))),roadStates:[],entryStates:[],exitStates:[],crossingIds:[]}});break;
    }
  }
  return candidates.sort((a,b)=>a.gap-b.gap||b.frontageLength-a.frontageLength||compareCells(a.gate.openingCells[0],b.gate.openingCells[0])||a.gate.inwardHeading-b.gate.inwardHeading).slice(0,4);
}
function stripDescriptor(area:ParkingAreaInput,cells:Vec3[],axis:'X'|'Z',offset:number,W:number):StripDescriptor {
  const own=mask(cells),cross=axis==='X'?2:0,long=axis==='X'?0:2,T=W+5,rim=mask(cells.filter(c=>HEADING_VECTORS.some(d=>!own.has(cellId(add(c,d)))))),aisle:Vec3[]=[],walk:Vec3[]=[];
  const remainder=(c:Vec3)=>positiveMod(c[cross]-area.anchor[cross]-offset,T);
  for(const c of cells){const r=remainder(c);if(r===0||rim.has(cellId(c)))walk.push(c);if(r<3||r>W+2||rim.has(cellId(c)))continue;
    const rowStart=c[cross]-r+3;let complete=true;for(let n=0;n<W;n++){const q=[...c] as Vec3;q[cross]=rowStart+n;if(!own.has(cellId(q))||rim.has(cellId(q))){complete=false;break;}}if(complete)aisle.push(c);
  }
  // Each rectangle consists of a full-width cross section over a continuous length run.
  const stripes=new Map<number,Vec3[]>();for(const c of aisle){const base=c[cross]-remainder(c)+3,list=stripes.get(base)??[];list.push(c);stripes.set(base,list);}
  const validAisle:Vec3[]=[],representatives:VehicleState[]=[];
  for(const [base,list] of stripes){const positions=[...new Set(list.map(c=>c[long]))].sort((a,b)=>a-b);let start=0;
    for(let end=1;end<=positions.length;end++){if(end<positions.length&&positions[end]===positions[end-1]+1)continue;
      if(end-start>=2){const low=positions[start],high=positions[end-1];validAisle.push(...list.filter(c=>c[long]>=low&&c[long]<=high));
        const rear:[number,number,number]=[0,0,0];rear[long]=low;rear[cross]=base+Math.floor((W-1)/2);representatives.push({rear,heading:(axis==='X'?1:0) as Heading});
      }start=end;
    }
  }
  const lane=mask(validAisle),walking=mask(walk),bays:BayStrip[]=[];
  for(const c of cells){const r=remainder(c);if(r!==1&&r!==T-1)continue;const heading=(axis==='X'?(r===1?0:2):(r===1?1:3)) as Heading,d=HEADING_VECTORS[heading],front=add(c,d),aisleFront=add(front,d),rearWalk=add(c,d.map(n=>-n) as Vec3);
    if(!own.has(cellId(front))||!lane.has(cellId(aisleFront))||!walking.has(cellId(rearWalk))||walking.has(cellId(c))||walking.has(cellId(front)))continue;
    bays.push({id:`bay:${area.id}:${cellId(c)}:${heading}`,cells:[c,front],exitHeading:heading,rearWalkCells:[rearWalk]});
  }
  const incompleteBayCells=cells.filter(c=>{const r=remainder(c);if(![1,2,T-2,T-1].includes(r))return false;const partner=[...c] as Vec3;partner[cross]+=(r===1||r===T-2)?1:-1;return !own.has(cellId(partner));});
  return {incompleteBayCells,axis,offset,aisle:sorted(validAisle),walk:sorted(walk),bays,representatives:representatives.sort(compareStates),potential:bays.length};
}
function crossingReservations(id:string,ownerId:string,kind:'walk'|'vehicle-aisle',priority:900|800,cells:Vec3[],boxes:{box:ReturnType<typeof cellBox16>;cells:Vec3[]}[],certificates:CrossingCertificate[]):Reservation[]{
  const groups=new Map<string,{boxes:ReturnType<typeof cellBox16>[];cells:Vec3[]}>();
  for(const item of boxes){const cert=certificates.find(c=>c.boxes16.some(b=>boxesOverlap(b,item.box))),key=cert?.id??'',group=groups.get(key)??{boxes:[],cells:[]};group.boxes.push(item.box);group.cells.push(...item.cells);groups.set(key,group);}
  return [...groups].map(([crossingId,g])=>({id:`${id}:${crossingId||'ordinary'}`,ownerId,sourceRefs:[{kind:'parking',id:ownerId}],kind,priority,cells:sorted(g.cells),boxes16:g.boxes,...(crossingId?{crossingId}:{})}));
}
function validateLayout(area:ParkingAreaInput,cells:Vec3[],descriptor:StripDescriptor,gates:ParkingGate[],aisle:Vec3[],document:GenerationDocument,spatial:SpatialAnalysis,base:ReservationBook,solid:BoundsIndex<string>,keepout:Vec3[],charge:ParkingCharge,domain:VehicleDomain,baseSearch:AccessSearch):Trial|undefined {
  const book=base.clone(),roads=document.sceneInputs.roads,vehicleCells=sorted([...roads,...aisle,...gates.flatMap(g=>g.connectorCells)]),vehicleMask=mask(vehicleCells),own=mask(cells);
  const initialSearch=baseSearch.withBook(book);
  const publicWalk=baseSearch.publicWalkCells,allWalk=sorted([...descriptor.walk,...publicWalk]);
  const intersections=components(allWalk.filter(c=>vehicleMask.has(cellId(c))));
  const certified:CrossingCertificate[]=[];
  for(const intersection of intersections){
    const minX=Math.min(...intersection.map(c=>c[0])),maxX=Math.max(...intersection.map(c=>c[0])),minZ=Math.min(...intersection.map(c=>c[2])),maxZ=Math.max(...intersection.map(c=>c[2]));
    if(intersection.length!==(maxX-minX+1)*(maxZ-minZ+1))throw new LayoutRejected('CROSSING_MASK_NOT_RECTANGULAR');
    const walkAxis=maxX-minX>=maxZ-minZ?0:2,vehicleAxis=walkAxis===0?2:0;
    const mid=walkAxis===0?Math.floor((minZ+maxZ)/2):Math.floor((minX+maxX)/2),across=walkAxis===0?Math.floor((minX+maxX)/2):Math.floor((minZ+maxZ)/2);
    const walkA:Vec3=walkAxis===0?[minX-1,0,mid]:[mid,0,minZ-1],walkB:Vec3=walkAxis===0?[maxX+1,0,mid]:[mid,0,maxZ+1];
    const heading=(vehicleAxis===0?1:0) as Heading;
    const rearA:Vec3=vehicleAxis===0?[minX-2,0,across]:[across,0,minZ-2],rearB:Vec3=vehicleAxis===0?[maxX+1,0,across]:[across,0,maxZ+1];
    const cert=authorizeCrossing({id:`cross:${area.id}:${cellId(intersection[0])}`,cells:intersection,walkEndpoints:[walkA,walkB],vehicleEndpoints:[{rear:rearA,heading},{rear:rearB,heading}],vehicleCells,intersectionKeepout:keepout},initialSearch);
    if(!cert)throw new LayoutRejected('CROSSING_NOT_AUTHORIZED');certified.push(cert);
  }
  const vehicleReservation=crossingReservations(`aisle:${area.id}:${cellId(cells[0])}`,area.id,'vehicle-aisle',800,aisle,[...aisle,...gates.flatMap(g=>g.connectorCells)].map(c=>({box:cellBox16(c),cells:[c]})),certified);
  const vehicleReserved=book.tryReserveBatch(vehicleReservation);if(!vehicleReserved.accepted)throw new LayoutRejected('RESERVATION_CONFLICT',vehicleReserved.conflictIds);
  const allowedWalk=new Set(descriptor.walk.map(cellId));
  const walkGraph={...spatial,walkNodes:spatial.walkNodes.filter(n=>!own.has(n.id)||allowedWalk.has(n.id))};
  const search=new AccessSearch(walkGraph,document,book,solid),walk=descriptor.walk.filter(c=>search.reachable(c,100000));
  if(!walk.length)throw new LayoutRejected('NO_CONNECTED_WALK_STRIP');
  const walking=mask(walk),walkBoxes=walk.map(c=>({box:bodyBox16(c,ENVIRONMENT.access),cells:[c]}));
  for(const c of walk)for(const d of HEADING_VECTORS){const next=add(c,d);if(walking.has(cellId(next))&&compareCells(c,next)<0)walkBoxes.push({box:walkSweep16(c,next,ENVIRONMENT.access),cells:[c,next]});}
  const walkReservations=crossingReservations(`walk:${area.id}:${cellId(cells[0])}`,area.id,'walk',900,walk,walkBoxes,certified);
  const walkReserved=book.tryReserveBatch(walkReservations);if(!walkReserved.accepted)throw new LayoutRejected('RESERVATION_CONFLICT',walkReserved.conflictIds);
  const graph=domain.graph(vehicleCells,charge.circulation),roots=gates.flatMap(g=>g.roadStates).sort(compareStates).map(s=>graph.index.get(stateKey(s))).filter((i):i is number=>i!==undefined);
  if(!roots.length)throw new LayoutRejected('TURN_SWEEP_BLOCKED');
  const entry=vehicleBFS(graph,roots,false,charge.circulation),exit=vehicleBFS(graph,roots,true,charge.circulation);
  for(const rep of descriptor.representatives){const i=graph.index.get(stateKey(rep));if(i===undefined||entry.distance[i]<0||exit.distance[i]<0)throw new LayoutRejected('TURN_SWEEP_BLOCKED');}
  const reachable=graph.states.filter((_,i)=>entry.distance[i]>=0&&exit.distance[i]>=0);
  for(const gate of gates){
    const opening=mask(gate.openingCells);gate.entryStates=reachable.filter(s=>s.heading===gate.inwardHeading&&opening.has(cellId(s.rear)));
    gate.exitStates=gate.entryStates;
    if(!gate.entryStates.length)throw new LayoutRejected('TURN_SWEEP_BLOCKED');
    gate.crossingIds=certified.filter(c=>c.cells.some(p=>[...gate.openingCells,...gate.connectorCells].some(q=>cellId(p)===cellId(q)))).map(c=>c.id);
  }
  const aisleMask=mask(aisle),bays=descriptor.bays.filter(b=>b.cells.every(c=>!aisleMask.has(cellId(c)))&&b.rearWalkCells.every(c=>walking.has(cellId(c))));
  const reservations=[...vehicleReservation,...walkReservations];
  const coverage=mask([...aisle,...walk,...bays.flatMap(b=>b.cells)]),unservedCells=cells.filter(c=>!coverage.has(cellId(c))).length;
  const maxExitDistance=Math.max(0,...exit.distance);
  const plan:ParkingCirculationPlan={areaId:area.id,componentKey:cellId(cells[0]),status:unservedCells?'partial':'ok',axis:descriptor.axis,offset:descriptor.offset,periodCells:ENVIRONMENT.parking.aisleWidthCells+5,eligibleCells:cells,incompleteBayCells:descriptor.incompleteBayCells,gates,aisleCells:aisle,walkCells:walk,crossings:certified.map(c=>({id:c.id,cells:c.cells})),bayStrips:bays,reachableStates:reachable,reservations,traces:[],budget:charge.allocation,reasonCodes:[],counters:{layoutCandidates:charge.layoutTrials,stateExpansions:charge.circulationUsed,unservedCells,rawLayoutDescriptors:0,layoutTrialsCompleted:0,layoutTrialsAborted:0,potentialStalls:bays.length,boxChecks:solid.checks,proofEdgeChecks:0}};
  return {plan,book,potential:bays.length,additionalAisle:aisle.length-descriptor.aisle.length,maxExitDistance,stateIndex:graph.index,exitDistances:exit.distance};
}
function evaluate(area:ParkingAreaInput,cells:Vec3[],gateCandidate:GateCandidate,descriptor:StripDescriptor,document:GenerationDocument,spatial:SpatialAnalysis,base:ReservationBook,solid:BoundsIndex<string>,keepout:Vec3[],charge:ParkingCharge,domain:VehicleDomain,baseSearch:AccessSearch):Trial|undefined {
  const gate={...gateCandidate.gate},roads=mask(document.sceneInputs.roads);
  if(!gateCandidate.prepared){
    const own=mask(cells),open=mask(gate.openingCells),interior=cells.filter(c=>open.has(cellId(c))||HEADING_VECTORS.every(d=>own.has(cellId(add(c,d))))),allowedCells=[...interior,...document.sceneInputs.roads,...gate.connectorCells],allowed=mask(allowedCells),direction=HEADING_VECTORS[gate.inwardHeading];
    const roots=gate.openingCells.map(c=>({rear:add(c,direction.map(n=>-n*(gateCandidate.gap+2)) as Vec3),heading:gate.inwardHeading})).filter(s=>validState(s,roads)&&vehicleCorridor(s,ENVIRONMENT.parking.aisleWidthCells).every(c=>allowed.has(cellId(c))));
    gateCandidate.prepared={allowed:domain.mask(allowedCells),roots};
  }
  const {roots,allowed}=gateCandidate.prepared;
  if(!roots.length)throw new LayoutRejected('TURN_SWEEP_BLOCKED');
  if(!descriptor.representatives.length)throw new LayoutRejected('NO_COMPLETE_STRIP_LAYOUT');
  gate.roadStates=roots;
  let aisle=sorted([...descriptor.aisle,...gate.openingCells,...gate.connectorCells]);
  for(const representative of descriptor.representatives){const existing=domain.mask([...aisle,...document.sceneInputs.roads]),connection=domain.connect(roots,representative,allowed,existing,charge.circulation);if(!connection)throw new LayoutRejected('TURN_SWEEP_BLOCKED');aisle=sorted([...aisle,...connection.filter(c=>!roads.has(cellId(c)))]);}
  return validateLayout(area,cells,descriptor,[gate],aisle,document,spatial,base,solid,keepout,charge,domain,baseSearch);
}
const noAllocation=(key:string):ParkingBudgetAllocation=>({componentKey:key,layoutTickets:0,circulationLimit:0,stallLimit:0,stallStateUpperBound:0});
function failed(area:ParkingAreaInput,cells:Vec3[],reason:string,allocation=noAllocation(cellId(cells[0]))):ParkingCirculationPlan {
  return {areaId:area.id,componentKey:cellId(cells[0]),status:'unplannable',axis:'X',offset:0,periodCells:0,eligibleCells:cells,incompleteBayCells:[],gates:[],aisleCells:[],walkCells:[],crossings:[],bayStrips:[],reachableStates:[],reservations:[],traces:[],budget:allocation,reasonCodes:[reason],counters:{layoutCandidates:0,stateExpansions:0,unservedCells:cells.length,rawLayoutDescriptors:0,layoutTrialsCompleted:0,layoutTrialsAborted:0,potentialStalls:0,boxChecks:0,proofEdgeChecks:0}};
}
export function planParkingCirculation(document:GenerationDocument,spatial:SpatialAnalysis,initialBook:ReservationBook,solid:BoundsIndex<string>):{areas:ParkingCirculationArea[];book:ReservationBook;domains:Map<string,VehicleDomain>}{
  const startChecks=solid.checks,domains=new Map<string,VehicleDomain>();let book=initialBook;const areas:ParkingCirculationArea[]=[],road=mask(document.sceneInputs.roads),settings=ENVIRONMENT.parking;
  const keepout=analyzeRoads(document.sceneInputs.roads).filter(r=>r.shape==='tee'||r.shape==='cross').flatMap(r=>r.cells);
  for(const area of document.sceneInputs.parkingAreas){
    const excludedRoadCells=area.cells.filter(c=>road.has(cellId(c))),excludedSolidCells=area.cells.filter(c=>!road.has(cellId(c))&&solid.query(cellBox16(c)).length),excluded=mask([...excludedRoadCells,...excludedSolidCells]);
    const parts=components(area.cells.filter(c=>!excluded.has(cellId(c)))),prepared=parts.map(cells=>{
      const gates=gateCandidates(area,cells,document,solid,keepout),descriptors=(['X','Z'] as const).flatMap(axis=>Array.from({length:settings.aisleWidthCells+5},(_,offset)=>stripDescriptor(area,cells,axis,offset,settings.aisleWidthCells)));
      const own=mask(cells),fullAisle=cells.some(c=>([0,2] as const).some(axis=>{const long=axis===0?2:0;for(let i=0;i<settings.aisleWidthCells;i++)for(let j=0;j<2;j++){const p=[...c] as Vec3;p[axis]+=i;p[long]+=j;if(!own.has(cellId(p)))return false;}return true;}));
      return {cells,gates,descriptors,fullAisle,key:cellId(cells[0])};
    });
    const inputs:BudgetComponent[]=prepared.filter(p=>p.fullAisle&&p.gates.length&&p.descriptors.some(d=>d.representatives.length)).map(p=>({componentKey:p.key,minimum:p.cells[0],stateCellBound:sorted([...p.cells,...document.sceneInputs.roads,...p.gates.flatMap(g=>g.gate.connectorCells)]).length,eligibleCells:p.cells.length,trialCapacity:p.gates.length*2*(settings.aisleWidthCells+5)+Math.min(3,p.gates.length-1),gateCount:p.gates.length}));
    const ledger=allocateParkingBudget(area.id,inputs),plans:ParkingCirculationPlan[]=[];
    for(const p of prepared){
      const allocation=ledger.allocations.find(a=>a.componentKey===p.key);
      if(!allocation){plans.push(failed(area,p.cells,!p.gates.length?'NO_ROAD_GATE':!p.fullAisle?'INSUFFICIENT_AISLE_WIDTH':!p.descriptors.some(d=>d.representatives.length)?'NO_COMPLETE_STRIP_LAYOUT':ledger.unscheduled.find(u=>u.componentKey===p.key)!.reason));continue;}
      const domain=new VehicleDomain(sorted([...p.cells,...document.sceneInputs.roads,...p.gates.flatMap(g=>g.gate.connectorCells)]),settings.aisleWidthCells);
      domains.set(`${area.id}:${p.key}`,domain);
      const baseSearch=new AccessSearch(spatial,document,book,solid);
      const charge=new ParkingCharge(allocation),secondarySlots=Math.min(3,p.gates.length-1,Math.max(0,allocation.layoutTickets-1)),basicTickets=allocation.layoutTickets-secondarySlots;
      const tuples=p.gates.flatMap((gate,rank)=>p.descriptors.map(descriptor=>({gate,rank,descriptor}))).sort((a,b)=>b.descriptor.potential-a.descriptor.potential||a.descriptor.aisle.length-b.descriptor.aisle.length||a.rank-b.rank||(a.descriptor.axis<b.descriptor.axis?-1:a.descriptor.axis>b.descriptor.axis?1:0)||a.descriptor.offset-b.descriptor.offset);
      let best:Trial|undefined,bestTuple:typeof tuples[number]|undefined,stop:string|undefined;
      const candidates:DecisionTrace['candidates']=[];
      for(const tuple of tuples.slice(0,basicTickets)){
        // Connections and reservations only remove bays. A descriptor with a
        // strictly smaller geometric upper bound cannot beat a fully proven best.
        // Ties still run every proof; only an actually started graph trial costs a ticket.
        if(best&&tuple.descriptor.potential<best.potential){candidates.push({candidateId:`${tuple.gate.gate.id}:${tuple.descriptor.axis}:${tuple.descriptor.offset}`,accepted:false,reasonCodes:['PROVEN_POTENTIAL_DOMINATED'],metrics:{potentialUpperBound:tuple.descriptor.potential,provenBestPotential:best.potential},conflictIds:[]});continue;}
        if(!charge.trial())break;
        try{
          const trial=evaluate(area,p.cells,tuple.gate,tuple.descriptor,document,spatial,book,solid,keepout,charge,domain,baseSearch);charge.layoutTrialsCompleted++;
          candidates.push({candidateId:`${tuple.gate.gate.id}:${tuple.descriptor.axis}:${tuple.descriptor.offset}`,accepted:!!trial,reasonCodes:trial?[]:['LAYOUT_PROOF_REJECTED'],metrics:{potential:trial?.potential??tuple.descriptor.potential},conflictIds:[]});
          if(trial&&(!best||trial.potential>best.potential||trial.potential===best.potential&&(trial.plan.counters.unservedCells<best.plan.counters.unservedCells||trial.plan.counters.unservedCells===best.plan.counters.unservedCells&&trial.additionalAisle<best.additionalAisle))){best=trial;bestTuple=tuple;}
        }catch(error){
          if(error instanceof LayoutRejected){charge.layoutTrialsCompleted++;candidates.push({candidateId:`${tuple.gate.gate.id}:${tuple.descriptor.axis}:${tuple.descriptor.offset}`,accepted:false,reasonCodes:[error.reason],metrics:{potential:tuple.descriptor.potential},conflictIds:error.conflictIds});continue;}
          if(!(error instanceof ParkingBudgetExceeded))throw error;charge.layoutTrialsAborted++;stop=error.message;candidates.push({candidateId:`${tuple.gate.gate.id}:${tuple.descriptor.axis}:${tuple.descriptor.offset}`,accepted:false,reasonCodes:[error.message],metrics:{potential:tuple.descriptor.potential},conflictIds:[]});break;
        }
      }
      // Secondary-gate trials retain the chosen strip pattern and corridor. They
      // are charged to the same parent allocation, including aborted attempts.
      if(best&&bestTuple&&settings.maxGateCount===2&&p.cells.length>=256){
        const primary=best,descriptor=bestTuple.descriptor,first=primary.plan.gates[0];let tried=0,bestExit=Infinity,bestConnector=Infinity,secondOpening:Vec3|undefined;
        for(const candidate of p.gates){if(tried>=secondarySlots)break;const g=candidate.gate;
          if(g.id===first.id||g.inwardHeading===first.inwardHeading&&g.openingCells[0][g.inwardHeading%2?0:2]===first.openingCells[0][first.inwardHeading%2?0:2]||Math.abs(g.openingCells[0][0]-first.openingCells[0][0])+Math.abs(g.openingCells[0][2]-first.openingCells[0][2])<settings.minGateSeparationCells)continue;
          if(!charge.trial()){stop='SECOND_GATE_BUDGET_SKIPPED';break;}tried++;
          const trace:DecisionTrace['candidates'][number]={candidateId:`secondary:${g.id}`,accepted:false,reasonCodes:[],metrics:{stage:'secondary-gate'},conflictIds:[]};candidates.push(trace);
          try{
            const second=evaluate(area,p.cells,candidate,{...descriptor,aisle:primary.plan.aisleCells},document,spatial,book,solid,keepout,charge,domain,baseSearch);
            if(second){
              const gates=[...primary.plan.gates,...second.plan.gates].map(g=>({...g}));
              const combined=validateLayout(area,p.cells,descriptor,gates,sorted([...primary.plan.aisleCells,...second.plan.aisleCells]),document,spatial,book,solid,keepout,charge,domain,baseSearch);
              if(combined){let maximum=0;for(const state of primary.plan.reachableStates){const index=combined.stateIndex.get(stateKey(state));if(index===undefined||combined.exitDistances[index]<0)throw new LayoutRejected('PRIMARY_STATES_DISCONNECTED');maximum=Math.max(maximum,combined.exitDistances[index]);}
                const improvement=primary.maxExitDistance-maximum;trace.metrics.exitImprovement=improvement;trace.metrics.maximumExitTransitions=maximum;
                if(improvement>=4){trace.accepted=true;const connector=g.connectorCells.length;if(maximum<bestExit||maximum===bestExit&&(connector<bestConnector||connector===bestConnector&&(!secondOpening||compareCells(g.openingCells[0],secondOpening)<0))){best=combined;bestExit=maximum;bestConnector=connector;secondOpening=g.openingCells[0];}}
                else trace.reasonCodes=['INSUFFICIENT_EXIT_IMPROVEMENT'];
              }
            }
            if(!trace.accepted&&!trace.reasonCodes.length)trace.reasonCodes=['SECONDARY_LAYOUT_REJECTED'];charge.layoutTrialsCompleted++;
          }catch(error){if(error instanceof LayoutRejected){charge.layoutTrialsCompleted++;trace.reasonCodes=[error.reason];trace.conflictIds=error.conflictIds;continue;}if(!(error instanceof ParkingBudgetExceeded))throw error;charge.layoutTrialsAborted++;stop='SECOND_GATE_BUDGET_SKIPPED';trace.reasonCodes=[stop];break;}
        }
      }
      const plan=best?.plan??failed(area,p.cells,stop??candidates.find(c=>!c.accepted)?.reasonCodes[0]??'NO_VALID_CIRCULATION',allocation);
      if(stop&&!plan.reasonCodes.includes(stop))plan.reasonCodes.push(stop);
      plan.counters={...plan.counters,layoutCandidates:charge.layoutTrials,stateExpansions:charge.circulationUsed,rawLayoutDescriptors:tuples.length,layoutTrialsCompleted:charge.layoutTrialsCompleted,layoutTrialsAborted:charge.layoutTrialsAborted,boxChecks:solid.checks-startChecks};
      plan.traces=[{id:`circulation:${area.id}:${p.key}`,ownerId:area.id,ruleId:'parking-circulation',ruleVersion:'1.0.0',sourceRefs:[{kind:'parking',id:area.id}],selectedIds:best?[`${best.plan.gates[0].id}:${best.plan.axis}:${best.plan.offset}`,...best.plan.gates.slice(1).map(g=>`secondary:${g.id}`)]:[],candidates}];
      plans.push(plan);if(best)book=best.book;
    }
    areas.push({areaId:area.id,components:plans,ledger,excludedRoadCells,excludedSolidCells});
  }
  return {areas,book,domains};
}
