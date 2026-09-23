import { BASES, add, cellId, compareCells, faceCenter2, type Surface, type Vec3 } from './analysis';
import type { VerticalPlan } from './vertical-design';
export function verticalBoundaries(
  walls: readonly Surface[],
  faceBands: VerticalPlan['faceBands'],
): VerticalPlan['boundaries'] {
  const assigned = new Map(faceBands.map((f) => [f.faceId, f]));
  const boundaries = new Map<string, VerticalPlan['boundaries'][number]>();
  const emit = (s: Surface, kind: VerticalPlan['boundaries'][number]['kind'], top: boolean) => {
    const center = faceCenter2(s.cell, s.direction);
    center[1] += top ? 1 : -1;
    let start = center.map((n, i) => n - BASES[s.direction].u[i]) as Vec3,
      end = center.map((n, i) => n + BASES[s.direction].u[i]) as Vec3;
    if (compareCells(start, end) > 0) [start, end] = [end, start];
    const key = `${cellId(start)}|${cellId(end)}`;
    const rank = { 'base-belt': 1, 'crown-belt': 2, 'local-cap': 3 };
    if (!boundaries.has(key) || rank[kind] > rank[boundaries.get(key)!.kind])
      boundaries.set(key, {
        id: `boundary:${key}`,
        hostFaceId: s.faceId,
        kind,
        edgeStart2: start,
        edgeEnd2: end,
      });
  };
  for (const s of walls) {
    const above = `${cellId(add(s.cell, [0, 1, 0]))}|${s.direction}`,
      below = `${cellId(add(s.cell, [0, -1, 0]))}|${s.direction}`;
    if (!assigned.has(above)) emit(s, 'local-cap', true);
    const band = assigned.get(s.faceId)!,
      lower = assigned.get(below);
    if (lower && lower.band !== band.band)
      emit(s, band.band === 'crown' || band.band === 'upper' ? 'crown-belt' : 'base-belt', false);
  }

  return [...boundaries.values()].sort(
    (a, b) => compareCells(a.edgeStart2, b.edgeStart2) || compareCells(a.edgeEnd2, b.edgeEnd2),
  );
}
