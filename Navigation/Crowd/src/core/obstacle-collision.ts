import { clamp } from './math';
import type { Rect } from './types';

export interface CircleProjection {
  x: number;
  y: number;
  normalX: number;
  normalY: number;
}

export interface SweptCircleSlideOutput {
  x: number;
  y: number;
  /** Instantaneous velocity after the last static contact response. */
  velocityX: number;
  /** Instantaneous velocity after the last static contact response. */
  velocityY: number;
  /** Normal of the last processed contact, or zero when there was no contact. */
  normalX: number;
  /** Normal of the last processed contact, or zero when there was no contact. */
  normalY: number;
  contactCount: number;
  /** True when the input center was not initially valid for the requested clearance. */
  startedOverlapping: boolean;
  /** True when another contact remained after the caller's slide-pass budget. */
  exhausted: boolean;
}

const SWEEP_EPSILON = 1e-10;
const SWEEP_FEATURE_EPSILON = 1e-9;

/**
 * Allocation-free continuous circle integration against world bounds and AABBs.
 *
 * The moving circle is treated as a point swept against each rectangle's exact
 * rounded Minkowski boundary: four offset face segments and four corner arcs.
 * On contact the inward normal velocity is removed, which is the minimum-length
 * velocity change that permits a frictionless slide. Construct one integrator
 * per simulation and reuse both it and the caller-owned output object.
 */
export class SweptCircleStaticIntegrator {
  private hitTime = Number.POSITIVE_INFINITY;
  private hitNormalX = 0;
  private hitNormalY = 0;
  private contactNormalCount = 0;
  private firstNormalX = 0;
  private firstNormalY = 0;
  private secondNormalX = 0;
  private secondNormalY = 0;
  private projectedVelocityX = 0;
  private projectedVelocityY = 0;

  integrate(
    startX: number,
    startY: number,
    velocityX: number,
    velocityY: number,
    deltaTime: number,
    clearance: number,
    worldWidth: number,
    worldHeight: number,
    obstacles: readonly Rect[],
    maxSlidePasses: number,
    out: SweptCircleSlideOutput,
  ): void {
    const radius = Math.max(0, clearance);
    let x = startX;
    let y = startY;
    let vx = velocityX;
    let vy = velocityY;
    let remainingTime = Math.max(0, deltaTime);
    const passLimit = Math.max(0, Math.floor(maxSlidePasses));

    out.x = x;
    out.y = y;
    out.velocityX = vx;
    out.velocityY = vy;
    out.normalX = 0;
    out.normalY = 0;
    out.contactCount = 0;
    out.startedOverlapping = false;
    out.exhausted = false;
    this.contactNormalCount = 0;

    if (!this.isValidStart(x, y, radius, worldWidth, worldHeight, obstacles)) {
      // An inherited invalid state needs an explicit recovery policy. Silently
      // teleporting it to a nearest face would recreate the Phase-C velocity jump
      // this continuous path is designed to avoid.
      out.velocityX = 0;
      out.velocityY = 0;
      out.startedOverlapping = true;
      return;
    }
    if (remainingTime <= SWEEP_EPSILON || Math.hypot(vx, vy) <= SWEEP_EPSILON) return;

    let processedContacts = 0;
    while (remainingTime > SWEEP_EPSILON) {
      const displacementX = vx * remainingTime;
      const displacementY = vy * remainingTime;
      if (Math.hypot(displacementX, displacementY) <= SWEEP_EPSILON) break;

      if (!this.findEarliestHit(
        x,
        y,
        displacementX,
        displacementY,
        radius,
        worldWidth,
        worldHeight,
        obstacles,
      )) {
        x += displacementX;
        y += displacementY;
        remainingTime = 0;
        break;
      }

      if (processedContacts >= passLimit) {
        vx = 0;
        vy = 0;
        out.exhausted = true;
        break;
      }

      const contactTime = clamp(this.hitTime, 0, 1);
      x += displacementX * contactTime;
      y += displacementY * contactTime;
      remainingTime *= 1 - contactTime;
      out.normalX = this.hitNormalX;
      out.normalY = this.hitNormalY;
      out.contactCount += 1;
      processedContacts += 1;

      // A positive TOI means the previous contact point was left behind. A zero
      // TOI can represent a simultaneous corner/wedge constraint, so retain up to
      // two normals and project onto their intersection without order-dependent
      // alternating clips.
      if (contactTime > SWEEP_EPSILON) this.contactNormalCount = 0;
      this.projectContactVelocity(vx, vy, this.hitNormalX, this.hitNormalY);
      vx = this.projectedVelocityX;
      vy = this.projectedVelocityY;
      if (Math.hypot(vx, vy) <= SWEEP_EPSILON) {
        vx = 0;
        vy = 0;
        remainingTime = 0;
        break;
      }
    }

    out.x = x;
    out.y = y;
    out.velocityX = vx;
    out.velocityY = vy;
  }

