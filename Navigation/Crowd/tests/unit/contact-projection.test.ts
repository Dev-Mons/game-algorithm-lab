import { expect, it } from 'vitest';
import { AgentBuffer } from '../../src/core/agent-state';
import { ContactProjection } from '../../src/core/contact-projection';
import { ExternalInfluences } from '../../src/core/external-influences';
import { StaticObstacleIndex } from '../../src/core/static-obstacle-index';
import { StaticFreeSpace } from '../../src/core/static-free-space';
import { SpatialHash } from '../../src/algorithms/spatial-hash/spatial-hash';
import type { CrowdMovementInput } from '../../src/core/crowd-movement-solver';
import type { Rect } from '../../src/core/types';
import { distanceSquaredToRect } from '../../src/core/obstacle-collision';

function fixture(obstacles:Rect[]=[]) {
  const state=new AgentBuffer(5);state.active.fill(1);state.y.fill(250);state.vx.fill(50);
  state.x.set([200,205.6,211.55,217.5,223.45]);
  const input={next:state,index:new SpatialHash(500,500,12,5),worldWidth:500,worldHeight:500,
    agentRadius:3.2,maxAgentRadius:3.2,wallClearance:3.55,obstacles,external:new ExternalInfluences(5,500,500)} as unknown as CrowdMovementInput;
  const index=new StaticObstacleIndex();index.update(obstacles);
  const free=new StaticFreeSpace(index);free.begin(5,500,500);
  for(let a=0;a<5;a++)free.prepare(a,state.x[a]!,state.y[a]!,3.55);
  return {state,input,index,free};
}
function run(f:ReturnType<typeof fixture>) {
  return new ContactProjection().solve(f.input,f.index,f.free,Int32Array.of(0),Int32Array.of(1),1,.45,3.2,
    (a,dx,dy)=>{f.state.x[a]=f.state.x[a]!+dx;f.state.y[a]=f.state.y[a]!+dy;});
}
it('projects a contact chain collectively without creating velocity or worsening any pair',()=>{
  const f=fixture(),before=[...f.state.x],center=before.reduce((a,b)=>a+b,0);
  expect(run(f)).toBe(1);
  for(let a=0;a<5;a++)for(let b=a+1;b<5;b++) {
    const after=Math.hypot(f.state.x[a]!-f.state.x[b]!,f.state.y[a]!-f.state.y[b]!);
    expect(6.4-after).toBeLessThanOrEqual(.45+1e-10);
  }
  expect(f.state.x.reduce((a,b)=>a+b,0)).toBeCloseTo(center,9);
  expect([...f.state.vx]).toEqual([50,50,50,50,50]);
  expect(f.input.external!.stats.projectedBodies).toBe(5);
});
it('chooses a wall tangent when radial translations are blocked without penetrating the wall',()=>{
  const left={x:190,y:100,width:6.45,height:300};
  const f=fixture([left]);expect(run(f)).toBe(1);
  for(let a=0;a<5;a++)expect(distanceSquaredToRect(f.state.x[a]!,f.state.y[a]!,left)).toBeGreaterThanOrEqual((3.55-1e-8)**2);
  const blocked=fixture([left,{x:227,y:100,width:10,height:300}]);
  expect(run(blocked)).toBe(1);
  for(let a=0;a<5;a++)for(const wall of blocked.input.obstacles)expect(distanceSquaredToRect(blocked.state.x[a]!,blocked.state.y[a]!,wall)).toBeGreaterThanOrEqual((3.55-1e-8)**2);
});
it('does not translate a contact group into a prescribed circular body',()=>{
  const f=fixture();f.state.x.set([200,205,210.95,216.9,222.85]);
  f.input.external!.proxies.push({body:'body',x:178.8,y:250,toX:178.8,toY:250,radius:18});
  expect(run(f)).toBe(1);
  for(let a=0;a<5;a++)expect(21.2-Math.hypot(f.state.x[a]!-178.8,f.state.y[a]!-250)).toBeLessThanOrEqual(.45);
});
it('rejects a fully blocked group without partially moving its members',()=>{
  const f=fixture([{x:190,y:100,width:6.45,height:300},{x:227,y:100,width:10,height:300},
    {x:190,y:240,width:47,height:6.45},{x:190,y:253.55,width:47,height:6.45}]);
  const before=[...f.state.x,...f.state.y];expect(run(f)).toBe(0);
  expect([...f.state.x,...f.state.y]).toEqual(before);
});
