import type { SpatialHash } from '../algorithms/spatial-hash/spatial-hash';
import type { AgentBuffer } from './agent-state';
import { angleDelta, clamp } from './math';
import {
  distanceSquaredToRect,
  projectCircleOutsideRectWithinBounds,
  SweptCircleStaticIntegrator,
  type CircleProjection,
  type SweptCircleSlideOutput,
} from './obstacle-collision';
import type { Rect } from './types';
import { StaticObstacleIndex } from './static-obstacle-index';

const EPSILON = 1e-9;
const REPORTABLE_PENETRATION = 0.01;
const CONTACT_QUERY_PADDING = 0.001;
export const MAX_CONTACTS_PER_AGENT = 8;
export const CONTACT_ITERATIONS = 8;
export const MAX_CONTACT_QUERY_VISITS = 24;

export interface CrowdMovementInput {
  current: AgentBuffer;
  next: AgentBuffer;
  index: SpatialHash;
  desiredVelocityX: Float64Array;
  desiredVelocityY: Float64Array;
  solvedVelocityX: Float64Array;
  solvedVelocityY: Float64Array;
  recovery: Uint8Array;
  overlapFlags: Uint8Array;
  agentRadius: number;
  agentRadii?: Float64Array;
  maxAgentRadius?: number;
  agentGap: number;
  maxSpeed: number;
  maxAcceleration: number;
  turnSpeed: number;
  fixedDelta: number;
  contactCompliance: number;
  contactFriction: number;
  maximumContactCorrection: number;
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
  contactChecks: number;
  contactConstraints: number;
  constraintIterations: number;
  maxContacts: number;
  contactCorrectedAgents: number;
  maxContactCorrection: number;
  staticProjectionCorrections: number;
}

/**
 * The sole dynamic movement authority.
 *
 * Every population uses the same predicted-position XPBD circle constraint.
 * Contact/query/iteration budgets are identical at every population.
 * Jacobi corrections are accumulated in reusable SoA buffers and published
 * simultaneously before the existing swept static collision path runs.
 */
export class CrowdMovementSolver {
  constructor(private readonly obstacleIndex = new StaticObstacleIndex()) {}
  private readonly sweepObstacles: Rect[] = [];
  private velocityX = new Float64Array(0);
  private velocityY = new Float64Array(0);
  private headings = new Float64Array(0);
  private predictedX = new Float64Array(0);
  private predictedY = new Float64Array(0);
  private correctionX = new Float64Array(0);
  private correctionY = new Float64Array(0);
  private correctionWeight = new Float64Array(0);
  private recoveryDistance = new Float64Array(0);
  private contactNeighborIndices = new Int32Array(0);
  private contactDistances = new Float64Array(0);
  private contactLambda = new Float64Array(0);
  private contactCount = new Uint8Array(0);
  private contactCorrected = new Uint8Array(0);
  private contactCorrectionLength = new Float64Array(0);
  private iterationCorrected = new Uint8Array(0);
  private readonly queryCandidates = new Int32Array(MAX_CONTACT_QUERY_VISITS);
  private readonly maxContacts = MAX_CONTACTS_PER_AGENT;
  private readonly constraintIterationLimit = CONTACT_ITERATIONS;
  private readonly queryLimit = MAX_CONTACT_QUERY_VISITS;
  private pairNormalX = 1;
  private pairNormalY = 0;
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
  private readonly projection: CircleProjection = {
    x: 0,
    y: 0,
    normalX: 0,
    normalY: 0,
  };
  private readonly result: CrowdMovementResult = {
    candidateChecks: 0,
    totalNeighbors: 0,
    maxNeighbors: 0,
    overlapPairs: 0,
    recoveredAgents: 0,
    maxRecoveryDistance: 0,
    contactChecks: 0,
    contactConstraints: 0,
    constraintIterations: 0,
    maxContacts: 0,
    contactCorrectedAgents: 0,
    maxContactCorrection: 0,
    staticProjectionCorrections: 0,
  };

