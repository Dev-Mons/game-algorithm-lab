import { EPSILON, clamp } from '../../core/math';
import { distanceSquaredToRect, segmentDistanceSquaredToRect } from '../../core/obstacle-collision';
import type { Rect } from '../../core/types';

const PI = Math.PI;
const TWO_PI = Math.PI * 2;
const HALF_PI = Math.PI * 0.5;
const MAX_FORWARD_ANGLE = HALF_PI - 1e-3;
const GAP_PADDING = Math.PI / 360;
const COINCIDENT_BLOCK_HALF_ANGLE = Math.PI / 30;
const INITIAL_INTERVAL_CAPACITY = 8192;
const CONTACT_EPSILON = 1e-4;

/** Radians per second. The acceleration cap normally limits the visible turn further. */
export const DEFAULT_MAX_TURN_RATE = Math.PI * 2;

export interface LocalMovementInput {
  agentIndex: number;
  positionX: number;
  positionY: number;
  velocityX: number;
  velocityY: number;
  preferredX: number;
  preferredY: number;
  distanceToGoal: number;
  maxSpeed: number;
  maxAcceleration: number;
  fixedDelta: number;
  arrivalSlowRadius: number;
  agentRadius: number;
  agentGap: number;
  wallMargin: number;
  avoidanceHorizon: number;
  avoidanceBiasSeconds: number;
  avoidanceSide: number;
  avoidanceHold: number;
  neighborCount: number;
  neighborIndices: Int32Array;
  neighborX: Float64Array;
  neighborY: Float64Array;
  neighborVelocityX: Float64Array;
  neighborVelocityY: Float64Array;
  /** Immutable Phase-A intent snapshot. Falls back to neighborVelocityX/Y for compatibility. */
  neighborIntentVelocityX?: Float64Array;
  /** Immutable Phase-A intent snapshot. Falls back to neighborVelocityX/Y for compatibility. */
  neighborIntentVelocityY?: Float64Array;
  /** This agent's velocity from the same immutable intent snapshot. */
  selfIntentVelocityX?: number;
  /** This agent's velocity from the same immutable intent snapshot. */
  selfIntentVelocityY?: number;
  /** Maximum heading change in radians per second. */
  maxTurnRate?: number;
  obstacles: readonly Rect[];
  worldWidth: number;
  worldHeight: number;
  obstacleLookAhead: number;
}

export interface LocalSteeringIntent {
  directionX: number;
  directionY: number;
  avoidanceSide: number;
  avoidanceHold: number;
  /** True when the preferred heading was covered by a dynamic or static angular interval. */
  blocked: boolean;
  /** Geometric ray clearance in world units along directionX/Y. */
  forwardClearance: number;
}

export interface LocalMovementOutput {
  x: number;
  y: number;
  avoidanceSide: number;
  avoidanceHold: number;
  /** True only when a next-step non-penetration constraint needs an abrupt correction. */
  emergencyStop?: boolean;
}

/** Deterministic, allocation-free (after reserve) two-phase local steering. */
export class LocalMovementSolver {
  private intervalStarts = new Float64Array(INITIAL_INTERVAL_CAPACITY);
  private intervalEnds = new Float64Array(INITIAL_INTERVAL_CAPACITY);
  private intervalCount = 0;
  private mergedIntervalCount = 0;
  private nearestBlockingNeighbor = -1;
  private nearestBlockingDistanceSquared = Number.POSITIVE_INFINITY;
  private coincidentSideBalance = 0;
  private projectedVelocityX = 0;
  private projectedVelocityY = 0;
  private projectionEmergency = false;
  private normalX = 0;
  private normalY = 0;
  private readonly compatibilityIntent: LocalSteeringIntent = {
    directionX: 0,
    directionY: 0,
    avoidanceSide: 1,
    avoidanceHold: 0,
    blocked: false,
    forwardClearance: Number.POSITIVE_INFINITY,
  };

  /** Optional setup-time reservation for simulations larger than the default 1,000 agents. */
  reserveIntervalCapacity(maximumNeighborCount: number, maximumObstacleCount: number): void {
    this.ensureIntervalCapacity(Math.max(16, maximumNeighborCount * 6 + maximumObstacleCount * 10 + 16));
  }

  /** Compatibility wrapper. New code should snapshot intents and invoke both phases explicitly. */
  solve(input: LocalMovementInput, out: LocalMovementOutput): void {
    this.planIntent(input, this.compatibilityIntent);
    this.resolveVelocity(input, this.compatibilityIntent, out);
  }

