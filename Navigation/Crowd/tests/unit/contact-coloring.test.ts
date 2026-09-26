import { expect,it } from 'vitest';
import { ContactColoring } from '../../src/core/contact-coloring';

it('forms deterministic body-disjoint groups while retaining every pair once',()=>{
  const sourceA:number[]=[],sourceB:number[]=[],agents=100;
  for(let a=0;a<agents;a++)for(let offset=1;offset<=12;offset++)if(a+offset<agents){sourceA.push(a);sourceB.push(a+offset);}
  const color=new ContactColoring(),a=new Int32Array(sourceA),b=new Int32Array(sourceB);
  const groups=color.order(a,b,a.length,agents);expect(groups).toBeGreaterThan(1);
  for(let group=0;group<groups;group++) {
    const used=new Set<number>();
    for(let pair=color.starts[group]!;pair<color.starts[group+1]!;pair++) {
      expect(used.has(a[pair]!)).toBe(false);expect(used.has(b[pair]!)).toBe(false);
      used.add(a[pair]!);used.add(b[pair]!);
    }
  }
  const expected=sourceA.map((x,i)=>x*agents+sourceB[i]!).sort((x,y)=>x-y);
  expect([...a].map((x,i)=>x*agents+b[i]!).sort((x,y)=>x-y)).toEqual(expected);
  const second=new ContactColoring(),aa=new Int32Array(sourceA),bb=new Int32Array(sourceB);
  expect(second.order(aa,bb,aa.length,agents)).toBe(groups);expect(aa).toEqual(a);expect(bb).toEqual(b);
});

it('keeps the uncapped original order when a high-degree star exceeds the group budget',()=>{
  const a=new Int32Array(70),b=Int32Array.from({length:70},(_,i)=>i+1),savedA=a.slice(),savedB=b.slice();
  const color=new ContactColoring();expect(color.order(a,b,70,71)).toBe(0);
  expect(a).toEqual(savedA);expect(b).toEqual(savedB);
  const aa=new Int32Array([0,1,2,3]),bb=new Int32Array([1,2,3,0]);
  expect(color.order(aa,bb,4,4)).toBe(2);expect([...aa]).toEqual([0,2,1,3]);expect([...bb]).toEqual([1,3,2,0]);
});
