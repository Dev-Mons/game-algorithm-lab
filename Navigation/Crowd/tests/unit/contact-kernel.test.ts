import { expect, it } from 'vitest';
import { ContactKernel } from '../../src/core/contact-kernel';
import { ContactColoring } from '../../src/core/contact-coloring';
import { WarmContactCache } from '../../src/core/warm-contact-cache';
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


it('matches stable JS color order and retains the complete list on native color overflow',()=>{
  const kernel=ContactKernel.create(()=>0,()=>{},false)!;kernel.ensure(100,512);
  const cases=[{a:Int32Array.from({length:400},(_,i)=>i%90),b:Int32Array.from({length:400},(_,i)=>i%90+1+i%9)},
    {a:new Int32Array(70),b:Int32Array.from({length:70},(_,i)=>i+1)}];
  for(const {a,b} of cases) {
    const aa=a.slice(),bb=b.slice(),color=new ContactColoring(),expected=color.order(aa,bb,a.length,100);
    kernel.arrays.a.set(a);kernel.arrays.b.set(b);
    expect(kernel.orderPairs(a.length,100)).toBe(expected);
    expect(kernel.arrays.a.subarray(0,a.length)).toEqual(aa);expect(kernel.arrays.b.subarray(0,b.length)).toEqual(bb);
    expect(kernel.arrays.colorStarts).toEqual(color.starts);
  }
  kernel.dispose();
});


it('includes alignment padding when a small body arena crosses a memory page boundary',()=>{
  const kernel=ContactKernel.create(()=>0,()=>{},false)!;
  kernel.ensure(1,0,12253);kernel.arrays.colorMasks.fill(7);
  expect(kernel.orderPairs(0,1)).toBe(0);expect([...kernel.arrays.colorMasks]).toEqual([0,0]);
  kernel.dispose();
});

it('reproduces warm hash collisions, basis changes, time scaling and growth without sharing checkpoint storage',()=>{
  const kernel=ContactKernel.create(()=>0,()=>{},false)!,actual=new WarmContactCache(),expected=new WarmContactCache();
  const agents=65538,pairs=[[0,1],[0,17],[0,33],[0,49],[65536,65537]];
  kernel.ensure(agents,pairs.length);
  const vx=new Float64Array(agents),vy=new Float64Array(agents),corrected=new Uint8Array(agents);
  for(let phase=0;phase<5;phase++) {
    actual.begin(phase===2?1024:pairs.length);expected.begin(phase===2?1024:pairs.length);
    const dt=phase%2?1/120:1/60,friction=.2,angle=phase*.1,nx=Math.cos(angle),ny=Math.sin(angle);
    kernel.arrays.vx.set(vx);kernel.arrays.vy.set(vy);kernel.arrays.corrected.set(corrected);
    for(const [pair,[a,b]] of pairs.entries()) {
      kernel.arrays.a[pair]=a!;kernel.arrays.b[pair]=b!;kernel.arrays.kind[pair]=1;
      kernel.arrays.nx[pair]=nx;kernel.arrays.ny[pair]=ny;
      const base=expected.add(a!*agents+b!,nx,ny,dt,friction),values=expected.values;
      const normal=values[base]!,tangent=values[base+1]!;
      if(normal===0&&tangent===0)continue;
      corrected[a!]=1;corrected[b!]=1;
      const ix=-normal*nx-tangent*ny,iy=-normal*ny+tangent*nx;
      vx[a!]=vx[a!]!+ix;vy[a!]=vy[a!]!+iy;vx[b!]=vx[b!]!-ix;vy[b!]=vy[b!]!-iy;
    }
    kernel.prepareWarm(actual,pairs.length,agents,dt,friction);
    expect(kernel.arrays.vx).toEqual(vx);expect(kernel.arrays.vy).toEqual(vy);expect(kernel.arrays.corrected).toEqual(corrected);
    expect(actual.currentTable.count).toBe(expected.currentTable.count);
    expect(actual.currentTable.keys).toEqual(expected.currentTable.keys);
    expect(actual.currentTable.used.subarray(0,pairs.length)).toEqual(expected.currentTable.used.subarray(0,pairs.length));
    for(const slot of expected.currentTable.used.subarray(0,pairs.length)) {
      for(let j=0;j<5;j++)expect(Object.is(actual.values[slot*5+j],expected.values[slot*5+j])).toBe(true);
      actual.values[slot*5]=expected.values[slot*5]=10+slot;actual.values[slot*5+1]=expected.values[slot*5+1]=.5;
    }
    actual.saveCurrent();const saved:number[]=[];actual.hashState(n=>saved.push(n));
    kernel.arrays.warmValues.fill(99);actual.restoreCurrent();const restored:number[]=[];actual.hashState(n=>restored.push(n));
    expect(restored).toEqual(saved);
  }
  kernel.dispose();
});
