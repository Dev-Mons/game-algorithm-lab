import { describe, expect, it } from 'vitest';
import { AgentBuffer } from '../../src/core/agent-state';
import { CrowdField } from '../../src/core/crowd-field';
import { CrowdFlowSolver, type CrowdFlowOptions } from '../../src/core/crowd-flow-solver';

const options: CrowdFlowOptions = {targetDensity: 8, pressureIterations: 8,
  pressureRelaxationTime: .25, velocityBlend: .65, maximumAcceleration: 210,
  maximumSpeed: 86, fixedDelta: 1/60};

describe('directional grid transport', () => {
  it('observes pushed physical velocity through the ordinary grid transport', () => {
    const field = new CrowdField(96,96,16), solver = new CrowdFlowSolver(field), state = new AgentBuffer(1);
    state.active[0]=1;state.x[0]=48;state.y[0]=48;state.intentX[0]=1;state.vx[0]=-500;
    field.update(state,8,1/60);
    expect(sum(field.momentumX)).toBeCloseTo(-500,8);
    const desired=new Float64Array([86]);
    solver.solve(state,desired,new Float64Array(1),options);
    expect(sum(solver.momentumX)).toBeCloseTo(-500,8);expect(state.vx[0]).toBe(-500);
    expect(desired[0]).toBeGreaterThan(0);
  });
  it('conserves deposited mass, momentum and navigation velocity with two angular weights', () => {
    const field = new CrowdField(96,96,16);
    const solver = new CrowdFlowSolver(field);
    const state = new AgentBuffer(1);
    state.active[0]=1;
    state.x[0]=29; state.y[0]=37;
    state.vx[0]=12; state.vy[0]=-4;
    state.intentX[0]=Math.cos(.3); state.intentY[0]=Math.sin(.3);
    field.update(state,8,1/60);
    solver.solve(state,new Float64Array([30]),new Float64Array([20]),options);
    expect(sum(solver.mass)).toBeCloseTo(1,12);
    expect(sum(solver.momentumX)).toBeCloseTo(12,12);
    expect(sum(solver.momentumY)).toBeCloseTo(-4,12);
    expect(sum(solver.desiredX)).toBeCloseTo(30,12);
    expect(sum(solver.desiredY)).toBeCloseTo(20,12);
    expect(sum(solver.pressure)).toBe(0);
  });

  it('keeps opposing velocities distinct even when net grid momentum is zero', () => {
    const field = new CrowdField(96,96,16);
    const solver = new CrowdFlowSolver(field);
    const state = new AgentBuffer(2);
    state.active.fill(1); state.x.fill(48); state.y.fill(48);
    state.intentX.set([1,-1]); state.vx.set([40,-40]);
    field.update(state,8,1/60);
    const x = new Float64Array([40,-40]);
    const y = new Float64Array(2);
    solver.solve(state,x,y,options);
    expect(x[0]).toBeCloseTo(40,10);
    expect(x[1]).toBeCloseTo(-40,10);
    expect(sum(solver.momentumX)).toBeCloseTo(0,12);
  });

  it('propagates positive capacity pressure and reduces predicted compression', () => {
    const field = new CrowdField(144,80,16);
    const solver = new CrowdFlowSolver(field);
    const state = new AgentBuffer(45);
    const x = new Float64Array(45);
    const y = new Float64Array(45);
    state.active.fill(1);
    for (let i=0;i<45;i++) {
      state.x[i]=(i%9+.5)*16; state.y[i]=(Math.floor(i/9)+.5)*16;
      state.intentX[i]=i%9<4 ? 1 : -1;
      x[i]=state.intentX[i]!*40;
      state.vx[i]=x[i]!;
    }
    field.update(state,1,1/60);
    solver.solve(state,x,y,{...options,targetDensity:1});
    const compression = (values: Float64Array) => Array.from(values).reduce((s,v)=>s+Math.max(0,-v),0);
    expect(compression(solver.correctedDivergence)).toBeLessThan(compression(solver.divergence));
    expect(sum(solver.pressure)).toBeGreaterThan(0);
    // Pressure reaches cells behind the compression front through fixed passes.
    expect(solver.pressure[2*9+2]).toBeGreaterThan(0);
    expect(Array.from(solver.pressure).every(v=>v>=0 && Number.isFinite(v))).toBe(true);
  });

  it('masks thin static walls between unblocked cell centers', () => {
    const field = new CrowdField(96,64,16);
    const obstacles = [{x:31,y:0,width:2,height:64}];
    field.setObstacles(obstacles,1);
    const solver = new CrowdFlowSolver(field);
    solver.setObstacles(obstacles,1);
    expect(field.blocked[1]).toBe(0);
    expect(field.blocked[2]).toBe(0);
    for (let row=0;row<field.rows;row++) expect(solver.openRight[row*6+1]).toBe(0);
    const state = new AgentBuffer(1);
    state.active[0]=1; state.x[0]=29.9; state.y[0]=24; state.intentX[0]=1;
    field.update(state,1,1/60);
    solver.solve(state,new Float64Array([86]),new Float64Array(1),options);
    expect(Array.from(solver.pressure).every(Number.isFinite)).toBe(true);
    expect(solver.mass[1*6+2]).toBe(0);
    expect(sum(solver.mass)).toBeCloseTo(1,12);
  });
});

