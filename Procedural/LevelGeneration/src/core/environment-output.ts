import type { GenerationDocument } from './document';
import type { VolumeAnalysis } from './regions';
import type { GenerationResult } from './generate';
import type { EnvironmentResult } from './environment-contract';
import type { Surface } from './analysis';
import { cellId } from './analysis';
import { completeBuildingFaces } from './building-output';
import type { FacadeTrimPlan } from './facade-trims';
import { environmentOverlays, type AccessProbe } from './environment-presentation';
import { parkingPlacements } from './parking-placement';
import { roadPlacements } from './roads';
import { vegetationPlacements } from './scene-inputs';
import { sceneBounds16 } from './placement-bounds';
import type { SupportIndex } from './scene-relations';

interface EnvironmentOutputInput {
  document: GenerationDocument;
  analysis: VolumeAnalysis;
  generated: readonly GenerationResult[];
  plans: Omit<EnvironmentResult, 'traces' | 'overlays'>;
  trims: FacadeTrimPlan | undefined;
  probes: readonly AccessProbe[];
  tileLookup: ReadonlyMap<string, GenerationDocument['catalog']['tiles'][number]>;
  faceLookup: ReadonlyMap<string, Surface>;
  support?: SupportIndex;
}
/** Publish accepted plans; this step makes no rule or reservation decisions. */
export function assembleEnvironmentResult(input: EnvironmentOutputInput): GenerationResult {
  const { document, analysis, generated, plans, trims, probes, tileLookup, faceLookup } = input;
  const {
    vertical = [],
    entrances = [],
    fixtures,
    parking,
    wallFacilities,
    parkingCirculation: circulation,
    spatial,
  } = plans;
  const placements = completeBuildingFaces(generated, trims, tileLookup),
    modules = generated.flatMap((r) => r.modules ?? []);
  const result: GenerationResult = {
    ...analysis,
    status: analysis.diagnostics.length ? 'degraded' : 'ok',
    placements,
    modules,
    traces: generated.flatMap((r) => r.traces),
    scenePlacements: [
      ...(wallFacilities?.placements ?? []),
      ...(fixtures?.placements ?? []),
      ...parkingPlacements(parking ?? []),
      ...generated.flatMap((r) => r.scenePlacements ?? []),
      ...roadPlacements(document.sceneInputs.roads,plans.relations?.roads.map(r=>r.module)),
      ...(spatial
        ? vegetationPlacements(
            document.grid,
            {
              ...document.sceneInputs,
              objects: document.sceneInputs.objects.filter((o) => o.category === 'vegetation'),
            },
            analysis,
            input.support,
          ).map((p) => ({
            ...p,
            planId: `vegetation:${p.input!.id}`,
            sourceRefs: [{ kind: 'object' as const, id: p.input!.id }],
            yawQuarterTurns: 0 as const,
            worldBounds16: sceneBounds16(p.center, p.size),
          }))
        : []),
    ],
    counters: {
      ...analysis.counters,
      fallbackCount: 0,
      ruleEvaluations: generated.reduce((n, r) => n + r.counters.ruleEvaluations, 0),
      placementCount: placements.length,
      moduleCount: modules.filter((m) => m.kind === 'structure').length,
      attachmentCount: modules.filter((m) => m.kind === 'attachment').length,
      ownedFaceCount: generated.reduce((n, r) => n + (r.counters.ownedFaceCount ?? 0), 0),
    },
    environment: {
      ...plans,
      overlays: environmentOverlays(entrances, circulation ?? [], vertical, faceLookup, probes),
      traces: [
        ...(input.support?.records??[]).map(r=>({
          id:r.id,ownerId:r.sourceRefs.find(s=>s.kind==='object')!.id,ruleId:'installation-support',ruleVersion:'1',
          sourceRefs:r.sourceRefs,relationIds:[r.id],readDependencies:r.readDependencies,
          selectedIds:r.accepted?[r.id]:[],candidates:[{candidateId:r.id,accepted:r.accepted,reasonCodes:r.reasonCodes,
            metrics:{support:r.support,context:r.context,cells:r.cells.length,covered:!!r.coveredBy,proof:'installation-only'},conflictIds:[]}],
        })),
        ...(wallFacilities?.traces ?? []),
        ...(fixtures?.traces ?? []),
        ...(trims?.traces ?? []),
        ...(parking ?? []).flatMap((a) => a.plans.flatMap((p) => p.traces)),
        ...entrances.flatMap((p) => p.traces),
        ...(circulation ?? []).flatMap((a) => a.components.flatMap((c) => c.traces)),
        ...vertical.flatMap((v) => v.traces),
        ...probes.map((p) => ({
          id: `access:${p.ref.id}`,
          ownerId: p.ref.id,
          ruleId: 'spatial-access',
          ruleVersion: '1.0.0',
          sourceRefs: [p.ref],
          selectedIds: p.access.reachable ? [cellId(p.cell)] : [],
          candidates: [
            {
              candidateId: cellId(p.cell),
              accepted: p.access.reachable,
              reasonCodes: p.access.reasonCodes,
              metrics: { distance: p.access.distanceCells ?? -1 },
              conflictIds: [],
            },
          ],
        })),
      ],
    },
  };
  return result;
}
