import { roadPlacements } from "./roads";
import { objectPlacements } from "./scene-inputs";
import { analyzeVolume, assembleModules, generate, selectTiles, type GenerationResult } from "./generate";
import { documentOptions, profileData, type GenerationDocument } from "./document";

const componentCache = new Map<string, GenerationResult>();
// Component selection uses the shared whole-volume analysis, preserving exterior/adjacency semantics.
export function generateDocument(document: GenerationDocument): GenerationResult {
  const result = generateBuildings(document);
  return document.sceneInputs ? { ...result, scenePlacements: [...roadPlacements(document.sceneInputs.roads), ...objectPlacements(document.grid, document.sceneInputs)] } : result;
}
function generateBuildings(document: GenerationDocument): GenerationResult {
  const options = documentOptions(document);
  if (!document.buildings?.length) return generate(document.grid, options);
  const analysis = analyzeVolume(document.grid, "region-context-v1");
  const results = [...new Set(analysis.surfaces.map(s => s.componentId))].map(id => {
    const theme = document.buildings?.find(b => b.componentId === id)?.theme;
    const local = theme ? { ...profileData("shop"), seed: document.seed, architecture: theme } : options;
    const source = theme || options.rolePolicy === "region-context-v1" ? analysis : analyzeVolume(document.grid, options.rolePolicy);
    const surfaces = source.surfaces.filter(s => s.componentId === id);
    const ids = new Set(surfaces.map(s => s.faceId));
    const part = { ...source, surfaces, regions: source.regions?.filter(r => r.faceIds.some(f => ids.has(f))) };
    const key = JSON.stringify([part, local]);
    let result = componentCache.get(key);
    if (!result) {
      result = assembleModules(selectTiles(part, local), local);
      if (componentCache.size >= 64) componentCache.delete(componentCache.keys().next().value!);
      componentCache.set(key, result);
    }
    return result;
  });
  const placements = results.flatMap(r => r.placements), modules = results.flatMap(r => r.modules ?? []);
  return { ...analysis, status: results.some(r => r.status === "error") ? "error" : results.some(r => r.status === "degraded") ? "degraded" : "ok",
    placements, modules, traces: results.flatMap(r => r.traces),
    diagnostics: results.flatMap(r => r.diagnostics),
    counters: { ...analysis.counters, fallbackCount: results.reduce((n,r) => n+r.counters.fallbackCount,0), ruleEvaluations: results.reduce((n,r) => n+r.counters.ruleEvaluations,0), placementCount: placements.length,
      moduleCount: modules.filter(m => m.kind === "structure").length, attachmentCount: modules.filter(m => m.kind === "attachment").length, ownedFaceCount: analysis.surfaces.length } };
}
export function documentCatalog(document: GenerationDocument) {
  return [...new Map([...document.catalog.tiles, ...(document.buildings?.some(b => b.theme) ? profileData("shop").catalog : [])].map(t => [t.tileId,t])).values()];
}
