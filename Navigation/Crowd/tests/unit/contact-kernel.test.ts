import { expect, it } from 'vitest';
import { ContactKernel } from '../../src/core/contact-kernel';
import { SpatialHash } from '../../src/algorithms/spatial-hash/spatial-hash';

it('preserves full center-first pair order through mixed radii, inactive bodies and capacity growth',()=>{
  const count=300,grid=new SpatialHash(100,80,12,count),kernel=ContactKernel.create(()=>0,()=>{})!;
  expect(kernel).not.toBeNull();
  const x=new Float64Array(count),y=new Float64Array(count),radii=new Float64Array(count),active=new Uint8Array(count);
  for(let a=0;a<count;a++) {x[a]=(a*37%97)+1;y[a]=(a*19%77)+1;radii[a]=1+a%5;active[a]=a%13?1:0;}
  grid.rebuild(x,y,active);
  const scratch=new Int32Array(count),expectedA:number[]=[],expectedB:number[]=[];
  kernel.ensure(count,32,grid.cellStart.length);
  for(const padding of [0,1,10,64]) {
    expectedA.length=0;expectedB.length=0;let candidates=0,fallbacks=0,ownershipSkips=0;
    for(let a=0;a<count;a++)if(active[a]) {
      const n=grid.queryCandidates(x[a]!,y[a]!,radii[a]!+5+.4+padding,scratch);candidates+=n;if(n>=65)fallbacks++;
      for(let k=0;k<n;k++) {
        const b=scratch[k]!;if(b<=a){ownershipSkips++;continue;}
        const radius=radii[a]!+radii[b]!+.4+padding;
        if((x[b]!-x[a]!)**2+(y[b]!-y[a]!)**2>radius*radius)continue;
        expectedA.push(a);expectedB.push(b);
      }
    }
    let pairs=-1;
    while(pairs<0) {
      const data=kernel.arrays;
      data.x.set(x);data.y.set(y);data.radii.set(radii);data.active.set(active);
      data.cellStart.set(grid.cellStart);data.cellIndices.set(grid.agentIndices);
      pairs=kernel.exports.buildPairs(count,data.a.length,grid.columns,grid.rows,12,5,.4,padding);
      if(pairs<0)kernel.ensure(count,data.a.length*2);
    }
    expect([...kernel.arrays.a.subarray(0,pairs)]).toEqual(expectedA);
    expect([...kernel.arrays.b.subarray(0,pairs)]).toEqual(expectedB);
    expect(kernel.exports.pairCandidates()).toBe(candidates);
    expect(kernel.exports.pairFallbacks()).toBe(fallbacks);
    expect(kernel.exports.pairOwnershipSkips()).toBe(ownershipSkips);
    expect(kernel.arrays.x).toEqual(x);expect(kernel.arrays.y).toEqual(y);
  }
});


it('preserves body state and correction bookkeeping across arena capacity growth',()=>{
  const kernel=ContactKernel.create(()=>0,()=>{},false)!;kernel.ensure(100,8,32);
  const names=['x','y','vx','vy','radii','freeX','freeY','freeRadius','corrected','lengths','affected'] as const;
  for(const [i,name] of names.entries())kernel.arrays[name].fill(i+1);
  const before=names.map(name=>kernel.arrays[name].slice());
  const bytes=kernel.memory.buffer.byteLength;kernel.ensure(100,4096,512);
  expect(kernel.memory.buffer.byteLength).toBeGreaterThan(bytes);
  for(const [i,name] of names.entries())expect(kernel.arrays[name]).toEqual(before[i]);
  kernel.dispose();
});