  /** Phase A: build and merge blocked angular intervals, then choose the nearest free gap. */
  planIntent(input: LocalMovementInput, out: LocalSteeringIntent): void {
    const preferredLength = Math.hypot(input.preferredX, input.preferredY);
    if (preferredLength <= EPSILON) {
      out.directionX = 0;
      out.directionY = 0;
      out.avoidanceSide = input.avoidanceSide || this.stableFallbackSide(input.agentIndex, -1);
      out.avoidanceHold = Math.max(0, input.avoidanceHold - input.fixedDelta);
      out.blocked = false;
      out.forwardClearance = 0;
      return;
    }

    const preferredX = input.preferredX / preferredLength;
    const preferredY = input.preferredY / preferredLength;
    const horizon = Math.max(input.fixedDelta, input.avoidanceHorizon);
    const desiredSpeed = this.desiredSpeed(input);
    const selfIntentX = input.selfIntentVelocityX ?? preferredX * desiredSpeed;
    const selfIntentY = input.selfIntentVelocityY ?? preferredY * desiredSpeed;
    const neighborIntentX = input.neighborIntentVelocityX ?? input.neighborVelocityX;
    const neighborIntentY = input.neighborIntentVelocityY ?? input.neighborVelocityY;
    const dynamicRadius = input.agentRadius * 2 + Math.max(0, input.agentGap);
    this.ensureIntervalCapacity(input.neighborCount * 6 + input.obstacles.length * 10 + 16);
    this.intervalCount = 0;
    this.mergedIntervalCount = 0;
    this.nearestBlockingNeighbor = -1;
    this.nearestBlockingDistanceSquared = Number.POSITIVE_INFINITY;
    this.coincidentSideBalance = 0;

    for (let offset = 0; offset < input.neighborCount; offset += 1) {
      const neighbor = input.neighborIndices[offset]!;
      const relativeX = input.neighborX[neighbor]! - input.positionX;
      const relativeY = input.neighborY[neighbor]! - input.positionY;
      const distanceSquared = relativeX * relativeX + relativeY * relativeY;
      const neighborVelocityX = neighborIntentX[neighbor]!;
      const neighborVelocityY = neighborIntentY[neighbor]!;
      if (distanceSquared <= 1e-12) {
        this.coincidentSideBalance += neighbor > input.agentIndex ? -1 : 1;
        this.addAngularInterval(-COINCIDENT_BLOCK_HALF_ANGLE, COINCIDENT_BLOCK_HALF_ANGLE);
        this.rememberBlockingNeighbor(input.agentIndex, neighbor, 0);
        continue;
      }

      const collisionTime = this.timeToCollision(
        relativeX,
        relativeY,
        neighborVelocityX - selfIntentX,
        neighborVelocityY - selfIntentY,
        dynamicRadius,
      );
      if (collisionTime > horizon) continue;
      this.addDiscInterval(relativeX, relativeY, dynamicRadius, preferredX, preferredY);
      this.addDiscInterval(
        relativeX + neighborVelocityX * horizon * 0.5,
        relativeY + neighborVelocityY * horizon * 0.5,
        dynamicRadius,
        preferredX,
        preferredY,
      );
      this.addDiscInterval(
        relativeX + neighborVelocityX * horizon,
        relativeY + neighborVelocityY * horizon,
        dynamicRadius,
        preferredX,
        preferredY,
      );
      this.rememberBlockingNeighbor(input.agentIndex, neighbor, distanceSquared);
    }

    const staticClearance = input.agentRadius + input.wallMargin;
    const lookAheadDistance = Math.max(
      staticClearance,
      input.maxSpeed * Math.max(input.obstacleLookAhead, input.fixedDelta),
    );
    for (let obstacleIndex = 0; obstacleIndex < input.obstacles.length; obstacleIndex += 1) {
      this.addObstacleInterval(
        input,
        input.obstacles[obstacleIndex]!,
        staticClearance,
        lookAheadDistance,
        preferredX,
        preferredY,
      );
    }
    this.addWorldBoundaryIntervals(input, staticClearance, lookAheadDistance, preferredX, preferredY);
    this.sortAndMergeIntervals();

    const forwardBlocked = this.isAngleBlocked(0);
    let chosenAngle = 0;
    let chosenSide = 0;
    if (forwardBlocked) {
      const preferredSide = this.preferredTieSide(input);
      let bestAbsoluteAngle = Number.POSITIVE_INFINITY;
      let bestScore = Number.POSITIVE_INFINITY;
      let heldSideAngle = Number.NaN;
      let heldSideAbsoluteAngle = Number.POSITIVE_INFINITY;
      let cursor = -MAX_FORWARD_ANGLE;
      for (let interval = 0; interval < this.mergedIntervalCount; interval += 1) {
        const blockedStart = this.intervalStarts[interval]!;
        if (blockedStart > cursor) {
          const candidate = this.closestAngleInGap(cursor, blockedStart);
          if (Number.isFinite(candidate)) {
            const candidateSide = candidate < 0 ? -1 : 1;
            const absoluteAngle = Math.abs(candidate);
            const score = this.gapScore(input, candidateSide, absoluteAngle);
            if (candidateSide === preferredSide && absoluteAngle < heldSideAbsoluteAngle) {
              heldSideAngle = candidate;
              heldSideAbsoluteAngle = absoluteAngle;
            }
            if (
              score < bestScore - 1e-10
              || (Math.abs(score - bestScore) <= 1e-10 && absoluteAngle < bestAbsoluteAngle - 1e-10)
              || (
                Math.abs(score - bestScore) <= 1e-10
                && Math.abs(absoluteAngle - bestAbsoluteAngle) <= 1e-10
                && candidateSide === preferredSide
              )
            ) {
              bestScore = score;
              bestAbsoluteAngle = absoluteAngle;
              chosenAngle = candidate;
              chosenSide = candidateSide;
            }
          }
        }
        cursor = Math.max(cursor, this.intervalEnds[interval]!);
      }
      if (cursor < MAX_FORWARD_ANGLE) {
        const candidate = this.closestAngleInGap(cursor, MAX_FORWARD_ANGLE);
        if (Number.isFinite(candidate)) {
          const candidateSide = candidate < 0 ? -1 : 1;
          const absoluteAngle = Math.abs(candidate);
          const score = this.gapScore(input, candidateSide, absoluteAngle);
          if (candidateSide === preferredSide && absoluteAngle < heldSideAbsoluteAngle) {
            heldSideAngle = candidate;
            heldSideAbsoluteAngle = absoluteAngle;
          }
          if (
            score < bestScore - 1e-10
            || (Math.abs(score - bestScore) <= 1e-10 && absoluteAngle < bestAbsoluteAngle - 1e-10)
            || (
              Math.abs(score - bestScore) <= 1e-10
              && Math.abs(absoluteAngle - bestAbsoluteAngle) <= 1e-10
              && candidateSide === preferredSide
            )
          ) {
            bestScore = score;
            bestAbsoluteAngle = absoluteAngle;
            chosenAngle = candidate;
            chosenSide = candidateSide;
          }
        }
      }
      // No wide-enough gap: retain preferred and let Phase B brake continuously.
      if (!Number.isFinite(bestAbsoluteAngle)) {
        chosenAngle = 0;
        chosenSide = 0;
      } else if (
        input.avoidanceHold > 0
        && input.avoidanceSide !== 0
        && chosenSide !== preferredSide
      ) {
        if (Number.isFinite(heldSideAngle)) {
          chosenAngle = heldSideAngle;
          chosenSide = preferredSide;
        } else {
          // The committed side has no traversable opening. Brake along the
          // preferred path until the hold expires instead of frame-flipping.
          chosenAngle = 0;
          chosenSide = 0;
        }
      }
    }

    if (chosenAngle === 0) {
      out.directionX = preferredX;
      out.directionY = preferredY;
    } else {
      const cosine = Math.cos(chosenAngle);
      const sine = Math.sin(chosenAngle);
      out.directionX = preferredX * cosine - preferredY * sine;
      out.directionY = preferredX * sine + preferredY * cosine;
    }
    out.avoidanceSide = chosenSide === 0
      ? input.avoidanceSide || this.preferredTieSide(input)
      : chosenSide;
    out.avoidanceHold = chosenSide === 0
      ? Math.max(0, input.avoidanceHold - input.fixedDelta)
      : input.avoidanceBiasSeconds;
    out.blocked = forwardBlocked;
    out.forwardClearance = this.geometricClearance(input, out.directionX, out.directionY);
  }

