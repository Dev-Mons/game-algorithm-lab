import type { GenerationResult } from './generate';
import type { GenerationDocument } from './document';
import type { Surface, Placement } from './analysis';
import type { FacadeTrimPlan } from './facade-trims';
import { FACADE_ASSETS, type FacadeAssetKey } from './facade-assets';
import { selectCompleteFaceAsset } from './complete-face-assets';
type TileLookup = ReadonlyMap<string, GenerationDocument['catalog']['tiles'][number]>;

export function completeBuildingFaces(
  generated: readonly GenerationResult[],
  trims: FacadeTrimPlan | undefined,
  tileLookup: TileLookup,
): Placement[] {
  // The joint planner reserves fixed finish alternatives, then transfers their
  // ownership to complete faces. Its candidates are not output/render modules.
  const finishesByFace = new Map<string, NonNullable<FacadeTrimPlan>['finishes']>();
  for (const finish of trims?.finishes ?? []) {
    const list = finishesByFace.get(finish.hostFaceId) ?? [];
    list.push(finish);
    finishesByFace.set(finish.hostFaceId, list);
  }
  const placedFaceIds = new Set(generated.flatMap((r) => r.placements.map((p) => p.faceId)));
  if ([...finishesByFace.keys()].some((id) => !placedFaceIds.has(id)))
    throw new Error('MISSING_FACE_FINISH_OWNER');
  return generated
    .flatMap((r) => r.placements)
    .map((p) => {
      const finishes = (finishesByFace.get(p.faceId) ?? []).sort((a, b) =>
          a.assetKey < b.assetKey ? -1 : a.assetKey > b.assetKey ? 1 : 0,
        ),
        baseAssetKey = tileLookup.get(p.tileId)!.assetKey;
      if (
        finishes.some(
          (f) => f.orientationId !== p.orientationId || f.position2.some((n, a) => n !== p.position2[a]),
        )
      )
        throw new Error('INVALID_FACE_FINISH_TRANSFORM');
      return {
        ...p,
        faceAssetKey: selectCompleteFaceAsset(
          baseAssetKey,
          finishes.map((f) => f.assetKey),
        ),
        finishIds: finishes.map((f) => f.finishId),
      };
    });
}

export function fixtureWallMounts(
  generated: readonly GenerationResult[],
  faceLookup: ReadonlyMap<string, Surface>,
  tileLookup: TileLookup,
): Map<string, { outset16: number; ownerId: string }> {
  const wallMounts = new Map<string, { outset16: number; ownerId: string }>();
  for (const r of generated)
    for (const p of r.placements) {
      const tile = tileLookup.get(p.tileId)!,
        asset = FACADE_ASSETS[tile.assetKey as FacadeAssetKey],
        face = faceLookup.get(p.faceId);
      if (!face || face.role !== 'wall') continue;
      if (tile.assetKey === 'facade.wall' || tile.assetKey === 'crafted.plaster')
        wallMounts.set(p.faceId, { outset16: 0, ownerId: face.componentId });
      else if (asset && 'pierWidth16' in asset && asset.pierWidth16)
        wallMounts.set(p.faceId, { outset16: 2, ownerId: face.componentId });
    }
  return wallMounts;
}
