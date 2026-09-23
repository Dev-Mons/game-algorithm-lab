import type { RuleSpatialAdapter, RuleSpatialEnvelope } from './rule-spatial-contract';
import { cellBox16, faceBounds16, faceAssetBounds, mergeBoxes16 } from './placement-bounds';
import { faceCenter2, type Vec3 } from './analysis';
import { TRIM_ASSETS } from './banded-facade-assets';

/** Preflight depends only on source geometry and registered descriptors. */
export function describeContextualEnvelope(
  input: Parameters<RuleSpatialAdapter['describeEnvelope']>[0],
): RuleSpatialEnvelope {
  const faces = input.analysis.surfaces.filter((s) => s.componentId === input.componentId),
    supportedAssetKeys = [
      ...new Set([...(input.options.catalog ?? []).map((t) => t.assetKey), ...Object.keys(TRIM_ASSETS)]),
    ];
  for (const asset of supportedAssetKeys) faceAssetBounds(asset);
  const rooftopHeight = Math.max(
    8,
    ...(input.options.architecture?.modules ?? []).flatMap((m) =>
      Object.values(m.rooftopAssets ?? {}).map((asset) => faceAssetBounds(asset).max[1]),
    ),
  );
  return {
    version: 1,
    requiredBoxes16: mergeBoxes16([
      ...input.cells.map(cellBox16),
      ...faces.map((s) =>
        faceBounds16(
          s.role === 'wall'
            ? { min: [-8, -8, 0], max: [8, s.wallKind === 'rooftop' ? rooftopHeight : 8, 2] }
            : { min: [-8, -8, -1], max: [8, 8, 0] },
          faceCenter2(s.cell as Vec3, s.direction),
          s.direction,
        ),
      ),
    ]),
    deferredAttachmentBounds16: mergeBoxes16(
      faces
        .filter((s) => s.role === 'wall')
        .map((s) =>
          faceBounds16(
            { min: [-10, -8, -2], max: [10, 8, 2] },
            faceCenter2(s.cell as Vec3, s.direction),
            s.direction,
          ),
        ),
    ),
    supportedAssetKeys,
    diagnostics: [],
  };
}
