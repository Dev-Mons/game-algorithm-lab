import {
  BASES,
  add,
  cellId,
  faceCenter2,
  type Direction,
  type Vec3,
} from "./analysis";
import {
  selectTiles,
  hash33,
  type Palette,
  type SelectionOptions,
} from "./selection";
import { FACADE_MODULE_ASSETS } from "./facade-assets";
import { VILLAGE_CATALOG, VILLAGE_RULES } from "./village";

export const CRAFTED_CATALOG = VILLAGE_CATALOG.map((t) => ({
  ...t,
  tileId: t.tileId.replace("village.", "crafted."),
  assetKey: t.assetKey.replace("village.", "crafted.") as typeof t.assetKey,
  ...(t.assetKey.startsWith("village.") ? { relief16: 2 as const } : {}),
}));
export const CRAFTED_RULES = VILLAGE_RULES.map((r) => ({
  ...r,
  tileIds: r.tileIds.map((id) => id.replace("village.", "crafted.")),
}));
export const MODULE_ASSETS = [
  {
    assetKey: "corner.window",
    coverage: "two-faces",
    bounds16: { min: [-8, -8, -16], max: [10, 8, 2] },
  },
  {
    assetKey: "corner.window-top",
    coverage: "two-faces",
    bounds16: { min: [-8, -8, -16], max: [10, 8, 2] },
  },
  ...["hip-x", "hip-z", "gable-x", "gable-z", "flat"].map((shape) => ({
    assetKey: `roof.${shape}`,
    coverage: "rectangular-region",
    bounds16: { min: [-8, -8, 0], max: [8, 8, 16] },
  })),
  {
    assetKey: "eave.straight",
    coverage: "attachment",
    bounds16: { min: [-8, 0, 0], max: [8, 2, 2] },
  },
  {
    assetKey: "eave.corner",
    coverage: "attachment",
    bounds16: { min: [0, 0, 0], max: [2, 2, 2] },
  },
] as const;
export type ModuleAssetKey = (typeof MODULE_ASSETS)[number]["assetKey"];
export interface ModulePlacement {
  reason?: string;
  clearanceCell?: Vec3;
  moduleId: string;
  assetKey: ModuleAssetKey;
  kind: "structure" | "attachment";
  faceIds: string[];
  hostFaceId: string;
  position2: Vec3;
  orientationId: Direction;
  scale16: Vec3;
  palette: Palette;
  ruleId: string;
}
export type AssembledResult = ReturnType<typeof selectTiles> & {
  modules?: ModulePlacement[];
  counters: ReturnType<typeof selectTiles>["counters"] & {
    moduleCount?: number;
    attachmentCount?: number;
    ownedFaceCount?: number;
  };
};
export function validateAssembly(
  faceIds: string[],
  placements: { faceId: string }[],
  modules: ModulePlacement[],
) {
  const expected = new Set(faceIds),
    owners = new Map<string, number>();
  const claim = (id: string) => owners.set(id, (owners.get(id) ?? 0) + 1);
  placements.forEach((p) => claim(p.faceId));
  for (const m of modules) {
    if (m.kind === "attachment") {
      if (m.faceIds.length)
        throw new Error("Attachments cannot own structural coverage.");
    } else if (!m.faceIds.length)
      throw new Error("Structural modules need coverage.");
    if (!expected.has(m.hostFaceId))
      throw new Error("Module host must be exterior.");
    m.faceIds.forEach(claim);
  }
  for (const id of expected)
    if (owners.get(id) !== 1)
      throw new Error(`Missing or duplicate module coverage: ${id}`);
  for (const id of owners.keys())
    if (!expected.has(id))
      throw new Error(`Non-exterior module coverage: ${id}`);
}
export function assembleModules(
  base: ReturnType<typeof selectTiles>,
  options: SelectionOptions,
): AssembledResult {
  if (!options.assembly) return base;
  if (
    base.rolePolicy !== "region-context-v1" ||
    !["hip", "gable", "flat"].includes(options.assembly)
  )
    throw new Error("Invalid assembly policy.");
  const modules: ModulePlacement[] = [],
    claimed = new Set<string>(),
    traces = base.traces.map((t) => ({
      ...t,
      rules: t.rules.map((r) => ({ ...r })),
    }));
  const traceById = new Map(traces.map((t) => [t.faceId, t]));
  const byId = new Map(base.surfaces.map((s) => [s.faceId, s]));
  const faceOrder = new Map(base.surfaces.map((s, i) => [s.faceId, i]));
  const occupied = new Set(base.cells.map(cellId));
  function own(module: ModulePlacement, reason: string) {
    module.reason = reason;
    for (const id of module.faceIds) {
      if (claimed.has(id)) throw new Error(`Duplicate module proposal: ${id}`);
      claimed.add(id);
      const t = traceById.get(id)!;
      t.rules.forEach((r) => {
        if (r.outcome === "selected") r.outcome = "coverage-owned";
      });
      t.rules.push({
        ruleId: module.ruleId,
        priority: 500,
        matched: true,
        conditions: [reason],
        candidates: [module.assetKey],
        rejected: [],
        outcome: "selected",
      });
      t.assembly = {
        moduleId: module.moduleId,
        assetKey: module.assetKey,
        coverageCount: module.faceIds.length,
        reason,
      };
      t.selection = {
        hash: hash33(options.seed ?? 0, `${id}|${module.ruleId}`),
        ruleId: module.ruleId,
        tileId: module.assetKey,
        candidateCount: 1,
        candidateIndex: 0,
      };
    }
    modules.push(module);
  }
  if (base.status === "ok") {
    for (const region of base.regions ?? []) {
      if (region.direction !== "PY") continue;
      const faces = region.faceIds.map((id) => byId.get(id)!);
      if (!faces.every((s) => s.role === "roof")) continue;
      if (
        !region.rectangular ||
        region.coveredFaceCount ||
        region.tallBoundarySides.length
      ) {
        region.faceIds.forEach(
          (id) =>
            (traceById.get(id)!.assemblyNote =
              "flat-panel: attached, covered or non-rectangular roof"),
        );
        continue;
      }
      const minX = Math.min(...faces.map((s) => s.cell[0])),
        minZ = Math.min(...faces.map((s) => s.cell[2]));
      const width = region.width,
        depth = region.height,
        y = faces[0].cell[1] + 1;
      const assetKey =
        options.assembly === "flat"
          ? "roof.flat"
          : `roof.${options.assembly}-${width >= depth ? "x" : "z"}`;
      const palette = traceById.get(region.faceIds[0])!.architecture!.palette;
      own(
        {
          moduleId: `m:${region.regionId}`,
          assetKey,
          kind: "structure",
          faceIds: [...region.faceIds],
          hostFaceId: region.faceIds[0],
          position2: [minX * 2 + width, y * 2, minZ * 2 + depth],
          orientationId: "PY",
          scale16: [
            width * 16,
            depth * 16,
            options.assembly === "flat"
              ? 2
              : Math.max(8, Math.min(width, depth) * 4),
          ],
          palette,
          ruleId: `assembly.roof.${options.assembly}`,
        },
        "uncovered rectangular roof with no adjoining higher wall",
      );
      const members = new Set(region.faceIds);
      for (const face of faces)
        for (const direction of ["PX", "NX", "PZ", "NZ"] as const) {
          const adjacent = add(face.cell, BASES[direction].n);
          if (members.has(`${cellId(adjacent)}|PY`)) continue;
          if (occupied.has(cellId(add(adjacent, [0, 1, 0])))) continue;
          const center = faceCenter2(face.cell, direction);
          center[1] = y * 2;
          modules.push({
            moduleId: `a:eave:${face.faceId}:${direction}`,
            assetKey: "eave.straight",
            kind: "attachment",
            faceIds: [],
            hostFaceId: face.faceId,
            position2: center,
            orientationId: direction,
            scale16: [16, 16, 16],
            palette,
            ruleId: "attachment.eave",
            reason: "supported roof boundary; adjacent cell is empty",
            clearanceCell: add(adjacent, [0, 1, 0]),
          });
        }
      for (const [dx, dz, direction] of [
        [1, 1, "PZ"],
        [1, -1, "PX"],
        [-1, -1, "NZ"],
        [-1, 1, "NX"],
      ] as const) {
        const x = minX + (dx > 0 ? width : 0),
          z = minZ + (dz > 0 ? depth : 0);
        if (
          occupied.has(
            cellId([x + (dx < 0 ? -1 : 0), y, z + (dz < 0 ? -1 : 0)]),
          )
        )
          continue;
        const hostFaceId = `${x + (dx > 0 ? -1 : 0)},${y - 1},${z + (dz > 0 ? -1 : 0)}|PY`;
        modules.push({
          moduleId: `a:eave-corner:${region.regionId}:${direction}`,
          assetKey: "eave.corner",
          kind: "attachment",
          faceIds: [],
          hostFaceId,
          position2: [x * 2, y * 2, z * 2],
          orientationId: direction,
          scale16: [16, 16, 16],
          palette,
          ruleId: "attachment.eave-corner",
          reason: "joins two perpendicular eaves; diagonal cell is empty",
          clearanceCell: [x + (dx < 0 ? -1 : 0), y, z + (dz < 0 ? -1 : 0)],
        });
      }
    }
    const partner: Partial<Record<Direction, Direction>> = {
      PX: "NZ",
      NX: "PZ",
      PZ: "PX",
      NZ: "NX",
    };
    for (const face of base.surfaces) {
      if (
        face.role !== "wall" ||
        !!traceById.get(face.faceId)?.facade ||
        claimed.has(face.faceId) ||
        face.architecture?.facadeElement !== "window"
      )
        continue;
      const direction = partner[face.direction];
      if (!direction) continue;
      const second = byId.get(`${cellId(face.cell)}|${direction}`);
      if (
        !second ||
        !!traceById.get(second.faceId)?.facade ||
        claimed.has(second.faceId) ||
        second.architecture?.facadeElement !== "window" ||
        second.architecture.topBoundary !== face.architecture.topBoundary
      )
        continue;
      own(
        {
          moduleId: `m:corner:${face.faceId}`,
          assetKey: face.architecture.topBoundary
            ? "corner.window-top"
            : "corner.window",
          kind: "structure",
          faceIds: [face.faceId, second.faceId].sort(
            (a, b) => faceOrder.get(a)! - faceOrder.get(b)!,
          ),
          hostFaceId: face.faceId,
          position2: faceCenter2(face.cell, face.direction),
          orientationId: face.direction,
          scale16: [16, 16, 16],
          palette: traceById.get(face.faceId)!.architecture!.palette,
          ruleId: "assembly.corner",
        },
        "two compatible faces at a convex vertical corner; replaces both wall owners",
      );
    }
  }
  if (options.architecture && base.status === "ok") {
    const trim = options.architecture.modules.find(
      (m) => m.id === options.architecture!.topTrim,
    )!;
    if (!FACADE_MODULE_ASSETS.some((m) => m.assetKey === trim.assetId))
      throw new Error("Unknown facade trim asset.");
    for (const face of base.surfaces) {
      const trace = traceById.get(face.faceId)!;
      if (
        !trace.facade?.topBoundary ||
        !trim.directions.includes(face.direction)
      )
        continue;
      modules.push({
        moduleId: `a:facade-trim:${face.faceId}`,
        assetKey: trim.assetId,
        kind: "attachment",
        faceIds: [],
        hostFaceId: face.faceId,
        position2: faceCenter2(face.cell, face.direction),
        orientationId: face.direction,
        scale16: [16, 16, 16],
        palette: trace.architecture!.palette,
        ruleId: "attachment.facade-trim",
        reason:
          "local exposed upper facade boundary, independent of component top level",
      });
    }
  }
  const placements = base.placements.filter((p) => !claimed.has(p.faceId));
  validateAssembly(
    base.surfaces.map((s) => s.faceId),
    placements,
    modules,
  );
  return {
    ...base,
    placements,
    traces,
    modules,
    counters: {
      ...base.counters,
      ruleEvaluations: base.counters.ruleEvaluations + claimed.size,
      placementCount: placements.length,
      moduleCount: modules.filter((m) => m.kind === "structure").length,
      attachmentCount: modules.filter((m) => m.kind === "attachment").length,
      ownedFaceCount: base.surfaces.length,
    },
  };
}
