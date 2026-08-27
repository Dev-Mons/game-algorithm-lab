export class FixedClock {
  private accumulator = 0;
  private lastTime = 0;

  constructor(
    public readonly fixedDelta: number,
    private readonly maxFrameDelta = 0.25,
    private readonly maxStepsPerFrame = 4,
  ) {}

  reset(timeSeconds: number): void {
    this.accumulator = 0;
    this.lastTime = timeSeconds;
  }

  consume(timeSeconds: number, speed: number, step: () => void): number {
    if (this.lastTime === 0) this.lastTime = timeSeconds;
    const elapsed = Math.min(this.maxFrameDelta, Math.max(0, timeSeconds - this.lastTime));
    this.lastTime = timeSeconds;
    this.accumulator += elapsed * speed;
    const stepBudget = Math.max(
      1,
      Math.min(this.maxStepsPerFrame, Math.ceil(Math.max(0, speed))),
    );
    let steps = 0;
    while (this.accumulator >= this.fixedDelta && steps < stepBudget) {
      step();
      this.accumulator -= this.fixedDelta;
      steps += 1;
    }
    if (this.accumulator >= this.fixedDelta) {
      // A slow simulation step must not create an ever-growing catch-up loop.
      // Drop whole overdue steps while retaining the interpolation remainder.
      this.accumulator %= this.fixedDelta;
    }
    return this.accumulator / this.fixedDelta;
  }
}
