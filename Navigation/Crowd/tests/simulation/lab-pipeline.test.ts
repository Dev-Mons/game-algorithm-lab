import { describe, expect, it } from 'vitest';
import { CrowdSimulation, DEFAULT_CONFIG } from '../../src/core/simulation';
import type { ScenarioDefinition } from '../../src/core/types';
import { getScenario } from '../../src/scenarios/scenarios';
import { LocalMotionSolver, retainedBodyDetourRadius } from '../../src/algorithms/lab-motion/local-motion';
import { AgentBuffer } from '../../src/core/agent-state';

const OPEN: ScenarioDefinition = { id: 'test-lab', name: 'open', description: '',
  goal: { x: 340, y: 100 }, spawn: { x: 30, y: 40, width: 70, height: 120 }, obstacles: [] };
function create(preset: string, count = 16, scenario = OPEN) {
  return new CrowdSimulation({ ...DEFAULT_CONFIG, preset, width: 400, height: 200, agentCount: count,
    navCellSize: 10, goalRadius: 15, arrivalSlowRadius: 35, maxSpeed: 65 }, scenario);
}

describe('independent experimental pipeline', () => {
  it('reconnects to a real later corridor point when a parked body occupies the current A* reference', () => {
    // Captured Q agent 9: the (948,516) reference is only 5.84px from a parked
    // body, so the 6.8px moving-disc clearance makes that exact point unreachable.
    const reference = { x: 948, y: 516 };
    const goal = { x: 941.6078506736108, y: 485.99114873476685 };
    const run = (includeSuffix: boolean): boolean => {
      const current = new AgentBuffer(3);
      current.x.set([937.9482767627037, 942.1697245247226, 941.6575782256581]);
      current.y.set([509.63643009473, 516.3314138326399, 501.25978147014257]);
      current.active[0] = 1; current.stalledFor[0] = 60;
      current.vx[0] = -4.299769093249779; current.vy[0] = 8.442825463697545;
      const parkedX = [...current.x].slice(1), parkedY = [...current.y].slice(1);
      const input = { current, next: new AgentBuffer(3), config: { ...DEFAULT_CONFIG },
        preferredX: new Float64Array(3), preferredY: new Float64Array(3), radii: new Float64Array(3).fill(3.2),
        obstacles: getScenario('winding-corners').obstacles, avoidance: 'orca' as const,
        contactIterations: 4, neighborLimit: 12, timeHorizon: 1.5, retainArrivals: true,
        targets: [goal], navigationTargets: [reference], navigationPaths: includeSuffix ? [[reference, goal]] : undefined,
        navigationPathCursor: new Int32Array(3) };
      const solver = new LocalMotionSolver();
      for (let tick = 0; tick < 900; tick += 1) {
        const dx = goal.x - input.current.x[0]!, dy = goal.y - input.current.y[0]!, distance = Math.hypot(dx, dy);
        if (distance < 0.64) return true;
        input.preferredX[0] = dx / distance * 86; input.preferredY[0] = dy / distance * 86;
        const metrics = solver.solve(input);
        expect(metrics.overlapPairs).toBe(0); expect(metrics.invalidStaticStarts).toBe(0);
        expect([...input.next.x].slice(1)).toEqual(parkedX); expect([...input.next.y].slice(1)).toEqual(parkedY);
        input.next.stalledFor[0] = Math.hypot(input.next.vx[0]!, input.next.vy[0]!) < 3.44
          ? input.current.stalledFor[0]! + 1 / 60 : 0;
        [input.current, input.next] = [input.next, input.current];
      }
      return false;
    };
    expect(run(false)).toBe(false);
    expect(run(true)).toBe(true);
  });
  it('queue yielding survives parked-body routing and lets two opposing movers pass', () => {
    // Reduced from the Q 1,000-agent stall: two movers approach the same parked
    // body's lower waypoint from opposite sides of a retained arrival lane.
    const positions = [[896.7618742436496, 568.3425423076441], [889.9803350747997, 567.841680549109],
      [895.9028680458331, 561.3254872893647], [895.8241634090338, 576.558237542888]] as const;
    const targets = [{ x: 880.858957081765, y: 561.9272657245742 }, { x: 1047.918414459341, y: 425.242255142921 },
      { x: positions[2][0], y: positions[2][1] }, { x: positions[3][0], y: positions[3][1] }];
    const run = (yieldWhenStalled: boolean, priorityRecovery = false): AgentBuffer => {
      const current = new AgentBuffer(4);
      positions.forEach(([x, y], i) => { current.x[i] = x; current.y[i] = y; current.active[i] = i < 2 ? 1 : 0; current.stalledFor[i] = 60; });
      const input = { current, next: new AgentBuffer(4), config: { ...DEFAULT_CONFIG },
        preferredX: new Float64Array(4), preferredY: new Float64Array(4), radii: new Float64Array(4).fill(3.2),
        obstacles: getScenario('winding-corners').obstacles, avoidance: 'orca' as const,
        contactIterations: 4, neighborLimit: 12, timeHorizon: 1.5, retainArrivals: true,
        targets, navigationTargets: targets, yieldWhenStalled, priorityRecovery };
      const solver = new LocalMotionSolver();
      for (let tick = 0; tick < 1800; tick += 1) {
        for (let i = 0; i < 2; i += 1) {
          const dx = targets[i]!.x - input.current.x[i]!, dy = targets[i]!.y - input.current.y[i]!;
          const distance = Math.hypot(dx, dy);
          if (distance < 0.64) { input.current.active[i] = 0; input.preferredX[i] = 0; input.preferredY[i] = 0; }
          else { input.preferredX[i] = dx / distance * 86; input.preferredY[i] = dy / distance * 86; }
        }
        const metrics = solver.solve(input);
        expect(metrics.overlapPairs).toBe(0);
        expect(metrics.invalidStaticStarts).toBe(0);
        for (let i = 0; i < 2; i += 1) input.next.stalledFor[i] = Math.hypot(input.next.vx[i]!, input.next.vy[i]!) < 3.44
          ? input.current.stalledFor[i]! + 1 / 60 : 0;
        [input.current, input.next] = [input.next, input.current];
      }
      return input.current;
    };
    expect([...run(false).active]).toEqual([1, 1, 0, 0]);
    const recovered = run(true);
    expect([...recovered.active]).toEqual([0, 0, 0, 0]);
    for (const i of [2, 3]) { expect(recovered.x[i]).toBe(positions[i]![0]); expect(recovered.y[i]).toBe(positions[i]![1]); }
    const priorityRecovered = run(false, true);
    expect([...priorityRecovered.active]).toEqual([0, 0, 0, 0]);
    for (const i of [2, 3]) { expect(priorityRecovered.x[i]).toBe(positions[i]![0]); expect(priorityRecovered.y[i]).toBe(positions[i]![1]); }
  });
  it.each(['B0', 'R', 'Q'])('%s retains a nearby corner waypoint until the next leg is visible', (preset) => {
    const scenario = getScenario('winding-corners');
    const sim = new CrowdSimulation({ ...DEFAULT_CONFIG, preset, agentCount: 1 }, scenario);
    sim.state.x[0] = 356.45; sim.state.y[0] = 501.5767815509591;
    sim.setGoal(scenario.goal.x, scenario.goal.y);
    const direction = { x: 0, y: 0 };
    expect(sim.sampleNavigationDirection(0, sim.state.x[0]!, sim.state.y[0]!, direction)).toBe(true);
    expect(direction.y).toBeGreaterThan(0);
    for (let tick = 0; tick < 1800; tick += 1) sim.step();
    expect(sim.metrics.arrivedCount).toBe(1);
    expect(sim.metrics.wallOverlapCount).toBe(0);
  });
  it.each(['R', 'Q'])('%s detours a parked body toward the visible corridor before the goal behind a wall', (preset) => {
    const scenario: ScenarioDefinition = { id: 'parked-corner', name: 'parked corner', description: '',
      goal: { x: 200, y: 80 }, spawn: { x: 20, y: 150, width: 60, height: 40 },
      obstacles: [{ x: 110, y: 0, width: 20, height: 140 }] };
    const sim = new CrowdSimulation({ ...DEFAULT_CONFIG, preset, agentCount: 2,
      width: 240, height: 200, navCellSize: 10 }, scenario);
    sim.state.x.set([60, 80]); sim.state.y.set([145, 145]);
    sim.setAgentGoals([{ agent: 0, goal: { x: 200, y: 80 } }, { agent: 1, goal: { x: 80, y: 145 } }]);
    // A retained parked body lies on the horizontal leg to the wall's lower corner.
    sim.state.active[1] = 0;
    let maximumWalls = 0;
    for (let tick = 0; tick < 1800; tick += 1) {
      sim.step(); maximumWalls = Math.max(maximumWalls, sim.metrics.wallOverlapCount);
    }
    expect(sim.state.active[0]).toBe(0);
    expect(sim.state.x[0]).toBeGreaterThan(130);
    expect(sim.state.x[1]).toBe(80); expect(sim.state.y[1]).toBe(145);
    expect(maximumWalls).toBe(0);
  });
  it.each(['B0', 'B1', 'D'].flatMap(preset => [40, 80].map(radius => ({ preset, radius }))))
    ('$preset keeps routing around a wall inside the $radius px arrival radius', ({ preset, radius }) => {
    const scenario: ScenarioDefinition = { ...OPEN, goal: { x: 220, y: 100 },
      obstacles: [{ x: 195, y: 40, width: 10, height: 120 }] };
    const sim = create(preset, 1, scenario);
    sim.state.x[0] = 190; sim.state.y[0] = 100;
    sim.config.goalRadius = radius;
    sim.setGoal(scenario.goal.x, scenario.goal.y);
    sim.step();
    expect(sim.metrics.arrivedCount).toBe(0);
    expect(sim.state.active[0]).toBe(1);
    for (let tick = 0; tick < 600; tick += 1) sim.step();
    expect(sim.metrics.arrivedCount).toBe(1);
    expect(sim.state.y[0]! < 40 || sim.state.y[0]! > 160 || sim.state.x[0]! > 205).toBe(true);
  });
  it.each(['B0', 'B1', 'R', 'Q', 'D'])('%s is deterministic, moves, arrives and resets without stale caches', (preset) => {
    const first = create(preset); const second = create(preset);
    const initial = first.stateHash();
    for (let tick = 0; tick < 900; tick += 1) { first.step(); second.step(); }
    expect(first.stateHash()).toBe(second.stateHash());
    expect(first.metrics.arrivalRate).toBeGreaterThan(0.7);
    expect(first.experimentStats.arrivedCount).toBe(first.metrics.arrivedCount);
    expect(first.metrics.wallOverlapCount).toBe(0);
    first.reset(); expect(first.stateHash()).toBe(initial);
    expect(first.experimentStats.arrivedCount).toBe(0);
  });
  it('B0 plans per agent while B1 shares one goal and clearance field', () => {
    const b0 = create('B0'); const b1 = create('B1');
    expect(b0.experimentStats.pathRequests).toBe(16);
    expect(b1.experimentStats.fieldBuilds).toBe(1);
    expect(b1.experimentStats.cacheHits).toBe(15);
  });
  it('individual commands preserve other agents goals and retained arrival counts', () => {
    const sim = create('R', 2);
    for (let tick = 0; tick < 600; tick += 1) sim.step();
    expect(sim.metrics.arrivedCount).toBe(2);
    const otherGoal = { ...sim.goalForAgent(1) };
    sim.setAgentGoal(0, 50, 100);
    expect(sim.goalForAgent(1)).toEqual(otherGoal);
    for (let tick = 0; tick < 2; tick += 1) sim.step();
    expect(sim.experimentStats.arrivedCount).toBe(1);
    expect(sim.metrics.arrivedCount).toBe(1);
    expect(sim.state.active[0]).toBe(1); expect(sim.state.active[1]).toBe(0);
  });
  it('assigns leading agents to forward slots so retained arrivals do not fence later destinations', () => {
    const sim = create('R', 4);
    sim.state.x.set([30, 50, 70, 90]); sim.state.y.fill(100);
    sim.setGoal(330, 100);
    expect(sim.goalForAgent(1).x).toBeGreaterThanOrEqual(sim.goalForAgent(0).x);
    expect(sim.goalForAgent(3).x).toBeGreaterThanOrEqual(sim.goalForAgent(2).x);
    const original = Array.from({ length: 4 }, (_, i) => ({ ...sim.goalForAgent(i) }));
    sim.updateObstacles([]);
    expect(Array.from({ length: 4 }, (_, i) => sim.goalForAgent(i))).toEqual(original);
  });
  it.each([{ radius: 3.2, gap: 0.4 }, { radius: 2, gap: 2 }])
    ('retained slots preserve ingress clearance after both bodies settle ($radius radius, $gap gap)', ({ radius, gap }) => {
    const sim = new CrowdSimulation({ ...DEFAULT_CONFIG, preset: 'R', agentCount: 16,
      agentRadius: radius, agentGap: gap }, getScenario('open-field'));
    const slots = Array.from({ length: sim.state.count }, (_, i) => sim.goalForAgent(i));
    const settle = Math.max(0.25, radius * 0.2);
    const detourRadius = retainedBodyDetourRadius(radius, radius, gap);
    let nearest = Infinity;
    for (let a = 0; a < slots.length; a += 1) for (let b = a + 1; b < slots.length; b += 1) {
      nearest = Math.min(nearest, Math.hypot(slots[a]!.x - slots[b]!.x, slots[a]!.y - slots[b]!.y));
    }
    // Worst-case settled centres approach each other by one tolerance each.
    // Their routing envelopes must still leave a traversable passage.
    expect(nearest - settle * 2).toBeGreaterThanOrEqual(detourRadius * 2 - 1e-9);
    expect(sim.experimentStats.unavailableSlots).toBe(0);
  });
  it('reallocates retained slots and reactivates parked bodies when a changed gap invalidates their lattice', () => {
    const sim = create('R', 4);
    for (let tick = 0; tick < 600; tick += 1) sim.step();
    expect(sim.metrics.arrivedCount).toBe(4);
    const oldSlots = Array.from({ length: 4 }, (_, i) => ({ ...sim.goalForAgent(i) }));
    sim.config.agentGap = 2;
    sim.updateObstacles([]);
    const slots = Array.from({ length: 4 }, (_, i) => sim.goalForAgent(i));
    expect(slots).not.toEqual(oldSlots);
    expect([...sim.state.active]).toEqual([1, 1, 1, 1]);
    const settle = Math.max(0.25, sim.config.agentRadius * 0.2);
    for (let a = 0; a < slots.length; a += 1) for (let b = a + 1; b < slots.length; b += 1) {
      expect(Math.hypot(slots[a]!.x - slots[b]!.x, slots[a]!.y - slots[b]!.y) - 2 * settle)
        .toBeGreaterThanOrEqual(2 * retainedBodyDetourRadius(sim.config.agentRadius, sim.config.agentRadius, 2) - 1e-9);
    }
  });
  it.each(['B0', 'B1', 'R', 'D'])('%s invalidates every dependent route when a distant gate closes and opens', (preset) => {
    const sim = create(preset, 2);
    const blocked = [{ x: 180, y: 0, width: 20, height: 200 }];
    sim.updateObstacles(blocked);
    const afterClose = sim.experimentStats.pathRequests + sim.experimentStats.fieldBuilds;
    for (let tick = 0; tick < 180; tick += 1) sim.step();
    expect(sim.state.x[0]).toBeLessThan(180);
    sim.updateObstacles([]);
    expect(sim.experimentStats.terrainVersion).toBe(2);
    expect(sim.experimentStats.pathRequests + sim.experimentStats.fieldBuilds).toBeGreaterThan(afterClose);
    for (let tick = 0; tick < 600; tick += 1) sim.step();
    expect(sim.metrics.arrivedCount).toBe(2);
  });
  it('shared field goal cap rejects a batch transactionally and legacy rejects unsupported individual goals', () => {
    const sim = create('B1', 160); const before = sim.stateHash();
    expect(() => sim.setAgentGoals(Array.from({ length: sim.state.count }, (_, agent) => ({ agent, goal: { x: 250 + agent * 0.1, y: 80 } })))).toThrow(/128/);
    expect(sim.stateHash()).toBe(before);
    expect(() => sim.setGoal(NaN, 100)).toThrow(); expect(sim.stateHash()).toBe(before);
    expect(() => create('legacy', 1).setAgentGoal(0, 10, 10)).toThrow(/experimental/);
  });
  it('rejects construction on active or retained bodies atomically but permits departed exits', () => {
    const sim = create('R', 2);
    const original = sim.stateHash(); const obstacles = sim.scenario.obstacles;
    const occupied = () => [{ x: sim.state.x[0]! - 2, y: sim.state.y[0]! - 2, width: 4, height: 4 }];
    expect(() => sim.updateObstacles(occupied())).toThrow(/occupied/);
    expect(sim.stateHash()).toBe(original); expect(sim.scenario.obstacles).toBe(obstacles);
    expect(sim.experimentStats.terrainVersion).toBe(0);
    for (let tick = 0; tick < 600; tick += 1) sim.step();
    expect(sim.state.active[0]).toBe(0);
    expect(() => sim.updateObstacles(occupied())).toThrow(/occupied/);
    const departed = create('B1', 1);
    for (let tick = 0; tick < 600; tick += 1) departed.step();
    expect(departed.state.active[0]).toBe(0);
    expect(() => departed.updateObstacles([{ x: departed.state.x[0]! - 2, y: departed.state.y[0]! - 2, width: 4, height: 4 }])).not.toThrow();
    expect(departed.experimentStats.terrainVersion).toBe(1);
  });
  it('a goal inside a wall yields unavailable slots and waiting without unsafe direct steering', () => {
    const sim = create('R', 16, { ...OPEN, obstacles: [{ x: 320, y: 80, width: 40, height: 40 }] });
    expect(sim.experimentStats.unavailableSlots).toBe(16);
    const before = [...sim.state.x];
    sim.step();
    for (let agent = 0; agent < sim.state.count; agent += 1) expect(sim.state.x[agent]).toBeCloseTo(before[agent]!, 4);
    expect(sim.experimentStats.waitingCount).toBe(16);
    expect(sim.experimentStats.arrivedCount).toBe(0);
    const out = { x: 1, y: 1 };
    expect(sim.sampleNavigationDirection(0, sim.state.x[0]!, sim.state.y[0]!, out)).toBe(false);
    expect(out).toEqual({ x: 0, y: 0 });
  });
});