  private isValidStart(
    x: number,
    y: number,
    radius: number,
    worldWidth: number,
    worldHeight: number,
    obstacles: readonly Rect[],
  ): boolean {
    if (
      !Number.isFinite(x)
      || !Number.isFinite(y)
      || !Number.isFinite(radius)
      || !Number.isFinite(worldWidth)
      || !Number.isFinite(worldHeight)
      || worldWidth < radius * 2
      || worldHeight < radius * 2
      || x < radius - SWEEP_EPSILON
      || y < radius - SWEEP_EPSILON
      || x > worldWidth - radius + SWEEP_EPSILON
      || y > worldHeight - radius + SWEEP_EPSILON
    ) return false;
    for (let obstacleIndex = 0; obstacleIndex < obstacles.length; obstacleIndex += 1) {
      const obstacle = obstacles[obstacleIndex]!;
      if (radius <= SWEEP_EPSILON) {
        if (
          x > obstacle.x + SWEEP_EPSILON
          && x < obstacle.x + obstacle.width - SWEEP_EPSILON
          && y > obstacle.y + SWEEP_EPSILON
          && y < obstacle.y + obstacle.height - SWEEP_EPSILON
        ) return false;
      } else if (circleOverlapsRect(x, y, radius, obstacle)) {
        return false;
      }
    }
    return true;
  }

