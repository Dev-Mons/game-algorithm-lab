import { expect, it } from "vitest";
import { analyzeRoads, roadPlacements } from "../src/core/roads";
import { createDocument, exportDocument, loadDocument } from "../src/core/document";
import { editRoads, editObjects } from "../src/scene-editor";
import { generateDocument } from "../src/core/generate-document";
import { DocumentHistory } from "../src/editor";
import { normalizeGrid, type Vec3 } from "../src/core/analysis";
const rect=(x:number,z:number,w:number,d:number):Vec3[]=>Array.from({length:w*d},(_,i)=>[x+i%w,0,z+Math.floor(i/w)]);
const selection=(cells:Vec3[])=>({direction:"PY" as const,cells:cells.map(([x,,z])=>[x,-1,z] as Vec3)});
it.each([1,2,3])("preserves %i-cell widths across corners and intersections with exact coverage", width=>{
  const horizontal=rect(-width,0,3*width,width), vertical=rect(0,-width,width,3*width);
  for(const [shape,cells] of [["cross",[...horizontal,...vertical]],["tee",[...horizontal,...rect(0,0,width,2*width)]],["corner",[...rect(0,0,2*width,width),...rect(0,0,width,2*width)]]] as const) {
    const grid=normalizeGrid(cells), modules=analyzeRoads(grid);
    expect(modules.some(m=>m.shape===shape && m.width===width)).toBe(true);
    expect(normalizeGrid(modules.flatMap(m=>m.cells))).toEqual(grid);
    expect(modules.reduce((n,m)=>n+m.cells.length,0)).toBe(grid.length);
    expect(modules.every(m=>m.width===width)).toBe(true);
    expect(analyzeRoads([...grid].reverse())).toEqual(modules);
  }
  const straight=analyzeRoads(rect(0,0,width,width*5));
  expect(straight.filter(m=>m.shape==="end")).toHaveLength(2);
  expect(straight.some(m=>m.shape==="straight")).toBe(true);
  expect(roadPlacements(rect(0,0,width,width*5)).some(p=>p.asset===`road.straight.${width}-lane`)).toBe(true);
});
it("last input owns cells, updates road topology/object context, preserves unrelated cells and history",()=>{
  let doc=editRoads(createDocument([],42,"shop"),selection(rect(0,0,3,5)),"add");
  const roads=doc;
  doc=editObjects(doc,selection([[1,0,2]]),"vegetation","add").document;
  expect(doc.sceneInputs?.roads).toHaveLength(14);
  const preview=generateDocument(doc,{mode:'development-preview'});
  expect(preview.environment?.spatial?.staticReservations.some(r=>r.kind==='solid'&&r.sourceRefs.some(s=>s.kind==='object'))).toBe(true);
  expect(preview.environment?.spatial?.roadArrivals.some(a=>a.nodeId==='1,0,2')).toBe(false);
  const history=new DocumentHistory(roads);history.commit(doc);
  expect(history.undo()).toEqual(roads);expect(history.redo()).toEqual(doc);
  expect(loadDocument(exportDocument(doc))).toEqual(doc);
  const restored=editRoads(doc,selection([[1,0,2]]),"add");
  expect(restored.sceneInputs?.roads).toHaveLength(15);expect(restored.sceneInputs?.objects).toHaveLength(0);
  expect(generateDocument(restored).scenePlacements).toEqual(generateDocument(roads).scenePlacements);
  const objects=editObjects(createDocument([]),selection(rect(0,0,3,1)),"facility","add").document;
  const cut=editRoads(objects,selection([[1,0,0]]),"add");
  expect(cut.sceneInputs?.objects.flatMap(o=>o.cells)).toEqual([[0,0,0],[2,0,0]]);
  expect(cut.grid).toEqual([]);
});
it("rejects elevated roads/building collision atomically and removes connections",()=>{
  const doc=createDocument([[0,0,0]]);
  expect(()=>editRoads(doc,selection([[0,0,0]]),"add")).toThrow();
  expect(()=>editRoads(doc,{direction:"PY",cells:[[0,0,0]]},"add")).toThrow();
  const grid=normalizeGrid([...rect(-1,0,3,1),...rect(0,-1,1,3)]);
  const cross=editRoads(createDocument([]),selection(grid),"add");
  const tee=editRoads(cross,selection([[0,0,-1]]),"remove");
  expect(analyzeRoads(tee.sceneInputs!.roads).some(m=>m.shape==="tee")).toBe(true);
});

it("keeps wide modules away from a local notch instead of inventing lane intersections",()=>{
  const grid=rect(0,0,2,5).filter(([x,,z])=>x!==1||z!==3);
  const modules=analyzeRoads(grid);
  expect(modules.find(m=>m.origin[0]===0&&m.origin[2]===0)?.width).toBe(2);
  expect(modules.filter(m=>m.origin[2]<2).some(m=>m.shape==="tee"||m.shape==="cross")).toBe(false);
  expect(normalizeGrid(modules.flatMap(m=>m.cells))).toEqual(normalizeGrid(grid));
});
