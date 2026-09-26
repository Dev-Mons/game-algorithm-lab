/** Fixed-capacity storage; allocation and sorting happen only on explicit export. */
export class NumericRing {
  private readonly data: Float64Array;
  private cursor = 0;
  length = 0;
  constructor(readonly capacity = 10000) { this.data = new Float64Array(capacity); }
  push(value: number): void {
    this.data[this.cursor] = value;
    this.cursor = (this.cursor + 1) % this.capacity;
    this.length = Math.min(this.capacity, this.length + 1);
  }
  slice(start = 0): number[] {
    const from = start < 0 ? Math.max(0, this.length + start) : Math.min(start, this.length);
    return Array.from({ length: this.length - from }, (_, i) =>
      this.data[(this.cursor - this.length + from + i + this.capacity) % this.capacity]!);
  }
}

export const FRAME_COLUMNS = ['timeMs', 'tickBefore', 'tickAfter', 'intervalMs', 'cpuMs',
  'simulationMs', 'recorderMs', 'renderMs', 'uiMs', 'debtSeconds', 'droppedSeconds',
  'clampedSeconds', 'steps', 'active', 'direct', 'contact', 'externalState'] as const;

/** Columnar ring: no unbounded per-frame objects in the application loop. */
export class FrameTrace {
  enabled = true;
  private cursor = 0;
  private size = 0;
  private readonly data: Float64Array;
  constructor(readonly capacity = 4096) { this.data = new Float64Array(capacity * FRAME_COLUMNS.length); }
  record(values: readonly number[]): void {
    if (!this.enabled) return;
    this.data.set(values, this.cursor * FRAME_COLUMNS.length);
    this.cursor = (this.cursor + 1) % this.capacity;
    this.size = Math.min(this.capacity, this.size + 1);
  }
  clear(): void { this.cursor = 0; this.size = 0; }
  export() {
    return { columns: FRAME_COLUMNS, capacity: this.capacity, frames: Array.from({length:this.size}, (_, i) => {
      const start = ((this.cursor - this.size + i + this.capacity) % this.capacity) * FRAME_COLUMNS.length;
      return Array.from(this.data.subarray(start, start + FRAME_COLUMNS.length));
    }) };
  }
}
