import type { SpatialHash } from '../algorithms/spatial-hash/spatial-hash';
import type { AgentBuffer } from './agent-state';
import { clamp } from './math';
import {
  projectCircleOutsideRectWithinBounds,
  SweptCircleStaticIntegrator,
  type CircleProjection,
  type SweptCircleSlideOutput,
} from './obstacle-collision';
import type { Rect } from './types';

const EPSILON = 1e-9;
// Contact math intentionally ignores less than one hundredth of a pixel.
const REPORTABLE_PENETRATION = 0.01;
const ORCA_SAFETY_PADDING = 0.25;
const MAX_NEIGHBORS = 32;
const MAX_QUERY_VISITS = 96;
const MAX_LINES = MAX_NEIGHBORS + 1;
const RECOVERY_ITERATIONS = 24;
const DENSE_CROWD_THRESHOLD = 2_000;
const VERY_DENSE_CROWD_THRESHOLD = 5_000;
export const SCALABLE_CROWD_THRESHOLD = 5_000;
const DENSE_MAX_NEIGHBORS = 16;
const VERY_DENSE_MAX_NEIGHBORS = 12;
const SCALABLE_OVERLAP_QUERY_LIMIT = 8;
const DENSE_OVERLOAD_QUERY_LIMIT = 48;
const VERY_DENSE_OVERLOAD_QUERY_LIMIT = 16;
const DEFAULT_OVERLOAD_ITERATIONS = 4;
const DENSE_OVERLOAD_ITERATIONS = 2;
const VERY_DENSE_OVERLOAD_ITERATIONS = 1;
const OVERLOAD_CLEAR_STEPS = 4;
const MINIMUM_OVERLOADED_CELL_POPULATION = 16;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export interface CrowdMovementInput {
  current: AgentBuffer;
  next: AgentBuffer;
  index: SpatialHash;
  desiredVelocityX: Float64Array;
  desiredVelocityY: Float64Array;
  solvedVelocityX: Float64Array;
  solvedVelocityY: Float64Array;
  density: Float64Array;
  recovery: Uint8Array;
  overlapFlags: Uint8Array;
  agentRadius: number;
  agentGap: number;
  neighborRadius: number;
  maxSpeed: number;
  maxAcceleration: number;
  avoidanceHorizon: number;
  fixedDelta: number;
  wallClearance: number;
  worldWidth: number;
  worldHeight: number;
  obstacles: readonly Rect[];
}

export interface CrowdMovementResult {
  candidateChecks: number;
  totalNeighbors: number;
  maxNeighbors: number;
  overlapPairs: number;
  recoveredAgents: number;
  maxRecoveryDistance: number;
}

/**
 * The sole dynamic movement authority.
 *
 * Smaller crowds get an acceleration-reachable velocity chosen from reciprocal
 * collision half-planes plus speed and forward-progress constraints. At RTS
 * scale, dynamic overlap is intentional: the solver switches to a bounded
 * O(agent count + occupied cells) path and retains only exact static sweeps.
 * Position recovery is isolated to inherited invalid states.
 */
export class CrowdMovementSolver {
  private velocityX = new Float64Array(0);
  private velocityY = new Float64Array(0);
  private preferredX = new Float64Array(0);
  private preferredY = new Float64Array(0);
  private recoveryDistance = new Float64Array(0);
  private neighborIndices = new Int32Array(0);
  private neighborDistances = new Float64Array(0);
  private neighborCounts = new Uint8Array(0);
  private recoveryDirectionX = new Float64Array(0);
  private recoveryDirectionY = new Float64Array(0);
  private recoveryPushScale = new Float64Array(0);
  private readonly queryCandidates = new Int32Array(MAX_QUERY_VISITS);
  private queryNeighborCount = 0;
  private neighborLimit = MAX_NEIGHBORS;
  private overloadQueryLimit = MAX_QUERY_VISITS;
  private overloadIterationLimit = DEFAULT_OVERLOAD_ITERATIONS;
  private overloadRecoveryActive = false;
  private overloadClearSteps = 0;
  private readonly linePointX = new Float64Array(MAX_LINES);
  private readonly linePointY = new Float64Array(MAX_LINES);
  private readonly lineDirectionX = new Float64Array(MAX_LINES);
  private readonly lineDirectionY = new Float64Array(MAX_LINES);
  private readonly projectedPointX = new Float64Array(MAX_LINES);
  private readonly projectedPointY = new Float64Array(MAX_LINES);
  private readonly projectedDirectionX = new Float64Array(MAX_LINES);
  private readonly projectedDirectionY = new Float64Array(MAX_LINES);
  private lineCount = 0;
  private resultX = 0;
  private resultY = 0;
  private input: CrowdMovementInput | null = null;
  private queryAgent = 0;
  private queryRadiusSquared = 0;
  private recoveryPairs = 0;
  private countPairs = 0;
  private readonly integrator = new SweptCircleStaticIntegrator();
  private readonly integration: SweptCircleSlideOutput = {
    x: 0,
    y: 0,
    velocityX: 0,
    velocityY: 0,
    normalX: 0,
    normalY: 0,
    contactCount: 0,
    startedOverlapping: false,
    exhausted: false,
  };
  private readonly projection: CircleProjection = { x: 0, y: 0, normalX: 0, normalY: 0 };
  private readonly result: CrowdMovementResult = {
    candidateChecks: 0,
    totalNeighbors: 0,
    maxNeighbors: 0,
    overlapPairs: 0,
    recoveredAgents: 0,
    maxRecoveryDistance: 0,
  };

