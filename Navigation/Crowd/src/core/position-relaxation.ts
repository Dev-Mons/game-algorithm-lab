import { clamp } from './math';
import { projectCircleOutsideRectWithinBounds, type CircleProjection } from './obstacle-collision';
import type { AgentBuffer } from './agent-state';
import type { Rect } from './types';

const SAFETY_EPSILON = 1e-9;

export interface PositionRelaxationInput {
  /** Post-integration state. Positions are corrected in place; velocities are untouched. */
  next: AgentBuffer;
  active: Uint8Array;
  /** Deterministic neighbor cache built from start-of-step positions. */
  neighborOffsets: Int32Array;
  neighborIndices: Int32Array;
  agentRadius: number;
  /** Total agent-agent correction budget per agent for this step, in px. */
  maxCorrection: number;
  iterations: number;
  obstacles: readonly Rect[];
  worldWidth: number;
  worldHeight: number;
  /** Static clearance envelope corrections must respect (radius + margin + skin). */
  staticClearance: number;
  overlapFlags?: Uint8Array;
}

export interface PositionRelaxationResult {
  /** Agents that received any positional correction this step. */
  correctedAgents: number;
  /** Largest total per-agent correction distance this step, in px. */
  maxCorrection: number;
  /** Agent pairs still closer than the hard contact radius after relaxation. */
  remainingOverlapPairs: number;
  candidateChecks: number;
}

/**
 * Symmetric, capped positional relaxation for residual agent contacts.
 *
 * Each overlapping pair moves both endpoints apart by half the penetration
 * along the center line, limited by a per-agent per-step budget so a deep jam
 * relaxes over several frames instead of visibly teleporting. Static obstacles
 * and world bounds are hard: those projections are not budget-limited and run
 * last in every iteration, so the final position always respects the same
 * clearance envelope the swept static integrator validates next frame.
 * Velocities are never rewritten — a correction is spatial, not kinematic.
 * All iteration orders are fixed, keeping the result deterministic.
 */
export class PositionRelaxationSolver {
  private budget = new Float64Array(0);
  private movedDistance = new Float64Array(0);
  private readonly projection: CircleProjection = { x: 0, y: 0, normalX: 0, normalY: 0 };

  private readonly result: PositionRelaxationResult = {
    correctedAgents: 0,
    maxCorrection: 0,
    remainingOverlapPairs: 0,
    candidateChecks: 0,
  };

