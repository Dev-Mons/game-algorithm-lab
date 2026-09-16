import { expect, it } from "vitest";
import { DocumentHistory, editBox, extrudeRegion } from "../src/editor";
import {
  createDocument,
  exportDocument,
  profileData,
} from "../src/core/document";
import { generate } from "../src/core/generate";

it("box add/delete handles overlap, negative coordinates and atomic limits", () => {
  const grid = editBox([], [-2, 0, -1], [3, 2, 3], "add");
  expect(grid).toHaveLength(18);
  expect(editBox(grid, [-2, 0, -1], [3, 2, 3], "add")).toEqual(grid);
  expect(editBox(grid, [-1, 0, 0], [1, 2, 1], "remove")).toHaveLength(16);
  expect(() => editBox(grid, [31, 0, 0], [3, 1, 1], "add")).toThrow("32 cells");
  expect(grid).toHaveLength(18);
  expect(() => editBox([], [0, 0, 0], [1.5, 1, 1], "add")).toThrow("정수");
});
it("region extrude/cut modifies the entire selected plane and regenerates valid coverage", () => {
  const grid = editBox([], [0, 0, 0], [3, 2, 3], "add"),
    result = generate(grid, { ...profileData("crafted-hip") });
  const top = result.regions!.find((r) => r.direction === "PY")!;
  const grown = extrudeRegion(grid, result, top.regionId, 2);
  expect(grown).toHaveLength(36);
  const grownResult = generate(grown, { ...profileData("crafted-hip") });
  const cut = extrudeRegion(
    grown,
    grownResult,
    grownResult.regions!.find((r) => r.direction === "PY")!.regionId,
    -2,
  );
  expect(cut).toEqual(grid);
  expect(() => extrudeRegion(grown, result, top.regionId, 1)).toThrow("일치");
  expect(() => extrudeRegion(grid, result, top.regionId, 32)).toThrow();
  const side = result.regions!.find((r) => r.direction === "NX")!;
  expect(extrudeRegion(grid, result, side.regionId, 1)).toHaveLength(24);
});
it("history preserves full documents, branches correctly, skips no-ops and bounds memory", () => {
  const a = createDocument([], 42, "crafted-hip"),
    b = createDocument([[0, 0, 0]], 12, "crafted-gable"),
    c = createDocument([[1, 0, 0]], 5, "village");
  const history = new DocumentHistory(a, 2);
  expect(history.commit(a)).toBe(false);
  history.commit(b);
  history.commit(c);
  expect(exportDocument(history.undo()!)).toBe(exportDocument(b));
  expect(exportDocument(history.undo()!)).toBe(exportDocument(a));
  expect(history.undo()).toBeUndefined();
  expect(exportDocument(history.redo()!)).toBe(exportDocument(b));
  history.commit(a);
  expect(history.canRedo).toBe(false);
  const bounded = new DocumentHistory(a, 1);
  bounded.commit(b);
  bounded.commit(c);
  expect(bounded.undo()).toEqual(b);
  expect(bounded.canUndo).toBe(false);
});