  /** Phase B: turn the intent into a continuous safe speed, then enforce next-step contact only. */
  resolveVelocity(input: LocalMovementInput, intent: LocalSteeringIntent, out: LocalMovementOutput): void {
    this.projectionEmergency = false;
    const preferredLength = Math.hypot(input.preferredX, input.preferredY);
    if (preferredLength <= EPSILON || (intent.directionX === 0 && intent.directionY === 0)) {
      out.x = 0;
      out.y = 0;
      out.avoidanceSide = intent.avoidanceSide;
      out.avoidanceHold = intent.avoidanceHold;
      out.emergencyStop = false;
      return;
    }

    const preferredX = input.preferredX / preferredLength;
    const preferredY = input.preferredY / preferredLength;
    const desiredDirectionLength = Math.hypot(intent.directionX, intent.directionY);
    const intentX = intent.directionX / Math.max(desiredDirectionLength, EPSILON);
    const intentY = intent.directionY / Math.max(desiredDirectionLength, EPSILON);
    let directionX = intentX;
    let directionY = intentY;
    const currentSpeed = Math.hypot(input.velocityX, input.velocityY);
    if (currentSpeed > EPSILON) {
      const currentDirectionX = input.velocityX / currentSpeed;
      const currentDirectionY = input.velocityY / currentSpeed;
      const turn = Math.atan2(
        currentDirectionX * intentY - currentDirectionY * intentX,
        clamp(currentDirectionX * intentX + currentDirectionY * intentY, -1, 1),
      );
      const maximumTurn = Math.max(0, input.maxTurnRate ?? DEFAULT_MAX_TURN_RATE) * input.fixedDelta;
      const limitedTurn = clamp(turn, -maximumTurn, maximumTurn);
      const cosine = Math.cos(limitedTurn);
      const sine = Math.sin(limitedTurn);
      directionX = currentDirectionX * cosine - currentDirectionY * sine;
      directionY = currentDirectionX * sine + currentDirectionY * cosine;
    }

    const horizon = Math.max(input.fixedDelta, input.avoidanceHorizon);
    let safeSpeed = this.desiredSpeed(input);
    safeSpeed = Math.min(
      safeSpeed,
      this.staticSafeSpeed(input, directionX, directionY, horizon),
      this.dynamicSafeSpeed(input, directionX, directionY, safeSpeed, horizon),
    );
    safeSpeed = clamp(safeSpeed, 0, input.maxSpeed);

    const targetX = directionX * safeSpeed;
    const targetY = directionY * safeSpeed;
    const maximumDelta = Math.max(0, input.maxAcceleration) * input.fixedDelta;
    const deltaX = targetX - input.velocityX;
    const deltaY = targetY - input.velocityY;
    const deltaLength = Math.hypot(deltaX, deltaY);
    const deltaScale = deltaLength > maximumDelta && deltaLength > EPSILON
      ? maximumDelta / deltaLength
      : 1;
    let velocityX = input.velocityX + deltaX * deltaScale;
    let velocityY = input.velocityY + deltaY * deltaScale;
    this.projectAccelerationHemisphere(
      input.velocityX,
      input.velocityY,
      preferredX,
      preferredY,
      maximumDelta,
      velocityX,
      velocityY,
    );
    velocityX = this.projectedVelocityX;
    velocityY = this.projectedVelocityY;

    // Only a physical next-step circle contact is a hard constraint. agentGap is
    // already represented by angular planning and continuous braking cost; making
    // that comfort gap a hard endpoint plane creates needless high-frequency
    // corrections in a dense but still non-penetrating formation.
    const hardRadius = input.agentRadius * 2 + CONTACT_EPSILON;
    const hardRadiusSquared = hardRadius * hardRadius;
    const neighborIntentX = input.neighborIntentVelocityX ?? input.neighborVelocityX;
    const neighborIntentY = input.neighborIntentVelocityY ?? input.neighborVelocityY;

    for (let pass = 0; pass < 2; pass += 1) {
      for (let offset = 0; offset < input.neighborCount; offset += 1) {
        const neighbor = input.neighborIndices[offset]!;
        const neighborVelocityX = neighborIntentX[neighbor]!;
        const neighborVelocityY = neighborIntentY[neighbor]!;
        const currentOffsetX = input.positionX - input.neighborX[neighbor]!;
        const currentOffsetY = input.positionY - input.neighborY[neighbor]!;
        const currentSquared = currentOffsetX * currentOffsetX + currentOffsetY * currentOffsetY;
        const nextOffsetX = currentOffsetX + (velocityX - neighborVelocityX) * input.fixedDelta;
        const nextOffsetY = currentOffsetY + (velocityY - neighborVelocityY) * input.fixedDelta;
        const nextSquared = nextOffsetX * nextOffsetX + nextOffsetY * nextOffsetY;
        if (nextSquared >= hardRadiusSquared - 1e-10) continue;
        if (currentSquared < hardRadiusSquared - 1e-10 && nextSquared > currentSquared + 1e-10) continue;

        let normalX: number;
        let normalY: number;
        if (nextSquared > 1e-12) {
          const inverseDistance = 1 / Math.sqrt(nextSquared);
          normalX = nextOffsetX * inverseDistance;
          normalY = nextOffsetY * inverseDistance;
        } else if (currentSquared > 1e-12) {
          const inverseDistance = 1 / Math.sqrt(currentSquared);
          normalX = currentOffsetX * inverseDistance;
          normalY = currentOffsetY * inverseDistance;
        } else {
          const separationSide = neighbor > input.agentIndex ? -1 : 1;
          normalX = -preferredY * separationSide;
          normalY = preferredX * separationSide;
        }
        // Enforce the endpoint contact plane, not merely a zero inward speed.
        // For the chosen endpoint normal n the exact linear constraint is
        //   (vSelf - vOther)·n >= (R - currentOffset·n) / dt.
        // Project inside the acceleration disk so a contact correction is not
        // immediately invalidated by a later generic acceleration re-clamp.
        const requiredRelativeSpeed = (
          hardRadius - (currentOffsetX * normalX + currentOffsetY * normalY)
        ) / input.fixedDelta;
        const relativeNormalSpeed = (velocityX - neighborVelocityX) * normalX
          + (velocityY - neighborVelocityY) * normalY;
        if (relativeNormalSpeed < requiredRelativeSpeed - EPSILON) {
          const requiredSelfNormal = requiredRelativeSpeed
            + neighborVelocityX * normalX
            + neighborVelocityY * normalY;
          const centerNormal = input.velocityX * normalX + input.velocityY * normalY;
          const normalFromCenter = requiredSelfNormal - centerNormal;
          const feasibleNormal = clamp(normalFromCenter, -maximumDelta, maximumDelta);
          const relativeCandidateX = velocityX - input.velocityX;
          const relativeCandidateY = velocityY - input.velocityY;
          const candidateTangentX = relativeCandidateX - normalX * (
            relativeCandidateX * normalX + relativeCandidateY * normalY
          );
          const candidateTangentY = relativeCandidateY - normalY * (
            relativeCandidateX * normalX + relativeCandidateY * normalY
          );
          const tangentLength = Math.hypot(candidateTangentX, candidateTangentY);
          const tangentBudget = Math.sqrt(Math.max(
            0,
            maximumDelta * maximumDelta - feasibleNormal * feasibleNormal,
          ));
          const tangentScale = tangentLength > tangentBudget && tangentLength > EPSILON
            ? tangentBudget / tangentLength
            : 1;
          velocityX = input.velocityX
            + normalX * feasibleNormal
            + candidateTangentX * tangentScale;
          velocityY = input.velocityY
            + normalY * feasibleNormal
            + candidateTangentY * tangentScale;
        }
      }

      const wallClearance = input.agentRadius + input.wallMargin;
      let nextX = input.positionX + velocityX * input.fixedDelta;
      let nextY = input.positionY + velocityY * input.fixedDelta;
      if (nextX < wallClearance && velocityX < 0) {
        velocityX = 0;
      } else if (nextX > input.worldWidth - wallClearance && velocityX > 0) {
        velocityX = 0;
      }
      if (nextY < wallClearance && velocityY < 0) {
        velocityY = 0;
      } else if (nextY > input.worldHeight - wallClearance && velocityY > 0) {
        velocityY = 0;
      }

      nextX = input.positionX + velocityX * input.fixedDelta;
      nextY = input.positionY + velocityY * input.fixedDelta;
      for (let obstacleIndex = 0; obstacleIndex < input.obstacles.length; obstacleIndex += 1) {
        const obstacle = input.obstacles[obstacleIndex]!;
        if (
          segmentDistanceSquaredToRect(input.positionX, input.positionY, nextX, nextY, obstacle)
          >= wallClearance * wallClearance - 1e-10
        ) continue;
        this.obstacleNormal(nextX, nextY, obstacle);
        const inwardSpeed = velocityX * this.normalX + velocityY * this.normalY;
        if (inwardSpeed < 0) {
          velocityX -= this.normalX * inwardSpeed;
          velocityY -= this.normalY * inwardSpeed;
          nextX = input.positionX + velocityX * input.fixedDelta;
          nextY = input.positionY + velocityY * input.fixedDelta;
        }
      }
      this.projectAccelerationHemisphere(
        input.velocityX,
        input.velocityY,
        preferredX,
        preferredY,
        maximumDelta,
        velocityX,
        velocityY,
      );
      velocityX = this.projectedVelocityX;
      velocityY = this.projectedVelocityY;
    }

    const constrainedSpeed = Math.hypot(velocityX, velocityY);
    if (constrainedSpeed > input.maxSpeed && constrainedSpeed > EPSILON) {
      const scale = input.maxSpeed / constrainedSpeed;
      velocityX *= scale;
      velocityY *= scale;
    }
    // Keep steering acceleration bounded. The contact buffer above absorbs the
    // small residual introduced by this clamp; Phase C remains the physical
    // non-penetration authority for an unavoidable last-step conflict.
    const constrainedDeltaX = velocityX - input.velocityX;
    const constrainedDeltaY = velocityY - input.velocityY;
    const constrainedDelta = Math.hypot(constrainedDeltaX, constrainedDeltaY);
    if (constrainedDelta > maximumDelta && constrainedDelta > EPSILON) {
      const scale = maximumDelta / constrainedDelta;
      velocityX = input.velocityX + constrainedDeltaX * scale;
      velocityY = input.velocityY + constrainedDeltaY * scale;
    }
    this.projectAccelerationHemisphere(
      input.velocityX,
      input.velocityY,
      preferredX,
      preferredY,
      maximumDelta,
      velocityX,
      velocityY,
    );
    velocityX = this.projectedVelocityX;
    velocityY = this.projectedVelocityY;

    const nextStepSafe = this.isNextStepSafe(input, velocityX, velocityY, hardRadiusSquared);
    const finalSpeed = Math.hypot(velocityX, velocityY);
    // If the acceleration budget cannot make the velocity contact-safe, Phase C's
    // bounded positional constraint resolves the actual next position. An abrupt
    // zero here would recreate the stop wave this layer is intended to avoid.
    const emergencyStop = this.projectionEmergency || (
      !nextStepSafe
      && finalSpeed <= EPSILON
      && currentSpeed <= maximumDelta + EPSILON
    );

    out.x = velocityX;
    out.y = velocityY;
    out.avoidanceSide = intent.avoidanceSide;
    out.avoidanceHold = intent.avoidanceHold;
    out.emergencyStop = emergencyStop;
  }

