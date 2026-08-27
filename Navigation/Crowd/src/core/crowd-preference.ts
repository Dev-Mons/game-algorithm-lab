import type { AgentBuffer } from './agent-state';
import { clamp } from './math';

const EPSILON = 1e-9;
const DENSITY_RADIUS = 22;
const DENSITY_SATURATION = 9;
const DENSITY_SLOWDOWN = 0.28;
const DENSITY_SPEED_FLOOR = 0.66;
const ALIGNMENT_BASE_WEIGHT = 0.08;
const ALIGNMENT_DENSITY_WEIGHT = 0.52;
const JERK_MEMORY_WEIGHT = 0.12;
const SEPARATION_SPEED = 7;
const SEPARATION_CAP = 10;

export interface CrowdPreferenceInput {
  current: AgentBuffer;
  active: Uint8Array;
  globalDirectionX: Float64Array;
  globalDirectionY: Float64Array;
  goalSpeed: Float64Array;
  neighborOffsets: Int32Array;
  neighborIndices: Int32Array;
  agentRadius: number;
  agentGap: number;
  maxSpeed: number;
  maxAcceleration: number;
  fixedDelta: number;
  leaderHorizon?: number;
  /** Keep neighbor alignment from suppressing shared forward acceleration. */
  preserveLongitudinalSpeed?: boolean;
  outputVelocityX: Float64Array;
  outputVelocityY: Float64Array;
  outputDesiredSpeed: Float64Array;
  outputDensity: Float64Array;
  outputMeanVelocityX: Float64Array;
  outputMeanVelocityY: Float64Array;
  outputLeaderId: Int32Array;
  outputLeaderGap: Float64Array;
  outputLeaderSpeed: Float64Array;
  outputMinimumDistance: Float64Array;
}

/**
 * Converts global navigation into a crowd-aware preferred velocity.
 *
 * This layer deliberately has no collision authority. It anticipates queues by
 * matching a same-flow leader, lowers free speed in a slow dense patch, and
 * adds weak alignment/separation preferences. The unified solver remains the
 * only routine layer allowed to decide the executable velocity.
 */
