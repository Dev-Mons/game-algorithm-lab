import {cellId,type Vec3} from './analysis';
import type {Reservation,ParkingAreaInput} from './environment-contract';
import type {ParkingCirculationPlan,ParkingQualityMetrics,ParkingStall,ParkingPlan,ParkingCirculationArea} from './parking-contract';
const set=(cells:Vec3[])=>new Set(cells.map(cellId));
export function parkingQuality(circulation:ParkingCirculationPlan,stalls:ParkingStall[],reservations:Reservation[],rejected:Record<string,number>,used:number,rejectedCells:Record<string,string>={}):{quality:ParkingQualityMetrics;unallocatedCells:Vec3[]}{
  const incomplete=set(circulation.incompleteBayCells),P=set(circulation.eligibleCells),V=set(reservations.filter(r=>r.kind==='vehicle-aisle'||r.kind==='public-vehicle').flatMap(r=>r.cells).filter(c=>P.has(cellId(c))));
  const W=set(reservations.filter(r=>r.kind==='walk'||r.kind==='entrance').flatMap(r=>r.cells).filter(c=>P.has(cellId(c)))),S=set(stalls.flatMap(s=>s.cells));
  if([...S].some(k=>V.has(k)||W.has(k)))throw new Error('PARKING_QUALITY_OVERLAP');
  const unallocatedCells=circulation.eligibleCells.filter(c=>!V.has(cellId(c))&&!W.has(cellId(c))&&!S.has(cellId(c))),reasons:Record<string,number>={};
  const unscheduled=circulation.reasonCodes.some(c=>c==='STALL_BUDGET_NOT_RESERVED'||c==='LAYOUT_COMPONENT_LIMIT');
  for(const c of unallocatedCells){let reason=unscheduled?'UNSCHEDULED_BUDGET':!circulation.gates.length?'NO_CIRCULATION':incomplete.has(cellId(c))?'INCOMPLETE_BAY_DEPTH':'LAYOUT_REMAINDER';
    const rejection=rejectedCells[cellId(c)];
    if(rejection)reason=rejection.startsWith('NO_VEHICLE')?'VEHICLE_PROOF_REJECTED':rejection==='RESERVED_ACCESS'?'RESERVED_ACCESS':'LAYOUT_REMAINDER';
    reasons[reason]=(reasons[reason]??0)+1;
  }
  const crossing=[...W].filter(k=>V.has(k)).length,walkOnly=W.size-crossing,potential=circulation.bayStrips.length;
  const external=set(circulation.gates.flatMap(g=>g.connectorCells).filter(c=>!P.has(cellId(c))));
  const quality:ParkingQualityMetrics={areaId:circulation.areaId,componentKey:circulation.componentKey,inputCells:P.size,eligibleCells:P.size,excludedRoadCells:0,excludedSolidCells:0,vehicleCellsInArea:V.size,walkOnlyCellsInArea:walkOnly,crossingCells:crossing,externalConnectorCells:external.size,stallCells:S.size,unallocatedCells:unallocatedCells.length,potentialStalls:potential,acceptedStalls:stalls.length,untestedStalls:0,primaryRejectionCounts:rejected,unallocatedPrimaryReasonCounts:reasons,aisleRatio:P.size?V.size/P.size:null,stallAreaRatio:P.size?S.size/P.size:null,acceptanceRatio:potential?stalls.length/potential:null,gateCount:circulation.gates.length,circulationUsed:circulation.counters.stateExpansions,stallReserved:circulation.budget.stallLimit,stallUsed:used};
  if(quality.eligibleCells!==quality.vehicleCellsInArea+quality.walkOnlyCellsInArea+quality.stallCells+quality.unallocatedCells||potential!==stalls.length+Object.values(rejected).reduce((n,v)=>n+v,0))throw new Error('PARKING_QUALITY_ACCOUNTING_VIOLATION');
  return {quality,unallocatedCells};
}
export function areaParkingQuality(area:ParkingAreaInput,circulation:ParkingCirculationArea,plans:ParkingPlan[]):ParkingQualityMetrics {
  const total:ParkingQualityMetrics={areaId:area.id,componentKey:'all',inputCells:area.cells.length,eligibleCells:0,excludedRoadCells:circulation.excludedRoadCells.length,excludedSolidCells:circulation.excludedSolidCells.length,vehicleCellsInArea:0,walkOnlyCellsInArea:0,crossingCells:0,externalConnectorCells:0,stallCells:0,unallocatedCells:0,potentialStalls:0,acceptedStalls:0,untestedStalls:0,primaryRejectionCounts:{},unallocatedPrimaryReasonCounts:{},aisleRatio:null,stallAreaRatio:null,acceptanceRatio:null,gateCount:0,circulationUsed:0,stallReserved:0,stallUsed:0};
  for(const p of plans){const q=p.quality;for(const key of ['eligibleCells','vehicleCellsInArea','walkOnlyCellsInArea','crossingCells','externalConnectorCells','stallCells','unallocatedCells','potentialStalls','acceptedStalls','untestedStalls','gateCount','circulationUsed','stallReserved','stallUsed'] as const)total[key]+=q[key];
    for(const field of ['primaryRejectionCounts','unallocatedPrimaryReasonCounts'] as const)for(const [reason,count] of Object.entries(q[field]))total[field][reason]=(total[field][reason]??0)+count;
  }
  const inputMask=set(area.cells);
  total.externalConnectorCells=set(plans.flatMap(p=>p.circulation.gates.flatMap(g=>g.connectorCells)).filter(c=>!inputMask.has(cellId(c)))).size;
  total.aisleRatio=total.eligibleCells?total.vehicleCellsInArea/total.eligibleCells:null;total.stallAreaRatio=total.eligibleCells?total.stallCells/total.eligibleCells:null;total.acceptanceRatio=total.potentialStalls?total.acceptedStalls/total.potentialStalls:null;
  if(total.inputCells!==total.eligibleCells+total.excludedRoadCells+total.excludedSolidCells)throw new Error('PARKING_INPUT_ACCOUNTING_VIOLATION');
  return total;
}
