import { expect, it } from "vitest";
import { createDocument, setBuildingTheme, replaceGrid, exportDocument, loadDocument } from "../src/core/document";
import { generateDocument } from "../src/core/generate-document";
import { SHOP_STYLE, OFFICE_STYLE } from "../src/core/building-style";
import { DocumentHistory } from "../src/editor";
import type { Vec3 } from "../src/core/analysis";

it("changes only the selected building and preserves volume and history", () => {
  const doc = createDocument([[0,0,0],[3,0,0]], 42, "shop");
  const next = setBuildingTheme(doc, "0,0,0", OFFICE_STYLE);
  expect(next.grid).toEqual(doc.grid);
  expect(next.buildings.find(b=>b.componentId==='3,0,0')).toEqual(doc.buildings.find(b=>b.componentId==='3,0,0'));
  expect(next.buildings[0].theme?.id).toBe('office');
  const history = new DocumentHistory(doc); history.commit(next);
  expect(history.undo()).toEqual(doc); expect(history.redo()).toEqual(next);
  expect(loadDocument(exportDocument(next))).toEqual(next);
});
it("merges by pre-edit volume, splits inherit, and equal volumes use numeric coordinate order", () => {
  const grid: Vec3[] = [[0,0,0],[0,1,0],[2,0,0]];
  let doc = setBuildingTheme(setBuildingTheme(createDocument(grid, 42, "shop"), "0,0,0", OFFICE_STYLE), "2,0,0", SHOP_STYLE);
  const joined = replaceGrid(doc, [...grid,[1,0,0]]);
  expect(joined.buildings).toHaveLength(1); expect(joined.buildings![0].theme?.id).toBe("office");
  expect(replaceGrid(joined, grid).buildings?.map(b => b.theme?.id)).toEqual(["office","office"]);
  const history = new DocumentHistory(doc); history.commit(joined);
  expect(history.undo()).toEqual(doc); expect(loadDocument(exportDocument(history.redo()!))).toEqual(joined);
  doc = setBuildingTheme(setBuildingTheme(createDocument([[2,0,0],[0,0,0]], 42, "shop"), "2,0,0", SHOP_STYLE), "0,0,0", OFFICE_STYLE);
  expect(replaceGrid(doc, [[2,0,0],[1,0,0],[0,0,0]]).buildings![0].theme?.id).toBe("office");
});