  solve(input: CrowdMovementInput): CrowdMovementResult {
    this.obstacleIndex.update(input.obstacles);
    const count = input.current.count;
    this.ensureCapacity(count);
    this.reset(input);
    this.predictPositions(input);

    // The index is the contact-only grid owned by CrowdSimulation. It is
    // rebuilt from predicted positions, never from partially corrected ones.
    input.index.rebuild(this.predictedX, this.predictedY, input.current.active);
    this.buildContactConstraints(input);
    this.solveContactConstraints(input);
    this.integratePredictions(input);
    this.countBoundedOverlaps(input);
    this.publishVelocities(input);
    this.finishStaticProjectionMetrics(input);
    return this.result;
  }

  /** Kept as a stable lifecycle hook; this solver has no cross-step recovery mode. */
  resetRecoveryState(): void {
    // XPBD lambdas deliberately live for one fixed step only.
  }

  private reset(input: CrowdMovementInput): void {
    const count = input.current.count;
    this.result.candidateChecks = 0;
    this.result.totalNeighbors = 0;
    this.result.maxNeighbors = 0;
    this.result.overlapPairs = 0;
    this.result.recoveredAgents = 0;
    this.result.maxRecoveryDistance = 0;
    this.result.contactChecks = 0;
    this.result.contactConstraints = 0;
    this.result.constraintIterations = this.constraintIterationLimit;
    this.result.maxContacts = this.maxContacts;
    this.result.contactCorrectedAgents = 0;
    this.result.maxContactCorrection = 0;
    this.result.staticProjectionCorrections = 0;
    input.recovery.fill(0, 0, count);
    input.overlapFlags.fill(0, 0, count);
    this.recoveryDistance.fill(0, 0, count);
    this.contactCount.fill(0, 0, count);
    this.contactCorrected.fill(0, 0, count);
    this.contactCorrectionLength.fill(0, 0, count);
    this.contactLambda.fill(0, 0, count * MAX_CONTACTS_PER_AGENT);
  }

  private predictPositions(input: CrowdMovementInput): void {
    const maximumVelocityDelta = Math.max(0, input.maxAcceleration) * input.fixedDelta;
    const maximumTurn = Math.max(0, input.turnSpeed) * Math.PI / 180 * input.fixedDelta;
    for (let agent = 0; agent < input.current.count; agent += 1) {
      const startX = input.current.x[agent]!;
      const startY = input.current.y[agent]!;
      this.headings[agent] = input.current.heading[agent]!;
      if (input.current.active[agent] !== 1) {
        this.velocityX[agent] = 0;
        this.velocityY[agent] = 0;
        this.predictedX[agent] = startX;
        this.predictedY[agent] = startY;
        continue;
      }

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
      // Limit the movement vector AFTER grid pressure and acceleration so those
      // passes cannot overwrite the turn rate. A stopped agent can turn in place.
      const moving = Math.hypot(velocityX, velocityY) > EPSILON;
      const targetX = moving ? velocityX : input.current.intentX[agent]!;
      const targetY = moving ? velocityY : input.current.intentY[agent]!;
      if (targetX * targetX + targetY * targetY > EPSILON) {
        const previous = input.current.heading[agent]!;
        const delta = angleDelta(previous, Math.atan2(targetY, targetX));
        const turnLimit = Math.abs(delta) > maximumTurn
          && this.isNearStaticObstacle(input, startX, startY, Math.max(48, input.maxSpeed * input.fixedDelta * 12))
          ? Math.PI * 2
          : maximumTurn;
        const heading = angleDelta(0, previous + clamp(delta, -turnLimit, turnLimit));
        this.headings[agent] = heading;
        if (Math.abs(delta) > turnLimit) {
          const forwardX = Math.cos(heading), forwardY = Math.sin(heading);
          // Orthogonal projection avoids injecting speed while restricting turn.
          const forwardSpeed = Math.max(0, velocityX * forwardX + velocityY * forwardY);
          velocityX = forwardX * forwardSpeed;
          velocityY = forwardY * forwardSpeed;
        }
      }
      let predictedX = startX + velocityX * input.fixedDelta;
      let predictedY = startY + velocityY * input.fixedDelta;
      if (
        !Number.isFinite(velocityX)
        || !Number.isFinite(velocityY)
        || !Number.isFinite(predictedX)
        || !Number.isFinite(predictedY)
      ) {
        velocityX = 0;
        velocityY = 0;
        predictedX = Number.isFinite(startX) ? startX : this.wallClearance(input, agent);
        predictedY = Number.isFinite(startY) ? startY : this.wallClearance(input, agent);
      }
      this.velocityX[agent] = velocityX;
      this.velocityY[agent] = velocityY;
      this.predictedX[agent] = predictedX;
      this.predictedY[agent] = predictedY;
    }
  }

