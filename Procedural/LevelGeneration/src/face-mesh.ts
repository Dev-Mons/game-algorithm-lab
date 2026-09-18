import * as THREE from 'three';
import type { Placement } from './core/analysis';
import type { Tile } from './core/selection';
import { selectCompleteFaceAsset } from './core/complete-face-assets';
import { CraftedGeometryLibrary } from './crafted-geometry';
import { setPlacementMatrix } from './display-transform';

/** A placed exterior face is exactly one Mesh, with shared immutable resources. */
export function createFaceMesh(placement: Placement, tile: Tile, library: CraftedGeometryLibrary,
  materials: THREE.Material[], origin: THREE.Vector3): THREE.Mesh {
  const assetKey = placement.faceAssetKey ?? selectCompleteFaceAsset(tile.assetKey);
  const mesh = new THREE.Mesh(library.get(assetKey), materials);
  mesh.name = `face:${placement.faceId}`;
  mesh.userData.faceId = placement.faceId;
  mesh.userData.faceAssetKey = assetKey;
  mesh.userData.finishIds = placement.finishIds ?? [];
  mesh.matrixAutoUpdate = false;
  setPlacementMatrix(mesh.matrix, placement.position2, placement.orientationId, origin);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
