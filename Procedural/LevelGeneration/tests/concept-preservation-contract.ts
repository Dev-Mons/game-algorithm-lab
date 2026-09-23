import { createHash } from 'node:crypto';
import { canonicalJSON, type GenerationDocument } from '../src/core/document';
import type { GenerationResult } from '../src/core/generate';
import { facadeColors, facadeFinish } from '../src/facade-finishes';

export const digest = (value: unknown) => createHash('sha256').update(canonicalJSON(value)).digest('hex');
// Only authored output and externally visible ownership/contracts are golden.
// Candidate traces, cache records, logical counters and intermediate facade plans may change.
export function meaningfulResult(result: GenerationResult) {
  const env = result.environment!;
  return {
    status: result.status,
    diagnostics: result.diagnostics,
    surfaces: result.surfaces.map(
      ({ faceId, cell, direction, componentId, role, wallKind, undersideKind }) => ({
        faceId,
        cell,
        direction,
        componentId,
        role,
        ...(wallKind ? { wallKind } : {}),
        ...(undersideKind ? { undersideKind } : {}),
      }),
    ),
    placements: result.placements,
    modules: result.modules,
    scenePlacements: result.scenePlacements,
    vertical: env.vertical?.map(({ buildingId, datumY, heightCells, bands, alignment, faceBands }) => ({
      buildingId,
      datumY,
      heightCells,
      bands,
      alignment,
      faceBands,
    })),
    entrances: env.entrances?.map(({ buildingId, entrances, frontages, desiredCount, unmetCount }) => ({
      buildingId,
      entrances,
      frontages,
      desiredCount,
      unmetCount,
    })),
    reservations: env.reservations,
    stages: env.stages,
  };
}
export function fingerprint(document: GenerationDocument, result: GenerationResult) {
  const used = new Set(result.placements.map((p) => p.tileId)),
    tiles = document.catalog.tiles.filter((t) => used.has(t.tileId));
  const colors = tiles
    .filter((t) => t.assetKey.startsWith('facade.'))
    .map((t) => ({
      tileId: t.tileId,
      finish: facadeFinish(t.assetKey),
      colors: facadeColors(facadeFinish(t.assetKey), t.palette!),
    }));
  return {
    semantic: digest(meaningfulResult(result)),
    materials: digest(colors),
    tiles: digest(tiles),
    cells: document.grid.length,
    faces: result.placements.length,
    entrances: result.environment!.entrances!.reduce((n, p) => n + p.entrances.length, 0),
    reservations: result.environment!.reservations.length,
    status: result.status,
  };
}
