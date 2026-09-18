import { BASES, type Direction, type Vec3 } from "./analysis";
import type { Box16, Heading } from "./environment-contract";
import { cloneJSON } from "./canonical";
import type { ScenePlacement } from "./scene-inputs";
import {FACADE_ASSETS} from './facade-assets';
import {TRIM_ASSETS} from './banded-facade-assets';
import {completeFaceAsset} from './complete-face-assets';

const faceDescriptors=new Map<string,Box16>();
export function registerFaceAssetBounds(assetKey:string,bounds16:Box16){if(faceDescriptors.has(assetKey))throw new Error('DUPLICATE_ASSET_BOUNDS');faceDescriptors.set(assetKey,cloneJSON(validateBox16(bounds16)));}
export const hasFaceAssetBounds=(assetKey:string)=>{if(faceDescriptors.has(assetKey))return true;try{faceAssetBounds(assetKey);return true;}catch{return false;}};
export function faceAssetBounds(assetKey:string):Box16 {
  if(assetKey.startsWith('face-v1|')){
    const asset=completeFaceAsset(assetKey),bounds=[faceAssetBounds(asset.baseAssetKey),...asset.finishAssetKeys.map(faceAssetBounds)];
    return {min:[0,1,2].map(a=>Math.min(...bounds.map(b=>b.min[a]))) as Vec3,max:[0,1,2].map(a=>Math.max(...bounds.map(b=>b.max[a]))) as Vec3};
  }
  const descriptor=faceDescriptors.get(assetKey);if(!descriptor)throw new Error(`RULE_OUTPUT_BOUNDS_UNKNOWN:${assetKey}`);return cloneJSON(descriptor);
}

const sceneDescriptors = new Map<string,Box16>();
/** Bounds of the shared prototype in normalized, centered local coordinates. */
export function registerSceneAssetBounds(assetKey:string,bounds16:Box16) {
  if (!assetKey || sceneDescriptors.has(assetKey)) throw new Error("DUPLICATE_OR_INVALID_ASSET_BOUNDS");
  sceneDescriptors.set(assetKey,cloneJSON(validateBox16(bounds16)));
}
export const hasSceneAssetBounds = (assetKey:string) => sceneDescriptors.has(assetKey);
export function scenePlacementBounds16(p:ScenePlacement):Box16 {
  const local=sceneDescriptors.get(p.asset);
  if(!local) throw new Error(`RULE_OUTPUT_BOUNDS_UNKNOWN:${p.asset}`);
  if(p.center.some(n=>!Number.isFinite(n))||p.size.some(n=>!Number.isFinite(n)||n<=0)|| (p.yawQuarterTurns!==undefined&&![0,1,2,3].includes(p.yawQuarterTurns))) throw new Error("INVALID_PLACEMENT_TRANSFORM");
  const corners:Vec3[]=[];
  for(const x of [local.min[0],local.max[0]]) for(const y of [local.min[1],local.max[1]]) for(const z of [local.min[2],local.max[2]]) {
    let a=x*p.size[0],b=z*p.size[2];
    for(let i=0;i<(p.yawQuarterTurns??0);i++) [a,b]=[b,-a];
    corners.push([p.center[0]*16+a,p.center[1]*16+y*p.size[1],p.center[2]*16+b]);
  }
  return validateBox16({min:[0,1,2].map(a=>Math.floor(Math.min(...corners.map(c=>c[a]))+1e-8)) as Vec3,max:[0,1,2].map(a=>Math.ceil(Math.max(...corners.map(c=>c[a]))-1e-8)) as Vec3});
}
for(const asset of ["parking-deck","parking-roof-deck","parking-column","parking-bay"])
  registerSceneAssetBounds(asset,{min:[-8,-8,-8],max:[8,8,8]});
for(const [asset,descriptor] of Object.entries(FACADE_ASSETS))
  registerFaceAssetBounds(asset,'bounds16' in descriptor?descriptor.bounds16:asset==='facade.wall'?{min:[-8,-8,-1],max:[8,8,0]}:{min:[-8,-8,0],max:[8,8,2]});
for(const asset of ['unit-panel',...['plaster','roof','paving','soffit'].map(a=>`crafted.${a}`)])
  registerFaceAssetBounds(asset,{min:[-8,-8,-1],max:[8,8,0]});
