/**
 * 고정 영역 균일 격자. 카운팅 정렬로 O(n) 재구성하고, 이웃 질의는 주변 셀만 확인한다.
 * 전체 쌍 O(n²) 비교를 피하기 위한 공용 공간 인덱스다.
 */
export class UniformGrid {
  readonly cols: number; readonly rows: number;
  cellStart: Int32Array; items: Int32Array; private cellOf: Int32Array; private fill: Int32Array;
  constructor(readonly minX: number, readonly minY: number, width: number, height: number, readonly cell: number) {
    this.cols = Math.max(1, Math.ceil(width / cell) + 1);
    this.rows = Math.max(1, Math.ceil(height / cell) + 1);
    this.cellStart = new Int32Array(this.cols * this.rows + 1);
    this.fill = new Int32Array(this.cols * this.rows + 1);
    this.items = new Int32Array(64); this.cellOf = new Int32Array(64);
  }
  private cx(x: number) { const c = Math.floor((x - this.minX) / this.cell); return c < 0 ? 0 : c >= this.cols ? this.cols - 1 : c; }
  private cy(y: number) { const c = Math.floor((y - this.minY) / this.cell); return c < 0 ? 0 : c >= this.rows ? this.rows - 1 : c; }

  build(count: number, xs: ArrayLike<number>, ys: ArrayLike<number>) {
    if (this.items.length < count) { this.items = new Int32Array(count * 2); this.cellOf = new Int32Array(count * 2); }
    const start = this.cellStart; start.fill(0);
    for (let i = 0; i < count; i++) { const c = this.cy(ys[i]) * this.cols + this.cx(xs[i]); this.cellOf[i] = c; start[c + 1]++; }
    for (let i = 1; i < start.length; i++) start[i] += start[i - 1];
    this.fill.set(start);
    for (let i = 0; i < count; i++) this.items[this.fill[this.cellOf[i]]++] = i;
  }

  /** (x, y) 주변 radius 범위의 셀에 있는 항목 인덱스를 out에 쓰고 개수를 돌려준다. */
  neighbors(x: number, y: number, radius: number, out: Int32Array): number {
    const x0 = this.cx(x - radius), x1 = this.cx(x + radius), y0 = this.cy(y - radius), y1 = this.cy(y + radius);
    let n = 0;
    for (let gy = y0; gy <= y1; gy++) {
      const row = gy * this.cols;
      for (let gx = x0; gx <= x1; gx++) {
        const c = row + gx;
        for (let k = this.cellStart[c], end = this.cellStart[c + 1]; k < end && n < out.length; k++) out[n++] = this.items[k];
      }
    }
    return n;
  }
}
