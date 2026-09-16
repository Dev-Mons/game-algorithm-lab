import {
  analyzeVolume,
  selectTiles,
  assembleModules,
  type GenerationResult,
} from "./core/generate";
import {
  createDocument,
  profileData,
  documentOptions,
  type GenerationDocument,
} from "./core/document";
import { FIXTURES, box } from "./fixtures";
import { generateCity } from "./core/city";
import type { Viewer } from "./viewer";

export interface Timings {
  analysis: number;
  selection: number;
  rendererSync: number;
  total: number;
}
export function measuredGeneration(
  document: GenerationDocument,
  viewer: Viewer,
): { result: GenerationResult; timings: Timings } {
  const options = documentOptions(document);
  const start = performance.now();
  const analysis = analyzeVolume(document.grid, options.rolePolicy),
    analyzed = performance.now();
  const result = assembleModules(
      selectTiles(analysis, {
        ...options,
      }),
      options,
    ),
    selected = performance.now();
  viewer.sync(result, document.catalog.tiles);
  const synced = performance.now();
  return {
    result,
    timings: {
      analysis: analyzed - start,
      selection: selected - analyzed,
      rendererSync: synced - selected,
      total: synced - start,
    },
  };
}
export const BENCHMARK_INPUTS = {
  ...Object.fromEntries(
    [
      "single",
      "adjacent",
      "cube",
      "l",
      "step",
      "overhang",
      "sealed",
      "opened",
    ].map((id) => [id, FIXTURES[id].cells]),
  ),
  dense: box(16, 16, 8),
  stepped: box(16, 16, 8).filter(([x, y]) => y < (x < 8 ? 8 : 16)),
  cantilever: box(16, 16, 8).filter(
    ([x, y, z]) => y >= 8 || (x >= 4 && x < 12 && z >= 2 && z < 6),
  ),
  annex: FIXTURES.annex.cells,
  facade: FIXTURES.facade.cells,
  quarter: FIXTURES.quarter.cells,
  generated: generateCity({
    seed: 42,
    blocks: 3,
    lotSize: 4,
    streetWidth: 2,
    maxHeight: 6,
    density: 100,
    layout: "grid",
  }).cells,
};
const percentile = (values: number[], p: number) =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
export async function benchmark(
  viewer: Viewer,
  progress: (text: string) => void,
) {
  const rows = [];
  for (const profile of [
    "reference",
    "village",
    "crafted-hip",
    "crafted-gable",
    "crafted-flat",
  ] as const)
    for (const [name, grid] of Object.entries(BENCHMARK_INPUTS)) {
      progress(`${profile}/${name} · 준비 10회 / 측정 50회`);
      const input = createDocument(grid, 42, profile);
      const samples: Timings[] = [];
      let result!: GenerationResult;
      for (let i = 0; i < 60; i++) {
        const run = measuredGeneration(input, viewer);
        result = run.result;
        if (result.status !== "ok")
          throw new Error(`Benchmark fixture failed: ${name}`);
        if (i >= 10) samples.push(run.timings);
        if (i % 5 === 4)
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          );
      }
      const timings = Object.fromEntries(
        (["analysis", "selection", "rendererSync", "total"] as const).map(
          (key) => [
            key,
            {
              p50: percentile(
                samples.map((s) => s[key]),
                0.5,
              ),
              p95: percentile(
                samples.map((s) => s[key]),
                0.95,
              ),
            },
          ],
        ),
      );
      rows.push({ name, input, counters: result.counters, timings, samples });
    }
  return {
    measuredAt: new Date().toISOString(),
    environment: {
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      platform: navigator.platform,
      buildMode: import.meta.env.MODE,
    },
    protocol: {
      warmup: 10,
      samples: 50,
      targetTotalP95Ms: 100,
      scope:
        "CPU normalization through adapter synchronization; excludes GPU completion, paint, DOM inspector updates and frame waits",
    },
    rows,
  };
}
export type BenchmarkReport = Awaited<ReturnType<typeof benchmark>>;
