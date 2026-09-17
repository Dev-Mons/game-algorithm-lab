import type {Vec3} from './analysis';
import type {Reservation,DecisionTrace} from './environment-contract';
export interface Entrance {
  id:string;buildingId:string;faceIds:string[];widthCells:1|2;role:'main'|'secondary'|'service';outward:'PX'|'NX'|'PZ'|'NZ';
  landingCells:Vec3[];pathCells:Vec3[];roadTargetCell:Vec3;roadFrontageId:string;traceId:string;
}
export interface EntrancePlan {
  buildingId:string;entrances:Entrance[];frontages:{direction:Entrance['outward'];plane:number}[];
  desiredCount:number;unmetCount:number;reservations:Reservation[];traces:DecisionTrace[];
}
