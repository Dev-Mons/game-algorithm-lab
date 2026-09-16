import {
  BASES,
  add,
  cellId,
  type Surface,
  type Direction,
  type Placement,
} from "./analysis";
import {
  validateBuildingStyle,
  levelAt,
  type BuildingStyle,
  type LevelDefinition,
  type LevelRole,
  type FacadeKind,
  type FacadePattern,
} from "./building-style";
import type { FaceTrace, SelectionOptions } from "./selection";
import type { VolumeAnalysis } from "./regions";

export interface FacadeTrace {
  styleId: string;
  styleVersion: number;
  level: LevelRole;
  topBoundary: boolean;
  facade: FacadeKind;
  runId: string;
  patternId: string;
  moduleId: string;
  entranceSpan?: number;
  groupId?: string;
  part?: "single" | "left" | "middle" | "right";
  alignment?: string;
  reason: string;
  candidates: { id: string; reason: string; filler?: number }[];
}
interface Run {
  faces: Surface[];
  level: LevelDefinition;
  kind: FacadeKind;
  anchor: number;
  key: string;
}
const dot = (s: Surface, vector: number[]) =>
  s.cell.reduce((n, x, i) => n + x * vector[i], 0);
const horizontal = (s: Surface) => dot(s, BASES[s.direction].u);
const planeKey = (s: Surface) =>
  `${s.componentId}|${s.direction}|${dot(s, BASES[s.direction].n)}`;
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function chooseFacadePattern(
  style: BuildingStyle,
  run: {
    width: number;
    start: number;
    anchor: number;
    level: LevelDefinition;
    kind: FacadeKind;
    direction: Direction;
  },
  forced?: string,
) {
  const modules = new Map(style.modules.map((m) => [m.id, m]));
  const candidates: FacadeTrace["candidates"] = [];
  const fitted: {
    pattern: FacadePattern;
    tokens: string[];
    filler: number;
    prefix: number;
    repeats: number;
  }[] = [];
  for (const id of run.level.patterns) {
    const p = style.patterns.find((p) => p.id === id)!;
    let reason =
      forced && id !== forced
        ? "shared-floor-pattern"
        : !p.roles.includes(run.level.role)
          ? "level-role"
          : !p.facades.includes(run.kind)
            ? "facade-kind"
            : run.width < p.minWidth
              ? "minimum-width"
              : "";
    const keys = [...p.start, ...p.repeat, ...p.end, p.remainder];
    if (
      keys.some(
        (key) =>
          !run.level.moduleSet.includes(key) ||
          !modules.get(key)!.directions.includes(run.direction),
      )
    )
      reason = "module-set-or-direction";
    const prefix = run.level.align
      ? (((run.anchor - run.start) % p.repeat.length) + p.repeat.length) %
        p.repeat.length
      : 0;
    const repeats = Math.min(
      p.maxRepeat,
      Math.floor(
        (run.width - p.start.length - p.end.length - prefix) / p.repeat.length,
      ),
    );
    if (!reason && repeats < p.minRepeat)
      reason = "too-short-for-complete-group";
    if (reason) {
      candidates.push({ id, reason });
      continue;
    }
    const suffix =
      run.width -
      p.start.length -
      p.end.length -
      prefix -
      repeats * p.repeat.length;
    const filler = prefix + suffix;
    fitted.push({
      pattern: p,
      filler,
      prefix,
      repeats,
      tokens: [
        ...p.start,
        ...Array<string>(prefix).fill(p.remainder),
        ...Array.from({ length: repeats }, () => p.repeat).flat(),
        ...Array<string>(suffix).fill(p.remainder),
        ...p.end,
      ],
    });
    candidates.push({
      id,
      filler,
      reason: filler ? "integer-remainder" : "exact-fit",
    });
  }
  fitted.sort(
    (a, b) =>
      Number(a.filler !== 0) - Number(b.filler !== 0) ||
      a.filler - b.filler ||
      b.pattern.priority - a.pattern.priority ||
      cmp(a.pattern.id, b.pattern.id),
  );
  const best = fitted[0];
  for (const c of candidates)
    if (c.id !== best?.pattern.id && c.filler !== undefined)
      c.reason += ":lower-ranked";
  return { best, candidates };
}

export function applyFacadeStyle<
  T extends Omit<VolumeAnalysis, "status"> & {
    status: "ok" | "degraded" | "error";
  } & { traces: FaceTrace[]; placements: Placement[] },
