import { describe, expect, it } from 'vitest';
import { CrowdKernel, DEFAULT_CROWD_CONFIG, type KinematicCircle } from '../../src/core';

function scene(halfLife = 0, maxSpeed = 18, count = 1): CrowdKernel {
  const kernel = new CrowdKernel({ ...DEFAULT_CROWD_CONFIG, maxSpeed, maxAcceleration: 40,
    excessSpeedHalfLife: halfLife }, count + 4);
  kernel.initialize({ obstacles: [], maxAgentRadius: 3.2,
    flows: [{ id: 'goal', goal: { x: 1100, y: 360 } }],
    agents: Array.from({ length: count }, (_, i) => ({ id: String(i), flow: 0, radius: 3.2, x: 200 + i * 6.8, y: 360 })),
  });
  return kernel;
}

const proxy: KinematicCircle = { x: 188, y: 360, toX: 192, toY: 360, radius: 9 };

describe('TinyDead continuous kinematic push', () => {
  it('matches the recorded proxy force without consuming its command history', () => {
    const recorded = scene(), streamed = scene();
    recorded.enqueueExternal({ ...proxy, kind: 'proxy', body: 'car', id: 'pose', tick: 0, generation: 1 });
    const present = new Uint8Array([1]);
    streamed.external.setKinematicProxies([proxy], present, streamed.config.fixedDelta);
    recorded.step(); streamed.step();
    expect(streamed.state).toEqual(recorded.state);
    for (let tick = 0; tick < 5000; tick++) {
      streamed.external.setKinematicProxies([proxy], present, streamed.config.fixedDelta);
      streamed.external.begin(streamed.state, streamed.agentFlow, tick, streamed.config.fixedDelta, streamed.agentRadii);
    }
    expect(streamed.external.record()).toEqual([]);
    expect(streamed.external.stats.inputs).toBe(0);
    streamed.external.setKinematicProxies([], present, streamed.config.fixedDelta);
    streamed.step();
    expect(streamed.external.stats.affected).toBe(0);
    expect(streamed.external.active).toBe(false);
  });

  it('wakes a contacted arrival while preserving distant arrivals and removed slots', () => {
    const kernel = scene(0, 18, 3);
    kernel.state.active.fill(0);
    kernel.state.x[1] = 600;
    kernel.state.x[2] = 200;
    kernel.external.setKinematicProxies([proxy], new Uint8Array([1, 1, 0]), kernel.config.fixedDelta);
    kernel.external.begin(kernel.state, kernel.agentFlow, 0, kernel.config.fixedDelta, kernel.agentRadii);
    expect(Array.from(kernel.state.active)).toEqual([1, 0, 0]);
    expect(kernel.state.vx[0]).toBeGreaterThan(0);
    expect(kernel.state.vx[2]).toBe(0);
    kernel.external.reset();
    kernel.state.vx.fill(0);
    kernel.external.begin(kernel.state, kernel.agentFlow, 1, kernel.config.fixedDelta, kernel.agentRadii);
    expect(kernel.external.stats.affected).toBe(0);
    expect(kernel.external.fingerprint()).toBe('');
  });

  it('rejects invalid stream replacements atomically and copies the supplied poses', () => {
    const kernel = scene();
    const pose = { ...proxy }, present = new Uint8Array([1]);
    kernel.external.setKinematicProxies([pose], present, kernel.config.fixedDelta);
    const fingerprint = kernel.external.fingerprint();
    pose.x = 0;
    expect(kernel.external.fingerprint()).toBe(fingerprint);
    for (const invalid of [{ ...proxy, radius: 0 }, { ...proxy, toX: 500 }, { ...proxy, y: NaN }]) {
      expect(() => kernel.external.setKinematicProxies([invalid], present, kernel.config.fixedDelta)).toThrow();
      expect(kernel.external.fingerprint()).toBe(fingerprint);
    }
    expect(() => kernel.external.setKinematicProxies(Array(25).fill(proxy), present, kernel.config.fixedDelta)).toThrow();
    expect(() => kernel.external.setKinematicProxies([proxy], present, 0)).toThrow();
    kernel.step();
    expect(kernel.external.stats.affected).toBe(1);
  });

  it('transmits a streamed push to a body outside the proxy through ordinary contacts', () => {
    const pushed = scene(0, 0, 3), control = scene(0, 0, 3);
    pushed.config.maxAcceleration = control.config.maxAcceleration = 0;
    pushed.external.setKinematicProxies([proxy], new Uint8Array([1, 1, 1]), pushed.config.fixedDelta);
    pushed.step(); control.step();
    expect(pushed.external.direct[2]).toBe(0);
    expect(pushed.state.x[2]! - control.state.x[2]!).toBeGreaterThan(1e-4);
  });
});

describe('TinyDead excess speed recovery', () => {
  it.each([0, 18])('preserves a new strong push then recovers walking speed %s after release', maxSpeed => {
    const recovering = scene(.15, maxSpeed), undamped = scene(0, maxSpeed);
    for (const kernel of [recovering, undamped]) {
      kernel.external.setKinematicProxies([{ ...proxy, toX: 198 }], new Uint8Array([1]), kernel.config.fixedDelta);
      kernel.step();
      kernel.external.setKinematicProxies([], new Uint8Array([1]), kernel.config.fixedDelta);
    }
    expect(recovering.state.vx[0]).toBeGreaterThan(500);
    expect(recovering.state.vx[0]).toBe(undamped.state.vx[0]);
    for (let tick = 0; tick < 60; tick++) { recovering.step(); undamped.step(); }
    expect(Math.hypot(recovering.state.vx[0]!, recovering.state.vy[0]!)).toBeLessThanOrEqual(maxSpeed + 4);
    expect(undamped.state.vx[0]).toBeGreaterThan(500);
  });

  it('preserves ordinary walking exactly and leaves a newly submitted impulse intact', () => {
    const recovering = scene(.15), control = scene();
    for (let tick = 0; tick < 120; tick++) {
      recovering.step(); control.step();
      expect(recovering.state).toEqual(control.state);
    }
    for (const kernel of [recovering, control]) {
      kernel.enqueueExternal({ kind: 'impulse', id: 'hit', tick: kernel.stepCount, generation: 1,
        target: { agent: 0 }, dvx: 500, dvy: 0 });
      kernel.step();
    }
    expect(recovering.state).toEqual(control.state);
    recovering.step(); control.step();
    expect(recovering.state.vx[0]).toBeLessThan(control.state.vx[0]!);
  });
});
