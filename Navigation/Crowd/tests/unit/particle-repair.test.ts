import { describe, expect, it } from 'vitest';
import { AreaTransfer } from '../../experiments/fluid-navigation/particles/area-transfer';
import { contactRows, sweptPenetration } from '../../experiments/fluid-navigation/particles/contacts';
import { createScene, validateScene } from '../../experiments/fluid-navigation/particles/fixtures';
import { measureGeometry } from '../../experiments/fluid-navigation/particles/metrics';
import { projectVelocity } from '../../experiments/fluid-navigation/particles/projection';
import { stateFromScene } from '../../experiments/fluid-navigation/particles/types';
import type { ParticleState } from '../../experiments/fluid-navigation/particles/types';

function state(points: number[][]): ParticleState {
  return {x: Float64Array.from(points,p => p[0]!),y: Float64Array.from(points,p => p[1]!),
    radius: Float64Array.from(points,p => p[2]!),mass: Float64Array.from(points,p => Math.PI*p[2]!**2),
    velocity: new Float64Array(points.length*2)};
}
describe('particle reference: conservation and derivatives', () => {
  it('conserves disk area with mixed radii and truncated boundary stencils', () => {
    const s = state([[.15,.4,.5],[3.14,2.76,1.1],[6.8,6.9,.3]]), f = new AreaTransfer(8,8,.75);
    f.scatter(s);
    expect(f.phi.reduce((a,b) => a+b,0)*f.h**2).toBeCloseTo(s.mass.reduce((a,b) => a+b,0),12);
    const velocity = Float64Array.from([.3,-.2,.5,.6,-.7,.4]);
    const jv = f.jacobian(velocity);
    expect(jv.reduce((a,b) => a+b,0)*f.h**2).toBeCloseTo(0,12);
    const pressure = Float64Array.from(f.phi,(_,i) => Math.sin(i));
    const transpose = f.transpose(pressure,s.x.length);
    const dot = (a: Float64Array,b: Float64Array) => a.reduce((sum,v,i) => sum+v*b[i]!,0);
    expect(dot(jv,pressure)).toBeCloseTo(dot(velocity,transpose),12);
    const plus = new AreaTransfer(8,8,.75), minus = new AreaTransfer(8,8,.75), epsilon = 1e-5;
    const translated = (sign: number) => ({...s,
      x: Float64Array.from(s.x,(x,i) => x+sign*epsilon*velocity[2*i]!),
      y: Float64Array.from(s.y,(y,i) => y+sign*epsilon*velocity[2*i+1]!)});
    plus.scatter(translated(1)); minus.scatter(translated(-1));
    expect(Math.max(...jv.map((v,i) => Math.abs(v-(plus.phi[i]!-minus.phi[i]!)/(2*epsilon))))).toBeLessThan(1e-8);
  });
  it('has consistent capacity across subcell shifts of a legal dense lattice', () => {
    const s = stateFromScene(createScene('uniform'));
    const maxima: number[] = [];
    for (const shift of [0,.25,.5,.75]) {
      const f = new AreaTransfer(40,40);
      f.scatter(s,shift,shift*.5); maxima.push(Math.max(...f.phi));
    }
    expect(Math.max(...maxima)).toBeLessThan(.82);
    expect(Math.max(...maxima)-Math.min(...maxima)).toBeLessThan(.03);
  });
});