  private isNearStaticObstacle(input: CrowdMovementInput, x: number, y: number, distance: number): boolean {
    if (input.obstacles.length === 0) return false;
    const threshold = Math.max(12, distance);
    const thresholdSquared = threshold * threshold;
    for (const index of this.obstacleIndex.query(x - threshold, y - threshold, x + threshold, y + threshold)) {
      const obstacle = input.obstacles[index]!;
      if (distanceSquaredToRect(x, y, obstacle) <= thresholdSquared) return true;
    }
    return false;
  }

  private buildContactConstraints(input: CrowdMovementInput): void {
    for (let agent = 0; agent < input.current.count; agent += 1) {
      if (input.current.active[agent] !== 1) continue;
      const radius = this.radius(input, agent);
      // Retain near contacts that another Jacobi correction can close later
      // in this step, without rebuilding the index or increasing its query cap.
      const padding = Math.max(0, input.maximumContactCorrection) * 2 + CONTACT_QUERY_PADDING;
      const queryRadius = radius + (input.maxAgentRadius ?? input.agentRadius)
        + Math.max(0, input.agentGap) + padding;
      const candidateCount = input.index.queryCandidates(
        this.predictedX[agent]!,
        this.predictedY[agent]!,
        queryRadius,
        this.queryCandidates,
        this.queryLimit,
      );
      this.result.candidateChecks += candidateCount;
      for (let candidateIndex = 0; candidateIndex < candidateCount; candidateIndex += 1) {
        const other = this.queryCandidates[candidateIndex]!;
        // Store every physical pair at most once. The lower index owns it,
        // while both endpoints receive the symmetric Jacobi correction.
        if (other <= agent || input.current.active[other] !== 1) continue;
        const dx = this.predictedX[other]! - this.predictedX[agent]!;
        const dy = this.predictedY[other]! - this.predictedY[agent]!;
        const distanceSquared = dx * dx + dy * dy;
        const contactDistance = radius + this.radius(input, other) + Math.max(0, input.agentGap);
        if (distanceSquared > (contactDistance + padding) ** 2) continue;
        // Surface distance makes a touching large body compete fairly with
        // nearby small centers under the same fixed contact budget.
        this.insertNearestContact(agent, other, distanceSquared / (contactDistance * contactDistance));
      }
      const count = this.contactCount[agent]!;
      this.result.contactChecks += count;
      this.result.totalNeighbors += count;
      this.result.maxNeighbors = Math.max(this.result.maxNeighbors, count);
    }
  }

  private insertNearestContact(agent: number, other: number, distanceSquared: number): void {
    const base = agent * MAX_CONTACTS_PER_AGENT;
    const count = this.contactCount[agent]!;
    let slot = Math.min(count, this.maxContacts - 1);
    if (count === this.maxContacts) {
      const lastDistance = this.contactDistances[base + slot]!;
      const lastIndex = this.contactNeighborIndices[base + slot]!;
      if (
        distanceSquared > lastDistance
        || (distanceSquared === lastDistance && other >= lastIndex)
      ) return;
    }
    while (slot > 0) {
      const priorDistance = this.contactDistances[base + slot - 1]!;
      const priorIndex = this.contactNeighborIndices[base + slot - 1]!;
      if (
        distanceSquared > priorDistance
        || (distanceSquared === priorDistance && other >= priorIndex)
      ) break;
      this.contactDistances[base + slot] = priorDistance;
      this.contactNeighborIndices[base + slot] = priorIndex;
      slot -= 1;
    }
    this.contactDistances[base + slot] = distanceSquared;
    this.contactNeighborIndices[base + slot] = other;
    this.contactCount[agent] = Math.min(this.maxContacts, count + 1);
  }

