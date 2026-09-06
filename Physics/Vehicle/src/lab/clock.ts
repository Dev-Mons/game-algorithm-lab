import { FIXED_DT } from '../physics/vehicle';
/** Wall-clock scheduling only. Physics never receives a variable delta. */
export class FixedClock {
  accumulator = 0;
  droppedTime = 0;
  advance(seconds: number, step: () => void) {
    const accepted = Math.min(Math.max(seconds, 0), 0.1);
    this.droppedTime += Math.max(0, seconds - accepted);
    this.accumulator += accepted;
    let count = 0;
    while (this.accumulator + 1e-10 >= FIXED_DT && count < 12) {
      step(); this.accumulator = Math.max(0, this.accumulator - FIXED_DT); count++;
    }
    return count;
  }
  reset() { this.accumulator = 0; this.droppedTime = 0; }
}
