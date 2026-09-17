import {compareCells,type Vec3} from './analysis';
import {PARKING_BUDGET} from './environment-settings';
import type {ParkingBudgetAllocation,ParkingBudgetLedger} from './environment-contract';
export interface BudgetComponent {componentKey:string;minimum:Vec3;stateCellBound:number;eligibleCells:number;trialCapacity:number;gateCount:number}
export interface BudgetAdmission {componentKey:string;reason:string;required:number}
export function allocateParkingBudget(areaId:string,components:BudgetComponent[]):ParkingBudgetLedger & {unscheduled:BudgetAdmission[]} {
  const allocations:ParkingBudgetAllocation[]=[],unscheduled:BudgetAdmission[]=[],ordered=[...components].sort((a,b)=>compareCells(a.minimum,b.minimum));
  let remaining=PARKING_BUDGET.stallLimit;
  for(const c of ordered){const upper=3*(4*c.stateCellBound)+32*Math.floor(c.eligibleCells/2);
    if(allocations.length>=128){unscheduled.push({componentKey:c.componentKey,reason:'LAYOUT_COMPONENT_LIMIT',required:upper});continue;}
    if(upper>remaining){unscheduled.push({componentKey:c.componentKey,reason:'STALL_BUDGET_NOT_RESERVED',required:upper});continue;}
    remaining-=upper;allocations.push({componentKey:c.componentKey,layoutTickets:0,circulationLimit:0,stallLimit:upper,stallStateUpperBound:upper});
  }
  const capacity=new Map(ordered.map(c=>[c.componentKey,c.trialCapacity]));let tickets=128;
  while(tickets){let allocated=false;for(const a of allocations)if(tickets&&a.layoutTickets<(capacity.get(a.componentKey)??0)){a.layoutTickets++;tickets--;allocated=true;}if(!allocated)break;}
  const total=allocations.reduce((n,a)=>n+a.layoutTickets,0);
  if(total){let remainder=PARKING_BUDGET.circulationLimit;for(const a of allocations){a.circulationLimit=Math.floor(PARKING_BUDGET.circulationLimit*a.layoutTickets/total);remainder-=a.circulationLimit;}for(let i=0;remainder>0;i++,remainder--)allocations[i%allocations.length].circulationLimit++;}
  return {...PARKING_BUDGET,areaId,allocations,unscheduled};
}
export class ParkingBudgetExceeded extends Error {constructor(readonly stage:'circulation'|'stall'){super(stage==='circulation'?'CIRCULATION_BUDGET_EXCEEDED':'STALL_BUDGET_CONTRACT_VIOLATION');}}
export class ParkingCharge {
  circulationUsed=0;stallUsed=0;layoutTrials=0;layoutTrialsCompleted=0;layoutTrialsAborted=0;
  constructor(readonly allocation:ParkingBudgetAllocation){}
  circulation=()=>{if(this.circulationUsed>=this.allocation.circulationLimit)throw new ParkingBudgetExceeded('circulation');this.circulationUsed++;};
  stall=()=>{if(this.stallUsed>=this.allocation.stallLimit)throw new ParkingBudgetExceeded('stall');this.stallUsed++;};
  trial(){if(this.layoutTrials>=this.allocation.layoutTickets)return false;this.layoutTrials++;return true;}
}
