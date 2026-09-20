import { describe, expect, it } from 'vitest';
import { AgentBuffer } from '../../src/core/agent-state';
import { DEFAULT_CONFIG } from '../../src/core/simulation';
import { LocalMotionSolver, type LocalMotionInput } from '../../src/algorithms/lab-motion/local-motion';
import { discOrcaPlane, projectVelocity, solveOrcaVelocity, sweptDiscTime } from '../../src/algorithms/lab-motion/orca';

function fixture(positions: readonly [number, number][], changes: Partial<LocalMotionInput> = {}): LocalMotionInput {
  const current = new AgentBuffer(positions.length);
  positions.forEach(([x, y], i) => { current.x[i] = x; current.y[i] = y; current.active[i] = 1; });
  return {
    current, next: new AgentBuffer(positions.length),
    preferredX: new Float64Array(positions.length), preferredY: new Float64Array(positions.length),
    radii: new Float64Array(positions.length).fill(1),
    config: { ...DEFAULT_CONFIG, width: 200, height: 200, maxSpeed: 10, maxAcceleration: 10000,
      fixedDelta: 0.1, contactCellSize: 4, wallMargin: 0, agentGap: 0, neighborRadius: 50,
      maximumContactCorrection: 10 },
    obstacles: [], avoidance: 'none', contactIterations: 4, neighborLimit: 16, timeHorizon: 3,
    retainArrivals: false, ...changes,
  };
}

describe('disc ORCA geometry and velocity LP', () => {
  it('projects the preferred velocity into the half-plane intersection and speed disc', () => {
    const result = projectVelocity([{ nx: 1, ny: 0, offset: 1 }, { nx: 0, ny: 1, offset: 1 }], 2, -4, -3);
    expect(result?.x).toBeCloseTo(1);
    expect(result?.y).toBeCloseTo(1);
    expect(projectVelocity([{ nx: 1, ny: 0, offset: 3 }], 2, 0, 0)).toBeNull();
    const infeasible = solveOrcaVelocity([{ nx: 1, ny: 0, offset: 1 }, { nx: -1, ny: 0, offset: 1 }], 2, 2, 0);
    expect(infeasible.feasible).toBe(false);
    expect(Math.abs(infeasible.x)).toBeLessThan(1e-3);
  });

  it('constructs reciprocal tangent planes that yield a collision-free relative velocity', () => {
    const a = discOrcaPlane(20, 0, 10, 0, -10, 0, 2, 3, 0.1, 0.5);
    const b = discOrcaPlane(-20, 0, -10, 0, 10, 0, 2, 3, 0.1, 0.5);
    const va = solveOrcaVelocity([a], 10, 10, 0);
    const vb = solveOrcaVelocity([b], 10, -10, 0);
    expect(va.feasible && vb.feasible).toBe(true);
    expect(Math.abs(va.y)).toBeGreaterThan(0.1);
    expect(va.x).toBeCloseTo(-vb.x);
    expect(va.y).toBeCloseTo(-vb.y);
    expect(sweptDiscTime(-20, 0, (va.x - vb.x) * 3, (va.y - vb.y) * 3, 2 - 1e-7)).toBe(Infinity);
  });

  it('detects non-overlapping endpoints whose discs cross during the step', () => {
    expect(sweptDiscTime(-20, 0, 40, 0, 2)).toBeCloseTo(0.45);
    expect(sweptDiscTime(-20, 3, 40, 0, 2)).toBe(Infinity);
    expect(sweptDiscTime(-2, 0, -4, 0, 2)).toBe(Infinity);
  });

});

