import {
  add,
  BASES,
  cellId,
  normalizeGrid,
  type Vec3,
  type GenerationResult,
} from "./core/generate";
import {
  exportDocument,
  loadDocument,
  type GenerationDocument,
} from "./core/document";

export function editBox(
  grid: Vec3[],
  origin: Vec3,
  size: Vec3,
  mode: "add" | "remove",
): Vec3[] {
  normalizeGrid([origin]);
  if (
    size.length !== 3 ||
    size.some((n) => !Number.isInteger(n) || n < 1 || n > 32)
  )
    throw new Error("Box 크기는 각 축 1~32의 정수여야 합니다.");
  const end = origin.map((n, a) => n + size[a] - 1) as Vec3;
  normalizeGrid([origin, end]);
  if (mode === "remove")
    return normalizeGrid(
      grid.filter((c) => !c.every((n, a) => n >= origin[a] && n <= end[a])),
    );
  normalizeGrid([...grid, origin, end]); // Validate the combined bounds before allocating the box.
  const additions: Vec3[] = [];
  for (let x = 0; x < size[0]; x++)
    for (let y = 0; y < size[1]; y++)
      for (let z = 0; z < size[2]; z++) additions.push(add(origin, [x, y, z]));
  return normalizeGrid([...grid, ...additions]);
}
export function extrudeRegion(
  grid: Vec3[],
  result: GenerationResult,
  regionId: string,
  distance: number,
): Vec3[] {
  if (!Number.isInteger(distance) || distance === 0 || Math.abs(distance) > 32)
    throw new Error("Extrude 깊이는 0을 제외한 -32~32 정수여야 합니다.");
  if (JSON.stringify(normalizeGrid(grid)) !== JSON.stringify(result.cells))
    throw new Error("선택 영역이 현재 부피와 일치하지 않습니다.");
  const region = result.regions?.find((r) => r.regionId === regionId);
  if (!region) throw new Error("건축 스타일에서 표면 영역을 먼저 선택하세요.");
  const members = new Set(region.faceIds),
    faces = result.surfaces.filter((s) => members.has(s.faceId)),
    changes: Vec3[] = [];
  for (const face of faces)
    for (let i = 0; i < Math.abs(distance); i++) {
      const step = distance > 0 ? i + 1 : -i;
      changes.push(
        add(face.cell, BASES[face.direction].n.map((n) => n * step) as Vec3),
      );
    }
  if (distance > 0) return normalizeGrid([...grid, ...changes]);
  const removed = new Set(changes.map(cellId));
  return normalizeGrid(grid.filter((c) => !removed.has(cellId(c))));
}

export class DocumentHistory {
  private past: string[] = [];
  private future: string[] = [];
  private current: string;
  constructor(
    document: GenerationDocument,
    private maxEntries = 64,
    private maxBytes = 8 * 1024 * 1024,
  ) {
    this.current = exportDocument(document);
  }
  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
  commit(document: GenerationDocument) {
    const next = exportDocument(document);
    if (next === this.current) return false;
    this.past.push(this.current);
    this.current = next;
    this.future = [];
    this.prune();
    return true;
  }
  undo() {
    if (!this.canUndo) return undefined;
    this.future.push(this.current);
    this.current = this.past.pop()!;
    return loadDocument(this.current);
  }
  redo() {
    if (!this.canRedo) return undefined;
    this.past.push(this.current);
    this.current = this.future.pop()!;
    this.prune();
    return loadDocument(this.current);
  }
  private prune() {
    while (
      this.past.length > this.maxEntries ||
      this.past.reduce((sum, s) => sum + s.length * 2, 0) > this.maxBytes
    )
      this.past.shift();
  }
}
