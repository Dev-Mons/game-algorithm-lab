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
const REPORTABLE_PENETRATION = 0.01;
const CONTACT_QUERY_PADDING = 0.001;
export const MAX_CONTACTS_PER_AGENT = 16;
const SMALL_CROWD_LIMIT = 1_000;
// Keep the 4,990/5,000/5,010 acceptance window on one quality tier. This is
// only a bounded-work setting; every tier executes the same contact equation.
const MEDIUM_CROWD_LIMIT = 4_000;
const SMALL_MAX_CONTACTS = 16;
const MEDIUM_MAX_CONTACTS = 12;
const LARGE_MAX_CONTACTS = 8;
const SMALL_CONSTRAINT_ITERATIONS = 3;
const MEDIUM_CONSTRAINT_ITERATIONS = 2;
const LARGE_CONSTRAINT_ITERATIONS = 1;
const SMALL_QUERY_LIMIT = 96;
const MEDIUM_QUERY_LIMIT = 32;
const LARGE_QUERY_LIMIT = 8;
const MAX_CONTACT_QUERY_VISITS = SMALL_QUERY_LIMIT;

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
  agentGap: number;
  maxSpeed: number;
  maxAcceleration: number;
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
 * Population tiers change only the fixed contact/query/iteration budgets.
 * Jacobi corrections are accumulated in reusable SoA buffers and published
 * simultaneously before the existing swept static collision path runs.
 */
export class CrowdMovementSolver {
  private velocityX = new Float64Array(0);
  private velocityY = new Float64Array(0);
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
  private iterationCorrected = new Uint8Array(0);
  private readonly queryCandidates = new Int32Array(MAX_CONTACT_QUERY_VISITS);
  private maxContacts = LARGE_MAX_CONTACTS;
  private constraintIterationLimit = LARGE_CONSTRAINT_ITERATIONS;
  private queryLimit = LARGE_QUERY_LIMIT;
  private complianceScale = 1;
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
    const count = input.current.count;
    this.ensureCapacity(count);
    this.configureQualityTier(count);
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

  private configureQualityTier(population: number): void {
    if (population <= SMALL_CROWD_LIMIT) {
      this.maxContacts = SMALL_MAX_CONTACTS;
      this.constraintIterationLimit = SMALL_CONSTRAINT_ITERATIONS;
      this.queryLimit = SMALL_QUERY_LIMIT;
      this.complianceScale = 0.05;
      return;
    }
    if (population <= MEDIUM_CROWD_LIMIT) {
      this.maxContacts = MEDIUM_MAX_CONTACTS;
      this.constraintIterationLimit = MEDIUM_CONSTRAINT_ITERATIONS;
      this.queryLimit = MEDIUM_QUERY_LIMIT;
      this.complianceScale = 0.5;
      return;
    }
    this.maxContacts = LARGE_MAX_CONTACTS;
    this.constraintIterationLimit = LARGE_CONSTRAINT_ITERATIONS;
    this.queryLimit = LARGE_QUERY_LIMIT;
    this.complianceScale = 1;
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
    this.contactLambda.fill(0, 0, count * MAX_CONTACTS_PER_AGENT);
  }

