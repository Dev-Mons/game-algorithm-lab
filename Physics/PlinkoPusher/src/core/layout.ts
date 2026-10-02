import type { BoardDims, PegKind, PegSetup } from './config';

export interface Peg { index: number; u: number; v: number; row: number; col: number; kind: PegKind; level: number }
export interface BoardLayout { dims: BoardDims; pegs: Peg[]; index: PegIndex; spacingU: number; spacingV: number }

/**
 * 지그재그 페그 배치. 짝수 행은 cols개, 홀수 행은 cols-1개를 반 칸 어긋나게 둔다.
 * 측면 벽과의 틈이 원석 지름보다 좁아 끼일 수 있는 가장자리 페그는 두지 않는다.
 */
export function buildBoardLayout(dims: BoardDims, setup: PegSetup): BoardLayout {
  const pegs: Peg[] = [];
  const sx = dims.width / dims.cols;
  const sy = (dims.height - dims.topMargin - dims.bottomMargin) / Math.max(1, dims.rows - 1);
  const safeGap = (u: number) => Math.min(u, dims.width - u) - dims.pegRadius >= dims.itemRadius * 2 * 1.15;
  for (let row = 0; row < dims.rows; row++) {
    const odd = row % 2 === 1, slots = odd ? dims.cols - 1 : dims.cols;
    const us = Array.from({ length: slots }, (_, c) => (odd ? sx * (c + 1) : sx * (c + 0.5))).filter(safeGap);
    us.forEach((u, col) => pegs.push({ index: pegs.length, u, v: dims.topMargin + row * sy, row, col, kind: pegKindFor(setup.pattern, row, col, us.length, dims.rows), level: setup.level }));
  }
  return { dims, pegs, index: new PegIndex(pegs, dims, Math.max(sx, sy)), spacingU: sx, spacingV: sy };
}

function pegKindFor(pattern: PegSetup['pattern'], row: number, col: number, count: number, rows: number): PegKind {
  if (pattern === 'basic') return 'basic';
  const centre = Math.abs(col - (count - 1) / 2) <= 1;
  if (pattern === 'byproduct') return (row + col) % 2 === 0 ? 'splitter' : 'basic';
  // mixed: 중앙 열 일부는 정련, 가장자리 열과 하단 몇 줄은 분리
  if (centre && row % 3 === 1) return 'refiner';
  if ((col === 0 || col === count - 1) && row % 2 === 0) return 'splitter';
  if (row >= rows - 2 && col % 3 === 1) return 'splitter';
  return 'basic';
}

/** 페그 종류 패턴과 레벨을 기존 배치에 다시 적용한다(위치는 그대로). */
export function applyPegSetup(layout: BoardLayout, setup: PegSetup) {
  const rows = new Map<number, number>();
  for (const p of layout.pegs) rows.set(p.row, (rows.get(p.row) ?? 0) + 1);
  for (const p of layout.pegs) { p.kind = pegKindFor(setup.pattern, p.row, p.col, rows.get(p.row)!, layout.dims.rows); p.level = setup.level; }
}

/** 정적 페그용 균일 격자 인덱스. 반경 질의는 주변 셀만 확인한다. */
export class PegIndex {
  readonly cell: number; readonly cols: number; readonly rows: number;
  private readonly start: Int32Array; private readonly items: Int32Array;
  constructor(private readonly pegs: Peg[], dims: BoardDims, cell: number) {
    this.cell = cell;
    this.cols = Math.max(1, Math.ceil(dims.width / cell) + 1);
    this.rows = Math.max(1, Math.ceil(dims.height / cell) + 1);
    const counts = new Int32Array(this.cols * this.rows + 1);
    const cellOf = pegs.map(p => this.cellIndex(p.u, p.v));
    for (const c of cellOf) counts[c + 1]++;
    for (let i = 1; i < counts.length; i++) counts[i] += counts[i - 1];
    this.start = counts.slice();
    this.items = new Int32Array(pegs.length);
    const fill = counts.slice();
    cellOf.forEach((c, i) => { this.items[fill[c]++] = i; });
  }
  private cellIndex(u: number, v: number) {
    const cx = Math.min(this.cols - 1, Math.max(0, Math.floor(u / this.cell)));
    const cy = Math.min(this.rows - 1, Math.max(0, Math.floor(v / this.cell)));
    return cy * this.cols + cx;
  }
  /** (u, v) 반경 radius 안에 들어올 수 있는 페그 인덱스를 콜백으로 전달한다. */
  query(u: number, v: number, radius: number, visit: (pegIndex: number) => void) {
    const x0 = Math.max(0, Math.floor((u - radius) / this.cell)), x1 = Math.min(this.cols - 1, Math.floor((u + radius) / this.cell));
    const y0 = Math.max(0, Math.floor((v - radius) / this.cell)), y1 = Math.min(this.rows - 1, Math.floor((v + radius) / this.cell));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const c = y * this.cols + x;
      for (let k = this.start[c]; k < this.start[c + 1]; k++) visit(this.items[k]);
    }
  }
  get size() { return this.pegs.length; }
}

/** 로컬 좌표 (u, v)에서 가장 가까운 페그. 페그 반경 + tolerance 밖이면 null. */
export function pickPeg(layout: BoardLayout, u: number, v: number, tolerance = 0.25): Peg | null {
  const limit = layout.dims.pegRadius + tolerance;
  let best: Peg | null = null, bestD = limit;
  layout.index.query(u, v, limit, i => {
    const p = layout.pegs[i], d = Math.hypot(p.u - u, p.v - v);
    if (d <= bestD) { bestD = d; best = p; }
  });
  return best;
}
