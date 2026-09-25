import { expect, it } from 'vitest';
import { WarmContactCache } from '../../src/core/warm-contact-cache';

it('retains colliding keys exactly, rescales time, drops absent contacts and resets both generations',()=>{
  const cache=new WarmContactCache();
  cache.begin(8);
  const keys=[1,17,33,49,2**32+1];
  for(let i=0;i<keys.length;i++) {
    const base=cache.add(keys[i]!,1,0,1/60,1);
    cache.values[base]=i+1;cache.values[base+1]=-.25*i;
  }
  cache.begin(8);
  for(let i=keys.length-1;i>=1;i--) {
    const base=cache.add(keys[i]!,1,0,1/120,1);
    expect(cache.values[base]).toBe((i+1)/2);expect(cache.values[base+1]).toBe(-.125*i);
  }
  cache.begin(64);
  expect(cache.values[cache.add(keys[0]!,1,0,1/120,1)]).toBe(0);
  expect(cache.values[cache.add(keys[1]!,0,1,1/120,1)]).toBe(0);
  cache.reset();cache.begin(8);
  for(const key of keys)expect(cache.values[cache.add(key,1,0,1/60,1)]).toBe(0);
});

it('keeps the world impulse fixed when a contact basis rotates within its friction cone',()=>{
  const cache=new WarmContactCache();cache.begin(1);
  let base=cache.add(7,1,0,1/60,1);
  cache.values[base]=10;cache.values[base+1]=2;
  cache.begin(1);
  const nx=Math.cos(.1),ny=Math.sin(.1);
  base=cache.add(7,nx,ny,1/60,1);
  const normal=cache.values[base]!,tangent=cache.values[base+1]!;
  expect(-normal*nx-tangent*ny).toBeCloseTo(-10,12);
  expect(-normal*ny+tangent*nx).toBeCloseTo(2,12);
});
