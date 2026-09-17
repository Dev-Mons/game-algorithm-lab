import type { Vec3 } from "./analysis";
import type { VolumeAnalysis } from "./regions";
import type { SelectionOptions } from "./selection";
import type { RuleData } from "./building-rule-contract";
import type { Box16, BuildingDesignV1 } from "./environment-contract";

export type DeepReadonly<T> = T extends (...args: never[]) => unknown ? T : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;
export interface SpatialAdapterReference { id: string; version: string; definition: RuleData }
export interface RulePreflightInput {
  componentId: string; cells: Vec3[]; analysis: VolumeAnalysis;
  options: Omit<SelectionOptions,"context">; metadata: RuleData; design: BuildingDesignV1;
}
export interface RuleSpatialEnvelope {
  version: 1; requiredBoxes16: Box16[]; deferredAttachmentBounds16: Box16[];
  supportedAssetKeys: string[]; diagnostics: { code: string; message: string }[];
}
export interface RuleSpatialAdapter {
  reference: SpatialAdapterReference;
  ruleId: string; ruleVersion: string; ruleDefinition: RuleData;
  describeEnvelope(input: DeepReadonly<RulePreflightInput>): RuleSpatialEnvelope;
}
