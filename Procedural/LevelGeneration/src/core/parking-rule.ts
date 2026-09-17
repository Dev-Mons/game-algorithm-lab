import { cellId } from "./analysis";
import type { Vec3 } from "./analysis";
import type { ScenePlacement } from "./scene-inputs";
import type { BuildingGenerationRule } from "./building-rule-contract";
import { PARKING_RULE_DEFINITION } from "./rule-spatial-adapters";

// A structural strategy: open decks, columns and parking bays, with no facade shell.
export const PARKING_RULE: BuildingGenerationRule = {
  id: "parking",
  version: "1.0.0",
  label: "개방형 주차장",
  definition: PARKING_RULE_DEFINITION,
  validateMetadata(metadata) {
    if (
      Object.keys(metadata).some((k) => k !== "bayStride") ||
      (metadata.bayStride !== undefined &&
        (!Number.isInteger(metadata.bayStride) ||
          Number(metadata.bayStride) < 1 ||
          Number(metadata.bayStride) > 4))
    )
      throw new Error("Parking bayStride must be an integer from 1 to 4.");
  },
  generate({ componentId, cells, analysis, options, metadata }) {
    const placements: ScenePlacement[] = [];
    const occupied = new Set(cells.map(cellId)),
      stride = Number(metadata.bayStride ?? 2);
    const color =
      options.architecture?.id === "office"
        ? "#7d96a4"
        : options.architecture?.id === "shop"
          ? "#bd997d"
          : "#a2a6a5";
    const make = (
      cell: Vec3,
      asset: string,
      center: Vec3,
      size: Vec3,
      shade = color,
    ) =>
      placements.push({
        id: `${componentId}:${cellId(cell)}:${asset}`,
        kind: "building",
        componentId,
        asset,
        center,
        size,
        color: shade,
        context: "parking@1.0.0",
      });
    for (const cell of cells) {
      const [x, y, z] = cell;
      make(cell, "parking-deck", [x + 0.5, y + 0.06, z + 0.5], [1, 0.12, 1]);
      if (!occupied.has(cellId([x, y + 1, z])))
        make(
          cell,
          "parking-roof-deck",
          [x + 0.5, y + 0.94, z + 0.5],
          [1, 0.12, 1],
        );
      if (x % stride === 0 && z % stride === 0)
        make(
          cell,
          "parking-column",
          [x + 0.12, y + 0.5, z + 0.12],
          [0.12, 0.88, 0.12],
        );
      make(
        cell,
        "parking-bay",
        [x + 0.9, y + 0.125, z + 0.5],
        [0.04, 0.01, 0.75],
        "#f3e8ba",
      );
    }
    return {
      ...analysis,
      status: analysis.diagnostics.length ? "degraded" : "ok",
      placements: [],
      modules: [],
      scenePlacements: placements,
      traces: analysis.surfaces.map((s) => ({
        faceId: s.faceId,
        componentId,
        role: s.role,
        direction: s.direction,
        policy: analysis.rolePolicy ?? "component-height-v1",
        rules: [],
        fallback: false,
        selection: {
          ruleId: "parking",
          tileId: "parking-deck",
          hash: 0,
          candidateIndex: 0,
          candidateCount: 1,
        },
        assemblyNote:
          "Open parking decks replace the facade-shell interpretation.",
      })),
      counters: {
        ...analysis.counters,
        ruleEvaluations: cells.length,
        fallbackCount: 0,
        placementCount: 0,
        moduleCount: 0,
        attachmentCount: 0,
        ownedFaceCount: 0,
      },
    };
  },
};
