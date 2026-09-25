import { assembleEnvironmentResult } from './environment-output';
import { planBuildingStructure } from './building-plans';
import { fixtureWallMounts } from './building-output';
import { resolveExecutionDocument, analyzeExecutionDocument } from './environment-analysis';
import { generateBuildings } from './building-execution';
import { ENVIRONMENT } from './environment-settings';

import { environmentCache, type EnvironmentCache, type ExecutionTelemetry } from './environment-cache';
import { cloneJSON } from './canonical';

import { planFixtures } from './fixture-plan';
import { planFacadeTrims } from './facade-trims';

import { validateAssembly } from './modules';
import { planParkingStalls } from './parking-stalls';
import { planEntrances } from './entrance-plan';

import { compareCells } from './analysis';
import { planParkingCirculation } from './parking-circulation';
import { planVertical } from './vertical-design';

import { analyzeSpatial } from './spatial-analysis';
import { SupportIndex, SceneRelationIndex } from './scene-relations';
import { AccessSearch } from './access-graph';
import { documentOptions, type GenerationDocument } from './document';

import { resolveBuildingRule } from './building-rules';
import { preflightRule, preparePreflightAnalysis, preparePreflightInput } from './rule-spatial-adapters';

import type { GenerationResult } from './generate';
import type { EnvironmentStage, StageReport } from './environment-contract';

export interface ExecutionOptions {
  cache?: EnvironmentCache | false;
  telemetry?: (telemetry: ExecutionTelemetry) => void;
  mode?: 'complete' | 'development-preview';
  stageHook?: (stage: EnvironmentStage | 'analysis', edge: 'start' | 'end') => void;
}
export interface EnvironmentExecution {
  mode: 'complete' | 'development-preview';
  stages: StageReport[];
  result: GenerationResult;
}
export interface AcceptedEditorState {
  document: GenerationDocument;
  execution: EnvironmentExecution;
}
const order: EnvironmentStage[] = [
  'vertical',
  'preflight',
  'spatial',
  'parkingCirculation',
  'entrances',
  'parkingStalls',
  'facade',
  'fixtures',
  'attachments',
];

