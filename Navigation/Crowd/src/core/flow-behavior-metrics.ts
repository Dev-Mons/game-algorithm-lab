import type { CrowdSimulation } from './simulation';

const EPSILON = 1e-9;

export interface FlowBehaviorSnapshot {
  steps: number;
  initialAgents: number[];
  crossings: number[];
  arrived: number[];
  crossingFairness: number;
  arrivalFairness: number;
  maximumStarvationSteps: number[];
  minimumRollingThroughputPerSecond: number;
  laneSwitchRateFirstHalf: number;
  laneSwitchRateSecondHalf: number;
  safetyFallbackRate: number;
  maximumOverlaps: number;
  maximumWallOverlaps: number;
  hash: string;
}

/**
 * Allocation-free-per-step behavior tracker for multi-flow acceptance runs.
 * A crossing is counted on the flow's directed plane through the configured
 * conflict-zone center; this makes merge, opposing, and perpendicular streams
 * comparable without baking scenario-specific x/y gates into the harness.
 */
export class FlowBehaviorTracker {
  private readonly initialAgents: Uint32Array;
  private readonly crossings: Uint32Array;
  private readonly arrived: Uint32Array;
  private readonly maximumStarvationSteps: Uint32Array;
  private readonly lastCrossingStep: Int32Array;
  private readonly directionX: Float64Array;
  private readonly directionY: Float64Array;
  private readonly previousPlane: Float64Array;
  private readonly previousActive: Uint8Array;
  private readonly previousLateralSign: Int8Array;
  private readonly rollingCrossings: Uint32Array;
  private rollingIndex = 0;
  private rollingSamples = 0;
  private rollingSum = 0;
  private totalCrossings = 0;
  private firstCrossingStep = -1;
  private minimumRollingThroughput = Number.POSITIVE_INFINITY;
  private firstHalfLaneSwitches = 0;
  private secondHalfLaneSwitches = 0;
  private firstHalfAgentFrames = 0;
  private secondHalfAgentFrames = 0;
  private activeAgentFrames = 0;
  private safetyFallbackAgentFrames = 0;
  private maximumOverlaps = 0;
  private maximumWallOverlaps = 0;

  constructor(
    private readonly simulation: CrowdSimulation,
    private readonly expectedSteps: number,
    rollingWindowSteps = 300,
  ) {
    if (!simulation.scenario.flowControl || simulation.flowCount < 2) {
      throw new Error('FlowBehaviorTracker requires a multi-flow scenario with flowControl.');
    }
    const flowCount = simulation.flowCount;
    this.initialAgents = new Uint32Array(flowCount);
    this.crossings = new Uint32Array(flowCount);
    this.arrived = new Uint32Array(flowCount);
    this.maximumStarvationSteps = new Uint32Array(flowCount);
    this.lastCrossingStep = new Int32Array(flowCount);
    this.lastCrossingStep.fill(-1);
    this.directionX = new Float64Array(flowCount);
    this.directionY = new Float64Array(flowCount);
    this.previousPlane = new Float64Array(simulation.state.count);
    this.previousActive = new Uint8Array(simulation.state.active);
    this.previousLateralSign = new Int8Array(simulation.state.count);
    this.rollingCrossings = new Uint32Array(Math.max(1, rollingWindowSteps));

    const definitions = simulation.scenario.flows!;
    const center = simulation.scenario.flowControl.center;
    for (let flow = 0; flow < flowCount; flow += 1) {
      const definition = definitions[flow]!;
      const spawnX = definition.spawn.x + definition.spawn.width * 0.5;
      const spawnY = definition.spawn.y + definition.spawn.height * 0.5;
      let dx = definition.goal.x - spawnX;
      let dy = definition.goal.y - spawnY;
      const length = Math.hypot(dx, dy);
      if (length > EPSILON) {
        dx /= length;
        dy /= length;
      } else {
        dx = 1;
        dy = 0;
      }
      this.directionX[flow] = dx;
      this.directionY[flow] = dy;
    }
    for (let agent = 0; agent < simulation.state.count; agent += 1) {
      const flow = simulation.agentFlow[agent]!;
      this.initialAgents[flow] = this.initialAgents[flow]! + 1;
      this.previousPlane[agent] = this.plane(agent, simulation.state.x[agent]!, simulation.state.y[agent]!, center.x, center.y);
    }
  }

