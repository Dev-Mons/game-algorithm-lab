export class AgentBuffer {
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly vx: Float64Array;
  readonly vy: Float64Array;
  readonly active: Uint8Array;
  readonly stalledFor: Float64Array;

  constructor(public readonly count: number) {
    this.x = new Float64Array(count);
    this.y = new Float64Array(count);
    this.vx = new Float64Array(count);
    this.vy = new Float64Array(count);
    this.active = new Uint8Array(count);
    this.stalledFor = new Float64Array(count);
  }

  copyFrom(other: AgentBuffer): void {
    this.x.set(other.x);
    this.y.set(other.y);
    this.vx.set(other.vx);
    this.vy.set(other.vy);
    this.active.set(other.active);
    this.stalledFor.set(other.stalledFor);
  }
}
