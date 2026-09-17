import type { ScenePlacement } from "./scene-inputs";
import type { EnvironmentResult } from "./environment-contract";
import { analyzeVolume } from "./regions";
import { selectTiles, type SelectionOptions } from "./selection";
import type {ModulePlacement,AssembledResult} from "./modules";
export * from "./analysis";
export * from "./selection";
export * from "./regions";
export * from "./modules";

export function generate(input: unknown, options: SelectionOptions = {}) {
  const result=selectTiles(analyzeVolume(input,options.rolePolicy),options);
  return {...result,modules:[] as ModulePlacement[],counters:{...result.counters,moduleCount:0,attachmentCount:0,ownedFaceCount:result.surfaces.length}};
}
export type GenerationResult = ReturnType<typeof generate> & { scenePlacements?: ScenePlacement[]; environment?: EnvironmentResult };
