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

it('matches exhaustive frontiers after dense groups cross spatial cells',()=>{
  const count=96,a:number[]=[],b:number[]=[];
  for(let i=0;i<count;i++)for(let j=i+1;j<count;j++){a.push(i);b.push(j);}
  const make=(exhaustive:boolean)=>{
    const state=new AgentBuffer(count);state.active.fill(1);
    for(let i=0;i<count;i++){state.x[i]=12.01+(i%12)*.5;state.y[i]=12.01+Math.floor(i/12)*.5;}
    const grid=new SpatialHash(500,500,12,count);
    if(exhaustive)grid.queryCandidates=(_x,_y,_range,output,maximum=output.length)=>{
      const n=Math.min(count,maximum,output.length);
      for(let i=0;i<n;i++)output[i]=count-1-i;
      return n;
    };
    const input={next:state,index:grid,worldWidth:500,worldHeight:500,agentRadius:3.2,maxAgentRadius:3.2,
      wallClearance:3.55,obstacles:[],external:new ExternalInfluences(count,500,500)} as unknown as CrowdMovementInput;
    const index=new StaticObstacleIndex();index.update([]);
    const free=new StaticFreeSpace(index);free.begin(count,500,500);
    const projected=new ContactProjection().solve(input,index,free,Int32Array.from(a),Int32Array.from(b),a.length,.45,3.2,
      (i,dx,dy)=>{state.x[i]=state.x[i]!+dx;state.y[i]=state.y[i]!+dy;});
    return {state,projected};
  };
  const actual=make(false),expected=make(true);
  expect(actual.projected).toBeGreaterThan(1);expect(actual.projected).toBe(expected.projected);
  expect(actual.state.x).toEqual(expected.state.x);expect(actual.state.y).toEqual(expected.state.y);
});

it('preserves every pair outside the residual list during certified collective movement',()=>{
  const count=25,state=new AgentBuffer(count),radii=Float64Array.from({length:count},(_,i)=>[1.6,2,2.4][i%3]!);
  state.active.fill(1);
  for(let a=0;a<count;a++){state.x[a]=26+(a%5)*3.1;state.y[a]=25+Math.floor(a/5)*3.1;}
  const obstacles=[{x:20,y:15,width:3,height:45}],index=new StaticObstacleIndex();index.update(obstacles);
  const free=new StaticFreeSpace(index);free.begin(count,80,80);
  for(let a=0;a<count;a++)free.prepare(a,state.x[a]!,state.y[a]!,radii[a]!);
  const external=new ExternalInfluences(count,80,80);external.proxies.push({body:'stationary',x:45,y:30,toX:45,toY:30,radius:3});
  const input={next:state,index:new SpatialHash(80,80,12,count),worldWidth:80,worldHeight:80,
    agentRadius:2,maxAgentRadius:2.4,agentRadii:radii,wallClearance:2,obstacles,external} as unknown as CrowdMovementInput;
  const pairs:number[][]=[],a:number[]=[],b:number[]=[],tolerance=.45;
  for(let i=0;i<count;i++)for(let j=i+1;j<count;j++){
    const depth=radii[i]!+radii[j]!-Math.hypot(state.x[i]!-state.x[j]!,state.y[i]!-state.y[j]!);
    pairs.push([i,j,depth]);
    // Deliberately omit every initially safe pair: the swept frontier must
    // protect these through its independent spatial query, not this list.
    if(depth>tolerance){a.push(i);b.push(j);}
  }
  const projection=new ContactProjection();
  const groups=projection.solve(input,index,free,new Int32Array(a),new Int32Array(b),a.length,tolerance,1.6,
    (id,dx,dy)=>{state.x[id]=state.x[id]!+dx;state.y[id]=state.y[id]!+dy;});
  expect(groups).toBeGreaterThan(0);
  for(const [i,j,depth] of pairs){
    const now=radii[i!]!+radii[j!]!-Math.hypot(state.x[i!]!-state.x[j!]!,state.y[i!]!-state.y[j!]!);
    expect(now).toBeLessThanOrEqual(Math.max(tolerance,depth!)+1e-8);
  }
  for(let i=0;i<count;i++){
    expect(distanceSquaredToRect(state.x[i]!,state.y[i]!,obstacles[0]!)).toBeGreaterThanOrEqual((radii[i]!-1e-8)**2);
    expect(radii[i]!+3-Math.hypot(state.x[i]!-45,state.y[i]!-30)).toBeLessThanOrEqual(tolerance+1e-8);
  }
});

