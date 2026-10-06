import type { RuleSpatialAdapter, RuleSpatialEnvelope } from './rule-spatial-contract';
import { cellBox16, faceBounds16, faceAssetBounds, mergeBoxes16,scenePlacementBounds16 } from './placement-bounds';
import {isResidential,planResidential,RESIDENTIAL_KIT} from './residential-kit';
import type {Surface} from './analysis';
import { faceCenter2, type Vec3 } from './analysis';
import { TRIM_ASSETS } from './banded-facade-assets';

/** Preflight depends only on source geometry and registered descriptors. */
export function describeContextualEnvelope(
  input: Parameters<RuleSpatialAdapter['describeEnvelope']>[0],
): RuleSpatialEnvelope {
  if(isResidential(input.options.architecture?.id)){
    const faces=input.analysis.surfaces.filter(s=>s.componentId===input.componentId) as unknown as Surface[];
    const portals=new Set(faces.filter(s=>s.role==='wall'&&s.cell[1]===0).map(s=>s.faceId));
    const ordinary=planResidential(input.cells,faces,input.options.architecture!.id,input.componentId);
    const potential=planResidential(input.cells,faces,input.options.architecture!.id,input.componentId,portals);
    return {version:1,requiredBoxes16:mergeBoxes16([...input.cells.map(cellBox16),...ordinary.map(scenePlacementBounds16),...potential.map(scenePlacementBounds16)]),
      deferredAttachmentBounds16:[],supportedAssetKeys:Object.keys(RESIDENTIAL_KIT.assets),diagnostics:[]};
  }
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
