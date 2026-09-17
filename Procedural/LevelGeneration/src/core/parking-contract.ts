import type {Vec3} from './analysis';
import type {Heading,Reservation,DecisionTrace,ParkingBudgetAllocation,ParkingBudgetLedger} from './environment-contract';
import type {VehicleState} from './vehicle-motion';
export interface ParkingGate {
  id:string;areaId:string;openingCells:Vec3[];inwardHeading:Heading;connectorCells:Vec3[];
  roadStates:VehicleState[];entryStates:VehicleState[];exitStates:VehicleState[];crossingIds:string[];
}
export interface BayStrip {id:string;cells:Vec3[];exitHeading:Heading;rearWalkCells:Vec3[]}
export interface ParkingCirculationPlan {
  areaId:string;componentKey:string;status:'ok'|'partial'|'unplannable';axis:'X'|'Z';offset:number;periodCells:number;
  eligibleCells:Vec3[];incompleteBayCells:Vec3[];gates:ParkingGate[];aisleCells:Vec3[];walkCells:Vec3[];crossings:{id:string;cells:Vec3[]}[];bayStrips:BayStrip[];
  reachableStates:VehicleState[];reservations:Reservation[];traces:DecisionTrace[];budget:ParkingBudgetAllocation;
  reasonCodes:string[];
  counters:{layoutCandidates:number;stateExpansions:number;unservedCells:number;rawLayoutDescriptors:number;layoutTrialsCompleted:number;layoutTrialsAborted:number;potentialStalls:number;boxChecks:number;proofEdgeChecks:number};
}
export interface ParkingCirculationArea {
  areaId:string;components:ParkingCirculationPlan[];
  ledger:ParkingBudgetLedger&{unscheduled:{componentKey:string;reason:string;required:number}[]};
  excludedRoadCells:Vec3[];excludedSolidCells:Vec3[];
}
export interface ParkingStall {
  id:string;areaId:string;cells:Vec3[];rear:Vec3;heading:Heading;walkAccessCell:Vec3;
  entryPath:VehicleState[];exitPath:VehicleState[];gateIds:{entry:string;exit:string};traceId:string;
}
export interface ParkingQualityMetrics {
  areaId:string;componentKey:string;inputCells:number;eligibleCells:number;excludedRoadCells:number;excludedSolidCells:number;
  vehicleCellsInArea:number;walkOnlyCellsInArea:number;crossingCells:number;externalConnectorCells:number;stallCells:number;unallocatedCells:number;
  potentialStalls:number;acceptedStalls:number;untestedStalls:number;primaryRejectionCounts:Record<string,number>;unallocatedPrimaryReasonCounts:Record<string,number>;
  aisleRatio:number|null;stallAreaRatio:number|null;acceptanceRatio:number|null;gateCount:number;circulationUsed:number;stallReserved:number;stallUsed:number;
}
export interface ParkingPlan {
  areaId:string;circulation:ParkingCirculationPlan;stalls:ParkingStall[];unallocatedCells:Vec3[];
  rowEnds:{cell:Vec3;heading:Heading;rowId:string}[];reservations:Reservation[];traces:DecisionTrace[];quality:ParkingQualityMetrics;
  counters:{potentialStalls:number;acceptedStalls:number;stateExpansions:number;graphBuilds:number;bfsPasses:number;maxLocalStates:number;proofEdgeChecks:number;boundsChecks:number};
  reasonCodes:string[];
}
export interface ParkingAreaPlan {areaId:string;plans:ParkingPlan[];quality:ParkingQualityMetrics}