  private desiredSpeed(input: LocalMovementInput): number {
    const arrivalScale = Math.min(1, input.distanceToGoal / Math.max(input.arrivalSlowRadius, EPSILON));
    return input.maxSpeed * arrivalScale;
  }

  private ensureIntervalCapacity(required: number): void {
    if (required <= this.intervalStarts.length) return;
    let capacity = this.intervalStarts.length;
    while (capacity < required) capacity *= 2;
    this.intervalStarts = new Float64Array(capacity);
    this.intervalEnds = new Float64Array(capacity);
  }

  private addDiscInterval(
    relativeX: number,
    relativeY: number,
    radius: number,
    preferredX: number,
    preferredY: number,
  ): void {
    const distanceSquared = relativeX * relativeX + relativeY * relativeY;
    if (distanceSquared <= 1e-12) {
      this.addAngularInterval(-COINCIDENT_BLOCK_HALF_ANGLE, COINCIDENT_BLOCK_HALF_ANGLE);
      return;
    }
    const distance = Math.sqrt(distanceSquared);
    const center = this.relativeAngle(relativeX, relativeY, preferredX, preferredY);
    const halfAngle = distance <= radius
      ? HALF_PI - GAP_PADDING * 2
      : Math.asin(clamp(radius / distance, 0, 1));
    this.addArc(center, halfAngle);
  }