  update(): void {
    const simulation = this.simulation;
    const control = simulation.scenario.flowControl!;
    const step = simulation.stepCount;
    let stepCrossings = 0;
    const firstHalf = step <= this.expectedSteps * 0.5;
    for (let agent = 0; agent < simulation.state.count; agent += 1) {
      const flow = simulation.agentFlow[agent]!;
      const active = simulation.state.active[agent] === 1;
      const plane = this.plane(
        agent,
        simulation.state.x[agent]!,
        simulation.state.y[agent]!,
        control.center.x,
        control.center.y,
      );
      if (this.previousPlane[agent]! < 0 && plane >= 0) {
        this.crossings[flow] = this.crossings[flow]! + 1;
        this.lastCrossingStep[flow] = step;
        this.totalCrossings += 1;
        stepCrossings += 1;
        if (this.firstCrossingStep < 0) this.firstCrossingStep = step;
      }
      this.previousPlane[agent] = plane;
      if (this.previousActive[agent] === 1 && !active) {
        this.arrived[flow] = this.arrived[flow]! + 1;
      }
      this.previousActive[agent] = active ? 1 : 0;
      if (!active) continue;

      const inConflictApproach = Math.abs(plane)
        <= control.radius + control.approachDistance;
      if (!inConflictApproach) {
        this.previousLateralSign[agent] = 0;
        continue;
      }
      if (firstHalf) this.firstHalfAgentFrames += 1;
      else this.secondHalfAgentFrames += 1;
      const lateralVelocity = simulation.state.vx[agent]! * -this.directionY[flow]!
        + simulation.state.vy[agent]! * this.directionX[flow]!;
      const threshold = simulation.config.maxSpeed * 0.05;
      const sign = lateralVelocity > threshold ? 1 : lateralVelocity < -threshold ? -1 : 0;
      if (
        sign !== 0
        && this.previousLateralSign[agent] !== 0
        && sign !== this.previousLateralSign[agent]
      ) {
        if (firstHalf) this.firstHalfLaneSwitches += 1;
        else this.secondHalfLaneSwitches += 1;
      }
      if (sign !== 0) this.previousLateralSign[agent] = sign;
    }

    const evicted = this.rollingCrossings[this.rollingIndex]!;
    this.rollingSum -= evicted;
    this.rollingCrossings[this.rollingIndex] = stepCrossings;
    this.rollingSum += stepCrossings;
    this.rollingIndex = (this.rollingIndex + 1) % this.rollingCrossings.length;
    this.rollingSamples = Math.min(this.rollingCrossings.length, this.rollingSamples + 1);
    if (
      this.firstCrossingStep >= 0
      && this.rollingSamples === this.rollingCrossings.length
      && this.totalCrossings < simulation.state.count * 0.95
    ) {
      const seconds = this.rollingCrossings.length * simulation.config.fixedDelta;
      this.minimumRollingThroughput = Math.min(
        this.minimumRollingThroughput,
        this.rollingSum / Math.max(seconds, EPSILON),
      );
    }

    if (this.firstCrossingStep >= 0) {
      for (let flow = 0; flow < this.crossings.length; flow += 1) {
        if (this.crossings[flow]! >= this.initialAgents[flow]! * 0.95) continue;
        const previous = this.lastCrossingStep[flow]! >= 0
          ? this.lastCrossingStep[flow]!
          : this.firstCrossingStep;
        this.maximumStarvationSteps[flow] = Math.max(
          this.maximumStarvationSteps[flow]!,
          step - previous,
        );
      }
    }
    this.activeAgentFrames += simulation.metrics.activeCount;
    this.safetyFallbackAgentFrames += simulation.metrics.safetyFallbackCount;
    this.maximumOverlaps = Math.max(this.maximumOverlaps, simulation.metrics.overlapPairs);
    this.maximumWallOverlaps = Math.max(this.maximumWallOverlaps, simulation.metrics.wallOverlapCount);
  }

  snapshot(): FlowBehaviorSnapshot {
    const crossings = Array.from(this.crossings);
    const arrived = Array.from(this.arrived);
    return {
      steps: this.simulation.stepCount,
      initialAgents: Array.from(this.initialAgents),
      crossings,
      arrived,
      crossingFairness: jainFairness(crossings),
      arrivalFairness: jainFairness(arrived),
      maximumStarvationSteps: Array.from(this.maximumStarvationSteps),
      minimumRollingThroughputPerSecond: Number.isFinite(this.minimumRollingThroughput)
        ? this.minimumRollingThroughput
        : 0,
      laneSwitchRateFirstHalf: this.firstHalfLaneSwitches * 60_000
        / Math.max(1, this.firstHalfAgentFrames),
      laneSwitchRateSecondHalf: this.secondHalfLaneSwitches * 60_000
        / Math.max(1, this.secondHalfAgentFrames),
      safetyFallbackRate: this.safetyFallbackAgentFrames / Math.max(1, this.activeAgentFrames),
      maximumOverlaps: this.maximumOverlaps,
      maximumWallOverlaps: this.maximumWallOverlaps,
      hash: this.simulation.stateHash(),
    };
  }

  private plane(agent: number, x: number, y: number, centerX: number, centerY: number): number {
    const flow = this.simulation.agentFlow[agent]!;
    return (x - centerX) * this.directionX[flow]! + (y - centerY) * this.directionY[flow]!;
  }
}

export function jainFairness(values: readonly number[]): number {
  let sum = 0;
  let sumSquared = 0;
  for (const value of values) {
    sum += value;
    sumSquared += value * value;
  }
  return sumSquared <= EPSILON ? 0 : (sum * sum) / (values.length * sumSquared);
}
