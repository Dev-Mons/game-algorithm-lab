/** mulberry32: 시드 재현용 PRNG. 엔진·브라우저 간 물리 결정성까지 보장하지는 않는다. */
export class Rng {
  private state: number;
  constructor(seed: number) { this.state = (seed >>> 0) || 0x9e3779b9; }
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(min: number, max: number) { return min + (max - min) * this.next(); }
  int(n: number) { return Math.floor(this.next() * n); }
}
