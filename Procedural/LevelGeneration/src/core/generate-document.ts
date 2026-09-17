import { roadPlacements } from "./roads";
import { objectPlacements } from "./scene-inputs";
import {
  analyzeVolume,
  generate,
  type GenerationResult,
  type Vec3,
} from "./generate";
import {
  documentOptions,
  profileData,
  type GenerationDocument,
} from "./document";
import { buildingComponents } from "./buildings";
import { resolveBuildingRule, ruleReference } from "./building-rules";

const componentCache = new Map<string, { result: GenerationResult; bytes: number }>();
const MAX_CACHE_BYTES = 16 * 1024 * 1024;
let cacheBytes = 0;
export function generateDocument(
  document: GenerationDocument,
): GenerationResult {
  const result = generateBuildings(document);
  return document.sceneInputs
    ? {
        ...result,
        scenePlacements: [
          ...(result.scenePlacements ?? []),
          ...roadPlacements(document.sceneInputs.roads),
          ...objectPlacements(document.grid, document.sceneInputs),
        ],
      }
    : result;
}
function generateBuildings(document: GenerationDocument): GenerationResult {
  const options = documentOptions(document);
  for (const b of document.buildings ?? [])
    if (b.rule) resolveBuildingRule(b.rule);
  // Existing files and explicit default-rule selections keep the exact golden pipeline.
  if (
    !document.buildings?.some(
      (b) => b.theme || (b.rule && b.rule.id !== "standard"),
    )
  )
    return generate(document.grid, options);
  const analysis = analyzeVolume(document.grid, "region-context-v1");
  let basicAnalysis: ReturnType<typeof analyzeVolume> | undefined;
  const results = buildingComponents(document.grid).map((component) => {
    const id = component.id,
      entry = document.buildings?.find((b) => b.componentId === id),
      theme = entry?.theme;
    const reference = entry?.rule ?? ruleReference("standard"),
      rule = resolveBuildingRule(reference);
    const local = theme
      ? {
          ...profileData("shop"),
          seed: document.seed,
          architecture: theme,
          assembly: options.assembly ?? "flat",
        }
      : options;
    const source =
      theme || options.rolePolicy === "region-context-v1"
        ? analysis
        : (basicAnalysis ??= analyzeVolume(document.grid, options.rolePolicy));
    const surfaces = source.surfaces.filter((s) => s.componentId === id),
      faceIds = new Set(surfaces.map((s) => s.faceId));
    const regions = source.regions?.filter((r) => r.componentId === id);
    const features = source.features.filter((f) =>
      f.faceIds.some((id) => faceIds.has(id)),
    );
    // Legacy assembly intentionally suppresses advanced modules while ANY shared
    // boundary is non-manifold. Preserve that gate for mixed-rule documents too.
    const diagnostics = source.diagnostics;
    const min = [0, 1, 2].map(
      (a) => Math.min(...component.cells.map((c) => c[a])) - 1,
    ) as Vec3;
    const max = [0, 1, 2].map(
      (a) => Math.max(...component.cells.map((c) => c[a])) + 1,
    ) as Vec3;
    // Assembly only queries immediate static neighbors for attachment clearance.
    // Global exterior/region analysis above still invalidates affected boundary surfaces.
    const neighbors = source.cells.filter((c) =>
      c.every((v, a) => v >= min[a] && v <= max[a]),
    );
    const part = {
      ...source,
      cells: neighbors,
      surfaces,
      regions,
      features,
      diagnostics,
      counters: {
        occupiedCells: component.cells.length,
        paddedCells: 0,
        exteriorAirCells: 0,
        surfaceCount: surfaces.length,
        componentCount: 1,
        ...(regions ? { regionCount: regions.length } : {}),
      },
    };
    const key = JSON.stringify([part, component.cells, local, reference]);
    let result = componentCache.get(key)?.result;
    if (!result) {
      result = rule.generate({
        componentId: id,
        cells: component.cells,
        analysis: part,
        options: local,
        metadata: reference.metadata,
      });
      const bytes = (key.length + JSON.stringify(result).length) * 2;
      if (bytes <= MAX_CACHE_BYTES) {
        while (componentCache.size >= 64 || cacheBytes + bytes > MAX_CACHE_BYTES) {
          const oldest = componentCache.keys().next().value!;
          cacheBytes -= componentCache.get(oldest)!.bytes;
          componentCache.delete(oldest);
        }
        componentCache.set(key, { result, bytes });
        cacheBytes += bytes;
      }
    }
    return result;
  });
  const placements = results.flatMap((r) => r.placements),
    modules = results.flatMap((r) => r.modules ?? []),
    scenePlacements = results.flatMap((r) => r.scenePlacements ?? []);
  return {
    ...analysis,
    status: results.some((r) => r.status === "error")
      ? "error"
      : results.some((r) => r.status === "degraded")
        ? "degraded"
        : "ok",
    ...(scenePlacements.length ? { scenePlacements } : {}),
    placements,
    modules,
    traces: results.flatMap((r) => r.traces),
    diagnostics: [
      ...new Map(
        results
          .flatMap((r) => r.diagnostics)
          .map((d) => [`${d.code}:${d.location}`, d]),
      ).values(),
    ],
    counters: {
      ...analysis.counters,
      fallbackCount: results.reduce((n, r) => n + r.counters.fallbackCount, 0),
      ruleEvaluations: results.reduce(
        (n, r) => n + r.counters.ruleEvaluations,
        0,
      ),
      placementCount: placements.length,
      moduleCount: modules.filter((m) => m.kind === "structure").length,
      attachmentCount: modules.filter((m) => m.kind === "attachment").length,
      ownedFaceCount: results.reduce(
        (n, r) => n + (r.counters.ownedFaceCount ?? r.surfaces.length),
        0,
      ),
    },
  };
}
export function documentCatalog(document: GenerationDocument) {
  return [
    ...new Map(
      [
        ...document.catalog.tiles,
        ...(document.buildings?.some((b) => b.theme)
          ? profileData("shop").catalog
          : []),
      ].map((t) => [t.tileId, t]),
    ).values(),
  ];
}
