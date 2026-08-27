import type { AgentBuffer } from '../../core/agent-state';
import { clamp } from '../../core/math';
import type { Rect } from '../../core/types';

const EPSILON = 1e-9;

export interface CoupledVelocityProjectionInput {
  current: AgentBuffer;
  active: Uint8Array;
  neighborOffsets: Int32Array;
  neighborIndices: Int32Array;
  velocityX: Float64Array;
  velocityY: Float64Array;
  agentRadius: number;
  fixedDelta: number;
  maxAcceleration: number;
  maxSpeed: number;
  iterations: number;
  separationSkin?: number;
  /** Optional constant-velocity look-ahead for coupled early avoidance. */
  timeHorizon?: number;
  obstacles?: readonly Rect[];
  worldWidth?: number;
  worldHeight?: number;
  wallClearance?: number;
  staticResponseTime?: number;
}

export interface CoupledVelocityProjectionResult {
  correctedAgents: number;
  correctionCount: number;
  candidateChecks: number;
  remainingOverlapPairs: number;
  maximumVelocityCorrection: number;
}

/**
 * Coupled hard-contact tier for the unified velocity agreement.
 *
 * ORCA's reciprocal half-planes are solved independently. In a tightly packed
 * turn, several otherwise valid reciprocal choices can jointly consume the
 * whole acceleration disk and leave a tiny endpoint conflict. This projector
 * resolves those pair constraints symmetrically while every velocity remains
 * inside its original acceleration and speed disks. It changes velocities,
 * never positions, and therefore remains part of the local velocity authority
 * rather than a post-integration reservation or depenetration pass.
 */
export class CoupledVelocityProjector {
  private corrected = new Uint8Array(0);
  private readonly result: CoupledVelocityProjectionResult = {
    correctedAgents: 0,
    correctionCount: 0,
    candidateChecks: 0,
    remainingOverlapPairs: 0,
    maximumVelocityCorrection: 0,
  };

