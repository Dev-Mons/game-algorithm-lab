import {expect,it} from 'vitest';
import {buildingComponents} from '../src/core/buildings';
import {analyze,cellId,compareCells,normalizeGrid,type Vec3} from '../src/core/analysis';
import {box} from '../src/fixtures';
import {emptySceneInputs,validateSceneInputs} from '../src/core/scene-inputs';

// Independent world-coordinate flood fill catches local-key wraparound, split
// ownership and ordering errors at the supported span/coordinate boundaries.
function reference(input:Vec3[]){
  const cells=normalizeGrid(input),remaining=new Map(cells.map(c=>[cellId(c),c]));
  const parts:{id:string;cells:Vec3[]}[]=[];
  for(const root of cells){
    if(!remaining.delete(cellId(root)))continue;
    const members=[root];
    for(let i=0;i<members.length;i++)for(let axis=0;axis<3;axis++)for(const sign of [-1,1]){
      const next=[...members[i]] as Vec3;next[axis]+=sign;
      const key=cellId(next),cell=remaining.get(key);
      if(cell){remaining.delete(key);members.push(cell);}
    }
    parts.push({id:cellId(root),cells:members.sort(compareCells)});
  }
  return parts;
}
it('shared six-neighbour partition preserves world IDs without padded-axis wraparound',()=>{
  const shapes=[box(32,32,32),box(1,32,32),box(32,1,32),box(32,32,1),
    box(32,8,9).filter(([x,y,z])=>(x*11+y*7+z*3)%13<4),
    [[0,0,0],[0,0,31],[0,1,0],[0,31,31],[1,0,0],[31,31,31]] as Vec3[]];
  for(const shape of shapes)for(const offset of [-1_000_000,999_969]){
    const grid=shape.map(c=>c.map(n=>n+offset) as Vec3).reverse();
    expect(buildingComponents(grid)).toEqual(reference(grid));
  }
  const contacts:Vec3[]=[[0,0,0],[1,1,0],[2,2,1],[3,2,1]];
  const expected=reference(contacts),parts:unknown[]=[];
  analyze(contacts,result=>parts.push(...result));
  expect(parts).toEqual(expected);
});

it('validation-only scene union retains coordinate and combined-span rejection',()=>{
  expect(validateSceneInputs([[0,0,0]],{...emptySceneInputs(),roads:[[31,0,0]]}).roads).toEqual([[31,0,0]]);
  expect(()=>validateSceneInputs([[0,0,0]],{...emptySceneInputs(),roads:[[32,0,0]]})).toThrow('at most 32');
  expect(()=>validateSceneInputs([[0,0,0]],{...emptySceneInputs(),objects:[{id:'far',category:'facility',direction:'PY',cells:[[0,32,0]]}]})).toThrow('at most 32');
  expect(()=>validateSceneInputs([[0,0,0]],{...emptySceneInputs(),parkingAreas:[{id:'far',anchor:[0,0,32],cells:[[0,0,32]]}]})).toThrow('at most 32');
  expect(()=>validateSceneInputs([[.5,0,0]],emptySceneInputs())).toThrow('integers');
});