  private addObstacleInterval(
    input: LocalMovementInput,
    obstacle: Rect,
    clearance: number,
    lookAheadDistance: number,
    preferredX: number,
    preferredY: number,
  ): void {
    const distanceSquared = distanceSquaredToRect(input.positionX, input.positionY, obstacle);
    const lookAheadRadius = lookAheadDistance + clearance;
    if (distanceSquared > lookAheadRadius * lookAheadRadius) return;
    if (distanceSquared < clearance * clearance - 1e-10) {
      this.addAngularInterval(-MAX_FORWARD_ANGLE, MAX_FORWARD_ANGLE);
      return;
    }

    const minimumX = obstacle.x;
    const maximumX = obstacle.x + obstacle.width;
    const minimumY = obstacle.y;
    const maximumY = obstacle.y + obstacle.height;

    // A rectangle Minkowski-expanded by a circle is exactly the union of two
    // side strips and the four corner discs. Keeping the primitives scalar
    // avoids allocating geometry in this per-agent hot loop.
    this.addRectInterval(
      input.positionX,
      input.positionY,
      minimumX,
      minimumY - clearance,
      maximumX,
      maximumY + clearance,
      preferredX,
      preferredY,
    );
    this.addRectInterval(
      input.positionX,
      input.positionY,
      minimumX - clearance,
      minimumY,
      maximumX + clearance,
      maximumY,
      preferredX,
      preferredY,
    );
    this.addDiscInterval(
      minimumX - input.positionX, minimumY - input.positionY, clearance, preferredX, preferredY,
    );
    this.addDiscInterval(
      maximumX - input.positionX, minimumY - input.positionY, clearance, preferredX, preferredY,
    );
    this.addDiscInterval(
      minimumX - input.positionX, maximumY - input.positionY, clearance, preferredX, preferredY,
    );
    this.addDiscInterval(
      maximumX - input.positionX, maximumY - input.positionY, clearance, preferredX, preferredY,
    );
  }

  private addRectInterval(
    startX: number,
    startY: number,
    minimumX: number,
    minimumY: number,
    maximumX: number,
    maximumY: number,
    preferredX: number,
    preferredY: number,
  ): void {
    const centerX = (minimumX + maximumX) * 0.5 - startX;
    const centerY = (minimumY + maximumY) * 0.5 - startY;
    const centerAngle = this.relativeAngle(centerX, centerY, preferredX, preferredY);
    let minimumAngle = Number.POSITIVE_INFINITY;
    let maximumAngle = Number.NEGATIVE_INFINITY;
    let angle = this.unwrapAround(
      this.relativeAngle(minimumX - startX, minimumY - startY, preferredX, preferredY),
      centerAngle,
    );
    minimumAngle = Math.min(minimumAngle, angle);
    maximumAngle = Math.max(maximumAngle, angle);
    angle = this.unwrapAround(
      this.relativeAngle(maximumX - startX, minimumY - startY, preferredX, preferredY),
      centerAngle,
    );
    minimumAngle = Math.min(minimumAngle, angle);
    maximumAngle = Math.max(maximumAngle, angle);
    angle = this.unwrapAround(
      this.relativeAngle(minimumX - startX, maximumY - startY, preferredX, preferredY),
      centerAngle,
    );
    minimumAngle = Math.min(minimumAngle, angle);
    maximumAngle = Math.max(maximumAngle, angle);
    angle = this.unwrapAround(
      this.relativeAngle(maximumX - startX, maximumY - startY, preferredX, preferredY),
      centerAngle,
    );
    minimumAngle = Math.min(minimumAngle, angle);
    maximumAngle = Math.max(maximumAngle, angle);
    this.addAngularInterval(minimumAngle, maximumAngle);
  }

  private addWorldBoundaryIntervals(
    input: LocalMovementInput,
    clearance: number,
    lookAheadDistance: number,
    preferredX: number,
    preferredY: number,
  ): void {
    this.addBoundaryInterval(input.positionX - clearance, -1, 0, lookAheadDistance, preferredX, preferredY);
    this.addBoundaryInterval(
      input.worldWidth - clearance - input.positionX, 1, 0, lookAheadDistance, preferredX, preferredY,
    );
    this.addBoundaryInterval(input.positionY - clearance, 0, -1, lookAheadDistance, preferredX, preferredY);
    this.addBoundaryInterval(
      input.worldHeight - clearance - input.positionY, 0, 1, lookAheadDistance, preferredX, preferredY,
    );
  }

  private addBoundaryInterval(
    distance: number,
    outwardX: number,
    outwardY: number,
    lookAheadDistance: number,
    preferredX: number,
    preferredY: number,
  ): void {
    if (distance >= lookAheadDistance) return;
    const center = this.relativeAngle(outwardX, outwardY, preferredX, preferredY);
    const halfAngle = distance <= 0 ? HALF_PI : Math.acos(clamp(distance / lookAheadDistance, 0, 1));
    this.addArc(center, halfAngle);
  }

  private addArc(center: number, halfAngle: number): void {
    if (halfAngle >= PI) {
      this.addAngularInterval(-MAX_FORWARD_ANGLE, MAX_FORWARD_ANGLE);
      return;
    }
    const normalizedCenter = this.normalizeAngle(center);
    this.addAngularInterval(normalizedCenter - halfAngle, normalizedCenter + halfAngle);
    this.addAngularInterval(normalizedCenter - halfAngle - TWO_PI, normalizedCenter + halfAngle - TWO_PI);
    this.addAngularInterval(normalizedCenter - halfAngle + TWO_PI, normalizedCenter + halfAngle + TWO_PI);
  }

  private addAngularInterval(start: number, end: number): void {
    const clippedStart = Math.max(-MAX_FORWARD_ANGLE, start);
    const clippedEnd = Math.min(MAX_FORWARD_ANGLE, end);
    if (clippedEnd < clippedStart + 1e-12) return;
    this.intervalStarts[this.intervalCount] = clippedStart;
    this.intervalEnds[this.intervalCount] = clippedEnd;
    this.intervalCount += 1;
  }