  solve(input: CoupledVelocityProjectionInput): CoupledVelocityProjectionResult {
    const count = input.current.count;
    if (this.corrected.length < count) this.corrected = new Uint8Array(count);
    this.corrected.fill(0, 0, count);
    this.result.correctedAgents = 0;
    this.result.correctionCount = 0;
    this.result.candidateChecks = 0;
    this.result.remainingOverlapPairs = 0;
    this.result.maximumVelocityCorrection = 0;

    const radius = Math.max(0, input.agentRadius * 2 + (input.separationSkin ?? 0));
    const radiusSquared = radius * radius;
    const maximumDelta = Math.max(0, input.maxAcceleration) * input.fixedDelta;
    const iterations = Math.max(1, Math.floor(input.iterations));

    for (let iteration = 0; iteration < iterations; iteration += 1) {
      let changed = false;
      // Alternating pair order removes a persistent low-ID directional bias
      // while retaining deterministic execution.
      const reverse = (iteration & 1) === 1;
      for (let sequence = 0; sequence < count; sequence += 1) {
        const agent = reverse ? count - sequence - 1 : sequence;
        if (input.active[agent] !== 1) continue;
        const start = input.neighborOffsets[agent]!;
        const end = input.neighborOffsets[agent + 1]!;
        for (let offset = start; offset < end; offset += 1) {
          const other = input.neighborIndices[offset]!;
          if (input.active[other] !== 1 || other <= agent) continue;
          this.result.candidateChecks += 1;

          const positionX = input.current.x[other]! - input.current.x[agent]!;
          const positionY = input.current.y[other]! - input.current.y[agent]!;
          const relativeVelocityX = input.velocityX[other]! - input.velocityX[agent]!;
          const relativeVelocityY = input.velocityY[other]! - input.velocityY[agent]!;
          let constraintTime = input.fixedDelta;
          let dx = positionX + relativeVelocityX * constraintTime;
          let dy = positionY + relativeVelocityY * constraintTime;
          const distanceSquared = dx * dx + dy * dy;
          if (distanceSquared >= radiusSquared - EPSILON) {
            const timeHorizon = Math.max(input.fixedDelta, input.timeHorizon ?? input.fixedDelta);
            if (timeHorizon <= input.fixedDelta + EPSILON) continue;
            const relativeSpeedSquared = relativeVelocityX * relativeVelocityX
              + relativeVelocityY * relativeVelocityY;
            if (relativeSpeedSquared <= EPSILON) continue;
            constraintTime = Math.max(
              input.fixedDelta,
              Math.min(
                timeHorizon,
                -(positionX * relativeVelocityX + positionY * relativeVelocityY)
                  / relativeSpeedSquared,
              ),
            );
            dx = positionX + relativeVelocityX * constraintTime;
            dy = positionY + relativeVelocityY * constraintTime;
            if (dx * dx + dy * dy >= radiusSquared - EPSILON) continue;
          }

          const constrainedDistanceSquared = dx * dx + dy * dy;
          let distance = Math.sqrt(Math.max(0, constrainedDistanceSquared));
          if (distance <= EPSILON) {
            dx = input.current.x[other]! - input.current.x[agent]!;
            dy = input.current.y[other]! - input.current.y[agent]!;
            distance = Math.hypot(dx, dy);
            if (distance <= EPSILON) {
              dx = 0;
              dy = agent < other ? 1 : -1;
              distance = 1;
            }
          }
          const normalX = dx / distance;
          const normalY = dy / distance;
          const required = (radius - Math.sqrt(Math.max(0, constrainedDistanceSquared)) + 1e-6)
            / constraintTime;
          const capacityA = Math.min(this.directionalCapacity(
            input.velocityX[agent]!,
            input.velocityY[agent]!,
            input.current.vx[agent]!,
            input.current.vy[agent]!,
            -normalX,
            -normalY,
            maximumDelta,
            input.maxSpeed,
          ), this.staticDirectionalCapacity(input, agent, -normalX, -normalY));
          const capacityB = Math.min(this.directionalCapacity(
            input.velocityX[other]!,
            input.velocityY[other]!,
            input.current.vx[other]!,
            input.current.vy[other]!,
            normalX,
            normalY,
            maximumDelta,
            input.maxSpeed,
          ), this.staticDirectionalCapacity(input, other, normalX, normalY));
          if (capacityA + capacityB <= EPSILON) continue;

          let correctionA = Math.min(capacityA, required * 0.5);
          let correctionB = Math.min(capacityB, required - correctionA);
          correctionA += Math.min(capacityA - correctionA, required - correctionA - correctionB);
          correctionB += Math.min(capacityB - correctionB, required - correctionA - correctionB);
          if (correctionA + correctionB <= EPSILON) continue;

          input.velocityX[agent] = input.velocityX[agent]! - normalX * correctionA;
          input.velocityY[agent] = input.velocityY[agent]! - normalY * correctionA;
          input.velocityX[other] = input.velocityX[other]! + normalX * correctionB;
          input.velocityY[other] = input.velocityY[other]! + normalY * correctionB;
          if (this.corrected[agent] === 0) {
            this.corrected[agent] = 1;
            this.result.correctedAgents += 1;
          }
          if (this.corrected[other] === 0) {
            this.corrected[other] = 1;
            this.result.correctedAgents += 1;
          }
          this.result.correctionCount += 1;
          this.result.maximumVelocityCorrection = Math.max(
            this.result.maximumVelocityCorrection,
            correctionA,
            correctionB,
          );
          changed = true;
        }
      }
      if (!changed) break;
    }

    for (let agent = 0; agent < count; agent += 1) {
      if (input.active[agent] !== 1) continue;
      const start = input.neighborOffsets[agent]!;
      const end = input.neighborOffsets[agent + 1]!;
      for (let offset = start; offset < end; offset += 1) {
        const other = input.neighborIndices[offset]!;
        if (input.active[other] !== 1 || other <= agent) continue;
        this.result.candidateChecks += 1;
        const dx = input.current.x[other]! + input.velocityX[other]! * input.fixedDelta
          - input.current.x[agent]! - input.velocityX[agent]! * input.fixedDelta;
        const dy = input.current.y[other]! + input.velocityY[other]! * input.fixedDelta
          - input.current.y[agent]! - input.velocityY[agent]! * input.fixedDelta;
        if (dx * dx + dy * dy < radiusSquared - EPSILON) {
          this.result.remainingOverlapPairs += 1;
        }
      }
    }
    return this.result;
  }

