import { cellId, compareCells, partitionNormalizedCells, type Vec3 } from './analysis';
export interface MassPolicy {
  minArea: number;
  minWidth: number;
  minPersistence: number;
  changePermille: number;
}
export interface MassSlice {
  id: string;
  y: number;
  cells: Vec3[];
  parents: string[];
  children: string[];
}
export interface MassEvent {
  from: string;
  to: string;
  overlap: number;
  kind: 'persist' | 'shrink' | 'expand' | 'reshape' | 'split' | 'merge';
  significant: boolean;
  changedArea: number;
}
export interface MassScope {
  id: string;
  role: 'body' | 'podium' | 'tower' | 'annex';
  yMin: number;
  yMaxExclusive: number;
  columns: string[];
  area: number;
}
export interface MassRelations {
  slices: MassSlice[];
  events: MassEvent[];
  spans: { sliceIds: string[]; yMin: number; yMaxExclusive: number }[];
  scopes: MassScope[];
  counters: { cells: number; overlapChecks: number };
}
const steps = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const column = (c: Vec3) => `${c[0]},${c[2]}`;
function islands(cells: Vec3[]) {
  // Both callers group one Y plane first. Six-neighbour partitioning therefore
  // gives exactly the same X/Z islands, without a second string-key BFS.
  return partitionNormalizedCells([...cells].sort(compareCells)).map((part) => part.cells);
}

interface SliceLink {
  from: MassSlice;
  to: MassSlice;
  overlap: number;
}
function indexMass(cells: readonly Vec3[]) {
  const floors = new Map<number, Vec3[]>(),
    tops = new Map<string, Vec3>(),
    bottoms = new Map<string, number>();
  for (const c of cells) {
    const columnId = column(c);
    const row = floors.get(c[1]) ?? [];
    row.push(c);
    floors.set(c[1], row);
    if (!tops.has(columnId) || tops.get(columnId)![1] < c[1]) tops.set(columnId, c);
    bottoms.set(columnId, Math.min(bottoms.get(columnId) ?? Infinity, c[1]));
  }
  return { floors, tops, bottoms };
}
function buildSliceGraph(floors: ReadonlyMap<number, Vec3[]>) {
  const slices: MassSlice[] = [];
  for (const [y, row] of [...floors].sort(([a], [b]) => a - b))
    for (const part of islands(row))
      slices.push({ id: `slice:${cellId(part[0])}`, y, cells: part, parents: [], children: [] });
  const byCell = new Map(slices.flatMap((s) => s.cells.map((c) => [cellId(c), s] as const))),
    links = new Map<string, { from: MassSlice; to: MassSlice; overlap: number }>();
  let overlapChecks = 0;
  for (const s of slices)
    for (const c of s.cells) {
      overlapChecks++;
      const t = byCell.get(cellId([c[0], c[1] + 1, c[2]]));
      if (t) {
        const key = `${s.id}|${t.id}`,
          edge = links.get(key) ?? { from: s, to: t, overlap: 0 };
        edge.overlap++;
        links.set(key, edge);
      }
    }
  for (const { from, to } of links.values()) {
    from.children.push(to.id);
    to.parents.push(from.id);
  }
  const byId = new Map(slices.map((s) => [s.id, s]));
  return { slices, byCell, byId, links, overlapChecks };
}
function footprintWidth(cells: readonly Vec3[]): number {
  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (const [x, , z] of cells) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  return Math.min(maxX - minX + 1, maxZ - minZ + 1);
}

function persistence(slice: MassSlice, byId: ReadonlyMap<string, MassSlice>): number {
  let n = 1,
    current = slice;
  while (current.children.length === 1) {
    const next = byId.get(current.children[0])!;
    if (next.parents.length !== 1 || next.cells.length !== slice.cells.length) break;
    const columns = new Set(next.cells.map(column));
    if (slice.cells.some((c) => !columns.has(column(c)))) break;
    n++;
    current = next;
  }
  return n;
}

