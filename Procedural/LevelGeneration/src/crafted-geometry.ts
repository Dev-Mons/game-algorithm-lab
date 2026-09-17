import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  FACADE_ASSETS,
  type FacadeAsset,
  type FacadeAssetKey,
} from "./core/facade-assets";
import {TRIM_ASSETS,type BandedFacadeAsset} from './core/banded-facade-assets';

export interface GeometryParts {
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
  if(opening){plate(-8,opening.minU,-8,8);plate(opening.maxU,8,-8,8);plate(opening.minU,opening.maxU,-8,opening.minV);plate(opening.minU,opening.maxU,opening.maxV,8);}
  else plate(-8,8,-8,8);
  return {panel:merged(panels),...(blocks.length?{relief:merged(blocks)}:{}),...(opening?{glass:new THREE.PlaneGeometry((opening.maxU-opening.minU)/16,(opening.maxV-opening.minV)/16).translate((opening.minU+opening.maxU)/32,(opening.minV+opening.maxV)/32,1/64)}:{})};
}
function roof(shape: string): GeometryParts {
  const top: number[] = [],
    sides: number[] = [];
  const quad = (
    out: number[],
    a: number[],
    b: number[],
    c: number[],
    d?: number[],
  ) => {
    out.push(...a, ...b, ...c);
    if (d) out.push(...a, ...c, ...d);
  };
  const lip = shape === "flat" ? 1 : 1 / 16;
  const a = [-0.5, -0.5, lip],
    b = [0.5, -0.5, lip],
    c = [0.5, 0.5, lip],
    d = [-0.5, 0.5, lip];
  for (const [p, q] of [
    [a, b],
    [b, c],
    [c, d],
    [d, a],
  ])
    quad(sides, [...p.slice(0, 2), 0], [...q.slice(0, 2), 0], q, p);
  if (shape === "flat") quad(top, a, b, c, d);
  else if (shape.startsWith("gable")) {
    const r = [-0.5, 0, 1],
      s = [0.5, 0, 1];
    quad(top, a, b, s, r);
    quad(top, r, s, c, d);
    quad(sides, a, r, d);
    quad(sides, b, c, s);
  } else {
    const r = [-0.25, 0, 1],
      s = [0.25, 0, 1];
    quad(top, a, b, s, r);
    quad(top, r, s, c, d);
    quad(top, a, r, d);
    quad(top, b, c, s);
  }
  const geometry = (positions: number[]) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute(
      "uv",
      new THREE.Float32BufferAttribute(
        positions.flatMap((_, i) =>
          i % 3 === 0 ? [positions[i] + 0.5, positions[i + 1] + 0.5] : [],
        ),
        2,
      ),
    );
    g.computeVertexNormals();
    if (shape.endsWith("-z")) g.rotateZ(Math.PI / 2);
    return g;
  };
  return { panel: geometry(top), relief: geometry(sides) };
}
// Asset-key-only construction: dimensions and input Grid never enter this function.
export function buildCraftedGeometry(assetKey: string): GeometryParts {
  if(TRIM_ASSETS[assetKey])return {panel:merged(TRIM_ASSETS[assetKey].boxes16.map(b=>box((b.min[0]+b.max[0])/32,(b.min[1]+b.max[1])/32,(b.min[2]+b.max[2])/32,(b.max[0]-b.min[0])/16,(b.max[1]-b.min[1])/16,(b.max[2]-b.min[2])/16)))};
  const descriptor=FACADE_ASSETS[assetKey as FacadeAssetKey];
  if(descriptor&&'reliefBoxes16' in descriptor)return bandedFacade(descriptor);
  if (assetKey.startsWith("facade.") && Object.hasOwn(FACADE_ASSETS, assetKey))
    return facade(FACADE_ASSETS[assetKey as FacadeAssetKey]);
  if (["crafted.plaster","crafted.roof","crafted.paving","crafted.soffit"].includes(assetKey)) return framed(assetKey.slice(8));
  throw new Error(`Unknown crafted geometry: ${assetKey}`);
}
export class CraftedGeometryLibrary {
  private cache = new Map<string, GeometryParts>();
  get size(){return this.cache.size;}
  get(key: string) {
    if (!this.cache.has(key)) this.cache.set(key, buildCraftedGeometry(key));
    return this.cache.get(key)!;
  }
  dispose() {
    for (const parts of this.cache.values()) {
      parts.panel.dispose();
      parts.relief?.dispose();
      parts.glass?.dispose();
    }
  }
}
