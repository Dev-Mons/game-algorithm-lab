import type { TrayDims } from '../core/config';
import type { BodySnapshot } from '../physics/contracts';
import { trayGeometry } from '../physics/tray-geometry';
import { UniformGrid } from '../physics/uniform-grid';

export interface Dist { median: number; p95: number; mean: number; max: number; n: number }

export function summarize(values: ArrayLike<number>): Dist {
  const n = values.length;
  if (!n) return { median: NaN, p95: NaN, mean: NaN, max: NaN, n: 0 };
  const sorted = Float64Array.from(values).sort();
  let sum = 0;
  for (let i = 0; i < n; i++) sum += sorted[i];
  const at = (q: number) => sorted[Math.min(n - 1, Math.max(0, Math.ceil(q * n) - 1))];
  return { median: at(0.5), p95: at(0.95), mean: sum / n, max: sorted[n - 1], n };
}

/** 고정 크기 링 버퍼(실시간 통계 표시용). */
export class Ring {
  private data: Float64Array; private i = 0; private filled = 0;
  constructor(size: number) { this.data = new Float64Array(size); }
  push(v: number) { this.data[this.i] = v; this.i = (this.i + 1) % this.data.length; this.filled = Math.min(this.filled + 1, this.data.length); }
  summary(): Dist { return summarize(this.data.subarray(0, this.filled)); }
  clear() { this.i = 0; this.filled = 0; }
}

/**
 * 트레이 품질 지표(백엔드 공통, 스냅숏 기반).
 * 같은 층(높이 차가 토큰 두께의 0.8배 미만)에서 원판이 겹친 깊이 비율과 비정상적으로 높이 뜬 토큰 수를 센다.
 * planar 조건은 높이가 시각적 포개짐뿐이므로 높이와 무관하게 수평 겹침을 모두 센다.
 */
export function trayQuality(snap: BodySnapshot, dims: TrayDims, planar: boolean, grid?: UniformGrid) {
  const g = trayGeometry(dims), r = dims.tokenRadius, layer = dims.tokenHalfHeight * 2 * 0.8;
  const index = grid ?? new UniformGrid(-dims.width / 2 - 1, g.zBack - 1, dims.width + 2, dims.depth - g.zBack + 3, r * 2.05);
  index.build(snap.count, snap.a, snap.b);
  const scratch = new Int32Array(256);
  let maxOverlap = 0, overlapped = 0, high = 0, maxHeight = 0;
  for (let i = 0; i < snap.count; i++) {
    if (snap.c[i] > maxHeight) maxHeight = snap.c[i];
    if (snap.c[i] > g.plateHeight + 0.6) high++;
    const n = index.neighbors(snap.a[i], snap.b[i], r * 2, scratch);
    for (let q = 0; q < n; q++) {
      const j = scratch[q];
      if (j <= i || (!planar && Math.abs(snap.c[i] - snap.c[j]) >= layer)) continue;
      const d = Math.hypot(snap.a[i] - snap.a[j], snap.b[i] - snap.b[j]), pen = (2 * r - d) / (2 * r);
      if (pen > 0.2) overlapped++;
      if (pen > maxOverlap) maxOverlap = pen;
    }
  }
  return { maxOverlap, overlappedPairs: overlapped, highTokens: high, maxHeight };
}
