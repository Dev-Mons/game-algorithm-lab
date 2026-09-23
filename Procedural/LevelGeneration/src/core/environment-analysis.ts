import { canonicalJSON, loadDocument, type GenerationDocument } from './document';
import type { EnvironmentCache } from './environment-cache';
import { analyzeVolume, type VolumeAnalysis } from './regions';
import type { AnalysisComponent } from './analysis';

export function resolveExecutionDocument(
  input: GenerationDocument,
  cache: EnvironmentCache | undefined,
): GenerationDocument {
  let resolvedDocument = cache?.getByIdentity<GenerationDocument>('document', input);
  if (!resolvedDocument) {
    const inputText = canonicalJSON(input),
      documentKey = 'document:' + inputText,
      hit = cache?.get<GenerationDocument>(documentKey);
    resolvedDocument = hit ?? loadDocument(inputText);
    if (cache && !hit) cache.putImmutable(documentKey, resolvedDocument, resolvedDocument);
  }
  return resolvedDocument;
}

/** Cache stores cell indices, so hits bind to this document's normalized grid. */
export function analyzeExecutionDocument(
  document: GenerationDocument,
  cache: EnvironmentCache | undefined,
): { analysis: VolumeAnalysis; components: AnalysisComponent[] } {
  type Snapshot = {
    summary: Omit<ReturnType<typeof analyzeVolume>, 'cells'>;
    components: { id: string; indices: number[] }[];
  };
  const identityHit = cache?.getByIdentity<Snapshot>('analysis-partition', document.grid),
    key = identityHit
      ? undefined
      : cache?.key('analysis-partition', { grid: document.grid, policy: 'region-context-v1' });
  const hit = identityHit ?? (key ? cache!.get<Snapshot>(key) : undefined);
  if (hit)
    return {
      analysis: { ...hit.summary, cells: document.grid },
      components: hit.components.map((p) => ({ id: p.id, cells: p.indices.map((i) => document.grid[i]) })),
    };
  let components: AnalysisComponent[] = [];
  const analysis = analyzeVolume(document.grid, 'region-context-v1', (parts) => (components = parts));
  if (key) {
    const { cells, ...summary } = analysis,
      indices = new Map(cells.map((c, i) => [c, i]));
    cache!.putImmutable(
      key,
      {
        summary,
        components: components.map((p) => ({ id: p.id, indices: p.cells.map((c) => indices.get(c)!) })),
      },
      document.grid,
    );
  }
  return { analysis, components };
}
