import type { Surface } from './analysis';
import type { BuildingStyle, FacadeKind } from './building-style';
import type { SelectionOptions } from './selection';
import type { FacadeTrace } from './facade-contract';
import { fitFacadePattern, patternLookup } from './facade-fitting';
import { wallU, wallPlane, wallRowId } from './facade-coordinates';
import type { WallDirection } from './vertical-design';

type Context = NonNullable<SelectionOptions['context']>;
export type FacadeContext = Context & {
  verticalBands: NonNullable<Context['verticalBands']>;
  entrances: NonNullable<Context['entrances']>;
};
export interface FacadeDecision {
  row?: { id: string; kind: FacadeKind };
  patternId: string;
  reason: string;
  candidates: FacadeTrace['candidates'];
  portal?: FacadeContext['entrances']['entrances'][number];
  framePanelId?: string;
}
export interface FacadeAssignment extends FacadeDecision {
  moduleId: string;
  groupId?: string;
}
export interface FacadePatternSection {
  faces: readonly Surface[];
  tokens: readonly string[];
  patternId: string;
  candidates: FacadeTrace['candidates'];
}
export interface FacadeLayout {
  fixed: ReadonlyMap<string, FacadeAssignment>;
  sections: readonly FacadePatternSection[];
}
export interface FacadeLayoutInput {
  style: BuildingStyle;
  context: FacadeContext;
  surfaces: readonly Surface[];
  lookup: ReturnType<typeof patternLookup>;
  family: BuildingStyle['alignedFamilies'][number];
  bands: ReadonlyMap<string, FacadeContext['verticalBands']['faceBands'][number]>;
  caps: ReadonlySet<string>;
  frontages: ReadonlySet<string>;
}
export function facadeKind(face: Surface, frontages: ReadonlySet<string>): FacadeKind {
  return frontages.has(`${face.direction}:${wallPlane(face)}`) ? 'front' : 'side';
}

/** Required owners claim first; later geometric layout can only use open faces. */
function fixedAssignments(
  input: FacadeLayoutInput,
  faces: ReadonlyMap<string, Surface>,
): Map<string, FacadeAssignment> {
  const { style, context } = input;
  const assignments = new Map<string, FacadeAssignment>();
  for (const portal of context.entrances.entrances) {
    for (const [partIndex, faceId] of portal.faceIds.entries()) {
      if (faces.get(faceId)?.role !== 'wall') throw new Error('INVALID_PORTAL_FACE');
      assignments.set(faceId, {
        moduleId: portal.widthCells === 2 ? style.entrancePair[partIndex] : style.entrance,
        patternId: 'entrance',
        reason:
          portal.access === 'road' ? 'validated exterior access' : 'ground entrance; road access unverified',
        candidates: [],
        groupId: portal.id,
        portal,
      });
    }
  }
  for (const change of context.facadeChanges ?? []) {
    if (!faces.has(change.faceId)) continue;
    if (assignments.has(change.faceId)) throw new Error('FACILITY_PORTAL_CONFLICT');
    assignments.set(change.faceId, {
      moduleId: change.moduleId,
      patternId: 'approved-facility-wall',
      reason: 'atomic approved wall request',
      candidates: [],
    });
  }
  for (const column of context.columns?.faces ?? []) {
    if (assignments.has(column.faceId)) throw new Error('COLUMN_FIXED_CONSTRAINT');
    if (faces.get(column.faceId)!.role === 'wall')
      assignments.set(column.faceId, {
        moduleId: column.assetKey,
        patternId: 'column-display',
        reason: 'source occupancy and face ownership retained',
        candidates: [],
      });
  }
  for (const face of context.facadePlan?.faces ?? []) {
    if (assignments.has(face.faceId)) throw new Error('FACADE_FIXED_CONSTRAINT_OVERWRITE');
    assignments.set(face.faceId, {
      moduleId: face.moduleId,
      patternId: 'multi-floor-frame',
      reason: 'complete U/V group',
      candidates: [],
      framePanelId: face.panelId,
    });
  }
  return assignments;
}

