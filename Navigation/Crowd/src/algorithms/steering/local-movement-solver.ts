import { EPSILON, limit } from '../../core/math';
import type { Vec2 } from '../../core/types';

export interface SteeringInput {
  velocityX: number;
  velocityY: number;
  preferredX: number;
  preferredY: number;
  separationX: number;
  separationY: number;
  alignmentX: number;
  alignmentY: number;
  distanceToGoal: number;
  maxSpeed: number;
  maxAcceleration: number;
  separationWeight: number;
  alignmentWeight: number;
  arrivalSlowRadius: number;
}

export class LocalMovementSolver {
  private readonly desired = { x: 0, y: 0 };

  solve(input: SteeringInput, out: Vec2): void {
    const arrivalScale = Math.min(1, input.distanceToGoal / Math.max(input.arrivalSlowRadius, EPSILON));
    const desiredSpeed = input.maxSpeed * arrivalScale;
    this.desired.x = input.preferredX * desiredSpeed
      + input.separationX * input.separationWeight
      + input.alignmentX * input.alignmentWeight;
    this.desired.y = input.preferredY * desiredSpeed
      + input.separationY * input.separationWeight
      + input.alignmentY * input.alignmentWeight;
    limit(
      this.desired.x - input.velocityX,
      this.desired.y - input.velocityY,
      input.maxAcceleration,
      out,
    );
  }
}
