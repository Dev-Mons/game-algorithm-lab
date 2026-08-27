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
  recoveryRate: number;
  maximumOverlaps: number;
  maximumWallOverlaps: number;
  hash: string;
}

/** Generic measurements for any scenario containing two or more flows. */
export class FlowBehaviorTracker {
  private readonly initialAgents: Uint32Array;
  private readonly crossings: Uint32Array;
  private readonly arrived: Uint32Array;
  private readonly maximumStarvationSteps: Uint32Array;
  private readonly lastCrossingStep: Int32Array;
  private readonly directionX: Float64Array;
  private readonly directionY: Float64Array;
  private readonly centerX: Float64Array;
  private readonly centerY: Float64Array;
  private readonly previousPlane: Float64Array;
  private readonly previousActive: Uint8Array;
  private readonly rollingCrossings: Uint32Array;
  private rollingIndex = 0;
  private rollingSamples = 0;
  private rollingSum = 0;
  private totalCrossings = 0;
  private firstCrossingStep = -1;
  private minimumRollingThroughput = Number.POSITIVE_INFINITY;
  private activeAgentFrames = 0;
  private recoveredAgentFrames = 0;
  private maximumOverlaps = 0;
  private maximumWallOverlaps = 0;

  constructor(
    private readonly simulation: CrowdSimulation,
    rollingWindowSteps = 300,
  ) {
    const definitions = simulation.scenario.flows;
    if (!definitions || definitions.length < 2) {
      throw new Error('FlowBehaviorTracker requires a scenario with at least two flows.');
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
    this.centerX = new Float64Array(flowCount);
    this.centerY = new Float64Array(flowCount);
    this.previousPlane = new Float64Array(simulation.state.count);
    this.previousActive = new Uint8Array(simulation.state.active);
    this.rollingCrossings = new Uint32Array(Math.max(1, rollingWindowSteps));

    for (let flow = 0; flow < flowCount; flow += 1) {
      const definition = definitions[flow]!;
      const spawnX = definition.spawn.x + definition.spawn.width * 0.5;
      const spawnY = definition.spawn.y + definition.spawn.height * 0.5;
      let dx = definition.goal.x - spawnX;
      let dy = definition.goal.y - spawnY;
      const length = Math.hypot(dx, dy);
      dx = length > EPSILON ? dx / length : 1;
      dy = length > EPSILON ? dy / length : 0;
      this.directionX[flow] = dx;
      this.directionY[flow] = dy;
      this.centerX[flow] = (spawnX + definition.goal.x) * 0.5;
      this.centerY[flow] = (spawnY + definition.goal.y) * 0.5;
    }
    for (let agent = 0; agent < simulation.state.count; agent += 1) {
      const flow = simulation.agentFlow[agent]!;
      this.initialAgents[flow] = this.initialAgents[flow]! + 1;
      this.previousPlane[agent] = this.plane(
        flow,
        simulation.state.x[agent]!,
        simulation.state.y[agent]!,
      );
    }
  }

  update(): void {
    const simulation = this.simulation;
    const step = simulation.stepCount;
    let stepCrossings = 0;
    for (let agent = 0; agent < simulation.state.count; agent += 1) {
      const flow = simulation.agentFlow[agent]!;
      const active = simulation.state.active[agent] === 1;
      const plane = this.plane(flow, simulation.state.x[agent]!, simulation.state.y[agent]!);
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
    this.recoveredAgentFrames += simulation.metrics.recoveredAgents;
    this.maximumOverlaps = Math.max(this.maximumOverlaps, simulation.metrics.overlapPairs);
    this.maximumWallOverlaps = Math.max(
      this.maximumWallOverlaps,
      simulation.metrics.wallOverlapCount,
    );
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
      recoveryRate: this.recoveredAgentFrames / Math.max(1, this.activeAgentFrames),
      maximumOverlaps: this.maximumOverlaps,
      maximumWallOverlaps: this.maximumWallOverlaps,
      hash: this.simulation.stateHash(),
    };
  }

  private plane(flow: number, x: number, y: number): number {
    return (x - this.centerX[flow]!) * this.directionX[flow]!
      + (y - this.centerY[flow]!) * this.directionY[flow]!;
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
