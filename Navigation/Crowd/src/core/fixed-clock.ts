export class FixedClock {
  private accumulator = 0;
  private lastTime: number | null = null;
  private stepCostMs = 0;
  readonly timing = { wallElapsed: 0, elapsed: 0, simulated: 0, debt: 0, dropped: 0, clamped: 0, steps: 0 };

  constructor(
    public readonly fixedDelta: number,
    private readonly maxFrameDelta = 0.25,
    private readonly maxStepsPerFrame = 4,
    private readonly now: () => number = () => performance.now(),
  ) {}

  reset(timeSeconds: number): void {
    this.accumulator = 0;
    this.lastTime = timeSeconds;
    this.stepCostMs = 0;
    Object.assign(this.timing, { wallElapsed: 0, elapsed: 0, simulated: 0, debt: 0, dropped: 0, clamped: 0, steps: 0 });
  }

  /** Pause excludes wall time while preserving existing debt and diagnostics. */
  suspend(timeSeconds: number): void { this.lastTime = timeSeconds; this.timing.steps = 0; }

  consume(timeSeconds: number, speed: number, step: () => void | boolean, budgetMs = 8): number {
    this.lastTime ??= timeSeconds;
    const rawElapsed = Math.max(0, timeSeconds - this.lastTime);
    const rate = Number.isFinite(speed) ? Math.max(0, speed) : 0;
    const elapsed = Math.min(this.maxFrameDelta, rawElapsed) * rate;
    this.lastTime = timeSeconds;
    this.timing.wallElapsed += rawElapsed;
    this.timing.elapsed += rawElapsed * rate;
    this.timing.clamped += (rawElapsed * rate - elapsed);
    this.accumulator += elapsed;
    // Retain a bounded debt, including sub-tick jitter. Account for every second
    // removed; never hide overload in the interpolation remainder.
    const maximumDebt = Math.max(this.fixedDelta, this.maxFrameDelta * Math.max(1, rate));
    if (this.accumulator > maximumDebt) {
      this.timing.dropped += this.accumulator - maximumDebt;
      this.accumulator = maximumDebt;
    }
    let steps = 0;
    const started = this.now();
    while (this.accumulator + 1e-12 >= this.fixedDelta && steps < this.maxStepsPerFrame && rate > 0) {
      // Always permit one due tick. Catch up only if recent cost fits the remaining
      // CPU budget, so heavy 10K steps do not multiply into a longer frame.
      if (steps > 0 && this.now() - started + this.stepCostMs > budgetMs) break;
      const before = this.now();
      if (step() === false) break;
      const cost = this.now() - before;
      this.stepCostMs = Math.max(cost, this.stepCostMs * .9);
      this.accumulator -= this.fixedDelta;
      if (this.accumulator < 0) this.accumulator = 0;
      this.timing.simulated += this.fixedDelta;
      steps += 1;
    }
    this.timing.steps = steps;
    this.timing.debt = this.accumulator;
    return Math.min(1, this.accumulator / this.fixedDelta);
  }
}
