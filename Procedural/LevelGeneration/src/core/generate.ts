import { analyzeVolume } from "./regions";
import { selectTiles, type SelectionOptions } from "./selection";
import { assembleModules } from "./modules";
export * from "./analysis";
export * from "./selection";
export * from "./regions";
export * from "./modules";

export function generate(input: unknown, options: SelectionOptions = {}) {
  return assembleModules(
    selectTiles(analyzeVolume(input, options.rolePolicy), options),
    options,
  );
}
export type GenerationResult = ReturnType<typeof generate>;