function sameSection(a: Surface, b: Surface, input: FacadeLayoutInput): boolean {
  const left = input.bands.get(a.faceId)!,
    right = input.bands.get(b.faceId)!;
  return (
    left.band === right.band &&
    left.rowRole === right.rowRole &&
    a.wallKind === b.wallKind &&
    input.caps.has(a.faceId) === input.caps.has(b.faceId)
  );
}

function planSection(faces: readonly Surface[], input: FacadeLayoutInput): FacadePatternSection {
  const { style, context, lookup, bands, frontages, family } = input;
  const first = faces[0],
    band = bands.get(first.faceId)!.band;
  const result = fitFacadePattern(lookup, {
    width: faces.length,
    start: wallU(first),
    anchor: context.verticalBands.alignment.phaseByDirection[first.direction as WallDirection],
    level: {
      role: band,
      patterns: family.patterns[band],
      moduleSet: style.bands[band].moduleSet,
      align: family.id,
    },
    kind: facadeKind(first, frontages),
    direction: first.direction,
  });
  const tokens = result.best?.tokens ?? Array<string>(faces.length).fill(style.bands[band].fallback);
  return {
    faces,
    tokens,
    patternId: result.best?.pattern.id ?? 'single-fallback',
    candidates: result.candidates,
  };
}

function planPhysicalRun(
  run: readonly Surface[],
  input: FacadeLayoutInput,
  cornerModules: ReadonlyMap<string, string>,
  assignments: Map<string, FacadeAssignment>,
  sections: FacadePatternSection[],
): void {
  if (run.length >= input.style.corner.minRunWidth) {
    for (const face of [run[0], run[run.length - 1]]) {
      if (!assignments.has(face.faceId))
        assignments.set(face.faceId, {
          moduleId: cornerModules.get(input.bands.get(face.faceId)!.band)!,
          patternId: 'corner',
          reason: 'actual run end',
          candidates: [],
        });
    }
  }
  let start = 0;
  while (start < run.length) {
    if (assignments.has(run[start].faceId)) {
      start++;
      continue;
    }
    let end = start + 1;
    while (
      end < run.length &&
      !assignments.has(run[end].faceId) &&
      sameSection(run[end - 1], run[end], input)
    )
      end++;
    sections.push(planSection(run.slice(start, end), input));
    start = end;
  }
}

/** Physical gaps split runs before fixed claims and vertical section changes split patterns. */
export function planFacadeLayout(
  input: FacadeLayoutInput,
  faces: ReadonlyMap<string, Surface>,
): FacadeLayout {
  const assignments = fixedAssignments(input, faces);
  const sections: FacadePatternSection[] = [];
  const cornerModules = new Map(
    Object.entries(input.style.bands).map(([band, definition]) => [
      band,
      definition.moduleSet.find((k) => input.lookup.modules.get(k)?.semantic === 'pier') ??
        input.style.corner.module,
    ]),
  );
  const rows = new Map<string, Surface[]>();
  for (const face of input.surfaces) {
    if (
      face.role !== 'wall' ||
      face.architecture?.interpretation === 'unsupported' ||
      !input.bands.has(face.faceId)
    )
      continue;
    const key = wallRowId(face),
      row = rows.get(key) ?? [];
    row.push(face);
    rows.set(key, row);
  }
  for (const row of rows.values()) {
    row.sort((a, b) => wallU(a) - wallU(b));
    let start = 0;
    for (let end = 1; end <= row.length; end++) {
      if (end < row.length && wallU(row[end]) === wallU(row[end - 1]) + 1) continue;
      planPhysicalRun(row.slice(start, end), input, cornerModules, assignments, sections);
      start = end;
    }
  }
  return { fixed: assignments, sections };
}