  solve(input: CrowdMovementInput): CrowdMovementResult {
    this.ensureCapacity(input.current.count);
    this.input = input;
    this.reset(input);
    if (input.current.count >= SCALABLE_CROWD_THRESHOLD) {
      this.solveScalable(input);
      this.input = null;
      return this.result;
    }
    // At crowd scale, visual stability benefits more from a bounded set of the
    // closest constraints than from solving dozens of nearly redundant lines.
    this.neighborLimit = input.current.count > VERY_DENSE_CROWD_THRESHOLD
      ? VERY_DENSE_MAX_NEIGHBORS
      : input.current.count > DENSE_CROWD_THRESHOLD ? DENSE_MAX_NEIGHBORS : MAX_NEIGHBORS;
    this.overloadQueryLimit = input.current.count > VERY_DENSE_CROWD_THRESHOLD
      ? VERY_DENSE_OVERLOAD_QUERY_LIMIT
      : input.current.count > DENSE_CROWD_THRESHOLD
        ? DENSE_OVERLOAD_QUERY_LIMIT
        : MAX_QUERY_VISITS;
    this.overloadIterationLimit = input.current.count > VERY_DENSE_CROWD_THRESHOLD
      ? VERY_DENSE_OVERLOAD_ITERATIONS
      : input.current.count > DENSE_CROWD_THRESHOLD
        ? DENSE_OVERLOAD_ITERATIONS
        : DEFAULT_OVERLOAD_ITERATIONS;
    input.index.rebuild(input.current.x, input.current.y, input.current.active);
    const physicalRadius = input.agentRadius * 2;
    const queryRadius = Math.max(
      input.neighborRadius,
      physicalRadius + Math.max(0, input.agentGap)
        + input.maxSpeed * 2 * Math.max(input.fixedDelta, input.avoidanceHorizon),
    );
    const neighborQueryLimit = this.neighborLimit === VERY_DENSE_MAX_NEIGHBORS
      ? 32
      : this.neighborLimit < MAX_NEIGHBORS ? 48 : MAX_QUERY_VISITS;
    this.queryRadiusSquared = queryRadius * queryRadius;

    // Preferred velocities are computed for the whole crowd before any ORCA
    // result is written, so agent iteration order cannot leak into the solve.
    for (let agent = 0; agent < input.current.count; agent += 1) {
      if (input.current.active[agent] !== 1) {
        this.preferredX[agent] = 0;
        this.preferredY[agent] = 0;
        this.velocityX[agent] = 0;
        this.velocityY[agent] = 0;
        continue;
      }
      this.queryAgent = agent;
      this.queryNeighborCount = 0;
      const candidateCount = input.index.queryCandidates(
        input.current.x[agent]!,
        input.current.y[agent]!,
        queryRadius,
        this.queryCandidates,
        neighborQueryLimit,
      );
      this.result.candidateChecks += candidateCount;
      for (let candidateIndex = 0; candidateIndex < candidateCount; candidateIndex += 1) {
        this.collectNeighbor(this.queryCandidates[candidateIndex]!);
      }
      this.neighborCounts[agent] = this.queryNeighborCount;
      this.calculatePreferredVelocity(input, agent);
      this.result.totalNeighbors += this.queryNeighborCount;
      this.result.maxNeighbors = Math.max(this.result.maxNeighbors, this.queryNeighborCount);
    }
    for (let agent = 0; agent < input.current.count; agent += 1) {
      if (input.current.active[agent] !== 1) continue;
      this.solveAgent(input, agent);
    }

    this.integrate(input);
    this.recoverInvalidPositions(input);
    this.publishVelocities(input);
    this.finishRecoveryMetrics(input);
    this.input = null;
    return this.result;
  }

  /**
   * Overlap-tolerant movement for TD/RTS-sized crowds.
   *
   * Dynamic agents do not constrain or repair one another here. That avoids
   * spending a frame trying to create physical space that the game explicitly
   * allows them to share. Cell populations remain useful for debug density,
   * while overlap reporting is a bounded sample and never feeds movement.
   */
  private solveScalable(input: CrowdMovementInput): void {
    input.index.rebuild(input.current.x, input.current.y, input.current.active);
    const maximumVelocityDelta = Math.max(0, input.maxAcceleration * input.fixedDelta);
    for (let agent = 0; agent < input.current.count; agent += 1) {
      if (input.current.active[agent] !== 1) {
        this.velocityX[agent] = 0;
        this.velocityY[agent] = 0;
        continue;
      }

      const population = input.index.populationAt(
        input.current.x[agent]!,
        input.current.y[agent]!,
      );
      const localNeighbors = Math.min(
        VERY_DENSE_MAX_NEIGHBORS,
        Math.max(0, population - 1),
      );
      input.density[agent] = localNeighbors / VERY_DENSE_MAX_NEIGHBORS;
      this.result.totalNeighbors += localNeighbors;
      this.result.maxNeighbors = Math.max(this.result.maxNeighbors, localNeighbors);

      let velocityX = input.current.vx[agent]!;
      let velocityY = input.current.vy[agent]!;
      let deltaX = input.desiredVelocityX[agent]! - velocityX;
      let deltaY = input.desiredVelocityY[agent]! - velocityY;
      const deltaLength = Math.hypot(deltaX, deltaY);
      if (deltaLength > maximumVelocityDelta && deltaLength > EPSILON) {
        const scale = maximumVelocityDelta / deltaLength;
        deltaX *= scale;
        deltaY *= scale;
      }
      velocityX += deltaX;
      velocityY += deltaY;
      const speed = Math.hypot(velocityX, velocityY);
      if (speed > input.maxSpeed && speed > EPSILON) {
        const scale = input.maxSpeed / speed;
        velocityX *= scale;
        velocityY *= scale;
      }
      this.velocityX[agent] = velocityX;
      this.velocityY[agent] = velocityY;
    }

    this.integrate(input);
    this.publishVelocities(input);
    this.countOverlaps(
      input,
      input.agentRadius * 2 - REPORTABLE_PENETRATION,
      SCALABLE_OVERLAP_QUERY_LIMIT,
    );
    this.finishRecoveryMetrics(input);
  }