  private findEarliestHit(
    startX: number,
    startY: number,
    displacementX: number,
    displacementY: number,
    radius: number,
    worldWidth: number,
    worldHeight: number,
    obstacles: readonly Rect[],
  ): boolean {
    this.hitTime = Number.POSITIVE_INFINITY;
    this.hitNormalX = 0;
    this.hitNormalY = 0;

    // World features are considered in a fixed order, followed by obstacle order
    // and feature order. Equal-time contacts therefore have a stable first hit;
    // another simultaneous normal is consumed as a zero-time hit next pass.
    if (displacementX < -SWEEP_EPSILON) {
      this.considerHit((radius - startX) / displacementX, 1, 0, displacementX, displacementY);
    }
    if (displacementX > SWEEP_EPSILON) {
      this.considerHit(
        (worldWidth - radius - startX) / displacementX,
        -1,
        0,
        displacementX,
        displacementY,
      );
    }
    if (displacementY < -SWEEP_EPSILON) {
      this.considerHit((radius - startY) / displacementY, 0, 1, displacementX, displacementY);
    }
    if (displacementY > SWEEP_EPSILON) {
      this.considerHit(
        (worldHeight - radius - startY) / displacementY,
        0,
        -1,
        displacementX,
        displacementY,
      );
    }

    for (let obstacleIndex = 0; obstacleIndex < obstacles.length; obstacleIndex += 1) {
      const obstacle = obstacles[obstacleIndex]!;
      const left = obstacle.x;
      const right = obstacle.x + obstacle.width;
      const top = obstacle.y;
      const bottom = obstacle.y + obstacle.height;

      if (displacementX > SWEEP_EPSILON) {
        const time = (left - radius - startX) / displacementX;
        const contactY = startY + displacementY * time;
        if (contactY >= top - SWEEP_FEATURE_EPSILON && contactY <= bottom + SWEEP_FEATURE_EPSILON) {
          this.considerHit(time, -1, 0, displacementX, displacementY);
        }
      }
      if (displacementX < -SWEEP_EPSILON) {
        const time = (right + radius - startX) / displacementX;
        const contactY = startY + displacementY * time;
        if (contactY >= top - SWEEP_FEATURE_EPSILON && contactY <= bottom + SWEEP_FEATURE_EPSILON) {
          this.considerHit(time, 1, 0, displacementX, displacementY);
        }
      }
      if (displacementY > SWEEP_EPSILON) {
        const time = (top - radius - startY) / displacementY;
        const contactX = startX + displacementX * time;
        if (contactX >= left - SWEEP_FEATURE_EPSILON && contactX <= right + SWEEP_FEATURE_EPSILON) {
          this.considerHit(time, 0, -1, displacementX, displacementY);
        }
      }
      if (displacementY < -SWEEP_EPSILON) {
        const time = (bottom + radius - startY) / displacementY;
        const contactX = startX + displacementX * time;
        if (contactX >= left - SWEEP_FEATURE_EPSILON && contactX <= right + SWEEP_FEATURE_EPSILON) {
          this.considerHit(time, 0, 1, displacementX, displacementY);
        }
      }

      if (radius > SWEEP_EPSILON) {
        this.considerCornerHit(
          startX, startY, displacementX, displacementY, radius, left, top, -1, -1,
        );
        this.considerCornerHit(
          startX, startY, displacementX, displacementY, radius, right, top, 1, -1,
        );
        this.considerCornerHit(
          startX, startY, displacementX, displacementY, radius, left, bottom, -1, 1,
        );
        this.considerCornerHit(
          startX, startY, displacementX, displacementY, radius, right, bottom, 1, 1,
        );
      }
    }
    return Number.isFinite(this.hitTime);
  }

  private considerCornerHit(
    startX: number,
    startY: number,
    displacementX: number,
    displacementY: number,
    radius: number,
    cornerX: number,
    cornerY: number,
    quadrantX: number,
    quadrantY: number,
  ): void {
    const offsetX = startX - cornerX;
    const offsetY = startY - cornerY;
    const squaredSpeed = displacementX * displacementX + displacementY * displacementY;
    if (squaredSpeed <= SWEEP_EPSILON * SWEEP_EPSILON) return;
    const approach = offsetX * displacementX + offsetY * displacementY;
    const distanceTerm = offsetX * offsetX + offsetY * offsetY - radius * radius;
    const discriminant = approach * approach - squaredSpeed * distanceTerm;
    if (discriminant < -SWEEP_EPSILON) return;
    const time = (-approach - Math.sqrt(Math.max(0, discriminant))) / squaredSpeed;
    if (time < -SWEEP_EPSILON || time > 1 + SWEEP_EPSILON) return;
    const contactX = startX + displacementX * time;
    const contactY = startY + displacementY * time;
    if (
      (quadrantX < 0 && contactX > cornerX + SWEEP_FEATURE_EPSILON)
      || (quadrantX > 0 && contactX < cornerX - SWEEP_FEATURE_EPSILON)
      || (quadrantY < 0 && contactY > cornerY + SWEEP_FEATURE_EPSILON)
      || (quadrantY > 0 && contactY < cornerY - SWEEP_FEATURE_EPSILON)
    ) return;
    const normalX = (contactX - cornerX) / radius;
    const normalY = (contactY - cornerY) / radius;
    this.considerHit(time, normalX, normalY, displacementX, displacementY);
  }

