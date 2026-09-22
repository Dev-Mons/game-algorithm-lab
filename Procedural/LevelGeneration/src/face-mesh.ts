import * as THREE from 'three';
import type { Placement } from './core/analysis';
import type { Tile } from './core/selection';
import { selectCompleteFaceAsset } from './core/complete-face-assets';
import { CraftedGeometryLibrary } from './crafted-geometry';
import { setPlacementMatrix } from './display-transform';

/** A placed exterior face is exactly one Mesh, with shared immutable resources.
 * Reuse only the currently displayed owner. Every asset, finish and transform is
 * refreshed from the full generation result, including a changed display origin. */
export function createFaceMesh(placement: Placement, tile: Tile, library: CraftedGeometryLibrary,
  materials: THREE.Material[], origin: THREE.Vector3, existing?:THREE.Mesh): THREE.Mesh {
  const assetKey = placement.faceAssetKey ?? selectCompleteFaceAsset(tile.assetKey);
  const geometry=library.get(assetKey),mesh=existing??new THREE.Mesh(geometry, materials);
  mesh.geometry=geometry;
  mesh.material=materials;
  mesh.name = `face:${placement.faceId}`;
  mesh.userData.faceId = placement.faceId;
  mesh.userData.faceAssetKey = assetKey;
  mesh.userData.finishIds = placement.finishIds ?? [];
  mesh.matrixAutoUpdate = false;
  setPlacementMatrix(mesh.matrix, placement.position2, placement.orientationId, origin);
  mesh.matrixWorldNeedsUpdate=true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
