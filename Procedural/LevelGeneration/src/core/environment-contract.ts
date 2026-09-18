import type { Vec3 } from "./analysis";
import type { RuleSpatialEnvelope } from "./rule-spatial-contract";

export type BuildingUse = "generic" | "retail" | "office" | "residential" | "industrial";
export const BUILDING_USES: BuildingUse[] = ["generic", "retail", "office", "residential", "industrial"];
export type Heading = 0 | 1 | 2 | 3;
export const HEADING_VECTORS: readonly Vec3[] = [[0,0,1],[1,0,0],[0,0,-1],[-1,0,0]];
export interface BuildingDesignV1 { version: 1; use: BuildingUse; anchor: Vec3; designSeed?:number; overrides?:import('./design-profile').DesignOverrides;columnMode?:'auto'|'building'|'column' }
export interface ParkingAreaInput { id: string; cells: Vec3[]; anchor: Vec3 }
export interface Box16 { min: Vec3; max: Vec3 }
export interface SourceRef { kind: "building" | "object" | "road" | "parking"; id: string }
export interface Reservation {
  id: string; ownerId: string; sourceRefs: SourceRef[];
  kind: "solid" | "public-vehicle" | "walk" | "vehicle-aisle" | "entrance" | "stall" | "safety" | "lighting" | "fixture" | "attachment";
  priority: 1000 | 900 | 800 | 700 | 600 | 500 | 400 | 300 | 200;
  cells: Vec3[]; boxes16: Box16[]; crossingId?: string;
}
export interface CandidateTrace {
  candidateId: string; accepted: boolean; reasonCodes: string[];
  metrics: Record<string, number | string | boolean>; conflictIds: string[];
}
export interface DecisionTrace {
  id: string; ownerId: string; ruleId: string; ruleVersion: string;
  sourceRefs: SourceRef[]; selectedIds: string[]; candidates: CandidateTrace[];
}
export interface ParkingBudgetAllocation {
  componentKey: string; layoutTickets: number; circulationLimit: number;
  stallLimit: number; stallStateUpperBound: number;
}
export interface ParkingBudgetLedger {
  policy: "parking-budget-v1"; areaId: string;
  circulationLimit: 1500000; stallLimit: 500000; layoutTrialLimit: 128;
  allocations: ParkingBudgetAllocation[];
}
export interface InputDelta {
  buildingCells: Vec3[]; roadCells: Vec3[]; objectIds: string[];
  parkingIds: string[]; settingKeys: string[];
}
/** Plans are added by their owning stages. Missing is distinct from an empty plan. */
export interface BuildingContextPlan {
  design: BuildingDesignV1;
  sourceRefs: SourceRef[];
  reservations: Reservation[];
  envelope: RuleSpatialEnvelope;
  verticalBands?: Omit<import("./vertical-design").VerticalPlan,"traces"> & {traces?:DecisionTrace[]};
  entrances?: Omit<import("./entrance-contract").EntrancePlan,"traces"|"reservations"> & {traces?:DecisionTrace[];reservations?:Reservation[]};
  facadePlan?:import('./facade-plan').FacadePlan;
  facadeChanges?:import('./wall-facilities').WallFacilityPlan['changes'];
  columns?:import('./column-prototype').ColumnPlan;
}
export type EnvironmentStage = "preflight" | "vertical" | "spatial" | "parkingCirculation" | "entrances" | "parkingStalls" | "facade" | "fixtures" | "attachments";
export type StageState = "ready" | "not-applicable" | "not-implemented" | "blocked";
export interface StageReport { stage: EnvironmentStage; state: StageState; reasonCodes: string[] }
export interface EnvironmentResult {
  stages: StageReport[];
  preflight: {buildingId:string; envelope:RuleSpatialEnvelope}[];
  reservations: Reservation[];
  traces: DecisionTrace[];
  counters: {preflightCalls:number;generationCalls:number};
  overlays?: {id:string;sourceRefs:SourceRef[];boxes16?:Box16[];path?:Vec3[];color?:string}[];
  spatial?: import("./spatial-analysis").SpatialAnalysis;
  vertical?: import("./vertical-design").VerticalPlan[];
  facades?:import('./facade-plan').FacadePlan[];
  wallFacilities?:import('./wall-facilities').WallFacilityPlan;
  columns?:import('./column-prototype').ColumnPlan[];
  parkingCirculation?: import("./parking-contract").ParkingCirculationArea[];
  entrances?: import("./entrance-contract").EntrancePlan[];
  parking?: import("./parking-contract").ParkingAreaPlan[];
  fixtures?: import("./fixture-plan").FixturePlan;
}