for(const asset of Object.values(TRIM_ASSETS))registerFaceAssetBounds(asset.assetKey,asset.bounds16);

export function validateBox16(box: Box16): Box16 {
  if (!box || !Array.isArray(box.min) || !Array.isArray(box.max) || box.min.length !== 3 || box.max.length !== 3 ||
      Object.keys(box).some(k => k !== "min" && k !== "max") ||
      box.min.some((n,a) => !Number.isSafeInteger(n) || !Number.isSafeInteger(box.max[a]) || n >= box.max[a])) throw new Error("INVALID_BOX16");
  return box;
}
export function cellBox16(cell: readonly number[]): Box16 {
  return {min:[cell[0]*16,cell[1]*16,cell[2]*16],max:[(cell[0]+1)*16,(cell[1]+1)*16,(cell[2]+1)*16]};
}
export const boxesOverlap = (a: Box16, b: Box16) => a.min[0]<b.max[0]&&b.min[0]<a.max[0]&&a.min[1]<b.max[1]&&b.min[1]<a.max[1]&&a.min[2]<b.max[2]&&b.min[2]<a.max[2];
/** Subtract a box as six disjoint slabs. Touching faces remove no volume. */
export function subtractBox(box: Box16, cut: Box16): Box16[] {
  if (!boxesOverlap(box, cut)) return [box];
  const min = [...box.min] as Vec3, max = [...box.max] as Vec3, pieces: Box16[] = [];
  for (let a = 0; a < 3; a++) {
    if (min[a] < cut.min[a]) { const end = [...max] as Vec3; end[a] = cut.min[a]; pieces.push({min:[...min],max:end}); min[a] = cut.min[a]; }
    if (max[a] > cut.max[a]) { const start = [...min] as Vec3; start[a] = cut.max[a]; pieces.push({min:start,max:[...max]}); max[a] = cut.max[a]; }
  }
  return pieces;
}
export function containedInUnion(actual: Box16, envelope: readonly Box16[]): boolean {
  let remaining = [actual];
  for (const box of envelope) {
    remaining = remaining.flatMap(piece => subtractBox(piece, box));
    if (!remaining.length) return true;
  }
  return false;
}
export function faceBounds16(local: Box16, position2: Vec3, direction: Direction, scale16: Vec3 = [16,16,16]): Box16 {
  const basis = BASES[direction], vectors = [basis.u,basis.v,basis.n];
  const min = position2.map(n => n*8) as Vec3, max = [...min] as Vec3;
  for (let world = 0; world < 3; world++) for (let a = 0; a < 3; a++) {
    const p = local.min[a]*scale16[a]/16*vectors[a][world], q = local.max[a]*scale16[a]/16*vectors[a][world];
    min[world] += Math.min(p,q); max[world] += Math.max(p,q);
  }
  return { min:min.map(Math.floor) as Vec3, max:max.map(Math.ceil) as Vec3 };
}
export function sceneBounds16(center: Vec3, size: Vec3, heading: Heading = 0): Box16 {
  const dimensions = heading % 2 ? [size[2],size[1],size[0]] : size;
  return validateBox16({ min:center.map((n,a) => Math.floor((n-dimensions[a]/2)*16+1e-8)) as Vec3, max:center.map((n,a) => Math.ceil((n+dimensions[a]/2)*16-1e-8)) as Vec3 });
}
/** Exact rectangular coalescing; never fills a missing voxel or relief gap. */
export function mergeBoxes16(boxes:Box16[]):Box16[]{
 let result=boxes;
 for(const axis of [0,1,2]){const other=[0,1,2].filter(a=>a!==axis),groups=new Map<string,Box16[]>();for(const box of result){const key=other.map(a=>`${box.min[a]},${box.max[a]}`).join('|'),list=groups.get(key)??[];list.push(box);groups.set(key,list);}
 result=[];for(const list of groups.values()){list.sort((a,b)=>a.min[axis]-b.min[axis]||a.max[axis]-b.max[axis]);let active:Box16|undefined;for(const box of list){if(active&&box.min[axis]<=active.max[axis])active.max[axis]=Math.max(active.max[axis],box.max[axis]);else {active={min:[...box.min],max:[...box.max]};result.push(active);}}}
 }return result;
}
