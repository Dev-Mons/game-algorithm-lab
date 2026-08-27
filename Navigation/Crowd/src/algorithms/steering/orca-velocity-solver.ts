import { clamp } from '../../core/math';
import type { AgentBuffer } from '../../core/agent-state';
import type { Rect } from '../../core/types';

const EPSILON = 1e-9;
// Per-second separation bias for physically overlapping pairs. Full 1/dt
// separation demands make packed groups infeasible, and the least-violation
// repair then compromises exactly these hard constraints; blocking approach
// plus this gentle penetration-proportional bias keeps the LP feasible while
// positional relaxation owns actual de-penetration.
const OVERLAP_SEPARATION_RATE = 4;
// Hairline contacts flicker between overlapping and separated every frame; a
// hard block that toggles with them injects visible velocity jitter. Only a
// penetration deeper than this (a genuine squeeze, e.g. against a wall)
// becomes a hard unilaterally-executable constraint.
const OVERLAP_HARD_DEPTH = 0.5;

export interface OrcaVelocityInput {
  current: AgentBuffer;
  active: Uint8Array;
  preferredVelocityX: Float64Array;
  preferredVelocityY: Float64Array;
  neighborOffsets: Int32Array;
  neighborIndices: Int32Array;
  /** Only the closest K active neighbors constrain an agent. */
  neighborCap: number;
  agentRadius: number;
  /**
   * Comfort spacing added to the combined radius of the anticipatory horizon
   * branch only. The collision branch (1/dt scale) always uses the physical
   * radius, so comfortable-but-safe spacing never produces panic half-planes.
   */
  separationPadding: number;
  maxSpeed: number;
  fixedDelta: number;
  timeHorizon: number;
  /**
   * Maximum |output - current velocity| applied when the half-plane set was
   * infeasible and the result is a least-violation repair rather than an
   * agreement. Use with care: the limit also caps constraint-demanded braking,
   * so a small value lets fast agents plow into packed groups. Undefined
   * disables the limit.
   */
  repairDeltaLimit?: number;
  /**
   * Blend factor applied to a least-violation repair result: the applied
   * velocity is current + (repair - current) * repairBlend. Repair points
   * flip frame to frame in over-constrained groups; blending halves each flip
   * while keeping half of any demanded braking, unlike a hard delta clamp.
   * 1 (default) applies the repair exactly.
   */
  repairBlend?: number;
  /** Static AABB obstacles turned into hard velocity half-planes. */
  obstacles: readonly Rect[];
  worldWidth: number;
  worldHeight: number;
  /** Center-to-surface clearance the static half-planes protect. */
  wallClearance: number;
  /**
   * A static half-plane limits approach speed to gap / staticResponseTime.
   * Static lines are added first and are never relaxed by the infeasibility
   * repair — an agent pinned against a wall must not be assumed to yield
   * into it. Default 0.25s.
   */
  staticResponseTime?: number;
  outputVelocityX: Float64Array;
  outputVelocityY: Float64Array;
}

export interface OrcaVelocityResult {
  constraintCount: number;
  /** Agents whose half-plane set had no feasible point inside the speed disk. */
  infeasibleAgents: number;
}

/**
 * Standard full-velocity-space ORCA with symmetric responsibility.
 *
 * Unlike ReciprocalVelocitySolver, the linear program runs over the whole
 * maxSpeed disk instead of a maxAcceleration*dt delta disk, so a dense crowd
 * normally stays feasible and the solution is an actual pairwise agreement
 * rather than a least-violation repair. Acceleration and turn smoothing are the
 * caller's job on the preferred velocity; the solver output is used as agreed
 * with no post-projection.
 */
export class OrcaVelocitySolver {
  private linePointX = new Float64Array(64);
  private linePointY = new Float64Array(64);
  private lineDirectionX = new Float64Array(64);
  private lineDirectionY = new Float64Array(64);
  private projectedPointX = new Float64Array(64);
  private projectedPointY = new Float64Array(64);
  private projectedDirectionX = new Float64Array(64);
  private projectedDirectionY = new Float64Array(64);
  private nearestIndices = new Int32Array(64);
  private nearestDistances = new Float64Array(64);
  private lineCount = 0;
  private resultX = 0;
  private resultY = 0;
  private candidateX = 0;
  private candidateY = 0;

  private readonly result: OrcaVelocityResult = {
    constraintCount: 0,
    infeasibleAgents: 0,
  };