  private sortAndMergeIntervals(): void {
    if (this.intervalCount === 0) {
      this.mergedIntervalCount = 0;
      return;
    }
    this.heapSortIntervals(this.intervalCount);
    let merged = 0;
    let currentStart = this.intervalStarts[0]!;
    let currentEnd = this.intervalEnds[0]!;
    for (let index = 1; index < this.intervalCount; index += 1) {
      const start = this.intervalStarts[index]!;
      const end = this.intervalEnds[index]!;
      if (start <= currentEnd + 1e-10) {
        currentEnd = Math.max(currentEnd, end);
        continue;
      }
      this.intervalStarts[merged] = currentStart;
      this.intervalEnds[merged] = currentEnd;
      merged += 1;
      currentStart = start;
      currentEnd = end;
    }
    this.intervalStarts[merged] = currentStart;
    this.intervalEnds[merged] = currentEnd;
    this.mergedIntervalCount = merged + 1;
  }

  private heapSortIntervals(count: number): void {
    for (let root = (count >> 1) - 1; root >= 0; root -= 1) this.siftDown(root, count);
    for (let end = count - 1; end > 0; end -= 1) {
      this.swapIntervals(0, end);
      this.siftDown(0, end);
    }
  }

  private siftDown(root: number, count: number): void {
    let parent = root;
    while (true) {
      const left = parent * 2 + 1;
      if (left >= count) return;
      const right = left + 1;
      let largest = left;
      if (right < count && this.intervalGreater(right, left)) largest = right;
      if (!this.intervalGreater(largest, parent)) return;
      this.swapIntervals(parent, largest);
      parent = largest;
    }
  }

  private intervalGreater(first: number, second: number): boolean {
    const firstStart = this.intervalStarts[first]!;
    const secondStart = this.intervalStarts[second]!;
    return firstStart > secondStart
      || (firstStart === secondStart && this.intervalEnds[first]! > this.intervalEnds[second]!);
  }

  private swapIntervals(first: number, second: number): void {
    const start = this.intervalStarts[first]!;
    const end = this.intervalEnds[first]!;
    this.intervalStarts[first] = this.intervalStarts[second]!;
    this.intervalEnds[first] = this.intervalEnds[second]!;
    this.intervalStarts[second] = start;
    this.intervalEnds[second] = end;
  }

  private isAngleBlocked(angle: number): boolean {
    for (let interval = 0; interval < this.mergedIntervalCount; interval += 1) {
      if (angle < this.intervalStarts[interval]! - 1e-10) return false;
      if (angle <= this.intervalEnds[interval]! + 1e-10) return true;
    }
    return false;
  }

  private closestAngleInGap(start: number, end: number): number {
    const minimum = start + GAP_PADDING;
    const maximum = end - GAP_PADDING;
    if (maximum < minimum - 1e-12) return Number.NaN;
    return clamp(0, minimum, maximum);
  }

  private preferredTieSide(input: LocalMovementInput): number {
    if (input.avoidanceHold > 0 && input.avoidanceSide !== 0) return input.avoidanceSide < 0 ? -1 : 1;
    if (this.coincidentSideBalance !== 0) return this.coincidentSideBalance < 0 ? -1 : 1;
    if (input.avoidanceSide !== 0) return input.avoidanceSide < 0 ? -1 : 1;
    return this.stableFallbackSide(input.agentIndex, this.nearestBlockingNeighbor);
  }

  private gapScore(input: LocalMovementInput, candidateSide: number, absoluteAngle: number): number {
    if (input.avoidanceHold <= 0 || input.avoidanceSide === 0) return absoluteAngle;
    const heldSide = input.avoidanceSide < 0 ? -1 : 1;
    if (candidateSide === heldSide) return absoluteAngle;
    const holdScale = clamp(
      input.avoidanceHold / Math.max(input.avoidanceBiasSeconds, input.fixedDelta),
      0,
      1,
    );
    return absoluteAngle + 0.6 * holdScale;
  }

  private stableFallbackSide(agent: number, neighbor: number): number {
    if (neighbor < 0 || neighbor === agent) return (agent & 1) === 0 ? 1 : -1;
    return (this.stablePairOrder(agent, neighbor) & 1) === 0 ? 1 : -1;
  }

  private rememberBlockingNeighbor(agent: number, neighbor: number, distanceSquared: number): void {
    if (
      distanceSquared < this.nearestBlockingDistanceSquared - 1e-10
      || (
        Math.abs(distanceSquared - this.nearestBlockingDistanceSquared) <= 1e-10
        && this.stablePairOrder(agent, neighbor) < this.stablePairOrder(agent, this.nearestBlockingNeighbor)
      )
    ) {
      this.nearestBlockingDistanceSquared = distanceSquared;
      this.nearestBlockingNeighbor = neighbor;
    }
  }

  private stablePairOrder(agent: number, neighbor: number): number {
    if (neighbor < 0) return 0x7fffffff;
    const lower = Math.min(agent, neighbor) + 1;
    const upper = Math.max(agent, neighbor) + 1;
    return (Math.imul(lower, 73_856_093) ^ Math.imul(upper, 19_349_663)) >>> 0;
  }

  private staticSafeSpeed(
    input: LocalMovementInput,
    directionX: number,
    directionY: number,
    horizon: number,
  ): number {
    const clearance = this.staticClearance(input, directionX, directionY);
    if (!Number.isFinite(clearance)) return input.maxSpeed;
    const available = Math.max(0, clearance - CONTACT_EPSILON);
    return Math.max(0, Math.min(
      input.maxSpeed,
      Math.sqrt(2 * Math.max(0, input.maxAcceleration) * available),
      available / Math.max(horizon, input.fixedDelta),
    ));
  }

