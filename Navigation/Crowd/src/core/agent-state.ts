export class AgentBuffer {
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly vx: Float64Array;
  readonly vy: Float64Array;
  readonly active: Uint8Array;
  readonly stalledFor: Float64Array;
  readonly avoidanceSide: Int8Array;
  readonly avoidanceHold: Float64Array;
  /** Unit steering heading selected from the previous complete snapshot. */
  readonly intentX: Float64Array;
  readonly intentY: Float64Array;
  /** Previous acceleration is retained only for deterministic smoothness metrics. */
  readonly accelerationX: Float64Array;
  readonly accelerationY: Float64Array;
  readonly adjacentStoppedFor: Float64Array;
  /** 1 = stopped, 2 = moved since the last stop. */
  readonly motionPhase: Uint8Array;

  constructor(public readonly count: number) {
    this.x = new Float64Array(count);
    this.y = new Float64Array(count);
    this.vx = new Float64Array(count);
    this.vy = new Float64Array(count);
    this.active = new Uint8Array(count);
    this.stalledFor = new Float64Array(count);
    this.avoidanceSide = new Int8Array(count);
    this.avoidanceHold = new Float64Array(count);
    this.intentX = new Float64Array(count);
    this.intentY = new Float64Array(count);
    this.accelerationX = new Float64Array(count);
    this.accelerationY = new Float64Array(count);
    this.adjacentStoppedFor = new Float64Array(count);
    this.motionPhase = new Uint8Array(count);
  }

  copyFrom(other: AgentBuffer): void {
    this.x.set(other.x);
    this.y.set(other.y);
    this.vx.set(other.vx);
    this.vy.set(other.vy);
    this.active.set(other.active);
    this.stalledFor.set(other.stalledFor);
    this.avoidanceSide.set(other.avoidanceSide);
    this.avoidanceHold.set(other.avoidanceHold);
    this.intentX.set(other.intentX);
    this.intentY.set(other.intentY);
    this.accelerationX.set(other.accelerationX);
    this.accelerationY.set(other.accelerationY);
    this.adjacentStoppedFor.set(other.adjacentStoppedFor);
    this.motionPhase.set(other.motionPhase);
  }
}