  private solveContactConstraints(input: CrowdMovementInput): void {
    if (this.result.contactChecks === 0) return;
    const count = input.current.count;
    const inverseDeltaSquared = 1 / Math.max(EPSILON, input.fixedDelta * input.fixedDelta);
    const alpha = Math.max(0, input.contactCompliance)
      * inverseDeltaSquared;
    const friction = clamp(input.contactFriction, 0, 1);
    const correctionLimit = Math.max(0, input.maximumContactCorrection);

    for (let iteration = 0; iteration < this.constraintIterationLimit; iteration += 1) {
      this.correctionX.fill(0, 0, count);
      this.correctionY.fill(0, 0, count);
      this.correctionWeight.fill(0, 0, count);
      this.iterationCorrected.fill(0, 0, count);

      for (let agent = 0; agent < count; agent += 1) {
        if (input.current.active[agent] !== 1) continue;
        const base = agent * MAX_CONTACTS_PER_AGENT;
        const contactCount = this.contactCount[agent]!;
        for (let contact = 0; contact < contactCount; contact += 1) {
          this.result.contactConstraints += 1;
          const lambdaIndex = base + contact;
          const other = this.contactNeighborIndices[lambdaIndex]!;
          if (input.current.active[other] !== 1) continue;
          const diameter = this.radius(input, agent) + this.radius(input, other) + Math.max(0, input.agentGap);
          const lambdaLimit = Math.max(diameter, correctionLimit * 2);
          const dx = this.predictedX[other]! - this.predictedX[agent]!;
          const dy = this.predictedY[other]! - this.predictedY[agent]!;
          const distanceSquared = dx * dx + dy * dy;
          const distance = Math.sqrt(Math.max(0, distanceSquared));
          const constraint = distance - diameter;
          if (constraint >= 0) continue;

          let normalX: number;
          let normalY: number;
          if (distance > EPSILON) {
            normalX = dx / distance;
            normalY = dy / distance;
          } else {
            this.setPairNormal(agent, other);
            normalX = this.pairNormalX;
            normalY = this.pairNormalY;
          }

          const previousLambda = this.contactLambda[lambdaIndex]!;
          let deltaLambda = (-constraint - alpha * previousLambda) / (2 + alpha);
          const nextLambda = Math.max(0, previousLambda + deltaLambda);
          deltaLambda = clamp(nextLambda - previousLambda, -lambdaLimit, lambdaLimit);
          if (Math.abs(deltaLambda) <= EPSILON || !Number.isFinite(deltaLambda)) continue;
          this.contactLambda[lambdaIndex] = previousLambda + deltaLambda;

          const normalCorrectionX = normalX * deltaLambda;
          const normalCorrectionY = normalY * deltaLambda;
          this.correctionX[agent] = this.correctionX[agent]! - normalCorrectionX;
          this.correctionY[agent] = this.correctionY[agent]! - normalCorrectionY;
          this.correctionX[other] = this.correctionX[other]! + normalCorrectionX;
          this.correctionY[other] = this.correctionY[other]! + normalCorrectionY;
          this.correctionWeight[agent] = this.correctionWeight[agent]! + 1;
          this.correctionWeight[other] = this.correctionWeight[other]! + 1;

          // Contact friction acts only on an active penetrating pair and is
          // Coulomb-bounded by the normal correction. Same-flow alignment is
          // left to directional grid momentum transport.
          if (friction > 0 && deltaLambda > 0) {
            const tangentX = -normalY;
            const tangentY = normalX;
            const relativeDisplacementX = (
              this.predictedX[other]! - input.current.x[other]!
            ) - (
              this.predictedX[agent]! - input.current.x[agent]!
            );
            const relativeDisplacementY = (
              this.predictedY[other]! - input.current.y[other]!
            ) - (
              this.predictedY[agent]! - input.current.y[agent]!
            );
            const relativeTangent = relativeDisplacementX * tangentX
              + relativeDisplacementY * tangentY;
            const progressPreservingLimit = Math.min(
              deltaLambda * friction,
              input.maxSpeed * input.fixedDelta * 0.05,
            );
            const tangentCorrection = clamp(
              relativeTangent * friction * 0.5,
              -progressPreservingLimit,
              progressPreservingLimit,
            );
            this.correctionX[agent] = this.correctionX[agent]!
              + tangentX * tangentCorrection;
            this.correctionY[agent] = this.correctionY[agent]!
              + tangentY * tangentCorrection;
            this.correctionX[other] = this.correctionX[other]!
              - tangentX * tangentCorrection;
            this.correctionY[other] = this.correctionY[other]!
              - tangentY * tangentCorrection;
          }
        }
      }

      for (let agent = 0; agent < count; agent += 1) {
        const weight = this.correctionWeight[agent]!;
        if (input.current.active[agent] !== 1 || weight <= 0) continue;
        // Normalize dense contact sums (two directions in 2D). Applying every
        // pair's full correction at once injects outward velocity and opens seams.
        const normalization = 1 / Math.max(1, weight * .5);
        let correctionX = this.correctionX[agent]! * normalization;
        let correctionY = this.correctionY[agent]! * normalization;
        let correctionLength = Math.hypot(correctionX, correctionY);
        if (!Number.isFinite(correctionLength)) continue;
        const remainingCorrection = Math.max(0, correctionLimit - this.contactCorrectionLength[agent]!);
        if (correctionLength > remainingCorrection && correctionLength > EPSILON) {
          const scale = remainingCorrection / correctionLength;
          correctionX *= scale;
          correctionY *= scale;
          correctionLength = remainingCorrection;
        }
        if (correctionLength <= EPSILON) continue;
        this.predictedX[agent] = this.predictedX[agent]! + correctionX;
        this.predictedY[agent] = this.predictedY[agent]! + correctionY;
        this.contactCorrected[agent] = 1;
        this.contactCorrectionLength[agent] = this.contactCorrectionLength[agent]! + correctionLength;
        this.iterationCorrected[agent] = 1;
        this.result.maxContactCorrection = Math.max(
          this.result.maxContactCorrection,
          this.contactCorrectionLength[agent]!,
        );
      }

      // A simultaneous contact publish is immediately made statically valid;
      // the final current-to-predicted sweep below still prevents tunnelling.
      this.projectPredictionsOutsideStatics(input);
    }
  }

