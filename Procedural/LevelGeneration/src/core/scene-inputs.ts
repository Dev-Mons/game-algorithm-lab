import { add, BASES, cellId, DIRECTIONS, normalizeGrid, type Direction, type Vec3, type Surface } from "./analysis";
import type { ParkingAreaInput, SourceRef, Heading, Box16 } from "./environment-contract";
import { exactKeys } from "./canonical";
export type ObjectCategory = "lighting" | "vegetation" | "facility";
export interface ObjectInput { id: string; category: ObjectCategory; cells: Vec3[]; direction: Direction }
export interface SceneInputs { version: 2; roads: Vec3[]; objects: ObjectInput[]; parkingAreas: ParkingAreaInput[] }
export const emptySceneInputs = (): SceneInputs => ({version:2,roads:[],objects:[],parkingAreas:[]});
export interface ScenePlacement { componentId?: string; input?: ObjectInput; id: string; kind: "object" | "road" | "building" | "parking"; asset: string; center: Vec3; size: Vec3; color: string; context: string; planId?: string; sourceRefs?: SourceRef[]; yawQuarterTurns?: Heading; worldBounds16?: Box16 }
export type ObjectContext = "ground" | "roof" | "wall" | "roadside" | "median";
const horizontal: Vec3[] = [[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]];
export function objectContext(input: ObjectInput, grid: Vec3[], roads: Vec3[],analysis?:{surfaces:Surface[]}): ObjectContext {
  const occupied = new Set(grid.map(cellId)), road = new Set(roads.map(cellId)), own = new Set(input.cells.map(cellId));
  if (input.direction === "NY") throw new Error("아래쪽 면에는 오브젝트를 설치할 수 없습니다.");
  const normal = BASES[input.direction].n;
  const bases = input.cells.filter(c => !own.has(cellId(add(c, normal.map(n => -n) as Vec3))));
  if(analysis){const exterior=new Set(analysis.surfaces.map(s=>s.faceId));if(bases.some(c=>!(input.direction==='PY'&&c[1]===0)&&!exterior.has(`${cellId(add(c,normal.map(n=>-n) as Vec3))}|${input.direction}`)))throw new Error('실제 외부 지지면이 필요합니다.');}
  if (input.cells.some(c => occupied.has(cellId(c)))) throw new Error("오브젝트가 건물과 겹칩니다.");
  if (input.direction !== "PY") {
    if (input.category !== "lighting" || bases.some(c => !occupied.has(cellId(add(c, normal.map(n => -n) as Vec3))))) throw new Error("외벽에는 지지면이 있는 조명만 설치할 수 있습니다.");
    return "wall";
  }
  if (bases.some(c => c[1] !== 0 && !occupied.has(cellId(add(c,[0,-1,0]))))) throw new Error("지면이나 옥상 지지면이 필요합니다.");
  const ground = bases.every(c => c[1] === 0);
  if (!ground && !bases.every(c => c[1] === bases[0][1])) throw new Error("서로 다른 지지면을 한 번에 설치할 수 없습니다.");
  if (!ground) return "roof";
  if (bases.some(c => (road.has(cellId(add(c,[1,0,0]))) && road.has(cellId(add(c,[-1,0,0])))) || (road.has(cellId(add(c,[0,0,1]))) && road.has(cellId(add(c,[0,0,-1])))))) return "median";
  return bases.some(c => horizontal.some(d => road.has(cellId(add(c,d))))) ? "roadside" : "ground";
}
export function validateSceneInputs(grid: Vec3[], inputs: SceneInputs): SceneInputs {
  if (!inputs || inputs.version !== 2) throw new Error("UNSUPPORTED_SCENE_INPUT_VERSION");
  exactKeys(inputs,["version","roads","objects","parkingAreas"]);
  if (!Array.isArray(inputs.objects) || !Array.isArray(inputs.roads) || !Array.isArray(inputs.parkingAreas)) throw new Error("INVALID_SCENE_INPUTS");
  const roads = normalizeGrid(inputs.roads), occupied = new Set(grid.map(cellId)), used = new Set(roads.map(cellId)), ids = new Set<string>();
  if (roads.some(c => c[1] !== 0 || occupied.has(cellId(c)))) throw new Error("도로는 비어 있는 지면에만 설치할 수 있습니다.");
  const objects = inputs.objects.map(input => {
    if (!input || !["lighting","vegetation","facility"].includes(input.category) || !DIRECTIONS.includes(input.direction) || typeof input.id !== "string" || !input.id.length || ids.has(input.id) || Object.keys(input).some(k => !["id","category","cells","direction"].includes(k))) throw new Error("Invalid object input.");
    const cells = normalizeGrid(input.cells);
    if (!cells.length || cells.some(c => used.has(cellId(c)))) throw new Error("오브젝트 입력이 겹치거나 비어 있습니다.");
    const volume = [0,1,2].reduce((n,a) => n*(Math.max(...cells.map(c=>c[a]))-Math.min(...cells.map(c=>c[a]))+1),1);
    if (cells.length !== volume) throw new Error("오브젝트 영역은 빈틈 없는 직육면체여야 합니다.");
    ids.add(input.id); cells.forEach(c => used.add(cellId(c)));
    const normalized = { ...input, cells };
    // Support loss is an unresolved intention, not a malformed document.
    return normalized;
  }).sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const parkingUsed = new Set<string>();
  const parkingAreas = inputs.parkingAreas.map(input => {
    exactKeys(input,["id","cells","anchor"]);
    if (typeof input.id !== "string" || !input.id.length || ids.has(input.id)) throw new Error("INVALID_PARKING_ID");
    ids.add(input.id);
    const cells = normalizeGrid(input.cells), anchor = normalizeGrid([input.anchor])[0];
    if (!cells.length || anchor[1] !== 0 || cells.some(c => c[1] !== 0 || parkingUsed.has(cellId(c)))) throw new Error("INVALID_OR_OVERLAPPING_PARKING_MASK");
    cells.forEach(c => parkingUsed.add(cellId(c)));
    return {id:input.id,cells,anchor};
  }).sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  normalizeGrid([...grid, ...roads, ...objects.flatMap(o => o.cells), ...parkingAreas.flatMap(p => p.cells)]);
  return { version: 2, roads, objects, parkingAreas };
}
export interface ObjectCategoryRule {
  category: ObjectCategory;
  generate(input: ObjectInput, context: ObjectContext): ScenePlacement[];
}
function dimensions(input: ObjectInput, context: ObjectContext) {
  const min = [0,1,2].map(a => Math.min(...input.cells.map(c => c[a]))) as Vec3;
  const size = [0,1,2].map(a => Math.max(...input.cells.map(c => c[a]))-min[a]+1) as Vec3;
  const center = min.map((v,a) => v+size[a]/2) as Vec3;
  const placement = (asset: string, color: string, at = center, dimensions = size): ScenePlacement => ({ input, id: `${input.id}:${asset}`, kind: "object", asset, center: at, size: dimensions, color, context });
  return { min, size, center, placement };
}
export const OBJECT_CATEGORY_RULES: ObjectCategoryRule[] = [
  { category: "vegetation", generate(input, context) {
    const { min, size, center, placement } = dimensions(input, context);
    if (size[1] === 1) return [placement(context === "median" ? "median-planter" : context === "roof" ? "roof-planter" : "shrub", "#79a66b", [center[0],min[1]+.5,center[2]], [size[0],1,size[2]])];
    return Array.from({length:size[1]},(_,i) => {
      const asset = i === 0 ? "tree-bottom" : i === size[1]-1 ? "tree-top" : "tree-middle";
      const tile = placement(asset, i === 0 ? "#886348" : "#62905c", [center[0],min[1]+i+.5,center[2]], [size[0],1,size[2]]);
      // Repeated middle tiles share one asset but retain distinct instance IDs.
      return {...tile, id:`${tile.id}:layer-${i}`};
    });
  } },

];
export function vegetationPlacements(grid: Vec3[], inputs?: SceneInputs,analysis?:{surfaces:Surface[]}): ScenePlacement[] {
  return (inputs?.objects ?? []).filter(input=>input.category==='vegetation').flatMap(input => {
    let context: ObjectContext;
    try { context = objectContext(input, grid, inputs!.roads,analysis); } catch { return []; }
    return OBJECT_CATEGORY_RULES.find(r => r.category === input.category)!.generate(input, context);
  });
}
