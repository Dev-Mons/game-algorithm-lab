import {
  analyze,
  add,
  BASES,
  cellId,
  compareCells,
  faceCorners,
  DIRECTIONS,
  type Direction,
  type Surface,
  type Vec3,type AnalysisComponent,
} from "./analysis";

export type RolePolicy = "component-height-v1" | "region-context-v1";
export type Interpretation =
  | "component-roof"
  | "annex-roof"
  | "terrace"
  | "covered-terrace"
  | "facade"
  | "underside"
  | "unsupported";
export interface SurfaceArchitecture {
  regionId: string;
  interpretation: Interpretation;
  column: number;
  row: number;
  width: number;
  height: number;
  topBoundary: boolean;
  facadeElement: "entry" | "window" | "solid" | "none";
}
export interface SurfaceRegion {
  regionId: string;
  componentId: string;
  direction: Direction;
  faceIds: string[];
  width: number;
  height: number;
  rectangular: boolean;
  coveredFaceCount: number;
  tallBoundarySides: Direction[];
  interpretation: Interpretation;
  boundaryEdges: { start: Vec3; end: Vec3 }[];
}
export type VolumeAnalysis = ReturnType<typeof analyze> & {
  regions?: SurfaceRegion[];
  rolePolicy?: RolePolicy;
  counters: ReturnType<typeof analyze>["counters"] & { regionCount?: number };
};
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const negative = (a: Vec3): Vec3 => a.map((n) => -n) as Vec3;
const faceKey = (c: Vec3, d: Direction) => `${cellId(c)}|${d}`;
const compareFaces = (a: Surface, b: Surface) =>
  compareCells(a.cell, b.cell) ||
  DIRECTIONS.indexOf(a.direction) - DIRECTIONS.indexOf(b.direction);

