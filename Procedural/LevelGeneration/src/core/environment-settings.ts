import {immutableJSON} from './canonical';

// Engine dimensions and budgets, not document-editable settings.
export interface EnvironmentSettings {
  access: { maxWalkDistanceCells: number; curbBandCells: 1; pedestrianWidth16: number; pedestrianHeight16: number };
  entrances: { maxCount: number; facadeCellsPerEntry: number; volumeCellsPerEntry: number; minGapCells: number };
  parking: { vehicleProfile: 'grid-car-v1'; aisleWidthCells: number; stallWidthCells: 1; stallDepthCells: 2; pedestrianStripCells: 1; maxConnectorDistanceCells: number; maxGateCount: number; minGateSeparationCells: number };
  fixtures: { restIntervalCells: number; streetIntervalCells: number; lightIntervalCells: number; hydrantIntervalCells: number; vegetationRadiusCells: number; roadsideRadiusCells: number; intersectionKeepoutCells: number; maxClusterItems: number };
}
export const PARKING_BUDGET = Object.freeze({ policy: 'parking-budget-v1', circulationLimit: 1500000, stallLimit: 500000, layoutTrialLimit: 128 } as const);
export const ENVIRONMENT:EnvironmentSettings=immutableJSON({
  access: { maxWalkDistanceCells: 24, curbBandCells: 1, pedestrianWidth16: 8, pedestrianHeight16: 12 },
  entrances: { maxCount: 4, facadeCellsPerEntry: 12, volumeCellsPerEntry: 128, minGapCells: 4 },
  parking: { vehicleProfile: 'grid-car-v1', aisleWidthCells: 4, stallWidthCells: 1, stallDepthCells: 2, pedestrianStripCells: 1, maxConnectorDistanceCells: 4, maxGateCount: 2, minGateSeparationCells: 8 },
  fixtures: { restIntervalCells: 4, streetIntervalCells: 4, lightIntervalCells: 6, hydrantIntervalCells: 8, vegetationRadiusCells: 3, roadsideRadiusCells: 2, intersectionKeepoutCells: 2, maxClusterItems: 2 },
});
