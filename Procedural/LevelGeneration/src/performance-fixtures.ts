import {createDocument} from './core/document';
import {emptySceneInputs} from './core/scene-inputs';
import {parkingFixture} from './parking-fixtures';
import {box} from './fixtures';
export function environmentPerformanceFixtures(){
 const scene=emptySceneInputs();scene.roads=box(28,1,4).map(([x,y,z])=>[x,y,z-5]);scene.objects=[{id:'facilities',category:'facility',direction:'PY',cells:box(32,1,2).map(([x,y,z])=>[x,y,z-7])}];
 const annex=createDocument([...box(8,8,8),...box(4,3,6).map(([x,y,z])=>[x+8,y,z] as [number,number,number]),...box(6,6,8).map(([x,y,z])=>[x+18,y,z] as [number,number,number]),...box(4,2,6).map(([x,y,z])=>[x+24,y,z] as [number,number,number])],42,'office',undefined,undefined,scene);
 return {R30:parkingFixture('R30'),building:createDocument(box(16,8,16),42),annex,boundary:parkingFixture('boundary'),dense:createDocument(box(32,32,32),42)};
}