>(base: T, options: SelectionOptions): T {
  if (!options.architecture) return base;
  if (base.rolePolicy !== "region-context-v1" || !options.assembly)
    throw new Error(
      "Building styles require region analysis and module assembly.",
    );
  const style = validateBuildingStyle(options.architecture);
  const defs = new Map(style.modules.map((m) => [m.id, m]));
  const occupied = new Set(base.cells.map(cellId));
  const walls = base.surfaces.filter((s) => s.role === "wall");
  const bounds = new Map<string, { min: number; max: number }>();
  for (const s of base.surfaces) {
    const b = bounds.get(s.componentId) ?? { min: s.cell[1], max: s.cell[1] };
    b.min = Math.min(b.min, s.cell[1]);
    b.max = Math.max(b.max, s.cell[1]);
    bounds.set(s.componentId, b);
  }
  const traceById = new Map(base.traces.map((t) => [t.faceId, t]));
  const placementById = new Map(base.placements.map((p) => [p.faceId, p]));
  const byRow = new Map<string, Surface[]>();
  const anchors = new Map<string, number>();
  for (const s of walls) {
    const region = s.architecture!.regionId;
    anchors.set(
      region,
      Math.min(anchors.get(region) ?? Infinity, horizontal(s)),
    );
    const key = `${region}|${s.cell[1]}|${s.architecture!.topBoundary}`;
    if (!byRow.has(key)) byRow.set(key, []);
    byRow.get(key)!.push(s);
  }
  const raw: Surface[][] = [];
  for (const faces of byRow.values()) {
    faces.sort((a, b) => horizontal(a) - horizontal(b));
    let run: Surface[] = [];
    for (const face of faces) {
      if (run.length && horizontal(face) !== horizontal(run.at(-1)!) + 1) {
        raw.push(run);
        run = [];
      }
      run.push(face);
    }
    if (run.length) raw.push(run);
  }
  // One grounded entrance zone per component. A parity-aware zone may use two cells.
  const front = new Map<string, string>();
  const entries = new Set<string>();
  const entrySpans = new Map<string, number>();
  const eligible = raw
    .map((faces) =>
      faces.filter(
        (s) =>
          bounds.get(s.componentId)!.min === style.groundY &&
          s.cell[1] === style.groundY &&
          !occupied.has(cellId(add(s.cell, [0, -1, 0]))),
      ),
    )
    .filter((r) => r.length)
    .sort(
      (a, b) =>
        b.length - a.length ||
        style.frontOrder.indexOf(a[0].direction) -
          style.frontOrder.indexOf(b[0].direction) ||
        cmp(a[0].faceId, b[0].faceId),
    );
  if (!base.diagnostics.length)
    for (const run of eligible) {
      if (front.has(run[0].componentId)) continue;
      front.set(run[0].componentId, planeKey(run[0]));
      const span =
        style.entranceLayout === "centered-parity" && run.length % 2 === 0
          ? 2
          : 1;
      const first = Math.floor((run.length - span) / 2);
      for (const face of run.slice(first, first + span)) {
        entries.add(face.faceId);
        entrySpans.set(face.faceId, span);
      }
    }
  const corners = new Set(
    base.features
      .filter((e) => e.kind === "convex" && e.start[1] !== e.end[1])
      .flatMap((e) => e.faceIds),
  );
  const assigned = new Set<string>();
  const assign = (
    s: Surface,
    id: string,
    info: Omit<
      FacadeTrace,
      "styleId" | "styleVersion" | "moduleId" | "topBoundary"
    >,
  ) => {
    if (assigned.has(s.faceId))
      throw new Error(`Duplicate facade assignment: ${s.faceId}`);
    assigned.add(s.faceId);
    const mod = defs.get(id)!;
    const trace = traceById.get(s.faceId)!;
    const tileId = `${mod.assetId}.${trace.architecture!.palette}`;
    if (!options.catalog?.some((t) => t.tileId === tileId))
      throw new Error(`Missing facade asset: ${tileId}`);
    const p = placementById.get(s.faceId)!;
    p.tileId = tileId;
    p.ruleId = `building.${info.patternId}`;
    trace.selection = {
      ...trace.selection,
      tileId,
      ruleId: p.ruleId,
      candidateCount: 1,
      candidateIndex: 0,
    };
    trace.rules.forEach((r) => {
      if (r.outcome === "selected") r.outcome = "coverage-owned";
    });
    trace.rules.push({
      ruleId: p.ruleId,
      priority: 600,
      matched: true,
      conditions: [info.reason],
      candidates: [tileId],
      rejected: [],
      outcome: "selected",
    });
    trace.facade = {
      ...info,
      styleId: style.id,
      styleVersion: style.version,
      moduleId: id,
      topBoundary: !!s.architecture?.topBoundary,
      ...(mod.connection ? { part: mod.connection.part } : {}),
    };
  };
  const runs: Run[] = [];
  for (const faces of raw) {
    const s = faces[0],
      b = bounds.get(s.componentId)!;
    const level = levelAt(style, s.cell[1], b.min, b.max);
    const kind = front.get(s.componentId) === planeKey(s) ? "front" : "side";
    const key = `${s.architecture!.regionId}|${s.cell[1]}|${horizontal(s)}`;
    const info = {
      level: level.role,
      facade: kind as FacadeKind,
      runId: key,
      candidates: [],
    };
    let part: Surface[] = [];
    const flush = () => {
      if (part.length)
        runs.push({
          faces: part,
          level,
          kind,
          anchor: anchors.get(s.architecture!.regionId)!,
          key,
        });
      part = [];
    };
    for (const face of faces) {
      const entrance =
        entries.has(face.faceId) &&
        level.moduleSet.includes(style.entrance) &&
        defs.get(style.entrance)!.directions.includes(face.direction);
      const corner =
        faces.length >= style.corner.minRunWidth &&
        corners.has(face.faceId) &&
        level.moduleSet.includes(style.corner.module) &&
        defs.get(style.corner.module)!.directions.includes(face.direction);
      if (base.diagnostics.length || entrance || corner) {
        flush();
        const id = base.diagnostics.length
          ? style.fallback
          : entrance
            ? style.entrance
            : style.corner.module;
        assign(face, id, {
          ...info,
          ...(entrance && style.entranceLayout === "centered-parity"
            ? { entranceSpan: entrySpans.get(face.faceId) }
            : {}),
          patternId: base.diagnostics.length
            ? "fallback"
            : entrance
              ? "entrance"
              : "corner",
          reason: base.diagnostics.length
            ? "unsupported-volume: basic wall"
            : entrance
              ? style.entranceLayout === "centered-parity"
                ? `centered ${entrySpans.get(face.faceId)}-cell entrance zone; equal left/right space; longest grounded run at Y=0`
                : "longest-grounded-front-run at document Y=0"
              : "convex-corner reserved before patterns",
        });
      } else part.push(face);
    }
    flush();
  }
  // Establish the shared plan on the widest actual row, never on an AABB across holes.
  runs.sort(
    (a, b) =>
      b.faces.length - a.faces.length ||
      a.faces[0].cell[1] - b.faces[0].cell[1] ||
      cmp(a.faces[0].faceId, b.faces[0].faceId),
  );
  const shared = new Map<string, { pattern: string; anchor: number }>();
  for (const run of runs) {
    const first = run.faces[0];
    const alignment = run.level.align
      ? `${first.architecture!.regionId}|${run.level.align}|${run.kind}`
      : undefined;
    const plan = alignment ? shared.get(alignment) : undefined;
    const start = horizontal(first);
    const { best, candidates } = chooseFacadePattern(
      style,
      {
        width: run.faces.length,
        start,
        anchor: plan?.anchor ?? start,
        level: run.level,
        kind: run.kind,
        direction: first.direction,
      },
      plan?.pattern,
    );
    if (best && alignment && !plan)
      shared.set(alignment, { pattern: best.pattern.id, anchor: start });
    // Short runs use an allowed single piece from the level, otherwise the wall fallback.
    const single =
      run.level.patterns
        .map((id) => style.patterns.find((p) => p.id === id)!)
        .find(
          (p) =>
            p.roles.includes(run.level.role) &&
            p.facades.includes(run.kind) &&
            run.level.moduleSet.includes(p.remainder) &&
            defs.get(p.remainder)!.directions.includes(first.direction),
        )?.remainder ?? style.fallback;
    const tokens = best?.tokens ?? Array<string>(run.faces.length).fill(single);
    let groupId: string | undefined;
    for (let i = 0; i < tokens.length; i++) {
      const mod = defs.get(tokens[i])!;
      if (mod.connection?.part === "left")
        groupId = `g:${run.faces[i].faceId}:${best!.pattern.id}`;
      const pieceGroup =
        mod.connection && mod.connection.part !== "single"
          ? groupId
          : undefined;
      assign(run.faces[i], mod.id, {
        level: run.level.role,
        facade: run.kind,
        runId: run.key,
        patternId: best?.pattern.id ?? "single-fallback",
        ...(pieceGroup ? { groupId: pieceGroup } : {}),
        ...(alignment ? { alignment } : {}),
        reason: best
          ? best.filler
            ? `integer fit with ${best.filler} single fillers; complete groups only`
            : "exact integer fit; complete groups only"
          : "no complete compatible pattern fits; single/wall fallback",
        candidates,
      });
      if (mod.connection?.part === "right") groupId = undefined;
    }
    if (groupId) throw new Error("Incomplete connection group.");
  }
  if (assigned.size !== walls.length)
    throw new Error("Unassigned facade faces.");
  return base;
}