  private considerHit(
    time: number,
    normalX: number,
    normalY: number,
    displacementX: number,
    displacementY: number,
  ): void {
    if (
      time < -SWEEP_EPSILON
      || time > 1 + SWEEP_EPSILON
      || displacementX * normalX + displacementY * normalY >= -SWEEP_EPSILON
      || time >= this.hitTime - SWEEP_EPSILON
    ) return;
    this.hitTime = clamp(time, 0, 1);
    this.hitNormalX = normalX;
    this.hitNormalY = normalY;
  }

  private projectContactVelocity(
    velocityX: number,
    velocityY: number,
    normalX: number,
    normalY: number,
  ): void {
    if (this.contactNormalCount === 0) {
      this.firstNormalX = normalX;
      this.firstNormalY = normalY;
      this.contactNormalCount = 1;
      const inward = velocityX * normalX + velocityY * normalY;
      this.projectedVelocityX = inward < 0 ? velocityX - normalX * inward : velocityX;
      this.projectedVelocityY = inward < 0 ? velocityY - normalY * inward : velocityY;
      return;
    }

    const parallel = this.firstNormalX * normalX + this.firstNormalY * normalY;
    if (parallel >= 1 - SWEEP_FEATURE_EPSILON) {
      const inward = velocityX * normalX + velocityY * normalY;
      this.projectedVelocityX = inward < 0 ? velocityX - normalX * inward : velocityX;
      this.projectedVelocityY = inward < 0 ? velocityY - normalY * inward : velocityY;
      return;
    }

    if (this.contactNormalCount >= 2) {
      // More than two independent constraints at exactly the same point are a
      // degenerate static wedge. Zero is the deterministic safe cone vertex.
      if (velocityX * normalX + velocityY * normalY < -SWEEP_EPSILON) {
        this.projectedVelocityX = 0;
        this.projectedVelocityY = 0;
      } else {
        this.projectedVelocityX = velocityX;
        this.projectedVelocityY = velocityY;
      }
      return;
    }

    this.secondNormalX = normalX;
    this.secondNormalY = normalY;
    this.contactNormalCount = 2;
    if (
      velocityX * this.firstNormalX + velocityY * this.firstNormalY >= -SWEEP_EPSILON
      && velocityX * this.secondNormalX + velocityY * this.secondNormalY >= -SWEEP_EPSILON
    ) {
      this.projectedVelocityX = velocityX;
      this.projectedVelocityY = velocityY;
      return;
    }

    let bestX = 0;
    let bestY = 0;
    let bestDeltaSquared = velocityX * velocityX + velocityY * velocityY;
    const firstInward = velocityX * this.firstNormalX + velocityY * this.firstNormalY;
    let candidateX = velocityX - this.firstNormalX * firstInward;
    let candidateY = velocityY - this.firstNormalY * firstInward;
    if (candidateX * this.secondNormalX + candidateY * this.secondNormalY >= -SWEEP_EPSILON) {
      const dx = candidateX - velocityX;
      const dy = candidateY - velocityY;
      const deltaSquared = dx * dx + dy * dy;
      if (deltaSquared < bestDeltaSquared) {
        bestDeltaSquared = deltaSquared;
        bestX = candidateX;
        bestY = candidateY;
      }
    }
    const secondInward = velocityX * this.secondNormalX + velocityY * this.secondNormalY;
    candidateX = velocityX - this.secondNormalX * secondInward;
    candidateY = velocityY - this.secondNormalY * secondInward;
    if (candidateX * this.firstNormalX + candidateY * this.firstNormalY >= -SWEEP_EPSILON) {
      const dx = candidateX - velocityX;
      const dy = candidateY - velocityY;
      const deltaSquared = dx * dx + dy * dy;
      if (deltaSquared < bestDeltaSquared) {
        bestX = candidateX;
        bestY = candidateY;
      }
    }
    this.projectedVelocityX = bestX;
    this.projectedVelocityY = bestY;
  }
}

