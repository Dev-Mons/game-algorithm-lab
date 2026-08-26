export class RuntimeMetrics {
  fps = 0;
  averageStepMs = 0;
  maxStepMs = 0;
  private frames = 0;
  private frameWindowStart = 0;
  private totalStepMs = 0;
  private timedSteps = 0;

  frame(now: number): void {
    if (this.frameWindowStart === 0) this.frameWindowStart = now;
    this.frames += 1;
    const elapsed = now - this.frameWindowStart;
    if (elapsed >= 500) {
      this.fps = (this.frames * 1000) / elapsed;
      this.frames = 0;
      this.frameWindowStart = now;
    }
  }

  recordStep(milliseconds: number): void {
    this.totalStepMs += milliseconds;
    this.timedSteps += 1;
    this.averageStepMs = this.totalStepMs / this.timedSteps;
    this.maxStepMs = Math.max(this.maxStepMs, milliseconds);
  }

  reset(): void {
    this.averageStepMs = 0;
    this.maxStepMs = 0;
    this.totalStepMs = 0;
    this.timedSteps = 0;
  }
}
