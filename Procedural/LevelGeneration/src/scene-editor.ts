import { add, BASES, cellId, normalizeGrid, type Vec3 } from "./core/analysis";
import { replaceSceneInputs, type GenerationDocument } from "./core/document";
import type { ObjectInput, ObjectCategory } from "./core/scene-inputs";
import type { SurfaceSelection } from "./surface-edit";
export function editObjects(document: GenerationDocument, selection: SurfaceSelection, category: ObjectCategory, height: number, mode: "add" | "remove") {
  if (!Number.isInteger(height) || height < 1 || height > 8) throw new Error("오브젝트 높이는 1~8칸입니다.");
  const inputs = document.sceneInputs ?? { version: 1 as const, roads: [], objects: [] };
  const bases = normalizeGrid(selection.cells.map(c => add(c, BASES[selection.direction].n)));
  if (!bases.length) throw new Error("설치 영역을 선택하세요.");
  const h = category === "vegetation" && bases.length > 1 && selection.direction === "PY" ? Math.max(3, height) : height;
  const cells = normalizeGrid(bases.flatMap(c => Array.from({length:h},(_,i) => add(c,[0,i,0]))));
  const ids = new Set(cells.map(cellId));
  const objects = mode === "add" ? carveObjects(inputs.objects, ids) : inputs.objects.filter(o => !o.cells.some(c => ids.has(cellId(c))));
  if (mode === "add") objects.push({ id: `object:${cellId(bases[0])}:${selection.direction}`, cells, direction: selection.direction, category });
  return replaceSceneInputs(document, { ...inputs, objects, roads: mode === "add" ? inputs.roads.filter(c => !ids.has(cellId(c))) : inputs.roads });
}

// Keep unaffected columns when a road/object cuts through an existing area.
// Removing a column's support also removes its dependent upper modules.
function carveObjects(objects: ObjectInput[], overwritten: Set<string>): ObjectInput[] {
  return objects.flatMap(o => {
    if (!o.cells.some(c => overwritten.has(cellId(c)))) return [o];
    const cells = o.cells.filter(c => !overwritten.has(cellId(c)) && !o.cells.some(b => b[0]===c[0] && b[2]===c[2] && b[1]<c[1] && overwritten.has(cellId(b))));
    const columns = new Map<string, Vec3[]>();
    for(const c of cells) { const key=`${c[0]},${c[2]}`; const list=columns.get(key)??[]; list.push(c); columns.set(key,list); }
    return [...columns.values()].map(cells => ({...o, cells, id:`object:${o.category}:${o.direction}:${cellId(cells[0])}`}));
  });
}
export function editRoads(document: GenerationDocument, selection: SurfaceSelection, mode: "add" | "remove") {
  if (selection.direction !== "PY" || selection.cells.some(c => c[1] !== -1)) throw new Error("도로는 지면 Y=0에서만 설치/제거할 수 있습니다.");
  const cells = normalizeGrid(selection.cells.map(c => add(c,[0,1,0])));
  const ids = new Set(cells.map(cellId));
  const inputs = document.sceneInputs ?? {version:1 as const,roads:[],objects:[]};
  return replaceSceneInputs(document, {...inputs,
    roads: mode === "add" ? normalizeGrid([...inputs.roads,...cells]) : inputs.roads.filter(c=>!ids.has(cellId(c))),
    objects: mode === "add" ? carveObjects(inputs.objects,ids) : inputs.objects });
}
