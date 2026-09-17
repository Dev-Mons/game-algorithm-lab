import { resolveBuildingRule, ruleReference, type BuildingRuleReference } from "./building-rules";
import { adapterReferenceFor, resolveRuleSpatialAdapter } from "./rule-spatial-adapters";
import type { SpatialAdapterReference } from "./rule-spatial-contract";
import { BUILDING_USES, type BuildingDesignV1, type BuildingUse } from "./environment-contract";
import { cloneJSON, exactKeys } from "./canonical";
import { add, BASES, cellId, compareCells, DIRECTIONS, normalizeGrid, type Vec3 } from "./analysis";
import { validateBuildingStyle, type BuildingStyle } from "./building-style";

export interface BuildingMetadata { componentId: string; theme?: BuildingStyle; rule?: BuildingRuleReference; design?: BuildingDesignV1; spatialAdapterRef?: SpatialAdapterReference }
export interface ResolvedBuildingMetadata extends BuildingMetadata { rule: BuildingRuleReference; design: BuildingDesignV1; spatialAdapterRef: SpatialAdapterReference }
export function buildingComponents(input: Vec3[]) {
  const cells = normalizeGrid(input), remaining = new Set(cells.map(cellId));
  const result: { id: string; cells: Vec3[] }[] = [];
  for (const root of cells) {
    if (!remaining.delete(cellId(root))) continue;
    const members = [root];
    for (let i = 0; i < members.length; i++) for (const d of DIRECTIONS) {
      const next = add(members[i], BASES[d].n);
      if (remaining.delete(cellId(next))) members.push(next);
    }
    result.push({ id: cellId(root), cells: members.sort(compareCells) });
  }
  return result;
}
export function validateBuildings(grid: Vec3[], metadata: BuildingMetadata[], defaultUse: BuildingUse = "generic"): ResolvedBuildingMetadata[] {
  if (!Array.isArray(metadata)) throw new Error("Invalid building metadata.");
  const components=buildingComponents(grid),ids = new Set(components.map(c => c.id)), seen = new Set<string>();
  for (const entry of metadata) {
    if (!entry || !ids.has(entry.componentId) || seen.has(entry.componentId)) throw new Error("Invalid building component.");
    seen.add(entry.componentId);
    if (entry.theme !== undefined) validateBuildingStyle(entry.theme);
    if (entry.rule !== undefined) resolveBuildingRule(entry.rule);
    if (Object.keys(entry).some(k => !["componentId", "theme", "rule", "design", "spatialAdapterRef"].includes(k))) throw new Error("Unknown building metadata.");
  }
  return components.map(component => {
    const entry = metadata.find(m => m.componentId === component.id);
    const rule = entry?.rule ?? ruleReference("standard-contextual");
    const spatialAdapterRef = entry?.spatialAdapterRef ?? adapterReferenceFor(rule);
    resolveRuleSpatialAdapter(rule, spatialAdapterRef);
    const design = entry?.design ?? {version:1 as const,use:defaultUse,anchor:component.cells[0]};
    exactKeys(design,["version","use","anchor"]);
    if (design.version !== 1 || !BUILDING_USES.includes(design.use)) throw new Error("INVALID_BUILDING_DESIGN");
    normalizeGrid([design.anchor]);
    return cloneJSON({...entry,componentId:component.id,rule,spatialAdapterRef,design});
  });
}
// Rank by PRE-edit volume, then numeric lexicographic minimum cell. New bridge cells never vote.
export function inheritBuildings(oldGrid: Vec3[], grid: Vec3[], metadata: BuildingMetadata[]) {
  const old = buildingComponents(oldGrid).sort((a,b) => b.cells.length-a.cells.length || compareCells(a.cells[0], b.cells[0]));
  const owner = new Map(old.flatMap(c => c.cells.map(cell => [cellId(cell), c.id] as const)));
  return buildingComponents(grid).flatMap(c => {
    const ancestors = new Set(c.cells.map(cell => owner.get(cellId(cell))));
    const winner = old.find(o => ancestors.has(o.id));
    const entry = metadata.find(m => m.componentId === winner?.id);
    return entry ? [{ ...entry, componentId: c.id }] : [];
  });
}