  solve(input: OrcaVelocityInput): OrcaVelocityResult {
    this.assertCompatibleInput(input);
    this.result.constraintCount = 0;
    this.result.infeasibleAgents = 0;
    const neighborCap = Math.max(1, Math.floor(input.neighborCap));
    this.ensureCapacity(neighborCap + 4 + input.obstacles.length * 1);
    const staticResponseTime = Math.max(
      input.fixedDelta,
      input.staticResponseTime ?? 0.25,
    );
    const inverseStaticResponse = 1 / staticResponseTime;
    const staticActivationGap = input.maxSpeed * staticResponseTime;
    const timeHorizon = Math.max(input.fixedDelta, input.timeHorizon);
    const inverseTimeHorizon = 1 / timeHorizon;
    const physicalRadius = Math.max(0, input.agentRadius * 2);
    const physicalRadiusSquared = physicalRadius * physicalRadius;
    const comfortRadius = physicalRadius + Math.max(0, input.separationPadding);
    const comfortRadiusSquared = comfortRadius * comfortRadius;
    const repairDeltaLimit = input.repairDeltaLimit ?? Number.POSITIVE_INFINITY;
    const repairBlend = Math.min(1, Math.max(0, input.repairBlend ?? 1));

    for (let agent = 0; agent < input.current.count; agent += 1) {
      if (input.active[agent] !== 1) {
        input.outputVelocityX[agent] = 0;
        input.outputVelocityY[agent] = 0;
        continue;
      }

      this.lineCount = 0;
      this.addStaticConstraints(input, agent, staticActivationGap, inverseStaticResponse);
      const nearestCount = this.selectNearestNeighbors(input, agent, neighborCap);
      // Deeply overlapping neighbors are a prefix of the distance-sorted
      // selection. Their approach-block lines are hard like the static planes:
      // each side fully blocks its own approach (responsibility 1), so
      // non-penetration survives even when the other agent is pinned against a
      // wall and the usual half-responsibility assumption fails. Hairline
      // contacts stay soft to avoid constraint-toggle jitter.
      const hardOverlapRadius = Math.max(0, physicalRadius - OVERLAP_HARD_DEPTH);
      const hardOverlapRadiusSquared = hardOverlapRadius * hardOverlapRadius;
      let overlapOffset = 0;
      while (
        overlapOffset < nearestCount
        && this.nearestDistances[overlapOffset]! <= hardOverlapRadiusSquared
      ) {
        this.addOverlapConstraint(
          input,
          agent,
          this.nearestIndices[overlapOffset]!,
          physicalRadius,
          1,
        );
        overlapOffset += 1;
      }
      const staticLineCount = this.lineCount;
      for (let offset = overlapOffset; offset < nearestCount; offset += 1) {
        if (this.nearestDistances[offset]! <= physicalRadiusSquared) {
          this.addOverlapConstraint(
            input,
            agent,
            this.nearestIndices[offset]!,
            physicalRadius,
            0.5,
          );
          continue;
        }
        this.addHorizonConstraint(
          input,
          agent,
          this.nearestIndices[offset]!,
          physicalRadius,
          comfortRadius,
          comfortRadiusSquared,
          inverseTimeHorizon,
        );
      }
      this.result.constraintCount += this.lineCount;

      const preferredX = input.preferredVelocityX[agent]!;
      const preferredY = input.preferredVelocityY[agent]!;
      const failedLine = this.linearProgram2(
        this.lineCount,
        input.maxSpeed,
        preferredX,
        preferredY,
        false,
      );
      if (failedLine < this.lineCount) {
        this.result.infeasibleAgents += 1;
        // A failure inside the hard prefix (static planes + overlap blocks)
        // means even the safety system is wedged; keep the partial LP2 result
        // there instead of relaxing hard planes.
        if (failedLine >= staticLineCount) {
          this.linearProgram3(this.lineCount, staticLineCount, failedLine, input.maxSpeed);
        }
        let deltaX = (this.resultX - input.current.vx[agent]!) * repairBlend;
        let deltaY = (this.resultY - input.current.vy[agent]!) * repairBlend;
        const deltaLength = Math.hypot(deltaX, deltaY);
        if (deltaLength > repairDeltaLimit && deltaLength > EPSILON) {
          const scale = repairDeltaLimit / deltaLength;
          deltaX *= scale;
          deltaY *= scale;
        }
        this.resultX = input.current.vx[agent]! + deltaX;
        this.resultY = input.current.vy[agent]! + deltaY;
      }
      input.outputVelocityX[agent] = this.resultX;
      input.outputVelocityY[agent] = this.resultY;
    }
    return this.result;
  }