  private directionalCapacity(
    velocityX: number,
    velocityY: number,
    currentVelocityX: number,
    currentVelocityY: number,
    directionX: number,
    directionY: number,
    maximumDelta: number,
    maxSpeed: number,
  ): number {
    const deltaX = velocityX - currentVelocityX;
    const deltaY = velocityY - currentVelocityY;
    const accelerationCapacity = this.rayCircleCapacity(
      deltaX,
      deltaY,
      directionX,
      directionY,
      maximumDelta,
    );
    const speedCapacity = this.rayCircleCapacity(
      velocityX,
      velocityY,
      directionX,
      directionY,
      Math.max(0, maxSpeed),
    );
    return Math.max(0, Math.min(accelerationCapacity, speedCapacity));
  }

  private rayCircleCapacity(
    x: number,
    y: number,
    directionX: number,
    directionY: number,
    radius: number,
  ): number {
    const projection = x * directionX + y * directionY;
    const discriminant = projection * projection + radius * radius - x * x - y * y;
    if (discriminant <= EPSILON) return Math.max(0, -projection);
    return Math.max(0, -projection + Math.sqrt(discriminant));
  }

  private staticDirectionalCapacity(
    input: CoupledVelocityProjectionInput,
    agent: number,
    directionX: number,
    directionY: number,
  ): number {
    if (
      input.obstacles === undefined
      || input.worldWidth === undefined
      || input.worldHeight === undefined
      || input.wallClearance === undefined
    ) return Number.POSITIVE_INFINITY;
    const response = Math.max(input.fixedDelta, input.staticResponseTime ?? 0.25);
    const activationGap = input.maxSpeed * response;
    const x = input.current.x[agent]!;
    const y = input.current.y[agent]!;
    const velocityX = input.velocityX[agent]!;
    const velocityY = input.velocityY[agent]!;
    let capacity = Number.POSITIVE_INFINITY;
    capacity = this.limitStaticLine(
      capacity, 1, 0, x - input.wallClearance,
      activationGap, response, velocityX, velocityY, directionX, directionY,
    );
    capacity = this.limitStaticLine(
      capacity, -1, 0, input.worldWidth - x - input.wallClearance,
      activationGap, response, velocityX, velocityY, directionX, directionY,
    );
    capacity = this.limitStaticLine(
      capacity, 0, 1, y - input.wallClearance,
      activationGap, response, velocityX, velocityY, directionX, directionY,
    );
    capacity = this.limitStaticLine(
      capacity, 0, -1, input.worldHeight - y - input.wallClearance,
      activationGap, response, velocityX, velocityY, directionX, directionY,
    );
    for (const obstacle of input.obstacles) {
      const closestX = clamp(x, obstacle.x, obstacle.x + obstacle.width);
      const closestY = clamp(y, obstacle.y, obstacle.y + obstacle.height);
      const offsetX = x - closestX;
      const offsetY = y - closestY;
      const distance = Math.hypot(offsetX, offsetY);
      if (distance <= EPSILON) continue;
      capacity = this.limitStaticLine(
        capacity,
        offsetX / distance,
        offsetY / distance,
        distance - input.wallClearance,
        activationGap,
        response,
        velocityX,
        velocityY,
        directionX,
        directionY,
      );
    }
    return capacity;
  }

  private limitStaticLine(
    capacity: number,
    normalX: number,
    normalY: number,
    gap: number,
    activationGap: number,
    response: number,
    velocityX: number,
    velocityY: number,
    directionX: number,
    directionY: number,
  ): number {
    if (gap >= activationGap) return capacity;
    const directionApproach = directionX * normalX + directionY * normalY;
    if (directionApproach >= -EPSILON) return capacity;
    const bound = -Math.max(0, gap) / response;
    const slack = velocityX * normalX + velocityY * normalY - bound;
    if (slack <= EPSILON) return 0;
    return Math.min(capacity, slack / -directionApproach);
  }
}