describe('joint projection against independent analytic solutions', () => {
  it('returns the known symmetric pair solution and a safe continuous path', () => {
    const s = state([[3,3,.5],[4.1,3,.5]]), preferred = Float64Array.from([1,0,-1,0]);
    const rows = contactRows(s,.1,2,{minX: 0,minY: 0,maxX: 10,maxY: 10});
    const result = projectVelocity(preferred,s.mass,rows,2);
    expect(result.converged).toBe(true);
    expect(result.velocity[0]).toBeCloseTo(.5,10); expect(result.velocity[2]).toBeCloseTo(-.5,10);
    expect(sweptPenetration(s,result.velocity,.1)).toBeLessThan(1e-10);
    const half = projectVelocity(preferred,s.mass,contactRows(s,.05,2,{minX: 0,minY: 0,maxX: 10,maxY: 10}),2);
    expect(half.velocity[0]).toBeCloseTo(1,10);
  });
  it('jointly satisfies a halfspace and speed ball at the analytic intersection', () => {
    const rows = [{indices: [0],values: [-1],bound: -.8,kind: 'wall' as const}];
    const result = projectVelocity(Float64Array.from([0,2]),Float64Array.from([1]),rows,1);
    expect(result.converged).toBe(true);
    expect(result.velocity[0]).toBeCloseTo(.8,6); expect(result.velocity[1]).toBeCloseTo(.6,6);
    expect(result.stationarity).toBeLessThan(1e-10);
    expect(projectVelocity(Float64Array.from([0,2]),Float64Array.from([1]),rows,1,1e-7,1).converged).toBe(false);
  });
  it('uses the exact quadratic-slack optimum instead of silently violating capacity', () => {
    const result = projectVelocity(Float64Array.from([2,0]),Float64Array.from([1]),
      [{indices: [0],values: [1],bound: 0,slackWeight: 4,kind: 'density'}],10);
    expect(result.converged).toBe(true);
    expect(result.velocity[0]).toBeCloseTo(.4,12); expect(result.slack[0]).toBeCloseTo(.4,12);
    expect(result.dual[0]).toBeCloseTo(1.6,12);
  });
  it('represents immobile coarse overcapacity as slack, with no ejection impulse', () => {
    const rows = [
      {indices: [],values: [],bound: -.1,slackWeight: 100,kind: 'density' as const},
      ...[0,1].flatMap(i => [-1,1].map(sign => ({indices: [i],values: [sign],bound: 0,kind: 'wall' as const}))),
    ];
    const result = projectVelocity(Float64Array.from([3,1]),Float64Array.from([1]),rows,6);
    expect(result.converged).toBe(true); expect([...result.velocity]).toEqual([0,0]);
    expect(result.maxSlack).toBeCloseTo(.1,12);
  });
  it('matches a coupled contact + density-slack analytic optimum', () => {
    // Contact forces the two velocities to agree; e=v0+v1. Minimizing
    // .5(z-2)^2 + .5(z+1)^2 + .5(2z)^2 gives z=1/6, e=1/3.
    const rows = [
      {indices: [0,2],values: [1,-1],bound: 0,kind: 'contact' as const},
      {indices: [0,2],values: [1,1],bound: 0,slackWeight: 1,kind: 'density' as const},
    ];
    const result = projectVelocity(Float64Array.from([2,0,-1,0]),Float64Array.from([1,1]),rows,4);
    expect(result.converged).toBe(true);
    expect(result.velocity[0]).toBeCloseTo(1/6,6); expect(result.velocity[2]).toBeCloseTo(1/6,6);
    expect(result.slack[1]).toBeCloseTo(1/3,6);
    expect(result.dual.every(v => v > 0)).toBe(true);
  });
  it('reports an exhausted budget on a strongly compressed real disk patch', () => {
    const scene = createScene('uniform');
    scene.disks = scene.disks.filter(p => p.x > 15 && p.x < 25 && p.y > 15 && p.y < 25);
    const s = stateFromScene(scene), f = new AreaTransfer(40,40), dt = .05;
    f.scatter(s);
    const preferred = Float64Array.from(s.velocity,(_,i) => -3*((i%2 ? s.y[i >> 1]! : s.x[i >> 1]!)-20));
    const density = f.constraints(dt,0,.72);
    const rows = [...density,...contactRows(s,dt,12,scene.world)];
    const bounded = projectVelocity(preferred,s.mass,rows,12);
    expect(bounded.converged).toBe(false);
    expect(bounded.iterations).toBe(200);
    // This stress case is retained as a known limitation, not accepted motion.
    // ParticleSimulation refuses to integrate an unconverged result.
    expect(bounded.dual.slice(0,density.length).some(v => v > 0)).toBe(true);
    expect(bounded.dual.slice(density.length).some(v => v > 0)).toBe(true);
    expect(Math.max(bounded.primal,bounded.complementarity)).toBeGreaterThan(1e-7);
  });
});

describe('independent physical geometry diagnostics', () => {
  it('distinguishes normal packing, enclosed void, and an exterior-connected crack', () => {
    const uniform = measureGeometry(stateFromScene(createScene('uniform')));
    const hole = measureGeometry(stateFromScene(createScene('hole')));
    const crack = measureGeometry(stateFromScene(createScene('crack')));
    expect(uniform.voidCount).toBe(0);
    expect(hole.voidArea).toBeGreaterThan(8); expect(hole.maxEmptyRadius).toBeGreaterThan(1.9);
    expect(crack.voidArea).toBeGreaterThan(8); expect(crack.maxEmptyRadius).toBeGreaterThan(.5);
    expect(hole.penetration).toBe(0); expect(crack.penetration).toBe(0);
  });
  it('rejects illegal initial states instead of repairing them during spawn', () => {
    const scene = createScene('uniform');
    scene.disks[1]!.x = scene.disks[0]!.x; scene.disks[1]!.y = scene.disks[0]!.y;
    expect(() => validateScene(scene)).toThrow('Overlapping spawn');
  });
});