  private assertCompatibleInput(input: OrcaVelocityInput): void {
    const count = input.current.count;
    if (
      input.active.length < count
      || input.preferredVelocityX.length < count
      || input.preferredVelocityY.length < count
      || input.neighborOffsets.length < count + 1
      || input.outputVelocityX.length < count
      || input.outputVelocityY.length < count
    ) throw new RangeError('ORCA velocity buffers must describe the same agent count.');
    if (!(input.fixedDelta > 0)) throw new RangeError('fixedDelta must be positive.');
  }

  private ensureCapacity(required: number): void {
    if (this.linePointX.length >= required) return;
    let capacity = this.linePointX.length;
    while (capacity < required) capacity *= 2;
    this.linePointX = new Float64Array(capacity);
    this.linePointY = new Float64Array(capacity);
    this.lineDirectionX = new Float64Array(capacity);
    this.lineDirectionY = new Float64Array(capacity);
    this.projectedPointX = new Float64Array(capacity);
    this.projectedPointY = new Float64Array(capacity);
    this.projectedDirectionX = new Float64Array(capacity);
    this.projectedDirectionY = new Float64Array(capacity);
    this.nearestIndices = new Int32Array(capacity);
    this.nearestDistances = new Float64Array(capacity);
  }

  /**
   * Hard velocity half-planes for nearby statics: approach speed toward a wall
   * or obstacle surface is limited to gap / staticResponseTime. Every bound is
   * non-positive, so the static system always admits v = 0.
   */
  private addStaticConstraints(
    input: OrcaVelocityInput,
    agent: number,
    activationGap: number,
    inverseResponse: number,
  ): void {
    const x = input.current.x[agent]!;
    const y = input.current.y[agent]!;
    const clearance = input.wallClearance;
    this.addStaticLine(1, 0, x - clearance, activationGap, inverseResponse);
    this.addStaticLine(-1, 0, input.worldWidth - x - clearance, activationGap, inverseResponse);
    this.addStaticLine(0, 1, y - clearance, activationGap, inverseResponse);
    this.addStaticLine(0, -1, input.worldHeight - y - clearance, activationGap, inverseResponse);
    for (const obstacle of input.obstacles) {
      const closestX = clamp(x, obstacle.x, obstacle.x + obstacle.width);
      const closestY = clamp(y, obstacle.y, obstacle.y + obstacle.height);
      const offsetX = x - closestX;
      const offsetY = y - closestY;
      const distanceSquared = offsetX * offsetX + offsetY * offsetY;
      // A center inside the rectangle is an inherited invalid state owned by
      // the swept integrator's recovery, not a velocity constraint.
      if (distanceSquared <= 1e-12) continue;
      const distance = Math.sqrt(distanceSquared);
      this.addStaticLine(
        offsetX / distance,
        offsetY / distance,
        distance - clearance,
        activationGap,
        inverseResponse,
      );
    }
  }

  /** Half-plane v·n ≥ -gap/response, encoded for the det-based feasibility test. */
  private addStaticLine(
    normalX: number,
    normalY: number,
    gap: number,
    activationGap: number,
    inverseResponse: number,
  ): void {
    if (gap >= activationGap) return;
    const bound = -Math.max(0, gap) * inverseResponse;
    const line = this.lineCount;
    this.linePointX[line] = normalX * bound;
    this.linePointY[line] = normalY * bound;
    this.lineDirectionX[line] = normalY;
    this.lineDirectionY[line] = -normalX;
    this.lineCount += 1;
  }

