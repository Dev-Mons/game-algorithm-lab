import * as THREE from "three";
import { completeFaceAsset } from './core/complete-face-assets';
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  FACADE_ASSETS,
  type FacadeAsset,
  type FacadeAssetKey,
} from "./core/facade-assets";
import {TRIM_ASSETS,type BandedFacadeAsset} from './core/banded-facade-assets';

interface GeometryParts {
  panel: THREE.BufferGeometry;
  relief?: THREE.BufferGeometry;
  glass?: THREE.BufferGeometry;
}
const box = (
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
function merged(parts: THREE.BufferGeometry[]) {
  const geometry = mergeGeometries(parts, false);
  parts.forEach((g) => g.dispose());
  if (!geometry) throw new Error("Incompatible authored module geometry.");
  return geometry;
}
function framed(kind: string): GeometryParts {
  const pieces: THREE.BufferGeometry[] = [];
  if (kind === "window" || kind === "window-top") {
    for (const x of [-0.265625, 0.265625])
      pieces.push(box(x, -0.00390625, 0.046875, 0.03125, 0.609375, 0.09375));
    for (const y of [-0.296875, 0.296875])
      pieces.push(box(0, y, 0.046875, 0.5625, 0.03125, 0.09375));
    pieces.push(box(0, -0.3125, 0.0625, 0.625, 0.03125, 0.125));
  } else if (kind === "entry") {
    for (const x of [-0.265625, 0.265625])
      pieces.push(box(x, -0.125, 0.046875, 0.03125, 0.75, 0.09375));
    pieces.push(
      box(0, 0.25, 0.046875, 0.5625, 0.03125, 0.09375),
      box(0, -0.46875, 0.0625, 0.625, 0.0625, 0.125),
    );
  }
  if (kind === "window-top")
    pieces.push(box(0, 0.453125, 0.0625, 1, 0.09375, 0.125));
  return {
    panel: new THREE.PlaneGeometry(1, 1),
    ...(pieces.length ? { relief: merged(pieces) } : {}),
  };
}
function facade(asset: FacadeAsset): GeometryParts {
  const pieces: THREE.BufferGeometry[] = [];
  const o = asset.opening;
  let glass: THREE.BufferGeometry | undefined;
  if (o) {
    const width = o.maxX - o.minX,
      height = o.maxY - o.minY;
    const x = (o.minX + o.maxX) / 2,
      y = (o.minY + o.maxY) / 2;
    glass = new THREE.PlaneGeometry(width, height).translate(x, y, 1 / 64);
    // Horizontal rails end exactly on the unit boundary. No wall/mullion at a join.
    for (const edge of [o.minY + 0.02, o.maxY - 0.02])
      pieces.push(box(x, edge, 0.05, width, 0.04, 0.1));
    if (!o.openLeft)
      pieces.push(box(o.minX + 0.02, y, 0.05, 0.04, height, 0.1));
    if (!o.openRight)
      pieces.push(box(o.maxX - 0.02, y, 0.05, 0.04, height, 0.1));
    if (asset.mullion) pieces.push(box(x, y, 0.04, 0.02, height, 0.08));
  }
  if (asset.pier) pieces.push(box(0, 0, 0.05, asset.pier, 1, 0.1));
  if (asset.band === "base")
    pieces.push(box(0, -0.46875, 0.046875, 1, 0.0625, 0.09375));
  if (asset.band === "cornice") {
    pieces.push(box(0, 0.46875, 0.0625, 1, 0.0625, 0.125));
    pieces.push(box(0, 0.375, 0.046875, 1, 0.0625, 0.09375));
    for (let x = -0.4375; x < 0.5; x += 0.125)
      pieces.push(box(x, 0.421875, 0.0625, 0.0625, 0.03125, 0.125));
  }
  if (asset.band === "cap")
    pieces.push(box(0, 0.46875, 0.03125, 1, 0.0625, 0.0625));
  const decorative = asset.band === "cornice" || asset.band === "cap";
  return {
    panel: decorative ? merged(pieces) : new THREE.PlaneGeometry(1, 1),
    ...(!decorative && pieces.length ? { relief: merged(pieces) } : {}),
    ...(glass ? { glass } : {}),
  };
}
function bandedFacade(asset:BandedFacadeAsset):GeometryParts {
  const blocks=asset.reliefBoxes16.map(b=>box((b.min[0]+b.max[0])/32,(b.min[1]+b.max[1])/32,(b.min[2]+b.max[2])/32,(b.max[0]-b.min[0])/16,(b.max[1]-b.min[1])/16,(b.max[2]-b.min[2])/16));
  const opening=asset.opening16;
  const panels:THREE.BufferGeometry[]=[];
  const plate=(u0:number,u1:number,v0:number,v1:number)=>{if(u1>u0&&v1>v0)panels.push(new THREE.PlaneGeometry((u1-u0)/16,(v1-v0)/16).translate((u0+u1)/32,(v0+v1)/32,0));};
  if(asset.displayRects16)for(const r of asset.displayRects16)panels.push(new THREE.PlaneGeometry((r.maxU-r.minU)/16,(r.maxV-r.minV)/16).translate((r.minU+r.maxU)/32,(r.minV+r.maxV)/32,r.n/16));
  else if(opening){plate(-8,opening.minU,-8,8);plate(opening.maxU,8,-8,8);plate(opening.minU,opening.maxU,-8,opening.minV);plate(opening.minU,opening.maxU,opening.maxV,8);}
  else plate(-8,8,-8,8);
  return {panel:merged(panels),...(blocks.length?{relief:merged(blocks)}:{}),...(opening?{glass:new THREE.PlaneGeometry((opening.maxU-opening.minU)/16,(opening.maxV-opening.minV)/16).translate((opening.minU+opening.maxU)/32,(opening.minV+opening.maxV)/32,1/64)}:{})};
}
// Asset-key-only construction: dimensions and input Grid never enter this function.
function authoredSurfaces(assetKey: string): GeometryParts {
  if(TRIM_ASSETS[assetKey])return {panel:merged(TRIM_ASSETS[assetKey].boxes16.map(b=>box((b.min[0]+b.max[0])/32,(b.min[1]+b.max[1])/32,(b.min[2]+b.max[2])/32,(b.max[0]-b.min[0])/16,(b.max[1]-b.min[1])/16,(b.max[2]-b.min[2])/16)))};
  const descriptor=FACADE_ASSETS[assetKey as FacadeAssetKey];
  if(descriptor&&'reliefBoxes16' in descriptor)return bandedFacade(descriptor);
  if (assetKey.startsWith("facade.") && Object.hasOwn(FACADE_ASSETS, assetKey))
    return facade(FACADE_ASSETS[assetKey as FacadeAssetKey]);
  if (["crafted.plaster","crafted.roof","crafted.paving","crafted.soffit"].includes(assetKey)) return framed(assetKey.slice(8));
  throw new Error(`Unknown crafted geometry: ${assetKey}`);
}
// Stable material slots for a single Mesh: wall = 0, frame/finish = 1, glass = 2.
export const FACE_MATERIAL_SLOTS = { wall: 0, frame: 1, glass: 2 } as const;
/** Prototype authoring boundary. Only a catalog key enters; never a placed volume.
 * Replace this factory's complete-key lookup with Blender single-mesh assets.
 * Combining fixed demo surfaces here happens once per prototype, never per face.
 */
export function buildCraftedGeometry(assetKey: string): THREE.BufferGeometry {
  const asset = assetKey.startsWith('face-v1|') ? completeFaceAsset(assetKey) : {baseAssetKey: assetKey, finishAssetKeys: []};
  const base = asset.baseAssetKey === 'unit-panel' ? {panel: new THREE.PlaneGeometry(1, 1)} : authoredSurfaces(asset.baseAssetKey);
  const surfaces: THREE.BufferGeometry[] = [base.panel], slots: number[] = [0];
  if (base.relief) { surfaces.push(base.relief); slots.push(1); }
  if (base.glass) { surfaces.push(base.glass); slots.push(2); }
  for (const key of asset.finishAssetKeys) { surfaces.push(authoredSurfaces(key).panel); slots.push(1); }
  const geometry = mergeGeometries(surfaces, true);
  surfaces.forEach(g => g.dispose());
  if (!geometry) throw new Error('Incompatible complete face prototype.');
  geometry.groups.forEach((group, i) => group.materialIndex = slots[i]);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
export class CraftedGeometryLibrary {
  private cache = new Map<string, THREE.BufferGeometry>();
  get size(){return this.cache.size;}
  get(key: string) {
    if (!this.cache.has(key)) this.cache.set(key, buildCraftedGeometry(key));
    return this.cache.get(key)!;
  }
  dispose() {
    for (const geometry of this.cache.values()) geometry.dispose();
    this.cache.clear();
  }
}
