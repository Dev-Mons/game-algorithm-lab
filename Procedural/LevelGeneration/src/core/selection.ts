import { FACADE_ASSETS, type FacadeAssetKey } from "./facade-assets";
import type { BuildingStyle } from "./building-style";
import type {BuildingContextPlan} from "./environment-contract";
import type {DeepReadonly} from "./rule-spatial-contract";
import { applyFacadeStyle, type FacadeTrace } from "./facade-patterns";
import {
  DIRECTIONS,
  faceCenter2,
  type analyze,
  type Direction,
  type Role,
  type Placement,
  type Diagnostic,
} from "./analysis";
import type {
  RolePolicy,
  SurfaceArchitecture,
  VolumeAnalysis,
} from "./regions";

export const PANEL_ASSETS = [
  ...(Object.keys(FACADE_ASSETS) as FacadeAssetKey[]),
  "crafted.plaster",
  "crafted.roof",
  "crafted.paving",
  "crafted.soffit",
  "unit-panel",
] as const;
export const PALETTES = ["clay", "sage", "sand"] as const;
export type Palette = (typeof PALETTES)[number];

export const ROLES: Role[] = ["wall", "roof", "terrace", "underside"];
export const ascii = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;
export interface Tile {
  relief16?: 2;
  tileId: string;
  assetKey: (typeof PANEL_ASSETS)[number];
  palette?: Palette;
  roles: Role[];
  orientationIds: Direction[];
  footprint: "unit-face";
  pivot: "face-center";
}
export interface Rule {
  ruleId: string;
  priority: number;
  roles: Role[];
  orientationIds: Direction[];
  tileIds: string[];
  predicate?: "supported" | "rooftop-wall" | "regular-wall";
}
export const DEFAULT_CATALOG: Tile[] = ROLES.map((role) => ({
  tileId: `panel.${role}`,
  assetKey: "unit-panel",
  roles: [role],
  orientationIds:
    role === "wall"
      ? ["PX", "NX", "PZ", "NZ"]
      : role === "underside"
        ? ["NY"]
        : ["PY"],
  footprint: "unit-face",
  pivot: "face-center",
}));
DEFAULT_CATALOG.push({
  tileId: "debug.missing",
  assetKey: "unit-panel",
  roles: [...ROLES],
  orientationIds: [...DIRECTIONS],
  footprint: "unit-face",
  pivot: "face-center",
});
export const DEFAULT_RULES: Rule[] = ROLES.map((role) => ({
  ruleId: `role.${role}`,
  priority: 100,
  roles: [role],
  orientationIds: [...DIRECTIONS],
  tileIds: [`panel.${role}`],
}));
export interface SelectionOptions {
  context?: DeepReadonly<BuildingContextPlan>;
  architecture?: BuildingStyle;
  seed?: number;
  catalog?: Tile[];
  rules?: Rule[];
  style?: string;
  rolePolicy?: RolePolicy;
}
export interface RuleTrace {
  ruleId: string;
  priority: number;
  matched: boolean;
  conditions: string[];
  candidates: string[];
  rejected: { tileId: string; reason: string }[];
  outcome:
    | "condition-failed"
    | "no-compatible-tile"
    | "selected"
    | "coverage-owned";
}
export interface FaceTrace {
  facade?: FacadeTrace;
  assembly?: {
    moduleId: string;
    assetKey: string;
    coverageCount: number;
    reason: string;
  };
  assemblyNote?: string;
  faceId: string;
  policy: RolePolicy;
  componentId: string;
  role: Role;
  wallKind?: "regular" | "rooftop";
  direction: Direction;
  undersideKind?: "base" | "overhang";
  architecture?: SurfaceArchitecture & {
    palette: Palette;
    paletteHash: number;
  };
  rules: RuleTrace[];
  fallback: boolean;
  selection: {
    ruleId: string;
    tileId: string;
    hash: number;
    candidateIndex: number;
    candidateCount: number;
  };
}
export function hash33(seed: number, text: string): number {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) h = (h * 33 + text.charCodeAt(i)) >>> 0;
  return h;
}
function validId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9_.:-]+$/.test(id);
}
function validList(values: unknown, allowed: readonly string[]): boolean {
  return (
    Array.isArray(values) &&
    values.length > 0 &&
    new Set(values).size === values.length &&
    values.every((v) => allowed.includes(v))
  );
}
export function validateSelection(options: SelectionOptions) {
  const {
    seed = 0,
    catalog = DEFAULT_CATALOG,
    rules = DEFAULT_RULES,
    style = "unit-panels",
  } = options;
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff)
    throw new Error("Seed must be an unsigned 32-bit integer.");
  if (
    style !== "unit-panels" &&
    style !== "environment-panels"
  )
    throw new Error(`Unsupported style: ${style}`);
  if (!Array.isArray(catalog) || !Array.isArray(rules))
    throw new Error("Catalog and rules must be arrays.");
  const tiles = new Map<string, Tile>(),
    ruleIds = new Set<string>();
  for (const tile of catalog) {
    if (!tile || !validId(tile.tileId) || tiles.has(tile.tileId))
      throw new Error("Invalid or duplicate tile ID.");
    if (
      !PANEL_ASSETS.includes(tile.assetKey) ||
      (tile.assetKey.startsWith("crafted.") && tile.relief16 !== 2) ||
      (tile.palette !== undefined && !PALETTES.includes(tile.palette)) ||
      (tile.assetKey !== "unit-panel" && tile.palette === undefined) ||
      tile.footprint !== "unit-face" ||
      tile.pivot !== "face-center" ||
      !validList(tile.roles, ROLES) ||
      !validList(tile.orientationIds, DIRECTIONS)
    )
      throw new Error(`Invalid unit panel contract: ${tile.tileId}`);
    tiles.set(tile.tileId, tile);
  }
  const fallback = tiles.get("debug.missing");
  if (
    !fallback ||
    !ROLES.every((r) => fallback.roles.includes(r)) ||
    !DIRECTIONS.every((d) => fallback.orientationIds.includes(d))
  )
    throw new Error(
      "Reserved debug.missing must cover every role and orientation.",
    );
  for (const rule of rules) {
    if (
      !rule ||
      !validId(rule.ruleId) ||
      rule.ruleId === "fallback.unit-panel" ||
      ruleIds.has(rule.ruleId)
    )
      throw new Error("Invalid, reserved or duplicate rule ID.");
    if (
      !Number.isSafeInteger(rule.priority) ||
      !validList(rule.roles, ROLES) ||
      !validList(rule.orientationIds, DIRECTIONS) ||
      !Array.isArray(rule.tileIds) ||
      (rule.predicate !== undefined &&
        !["supported", "rooftop-wall", "regular-wall"].includes(
          rule.predicate,
        )) ||
      new Set(rule.tileIds).size !== rule.tileIds.length ||
      rule.tileIds.some((id) => !validId(id) || id === "debug.missing")
    )
      throw new Error(`Invalid rule contract: ${rule.ruleId}`);
    ruleIds.add(rule.ruleId);
  }
  return {
    seed,
    tiles,
    rules: [...rules].sort(
      (a, b) => b.priority - a.priority || ascii(a.ruleId, b.ruleId),
    ),
  };
}
export function validateCoverage(
  faceIds: string[],
  placements: Placement[],
): Diagnostic[] {
  const expected = new Set(faceIds),
    owners = new Map<string, number>(),
    diagnostics: Diagnostic[] = [];
  for (const p of placements)
    owners.set(p.faceId, (owners.get(p.faceId) ?? 0) + 1);
  for (const id of faceIds)
    if (owners.get(id) !== 1)
      diagnostics.push({
        code: owners.has(id) ? "DUPLICATE_COVERAGE" : "MISSING_COVERAGE",
        location: id,
        message: "Each exterior face requires exactly one structural owner.",
      });
  for (const id of [...owners.keys()].sort(ascii))
    if (!expected.has(id))
      diagnostics.push({
        code: "UNEXPECTED_COVERAGE",
        location: id,
        message: "Placement covers a non-exterior face.",
      });
  return diagnostics;
}
export function selectTiles(
  analysis: VolumeAnalysis,
  options: SelectionOptions = {},
) {
  if (
    options.rolePolicy !== undefined &&
    options.rolePolicy !== (analysis.rolePolicy ?? "component-height-v1")
  ) {
    throw new Error(
      "Selection role policy does not match the analyzed volume.",
    );
  }
  if (
    options.style === "environment-panels" &&
    analysis.rolePolicy !== "region-context-v1"
  ) {
    throw new Error("Environment panels require region-context-v1 analysis.");
  }
  const { seed, tiles, rules } = validateSelection(options);
  const traces: FaceTrace[] = [],
    placements: Placement[] = [],
    diagnostics = [...analysis.diagnostics];
  let ruleEvaluations = 0,
    fallbackCount = 0;
  for (const surface of analysis.surfaces) {
    const paletteHash = hash33(seed, `${options.context?.design.anchor.join(',')??surface.componentId}|facade.palette`);
    const palette = options.context?.verticalBands?.profile?.palette??PALETTES[paletteHash % PALETTES.length];
    const evaluations: RuleTrace[] = [];
    let selection: FaceTrace["selection"] | undefined;
    for (const rule of rules) {
      ruleEvaluations++;
      const conditions = [];
      if (!rule.roles.includes(surface.role)) conditions.push("role-mismatch");
      if (!rule.orientationIds.includes(surface.direction))
        conditions.push("orientation-mismatch");
      if (rule.predicate) {
        const context = surface.architecture;
        const supported = context && context.interpretation !== "unsupported";
        const matched = rule.predicate === "supported" ? !!supported
          : surface.wallKind === (rule.predicate === "rooftop-wall" ? "rooftop" : "regular");
        if (!matched)
          conditions.push(`architecture-${rule.predicate}-mismatch`);
      }
      const candidates: string[] = [],
        rejected: RuleTrace["rejected"] = [];
      if (!conditions.length)
        for (const tileId of [...rule.tileIds].sort(ascii)) {
          const tile = tiles.get(tileId);
          const reason = !tile
            ? "tile-not-in-catalog"
            : !tile.roles.includes(surface.role)
              ? "role-mismatch"
              : !tile.orientationIds.includes(surface.direction)
                ? "orientation-mismatch"
                : tile.palette && tile.palette !== palette
                  ? "component-palette-mismatch"
                  : "";
          if (reason) rejected.push({ tileId, reason });
          else candidates.push(tileId);
        }
      const outcome = conditions.length
        ? "condition-failed"
        : !candidates.length
          ? "no-compatible-tile"
          : selection
            ? "coverage-owned"
            : "selected";
      evaluations.push({
        ruleId: rule.ruleId,
        priority: rule.priority,
        matched: !conditions.length,
        conditions: conditions.length
          ? conditions
          : [
              "role-and-orientation-match",
              ...(rule.predicate
                ? [`architecture-${rule.predicate}-match`]
                : []),
            ],
        candidates,
        rejected,
        outcome,
      });
      if (outcome === "selected") {
        const hash = hash33(seed, `${surface.faceId}|${rule.ruleId}`),
          candidateIndex = hash % candidates.length;
        selection = {
          ruleId: rule.ruleId,
          tileId: candidates[candidateIndex],
          hash,
          candidateIndex,
          candidateCount: candidates.length,
        };
      }
    }
    const fallback = !selection;
    if (!selection) {
      fallbackCount++;
      ruleEvaluations++;
      selection = {
        ruleId: "fallback.unit-panel",
        tileId: "debug.missing",
        hash: hash33(seed, `${surface.faceId}|fallback.unit-panel`),
        candidateIndex: 0,
        candidateCount: 1,
      };
      diagnostics.push({
        code: "MISSING_TILE",
        location: surface.faceId,
        message:
          "No compatible rule candidate; reserved debug panel owns this face.",
      });
      evaluations.push({
        ruleId: selection.ruleId,
        priority: Number.MIN_SAFE_INTEGER,
        matched: true,
        conditions: ["all-normal-rules-failed"],
        candidates: ["debug.missing"],
        rejected: [],
        outcome: "selected",
      });
    }
    traces.push({
      faceId: surface.faceId,
      policy: analysis.rolePolicy ?? "component-height-v1",
      componentId: surface.componentId,
      role: surface.role,
      ...(surface.wallKind ? { wallKind: surface.wallKind } : {}),
      direction: surface.direction,
      ...(surface.undersideKind
        ? { undersideKind: surface.undersideKind }
        : {}),
      ...(surface.architecture
        ? { architecture: { ...surface.architecture, palette, paletteHash } }
        : {}),
      rules: evaluations,
      fallback,
      selection,
    });
    placements.push({
      placementId: `p:${surface.faceId}`,
      faceId: surface.faceId,
      tileId: selection.tileId,
      position2: faceCenter2(surface.cell, surface.direction),
      orientationId: surface.direction,
      ruleId: selection.ruleId,
    });
  }
  const coverage = validateCoverage(
    analysis.surfaces.map((s) => s.faceId),
    placements,
  );
  diagnostics.push(...coverage);
  return applyFacadeStyle(
    {
      ...analysis,
      status: coverage.length
        ? ("error" as const)
        : diagnostics.length
          ? ("degraded" as const)
          : ("ok" as const),
      placements,
      traces,
      diagnostics,
      counters: {
        ...analysis.counters,
        ruleEvaluations,
        fallbackCount,
        placementCount: placements.length,
      },
    },
    options,
  );
}
