import { cloneJSON, exactKeys } from "./canonical";

export interface EnvironmentSettings {
  version: 1;
  units: { metersPerCell?: number };
  access: { maxWalkDistanceCells: number; curbBandCells: 1; pedestrianWidth16: number; pedestrianHeight16: number };
  entrances: { maxCount: number; facadeCellsPerEntry: number; volumeCellsPerEntry: number; minGapCells: number };
  parking: { vehicleProfile: "grid-car-v1"; aisleWidthCells: number; stallWidthCells: 1; stallDepthCells: 2; pedestrianStripCells: 1; maxConnectorDistanceCells: number; maxGateCount: number; minGateSeparationCells: number };
  fixtures: { restIntervalCells: number; streetIntervalCells: number; lightIntervalCells: number; hydrantIntervalCells: number; vegetationRadiusCells: number; roadsideRadiusCells: number; intersectionKeepoutCells: number; maxClusterItems: number };
}
export const PARKING_BUDGET = Object.freeze({ policy: "parking-budget-v1", circulationLimit: 1500000, stallLimit: 500000, layoutTrialLimit: 128 } as const);
const defaults: EnvironmentSettings = {
  version: 1, units: {},
  access: { maxWalkDistanceCells: 24, curbBandCells: 1, pedestrianWidth16: 8, pedestrianHeight16: 12 },
  entrances: { maxCount: 4, facadeCellsPerEntry: 12, volumeCellsPerEntry: 128, minGapCells: 4 },
  parking: { vehicleProfile: "grid-car-v1", aisleWidthCells: 4, stallWidthCells: 1, stallDepthCells: 2, pedestrianStripCells: 1, maxConnectorDistanceCells: 4, maxGateCount: 2, minGateSeparationCells: 8 },
  fixtures: { restIntervalCells: 4, streetIntervalCells: 4, lightIntervalCells: 6, hydrantIntervalCells: 8, vegetationRadiusCells: 3, roadsideRadiusCells: 2, intersectionKeepoutCells: 2, maxClusterItems: 2 },
};
export const ENVIRONMENT_RANGES = {
  access: { maxWalkDistanceCells: [1,64], curbBandCells: [1,1], pedestrianWidth16: [4,16], pedestrianHeight16: [8,32] },
  entrances: { maxCount: [1,8], facadeCellsPerEntry: [4,32], volumeCellsPerEntry: [16,4096], minGapCells: [2,16] },
  parking: { aisleWidthCells: [4,8], stallWidthCells: [1,1], stallDepthCells: [2,2], pedestrianStripCells: [1,1], maxConnectorDistanceCells: [0,8], maxGateCount: [1,2], minGateSeparationCells: [4,16] },
  fixtures: { restIntervalCells: [3,12], streetIntervalCells: [3,12], lightIntervalCells: [4,16], hydrantIntervalCells: [6,24], vegetationRadiusCells: [1,8], roadsideRadiusCells: [1,4], intersectionKeepoutCells: [1,4], maxClusterItems: [1,2] },
} as const;
export function defaultEnvironmentSettings(): EnvironmentSettings { return cloneJSON(defaults); }
export function validateEnvironmentSettings(value: unknown): EnvironmentSettings {
  exactKeys(value, Object.keys(defaults));
  if (value.version !== 1) throw new Error("UNSUPPORTED_ENVIRONMENT_VERSION");
  exactKeys(value.units, [], ["metersPerCell"]);
  const meters = value.units.metersPerCell;
  if (meters !== undefined && (typeof meters !== "number" || !Number.isFinite(meters) || meters <= 0)) throw new Error("INVALID_METERS_PER_CELL");
  for (const group of Object.keys(ENVIRONMENT_RANGES) as (keyof typeof ENVIRONMENT_RANGES)[]) {
    exactKeys(value[group], Object.keys(defaults[group]));
    const values = value[group] as Record<string, unknown>;
    for (const [key, [min, max]] of Object.entries(ENVIRONMENT_RANGES[group])) {
      const n = values[key];
      if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) throw new Error(`INVALID_ENVIRONMENT_SETTING:${group}.${key}`);
    }
  }
  if ((value.parking as Record<string,unknown>).vehicleProfile !== "grid-car-v1") throw new Error("UNSUPPORTED_VEHICLE_PROFILE");
  return cloneJSON(value) as unknown as EnvironmentSettings;
}
