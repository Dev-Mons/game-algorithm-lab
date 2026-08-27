import { clamp } from '../../core/math';
import type { AgentBuffer } from '../../core/agent-state';

const EPSILON = 1e-9;
const RESPONSIBILITY_FOLLOWER = 0.95;
const RESPONSIBILITY_LEADER = 1 - RESPONSIBILITY_FOLLOWER;

export interface ReciprocalVelocityInput {
  current: AgentBuffer;
  active: Uint8Array;
  preferredVelocityX: Float64Array;
  preferredVelocityY: Float64Array;
  neighborOffsets: Int32Array;
  neighborIndices: Int32Array;
  agentRadius: number;
  separationPadding: number;
  maxSpeed: number;
  maxAcceleration: number;
  fixedDelta: number;
  timeHorizon: number;
  outputVelocityX: Float64Array;
  outputVelocityY: Float64Array;
}

export interface ReciprocalVelocityResult {
  constraintCount: number;
  projectionRepairAgents: number;
}

/**
 * ORCA-style reciprocal velocity projection with an acceleration-centered disk.
 *
 * The usual ORCA half-planes are translated into delta-velocity space, where
 * the feasible circle is centered on the agent's current velocity and has a
 * radius of maxAcceleration * dt. This prevents local avoidance from silently
 * bypassing the configured acceleration limit. Local stream order weights the
 * reciprocal responsibility so a follower yields more than the unit ahead.
 */
export class ReciprocalVelocitySolver {
  private linePointX = new Float64Array(64);
  private linePointY = new Float64Array(64);
  private lineDirectionX = new Float64Array(64);
  private lineDirectionY = new Float64Array(64);
  private projectedPointX = new Float64Array(64);
  private projectedPointY = new Float64Array(64);
  private projectedDirectionX = new Float64Array(64);
  private projectedDirectionY = new Float64Array(64);
  private lineCount = 0;
  private resultX = 0;
  private resultY = 0;
  private candidateX = 0;
  private candidateY = 0;

  private readonly result: ReciprocalVelocityResult = {
    constraintCount: 0,
    projectionRepairAgents: 0,
  };

  solve(input: ReciprocalVelocityInput): ReciprocalVelocityResult {
    this.assertCompatibleInput(input);
    this.result.constraintCount = 0;
    this.result.projectionRepairAgents = 0;
    const maximumDelta = Math.max(0, input.maxAcceleration) * input.fixedDelta;
    const timeHorizon = Math.max(input.fixedDelta, input.timeHorizon);
    const inverseTimeHorizon = 1 / timeHorizon;
    const inverseTimeStep = 1 / input.fixedDelta;
    const combinedRadius = Math.max(0, input.agentRadius * 2 + input.separationPadding);
    const combinedRadiusSquared = combinedRadius * combinedRadius;

    for (let agent = 0; agent < input.current.count; agent += 1) {
      if (input.active[agent] !== 1) {
        input.outputVelocityX[agent] = 0;
        input.outputVelocityY[agent] = 0;
        continue;
      }
      const start = input.neighborOffsets[agent]!;
      const end = input.neighborOffsets[agent + 1]!;
      this.ensureLineCapacity(end - start);
      this.lineCount = 0;

      for (let offset = start; offset < end; offset += 1) {
        const other = input.neighborIndices[offset]!;
        if (input.active[other] !== 1) continue;
        this.addAgentConstraint(
          input,
          agent,
          other,
          combinedRadius,
          combinedRadiusSquared,
          inverseTimeHorizon,
          inverseTimeStep,
        );
      }
      this.result.constraintCount += this.lineCount;

      const currentX = input.current.vx[agent]!;
      const currentY = input.current.vy[agent]!;
      let preferredDeltaX = input.preferredVelocityX[agent]! - currentX;
      let preferredDeltaY = input.preferredVelocityY[agent]! - currentY;
      const preferredDeltaLength = Math.hypot(preferredDeltaX, preferredDeltaY);
      if (preferredDeltaLength > maximumDelta && preferredDeltaLength > EPSILON) {
        const scale = maximumDelta / preferredDeltaLength;
        preferredDeltaX *= scale;
        preferredDeltaY *= scale;
      }

      const failedLine = this.linearProgram2(
        this.lineCount,
        maximumDelta,
        preferredDeltaX,
        preferredDeltaY,
        false,
      );
      if (failedLine < this.lineCount) {
        this.result.projectionRepairAgents += 1;
        this.linearProgram3(this.lineCount, failedLine, maximumDelta);
      }

      let velocityX = currentX + this.resultX;
      let velocityY = currentY + this.resultY;
      const speed = Math.hypot(velocityX, velocityY);
      if (speed > input.maxSpeed && speed > EPSILON) {
        const scale = input.maxSpeed / speed;
        velocityX *= scale;
        velocityY *= scale;
      }
      const preferredX = input.preferredVelocityX[agent]!;
      const preferredY = input.preferredVelocityY[agent]!;
      const preferredLength = Math.hypot(preferredX, preferredY);
      if (preferredLength > EPSILON) {
        const reverse = velocityX * preferredX + velocityY * preferredY;
        if (reverse < 0) {
          velocityX -= preferredX * reverse / (preferredLength * preferredLength);
          velocityY -= preferredY * reverse / (preferredLength * preferredLength);
        }
      }
      input.outputVelocityX[agent] = velocityX;
      input.outputVelocityY[agent] = velocityY;
    }
    return this.result;
  }

