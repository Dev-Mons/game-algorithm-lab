import { add, BASES, cellId, normalizeGrid, type Vec3, type Direction } from "./core/generate";

// Cells immediately behind the editable plane. They may be empty after a cut;
// keeping this plane lets the next add restore the same layer.
export interface SurfaceSelection {
  direction: Direction;
  cells: Vec3[];
}

export function surfaceRectangle(start: Vec3, end: Vec3, direction: Direction): SurfaceSelection {
  const normalAxis = BASES[direction].n.findIndex(n => n !== 0);
  const lo = start.map((n, a) => a === normalAxis ? n : Math.min(n, end[a])) as Vec3;
  const hi = start.map((n, a) => a === normalAxis ? n : Math.max(n, end[a])) as Vec3;
  normalizeGrid([lo, hi]);
  const cells: Vec3[] = [];
  for (let x = lo[0]; x <= hi[0]; x++)
    for (let y = lo[1]; y <= hi[1]; y++)
      for (let z = lo[2]; z <= hi[2]; z++) cells.push([x, y, z]);
  return { direction, cells };
}

export function stepSurface(grid: Vec3[], selection: SurfaceSelection, mode: "add" | "remove") {
  const n = BASES[selection.direction].n;
  const occupied = new Set(grid.map(cellId));
  const targets = mode === "add" ? selection.cells.map(c => add(c, n)) : selection.cells;
  // Keep edits atomic at obstructions/holes instead of drifting the plane or
  // deleting existing neighbours on the next alternating click.
  if (!targets.length || targets.some(c => occupied.has(cellId(c)) !== (mode === "remove")))
    return { grid, selection, changed: false };
  const removed = new Set(targets.map(cellId));
  const next = normalizeGrid(mode === "add" ? [...grid, ...targets] : grid.filter(c => !removed.has(cellId(c))));
  const offset = n.map(v => v * (mode === "add" ? 1 : -1)) as Vec3;
  return {
    grid: next,
    selection: { direction: selection.direction, cells: selection.cells.map(c => add(c, offset)) },
    changed: true,
  };
}