  private dynamicSafeSpeed(
    input: LocalMovementInput,
    directionX: number,
    directionY: number,
    desiredSpeed: number,
    horizon: number,
  ): number {
    let safeSpeed = desiredSpeed;
    const neighborIntentX = input.neighborIntentVelocityX ?? input.neighborVelocityX;
    const neighborIntentY = input.neighborIntentVelocityY ?? input.neighborVelocityY;
    const radius = input.agentRadius * 2 + Math.max(0, input.agentGap);
    for (let offset = 0; offset < input.neighborCount; offset += 1) {
      const neighbor = input.neighborIndices[offset]!;
      const relativeX = input.neighborX[neighbor]! - input.positionX;
      const relativeY = input.neighborY[neighbor]! - input.positionY;
      const neighborVelocityX = neighborIntentX[neighbor]!;
      const neighborVelocityY = neighborIntentY[neighbor]!;
      const collisionTime = this.timeToCollision(
        relativeX,
        relativeY,
        neighborVelocityX - directionX * desiredSpeed,
        neighborVelocityY - directionY * desiredSpeed,
        radius,
      );
      if (collisionTime > horizon) continue;
      let forwardClearance = this.rayCircleClearance(relativeX, relativeY, radius, directionX, directionY);
      forwardClearance = Math.min(
        forwardClearance,
        this.rayCircleClearance(
          relativeX + neighborVelocityX * horizon * 0.5,
          relativeY + neighborVelocityY * horizon * 0.5,
          radius,
          directionX,
          directionY,
        ),
        this.rayCircleClearance(
          relativeX + neighborVelocityX * horizon,
          relativeY + neighborVelocityY * horizon,
          radius,
          directionX,
          directionY,
        ),
      );
      if (!Number.isFinite(forwardClearance)) {
        safeSpeed = Math.min(safeSpeed, desiredSpeed * clamp(collisionTime / horizon, 0, 1));
        continue;
      }
      const available = Math.max(0, forwardClearance - CONTACT_EPSILON);
      const neighborForwardSpeed = neighborVelocityX * directionX + neighborVelocityY * directionY;
      const brakingSpeed = Math.max(0, neighborForwardSpeed)
        + Math.sqrt(2 * Math.max(0, input.maxAcceleration) * available);
      const horizonSpeed = Math.max(0, neighborForwardSpeed + available / horizon);
      safeSpeed = Math.min(safeSpeed, brakingSpeed, horizonSpeed);
    }
    return Math.max(0, safeSpeed);
  }

  private geometricClearance(input: LocalMovementInput, directionX: number, directionY: number): number {
    let clearance = this.staticClearance(input, directionX, directionY);
    const radius = input.agentRadius * 2 + Math.max(0, input.agentGap);
    const neighborIntentX = input.neighborIntentVelocityX ?? input.neighborVelocityX;
    const neighborIntentY = input.neighborIntentVelocityY ?? input.neighborVelocityY;
    const horizon = Math.max(input.fixedDelta, input.avoidanceHorizon);
    for (let offset = 0; offset < input.neighborCount; offset += 1) {
      const neighbor = input.neighborIndices[offset]!;
      const relativeX = input.neighborX[neighbor]! - input.positionX;
      const relativeY = input.neighborY[neighbor]! - input.positionY;
      clearance = Math.min(
        clearance,
        this.rayCircleClearance(relativeX, relativeY, radius, directionX, directionY),
        this.rayCircleClearance(
          relativeX + neighborIntentX[neighbor]! * horizon,
          relativeY + neighborIntentY[neighbor]! * horizon,
          radius,
          directionX,
          directionY,
        ),
      );
    }
    return clearance;
  }

  private staticClearance(input: LocalMovementInput, directionX: number, directionY: number): number {
    const radius = input.agentRadius + input.wallMargin;
    let clearance = Number.POSITIVE_INFINITY;
    if (directionX < -EPSILON) clearance = Math.min(clearance, (input.positionX - radius) / -directionX);
    else if (directionX > EPSILON) {
      clearance = Math.min(clearance, (input.worldWidth - radius - input.positionX) / directionX);
    }
    if (directionY < -EPSILON) clearance = Math.min(clearance, (input.positionY - radius) / -directionY);
    else if (directionY > EPSILON) {
      clearance = Math.min(clearance, (input.worldHeight - radius - input.positionY) / directionY);
    }
    for (let obstacleIndex = 0; obstacleIndex < input.obstacles.length; obstacleIndex += 1) {
      clearance = Math.min(
        clearance,
        this.rayRoundedRectClearance(
          input.positionX,
          input.positionY,
          directionX,
          directionY,
          input.obstacles[obstacleIndex]!,
          radius,
        ),
      );
    }
    return Math.max(0, clearance);
  }

  private rayCircleClearance(
    relativeX: number,
    relativeY: number,
    radius: number,
    directionX: number,
    directionY: number,
  ): number {
    const forward = relativeX * directionX + relativeY * directionY;
    const distanceSquared = relativeX * relativeX + relativeY * relativeY;
    const perpendicularSquared = distanceSquared - forward * forward;
    const radiusSquared = radius * radius;
    if (perpendicularSquared >= radiusSquared) return Number.POSITIVE_INFINITY;
    const extent = Math.sqrt(Math.max(0, radiusSquared - perpendicularSquared));
    if (forward + extent <= 0) return Number.POSITIVE_INFINITY;
    return Math.max(0, forward - extent);
  }

  private rayRoundedRectClearance(
    startX: number,
    startY: number,
    directionX: number,
    directionY: number,
    rect: Rect,
    expansion: number,
  ): number {
    const minimumX = rect.x;
    const maximumX = rect.x + rect.width;
    const minimumY = rect.y;
    const maximumY = rect.y + rect.height;
    const closestX = clamp(startX, minimumX, maximumX);
    const closestY = clamp(startY, minimumY, maximumY);
    const offsetX = startX - closestX;
    const offsetY = startY - closestY;
    const distanceSquared = offsetX * offsetX + offsetY * offsetY;
    if (
      distanceSquared >= expansion * expansion - 1e-10
      && offsetX * directionX + offsetY * directionY >= -EPSILON
    ) return Number.POSITIVE_INFINITY;

    return Math.min(
      this.rayRectClearance(
        startX,
        startY,
        directionX,
        directionY,
        minimumX,
        minimumY - expansion,
        maximumX,
        maximumY + expansion,
      ),
      this.rayRectClearance(
        startX,
        startY,
        directionX,
        directionY,
        minimumX - expansion,
        minimumY,
        maximumX + expansion,
        maximumY,
      ),
      this.rayCircleClearance(minimumX - startX, minimumY - startY, expansion, directionX, directionY),
      this.rayCircleClearance(maximumX - startX, minimumY - startY, expansion, directionX, directionY),
      this.rayCircleClearance(minimumX - startX, maximumY - startY, expansion, directionX, directionY),
      this.rayCircleClearance(maximumX - startX, maximumY - startY, expansion, directionX, directionY),
    );
  }

  private rayRectClearance(
    startX: number,
    startY: number,
    directionX: number,
    directionY: number,
    minimumX: number,
    minimumY: number,
    maximumX: number,
    maximumY: number,
  ): number {
    let near = 0;
    let far = Number.POSITIVE_INFINITY;
    if (Math.abs(directionX) <= EPSILON) {
      if (startX < minimumX || startX > maximumX) return Number.POSITIVE_INFINITY;
    } else {
      let first = (minimumX - startX) / directionX;
      let second = (maximumX - startX) / directionX;
      if (first > second) {
        const swap = first;
        first = second;
        second = swap;
      }
      near = Math.max(near, first);
      far = Math.min(far, second);
      if (near > far) return Number.POSITIVE_INFINITY;
    }
    if (Math.abs(directionY) <= EPSILON) {
      if (startY < minimumY || startY > maximumY) return Number.POSITIVE_INFINITY;
    } else {
      let first = (minimumY - startY) / directionY;
      let second = (maximumY - startY) / directionY;
      if (first > second) {
        const swap = first;
        first = second;
        second = swap;
      }
      near = Math.max(near, first);
      far = Math.min(far, second);
      if (near > far) return Number.POSITIVE_INFINITY;
    }
    return far < 0 ? Number.POSITIVE_INFINITY : Math.max(0, near);
  }