  private assertCompatibleInput(input: ReciprocalVelocityInput): void {
    const count = input.current.count;
    if (
      input.active.length < count
      || input.preferredVelocityX.length < count
      || input.preferredVelocityY.length < count
      || input.neighborOffsets.length < count + 1
      || input.outputVelocityX.length < count
      || input.outputVelocityY.length < count
    ) throw new RangeError('Reciprocal velocity buffers must describe the same agent count.');
    if (!(input.fixedDelta > 0)) throw new RangeError('fixedDelta must be positive.');
  }

  private ensureLineCapacity(required: number): void {
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
  }

  private addAgentConstraint(
    input: ReciprocalVelocityInput,
    agent: number,
    other: number,
    combinedRadius: number,
    combinedRadiusSquared: number,
    inverseTimeHorizon: number,
    inverseTimeStep: number,
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

    if (distanceSquared > combinedRadiusSquared) {
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
    } else {
      const wX = relativeVelocityX - relativePositionX * inverseTimeStep;
      const wY = relativeVelocityY - relativePositionY * inverseTimeStep;
      const wLength = Math.hypot(wX, wY);
      let unitWX: number;
      let unitWY: number;
      if (wLength > EPSILON) {
        unitWX = wX / wLength;
        unitWY = wY / wLength;
      } else if (distanceSquared > EPSILON) {
        const inverseDistance = 1 / Math.sqrt(distanceSquared);
        unitWX = -relativePositionX * inverseDistance;
        unitWY = -relativePositionY * inverseDistance;
      } else {
        const side = agent < other ? -1 : 1;
        unitWX = 0;
        unitWY = side;
      }
      directionX = unitWY;
      directionY = -unitWX;
      const correctionLength = combinedRadius * inverseTimeStep - wLength;
      correctionX = unitWX * correctionLength;
      correctionY = unitWY * correctionLength;
    }

    const agentPreferredX = input.preferredVelocityX[agent]!;
    const agentPreferredY = input.preferredVelocityY[agent]!;
    const otherPreferredX = input.preferredVelocityX[other]!;
    const otherPreferredY = input.preferredVelocityY[other]!;
    const agentPreferredLength = Math.hypot(agentPreferredX, agentPreferredY);
    const otherPreferredLength = Math.hypot(otherPreferredX, otherPreferredY);
    let responsibility = 0.5;
    if (agentPreferredLength > EPSILON && otherPreferredLength > EPSILON) {
      const agentHeadingX = agentPreferredX / agentPreferredLength;
      const agentHeadingY = agentPreferredY / agentPreferredLength;
      const otherHeadingX = otherPreferredX / otherPreferredLength;
      const otherHeadingY = otherPreferredY / otherPreferredLength;
      const alignment = agentHeadingX * otherHeadingX + agentHeadingY * otherHeadingY;
      if (alignment > 0.5) {
        let streamX = agentHeadingX + otherHeadingX;
        let streamY = agentHeadingY + otherHeadingY;
        const streamLength = Math.hypot(streamX, streamY);
        streamX /= streamLength;
        streamY /= streamLength;
        const otherProgress = relativePositionX * streamX + relativePositionY * streamY;
        if (otherProgress > input.agentRadius * 0.25) {
          responsibility = RESPONSIBILITY_FOLLOWER;
        } else if (otherProgress < -input.agentRadius * 0.25) {
          responsibility = RESPONSIBILITY_LEADER;
        }
      }
    }
    const line = this.lineCount;
    // Translate the ORCA line into delta-velocity space so the LP circle is
    // centered on current velocity instead of the origin.
    this.linePointX[line] = correctionX * responsibility;
    this.linePointY[line] = correctionY * responsibility;
    this.lineDirectionX[line] = directionX;
    this.lineDirectionY[line] = directionY;
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

  private linearProgram3(lineCount: number, beginLine: number, radius: number): void {
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
      for (let other = 0; other < line; other += 1) {
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
