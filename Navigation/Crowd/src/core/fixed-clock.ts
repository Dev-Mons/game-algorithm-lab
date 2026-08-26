export class FixedClock {
  private accumulator = 0;
  private lastTime = 0;

  constructor(public readonly fixedDelta: number, private readonly maxFrameDelta = 0.25) {}

  reset(timeSeconds: number): void {
    this.accumulator = 0;
    this.lastTime = timeSeconds;
  }

  consume(timeSeconds: number, speed: number, step: () => void): number {
    if (this.lastTime === 0) this.lastTime = timeSeconds;
    const elapsed = Math.min(this.maxFrameDelta, Math.max(0, timeSeconds - this.lastTime));
    this.lastTime = timeSeconds;
    this.accumulator += elapsed * speed;
    while (this.accumulator >= this.fixedDelta) {
      step();
      this.accumulator -= this.fixedDelta;
    }
    return this.accumulator / this.fixedDelta;
  }
}
