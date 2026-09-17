import {createDocument,setBuildingRule} from './core/document';
import {emptySceneInputs} from './core/scene-inputs';
import type {Vec3} from './core/analysis';
import {box} from './fixtures';
export const PARKING_FIXTURE_IDS=['R12','R30','L16','O30','D12','boundary'] as const;
export type ParkingFixtureId=typeof PARKING_FIXTURE_IDS[number];
export function parkingFixture(id:ParkingFixtureId){
  const width=id==='R12'?12:id==='L16'?16:id==='D12'?28:id==='boundary'?32:30,depth=id==='R12'||id==='D12'?12:id==='L16'?16:id==='boundary'?28:20;
  const scene=emptySceneInputs();
  let cells=box(width,1,depth);
  if(id==='L16')cells=cells.filter(([x,,z])=>x<8||z<8);
  if(id==='D12')cells=cells.filter(([x])=>x<12||x>=16);
  scene.parkingAreas=[{id,anchor:[0,0,0],cells}];scene.roads=box(width,1,4).map(([x,y,z])=>[x,y,z-4]);
  const obstacles=id==='O30'||id==='boundary'?box(3,1,3).map(([x,y,z])=>[x+13,y,z+(id==='O30'?8:12)] as Vec3):[];
  let document=createDocument(obstacles,42,'office',undefined,undefined,scene);
  if(obstacles.length)document=setBuildingRule(document,obstacles[0].join(','),'parking');
  return document;
}
export const PARKING_QUALITY_TARGETS={R12:{minimum:8,aisleRatio:.60},R30:{minimum:40,aisleRatio:.60},L16:{minimum:10,aisleRatio:.65},O30:{minimum:32,aisleRatio:.65},D12:{minimum:16,aisleRatio:.65}};