  /** Deterministic K-nearest selection; ties resolve to the lower agent index. */
  private selectNearestNeighbors(input: OrcaVelocityInput, agent: number, cap: number): number {
    const start = input.neighborOffsets[agent]!;
    const end = input.neighborOffsets[agent + 1]!;
    const x = input.current.x[agent]!;
    const y = input.current.y[agent]!;
    let count = 0;
    for (let offset = start; offset < end; offset += 1) {
      const other = input.neighborIndices[offset]!;
      if (input.active[other] !== 1) continue;
      const dx = input.current.x[other]! - x;
      const dy = input.current.y[other]! - y;
      const distanceSquared = dx * dx + dy * dy;
      if (count === cap && distanceSquared >= this.nearestDistances[cap - 1]!) continue;
      let insert = count < cap ? count : cap - 1;
      while (
        insert > 0
        && (
          this.nearestDistances[insert - 1]! > distanceSquared
          || (
            this.nearestDistances[insert - 1]! === distanceSquared
            && this.nearestIndices[insert - 1]! > other
          )
        )
      ) {
        if (insert < cap) {
          this.nearestDistances[insert] = this.nearestDistances[insert - 1]!;
          this.nearestIndices[insert] = this.nearestIndices[insert - 1]!;
        }
        insert -= 1;
      }
      if (insert < cap) {
        this.nearestDistances[insert] = distanceSquared;
        this.nearestIndices[insert] = other;
      }
      if (count < cap) count += 1;
    }
    return count;
  }

  /**
   * Anticipatory horizon constraint for a non-overlapping neighbor. Outside
   * the comfort radius the cone protects comfortable spacing; inside the
   * annulus it falls back to the physical radius so the geometry stays valid.
   * Comfort spacing itself is a preference and belongs in the caller's
   * preferred velocity — putting it into the LP made packed groups jointly
   * infeasible, and the repair then compromised the hard approach constraints.
   */
  private addHorizonConstraint(
    input: OrcaVelocityInput,
    agent: number,
    other: number,
    physicalRadius: number,
    comfortRadius: number,
    comfortRadiusSquared: number,
    inverseTimeHorizon: number,
  ): void {
    const relativePositionX = input.current.x[other]! - input.current.x[agent]!;
    const relativePositionY = input.current.y[other]! - input.current.y[agent]!;
    const relativeVelocityX = input.current.vx[agent]! - input.current.vx[other]!;
    const relativeVelocityY = input.current.vy[agent]! - input.current.vy[other]!;
    const distanceSquared = relativePositionX * relativePositionX
      + relativePositionY * relativePositionY;
    let directionX = 0;
    let directionY = 0;
    let correctionX = 0;
    let correctionY = 0;

    const combinedRadius = distanceSquared > comfortRadiusSquared
      ? comfortRadius
      : physicalRadius;
    const combinedRadiusSquared = combinedRadius * combinedRadius;
    const wX = relativeVelocityX - relativePositionX * inverseTimeHorizon;
    const wY = relativeVelocityY - relativePositionY * inverseTimeHorizon;
    const wLengthSquared = wX * wX + wY * wY;
    const projection = wX * relativePositionX + wY * relativePositionY;
    if (
      projection < 0
      && projection * projection > combinedRadiusSquared * wLengthSquared
    ) {
      const wLength = Math.sqrt(wLengthSquared);
      if (wLength > EPSILON) {
        const unitWX = wX / wLength;
        const unitWY = wY / wLength;
        directionX = unitWY;
        directionY = -unitWX;
        const correctionLength = combinedRadius * inverseTimeHorizon - wLength;
        correctionX = unitWX * correctionLength;
        correctionY = unitWY * correctionLength;
      } else {
        const inverseDistance = 1 / Math.sqrt(distanceSquared);
        const unitWX = -relativePositionX * inverseDistance;
        const unitWY = -relativePositionY * inverseDistance;
        directionX = unitWY;
        directionY = -unitWX;
        correctionX = unitWX * combinedRadius * inverseTimeHorizon;
        correctionY = unitWY * combinedRadius * inverseTimeHorizon;
      }
    } else {
      const leg = Math.sqrt(Math.max(0, distanceSquared - combinedRadiusSquared));
      if (this.det(relativePositionX, relativePositionY, wX, wY) > 0) {
        directionX = (
          relativePositionX * leg - relativePositionY * combinedRadius
        ) / distanceSquared;
        directionY = (
          relativePositionX * combinedRadius + relativePositionY * leg
        ) / distanceSquared;
      } else {
        directionX = -(
          relativePositionX * leg + relativePositionY * combinedRadius
        ) / distanceSquared;
        directionY = -(
          -relativePositionX * combinedRadius + relativePositionY * leg
        ) / distanceSquared;
      }
      const projectionOnLeg = relativeVelocityX * directionX
        + relativeVelocityY * directionY;
      correctionX = directionX * projectionOnLeg - relativeVelocityX;
      correctionY = directionY * projectionOnLeg - relativeVelocityY;
    }

    const line = this.lineCount;
    // Absolute velocity space: each side of the pair takes half the correction.
    this.linePointX[line] = input.current.vx[agent]! + correctionX * 0.5;
    this.linePointY[line] = input.current.vy[agent]! + correctionY * 0.5;
    this.lineDirectionX[line] = directionX;
    this.lineDirectionY[line] = directionY;
    this.lineCount += 1;
  }