export function distanceSquaredToRect(x: number, y: number, rect: Rect): number {
  const closestX = clamp(x, rect.x, rect.x + rect.width);
  const closestY = clamp(y, rect.y, rect.y + rect.height);
  const dx = x - closestX;
  const dy = y - closestY;
  return dx * dx + dy * dy;
}

export function circleOverlapsRect(x: number, y: number, radius: number, rect: Rect): boolean {
  return distanceSquaredToRect(x, y, rect) < radius * radius - 1e-10;
}

export function projectCircleOutsideRect(
  x: number,
  y: number,
  clearance: number,
  rect: Rect,
  out: CircleProjection,
): boolean {
  const closestX = clamp(x, rect.x, rect.x + rect.width);
  const closestY = clamp(y, rect.y, rect.y + rect.height);
  const dx = x - closestX;
  const dy = y - closestY;
  const distanceSquared = dx * dx + dy * dy;
  if (distanceSquared >= clearance * clearance - 1e-12) return false;

  if (distanceSquared > 1e-12) {
    const distance = Math.sqrt(distanceSquared);
    out.normalX = dx / distance;
    out.normalY = dy / distance;
    out.x = closestX + out.normalX * clearance;
    out.y = closestY + out.normalY * clearance;
    return true;
  }

  const left = x - rect.x;
  const right = rect.x + rect.width - x;
  const top = y - rect.y;
  const bottom = rect.y + rect.height - y;
  const nearest = Math.min(left, right, top, bottom);
  if (nearest === left) {
    out.x = rect.x - clearance;
    out.y = y;
    out.normalX = -1;
    out.normalY = 0;
  } else if (nearest === right) {
    out.x = rect.x + rect.width + clearance;
    out.y = y;
    out.normalX = 1;
    out.normalY = 0;
  } else if (nearest === top) {
    out.x = x;
    out.y = rect.y - clearance;
    out.normalX = 0;
    out.normalY = -1;
  } else {
    out.x = x;
    out.y = rect.y + rect.height + clearance;
    out.normalX = 0;
    out.normalY = 1;
  }
  return true;
}

export function projectCircleOutsideRectWithinBounds(
  x: number,
  y: number,
  clearance: number,
  rect: Rect,
  worldWidth: number,
  worldHeight: number,
  out: CircleProjection,
): boolean {
  if (!projectCircleOutsideRect(x, y, clearance, rect, out)) return false;
  if (
    out.x >= clearance
    && out.y >= clearance
    && out.x <= worldWidth - clearance
    && out.y <= worldHeight - clearance
  ) return true;

  let bestDistance = Number.POSITIVE_INFINITY;
  let found = false;
  let candidateX = rect.x - clearance;
  let candidateY = clamp(y, rect.y, rect.y + rect.height);
  if (candidateX >= clearance && candidateY >= clearance
    && candidateX <= worldWidth - clearance && candidateY <= worldHeight - clearance) {
    const dx = candidateX - x;
    const dy = candidateY - y;
    bestDistance = dx * dx + dy * dy;
    out.x = candidateX;
    out.y = candidateY;
    out.normalX = -1;
    out.normalY = 0;
    found = true;
  }
  candidateX = rect.x + rect.width + clearance;
  candidateY = clamp(y, rect.y, rect.y + rect.height);
  if (candidateX >= clearance && candidateY >= clearance
    && candidateX <= worldWidth - clearance && candidateY <= worldHeight - clearance) {
    const dx = candidateX - x;
    const dy = candidateY - y;
    const squaredDistance = dx * dx + dy * dy;
    if (squaredDistance < bestDistance) {
      bestDistance = squaredDistance;
      out.x = candidateX;
      out.y = candidateY;
      out.normalX = 1;
      out.normalY = 0;
      found = true;
    }
  }
  candidateX = clamp(x, rect.x, rect.x + rect.width);
  candidateY = rect.y - clearance;
  if (candidateX >= clearance && candidateY >= clearance
    && candidateX <= worldWidth - clearance && candidateY <= worldHeight - clearance) {
    const dx = candidateX - x;
    const dy = candidateY - y;
    const squaredDistance = dx * dx + dy * dy;
    if (squaredDistance < bestDistance) {
      bestDistance = squaredDistance;
      out.x = candidateX;
      out.y = candidateY;
      out.normalX = 0;
      out.normalY = -1;
      found = true;
    }
  }
  candidateX = clamp(x, rect.x, rect.x + rect.width);
  candidateY = rect.y + rect.height + clearance;
  if (candidateX >= clearance && candidateY >= clearance
    && candidateX <= worldWidth - clearance && candidateY <= worldHeight - clearance) {
    const dx = candidateX - x;
    const dy = candidateY - y;
    const squaredDistance = dx * dx + dy * dy;
    if (squaredDistance < bestDistance) {
      out.x = candidateX;
      out.y = candidateY;
      out.normalX = 0;
      out.normalY = 1;
      found = true;
    }
  }
  return found;
}