  solve(input: PositionRelaxationInput): PositionRelaxationResult {
    this.assertCompatibleInput(input);
    this.ensureCapacity(input.next.count);
    this.result.correctedAgents = 0;
    this.result.maxCorrection = 0;
    this.result.remainingOverlapPairs = 0;
    this.result.candidateChecks = 0;
    input.overlapFlags?.fill(0);
    this.budget.fill(Math.max(0, input.maxCorrection), 0, input.next.count);
    this.movedDistance.fill(0, 0, input.next.count);

    const next = input.next;
    const hardRadius = input.agentRadius * 2;
    const hardRadiusSquared = hardRadius * hardRadius;
    const iterations = Math.max(1, Math.floor(input.iterations));

    for (let iteration = 0; iteration < iterations; iteration += 1) {
      let moved = false;
      for (let agent = 0; agent < next.count; agent += 1) {
        if (input.active[agent] !== 1) continue;
        const start = input.neighborOffsets[agent]!;
        const end = input.neighborOffsets[agent + 1]!;
        for (let offset = start; offset < end; offset += 1) {
          const other = input.neighborIndices[offset]!;
          if (other <= agent || input.active[other] !== 1) continue;
          this.result.candidateChecks += 1;
          const dx = next.x[agent]! - next.x[other]!;
          const dy = next.y[agent]! - next.y[other]!;
          const distanceSquared = dx * dx + dy * dy;
          if (distanceSquared >= hardRadiusSquared - SAFETY_EPSILON) continue;
          const distance = Math.sqrt(distanceSquared);
          let normalX: number;
          let normalY: number;
          if (distance > 1e-9) {
            normalX = dx / distance;
            normalY = dy / distance;
          } else {
            // Coincident centers: a stable pair-derived axis keeps the split
            // deterministic without preferring the world axes for every pair.
            const spread = ((agent + 1) * 2654435761 ^ (other + 1) * 40503) >>> 0;
            const angle = (spread / 4294967296) * Math.PI * 2;
            normalX = Math.cos(angle);
            normalY = Math.sin(angle);
          }
          const half = (hardRadius - distance) * 0.5;
          const pushAgent = Math.min(half, this.budget[agent]!);
          const pushOther = Math.min(half, this.budget[other]!);
          if (pushAgent <= 0 && pushOther <= 0) continue;
          next.x[agent] = next.x[agent]! + normalX * pushAgent;
          next.y[agent] = next.y[agent]! + normalY * pushAgent;
          next.x[other] = next.x[other]! - normalX * pushOther;
          next.y[other] = next.y[other]! - normalY * pushOther;
          this.budget[agent] = this.budget[agent]! - pushAgent;
          this.budget[other] = this.budget[other]! - pushOther;
          this.movedDistance[agent] = this.movedDistance[agent]! + pushAgent;
          this.movedDistance[other] = this.movedDistance[other]! + pushOther;
          // Clamp each push against statics immediately. Deferring this to the
          // end-of-iteration static pass lets crowd pressure funnel several
          // agents into the same wall corner, where the deferred projection
          // maps them onto one point — a persistent full-diameter overlap.
          this.projectOutsideStatics(input, agent);
          this.projectOutsideStatics(input, other);
          moved = true;
        }
      }
      // Statics run last inside every iteration so the loop always ends with a
      // position that satisfies the clearance envelope.
      for (let agent = 0; agent < next.count; agent += 1) {
        if (input.active[agent] !== 1) continue;
        if (this.projectOutsideStatics(input, agent)) moved = true;
      }
      if (!moved) break;
    }

    for (let agent = 0; agent < next.count; agent += 1) {
      if (input.active[agent] !== 1 || this.movedDistance[agent]! <= 0) continue;
      this.result.correctedAgents += 1;
      this.result.maxCorrection = Math.max(this.result.maxCorrection, this.movedDistance[agent]!);
    }
    for (let agent = 0; agent < next.count; agent += 1) {
      if (input.active[agent] !== 1) continue;
      const start = input.neighborOffsets[agent]!;
      const end = input.neighborOffsets[agent + 1]!;
      for (let offset = start; offset < end; offset += 1) {
        const other = input.neighborIndices[offset]!;
        if (other <= agent || input.active[other] !== 1) continue;
        this.result.candidateChecks += 1;
        const dx = next.x[agent]! - next.x[other]!;
        const dy = next.y[agent]! - next.y[other]!;
        if (dx * dx + dy * dy >= hardRadiusSquared - SAFETY_EPSILON) continue;
        this.result.remainingOverlapPairs += 1;
        if (input.overlapFlags) {
          input.overlapFlags[agent] = 1;
          input.overlapFlags[other] = 1;
        }
      }
    }
    return this.result;
  }

  private projectOutsideStatics(input: PositionRelaxationInput, agent: number): boolean {
    const next = input.next;
    const clearance = input.staticClearance;
    let x = next.x[agent]!;
    let y = next.y[agent]!;
    let moved = false;
    const boundedX = clamp(x, clearance, input.worldWidth - clearance);
    const boundedY = clamp(y, clearance, input.worldHeight - clearance);
    if (boundedX !== x || boundedY !== y) {
      this.movedDistance[agent] = this.movedDistance[agent]! + Math.hypot(boundedX - x, boundedY - y);
      x = boundedX;
      y = boundedY;
      moved = true;
    }
    for (const obstacle of input.obstacles) {
      if (!projectCircleOutsideRectWithinBounds(
        x,
        y,
        clearance,
        obstacle,
        input.worldWidth,
        input.worldHeight,
        this.projection,
      )) continue;
      this.movedDistance[agent] = this.movedDistance[agent]!
        + Math.hypot(this.projection.x - x, this.projection.y - y);
      x = this.projection.x;
      y = this.projection.y;
      moved = true;
    }
    if (moved) {
      next.x[agent] = x;
      next.y[agent] = y;
    }
    return moved;
  }

  private assertCompatibleInput(input: PositionRelaxationInput): void {
    const count = input.next.count;
    if (
      input.active.length < count
      || input.neighborOffsets.length < count + 1
      || (input.overlapFlags !== undefined && input.overlapFlags.length < count)
    ) throw new RangeError('Position relaxation buffers must describe the same agent count.');
  }

  private ensureCapacity(count: number): void {
    if (this.budget.length >= count) return;
    this.budget = new Float64Array(count);
    this.movedDistance = new Float64Array(count);
  }
}