  /**
   * Approach-block for a physically overlapping neighbor: the gap must not
   * shrink, plus a gentle penetration-proportional separation bias (see
   * OVERLAP_SEPARATION_RATE). With responsibility 1 the constraint is
   * executable unilaterally and belongs in the hard prefix; with 0.5 it is a
   * reciprocal soft line for hairline contacts.
   */
  private addOverlapConstraint(
    input: OrcaVelocityInput,
    agent: number,
    other: number,
    physicalRadius: number,
    responsibility: number,
  ): void {
    const relativePositionX = input.current.x[other]! - input.current.x[agent]!;
    const relativePositionY = input.current.y[other]! - input.current.y[agent]!;
    const relativeVelocityX = input.current.vx[agent]! - input.current.vx[other]!;
    const relativeVelocityY = input.current.vy[agent]! - input.current.vy[other]!;
    const distanceSquared = relativePositionX * relativePositionX
      + relativePositionY * relativePositionY;
    let unitWX: number;
    let unitWY: number;
    if (distanceSquared > EPSILON) {
      const inverseDistance = 1 / Math.sqrt(distanceSquared);
      unitWX = -relativePositionX * inverseDistance;
      unitWY = -relativePositionY * inverseDistance;
    } else {
      const side = agent < other ? -1 : 1;
      unitWX = 0;
      unitWY = side;
    }
    const approach = relativeVelocityX * unitWX + relativeVelocityY * unitWY;
    const penetration = physicalRadius - Math.sqrt(distanceSquared);
    const correctionLength = (Math.max(0, -approach)
      + penetration * OVERLAP_SEPARATION_RATE) * responsibility;
    const line = this.lineCount;
    this.linePointX[line] = input.current.vx[agent]! + unitWX * correctionLength;
    this.linePointY[line] = input.current.vy[agent]! + unitWY * correctionLength;
    this.lineDirectionX[line] = unitWY;
    this.lineDirectionY[line] = -unitWX;
    this.lineCount += 1;
  }

  private linearProgram1(
    line: number,
    radius: number,
    optimalX: number,
    optimalY: number,
    directionOptimal: boolean,
  ): boolean {
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

    for (let other = 0; other < line; other += 1) {
      const denominator = this.det(
        directionX,
        directionY,
        this.lineDirectionX[other]!,
        this.lineDirectionY[other]!,
      );
      const numerator = this.det(
        this.lineDirectionX[other]!,
        this.lineDirectionY[other]!,
        pointX - this.linePointX[other]!,
        pointY - this.linePointY[other]!,
      );
      if (Math.abs(denominator) <= EPSILON) {
        if (numerator < 0) return false;
        continue;
      }
      const amount = numerator / denominator;
      if (denominator >= 0) right = Math.min(right, amount);
      else left = Math.max(left, amount);
      if (left > right) return false;
    }

    let amount: number;
    if (directionOptimal) {
      amount = optimalX * directionX + optimalY * directionY > 0 ? right : left;
    } else {
      amount = clamp(
        directionX * (optimalX - pointX) + directionY * (optimalY - pointY),
        left,
        right,
      );
    }
    this.candidateX = pointX + directionX * amount;
    this.candidateY = pointY + directionY * amount;
    return true;
  }

  private linearProgram2(
    lineCount: number,
    radius: number,
    optimalX: number,
    optimalY: number,
    directionOptimal: boolean,
  ): number {
    if (directionOptimal) {
      this.resultX = optimalX * radius;
      this.resultY = optimalY * radius;
    } else {
      const length = Math.hypot(optimalX, optimalY);
      if (length > radius && length > EPSILON) {
        this.resultX = optimalX * radius / length;
        this.resultY = optimalY * radius / length;
      } else {
        this.resultX = optimalX;
        this.resultY = optimalY;
      }
    }

    for (let line = 0; line < lineCount; line += 1) {
      if (this.det(
        this.lineDirectionX[line]!,
        this.lineDirectionY[line]!,
        this.linePointX[line]! - this.resultX,
        this.linePointY[line]! - this.resultY,
      ) <= 0) continue;
      const previousX = this.resultX;
      const previousY = this.resultY;
      if (!this.linearProgram1(
        line,
        radius,
        optimalX,
        optimalY,
        directionOptimal,
      )) {
        this.resultX = previousX;
        this.resultY = previousY;
        return line;
      }
      this.resultX = this.candidateX;
      this.resultY = this.candidateY;
    }
    return lineCount;
  }