export class CrowdPreference {
  build(input: CrowdPreferenceInput): void {
    const current = input.current;
    const physicalDiameter = input.agentRadius * 2;
    const comfortDistance = physicalDiameter + Math.max(0, input.agentGap);
    const densityRadiusSquared = DENSITY_RADIUS * DENSITY_RADIUS;
    const leaderRange = physicalDiameter + input.maxSpeed * Math.max(0, input.leaderHorizon ?? 0.55);
    const leaderRangeSquared = leaderRange * leaderRange;
    const leaderLateralRange = input.preserveLongitudinalSpeed === true
      ? input.agentRadius * 0.5
      : physicalDiameter;
    const maximumDelta = Math.max(0, input.maxAcceleration) * input.fixedDelta;

    for (let agent = 0; agent < current.count; agent += 1) {
      if (input.active[agent] !== 1) {
        input.outputVelocityX[agent] = 0;
        input.outputVelocityY[agent] = 0;
        input.outputDesiredSpeed[agent] = 0;
        input.outputDensity[agent] = 0;
        input.outputMeanVelocityX[agent] = 0;
        input.outputMeanVelocityY[agent] = 0;
        input.outputLeaderId[agent] = -1;
        input.outputLeaderGap[agent] = Number.POSITIVE_INFINITY;
        input.outputLeaderSpeed[agent] = 0;
        input.outputMinimumDistance[agent] = Number.POSITIVE_INFINITY;
        continue;
      }

      const directionX = input.globalDirectionX[agent]!;
      const directionY = input.globalDirectionY[agent]!;
      let density = 0;
      let meanWeight = 0;
      let meanVelocityX = 0;
      let meanVelocityY = 0;
      let separationX = 0;
      let separationY = 0;
      let minimumDistance = Number.POSITIVE_INFINITY;
      let leaderId = -1;
      let leaderScore = Number.POSITIVE_INFINITY;
      let leaderGap = Number.POSITIVE_INFINITY;
      let leaderSpeed = input.maxSpeed;
      const start = input.neighborOffsets[agent]!;
      const end = input.neighborOffsets[agent + 1]!;

      for (let offset = start; offset < end; offset += 1) {
        const other = input.neighborIndices[offset]!;
        if (input.active[other] !== 1) continue;
        const dx = current.x[other]! - current.x[agent]!;
        const dy = current.y[other]! - current.y[agent]!;
        const distanceSquared = dx * dx + dy * dy;
        if (distanceSquared <= EPSILON) {
          minimumDistance = 0;
          continue;
        }
        const distance = Math.sqrt(distanceSquared);
        minimumDistance = Math.min(minimumDistance, distance);

        const otherDirectionX = input.globalDirectionX[other]!;
        const otherDirectionY = input.globalDirectionY[other]!;
        const directionAlignment = directionX * otherDirectionX + directionY * otherDirectionY;
        if (distanceSquared <= densityRadiusSquared) {
          const weight = 1 - distance / DENSITY_RADIUS;
          density += weight;
          if (directionAlignment > 0.25) {
            meanWeight += weight;
            meanVelocityX += current.vx[other]! * weight;
            meanVelocityY += current.vy[other]! * weight;
          }
        }

        if (distance < comfortDistance) {
          const penetration = (comfortDistance - distance) / Math.max(input.agentGap, 1);
          const strength = Math.min(1, penetration) * SEPARATION_SPEED;
          separationX -= (dx / distance) * strength;
          separationY -= (dy / distance) * strength;
        }

        if (distanceSquared > leaderRangeSquared || directionAlignment < 0.7) continue;
        const forward = dx * directionX + dy * directionY;
        if (forward <= 0) continue;
        const lateral = Math.abs(dx * -directionY + dy * directionX);
        if (lateral > leaderLateralRange) continue;
        const score = forward + lateral * 0.8;
        if (score > leaderScore + EPSILON || (Math.abs(score - leaderScore) <= EPSILON && other > leaderId)) continue;
        leaderId = other;
        leaderScore = score;
        leaderGap = Math.max(0, distance - physicalDiameter);
        leaderSpeed = Math.max(
          0,
          current.vx[other]! * directionX + current.vy[other]! * directionY,
        );
      }

      if (meanWeight > EPSILON) {
        meanVelocityX /= meanWeight;
        meanVelocityY /= meanWeight;
      }
      const normalizedDensity = clamp(density / DENSITY_SATURATION, 0, 1);
      const meanProgress = Math.max(0, meanVelocityX * directionX + meanVelocityY * directionY);
      const slowPatch = 1 - clamp(meanProgress / Math.max(input.maxSpeed * 0.8, EPSILON), 0, 1);
      const densityScale = input.preserveLongitudinalSpeed === true
        ? 1
        : Math.max(
          DENSITY_SPEED_FLOOR,
          1 - normalizedDensity * slowPatch * DENSITY_SLOWDOWN,
        );
      let desiredSpeed = Math.min(input.goalSpeed[agent]!, input.maxSpeed * densityScale);

      if (leaderId >= 0) {
        // Preserve simultaneous acceleration while the geometric surface gap
        // can absorb it; converge to the leader speed at contact so the hard
        // one-step agreement does not need an acceleration-breaking brake.
        const safeClosingSpeed = leaderGap / Math.max(input.fixedDelta, EPSILON);
        const closingAllowance = input.preserveLongitudinalSpeed === true
          ? Math.min(maximumDelta * 2.3, safeClosingSpeed)
          : Math.min(maximumDelta, safeClosingSpeed);
        const followingSpeed = leaderSpeed + closingAllowance;
        desiredSpeed = Math.min(desiredSpeed, followingSpeed);
      }

      const separationLength = Math.hypot(separationX, separationY);
      if (separationLength > SEPARATION_CAP) {
        separationX *= SEPARATION_CAP / separationLength;
        separationY *= SEPARATION_CAP / separationLength;
      }
      let targetX = directionX * desiredSpeed + separationX;
      let targetY = directionY * desiredSpeed + separationY;
      if (meanWeight > EPSILON) {
        const targetProgress = targetX * directionX + targetY * directionY;
        const alignmentWeight = ALIGNMENT_BASE_WEIGHT
          + normalizedDensity * ALIGNMENT_DENSITY_WEIGHT;
        targetX = targetX * (1 - alignmentWeight) + meanVelocityX * alignmentWeight;
        targetY = targetY * (1 - alignmentWeight) + meanVelocityY * alignmentWeight;
        if (input.preserveLongitudinalSpeed === true) {
          const alignedProgress = targetX * directionX + targetY * directionY;
          if (alignedProgress < targetProgress) {
            targetX += directionX * (targetProgress - alignedProgress);
            targetY += directionY * (targetProgress - alignedProgress);
          }
        }
      }
      const continuedX = current.vx[agent]! + current.accelerationX[agent]! * input.fixedDelta;
      const continuedY = current.vy[agent]! + current.accelerationY[agent]! * input.fixedDelta;
      const preMemoryProgress = targetX * directionX + targetY * directionY;
      targetX = targetX * (1 - JERK_MEMORY_WEIGHT) + continuedX * JERK_MEMORY_WEIGHT;
      targetY = targetY * (1 - JERK_MEMORY_WEIGHT) + continuedY * JERK_MEMORY_WEIGHT;
      if (input.preserveLongitudinalSpeed === true) {
        const memoryProgress = targetX * directionX + targetY * directionY;
        if (memoryProgress < preMemoryProgress) {
          targetX += directionX * (preMemoryProgress - memoryProgress);
          targetY += directionY * (preMemoryProgress - memoryProgress);
        }
      }
      const targetLength = Math.hypot(targetX, targetY);
      if (targetLength > input.maxSpeed && targetLength > EPSILON) {
        targetX *= input.maxSpeed / targetLength;
        targetY *= input.maxSpeed / targetLength;
      }

      input.outputVelocityX[agent] = targetX;
      input.outputVelocityY[agent] = targetY;
      input.outputDesiredSpeed[agent] = desiredSpeed;
      input.outputDensity[agent] = normalizedDensity;
      input.outputMeanVelocityX[agent] = meanVelocityX;
      input.outputMeanVelocityY[agent] = meanVelocityY;
      input.outputLeaderId[agent] = leaderId;
      input.outputLeaderGap[agent] = leaderGap;
      input.outputLeaderSpeed[agent] = leaderId >= 0 ? leaderSpeed : input.maxSpeed;
      input.outputMinimumDistance[agent] = minimumDistance;
    }
  }
}