export function analyzeVolume(
  input: unknown,
  policy: RolePolicy = "component-height-v1",
  onComponents?:(components:AnalysisComponent[])=>void,
): VolumeAnalysis {
  if (policy !== "component-height-v1" && policy !== "region-context-v1")
    throw new Error(`Unsupported role policy: ${policy}`);
  const base = analyze(input,onComponents);
  if (policy === "component-height-v1") return base;
  const surfaces = base.surfaces.map((s) => ({ ...s })),
    byId = new Map(surfaces.map((s) => [s.faceId, s]));
  const occupied = new Set(base.cells.map(cellId)),
    seen = new Set<string>(),
    componentMin = new Map<string, number>();
  const highest = new Map<string, number>();
  for (const c of base.cells) {
    const key = `${c[0]},${c[2]}`;
    highest.set(key, Math.max(highest.get(key) ?? -Infinity, c[1]));
  }
  for (const s of surfaces)
    componentMin.set(
      s.componentId,
      Math.min(componentMin.get(s.componentId) ?? Infinity, s.cell[1]),
    );
  const regions: SurfaceRegion[] = [],
    regionFaces = new Map<string, Surface[]>();
  // A bad contact only invalidates incident faces, not every region/building.
  const unsupportedFaces = new Set(base.features.filter(e=>e.kind==='unsupported').flatMap(e=>e.faceIds));
  const unsupportedVertices = new Set(base.diagnostics.filter(d=>d.code==='NON_MANIFOLD_VERTEX').map(d=>d.location));
  if(unsupportedVertices.size)for(const s of surfaces)
    if(faceCorners(s.cell,s.direction).some(v=>unsupportedVertices.has(cellId(v))))unsupportedFaces.add(s.faceId);
  const edgesByFace = new Map<string, typeof base.features>();
  for (const edge of base.features)
    for (const id of edge.faceIds) {
      if (!edgesByFace.has(id)) edgesByFace.set(id, []);
      edgesByFace.get(id)!.push(edge);
    }
  for (const root of surfaces) {
    if (seen.has(root.faceId)) continue;
    const { u, v } = BASES[root.direction],
      queue = [root];
    const supported = !unsupportedFaces.has(root.faceId);
    seen.add(root.faceId);
    for (let i = 0; i < queue.length; i++)
      for (const step of [u, negative(u), v, negative(v)]) {
        const neighbor = byId.get(
          faceKey(add(queue[i].cell, step), root.direction),
        );
        if (
          !neighbor ||
          neighbor.componentId !== root.componentId ||
          unsupportedFaces.has(neighbor.faceId) !== !supported ||
          seen.has(neighbor.faceId)
        )
          continue;
        seen.add(neighbor.faceId);
        queue.push(neighbor);
      }
    queue.sort(compareFaces);
    const columns = queue.map((s) => dot(s.cell, u)),
      rows = queue.map((s) => dot(s.cell, v));
    const minU = Math.min(...columns),
      minV = Math.min(...rows),
      width = Math.max(...columns) - minU + 1,
      height = Math.max(...rows) - minV + 1;
    const regionId = `r:${root.faceId}`,
      ids = new Set(queue.map((s) => s.faceId));
    const boundary = new Map<string, { start: Vec3; end: Vec3 }>();
    for (const face of queue)
      for (const edge of edgesByFace.get(face.faceId) ?? []) {
        if (edge.faceIds.filter((id) => ids.has(id)).length === 1)
          boundary.set(edge.edgeId, { start: edge.start, end: edge.end });
      }
    const coveredFaceCount =
      root.direction === "PY"
        ? queue.filter(
            (s) => highest.get(`${s.cell[0]},${s.cell[2]}`)! > s.cell[1],
          ).length
        : 0;
    const tallBoundaryCounts = new Map<Direction, number>();
    if (root.direction === "PY")
      for (const face of queue)
        for (const dir of ["PX", "NX", "PZ", "NZ"] as const) {
          const adjacent = add(face.cell, BASES[dir].n);
          if (
            !ids.has(faceKey(adjacent, "PY")) &&
            occupied.has(add(adjacent, [0, 1, 0]).join(","))
          )
            tallBoundaryCounts.set(dir, (tallBoundaryCounts.get(dir) ?? 0) + 1);
        }
    const tallBoundarySides = DIRECTIONS.filter((d) =>
      tallBoundaryCounts.has(d),
    );
    const rectangular = queue.length === width * height;
    const singleSide = tallBoundarySides[0];
    const fullSide =
      singleSide &&
      tallBoundaryCounts.get(singleSide) ===
        (singleSide === "PX" || singleSide === "NX" ? height : width);
    let interpretation: Interpretation =
      root.role === "wall"
        ? "facade"
        : root.role === "underside"
          ? "underside"
          : "terrace";
    if (!supported) interpretation = "unsupported";
    else if (root.direction === "PY") {
      if (coveredFaceCount) interpretation = "covered-terrace";
      else if (queue.every((s) => s.role === "roof"))
        interpretation = "component-roof";
      else if (
        rectangular &&
        width >= 2 &&
        height >= 2 &&
        tallBoundarySides.length === 1 &&
        fullSide
      )
        interpretation = "annex-roof";
      if (
        interpretation === "component-roof" ||
        interpretation === "annex-roof"
      )
        queue.forEach((s) => (s.role = "roof"));
      else queue.forEach((s) => (s.role = "terrace"));
    }
    for (const face of queue)
      face.architecture = {
        regionId,
        interpretation,
        column: dot(face.cell, u) - minU,
        row: dot(face.cell, v) - minV,
        width,
        height,
        topBoundary: !ids.has(faceKey(add(face.cell, v), face.direction)),
        facadeElement: face.role === "wall" && supported ? "window" : "none",
      };
    regions.push({
      regionId,
      componentId: root.componentId,
      direction: root.direction,
      faceIds: queue.map((s) => s.faceId),
      width,
      height,
      rectangular,
      coveredFaceCount,
      tallBoundarySides,
      interpretation,
      boundaryEdges: [...boundary.values()].sort(
        (a, b) => compareCells(a.start, b.start) || compareCells(a.end, b.end),
      ),
    });
    regionFaces.set(regionId, queue);
  }
  return {
    ...base,
    surfaces,
    regions,
    rolePolicy: policy,
    counters: { ...base.counters, regionCount: regions.length },
  };
}
