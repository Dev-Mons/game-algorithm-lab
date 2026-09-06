import { describe, expect, it } from 'vitest';
import { AgentBuffer } from '../../src/core/agent-state';
import { CrowdField } from '../../src/core/crowd-field';
import { CrowdFlowSolver, type CrowdFlowOptions } from '../../src/core/crowd-flow-solver';

const options: CrowdFlowOptions = {targetDensity: 8, pressureIterations: 8,
  pressureRelaxationTime: .25, velocityBlend: .65, maximumAcceleration: 210,
  maximumSpeed: 86, fixedDelta: 1/60};

describe('directional grid transport', () => {
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