export function segmentDistanceSquaredToRect(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  rect: Rect,
): number {
  if (segmentIntersectsRect(startX, startY, endX, endY, rect)) return 0;
  let minimum = Math.min(
    distanceSquaredToRect(startX, startY, rect),
    distanceSquaredToRect(endX, endY, rect),
  );
  minimum = Math.min(minimum, pointSegmentDistanceSquared(rect.x, rect.y, startX, startY, endX, endY));
  minimum = Math.min(minimum, pointSegmentDistanceSquared(rect.x + rect.width, rect.y, startX, startY, endX, endY));
  minimum = Math.min(minimum, pointSegmentDistanceSquared(rect.x, rect.y + rect.height, startX, startY, endX, endY));
  minimum = Math.min(minimum, pointSegmentDistanceSquared(rect.x + rect.width, rect.y + rect.height, startX, startY, endX, endY));
  return minimum;
}

function pointSegmentDistanceSquared(
  pointX: number,
  pointY: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): number {
  const dx = endX - startX;
  const dy = endY - startY;
  const squaredLength = dx * dx + dy * dy;
  const amount = squaredLength <= 1e-12
    ? 0
    : clamp(((pointX - startX) * dx + (pointY - startY) * dy) / squaredLength, 0, 1);
  const nearestX = startX + dx * amount;
  const nearestY = startY + dy * amount;
  const offsetX = pointX - nearestX;
  const offsetY = pointY - nearestY;
  return offsetX * offsetX + offsetY * offsetY;
}

function segmentIntersectsRect(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  rect: Rect,
): boolean {
  let minimumTime = 0;
  let maximumTime = 1;
  const dx = endX - startX;
  const dy = endY - startY;
  if (Math.abs(dx) <= 1e-12) {
    if (startX < rect.x || startX > rect.x + rect.width) return false;
  } else {
    const inverse = 1 / dx;
    let near = (rect.x - startX) * inverse;
    let far = (rect.x + rect.width - startX) * inverse;
    if (near > far) {
      const swap = near;
      near = far;
      far = swap;
    }
    minimumTime = Math.max(minimumTime, near);
    maximumTime = Math.min(maximumTime, far);
    if (minimumTime > maximumTime) return false;
  }
  if (Math.abs(dy) <= 1e-12) {
    if (startY < rect.y || startY > rect.y + rect.height) return false;
  } else {
    const inverse = 1 / dy;
    let near = (rect.y - startY) * inverse;
    let far = (rect.y + rect.height - startY) * inverse;
    if (near > far) {
      const swap = near;
      near = far;
      far = swap;
    }
    minimumTime = Math.max(minimumTime, near);
    maximumTime = Math.min(maximumTime, far);
    if (minimumTime > maximumTime) return false;
  }
  return true;
}