function sum(values: Float64Array): number { return values.reduce((s,v)=>s+v,0); }


describe('exact pressure frontier',()=>{
  it('covers each Jacobi propagation layer and rebuilds its closure after wall edits',()=>{
    const field=new CrowdField(128,16,16),solver=new CrowdFlowSolver(field),state=new AgentBuffer(0);
    field.density.fill(1);field.density[0]=2;
    const solve=(iterations:number)=>solver.solve(state,new Float64Array(0),new Float64Array(0),{...options,targetDensity:1,pressureIterations:iterations});
    solve(3);expect([...solver.pressure].map(p=>p>0)).toEqual([true,true,true,false,false,false,false,false]);
    const walls=[{x:47,y:0,width:2,height:16}];field.setObstacles(walls,1);solver.setObstacles(walls,1);
    solve(8);expect([...solver.pressure].map(p=>p>0)).toEqual([true,true,true,false,false,false,false,false]);
    field.setObstacles([],1);solver.setObstacles([],1);solve(8);
    expect([...solver.pressure].every(p=>p>0)).toBe(true);
  });
  it('matches the exhaustive Jacobi path, including nonfinite fallback, without changing grid bytes',()=>{
    const field=new CrowdField(96,64,16),actual=new CrowdFlowSolver(field),expected=new CrowdFlowSolver(field);
    Object.defineProperty(expected,'pressureWorkset',{value:()=>-1});
    const state=new AgentBuffer(40);state.active.fill(1);
    for(let a=0;a<40;a++){state.x[a]=8+(a*17%80);state.y[a]=8+(a*13%48);state.intentX[a]=a%2?1:-1;state.vx[a]=a%2?40:-40;}
    for(const iterations of [0,1,2,8,9]) {
      field.update(state,1,1/60);
      const x=state.vx.slice(),xx=x.slice(),y=new Float64Array(40),yy=y.slice();
      actual.solve(state,x,y,{...options,targetDensity:1,pressureIterations:iterations});expected.solve(state,xx,yy,{...options,targetDensity:1,pressureIterations:iterations});
      expect(x).toEqual(xx);expect(y).toEqual(yy);
      for(const name of ['mass','momentumX','momentumY','desiredX','desiredY','velocityX','velocityY','pressure','divergence','correctedDivergence'] as const)expect(actual[name]).toEqual(expected[name]);
    }
    field.density[5]=Infinity;
    actual.solve(state,state.vx.slice(),state.vy.slice(),options);expected.solve(state,state.vx.slice(),state.vy.slice(),options);
    expect(actual.pressureWorksetFallback).toBe(true);expect(actual.pressure).toEqual(expected.pressure);
  });
});


it('reuses transfer buffers without stale entries through walls, signed headings, partial weights and growth',()=>{
  const field=new CrowdField(96,64,16),actual=new CrowdFlowSolver(field);
  for(const [phase,count] of [0,1,65,4097,10,5000].entries()) {
    const expected=new CrowdFlowSolver(field);
    const walls=phase%2?[{x:31,y:0,width:2,height:64}]:[];
    field.setObstacles(walls,1);actual.setObstacles(walls,1);expected.setObstacles(walls,1);
    for(let i=0;i<field.cellCount;i++)field.density[i]=(i*13+phase)%17/2;
    const state=new AgentBuffer(count),area=new Float64Array(Math.max(0,count-2)),external=new Uint8Array(Math.max(0,count-3));
    const x=new Float64Array(count+7),y=new Float64Array(count+7);
    for(let a=0;a<count;a++) {
      state.active[a]=a%11?1:0;state.x[a]=(a*13.7+phase)%120-12;state.y[a]=(a*17.9+phase)%88-12;
      const angle=(a%17-8)*Math.PI/8;
      state.intentX[a]=a%7?Math.cos(angle):-0;state.intentY[a]=a%7?Math.sin(angle):0;
      state.vx[a]=(a%13-6)*9;state.vy[a]=(a%11-5)*7;x[a]=state.intentX[a]!*86;y[a]=state.intentY[a]!*86;
      if(a<area.length)area[a]=a%3?1:4;if(a<external.length)external[a]=a%7===0?1:0;
    }
    x.fill(123,count);y.fill(-456,count);const xx=x.slice(),yy=y.slice();
    const settings={...options,targetDensity:1,pressureIterations:phase+1,maximumSpeed:phase===4?0:86,areaWeights:area};
    actual.solve(state,x,y,settings);expected.solve(state,xx,yy,settings);
    const same=(a:Float64Array,b:Float64Array)=>expect(new Uint8Array(a.buffer,a.byteOffset,a.byteLength)).toEqual(new Uint8Array(b.buffer,b.byteOffset,b.byteLength));
    same(x,xx);same(y,yy);
    for(const name of ['mass','momentumX','momentumY','desiredX','desiredY','velocityX','velocityY','pressure','divergence','correctedDivergence'] as const)same(actual[name],expected[name]);
  }
});