  private linearProgram3(
    lineCount: number,
    staticLineCount: number,
    beginLine: number,
    radius: number,
  ): void {
    let distance = 0;
    for (let line = beginLine; line < lineCount; line += 1) {
      const violation = this.det(
        this.lineDirectionX[line]!,
        this.lineDirectionY[line]!,
        this.linePointX[line]! - this.resultX,
        this.linePointY[line]! - this.resultY,
      );
      if (violation <= distance) continue;
      let projectedCount = 0;
      // Static half-planes stay hard: they enter the relaxed sub-program
      // verbatim instead of being blended toward the violating line.
      for (let other = 0; other < staticLineCount; other += 1) {
        this.projectedPointX[projectedCount] = this.linePointX[other]!;
        this.projectedPointY[projectedCount] = this.linePointY[other]!;
        this.projectedDirectionX[projectedCount] = this.lineDirectionX[other]!;
        this.projectedDirectionY[projectedCount] = this.lineDirectionY[other]!;
        projectedCount += 1;
      }
      for (let other = staticLineCount; other < line; other += 1) {
        const determinant = this.det(
          this.lineDirectionX[line]!,
          this.lineDirectionY[line]!,
          this.lineDirectionX[other]!,
          this.lineDirectionY[other]!,
        );
        let pointX: number;
        let pointY: number;
        if (Math.abs(determinant) <= EPSILON) {
          if (
            this.lineDirectionX[line]! * this.lineDirectionX[other]!
              + this.lineDirectionY[line]! * this.lineDirectionY[other]!
            > 0
          ) continue;
          pointX = (this.linePointX[line]! + this.linePointX[other]!) * 0.5;
          pointY = (this.linePointY[line]! + this.linePointY[other]!) * 0.5;
        } else {
          const amount = this.det(
            this.lineDirectionX[other]!,
            this.lineDirectionY[other]!,
            this.linePointX[line]! - this.linePointX[other]!,
            this.linePointY[line]! - this.linePointY[other]!,
          ) / determinant;
          pointX = this.linePointX[line]! + this.lineDirectionX[line]! * amount;
          pointY = this.linePointY[line]! + this.lineDirectionY[line]! * amount;
        }
        let directionX = this.lineDirectionX[other]! - this.lineDirectionX[line]!;
        let directionY = this.lineDirectionY[other]! - this.lineDirectionY[line]!;
        const length = Math.hypot(directionX, directionY);
        if (length <= EPSILON) continue;
        directionX /= length;
        directionY /= length;
        this.projectedPointX[projectedCount] = pointX;
        this.projectedPointY[projectedCount] = pointY;
        this.projectedDirectionX[projectedCount] = directionX;
        this.projectedDirectionY[projectedCount] = directionY;
        projectedCount += 1;
      }

      const originalPointX = this.linePointX;
      const originalPointY = this.linePointY;
      const originalDirectionX = this.lineDirectionX;
      const originalDirectionY = this.lineDirectionY;
      const previousX = this.resultX;
      const previousY = this.resultY;
      this.linePointX = this.projectedPointX;
      this.linePointY = this.projectedPointY;
      this.lineDirectionX = this.projectedDirectionX;
      this.lineDirectionY = this.projectedDirectionY;
      const failed = this.linearProgram2(
        projectedCount,
        radius,
        -originalDirectionY[line]!,
        originalDirectionX[line]!,
        true,
      );
      this.linePointX = originalPointX;
      this.linePointY = originalPointY;
      this.lineDirectionX = originalDirectionX;
      this.lineDirectionY = originalDirectionY;
      if (failed < projectedCount) {
        this.resultX = previousX;
        this.resultY = previousY;
      }
      distance = this.det(
        this.lineDirectionX[line]!,
        this.lineDirectionY[line]!,
        this.linePointX[line]! - this.resultX,
        this.linePointY[line]! - this.resultY,
      );
    }
  }

  private det(ax: number, ay: number, bx: number, by: number): number {
    return ax * by - ay * bx;
  }
}
