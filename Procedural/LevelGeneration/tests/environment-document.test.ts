import {expect,it} from "vitest";
import {createDocument,exportDocument,loadDocument,replaceGrid,replaceSceneInputs,setBuildingRule,setBuildingTheme} from "../src/core/document";
import {OFFICE_STYLE} from "../src/core/building-style";
import {emptySceneInputs} from "../src/core/scene-inputs";
import {box} from "../src/fixtures";
import {DocumentHistory} from "../src/editor";
import type {Vec3} from "../src/core/analysis";
import {generateDocument} from '../src/core/generate-document';

it.each(['shop','office','urban-shop'] as const)('migrates schema 5 %s volumes and drops retired tuning without affecting preset output',profile=>{
  const current=createDocument(box(4,6,3),42,profile),old=JSON.parse(exportDocument(current));
  old.schemaVersion=5;
  old.environment={version:1,units:{metersPerCell:9},access:{maxWalkDistanceCells:1}};
  old.buildingDefinition.bandPolicy={baseRatioPermille:{generic:200,retail:250,office:200,residential:167,industrial:200},crownRatioPermille:100,maxBaseCells:4,maxCrownCells:3,baseCountOverride:4,crownCountOverride:0};
  Object.assign(old.buildings[0].design,{use:'industrial',designSeed:999,columnMode:'column',overrides:{programId:'mixed-2',palette:'sage',familyId:'bay-4'}});
  const loaded=loadDocument(JSON.stringify(old));
  expect(loaded).toEqual(current);
  expect(generateDocument(loaded)).toEqual(generateDocument(current));
  expect(exportDocument(loaded)).not.toMatch(/"(?:environment|use|designSeed|columnMode|overrides|bandPolicy)":/);
});

it("roundtrips a concave semantic parking mask overlapping structure and facility intent",()=>{
  const inputs=emptySceneInputs();
  inputs.parkingAreas=[{id:"lot",anchor:[0,0,0],cells:box(6,1,6).filter(([x,,z])=>x<3||z<3)}];
  inputs.objects=[{id:"facility",category:"facility",direction:"PY",cells:[[1,0,1]]}];
  inputs.roads=[[-1,0,0]];
  let doc=createDocument([[0,0,0]],42,"shop",undefined,undefined,inputs);
  doc=setBuildingRule(doc,"0,0,0","parking");
  const text=exportDocument(doc),copy=structuredClone(doc);
  copy.sceneInputs.parkingAreas[0].cells.reverse();copy.grid.reverse();copy.buildings.reverse();
  expect(exportDocument(copy)).toBe(text);expect(loadDocument(text)).toEqual(doc);
  for(const updated of [replaceGrid(doc,[...doc.grid,[0,1,0]]),replaceSceneInputs(doc,doc.sceneInputs),setBuildingTheme(doc,"0,0,0",OFFICE_STYLE)]) {
    expect(updated).not.toHaveProperty('environment');expect(updated.sceneInputs.parkingAreas).toEqual(inputs.parkingAreas);
    expect(updated.buildings[0].design).toEqual(doc.buildings[0].design);
    expect(updated.buildings[0].spatialAdapterRef).toEqual(doc.buildings[0].spatialAdapterRef);
  }
  expect(text).not.toMatch(/"(plans|placements|reservations|traces|ledger|cache|timings)":/);
});
it("rejects old documents, missing current fields, overlapping masks, invalid settings and unknown fields",()=>{
  const doc=createDocument([[0,0,0]]);
  for(const version of [1,2,3,4]) expect(()=>loadDocument(JSON.stringify({...doc,schemaVersion:version}))).toThrow(/UNSUPPORTED_DOCUMENT_VERSION/);
  for(const mutate of [
    (d:any)=>d.sceneInputs.version=1,(d:any)=>d.environment={},(d:any)=>delete d.buildings[0].design,
    (d:any)=>d.buildings=[],

    (d:any)=>d.sceneInputs.objects.push({id:'old',category:'misc',direction:'PY',cells:[[1,0,0]]}),
    (d:any)=>d.sceneInputs.parkingAreas=[{id:'a',anchor:[1,0,0],cells:[[1,0,0]]},{id:'b',anchor:[1,0,0],cells:[[1,0,0]]}],
    (d:any)=>d.sceneInputs.parkingAreas=[{id:'a',anchor:[1,0,0],cells:[[1,1,0]]}],
    (d:any)=>d.buildings[0].design.unknown=true,
    (d:any)=>d.buildings[0].spatialAdapterRef.version='9.0.0',
  ]) {const bad=structuredClone(doc);mutate(bad);expect(()=>loadDocument(JSON.stringify(bad))).toThrow();}
  const bad=structuredClone(doc);bad.grid[0][0]=NaN;expect(()=>exportDocument(bad)).toThrow(/NON_FINITE/);
});
it("preserves unresolved roof intent, current save and Undo/Redo after support removal",()=>{
  const scene=emptySceneInputs();scene.objects=[{id:'roof',category:'lighting',direction:'PY',cells:[[0,1,0]]}];
  const before=createDocument([[0,0,0]],42,'office',undefined,undefined,scene),after=replaceGrid(before,[]);
  expect(after.sceneInputs).toEqual(scene);expect(loadDocument(exportDocument(after))).toEqual(after);
  const history=new DocumentHistory(before);history.commit(after);expect(history.undo()).toEqual(before);expect(history.redo()).toEqual(after);
});
it("inherits all design contracts by pre-edit volume, and split children keep the shared anchor",()=>{
  const a=box(4,3,2),b=box(2,5,1).map(([x,y,z])=>[x+5,y,z] as Vec3),grid=[...a,...b];
  let doc=createDocument(grid,42,'shop');doc=setBuildingRule(doc,'0,0,0','parking');
  doc.buildings[0].design={version:1,anchor:[-7,0,-2]};
  doc=loadDocument(exportDocument(doc));
  const joined=replaceGrid(doc,[...grid,[4,0,0]]);
  expect(joined.buildings).toHaveLength(1);expect(joined.buildings[0]).toEqual(doc.buildings[0]);
  const split=replaceGrid(joined,grid);
  expect(split.buildings.map(x=>x.design)).toEqual([doc.buildings[0].design,doc.buildings[0].design]);
  expect(split.buildings.every(x=>x.rule.id==='parking')).toBe(true);
});
