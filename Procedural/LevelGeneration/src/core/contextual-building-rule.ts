import { describeContextualEnvelope } from './contextual-envelope';
import type { GenerationResult } from './generate';
import { immutableJSON } from './canonical';
import type { BuildingRuleInput } from './building-rule-contract';
import { applyFacadeStyle } from './facade-patterns';
import type { BuildingGenerationRule } from './building-rule-contract';
import type { RuleSpatialAdapter } from './rule-spatial-contract';
import { selectTiles, DEFAULT_RULES, hash33, type FaceTrace } from './selection';

import { faceCenter2 } from './analysis';

import type { Surface } from './analysis';

export const CONTEXTUAL_RULE_DEFINITION = {
  pipeline: 'environment-contextual-v1',
  portals: 'planned',
  facade: 'banded',
};
const decisionKey = (surface: Pick<Surface, 'role' | 'direction' | 'wallKind' | 'architecture'>) =>
  `${surface.role}:${surface.direction}:${surface.wallKind ?? ''}:${surface.architecture && surface.architecture.interpretation !== 'unsupported' ? 'supported' : 'basic'}`;
const decisionSurfaces = (input: BuildingRuleInput) => [
  ...new Map(input.analysis.surfaces.map((s) => [decisionKey(s), s])).values(),
];
/** Evaluate representative panel decisions once per building execution. */
export function contextualTemplates(input: BuildingRuleInput): FaceTrace[] {
  const surfaces = decisionSurfaces(input);
  const supportedRules = input.options.rules?.filter((r) => r.predicate === 'supported') ?? [];
  return immutableJSON(
    selectTiles(
      { ...input.analysis, surfaces },
      {
        ...input.options,
        architecture: undefined,
        rules: input.analysis.diagnostics.length ? [...supportedRules, ...DEFAULT_RULES] : supportedRules,
        context: input.context,
      },
    ).traces,
  );
}
export function contextualBase(
  input: BuildingRuleInput,
  templates = contextualTemplates(input),
): ReturnType<typeof selectTiles> {
  const decisions = new Map(templates.map((t) => [decisionKey(t), t]));
  const traces = input.analysis.surfaces.map((surface) =>
    expandPanelDecision(surface, decisions.get(decisionKey(surface))!, input.options.seed ?? 0),
  );
  const placements = traces.map((t, i) => ({
    placementId: `p:${t.faceId}`,
    faceId: t.faceId,
    tileId: t.selection.tileId,
    position2: faceCenter2(input.analysis.surfaces[i].cell, t.direction),
    orientationId: t.direction,
    ruleId: t.selection.ruleId,
  }));
  return {
    ...input.analysis,
    status: input.analysis.diagnostics.length ? ('degraded' as const) : ('ok' as const),
    placements,
    traces,
    diagnostics: [...input.analysis.diagnostics],
    counters: {
      ...input.analysis.counters,
      ruleEvaluations: traces.reduce((n, t) => n + t.rules.length, 0),
      fallbackCount: 0,
      placementCount: placements.length,
    },
  };
}
export function contextualOutput(
  input: BuildingRuleInput,
  base: ReturnType<typeof selectTiles>,
): GenerationResult {
  if (!input.context.entrances || !input.context.verticalBands)
    throw new Error('CONTEXTUAL_BUILDING_PLAN_REQUIRED');
  const result = applyFacadeStyle(base, { ...input.options, context: input.context });
  return {
    ...result,
    modules: [],
    counters: {
      ...result.counters,
      moduleCount: 0,
      attachmentCount: 0,
      ownedFaceCount: result.surfaces.length,
    },
  };
}
export const CONTEXTUAL_BUILDING_RULE: BuildingGenerationRule = {
  id: 'standard-contextual',
  version: '1.0.0',
  label: '환경 계획 건물',
  definition: CONTEXTUAL_RULE_DEFINITION,
  validateMetadata(metadata) {
    if (Object.keys(metadata).length) throw new Error('Contextual rule accepts no metadata.');
  },
  generate(input) {
    return contextualOutput(input, contextualBase(input));
  },
};
export const CONTEXTUAL_SPATIAL_ADAPTER: RuleSpatialAdapter = {
  reference: { id: 'contextual-envelope', version: '1.0.0', definition: { bounds: 'facade-descriptors-v1' } },
  ruleId: 'standard-contextual',
  ruleVersion: '1.0.0',
  ruleDefinition: CONTEXTUAL_RULE_DEFINITION,
  describeEnvelope: describeContextualEnvelope,
};

function expandPanelDecision(surface: Surface, template: FaceTrace, seed: number): FaceTrace {
  if (template.selection.candidateCount !== 1 || template.fallback)
    throw new Error('CONTEXTUAL_PANEL_CONTRACT');
  return {
    ...template,
    faceId: surface.faceId,
    componentId: surface.componentId,
    ...(surface.undersideKind ? { undersideKind: surface.undersideKind } : {}),
    ...(surface.architecture
      ? {
          architecture: {
            ...surface.architecture,
            palette: template.architecture!.palette,
            paletteHash: template.architecture!.paletteHash,
          },
        }
      : {}),
    selection: {
      ...template.selection,
      hash: hash33(seed, `${surface.faceId}|${template.selection.ruleId}`),
    },
  };
}
