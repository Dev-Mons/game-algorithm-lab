import type { SurfaceArchitecture } from "./regions";
export type Vec3 = [number, number, number];
export const DIRECTIONS = ["PX", "NX", "PY", "NY", "PZ", "NZ"] as const;
export type Direction = (typeof DIRECTIONS)[number];
export type Role = "wall" | "roof" | "terrace" | "underside";
export const BASES: Record<Direction, { n: Vec3; u: Vec3; v: Vec3 }> = {
  PX: { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  NX: { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  PY: { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  NY: { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  PZ: { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  NZ: { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
};
export const cellId = (c: Vec3): string => `${c[0]},${c[1]},${c[2]}`;
export const compareCells = (a: Vec3, b: Vec3): number =>
  a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
export const add = (a: Vec3, b: Vec3): Vec3 => [
  a[0] + b[0],
  a[1] + b[1],
  a[2] + b[2],
];
export function normalizeGrid(input: unknown): Vec3[] {
  if (!Array.isArray(input))
    throw new Error("Grid must be an array of integer triples.");
  const unique = new Map<string, Vec3>();
  for (const value of input) {
    if (
      !Array.isArray(value) ||
      value.length !== 3 ||
      [0, 1, 2].some(
        (a) => !Number.isInteger(value[a]) || Math.abs(value[a]) > 1_000_000,
      )
    ) {
      throw new Error("Cell coordinates must be integers within ±1,000,000.");
    }
    const c = value.map((n) => (n === 0 ? 0 : n)) as Vec3;
    unique.set(cellId(c), c);
  }
  const cells = [...unique.values()].sort(compareCells);
  if (cells.length) {
    for (let axis = 0; axis < 3; axis++) {
      let min = Infinity,
        max = -Infinity;
      for (const c of cells) {
        min = Math.min(min, c[axis]);
        max = Math.max(max, c[axis]);
      }
      if (max - min + 1 > 32)
        throw new Error(
          "Occupied bounds must be at most 32 cells on each axis.",
        );
    }
  }
  return cells;
}
export interface Surface {
  faceId: string;
  cell: Vec3;
  direction: Direction;
  componentId: string;
  role: Role;
  wallKind?: "regular" | "rooftop";
  undersideKind?: "base" | "overhang";
  architecture?: SurfaceArchitecture;
}
export interface Diagnostic {
  code: string;
  location: string;
  message: string;
}
export interface Feature {
  edgeId: string;
  start: Vec3;
  end: Vec3;
  kind: "convex" | "concave" | "flat" | "unsupported";
  faceIds: string[];
}
export interface Placement {
  /** Derived, fixed complete-face prototype, including accepted mandatory finishes. */
  faceAssetKey?: string;
  /** Reservation/decision IDs for finishes owned by this face; never extra render objects. */
  finishIds?: string[];
  placementId: string;
  tileId: string;
  faceId: string;
  position2: Vec3;
  orientationId: Direction;
  ruleId: string;
}
export function faceCenter2(cell: Vec3, direction: Direction): Vec3 {
  return cell.map((n, axis) => 2 * n + 1 + BASES[direction].n[axis]) as Vec3;
}
export function faceCorners(cell: Vec3, direction: Direction): Vec3[] {
  const center = faceCenter2(cell, direction),
    { u, v } = BASES[direction];
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(
    ([a, b]) =>
      center.map((n, axis) => (n + a * u[axis] + b * v[axis]) / 2) as Vec3,
  );
}
export interface AnalysisComponent {id:string;cells:Vec3[]}
export function analyze(input: unknown,onComponents?:(components:AnalysisComponent[])=>void) {
  const cells = normalizeGrid(input),
    occupied = new Set(cells.map(cellId));
  const exterior = new Set<string>();
  let paddedCells = 0;
  if (cells.length) {
    const min: Vec3 = [Infinity, Infinity, Infinity],
      max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const c of cells)
      for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a], c[a] - 1);
        max[a] = Math.max(max[a], c[a] + 1);
      }
    paddedCells = max.reduce((p, n, a) => p * (n - min[a] + 1), 1);
    const queue: Vec3[] = [min];
    exterior.add(cellId(min));
    for (let i = 0; i < queue.length; i++)
      for (const d of DIRECTIONS) {
        const next = add(queue[i], BASES[d].n),
          id = cellId(next);
        if (
          next.some((n, a) => n < min[a] || n > max[a]) ||
          occupied.has(id) ||
          exterior.has(id)
        )
          continue;
        exterior.add(id);
        queue.push(next);
      }
  }
  const components = new Map<
    string,
    { id: string; minY: number; maxY: number }
  >();
  for (const root of cells) {
    if (components.has(cellId(root))) continue;
    const component = { id: cellId(root), minY: root[1], maxY: root[1] },
      queue = [root];
    components.set(component.id, component);
    for (let i = 0; i < queue.length; i++)
      for (const d of DIRECTIONS) {
        const next = add(queue[i], BASES[d].n),
          id = cellId(next);
        if (!occupied.has(id) || components.has(id)) continue;
        components.set(id, component);
        queue.push(next);
        component.minY = Math.min(component.minY, next[1]);
        component.maxY = Math.max(component.maxY, next[1]);
      }
  }
  if(onComponents){const groups=new Map<string,AnalysisComponent>();for(const c of cells){const owner=components.get(cellId(c))!.id;let part=groups.get(owner);if(!part){part={id:owner,cells:[]};groups.set(owner,part);}part.cells.push(c);}onComponents([...groups.values()]);}
  const surfaces: Surface[] = [];
  // A local roof is sky-exposed in its own column, independent of component height.
  // Covered terraces and walls ending beneath an overhang are not rooftop walls.
  const columnTops = new Map<string, number>();
  for (const [x, y, z] of cells)
    columnTops.set(`${x},${z}`, Math.max(columnTops.get(`${x},${z}`) ?? -Infinity, y));
  for (const cell of cells)
    for (const direction of DIRECTIONS) {
      if (!exterior.has(cellId(add(cell, BASES[direction].n)))) continue;
      const component = components.get(cellId(cell))!;
      surfaces.push({
        faceId: `${cellId(cell)}|${direction}`,
        cell,
        direction,
        componentId: component.id,
        ...(direction !== "PY" && direction !== "NY"
          ? { wallKind: columnTops.get(`${cell[0]},${cell[2]}`) === cell[1]
              ? "rooftop" as const : "regular" as const }
          : {}),
        role:
          direction === "PY"
            ? cell[1] === component.maxY
              ? "roof"
              : "terrace"
            : direction === "NY"
              ? "underside"
              : "wall",
        ...(direction === "NY"
          ? {
              undersideKind:
                cell[1] === component.minY
                  ? ("base" as const)
                  : ("overhang" as const),
            }
          : {}),
      });
    }
  const { features, diagnostics } = analyzeFeatures(surfaces, occupied);
  return {
    status: diagnostics.length ? ("degraded" as const) : ("ok" as const),
    cells,
    surfaces,
    features,
    diagnostics,
    counters: {
      occupiedCells: cells.length,
      paddedCells,
      exteriorAirCells: exterior.size,
      surfaceCount: surfaces.length,
      componentCount: new Set([...components.values()]).size,
    },
  };
}
function analyzeFeatures(surfaces: Surface[], occupied: Set<string>) {
  const edges = new Map<string, { start: Vec3; end: Vec3; faces: Surface[] }>();
  const vertices = new Map<
    string,
    { point: Vec3; faces: Set<string>; edges: Set<string> }
  >();
  for (const face of surfaces) {
    const corners = faceCorners(face.cell, face.direction);
    for (let i = 0; i < 4; i++) {
      const [start, end] = [corners[i], corners[(i + 1) % 4]].sort(
        compareCells,
      );
      const id = `${cellId(start)}:${cellId(end)}`;
      if (!edges.has(id)) edges.set(id, { start, end, faces: [] });
      edges.get(id)!.faces.push(face);
      for (const point of [start, end]) {
        const key = cellId(point);
        if (!vertices.has(key))
          vertices.set(key, { point, faces: new Set(), edges: new Set() });
        vertices.get(key)!.faces.add(face.faceId);
        vertices.get(key)!.edges.add(id);
      }
    }
  }
  const features: Feature[] = [],
    diagnostics: Diagnostic[] = [];
  for (const [edgeId, edge] of [...edges].sort(
    (a, b) =>
      compareCells(a[1].start, b[1].start) || compareCells(a[1].end, b[1].end),
  )) {
    const { start, end, faces } = edge;
    let kind: Feature["kind"] = "unsupported";
    if (faces.length === 2) {
      if (faces[0].direction === faces[1].direction) kind = "flat";
      else {
        const axis = start.findIndex((n, i) => n !== end[i]);
        const other = [0, 1, 2].filter((a) => a !== axis);
        let count = 0;
        for (const a of [-1, 0])
          for (const b of [-1, 0]) {
            const c: Vec3 = [...start];
            c[other[0]] += a;
            c[other[1]] += b;
            if (occupied.has(cellId(c))) count++;
          }
        if (count === 1) kind = "convex";
        if (count === 3) kind = "concave";
      }
    }
    features.push({
      edgeId,
      start,
      end,
      kind,
      faceIds: faces.map((f) => f.faceId),
    });
    if (kind === "unsupported")
      diagnostics.push({
        code: "NON_MANIFOLD_EDGE",
        location: edgeId,
        message:
          "Multiple boundary sheets meet at this edge; using unit faces without corner inference.",
      });
  }
  // A manifold vertex has one connected fan. Only its incident faces and edges are visited.
  for (const [id, vertex] of [...vertices].sort((a, b) =>
    compareCells(a[1].point, b[1].point),
  )) {
    const adjacent = new Map(
      [...vertex.faces].map((f) => [f, new Set<string>()]),
    );
    for (const edgeId of vertex.edges) {
      const faces = edges.get(edgeId)!.faces;
      if (faces.length !== 2) continue;
      adjacent.get(faces[0].faceId)!.add(faces[1].faceId);
      adjacent.get(faces[1].faceId)!.add(faces[0].faceId);
    }
    const queue = [[...vertex.faces][0]],
      seen = new Set(queue);
    for (let i = 0; i < queue.length; i++)
      for (const next of adjacent.get(queue[i])!)
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
    if (seen.size !== vertex.faces.size)
      diagnostics.push({
        code: "NON_MANIFOLD_VERTEX",
        location: id,
        message:
          "Disconnected boundary fans at this vertex; corner inference is unsupported.",
      });
  }
  return { features, diagnostics };
}
