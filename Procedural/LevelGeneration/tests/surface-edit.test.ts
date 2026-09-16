import { expect, it } from "vitest";
import { BASES, DIRECTIONS, add, type Vec3 } from "../src/core/generate";
import { surfaceRectangle, stepSurface, type SurfaceSelection } from "../src/surface-edit";

it("keeps the same footprint through repeated add/remove in all six orientations", () => {
  for (const direction of DIRECTIONS) {
    const selection: SurfaceSelection = { direction, cells: [[0, 0, 0], BASES[direction].u] };
    const grid = [...selection.cells];
    const added = stepSurface(grid, selection, "add");
    expect(added.grid).toHaveLength(4);
    expect(added.selection.cells).toEqual(selection.cells.map(c => add(c, BASES[direction].n)));
    const twice = stepSurface(added.grid, added.selection, "add");
    expect(twice.grid).toHaveLength(6);
    const cut = stepSurface(twice.grid, twice.selection, "remove");
    expect(cut.grid).toEqual(added.grid);
    expect(cut.selection).toEqual(added.selection);
    expect(stepSurface(cut.grid, cut.selection, "add").grid).toEqual(twice.grid);
  }
});
it("retains a virtual plane after deleting the last layer and restores it on add", () => {
  const selection: SurfaceSelection = { direction: "PY", cells: [[0, 0, 0]] };
  const cut = stepSurface([[0, 0, 0]], selection, "remove");
  expect(cut.grid).toEqual([]);
  expect(cut.selection.cells).toEqual([[0, -1, 0]]);
  expect(stepSurface(cut.grid, cut.selection, "remove")).toMatchObject({ changed: false, selection: cut.selection });
  expect(stepSurface([], cut.selection, "add")).toMatchObject({ grid: [[0, 0, 0]], selection });
});
it("anchors rectangles to their original plane, including reversed drags and signed axes", () => {
  for (const direction of DIRECTIONS) {
    const n = BASES[direction].n;
    const axis = n.findIndex(v => v !== 0);
    const end = [2, 2, 2] as Vec3;
    const rectangle = surfaceRectangle([0, 0, 0], end, direction);
    expect(rectangle.cells).toHaveLength(9);
    expect(rectangle.cells.every(c => c[axis] === 0)).toBe(true);
    end[axis] = 0;
    expect(surfaceRectangle(end, [0, 0, 0], direction)).toEqual(rectangle);
  }
});
it("rejects oversized edits atomically and does not move the plane into obstructions or holes", () => {
  const selection: SurfaceSelection = { direction: "PY", cells: [[0, 31, 0]] };
  const grid: Vec3[] = [[0, 0, 0], [0, 31, 0]];
  expect(() => stepSurface(grid, selection, "add")).toThrow("32 cells");
  expect(grid).toHaveLength(2);
  expect(selection.cells).toEqual([[0, 31, 0]]);
  expect(() => surfaceRectangle([0, 0, 0], [32, 0, 0], "PY")).toThrow();
  const pair: SurfaceSelection = { direction: "PY", cells: [[0, 0, 0], [1, 0, 0]] };
  expect(stepSurface([[0, 0, 0]], pair, "remove").changed).toBe(false);
  expect(stepSurface([[0, 1, 0]], pair, "add").changed).toBe(false);
});