/** Authoritative document execution. Unimplemented stages never produce pretend plans. */
export function executeEnvironment(
  input: GenerationDocument,
  options: ExecutionOptions = {},
): EnvironmentExecution {
  const cache = options.cache === false ? undefined : (options.cache ?? environmentCache);
  let actualExpansions = 0;
  const document = resolveExecutionDocument(input, cache);
  const mode = options.mode ?? 'complete';
  const measure = <T>(stage: EnvironmentStage | 'analysis', run: () => T): T => {
    options.stageHook?.(stage, 'start');
    try {
      return run();
    } finally {
      options.stageHook?.(stage, 'end');
    }
  };
  const { analysis, components } = measure('analysis', () => analyzeExecutionDocument(document, cache));
  const buildingsById = new Map(document.buildings.map((b) => [b.componentId, b]));
  const componentsById = new Map(components.map((c) => [c.id, c]));
  const originals = [
    ...document.grid,
    ...document.sceneInputs.roads,
    ...document.sceneInputs.objects.flatMap((o) => o.cells),
    ...document.sceneInputs.parkingAreas.flatMap((p) => p.cells),
  ];
  const reports = new Map<EnvironmentStage, StageReport>();
  const report = (stage: EnvironmentStage, state: StageReport['state'], ...reasonCodes: string[]) =>
    reports.set(stage, { stage, state, reasonCodes });
  const contextual = document.buildings.some((b) => b.rule.definition.portals === 'planned');
  const vertical = measure('vertical', () =>
    components
      .filter((c) => buildingsById.get(c.id)!.rule.definition.portals === 'planned')
      .map((c) => {
        const b = buildingsById.get(c.id)!;
        return planVertical(
          c.id,
          c.cells,
          analysis.surfaces,
          b.design,
          b.theme ?? document.buildingDefinition,
          document.seed,
        );
      }),
  );
  report('vertical', vertical.length ? 'ready' : 'not-applicable');
  const preflight: NonNullable<GenerationResult['environment']>['preflight'] = [];
  let preflightCalls = 0;
  measure('preflight', () => {
    if (components.length) preparePreflightAnalysis(analysis);
    for (const component of components) {
      const entry = buildingsById.get(component.id)!;
      resolveBuildingRule(entry.rule);
      try {
        preflightCalls++;
        const envelope = preflightRule(
          entry.rule,
          entry.spatialAdapterRef,
          preparePreflightInput({
            componentId: component.id,
            cells: component.cells,
            analysis,
            options: {
              ...documentOptions(document),
              architecture: entry.theme ?? document.buildingDefinition,
            },
            metadata: entry.rule.metadata,
            design: entry.design,
          }),
          originals,
        );
        preflight.push({ buildingId: component.id, envelope });
      } catch (error) {
        if (!(error instanceof Error) || !error.message.startsWith('ENV_PIPELINE_NOT_READY:')) throw error;
        report('preflight', 'not-implemented', error.message);
      }
    }
    if (!reports.has('preflight')) report('preflight', components.length ? 'ready' : 'not-applicable');
  });
  const hasSpatial = originals.length > 0,
    hasParking = document.sceneInputs.parkingAreas.length > 0,
    hasFixtures = document.sceneInputs.objects.some((o) => o.category !== 'vegetation');
  const spatialReady = preflight.length === components.length;
  const spatialRun = spatialReady
    ? measure('spatial', () => {
        const support = new SupportIndex(document, analysis, vertical);
        const run = analyzeSpatial(document, analysis, preflight, components, support);
        return {...run, support, relations: new SceneRelationIndex(support, document, run.spatial)};
      })
    : undefined;
  const support = spatialRun?.support, relations = spatialRun?.relations;
  report(
    'spatial',
    !hasSpatial ? 'not-applicable' : spatialReady ? 'ready' : 'blocked',
    ...(spatialReady ? [] : ['PREFLIGHT_NOT_READY']),
  );
  const parkingGraphKey = spatialRun
    ? {
        walkNodes: spatialRun.spatial.walkNodes,
        walkEdges: spatialRun.spatial.walkEdges,
        roadArrivals: spatialRun.spatial.roadArrivals,
      }
    : undefined;
  const circulation =
    spatialRun && hasParking
      ? measure('parkingCirculation', () => {
          const key = cache?.key('circulation', {
            areas: document.sceneInputs.parkingAreas,
            roads: document.sceneInputs.roads,
            settings: {
              parking: ENVIRONMENT.parking,
              access: ENVIRONMENT.access,
              intersectionKeepoutCells: ENVIRONMENT.fixtures.intersectionKeepoutCells,
            },
            spatial: parkingGraphKey,
            reservations: spatialRun.book.snapshot(),
          });
          type Cached = {
            areas: ReturnType<typeof planParkingCirculation>['areas'];
            book: typeof spatialRun.book;
          };
          const hit = key ? cache!.get<Cached>(key) : undefined;
          if (hit) return { ...hit, domains: undefined };
          const run = planParkingCirculation(
            document,
            spatialRun.spatial,
            spatialRun.book,
            spatialRun.solidIndex,
            relations?.view.roads.map(r=>r.module),
          );
          actualExpansions += run.areas.reduce(
            (n, a) => n + a.components.reduce((v, c) => v + c.counters.stateExpansions, 0),
            0,
          );
          if (key)
            cache!.put<Cached>(key, { areas: run.areas, book: run.book }, (v) => ({
              areas: cloneJSON(v.areas),
              book: v.book.clone(),
            }));
          return run;
        })
      : undefined;
  const activeBook = circulation?.book ?? spatialRun?.book;
  report(
    'parkingCirculation',
    !hasParking ? 'not-applicable' : circulation ? 'ready' : 'blocked',
    ...(hasParking && !circulation ? ['SPATIAL_PLAN_NOT_READY'] : []),
  );
  const search = spatialRun
    ? new AccessSearch(spatialRun.spatial, document, activeBook!, spatialRun.solidIndex)
    : undefined;
  const probeInputs = [
    ...document.sceneInputs.objects.map((o) => ({
      ref: { kind: 'object' as const, id: o.id },
      cell: o.cells[0],
    })),
    ...document.sceneInputs.parkingAreas.map((p) => ({
      ref: { kind: 'parking' as const, id: p.id },
      cell: p.cells[0],
    })),
  ];
  const probes = search ? probeInputs.map((p) => ({ ...p, access: search.query(p.cell) })) : [];
  const entrances =
    spatialRun && activeBook
      ? measure('entrances', () =>
          document.buildings
            .filter((b) => b.rule.definition.portals === 'planned')
            .sort(
              (a, b) =>
                compareCells(a.design.anchor, b.design.anchor) ||
                compareCells(
                  componentsById.get(a.componentId)!.cells[0],
                  componentsById.get(b.componentId)!.cells[0],
                ),
            )
            .map((b) =>
              planEntrances(
                document,
                b,
                componentsById.get(b.componentId)!.cells,
                analysis.surfaces,
                spatialRun.spatial,
                activeBook,
                spatialRun.solidIndex,
                relations,
              ),
            ),
        )
      : [];
  report(
    'entrances',
    !contextual ? 'not-applicable' : spatialRun ? 'ready' : 'blocked',
    ...(contextual && !spatialRun ? ['SPATIAL_PLAN_NOT_READY'] : []),
  );
  let finalBook = activeBook;
  const parking =
    circulation && spatialRun && activeBook
      ? measure('parkingStalls', () => {
          const key = cache?.key('stalls', {
            roads: document.sceneInputs.roads,
            areas: document.sceneInputs.parkingAreas,
            settings: ENVIRONMENT.access,
            circulation: circulation.areas,
            spatial: parkingGraphKey,
            reservations: activeBook.snapshot(),
          });
          type Cached = { plans: ReturnType<typeof planParkingStalls>; book: typeof activeBook };
          const hit = key ? cache!.get<Cached>(key) : undefined;
          if (hit) {
            finalBook = hit.book;
            return hit.plans;
          }
          const plans = planParkingStalls(
            document,
            circulation.areas,
            spatialRun.spatial,
            activeBook,
            spatialRun.solidIndex,
            circulation.domains,
          );
          actualExpansions += plans.reduce(
            (n, a) => n + a.plans.reduce((v, p) => v + p.counters.stateExpansions, 0),
            0,
          );
          if (key)
            cache!.put<Cached>(key, { plans, book: activeBook }, (v) => ({
              plans: cloneJSON(v.plans),
              book: v.book.clone(),
            }));
          return plans;
        })
      : undefined;
  report(
    'parkingStalls',
    !hasParking ? 'not-applicable' : parking ? 'ready' : 'blocked',
    ...(hasParking && !parking ? ['CIRCULATION_NOT_READY'] : []),
  );
  report(
    'fixtures',
    hasFixtures ? 'blocked' : 'not-applicable',
    ...(hasFixtures ? ['FIXTURE_PLAN_NOT_IMPLEMENTED'] : []),
  );
  report(
    'attachments',
    contextual ? 'blocked' : 'not-applicable',
    ...(contextual ? ['ATTACHMENT_PLAN_NOT_IMPLEMENTED'] : []),
  );
  const tileLookup = new Map(document.catalog.tiles.map((t) => [t.tileId, t]));
  const { wallFacilities, columns, columnFaces, facades } = planBuildingStructure(
    document,
    analysis.surfaces,
    buildingsById,
    componentsById,
    vertical,
    entrances,
    finalBook,
    support,
  );
  const generated = measure('facade', () =>
    generateBuildings(
      document,
      analysis,
      components,
      {
        preflight,
        vertical,
        entrances,
        columns,
        facades,
        wallFacilities,
        book: finalBook,
      },
      tileLookup,
    ),
  );
  report(
    'facade',
    !components.length ? 'not-applicable' : generated.length === components.length ? 'ready' : 'blocked',
    ...(generated.length < components.length ? ['PREFLIGHT_NOT_READY'] : []),
  );
  const faceLookup = new Map(analysis.surfaces.map((s) => [s.faceId, s]));
  const wallMounts = fixtureWallMounts(generated, faceLookup, tileLookup);
  const fixtures =
    hasFixtures && spatialRun && finalBook
      ? measure('fixtures', () =>
          planFixtures(
            document,
            analysis,
            spatialRun.spatial,
            finalBook!,
            spatialRun.solidIndex,
            parking ?? [],
            wallMounts,
            relations,
          ),
        )
      : undefined;
  report(
    'fixtures',
    !hasFixtures ? 'not-applicable' : fixtures ? 'ready' : 'blocked',
    ...(hasFixtures && !fixtures ? ['SPATIAL_PLAN_NOT_READY'] : []),
  );
  const trims =
    contextual && spatialRun && finalBook && (!hasFixtures || fixtures)
      ? measure('attachments', () =>
          planFacadeTrims(
            document,
            analysis.surfaces,
            vertical.map((v) => ({
              ...v,
              boundaries: v.boundaries.filter((b) => !columnFaces.has(b.hostFaceId)),
            })),
            preflight,
            finalBook!,
          ),
        )
      : undefined;
  report(
    'attachments',
    !contextual ? 'not-applicable' : trims ? 'ready' : 'blocked',
    ...(contextual && !trims ? ['FIXTURE_PLAN_NOT_READY'] : []),
  );
  for (const generatedResult of generated)
    if (generatedResult.placements.length) {
      const faces = new Set(generatedResult.surfaces.map((s) => s.faceId));
      validateAssembly([...faces], generatedResult.placements, []);
    }
  const stages = order.map((s) => reports.get(s)!);
  if (mode === 'complete' && stages.some((s) => s.state === 'blocked' || s.state === 'not-implemented'))
    throw new Error(
      'ENV_PIPELINE_NOT_READY:' +
        stages
          .filter((s) => s.state === 'blocked' || s.state === 'not-implemented')
          .map((s) => s.stage)
          .join(','),
    );
  const result = assembleEnvironmentResult({
    document,
    analysis,
    generated,
    trims,
    probes,
    tileLookup,
    faceLookup,
    support,
    plans: {
      stages,
      preflight,
      vertical,
      facades,
      wallFacilities,
      columns,
      entrances,
      ...(fixtures ? { fixtures } : {}),
      ...(parking ? { parking } : {}),
      ...(circulation ? { parkingCirculation: circulation.areas } : {}),
      reservations: finalBook?.snapshot() ?? [],
      ...(spatialRun ? { spatial: spatialRun.spatial } : {}),
      ...(relations ? { relations: relations.view } : {}),
      counters: { preflightCalls, generationCalls: 1 },
    },
  });
  options.telemetry?.({
    cacheStats: cache?.stats() ?? { hits: 0, misses: 0, writes: 0, evictions: 0, entries: 0, bytes: 0 },
    actualExpansions,
    logicalExpansions:
      (circulation?.areas ?? []).reduce(
        (n, a) => n + a.components.reduce((v, c) => v + c.counters.stateExpansions, 0),
        0,
      ) +
      (parking ?? []).reduce((n, a) => n + a.plans.reduce((v, p) => v + p.counters.stateExpansions, 0), 0),
    layoutTrials: (circulation?.areas ?? []).reduce(
      (n, a) => n + a.components.reduce((v, c) => v + c.counters.layoutCandidates, 0),
      0,
    ),
  });
  return { mode, stages, result };
}
