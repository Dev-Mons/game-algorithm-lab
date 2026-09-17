import {buildingComponents} from "../src/core/buildings";
import {createDocument,setBuildingRule,documentOptions} from '../src/core/document';
import {analyzeVolume,type Vec3} from '../src/core/generate';
import {emptySceneInputs,type ObjectInput} from '../src/core/scene-inputs';
import {preflightRule} from '../src/core/rule-spatial-adapters';
import {analyzeSpatial} from '../src/core/spatial-analysis';
import {AccessSearch} from '../src/core/access-graph';
export function spatialFixture(grid:Vec3[],roads:Vec3[],objects:ObjectInput[]=[],mask:Vec3[]=[]){
  const scene=emptySceneInputs();scene.roads=roads;scene.objects=objects;
  if(mask.length)scene.parkingAreas=[{id:'test-area',anchor:mask[0],cells:mask}];
  let document=createDocument(grid,42,'office',undefined,undefined,scene);
  for(const b of document.buildings)document=setBuildingRule(document,b.componentId,'parking');
  const analysis=analyzeVolume(grid,'region-context-v1');
  const envelopes=document.buildings.map(b=>({buildingId:b.componentId,envelope:preflightRule(b.rule,b.spatialAdapterRef,{componentId:b.componentId,cells:buildingComponents(grid).find(c=>c.id===b.componentId)!.cells,analysis,options:documentOptions(document),metadata:b.rule.metadata,design:b.design},[...grid,...roads,...objects.flatMap(o=>o.cells),...mask])}));
  const result=analyzeSpatial(document,analysis,envelopes);
  return {...result,document,analysis,search:new AccessSearch(result.spatial,document,result.book,result.solidIndex)};
}