  private timeToCollision(
    relativeX: number,
    relativeY: number,
    relativeVelocityX: number,
    relativeVelocityY: number,
    radius: number,
  ): number {
    const distanceTerm = relativeX * relativeX + relativeY * relativeY - radius * radius;
    const approach = relativeX * relativeVelocityX + relativeY * relativeVelocityY;
    if (distanceTerm <= 0) return approach < -1e-10 ? 0 : Number.POSITIVE_INFINITY;
    const speedSquared = relativeVelocityX * relativeVelocityX + relativeVelocityY * relativeVelocityY;
    if (speedSquared <= EPSILON || approach >= 0) return Number.POSITIVE_INFINITY;
    const discriminant = approach * approach - speedSquared * distanceTerm;
    if (discriminant < 0) return Number.POSITIVE_INFINITY;
    const time = (-approach - Math.sqrt(discriminant)) / speedSquared;
    return time >= 0 ? time : Number.POSITIVE_INFINITY;
  }

  /** Enforce the acceleration disk, then expose any infeasible no-reverse correction. */
  private projectAccelerationHemisphere(
    currentX: number,
    currentY: number,
    preferredX: number,
    preferredY: number,
    maximumDelta: number,
    velocityX: number,
    velocityY: number,
  ): void {
    const reverseSpeed = velocityX * preferredX + velocityY * preferredY;
    if (reverseSpeed >= -EPSILON) {
      this.projectedVelocityX = velocityX;
      this.projectedVelocityY = velocityY;
      return;
    }

    velocityX -= preferredX * reverseSpeed;
    velocityY -= preferredY * reverseSpeed;
    this.projectedVelocityX = velocityX;
    this.projectedVelocityY = velocityY;
    if (Math.hypot(velocityX - currentX, velocityY - currentY) > maximumDelta + EPSILON) {
      // The half-plane is the hard invariant. If it lies outside the reachable
      // acceleration disk, retain tangent motion and classify the discontinuity
      // explicitly instead of silently claiming maxAcceleration compliance.
      this.projectionEmergency = true;
    }
  }

  private obstacleNormal(x: number, y: number, rect: Rect): void {
    const closestX = clamp(x, rect.x, rect.x + rect.width);
    const closestY = clamp(y, rect.y, rect.y + rect.height);
    const offsetX = x - closestX;
    const offsetY = y - closestY;
    const distanceSquared = offsetX * offsetX + offsetY * offsetY;
    if (distanceSquared > 1e-12) {
      const inverseDistance = 1 / Math.sqrt(distanceSquared);
      this.normalX = offsetX * inverseDistance;
      this.normalY = offsetY * inverseDistance;
      return;
    }
    const left = x - rect.x;
    const right = rect.x + rect.width - x;
    const top = y - rect.y;
    const bottom = rect.y + rect.height - y;
    const nearest = Math.min(left, right, top, bottom);
    if (nearest === left) {
      this.normalX = -1;
      this.normalY = 0;
    } else if (nearest === right) {
      this.normalX = 1;
      this.normalY = 0;
    } else if (nearest === top) {
      this.normalX = 0;
      this.normalY = -1;
    } else {
      this.normalX = 0;
      this.normalY = 1;
    }
  }

  private isNextStepSafe(
    input: LocalMovementInput,
    velocityX: number,
    velocityY: number,
    hardRadiusSquared: number,
  ): boolean {
    const nextX = input.positionX + velocityX * input.fixedDelta;
    const nextY = input.positionY + velocityY * input.fixedDelta;
    const wallClearance = input.agentRadius + input.wallMargin;
    if (
      nextX < wallClearance - 1e-10 || nextY < wallClearance - 1e-10
      || nextX > input.worldWidth - wallClearance + 1e-10
      || nextY > input.worldHeight - wallClearance + 1e-10
    ) return false;
    for (let obstacleIndex = 0; obstacleIndex < input.obstacles.length; obstacleIndex += 1) {
      if (
        segmentDistanceSquaredToRect(
          input.positionX,
          input.positionY,
          nextX,
          nextY,
          input.obstacles[obstacleIndex]!,
        ) < wallClearance * wallClearance - 1e-10
      ) return false;
    }
    const neighborIntentX = input.neighborIntentVelocityX ?? input.neighborVelocityX;
    const neighborIntentY = input.neighborIntentVelocityY ?? input.neighborVelocityY;
    for (let offset = 0; offset < input.neighborCount; offset += 1) {
      const neighbor = input.neighborIndices[offset]!;
      const currentOffsetX = input.positionX - input.neighborX[neighbor]!;
      const currentOffsetY = input.positionY - input.neighborY[neighbor]!;
      const nextOffsetX = currentOffsetX + (velocityX - neighborIntentX[neighbor]!) * input.fixedDelta;
      const nextOffsetY = currentOffsetY + (velocityY - neighborIntentY[neighbor]!) * input.fixedDelta;
      const currentSquared = currentOffsetX * currentOffsetX + currentOffsetY * currentOffsetY;
      const nextSquared = nextOffsetX * nextOffsetX + nextOffsetY * nextOffsetY;
      if (nextSquared >= hardRadiusSquared - 1e-10) continue;
      if (currentSquared < hardRadiusSquared - 1e-10 && nextSquared > currentSquared + 1e-10) continue;
      return false;
    }
    return true;
  }

  private relativeAngle(x: number, y: number, preferredX: number, preferredY: number): number {
    return Math.atan2(preferredX * y - preferredY * x, preferredX * x + preferredY * y);
  }

  private unwrapAround(angle: number, center: number): number {
    return center + this.normalizeAngle(angle - center);
  }

  private normalizeAngle(angle: number): number {
    let normalized = angle;
    while (normalized <= -PI) normalized += TWO_PI;
    while (normalized > PI) normalized -= TWO_PI;
    return normalized;
  }
}