  private predictPositions(input: CrowdMovementInput): void {
    const maximumVelocityDelta = Math.max(0, input.maxAcceleration) * input.fixedDelta;
    for (let agent = 0; agent < input.current.count; agent += 1) {
      const startX = input.current.x[agent]!;
      const startY = input.current.y[agent]!;
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
        predictedX = Number.isFinite(startX) ? startX : input.wallClearance;
        predictedY = Number.isFinite(startY) ? startY : input.wallClearance;
      }
      this.velocityX[agent] = velocityX;
      this.velocityY[agent] = velocityY;
      this.predictedX[agent] = predictedX;
      this.predictedY[agent] = predictedY;
    }
  }

  private buildContactConstraints(input: CrowdMovementInput): void {
    const contactDistance = input.agentRadius * 2 + Math.max(0, input.agentGap);
    const queryRadius = contactDistance + CONTACT_QUERY_PADDING;
    const queryRadiusSquared = queryRadius * queryRadius;
    for (let agent = 0; agent < input.current.count; agent += 1) {
      if (input.current.active[agent] !== 1) continue;
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
        if (distanceSquared > queryRadiusSquared) continue;
        this.insertNearestContact(agent, other, distanceSquared);
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
    if (this.result.contactChecks === 0 || this.constraintIterationLimit === 0) return;
    const count = input.current.count;
    const diameter = input.agentRadius * 2 + Math.max(0, input.agentGap);
    const inverseDeltaSquared = 1 / Math.max(EPSILON, input.fixedDelta * input.fixedDelta);
    const alpha = Math.max(0, input.contactCompliance)
      * this.complianceScale
      * inverseDeltaSquared;
    const friction = clamp(input.contactFriction, 0, 1);
    const correctionLimit = Math.max(0, input.maximumContactCorrection);
    const lambdaLimit = Math.max(diameter, correctionLimit * 2);

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
          // left to CrowdField viscosity.
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
        const normalization = 1 / Math.max(1, Math.sqrt(weight) * 0.25);
        let correctionX = this.correctionX[agent]! * normalization;
        let correctionY = this.correctionY[agent]! * normalization;
        let correctionLength = Math.hypot(correctionX, correctionY);
        if (!Number.isFinite(correctionLength)) continue;
        if (correctionLength > correctionLimit && correctionLength > EPSILON) {
          const scale = correctionLimit / correctionLength;
          correctionX *= scale;
          correctionY *= scale;
          correctionLength = correctionLimit;
        }
        if (correctionLength <= EPSILON) continue;
        this.predictedX[agent] = this.predictedX[agent]! + correctionX;
        this.predictedY[agent] = this.predictedY[agent]! + correctionY;
        this.contactCorrected[agent] = 1;
        this.iterationCorrected[agent] = 1;
        this.result.maxContactCorrection = Math.max(
          this.result.maxContactCorrection,
          correctionLength,
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
      if (this.canIntegrateDirectly(input, startX, startY, targetX, targetY)) {
        input.next.x[agent] = targetX;
        input.next.y[agent] = targetY;
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
      this.projectNextOutsideStatics(input, agent);
    }
  }

  private projectNextOutsideStatics(input: CrowdMovementInput, agent: number): void {
    const originalX = input.next.x[agent]!;
    const originalY = input.next.y[agent]!;
    const projected = this.projectOutsideStatics(input, originalX, originalY);
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
  ): boolean {
    let x = clamp(inputX, input.wallClearance, input.worldWidth - input.wallClearance);
    let y = clamp(inputY, input.wallClearance, input.worldHeight - input.wallClearance);
    for (const obstacle of input.obstacles) {
      if (
        x <= obstacle.x - input.wallClearance
        || x >= obstacle.x + obstacle.width + input.wallClearance
        || y <= obstacle.y - input.wallClearance
        || y >= obstacle.y + obstacle.height + input.wallClearance
      ) continue;
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
    if (Math.abs(x - inputX) <= EPSILON && Math.abs(y - inputY) <= EPSILON) return false;
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

  private countBoundedOverlaps(input: CrowdMovementInput): void {
    const reportableDiameter = input.agentRadius * 2 - REPORTABLE_PENETRATION;
    const reportableDiameterSquared = reportableDiameter * reportableDiameter;
    let overlaps = 0;
    for (let agent = 0; agent < input.current.count; agent += 1) {
      if (input.current.active[agent] !== 1) continue;
      const base = agent * MAX_CONTACTS_PER_AGENT;
      const count = this.contactCount[agent]!;
      for (let contact = 0; contact < count; contact += 1) {
        const other = this.contactNeighborIndices[base + contact]!;
        if (input.current.active[other] !== 1) continue;
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

  private ensureCapacity(count: number): void {
    if (this.velocityX.length >= count) return;
    this.velocityX = new Float64Array(count);
    this.velocityY = new Float64Array(count);
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
    this.iterationCorrected = new Uint8Array(count);
  }
}
