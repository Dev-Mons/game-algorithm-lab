import type { Vec3 } from "./analysis";
import type { VolumeAnalysis } from "./regions";
import type { SelectionOptions } from "./selection";
import type { GenerationResult } from "./generate";
import type { BuildingContextPlan } from "./environment-contract";
import type { DeepReadonly } from "./rule-spatial-contract";
export type RuleData = Record<string, string | number | boolean>;
export interface BuildingRuleReference {
  id: string;
  version: string;
  definition: RuleData;
  metadata: RuleData;
}
export interface BuildingRuleInput {
  componentId: string;
  cells: Vec3[];
  analysis: VolumeAnalysis;
  options: SelectionOptions;
  metadata: RuleData;
  context: DeepReadonly<BuildingContextPlan>;
}
export interface BuildingGenerationRule {
  id: string;
  version: string;
  label: string;
  definition: RuleData;
  validateMetadata(metadata: RuleData): void;
  generate(input: BuildingRuleInput): GenerationResult;
}