  private projectPredictionsOutsideStatics(input: CrowdMovementInput): void {
    for (let agent = 0; agent < input.current.count; agent += 1) {
      if (input.current.active[agent] !== 1 || this.iterationCorrected[agent] !== 1) continue;
      const originalX = this.predictedX[agent]!;
      const originalY = this.predictedY[agent]!;
      const projected = this.projectOutsideStatics(
        input,
        originalX,
        originalY,
        this.wallClearance(input, agent),
      );
      if (!projected) continue;
      const movement = Math.hypot(
        this.projection.x - originalX,
        this.projection.y - originalY,
      );
      this.predictedX[agent] = this.projection.x;
      this.predictedY[agent] = this.projection.y;
      this.recordStaticProjection(input, agent, movement);
    }
  }

  private integratePredictions(input: CrowdMovementInput): void {
    input.next.copyFrom(input.current);
    input.next.heading.set(this.headings.subarray(0, input.current.count));
    const inverseDelta = 1 / Math.max(EPSILON, input.fixedDelta);
    for (let agent = 0; agent < input.current.count; agent += 1) {
      if (input.current.active[agent] !== 1) continue;
      const startX = input.current.x[agent]!;
      const startY = input.current.y[agent]!;
      let targetX = this.predictedX[agent]!;
      let targetY = this.predictedY[agent]!;
      if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) {
        targetX = startX;
        targetY = startY;
      }
      const velocityX = (targetX - startX) * inverseDelta;
      const velocityY = (targetY - startY) * inverseDelta;
      const clearance = this.wallClearance(input, agent);
      if (this.canIntegrateDirectly(input, startX, startY, targetX, targetY, clearance)) {
        input.next.x[agent] = targetX;
        input.next.y[agent] = targetY;
        continue;
      }
      // Sliding never increases speed: the whole swept path stays within this
      // travel-radius square, including turns after the first contact.
      const travel = Math.hypot(targetX - startX, targetY - startY) + clearance + 1e-6;
      this.sweepObstacles.length = 0;
      for (const index of this.obstacleIndex.query(startX - travel, startY - travel, startX + travel, startY + travel)) {
        this.sweepObstacles.push(input.obstacles[index]!);
      }
      this.integrator.integrate(
        startX,
        startY,
        velocityX,
        velocityY,
        input.fixedDelta,
        clearance,
        input.worldWidth,
        input.worldHeight,
        this.sweepObstacles,
        4,
        this.integration,
      );
      input.next.x[agent] = this.integration.x;
      input.next.y[agent] = this.integration.y;
      this.projectNextOutsideStatics(input, agent);
    }
  }

  private projectNextOutsideStatics(input: CrowdMovementInput, agent: number): void {
    const originalX = input.next.x[agent]!;
    const originalY = input.next.y[agent]!;
    const projected = this.projectOutsideStatics(input, originalX, originalY, this.wallClearance(input, agent));
    if (!projected) return;
    const movement = Math.hypot(
      this.projection.x - originalX,
      this.projection.y - originalY,
    );
    input.next.x[agent] = this.projection.x;
    input.next.y[agent] = this.projection.y;
    this.recordStaticProjection(input, agent, movement);
  }

  private projectOutsideStatics(
    input: CrowdMovementInput,
    inputX: number,
    inputY: number,
    clearance: number,
  ): boolean {
    let x = clamp(inputX, clearance, input.worldWidth - clearance);
    let y = clamp(inputY, clearance, input.worldHeight - clearance);
    let candidates = this.obstacleIndex.query(x - clearance, y - clearance, x + clearance, y + clearance);
    let cursor = 0;
    while (cursor < candidates.length) {
      const index = candidates[cursor++]!;
      const obstacle = input.obstacles[index]!;
      if (
        x <= obstacle.x - clearance
        || x >= obstacle.x + obstacle.width + clearance
        || y <= obstacle.y - clearance
        || y >= obstacle.y + obstacle.height + clearance
      ) continue;
      if (!projectCircleOutsideRectWithinBounds(
        x,
        y,
        clearance,
        obstacle,
        input.worldWidth,
        input.worldHeight,
        this.projection,
      )) continue;
      x = this.projection.x;
      y = this.projection.y;
      // A repair can enter another obstacle's bounds. Re-query at the repaired
      // position, retaining the original one-pass obstacle order exactly.
      candidates = this.obstacleIndex.query(x - clearance, y - clearance, x + clearance, y + clearance);
      cursor = 0;
      while (cursor < candidates.length && candidates[cursor]! <= index) cursor++;
    }
    // Publish even sub-EPSILON repairs: the navigation and sweep checks use
    // squared-distance tolerances and can reject this tiny penetration. Dropping
    // the repaired position would leave the body unable to move or recover.
    // recordStaticProjection still filters insignificant diagnostic events.
    if (x === inputX && y === inputY) return false;
    this.projection.x = x;
    this.projection.y = y;
    return true;
  }

  private recordStaticProjection(
    input: CrowdMovementInput,
    agent: number,
    distance: number,
  ): void {
    if (!(distance > EPSILON) || !Number.isFinite(distance)) return;
    input.recovery[agent] = 1;
    this.recoveryDistance[agent] = this.recoveryDistance[agent]! + distance;
    this.result.staticProjectionCorrections += 1;
  }

  /** Conservative broad phase: false positives use the exact rounded sweep. */
  private canIntegrateDirectly(
    input: CrowdMovementInput,
    startX: number,
    startY: number,
    targetX: number,
    targetY: number,
    clearance: number,
  ): boolean {
    if (
      !Number.isFinite(startX)
      || !Number.isFinite(startY)
      || !Number.isFinite(targetX)
      || !Number.isFinite(targetY)
    ) return false;
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
    for (const index of this.obstacleIndex.query(minimumX, minimumY, maximumX, maximumY)) {
      const obstacle = input.obstacles[index]!;
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

  private countBoundedOverlaps(input: CrowdMovementInput): void {
    let overlaps = 0;
    for (let agent = 0; agent < input.current.count; agent += 1) {
      if (input.current.active[agent] !== 1) continue;
      const base = agent * MAX_CONTACTS_PER_AGENT;
      const count = this.contactCount[agent]!;
      for (let contact = 0; contact < count; contact += 1) {
        const other = this.contactNeighborIndices[base + contact]!;
        if (input.current.active[other] !== 1) continue;
        const reportableDiameterSquared = (this.radius(input, agent) + this.radius(input, other)
          - REPORTABLE_PENETRATION) ** 2;
        const dx = input.next.x[other]! - input.next.x[agent]!;
        const dy = input.next.y[other]! - input.next.y[agent]!;
        if (dx * dx + dy * dy >= reportableDiameterSquared - EPSILON) continue;
        input.overlapFlags[agent] = 1;
        input.overlapFlags[other] = 1;
        overlaps += 1;
      }
    }
    this.result.overlapPairs = overlaps;
  }

  private publishVelocities(input: CrowdMovementInput): void {
    const inverseDelta = 1 / Math.max(EPSILON, input.fixedDelta);
    for (let agent = 0; agent < input.current.count; agent += 1) {
      if (input.current.active[agent] !== 1) {
        input.next.vx[agent] = 0;
        input.next.vy[agent] = 0;
        input.solvedVelocityX[agent] = 0;
        input.solvedVelocityY[agent] = 0;
        continue;
      }
      let velocityX = (input.next.x[agent]! - input.current.x[agent]!) * inverseDelta;
      let velocityY = (input.next.y[agent]! - input.current.y[agent]!) * inverseDelta;
      const speed = Math.hypot(velocityX, velocityY);
      if (speed > input.maxSpeed && speed > EPSILON) {
        const scale = input.maxSpeed / speed;
        velocityX *= scale;
        velocityY *= scale;
      }
      if (!Number.isFinite(velocityX) || !Number.isFinite(velocityY)) {
        velocityX = 0;
        velocityY = 0;
      }
      input.next.vx[agent] = velocityX;
      input.next.vy[agent] = velocityY;
      input.solvedVelocityX[agent] = velocityX;
      input.solvedVelocityY[agent] = velocityY;
    }
  }

  private finishStaticProjectionMetrics(input: CrowdMovementInput): void {
    for (let agent = 0; agent < input.current.count; agent += 1) {
      if (input.current.active[agent] !== 1) continue;
      if (this.contactCorrected[agent] === 1) {
        this.result.contactCorrectedAgents += 1;
      }
      if (input.recovery[agent] !== 1) continue;
      this.result.recoveredAgents += 1;
      this.result.maxRecoveryDistance = Math.max(
        this.result.maxRecoveryDistance,
        this.recoveryDistance[agent]!,
      );
    }
  }

  private setPairNormal(first: number, second: number): void {
    const lower = Math.min(first, second);
    const upper = Math.max(first, second);
    const hash = Math.imul(lower + 1, 0x9e3779b1)
      ^ Math.imul(upper + 1, 0x85ebca77);
    const angle = ((hash >>> 0) / 0x1_0000_0000) * Math.PI * 2;
    const orientation = first === lower ? 1 : -1;
    this.pairNormalX = Math.cos(angle) * orientation;
    this.pairNormalY = Math.sin(angle) * orientation;
  }

  private radius(input: CrowdMovementInput, agent: number): number {
    return input.agentRadii?.[agent] ?? input.agentRadius;
  }

  private wallClearance(input: CrowdMovementInput, agent: number): number {
    return input.wallClearance + (this.radius(input, agent) - input.agentRadius);
  }

  private ensureCapacity(count: number): void {
    if (this.velocityX.length >= count) return;
    this.velocityX = new Float64Array(count);
    this.velocityY = new Float64Array(count);
    this.headings = new Float64Array(count);
    this.predictedX = new Float64Array(count);
    this.predictedY = new Float64Array(count);
    this.correctionX = new Float64Array(count);
    this.correctionY = new Float64Array(count);
    this.correctionWeight = new Float64Array(count);
    this.recoveryDistance = new Float64Array(count);
    this.contactNeighborIndices = new Int32Array(count * MAX_CONTACTS_PER_AGENT);
    this.contactDistances = new Float64Array(count * MAX_CONTACTS_PER_AGENT);
    this.contactLambda = new Float64Array(count * MAX_CONTACTS_PER_AGENT);
    this.contactCount = new Uint8Array(count);
    this.contactCorrected = new Uint8Array(count);
    this.contactCorrectionLength = new Float64Array(count);
    this.iterationCorrected = new Uint8Array(count);
  }
}
