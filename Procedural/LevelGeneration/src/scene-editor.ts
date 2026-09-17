import { add, BASES, cellId, normalizeGrid, type Vec3 } from "./core/analysis";
import { replaceSceneInputs, type GenerationDocument } from "./core/document";
import type { ObjectCategory } from "./core/scene-inputs";
import type { SurfaceSelection } from "./surface-edit";
export function editObjects(document: GenerationDocument, selection: SurfaceSelection, category: ObjectCategory, height: number, mode: "add" | "remove") {
  if (!Number.isInteger(height) || height < 1 || height > 8) throw new Error("오브젝트 높이는 1~8칸입니다.");
  const inputs = document.sceneInputs ?? { version: 1 as const, roads: [], objects: [] };
  const bases = normalizeGrid(selection.cells.map(c => add(c, BASES[selection.direction].n)));
  if (!bases.length) throw new Error("설치 영역을 선택하세요.");
  const h = category === "vegetation" && bases.length > 1 && selection.direction === "PY" ? Math.max(3, height) : height;
  const cells = normalizeGrid(bases.flatMap(c => Array.from({length:h},(_,i) => add(c,[0,i,0]))));
  const ids = new Set(cells.map(cellId));
  const objects = inputs.objects.filter(o => !o.cells.some(c => ids.has(cellId(c))));
  if (mode === "add") objects.push({ id: `object:${cellId(bases[0])}:${selection.direction}`, cells, direction: selection.direction, category });
  return replaceSceneInputs(document, { ...inputs, objects, roads: mode === "add" ? inputs.roads.filter(c => !ids.has(cellId(c))) : inputs.roads });
}