describe('independent local motion pipeline', () => {
  it.each(['orca', 'sampling', 'separation', 'boids', 'none'] as const)('%s moves with finite state and preserves non-motion fields', avoidance => {
    const input = fixture([[20, 20], [30, 30]], { avoidance });
    input.preferredX.fill(10);
    input.current.stalledFor[0] = 1.5;
    input.current.intentY[0] = 0.75;
    const metrics = new LocalMotionSolver().solve(input);
    expect(input.next.x[0]).toBeGreaterThan(20);
    expect([...input.next.vx].every(Number.isFinite)).toBe(true);
    expect(input.next.stalledFor[0]).toBe(1.5);
    expect(input.next.intentY[0]).toBe(0.75);
    expect(metrics.overlapPairs).toBe(0);
    expect([...input.current.x]).toEqual([20, 30]);
  });

  it.each(['head-on', 'crossing'] as const)('ORCA agents pass a %s encounter without contact projection', encounter => {
    const input = fixture(encounter === 'head-on' ? [[30, 60], [70, 60]] : [[30, 60], [60, 30]], {
      avoidance: 'orca', contactIterations: 0,
    });
    input.preferredX[0] = 10;
    if (encounter === 'head-on') input.preferredX[1] = -10;
    else input.preferredY[1] = 10;
    input.current.vx.set(input.preferredX);
    input.current.vy.set(input.preferredY);
    const solver = new LocalMotionSolver();
    let minimum = Infinity;
    let corrections = 0;
    for (let tick = 0; tick < 70; tick++) {
      const metrics = solver.solve(input);
      minimum = Math.min(minimum, Math.hypot(input.next.x[0]! - input.next.x[1]!, input.next.y[0]! - input.next.y[1]!));
      corrections += metrics.ccdStops;
      [input.current, input.next] = [input.next, input.current];
    }
    expect(minimum).toBeGreaterThanOrEqual(2 - 1e-6);
    expect(input.current.x[0]).toBeGreaterThan(85);
    if (encounter === 'head-on') expect(input.current.x[1]).toBeLessThan(15);
    else expect(input.current.y[1]).toBeGreaterThan(85);
    expect(corrections).toBe(0);
  });

  it('prevents high-speed pair endpoint swaps even with no predictive avoidance', () => {
    const input = fixture([[30, 50], [70, 50]], { contactIterations: 0 });
    input.config = { ...input.config, maxSpeed: 200, fixedDelta: 0.25 };
    input.preferredX.set([200, -200]);
    const metrics = new LocalMotionSolver().solve(input);
    expect(metrics.substeps).toBeGreaterThan(1);
    expect(metrics.ccdStops).toBeGreaterThan(0);
    expect(input.next.x[1]! - input.next.x[0]!).toBeGreaterThanOrEqual(2 - 1e-6);
  });

  it('preserves common tangential progress when touching discs prefer a slight inward motion', () => {
    const input = fixture([[30, 50], [32, 50]], { contactIterations: 0 });
    input.preferredX.set([0.1, -0.1]); input.preferredY.fill(9);
    const solver = new LocalMotionSolver();
    for (let tick = 0; tick < 20; tick++) {
      solver.solve(input);
      expect(input.next.x[1]! - input.next.x[0]!).toBeGreaterThanOrEqual(2 - 1e-6);
      [input.current, input.next] = [input.next, input.current];
    }
    expect(input.current.y[0]).toBeCloseTo(68);
    expect(input.current.y[1]).toBeCloseTo(68);
  });

  it('re-sweeps static walls after tangent contact displacement is shared', () => {
    const input = fixture([[30, 50], [32, 50]], {
      obstacles: [{ x: 33, y: 0, width: 1, height: 200 }], contactIterations: 0,
    });
    input.preferredX.set([2, 0]); input.preferredY.fill(8);
    const metrics = new LocalMotionSolver().solve(input);
    expect(input.next.x[1]).toBeLessThanOrEqual(32 + 1e-8);
    expect(input.next.x[1]! - input.next.x[0]!).toBeGreaterThanOrEqual(2 - 1e-6);
    expect(metrics.overlapPairs).toBe(0);
  });

  it('Boids does not align with or pull toward same-group agents across a thin wall', () => {
    const input = fixture([[20, 50], [30, 50]], {
      avoidance: 'boids', groups: new Uint16Array([0, 0]),
      obstacles: [{ x: 25, y: 0, width: 0.05, height: 200 }],
    });
    input.preferredX.fill(5);
    input.current.vx[1] = 10;
    new LocalMotionSolver().solve(input);
    expect(input.next.vx[0]).toBeCloseTo(5);
    input.obstacles = [];
    new LocalMotionSolver().solve(input);
    expect(input.next.vx[0]).toBeGreaterThan(6);
  });

  it('sweeps thin walls for integration and position corrections', () => {
    const input = fixture([[40, 50], [40.5, 50]], {
      obstacles: [{ x: 42, y: 0, width: 0.05, height: 200 }],
    });
    input.config = { ...input.config, maxSpeed: 200, fixedDelta: 0.2 };
    input.preferredX.fill(200);
    const metrics = new LocalMotionSolver().solve(input);
    expect(Math.max(...input.next.x)).toBeLessThanOrEqual(41 + 1e-7);
    expect(metrics.staticContacts).toBeGreaterThan(0);
  });

  it('rebuilds all contact candidates after correction creates a new contact, independent of K', () => {
    const input = fixture([[10, 50], [10.5, 50], [12.7, 50]], { neighborLimit: 0, contactIterations: 2 });
    input.config = { ...input.config, contactCellSize: 0.5 };
    const metrics = new LocalMotionSolver().solve(input);
    expect(input.next.x[2]).toBeGreaterThan(12.7);
    expect(metrics.contactConstraints).toBeGreaterThanOrEqual(2);
    expect(metrics.contactActiveCount).toBe(3);
  });

  it('includes large radii across many hash cells and resolves collapsed discs deterministically', () => {
    const input = fixture([[50, 50], [50, 50], [61, 50]], { radii: new Float64Array([1, 10, 2]), contactIterations: 60 });
    input.config = { ...input.config, contactCellSize: 2 };
    const copy = fixture([[50, 50], [50, 50], [61, 50]], { ...input, next: new AgentBuffer(3) });
    const metrics = new LocalMotionSolver().solve(input);
    new LocalMotionSolver().solve(copy);
    expect([...input.next.x]).toEqual([...copy.next.x]);
    expect([...input.next.y].every(Number.isFinite)).toBe(true);
    expect(metrics.contactActiveCount).toBe(3);
    expect(metrics.overlapPairs).toBe(0);
  });

  it('retains arrived bodies as immovable collision obstacles and allows explicit exit removal', () => {
    const input = fixture([[40, 50], [50, 50]], { retainArrivals: true });
    input.current.active[1] = 0;
    input.preferredX[0] = 50;
    input.config = { ...input.config, maxSpeed: 50, fixedDelta: 0.5 };
    new LocalMotionSolver().solve(input);
    expect(input.next.x[0]).toBeLessThanOrEqual(48);
    expect(input.next.x[1]).toBe(50);
    input.retainArrivals = false;
    new LocalMotionSolver().solve(input);
    expect(input.next.x[0]).toBeGreaterThan(60);
  });

  it.each([
    { name: 'a parked disc', start: [30, 50], parked: [[50, 50]], goal: [70, 50] },
    { name: 'a parked disc beside a world boundary', start: [199, 30], parked: [[199, 50]], goal: [199, 70] },
    { name: 'a cluster of retained arrival slots', start: [42, 50], parked: [[50, 50], [50, 45.5], [50, 54.5], [54.5, 45.5], [54.5, 54.5]], goal: [65, 50] },
  ])('routes around $name while preserving ORCA/contact protection', ({ start, parked, goal }) => {
    const positions = [start, ...parked] as [number, number][];
    const target = { x: goal[0]!, y: goal[1]! };
    const input = fixture(positions, { avoidance: 'orca', retainArrivals: true,
      targets: positions.map(() => target), contactIterations: 0 });
    input.current.active.fill(0); input.current.active[0] = 1;
    input.config = { ...input.config, stallSeconds: 0.4, agentGap: 0.1 };
    const solver = new LocalMotionSolver();
    let ticks = 0;
    for (; ticks < 900; ticks++) {
      const dx = target.x - input.current.x[0]!, dy = target.y - input.current.y[0]!;
      const distance = Math.hypot(dx, dy);
      if (distance < 0.15) break;
      const speed = Math.min(input.config.maxSpeed, distance * 3);
      input.preferredX[0] = dx / distance * speed; input.preferredY[0] = dy / distance * speed;
      const metrics = solver.solve(input);
      expect(metrics.overlapPairs).toBe(0);
      expect(metrics.invalidStaticStarts).toBe(0);
      expect(input.next.x[0]).toBeLessThanOrEqual(199 + 1e-8);
      input.next.stalledFor[0] = Math.hypot(input.next.vx[0]!, input.next.vy[0]!) < input.config.maxSpeed * 0.04
        ? input.current.stalledFor[0]! + input.config.fixedDelta : 0;
      [input.current, input.next] = [input.next, input.current];
    }
    expect(ticks).toBeLessThan(900);
    for (let i = 1; i < positions.length; i++) {
      expect(input.current.x[i]).toBe(positions[i]![0]);
      expect(input.current.y[i]).toBe(positions[i]![1]);
    }
  });

  it('does not start a parked-body detour solely to bypass an active queue stopper', () => {
    const input = fixture([[40, 50], [50, 50], [50, 65]], {
      avoidance: 'orca', retainArrivals: true, immovable: new Uint8Array([0, 1, 0]),
      targets: [{ x: 70, y: 50 }, { x: 70, y: 50 }, { x: 50, y: 65 }],
    });
    input.current.active[2] = 0;
    input.preferredX[0] = 10;
    input.current.stalledFor[0] = input.config.stallSeconds + 1;
    const solver = new LocalMotionSolver();
    for (let tick = 0; tick < 120; tick++) {
      solver.solve(input);
      [input.current, input.next] = [input.next, input.current];
    }
    expect(input.current.y[0]).toBeCloseTo(50, 6);
    expect(input.current.x[0]).toBeLessThan(50);
    expect(input.current.x[1]).toBe(50);
  });

  it('accelerates along a detour that initially retreats from the goal to escape a parked U shape', () => {
    const positions: [number, number][] = [[41, 50], [40, 46], [42, 46], [44, 46], [44, 48],
      [44, 50], [44, 52], [44, 54], [42, 54], [40, 54]];
    const target = { x: 55, y: 50 };
    const input = fixture(positions, { avoidance: 'orca', retainArrivals: true,
      targets: positions.map(() => target), contactIterations: 0 });
    input.current.active.fill(0); input.current.active[0] = 1;
    input.current.stalledFor[0] = 1;
    input.config = { ...input.config, maxAcceleration: 1, stallSeconds: 0.4, agentGap: 0.1 };
    const solver = new LocalMotionSolver();
    let minimumX = 41, ticks = 0;
    for (; ticks < 450; ticks++) {
      const dx = target.x - input.current.x[0]!, dy = target.y - input.current.y[0]!;
      const distance = Math.hypot(dx, dy);
      if (distance < 0.2) break;
      const speed = Math.min(input.config.maxSpeed, distance * 2);
      input.preferredX[0] = dx / distance * speed; input.preferredY[0] = dy / distance * speed;
      const metrics = solver.solve(input);
      expect(metrics.overlapPairs).toBe(0);
      input.next.stalledFor[0] = Math.hypot(input.next.vx[0]!, input.next.vy[0]!) < 0.4
        ? input.current.stalledFor[0]! + input.config.fixedDelta : 0;
      [input.current, input.next] = [input.next, input.current];
      minimumX = Math.min(minimumX, input.current.x[0]!);
    }
    expect(minimumX).toBeLessThan(38);
    expect(ticks).toBeLessThan(450);
  });

  it('keeps a nearby detour vertex when its following leg is still hidden by the parked disc', () => {
    // Captured from the 1000-agent winding-corners boundary stall. Its first
    // necessary vertex is only 0.307 units away, inside the old proximity test.
    const input = fixture([[935.3418428965865, 716.45], [941.5130896425302, 713.6135568877665],
      [926.4332164470923, 713.878901423958], [941.5409579794733, 698.4752718366536]], {
      avoidance: 'orca', retainArrivals: true, radii: new Float64Array(4).fill(3.2), contactIterations: 0,
      timeHorizon: 1.5, targets: Array.from({ length: 4 }, () => ({ x: 956.7950740715722, y: 713.7994997041889 })),
    });
    input.config = { ...DEFAULT_CONFIG, agentCount: 4 };
    input.current.active.fill(0); input.current.active[0] = 1;
    input.current.stalledFor[0] = 39;
    const target = input.targets![0]!;
    const solver = new LocalMotionSolver();
    let ticks = 0;
    for (; ticks < 300; ticks++) {
      const dx = target.x - input.current.x[0]!, dy = target.y - input.current.y[0]!;
      const distance = Math.hypot(dx, dy);
      if (distance < 0.64) break;
      const speed = 86 * Math.min(1, distance / 9.6);
      input.preferredX[0] = dx / distance * speed; input.preferredY[0] = dy / distance * speed;
      const metrics = solver.solve(input);
      expect(metrics.overlapPairs).toBe(0);
      expect(metrics.invalidStaticStarts).toBe(0);
      input.next.stalledFor[0] = Math.hypot(input.next.vx[0]!, input.next.vy[0]!) < 3.44
        ? input.current.stalledFor[0]! + input.config.fixedDelta : 0;
      [input.current, input.next] = [input.next, input.current];
    }
    expect(ticks).toBeLessThan(300);
  });

  it('routes a moving unit out of a parked-body orbit without waiting for low-speed stall detection', () => {
    const input = fixture([[956.6043596983494, 206.23495351464544], [956.9965800337579, 213.03533176106305],
      [957.1747239374719, 196.96813187912971], [942.0608643665661, 213.0316187386703],
      [972.1183407534792, 212.8182412562733], [941.6910163757303, 197.72933403259816],
      [972.058061192648, 197.57760420988066], [956.4224177307375, 228.2917600287852],
      [956.7126598205514, 182.30032107533367], [941.6187156101338, 227.91859863070346],
      [971.9541933414881, 227.98766760959595], [941.6727493531246, 182.37229868416267],
      [972.3420966795552, 181.74374591052293]], {
      avoidance: 'orca', retainArrivals: true, radii: new Float64Array(13).fill(3.2), contactIterations: 0,
      timeHorizon: 1.5, obstacles: [{ x: 888, y: 0, width: 48, height: 504 }],
      targets: Array.from({ length: 13 }, () => ({ x: 941.6078506736108, y: 258.1827977653449 })),
    });
    input.config = { ...DEFAULT_CONFIG, agentCount: 13 };
    input.current.active.fill(0); input.current.active[0] = 1;
    input.current.vx[0] = -10.294721139903231; input.current.vy[0] = -0.009790521233412619;
    const target = input.targets![0]!;
    const solver = new LocalMotionSolver();
    // Allow detection of absent target progress plus passage, while the old
    // low-speed-only trigger remains stuck beyond 900 ticks in this fixture.
    const budget = 600;
    let ticks = 0;
    for (; ticks < budget; ticks++) {
      const dx = target.x - input.current.x[0]!, dy = target.y - input.current.y[0]!;
      const distance = Math.hypot(dx, dy);
      if (distance < 0.64) break;
      const speed = 86 * Math.min(1, distance / 9.6);
      input.preferredX[0] = dx / distance * speed; input.preferredY[0] = dy / distance * speed;
      const metrics = solver.solve(input);
      expect(metrics.overlapPairs).toBe(0);
      expect(metrics.invalidStaticStarts).toBe(0);
      input.next.stalledFor[0] = Math.hypot(input.next.vx[0]!, input.next.vy[0]!) < 3.44
        ? input.current.stalledFor[0]! + input.config.fixedDelta : 0;
      [input.current, input.next] = [input.next, input.current];
    }
    expect(ticks).toBeLessThan(budget);
  });

  it('keeps route/contact safety when a nearby moving peer becomes a retained arrival', () => {
    const target = { x: 70, y: 50 };
    const input = fixture([[30, 50], [50, 50], [47, 57]], {
      avoidance: 'orca', retainArrivals: true, contactIterations: 0,
      targets: [target, { x: 50, y: 50 }, { x: 47, y: 65 }],
    });
    input.current.active[1] = 0;
    input.config = { ...input.config, maxAcceleration: 10, stallSeconds: 0.4, agentGap: 0.1 };
    const solver = new LocalMotionSolver();
    let ticks = 0;
    for (; ticks < 600; ticks++) {
      const dx = target.x - input.current.x[0]!, dy = target.y - input.current.y[0]!;
      const distance = Math.hypot(dx, dy);
      if (distance < 0.15) break;
      input.preferredX[0] = dx / distance * Math.min(10, distance * 3);
      input.preferredY[0] = dy / distance * Math.min(10, distance * 3);
      if (ticks < 40) input.preferredY[2] = 1;
      else { input.current.active[2] = 0; input.current.vx[2] = 0; input.current.vy[2] = 0; input.preferredY[2] = 0; }
      const metrics = solver.solve(input);
      expect(metrics.overlapPairs).toBe(0);
      expect(metrics.invalidStaticStarts).toBe(0);
      input.next.stalledFor[0] = Math.hypot(input.next.vx[0]!, input.next.vy[0]!) < 0.4
        ? input.current.stalledFor[0]! + input.config.fixedDelta : 0;
      [input.current, input.next] = [input.next, input.current];
    }
    expect(ticks).toBeLessThan(600);
    expect(input.current.active[2]).toBe(0);
  });

  it('predicts parked discs to a known route turn instead of an unplanned straight continuation', () => {
    const input = fixture([[1139.0834312542804, 386.7807394657912], [1139.5785766527085, 379.9982741807454],
      [1139.1349286099266, 394.76839088948907], [1154.4684079695915, 380.2617937742601],
      [1154.1537407672886, 394.95971059819533], [1123.5503568318602, 379.1558378977695],
      [1123.8832256237051, 395.43179780506813], [1138.9507476921133, 364.5971620221719],
      [1139.522722152387, 409.67670839355225], [1154.134497818926, 364.5634075782072],
      [1123.4414371415924, 364.01931513944703], [1154.1072861964428, 410.0346253307149],
      [1124.2920577248192, 410.46136169362535]], {
      avoidance: 'orca', retainArrivals: true, radii: new Float64Array(13).fill(3.2), contactIterations: 0,
      timeHorizon: 1.5, targets: Array.from({ length: 13 }, () => ({ x: 1169.4162016430328, y: 410.05503174495954 })),
    });
    input.config = { ...DEFAULT_CONFIG, agentCount: 13 };
    input.current.active.fill(0); input.current.active[0] = 1;
    input.current.vx[0] = 10.075802576825481; input.current.vy[0] = 0.8591348171148638;
    input.preferredX[0] = 68.35309403611963; input.preferredY[0] = 52.19055983307123;
    const solver = new LocalMotionSolver();
    solver.solve(input);
    // Restore the controller cache captured with this R82 world snapshot.
    const waypoint = { x: 1141.7959606022266, y: 388.34409136376973 };
    (solver as unknown as { detourPaths: { x: number; y: number }[][] }).detourPaths[0] = [waypoint,
      { x: 1144.051874596014, y: 389.85144490340167 }, input.targets![0]!];
    const metrics = solver.solve(input);
    const dx = waypoint.x - input.current.x[0]!, dy = waypoint.y - input.current.y[0]!;
    // The present leg is clear. A parked body about 17 units farther along its
    // ray lies beyond the 3.13-unit planned turn and must not flatten this turn.
    expect(input.next.vx[0]! * dy - input.next.vy[0]! * dx).toBeCloseTo(0, 6);
    expect(input.next.vy[0]).toBeGreaterThan(5);
    expect(metrics.overlapPairs).toBe(0);
    expect(metrics.invalidStaticStarts).toBe(0);
  });

  it.each(['source', 'target'] as const)('connects a wall-tangent $source inside the conservative route-node envelope', endpoint => {
    const tangent = { x: 939.55, y: 75.9 - Math.sqrt(6.80001 ** 2 - 2.05 ** 2) };
    const open = { x: 941.6, y: 91.12 };
    const start = endpoint === 'source' ? tangent : open;
    const goal = endpoint === 'source' ? open : tangent;
    const input = fixture([[start.x, start.y], [941.6, 75.9]], {
      avoidance: 'orca', retainArrivals: true, radii: new Float64Array(2).fill(3.2), contactIterations: 0,
      timeHorizon: 1.5, obstacles: [{ x: 888, y: 0, width: 48, height: 504 }],
      targets: [goal, { x: 941.6, y: 75.9 }],
    });
    input.config = { ...DEFAULT_CONFIG, agentCount: 2 };
    input.current.active[1] = 0; input.current.stalledFor[0] = 60;
    const solver = new LocalMotionSolver();
    let ticks = 0;
    for (; ticks < 300; ticks++) {
      const dx = goal.x - input.current.x[0]!, dy = goal.y - input.current.y[0]!;
      const distance = Math.hypot(dx, dy);
      if (distance < 0.64) break;
      input.preferredX[0] = dx / distance * Math.min(86, 86 * distance / 9.6);
      input.preferredY[0] = dy / distance * Math.min(86, 86 * distance / 9.6);
      const metrics = solver.solve(input);
      expect(metrics.overlapPairs).toBe(0);
      expect(metrics.invalidStaticStarts).toBe(0);
      expect(input.next.x[0]).toBeGreaterThanOrEqual(939.55 - 1e-8);
      input.next.stalledFor[0] = Math.hypot(input.next.vx[0]!, input.next.vy[0]!) < 3.44
        ? input.current.stalledFor[0]! + input.config.fixedDelta : 0;
      [input.current, input.next] = [input.next, input.current];
    }
    expect(ticks).toBeLessThan(300);
    expect(input.current.x[1]).toBe(941.6); expect(input.current.y[1]).toBe(75.9);
  });

  it('keeps an initially invalid static state stopped and reports it explicitly', () => {
    const input = fixture([[30, 30]], { obstacles: [{ x: 29, y: 29, width: 2, height: 2 }] });
    input.preferredX[0] = 10;
    const metrics = new LocalMotionSolver().solve(input);
    expect(input.next.x[0]).toBe(30);
    expect(metrics.invalidStaticStarts).toBeGreaterThan(0);
  });

  it('repairs only the numeric shell at a wall tangent so roundoff cannot permanently stop an agent', () => {
    const input = fixture([[20, 50.9999995]], { obstacles: [{ x: 0, y: 0, width: 100, height: 50 }] });
    input.preferredX[0] = 5;
    const metrics = new LocalMotionSolver().solve(input);
    expect(input.next.x[0]).toBeGreaterThan(20.4);
    expect(input.next.y[0]).toBeGreaterThanOrEqual(51);
    expect(metrics.invalidStaticStarts).toBe(0);
    expect(metrics.staticContacts).toBeGreaterThan(0);
  });

  it('repairs a sweep-accepted numeric inset before a slow inward contact can miss the wall face', () => {
    const input = fixture([[356.450000000013, 407.1464934852569]], {
      radii: new Float64Array([3.2]), obstacles: [{ x: 360, y: 0, width: 48, height: 504 }], contactIterations: 0,
    });
    input.config = { ...input.config, width: 1200, height: 720, wallMargin: 0.35 };
    input.preferredX[0] = 0.8377548772433929; input.preferredY[0] = 7.410508919196929;
    const metrics = new LocalMotionSolver().solve(input);
    expect(input.next.x[0]).toBeLessThanOrEqual(356.45 + 1e-9);
    expect(input.next.y[0]).toBeGreaterThan(407.8);
    expect(metrics.invalidStaticStarts).toBe(0);
  });
});
