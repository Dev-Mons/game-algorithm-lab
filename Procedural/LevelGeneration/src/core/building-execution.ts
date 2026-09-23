import { immutableJSON } from './canonical';
import { documentOptions, type GenerationDocument } from './document';
import type { AnalysisComponent } from './analysis';
import type { VolumeAnalysis } from './regions';
import type { BuildingRuleInput } from './building-rule-contract';
import { resolveBuildingRule } from './building-rules';
import type { GenerationResult } from './generate';
import type { EnvironmentResult } from './environment-contract';
import type { ReservationBook } from './reservations';
import { envelopeIndex, assertOutputBounds } from './rule-spatial-adapters';
import { faceBounds16, faceAssetBounds, scenePlacementBounds16 } from './placement-bounds';

type BuildingEntry = GenerationDocument['buildings'][number];
export interface BuildingExecutionPlans {
  preflight: EnvironmentResult['preflight'];
  vertical: NonNullable<EnvironmentResult['vertical']>;
  entrances: NonNullable<EnvironmentResult['entrances']>;
  columns: NonNullable<EnvironmentResult['columns']>;
  facades: NonNullable<EnvironmentResult['facades']>;
  wallFacilities: EnvironmentResult['wallFacilities'];
  book: ReservationBook | undefined;
}

function indexBuildingPlans(plans: BuildingExecutionPlans) {
  return {
    vertical: new Map(plans.vertical.map((p) => [p.buildingId, p])),
    entrances: new Map(plans.entrances.map((p) => [p.buildingId, p])),
    columns: new Map(plans.columns.map((p) => [p.buildingId, p])),
    facades: new Map(plans.facades.map((p) => [p.buildingId, p])),
  };
}
function groupByComponent<T extends { componentId: string }>(values: readonly T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const group = groups.get(value.componentId) ?? [];
    group.push(value);
    groups.set(value.componentId, group);
  }
  return groups;
}
function prepareRuleInput(
  document: GenerationDocument,
  component: AnalysisComponent,
  entry: BuildingEntry,
  analysis: VolumeAnalysis,
  envelope: EnvironmentResult['preflight'][number]['envelope'],
  plans: BuildingExecutionPlans,
  index: ReturnType<typeof indexBuildingPlans>,
  surfaces: Map<string, VolumeAnalysis['surfaces']>,
  regions: Map<string, NonNullable<VolumeAnalysis['regions']>> | undefined,
): BuildingRuleInput {
  const { vertical, entrances, columns, facades } = index;
  const contextual = entry.rule.id === 'standard-contextual';
  const part = {
    ...analysis,
    ...(contextual ? { cells: component.cells, features: [] } : {}),
    surfaces: surfaces.get(component.id) ?? [],
    regions: regions?.get(component.id) ?? (analysis.regions ? [] : undefined),
  };
  const currentVertical = vertical.get(component.id),
    currentEntrances = entrances.get(component.id);
  let verticalBands: BuildingRuleInput['context']['verticalBands'] = currentVertical;
  let entrancePlan: BuildingRuleInput['context']['entrances'] = currentEntrances;
  if (contextual && currentVertical) {
    const { traces, ...geometry } = currentVertical;
    verticalBands = geometry;
  }
  if (contextual && currentEntrances) {
    const { traces, reservations, ...geometry } = currentEntrances;
    entrancePlan = geometry;
  }
  const ruleInput: BuildingRuleInput = {
    componentId: component.id,
    cells: component.cells,
    analysis: part,
    options: { ...documentOptions(document), architecture: entry.theme ?? document.buildingDefinition },
    metadata: entry.rule.metadata,
    context: {
      design: entry.design,
      columns: columns.get(component.id),
      facadeChanges: plans.wallFacilities?.changes,
      facadePlan: facades.get(component.id),
      sourceRefs: [{ kind: 'building', id: component.id }],
      reservations:
        plans.book?.snapshot(contextual ? new Set([`solid:building:${component.id}`]) : undefined) ?? [],
      envelope,
      verticalBands,
      entrances: entrancePlan,
    },
  };

  // Custom rules retain the full analysis and diagnostic/reservation context.
  // The stock rule receives only its geometry plans and own solid reservation.
  return immutableJSON(ruleInput);
}
function validateRuleOutput(
  result: GenerationResult,
  component: AnalysisComponent,
  envelope: EnvironmentResult['preflight'][number]['envelope'],
  tileLookup: ReadonlyMap<string, GenerationDocument['catalog']['tiles'][number]>,
  portalFaces: ReadonlySet<string>,
): void {
  const outputBounds = envelopeIndex(envelope);
  if (result.status === 'error') throw new Error('INVALID_BUILDING_OUTPUT');
  if (result.modules?.length) throw new Error('RULE_OUTPUT_BOUNDS_UNKNOWN');

  for (const p of result.placements) {
    const tile = tileLookup.get(p.tileId);
    if (!tile) throw new Error('RULE_OUTPUT_BOUNDS_UNKNOWN');
    assertOutputBounds(
      tile.assetKey,
      faceBounds16(faceAssetBounds(tile.assetKey), p.position2, p.orientationId),
      envelope,
      false,
      outputBounds,
    );
    if ((tile.assetKey.includes('portal-') || tile.assetKey.includes('entry')) && !portalFaces.has(p.faceId))
      throw new Error('UNPLANNED_PORTAL_OUTPUT');
  }
  for (const p of result.scenePlacements ?? []) {
    const bounds = scenePlacementBounds16(p);
    assertOutputBounds(p.asset, bounds, envelope, false, outputBounds);
    p.worldBounds16 = bounds;
    p.sourceRefs = [{ kind: 'building', id: component.id }];
    p.planId = `structure:${component.id}`;
    p.yawQuarterTurns ??= 0;
  }
}

/** Each registered rule uses the same prepare → execute → bounds/portal validation path. */
export function generateBuildings(
  document: GenerationDocument,
  analysis: VolumeAnalysis,
  components: readonly AnalysisComponent[],
  plans: BuildingExecutionPlans,
  tileLookup: ReadonlyMap<string, GenerationDocument['catalog']['tiles'][number]>,
): GenerationResult[] {
  const entries = new Map(document.buildings.map((b) => [b.componentId, b]));
  const envelopes = new Map(plans.preflight.map((p) => [p.buildingId, p.envelope]));
  const index = indexBuildingPlans(plans),
    surfaces = groupByComponent(analysis.surfaces),
    regions = analysis.regions ? groupByComponent(analysis.regions) : undefined;
  const generated: GenerationResult[] = [];
  for (const component of components) {
    const entry = entries.get(component.id)!,
      envelope = envelopes.get(component.id);
    if (!envelope) continue;
    const input = prepareRuleInput(
      document,
      component,
      entry,
      analysis,
      envelope,
      plans,
      index,
      surfaces,
      regions,
    );
    const result = resolveBuildingRule(entry.rule).generate(input);
    const portalFaces = new Set(index.entrances.get(component.id)?.entrances.flatMap((e) => e.faceIds) ?? []);
    validateRuleOutput(result, component, envelope, tileLookup, portalFaces);
    generated.push(result);
  }
  return generated;
}
