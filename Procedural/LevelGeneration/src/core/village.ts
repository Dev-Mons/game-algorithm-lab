import { DIRECTIONS, type Role } from "./analysis";
import {
  DEFAULT_CATALOG,
  DEFAULT_RULES,
  PALETTES,
  type Tile,
  type Rule,
} from "./selection";

const wallDirections = ["PX", "NX", "PZ", "NZ"] as const;
const specifications: { name: string; asset: Tile["assetKey"]; role: Role }[] =
  [
    { name: "plaster", asset: "village.plaster", role: "wall" },
    { name: "window", asset: "village.window", role: "wall" },
    { name: "window-top", asset: "village.window-top", role: "wall" },
    { name: "entry", asset: "village.entry", role: "wall" },
    { name: "roof", asset: "village.roof", role: "roof" },
    { name: "paving", asset: "village.paving", role: "terrace" },
    { name: "soffit", asset: "village.soffit", role: "underside" },
  ];
export const VILLAGE_CATALOG: Tile[] = [
  ...DEFAULT_CATALOG,
  ...specifications.flatMap((spec) =>
    PALETTES.map((palette) => ({
      tileId: `village.${spec.name}.${palette}`,
      assetKey: spec.asset,
      palette,
      roles: [spec.role],
      orientationIds:
        spec.role === "wall"
          ? [...wallDirections]
          : spec.role === "underside"
            ? ["NY" as const]
            : ["PY" as const],
      footprint: "unit-face" as const,
      pivot: "face-center" as const,
    })),
  ),
];
const candidates = (name: string) =>
  PALETTES.map((p) => `village.${name}.${p}`);
export const VILLAGE_RULES: Rule[] = [
  ...DEFAULT_RULES,
  {
    ruleId: "facade.entry",
    priority: 400,
    roles: ["wall"],
    orientationIds: [...wallDirections],
    tileIds: candidates("entry"),
    predicate: "entry",
  },
  {
    ruleId: "facade.window-top",
    priority: 300,
    roles: ["wall"],
    orientationIds: [...wallDirections],
    tileIds: candidates("window-top"),
    predicate: "window-top",
  },
  {
    ruleId: "facade.window",
    priority: 200,
    roles: ["wall"],
    orientationIds: [...wallDirections],
    tileIds: candidates("window"),
    predicate: "window",
  },
  ...specifications
    .filter((s) => ["plaster", "roof", "paving", "soffit"].includes(s.name))
    .map((s) => ({
      ruleId: `architecture.${s.name}`,
      priority: 150,
      roles: [s.role],
      orientationIds: [...DIRECTIONS],
      tileIds: candidates(s.name),
      predicate: "supported" as const,
    })),
];