  resetRecoveryState(): void {
    this.overloadRecoveryActive = false;
    this.overloadClearSteps = 0;
  }

  private reset(input: CrowdMovementInput): void {
    this.result.candidateChecks = 0;
    this.result.totalNeighbors = 0;
    this.result.maxNeighbors = 0;
    this.result.overlapPairs = 0;
    this.result.recoveredAgents = 0;
    this.result.maxRecoveryDistance = 0;
    input.recovery.fill(0, 0, input.current.count);
    input.overlapFlags.fill(0, 0, input.current.count);
    input.density.fill(0, 0, input.current.count);
    this.recoveryDistance.fill(0, 0, input.current.count);
  }

  private collectNeighbor(candidate: number): void {
    const input = this.input!;
    if (candidate === this.queryAgent || input.current.active[candidate] !== 1) return;
    const dx = input.current.x[candidate]! - input.current.x[this.queryAgent]!;
    const dy = input.current.y[candidate]! - input.current.y[this.queryAgent]!;
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared > this.queryRadiusSquared) return;
    const base = this.queryAgent * MAX_NEIGHBORS;
    let slot = Math.min(this.queryNeighborCount, this.neighborLimit - 1);
    if (
      this.queryNeighborCount === this.neighborLimit
      && distanceSquared >= this.neighborDistances[base + slot]!
    ) return;
    while (slot > 0 && distanceSquared < this.neighborDistances[base + slot - 1]!) {
      if (slot < MAX_NEIGHBORS) {
        this.neighborDistances[base + slot] = this.neighborDistances[base + slot - 1]!;
        this.neighborIndices[base + slot] = this.neighborIndices[base + slot - 1]!;
      }
      slot -= 1;
    }
    this.neighborDistances[base + slot] = distanceSquared;
    this.neighborIndices[base + slot] = candidate;
    this.queryNeighborCount = Math.min(this.neighborLimit, this.queryNeighborCount + 1);
  }

  private calculatePreferredVelocity(input: CrowdMovementInput, agent: number): void {
    const currentX = input.current.vx[agent]!;
    const currentY = input.current.vy[agent]!;
    let preferredX = input.desiredVelocityX[agent]!;
    let preferredY = input.desiredVelocityY[agent]!;
    const desiredSpeedSquared = preferredX * preferredX + preferredY * preferredY;
    const desiredSpeed = Math.sqrt(desiredSpeedSquared);
    const ownDirectionX = desiredSpeedSquared > EPSILON * EPSILON
      ? input.current.intentX[agent]!
      : 0;
    const ownDirectionY = desiredSpeedSquared > EPSILON * EPSILON
      ? input.current.intentY[agent]!
      : 0;
    let directionX = ownDirectionX;
    let directionY = ownDirectionY;
    let localDensity = 0;
    const count = this.neighborCounts[agent]!;
    const base = agent * MAX_NEIGHBORS;
    const localRadiusSquared = input.neighborRadius * input.neighborRadius;
    for (let offset = 0; offset < count; offset += 1) {
      if (this.neighborDistances[base + offset]! > localRadiusSquared) break;
      localDensity += 1;
      const other = this.neighborIndices[base + offset]!;
      const otherX = input.desiredVelocityX[other]!;
      const otherY = input.desiredVelocityY[other]!;
      if (
        desiredSpeedSquared <= EPSILON * EPSILON
        || otherX * otherX + otherY * otherY <= EPSILON * EPSILON
      ) continue;
      const otherDirectionX = input.current.intentX[other]!;
      const otherDirectionY = input.current.intentY[other]!;
      if (ownDirectionX * otherDirectionX + ownDirectionY * otherDirectionY < 0.5) continue;
      const weight = 1
        - Math.sqrt(this.neighborDistances[base + offset]!) / input.neighborRadius;
      directionX += otherDirectionX * weight;
      directionY += otherDirectionY * weight;
    }
    const directionLength = Math.hypot(directionX, directionY);
    if (directionLength > EPSILON) {
      directionX /= directionLength;
      directionY /= directionLength;
    }
    const densityRatio = localDensity / this.neighborLimit;
    const crowdSpeed = desiredSpeed * clamp(1 - densityRatio * 0.5, 0.5, 1);
    preferredX = directionX * crowdSpeed;
    preferredY = directionY * crowdSpeed;
    let desiredDeltaX = preferredX - currentX;
    let desiredDeltaY = preferredY - currentY;
    const accelerationRadius = Math.max(0, input.maxAcceleration) * input.fixedDelta;
    const desiredDeltaLength = Math.hypot(desiredDeltaX, desiredDeltaY);
    if (desiredDeltaLength > accelerationRadius && desiredDeltaLength > EPSILON) {
      desiredDeltaX *= accelerationRadius / desiredDeltaLength;
      desiredDeltaY *= accelerationRadius / desiredDeltaLength;
    }
    this.preferredX[agent] = currentX + desiredDeltaX;
    this.preferredY[agent] = currentY + desiredDeltaY;
    input.density[agent] = densityRatio;
  }

  private solveAgent(input: CrowdMovementInput, agent: number): void {
    this.lineCount = 0;
    this.addForwardConstraint(input, agent);
    const count = this.neighborCounts[agent]!;
    const base = agent * MAX_NEIGHBORS;
    for (let offset = 0; offset < count; offset += 1) {
      this.addReciprocalConstraint(input, agent, this.neighborIndices[base + offset]!);
    }
    this.linearProgram(input.maxSpeed, this.preferredX[agent]!, this.preferredY[agent]!);
    const currentX = input.current.vx[agent]!;
    const currentY = input.current.vy[agent]!;
    let deltaX = this.resultX - currentX;
    let deltaY = this.resultY - currentY;
    const maximumDelta = Math.max(0, input.maxAcceleration) * input.fixedDelta;
    const deltaLength = Math.hypot(deltaX, deltaY);
    if (deltaLength > maximumDelta && deltaLength > EPSILON) {
      deltaX *= maximumDelta / deltaLength;
      deltaY *= maximumDelta / deltaLength;
    }
    this.velocityX[agent] = currentX + deltaX;
    this.velocityY[agent] = currentY + deltaY;
  }

  private addForwardConstraint(input: CrowdMovementInput, agent: number): void {
    const intentX = input.current.intentX[agent]!;
    const intentY = input.current.intentY[agent]!;
    if (intentX * intentX + intentY * intentY <= EPSILON * EPSILON) return;
    const line = this.lineCount;
    this.linePointX[line] = 0;
    this.linePointY[line] = 0;
    this.lineDirectionX[line] = intentY;
    this.lineDirectionY[line] = -intentX;
    this.lineCount += 1;
  }

  private addReciprocalConstraint(
    input: CrowdMovementInput,
    agent: number,
    other: number,
  ): void {
    const positionX = input.current.x[other]! - input.current.x[agent]!;
    const positionY = input.current.y[other]! - input.current.y[agent]!;
    const distanceSquared = positionX * positionX + positionY * positionY;
    const physicalRadius = input.agentRadius * 2;
    const radius = physicalRadius + Math.max(0, input.agentGap) + ORCA_SAFETY_PADDING;
    const radiusSquared = radius * radius;
    const relativeVelocityX = input.current.vx[agent]! - input.current.vx[other]!;
    const relativeVelocityY = input.current.vy[agent]! - input.current.vy[other]!;
    let directionX = 0;
    let directionY = 0;
    let correctionX = 0;
    let correctionY = 0;

    if (distanceSquared > radiusSquared) {
      const inverseHorizon = 1 / Math.max(input.fixedDelta, input.avoidanceHorizon);
      const wX = relativeVelocityX - positionX * inverseHorizon;
      const wY = relativeVelocityY - positionY * inverseHorizon;
      const wSquared = wX * wX + wY * wY;
      const dot = wX * positionX + wY * positionY;
      if (dot < 0 && dot * dot > radiusSquared * wSquared) {
        const wLength = Math.sqrt(Math.max(wSquared, EPSILON));
        const unitX = wX / wLength;
        const unitY = wY / wLength;
        directionX = unitY;
        directionY = -unitX;
        const magnitude = radius * inverseHorizon - wLength;
        correctionX = unitX * magnitude;
        correctionY = unitY * magnitude;
      } else {
        const leg = Math.sqrt(Math.max(0, distanceSquared - radiusSquared));
        if (determinant(positionX, positionY, wX, wY) > 0) {
          directionX = (positionX * leg - positionY * radius) / distanceSquared;
          directionY = (positionX * radius + positionY * leg) / distanceSquared;
        } else {
          directionX = -(positionX * leg + positionY * radius) / distanceSquared;
          directionY = -(-positionX * radius + positionY * leg) / distanceSquared;
        }
        const projection = relativeVelocityX * directionX + relativeVelocityY * directionY;
        correctionX = directionX * projection - relativeVelocityX;
        correctionY = directionY * projection - relativeVelocityY;
      }
    } else {
      const inverseStep = 1 / Math.max(input.fixedDelta, EPSILON);
      const wX = relativeVelocityX - positionX * inverseStep;
      const wY = relativeVelocityY - positionY * inverseStep;
      const wLength = Math.hypot(wX, wY);
      let unitX: number;
      let unitY: number;
      if (wLength > EPSILON) {
        unitX = wX / wLength;
        unitY = wY / wLength;
      } else {
        this.pairNormal(agent, other);
        unitX = this.projection.normalX;
        unitY = this.projection.normalY;
      }
      directionX = unitY;
      directionY = -unitX;
      const magnitude = radius * inverseStep - wLength;
      correctionX = unitX * magnitude;
      correctionY = unitY * magnitude;
    }

    const line = this.lineCount;
    if (line >= MAX_LINES) return;
    this.linePointX[line] = input.current.vx[agent]! + correctionX * 0.5;
    this.linePointY[line] = input.current.vy[agent]! + correctionY * 0.5;
    this.lineDirectionX[line] = directionX;
    this.lineDirectionY[line] = directionY;
    this.lineCount += 1;
  }

  private linearProgram(radius: number, optimalX: number, optimalY: number): void {
    const optimalLength = Math.hypot(optimalX, optimalY);
    if (optimalLength > radius && optimalLength > EPSILON) {
      this.resultX = optimalX / optimalLength * radius;
      this.resultY = optimalY / optimalLength * radius;
    } else {
      this.resultX = optimalX;
      this.resultY = optimalY;
    }
    for (let line = 0; line < this.lineCount; line += 1) {
      if (this.lineViolation(line, this.resultX, this.resultY) <= EPSILON) continue;
      const previousX = this.resultX;
      const previousY = this.resultY;
      if (this.solveLine(line, radius, optimalX, optimalY)) continue;
      this.resultX = previousX;
      this.resultY = previousY;
      this.repairLinearProgram(line, radius);
      return;
    }
  }

  private repairLinearProgram(beginLine: number, radius: number): void {
    let violationDistance = 0;
    for (let line = beginLine; line < this.lineCount; line += 1) {
      const violation = this.lineViolation(line, this.resultX, this.resultY);
      if (violation <= violationDistance + EPSILON) continue;
      const protectedLines = Math.min(1, line);
      let projectedCount = protectedLines;
      for (let protectedLine = 0; protectedLine < protectedLines; protectedLine += 1) {
        this.projectedPointX[protectedLine] = this.linePointX[protectedLine]!;
        this.projectedPointY[protectedLine] = this.linePointY[protectedLine]!;
        this.projectedDirectionX[protectedLine] = this.lineDirectionX[protectedLine]!;
        this.projectedDirectionY[protectedLine] = this.lineDirectionY[protectedLine]!;
      }
      for (let prior = protectedLines; prior < line; prior += 1) {
        const denominator = determinant(
          this.lineDirectionX[line]!,
          this.lineDirectionY[line]!,
          this.lineDirectionX[prior]!,
          this.lineDirectionY[prior]!,
        );
        let pointX: number;
        let pointY: number;
        if (Math.abs(denominator) <= EPSILON) {
          const sameDirection = this.lineDirectionX[line]! * this.lineDirectionX[prior]!
            + this.lineDirectionY[line]! * this.lineDirectionY[prior]! > 0;
          if (sameDirection) continue;
          pointX = (this.linePointX[line]! + this.linePointX[prior]!) * 0.5;
          pointY = (this.linePointY[line]! + this.linePointY[prior]!) * 0.5;
        } else {
          const distance = determinant(
            this.lineDirectionX[prior]!,
            this.lineDirectionY[prior]!,
            this.linePointX[line]! - this.linePointX[prior]!,
            this.linePointY[line]! - this.linePointY[prior]!,
          ) / denominator;
          pointX = this.linePointX[line]! + distance * this.lineDirectionX[line]!;
          pointY = this.linePointY[line]! + distance * this.lineDirectionY[line]!;
        }
        let directionX = this.lineDirectionX[prior]! - this.lineDirectionX[line]!;
        let directionY = this.lineDirectionY[prior]! - this.lineDirectionY[line]!;
        const directionLength = Math.hypot(directionX, directionY);
        if (directionLength <= EPSILON) continue;
        directionX /= directionLength;
        directionY /= directionLength;
        this.projectedPointX[projectedCount] = pointX;
        this.projectedPointY[projectedCount] = pointY;
        this.projectedDirectionX[projectedCount] = directionX;
        this.projectedDirectionY[projectedCount] = directionY;
        projectedCount += 1;
      }
      const previousX = this.resultX;
      const previousY = this.resultY;
      if (!this.solveProjectedProgram(
        projectedCount,
        radius,
        -this.lineDirectionY[line]!,
        this.lineDirectionX[line]!,
      )) {
        this.resultX = previousX;
        this.resultY = previousY;
      }
      violationDistance = this.lineViolation(line, this.resultX, this.resultY);
    }
  }

  private solveProjectedProgram(
    count: number,
    radius: number,
    optimalX: number,
    optimalY: number,
  ): boolean {
    this.resultX = optimalX * radius;
    this.resultY = optimalY * radius;
    for (let line = 0; line < count; line += 1) {
      if (this.projectedViolation(line, this.resultX, this.resultY) <= EPSILON) continue;
      const previousX = this.resultX;
      const previousY = this.resultY;
      if (this.solveProjectedLine(line, radius, optimalX, optimalY)) continue;
      this.resultX = previousX;
      this.resultY = previousY;
      return false;
    }
    return true;
  }

  private solveProjectedLine(
    line: number,
    radius: number,
    optimalX: number,
    optimalY: number,
  ): boolean {
    const pointX = this.projectedPointX[line]!;
    const pointY = this.projectedPointY[line]!;
    const directionX = this.projectedDirectionX[line]!;
    const directionY = this.projectedDirectionY[line]!;
    const dot = pointX * directionX + pointY * directionY;
    const discriminant = dot * dot + radius * radius - pointX * pointX - pointY * pointY;
    if (discriminant < 0) return false;
    const root = Math.sqrt(discriminant);
    let left = -dot - root;
    let right = -dot + root;
    for (let prior = 0; prior < line; prior += 1) {
      const denominator = determinant(
        directionX,
        directionY,
        this.projectedDirectionX[prior]!,
        this.projectedDirectionY[prior]!,
      );
      const numerator = determinant(
        this.projectedDirectionX[prior]!,
        this.projectedDirectionY[prior]!,
        pointX - this.projectedPointX[prior]!,
        pointY - this.projectedPointY[prior]!,
      );
      if (Math.abs(denominator) <= EPSILON) {
        if (numerator < 0) return false;
        continue;
      }
      const distance = numerator / denominator;
      if (denominator >= 0) right = Math.min(right, distance);
      else left = Math.max(left, distance);
      if (left > right) return false;
    }
    const distance = optimalX * directionX + optimalY * directionY > 0 ? right : left;
    this.resultX = pointX + distance * directionX;
    this.resultY = pointY + distance * directionY;
    return true;
  }

  private projectedViolation(line: number, velocityX: number, velocityY: number): number {
    return determinant(
      this.projectedDirectionX[line]!,
      this.projectedDirectionY[line]!,
      this.projectedPointX[line]! - velocityX,
      this.projectedPointY[line]! - velocityY,
    );
  }

  private solveLine(line: number, radius: number, optimalX: number, optimalY: number): boolean {
    const pointX = this.linePointX[line]!;
    const pointY = this.linePointY[line]!;
    const directionX = this.lineDirectionX[line]!;
    const directionY = this.lineDirectionY[line]!;
    const dot = pointX * directionX + pointY * directionY;
    const discriminant = dot * dot + radius * radius - pointX * pointX - pointY * pointY;
    if (discriminant < 0) return false;
    const root = Math.sqrt(discriminant);
    let left = -dot - root;
    let right = -dot + root;
    for (let prior = 0; prior < line; prior += 1) {
      const denominator = determinant(
        directionX,
        directionY,
        this.lineDirectionX[prior]!,
        this.lineDirectionY[prior]!,
      );
      const numerator = determinant(
        this.lineDirectionX[prior]!,
        this.lineDirectionY[prior]!,
        pointX - this.linePointX[prior]!,
        pointY - this.linePointY[prior]!,
      );
      if (Math.abs(denominator) <= EPSILON) {
        if (numerator < 0) return false;
        continue;
      }
      const distance = numerator / denominator;
      if (denominator >= 0) right = Math.min(right, distance);
      else left = Math.max(left, distance);
      if (left > right) return false;
    }
    const projection = directionX * (optimalX - pointX) + directionY * (optimalY - pointY);
    const distance = clamp(projection, left, right);
    this.resultX = pointX + distance * directionX;
    this.resultY = pointY + distance * directionY;
    return true;
  }

  private lineViolation(line: number, velocityX: number, velocityY: number): number {
    return determinant(
      this.lineDirectionX[line]!,
      this.lineDirectionY[line]!,
      this.linePointX[line]! - velocityX,
      this.linePointY[line]! - velocityY,
    );
  }

  private integrate(input: CrowdMovementInput): void {
    input.next.copyFrom(input.current);
    for (let agent = 0; agent < input.current.count; agent += 1) {
      if (input.current.active[agent] !== 1) continue;
      const startX = input.current.x[agent]!;
      const startY = input.current.y[agent]!;
      const velocityX = this.velocityX[agent]!;
      const velocityY = this.velocityY[agent]!;
      const targetX = startX + velocityX * input.fixedDelta;
      const targetY = startY + velocityY * input.fixedDelta;
      if (this.canIntegrateDirectly(input, startX, startY, targetX, targetY)) {
        input.next.x[agent] = targetX;
        input.next.y[agent] = targetY;
        input.next.vx[agent] = velocityX;
        input.next.vy[agent] = velocityY;
        continue;
      }
      this.integrator.integrate(
        startX,
        startY,
        velocityX,
        velocityY,
        input.fixedDelta,
        input.wallClearance,
        input.worldWidth,
        input.worldHeight,
        input.obstacles,
        4,
        this.integration,
      );
      input.next.x[agent] = this.integration.x;
      input.next.y[agent] = this.integration.y;
      input.next.vx[agent] = this.integration.velocityX;
      input.next.vy[agent] = this.integration.velocityY;
      this.projectOutsideStatics(input, agent);
    }
  }

  private recoverInvalidPositions(input: CrowdMovementInput): void {
    const diameter = input.agentRadius * 2 - REPORTABLE_PENETRATION;
    const queryLimit = this.overloadRecoveryActive
      ? this.overloadQueryLimit
      : MAX_QUERY_VISITS;
    const iterationLimit = this.overloadRecoveryActive
      ? this.overloadIterationLimit
      : RECOVERY_ITERATIONS;
    for (let iteration = 0; iteration < iterationLimit; iteration += 1) {
      this.recoveryPairs = 0;
      input.index.rebuild(input.next.x, input.next.y, input.current.active);
      const overloadedCount = iteration === 0 ? this.disperseOverloadedCells(input) : 0;
      if (overloadedCount > 0) {
        this.overloadRecoveryActive = true;
        this.overloadClearSteps = 0;
        if (input.current.count <= DENSE_CROWD_THRESHOLD) {
          this.nudgeOverloadNeighborhood(input);
        }
        this.countOverlaps(input, diameter, this.overloadQueryLimit);
        return;
      }
      for (let agent = 0; agent < input.current.count; agent += 1) {
        if (input.current.active[agent] !== 1) continue;
        this.queryAgent = agent;
        const candidateCount = input.index.queryCandidates(
          input.next.x[agent]!,
          input.next.y[agent]!,
          diameter + 0.001,
          this.queryCandidates,
          queryLimit,
        );
        this.result.candidateChecks += candidateCount;
        for (let candidateIndex = 0; candidateIndex < candidateCount; candidateIndex += 1) {
          this.recoverPair(this.queryCandidates[candidateIndex]!);
        }
      }
      if (
        !this.overloadRecoveryActive
        && input.current.count > DENSE_CROWD_THRESHOLD
        && this.recoveryPairs > 0
      ) {
        // Large RTS crowds are allowed to overlap. Once routine movement needs
        // positional repair, never spend the rest of the frame chasing a fully
        // separated state; continue that work under the persistent budget.
        this.overloadRecoveryActive = true;
        this.overloadClearSteps = 0;
        this.finishOverloadRecoveryStep(input, diameter);
        return;
      }
      if (this.recoveryPairs === 0) {
        if (this.overloadRecoveryActive) {
          this.finishOverloadRecoveryStep(input, diameter);
          return;
        }
        // The recovery pass uses a slightly larger diameter than reporting.
        // If it found nothing, a second full-crowd overlap scan cannot find a
        // reportable pair either.
        this.result.overlapPairs = 0;
        return;
      }
      for (let agent = 0; agent < input.current.count; agent += 1) {
        if (input.current.active[agent] !== 1) continue;
        this.projectOutsideStatics(input, agent);
      }
    }
    if (this.overloadRecoveryActive) {
      this.finishOverloadRecoveryStep(input, diameter);
    } else {
      this.countOverlaps(input, diameter, MAX_QUERY_VISITS);
    }
  }

  private finishOverloadRecoveryStep(input: CrowdMovementInput, diameter: number): void {
    this.countOverlaps(input, diameter, this.overloadQueryLimit);
    if (this.result.overlapPairs > 0) {
      this.overloadClearSteps = 0;
      return;
    }
    this.overloadClearSteps += 1;
    if (this.overloadClearSteps < OVERLOAD_CLEAR_STEPS) return;
    this.overloadRecoveryActive = false;
    this.overloadClearSteps = 0;
  }

  private disperseOverloadedCells(input: CrowdMovementInput): number {
    const overloadedPopulation = this.overloadedPopulationThreshold();
    const maximumPush = input.agentRadius * 2 + 0.001;
    let count = 0;
    for (let agent = 0; agent < input.current.count; agent += 1) {
      if (input.current.active[agent] !== 1) continue;
      const population = input.index.populationAt(input.next.x[agent]!, input.next.y[agent]!);
      if (population < overloadedPopulation) continue;
      const pressure = Math.min(4, Math.sqrt(population / overloadedPopulation));
      const push = maximumPush * this.recoveryPushScale[agent]! * pressure;
      input.next.x[agent] = input.next.x[agent]! + this.recoveryDirectionX[agent]! * push;
      input.next.y[agent] = input.next.y[agent]! + this.recoveryDirectionY[agent]! * push;
      input.recovery[agent] = 1;
      this.recoveryDistance[agent] = this.recoveryDistance[agent]! + push;
      this.projectOutsideStatics(input, agent);
      count += 1;
    }
    return count;
  }

  private nudgeOverloadNeighborhood(input: CrowdMovementInput): void {
    const overloadedPopulation = this.overloadedPopulationThreshold();
    const nudge = REPORTABLE_PENETRATION * 0.1;
    for (let agent = 0; agent < input.current.count; agent += 1) {
      if (
        input.current.active[agent] !== 1
        || input.recovery[agent] === 1
        || input.index.maximumPopulationNear(input.next.x[agent]!, input.next.y[agent]!)
          < overloadedPopulation
      ) continue;
      input.next.x[agent] = input.next.x[agent]! + this.recoveryDirectionX[agent]! * nudge;
      input.next.y[agent] = input.next.y[agent]! + this.recoveryDirectionY[agent]! * nudge;
      input.recovery[agent] = 1;
      this.recoveryDistance[agent] = this.recoveryDistance[agent]! + nudge;
      this.projectOutsideStatics(input, agent);
    }
  }

  /** Conservative broad phase: false positives use the exact rounded sweep. */
  private canIntegrateDirectly(
    input: CrowdMovementInput,
    startX: number,
    startY: number,
    targetX: number,
    targetY: number,
  ): boolean {
    if (
      !Number.isFinite(startX)
      || !Number.isFinite(startY)
      || !Number.isFinite(targetX)
      || !Number.isFinite(targetY)
    ) return false;
    const clearance = input.wallClearance;
    if (
      startX < clearance
      || startY < clearance
      || targetX < clearance
      || targetY < clearance
      || startX > input.worldWidth - clearance
      || startY > input.worldHeight - clearance
      || targetX > input.worldWidth - clearance
      || targetY > input.worldHeight - clearance
    ) return false;

    const minimumX = Math.min(startX, targetX) - clearance;
    const maximumX = Math.max(startX, targetX) + clearance;
    const minimumY = Math.min(startY, targetY) - clearance;
    const maximumY = Math.max(startY, targetY) + clearance;
    for (const obstacle of input.obstacles) {
      if (
        maximumX < obstacle.x
        || minimumX > obstacle.x + obstacle.width
        || maximumY < obstacle.y
        || minimumY > obstacle.y + obstacle.height
      ) continue;
      return false;
    }
    return true;
  }

  private overloadedPopulationThreshold(): number {
    return Math.max(MINIMUM_OVERLOADED_CELL_POPULATION, this.overloadQueryLimit);
  }

  private recoverPair(candidate: number): void {
    const input = this.input!;
    const agent = this.queryAgent;
    if (candidate <= agent || input.current.active[candidate] !== 1) return;
    let dx = input.next.x[candidate]! - input.next.x[agent]!;
    let dy = input.next.y[candidate]! - input.next.y[agent]!;
    const diameter = input.agentRadius * 2;
    const squared = dx * dx + dy * dy;
    if (squared >= diameter * diameter - EPSILON) return;
    const actualDistance = Math.sqrt(Math.max(0, squared));
    let normalDistance = actualDistance;
    if (normalDistance <= EPSILON) {
      this.pairNormal(agent, candidate);
      dx = this.projection.normalX;
      dy = this.projection.normalY;
      normalDistance = 1;
    }
    const push = (diameter - actualDistance + 0.001) * 0.5;
    const normalX = dx / normalDistance;
    const normalY = dy / normalDistance;
    input.next.x[agent] = input.next.x[agent]! - normalX * push;
    input.next.y[agent] = input.next.y[agent]! - normalY * push;
    input.next.x[candidate] = input.next.x[candidate]! + normalX * push;
    input.next.y[candidate] = input.next.y[candidate]! + normalY * push;
    input.recovery[agent] = 1;
    input.recovery[candidate] = 1;
    this.recoveryDistance[agent] = this.recoveryDistance[agent]! + push;
    this.recoveryDistance[candidate] = this.recoveryDistance[candidate]! + push;
    this.recoveryPairs += 1;
  }

  private countOverlaps(
    input: CrowdMovementInput,
    diameter: number,
    queryLimit: number,
  ): void {
    input.overlapFlags.fill(0, 0, input.current.count);
    this.countPairs = 0;
    input.index.rebuild(input.next.x, input.next.y, input.current.active);
    for (let agent = 0; agent < input.current.count; agent += 1) {
      if (input.current.active[agent] !== 1) continue;
      this.queryAgent = agent;
      const candidateCount = input.index.queryCandidates(
        input.next.x[agent]!,
        input.next.y[agent]!,
        diameter + 0.001,
        this.queryCandidates,
        queryLimit,
      );
      this.result.candidateChecks += candidateCount;
      for (let candidateIndex = 0; candidateIndex < candidateCount; candidateIndex += 1) {
        this.countPair(this.queryCandidates[candidateIndex]!);
      }
    }
    this.result.overlapPairs = this.countPairs;
  }

  private countPair(candidate: number): void {
    const input = this.input!;
    const agent = this.queryAgent;
    if (candidate <= agent || input.current.active[candidate] !== 1) return;
    const dx = input.next.x[candidate]! - input.next.x[agent]!;
    const dy = input.next.y[candidate]! - input.next.y[agent]!;
    const diameter = input.agentRadius * 2 - REPORTABLE_PENETRATION;
    if (dx * dx + dy * dy >= diameter * diameter - EPSILON) return;
    input.overlapFlags[agent] = 1;
    input.overlapFlags[candidate] = 1;
    this.countPairs += 1;
  }

  private publishVelocities(input: CrowdMovementInput): void {
    for (let agent = 0; agent < input.current.count; agent += 1) {
      if (input.current.active[agent] !== 1) {
        input.next.vx[agent] = 0;
        input.next.vy[agent] = 0;
        input.solvedVelocityX[agent] = 0;
        input.solvedVelocityY[agent] = 0;
        continue;
      }
      let velocityX = (input.next.x[agent]! - input.current.x[agent]!) / input.fixedDelta;
      let velocityY = (input.next.y[agent]! - input.current.y[agent]!) / input.fixedDelta;
      const speed = Math.hypot(velocityX, velocityY);
      if (speed > input.maxSpeed && speed > EPSILON) {
        velocityX *= input.maxSpeed / speed;
        velocityY *= input.maxSpeed / speed;
      }
      input.next.vx[agent] = velocityX;
      input.next.vy[agent] = velocityY;
      input.solvedVelocityX[agent] = velocityX;
      input.solvedVelocityY[agent] = velocityY;
    }
  }

  private finishRecoveryMetrics(input: CrowdMovementInput): void {
    for (let agent = 0; agent < input.current.count; agent += 1) {
      if (input.current.active[agent] !== 1 || input.recovery[agent] !== 1) continue;
      this.result.recoveredAgents += 1;
      this.result.maxRecoveryDistance = Math.max(
        this.result.maxRecoveryDistance,
        this.recoveryDistance[agent]!,
      );
    }
  }

  private projectOutsideStatics(input: CrowdMovementInput, agent: number): void {
    let x = clamp(input.next.x[agent]!, input.wallClearance, input.worldWidth - input.wallClearance);
    let y = clamp(input.next.y[agent]!, input.wallClearance, input.worldHeight - input.wallClearance);
    for (const obstacle of input.obstacles) {
      if (!projectCircleOutsideRectWithinBounds(
        x,
        y,
        input.wallClearance,
        obstacle,
        input.worldWidth,
        input.worldHeight,
        this.projection,
      )) continue;
      x = this.projection.x;
      y = this.projection.y;
    }
    const movement = Math.hypot(x - input.next.x[agent]!, y - input.next.y[agent]!);
    if (movement <= EPSILON) return;
    input.recovery[agent] = 1;
    this.recoveryDistance[agent] = this.recoveryDistance[agent]! + movement;
    input.next.x[agent] = x;
    input.next.y[agent] = y;
  }

  private pairNormal(first: number, second: number): void {
    const hash = Math.imul(first + 1, 0x9e3779b1) ^ Math.imul(second + 1, 0x85ebca77);
    const angle = ((hash >>> 0) / 0x1_0000_0000) * Math.PI * 2;
    this.projection.normalX = Math.cos(angle);
    this.projection.normalY = Math.sin(angle);
  }

  private ensureCapacity(count: number): void {
    if (this.velocityX.length >= count) return;
    this.velocityX = new Float64Array(count);
    this.velocityY = new Float64Array(count);
    this.preferredX = new Float64Array(count);
    this.preferredY = new Float64Array(count);
    this.recoveryDistance = new Float64Array(count);
    this.neighborIndices = new Int32Array(count * MAX_NEIGHBORS);
    this.neighborDistances = new Float64Array(count * MAX_NEIGHBORS);
    this.neighborCounts = new Uint8Array(count);
    this.recoveryDirectionX = new Float64Array(count);
    this.recoveryDirectionY = new Float64Array(count);
    this.recoveryPushScale = new Float64Array(count);
    for (let agent = 0; agent < count; agent += 1) {
      const angle = agent * GOLDEN_ANGLE;
      const radialHash = (Math.imul(agent + 1, 0x9e3779b1) >>> 0) / 0x1_0000_0000;
      this.recoveryDirectionX[agent] = Math.cos(angle);
      this.recoveryDirectionY[agent] = Math.sin(angle);
      this.recoveryPushScale[agent] = 0.35 + Math.sqrt(radialHash) * 0.65;
    }
  }
}

function determinant(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}
