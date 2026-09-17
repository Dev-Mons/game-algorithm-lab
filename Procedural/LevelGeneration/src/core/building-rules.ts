import {CONTEXTUAL_BUILDING_RULE,CONTEXTUAL_SPATIAL_ADAPTER} from "./contextual-building-rule";
import { registerRuleSpatialAdapter } from "./rule-spatial-adapters";
import { PARKING_RULE } from "./parking-rule";
import type {
  BuildingGenerationRule,
  BuildingRuleReference,
  RuleData,
} from "./building-rule-contract";
export type {
  BuildingGenerationRule,
  BuildingRuleReference,
  BuildingRuleInput,
  RuleData,
} from "./building-rule-contract";
const registry = new Map<string, BuildingGenerationRule>();
const dataKey = (data: RuleData) =>
  JSON.stringify(
    Object.entries(data).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
export function registerBuildingRule(rule: BuildingGenerationRule) {
  if (
    !/^[a-z][a-z0-9-]*$/.test(rule.id) ||
    !/^\d+\.\d+\.\d+$/.test(rule.version) ||
    registry.has(rule.id)
  )
    throw new Error("Invalid or duplicate building rule registration.");
  registry.set(rule.id, rule);
}
registerBuildingRule(CONTEXTUAL_BUILDING_RULE);
registerRuleSpatialAdapter(CONTEXTUAL_SPATIAL_ADAPTER);
registerBuildingRule(PARKING_RULE);
export function buildingRules() {
  return [...registry.values()];
}
export function ruleReference(
  id: string,
  metadata: RuleData = {},
): BuildingRuleReference {
  const rule = registry.get(id);
  if (!rule) throw new Error(`Unknown building rule: ${id}`);
  rule.validateMetadata(metadata);
  return {
    id: rule.id,
    version: rule.version,
    definition: { ...rule.definition },
    metadata: { ...metadata },
  };
}
export function resolveBuildingRule(ref: BuildingRuleReference) {
  const rule = registry.get(ref?.id);
  if (!rule) throw new Error(`Unknown building rule: ${ref?.id}`);
  if (ref.version !== rule.version)
    throw new Error(
      `Unsupported building rule version: ${ref.id}@${ref.version}`,
    );
  if (!ref.definition || dataKey(ref.definition) !== dataKey(rule.definition))
    throw new Error(`Incompatible building rule definition: ${ref.id}`);
  if (
    !ref.metadata ||
    Array.isArray(ref.metadata) ||
    typeof ref.metadata !== "object" ||
    Object.keys(ref).some(
      (k) => !["id", "version", "definition", "metadata"].includes(k),
    )
  )
    throw new Error("Invalid building rule metadata.");
  rule.validateMetadata(ref.metadata);
  return rule;
}