function classifyEvents(
  links: ReadonlyMap<string, SliceLink>,
  byId: ReadonlyMap<string, MassSlice>,
  policy: MassPolicy,
): MassEvent[] {
  const events: MassEvent[] = [...links.values()].map(({ from, to, overlap }) => {
    const changedArea = from.cells.length + to.cells.length - 2 * overlap;
    const kind =
      from.children.length > 1
        ? 'split'
        : to.parents.length > 1
          ? 'merge'
          : changedArea === 0
            ? 'persist'
            : overlap === to.cells.length
              ? 'shrink'
              : overlap === from.cells.length
                ? 'expand'
                : 'reshape';
    return {
      from: from.id,
      to: to.id,
      overlap,
      kind,
      changedArea,
      significant:
        kind !== 'persist' &&
        changedArea >= policy.minArea &&
        changedArea * 1000 >= Math.max(from.cells.length, to.cells.length) * policy.changePermille &&
        to.cells.length >= policy.minArea &&
        footprintWidth(to.cells) >= policy.minWidth &&
        persistence(to, byId) >= policy.minPersistence,
    };
  });
  return events;
}
function classifyTowerBranches(
  slices: readonly MassSlice[],
  byId: ReadonlyMap<string, MassSlice>,
  significantLinks: ReadonlySet<string>,
): Map<string, boolean> {
  const towerBranch = new Map<string, boolean>();
  for (const s of slices) {
    const parent = s.parents.length === 1 ? byId.get(s.parents[0]) : undefined;
    towerBranch.set(
      s.id,
      !!parent &&
        (parent.children.length > 1
          ? significantLinks.has(`${parent.id}|${s.id}`)
          : (towerBranch.get(parent.id) ?? false)),
    );
  }
  return towerBranch;
}
function continuousSpans(
  slices: readonly MassSlice[],
  byId: ReadonlyMap<string, MassSlice>,
  significantLinks: ReadonlySet<string>,
): MassRelations['spans'] {
  const spans: MassRelations['spans'] = [],
    seen = new Set<string>();
  for (const slice of slices) {
    if (seen.has(slice.id)) continue;
    const span = { sliceIds: [slice.id], yMin: slice.y, yMaxExclusive: slice.y + 1 };
    let tail = slice;
    seen.add(tail.id);
    while (tail.children.length === 1) {
      const next = byId.get(tail.children[0])!;
      if (next.parents.length !== 1 || significantLinks.has(`${tail.id}|${next.id}`)) break;
      span.sliceIds.push(next.id);
      seen.add(next.id);
      span.yMaxExclusive = next.y + 1;
      tail = next;
    }
    spans.push(span);
  }
  return spans;
}
/** Equal-height roof islands define allocation scopes independently of DAG labels. */
function roofScopes(
  tops: ReadonlyMap<string, Vec3>,
  bottoms: ReadonlyMap<string, number>,
  byCell: ReadonlyMap<string, MassSlice>,
  towerBranch: ReadonlyMap<string, boolean>,
  policy: MassPolicy,
): MassScope[] {
  const topRows = new Map<number, Vec3[]>();
  for (const c of tops.values()) {
    const row = topRows.get(c[1]) ?? [];
    row.push(c);
    topRows.set(c[1], row);
  }
  const scopes: MassScope[] = [];
  const highest = Math.max(...[...tops.values()].map((c) => c[1]));
  for (const [top, row] of [...topRows].sort(([a], [b]) => a - b))
    for (const part of islands(row)) {
      const yMin = Math.min(...part.map((c) => bottoms.get(column(c))!)),
        height = top + 1 - yMin;
      if (
        part.length < policy.minArea ||
        footprintWidth(part) < policy.minWidth ||
        height < policy.minPersistence
      )
        continue;
      const supporting = byCell.get(cellId(part[0]))!,
        upperSides = new Set<number>();
      // A flank annex touches higher mass from one side; a podium/setback wraps it.
      for (const c of part)
        steps.forEach(([dx, dz], i) => {
          if (byCell.has(cellId([c[0] + dx, top + 1, c[2] + dz]))) upperSides.add(i);
        });
      const role =
        upperSides.size >= 2
          ? 'podium'
          : towerBranch.get(supporting.id)
            ? 'tower'
            : top < highest
              ? 'annex'
              : 'body';
      scopes.push({
        id: `mass:${cellId(part[0])}`,
        role,
        yMin,
        yMaxExclusive: top + 1,
        columns: part.map(column).sort(),
        area: part.length,
      });
    }
  return scopes;
}
/** Full DAG, including re-merges. Slice IDs are diagnostics only, never random inputs. */
export function analyzeMass(cells: readonly Vec3[], policy: MassPolicy): MassRelations {
  const { floors, tops, bottoms } = indexMass(cells);
  const { slices, byCell, byId, links, overlapChecks } = buildSliceGraph(floors);
  const events = classifyEvents(links, byId, policy);
  const significantLinks = new Set(
    events.filter((event) => event.significant).map((event) => `${event.from}|${event.to}`),
  );
  const towerBranches = classifyTowerBranches(slices, byId, significantLinks);
  return {
    slices,
    events,
    spans: continuousSpans(slices, byId, significantLinks),
    scopes: roofScopes(tops, bottoms, byCell, towerBranches, policy),
    counters: { cells: cells.length, overlapChecks },
  };
}
