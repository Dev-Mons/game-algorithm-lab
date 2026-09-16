import { FACADE_ASSETS, type FacadeAssetKey } from "./facade-assets";
import type { Direction } from "./analysis";

export type LevelRole = "ground" | "middle" | "top";
export type FacadeKind = "front" | "side";
export interface BuildingModule {
  id: string;
  assetId: FacadeAssetKey;
  semantic: "wall" | "window" | "entrance" | "pier" | "corner" | "trim";
  width: number;
  height: number;
  directions: Direction[];
  connection?: { family: string; part: "single" | "left" | "middle" | "right" };
}
export interface FacadePattern {
  id: string;
  start: string[];
  repeat: string[];
  end: string[];
  minRepeat: number;
  maxRepeat: number;
  roles: LevelRole[];
  facades: FacadeKind[];
  minWidth: number;
  priority: number;
  remainder: string;
}
export interface LevelDefinition {
  role: LevelRole;
  count: number | "remaining";
  moduleSet: string[];
  patterns: string[];
  // Levels sharing this key use one pattern ID and horizontal anchor per region.
  align?: string;
}
export interface BuildingStyle {
  id: string;
  version: number;
  label: string;
  modules: BuildingModule[];
  patterns: FacadePattern[];
  levels: LevelDefinition[];
  singleStorey: LevelRole;
  fallback: string;
  entrance: string;
  entranceLayout?: "single-center" | "centered-parity";
  corner: { module: string; minRunWidth: number };
  topTrim: string;
  frontOrder: Direction[];
  groundY: 0;
}
const walls: Direction[] = ["PX", "NX", "PZ", "NZ"];
const m = (
  id: string,
  assetId: FacadeAssetKey,
  semantic: BuildingModule["semantic"],
  connection?: BuildingModule["connection"],
): BuildingModule => ({
  id,
  assetId,
  semantic,
  width: 1,
  height: 1,
  directions: [...walls],
  ...(connection ? { connection } : {}),
});
const moduleFamily = (family: "window" | "shop" | "office") =>
  ["single", "left", "right"].map((part) =>
    m(
      `${family}-${part}`,
      `facade.${family}-${part}` as FacadeAssetKey,
      "window",
      { family, part: part as "single" | "left" | "right" },
    ),
  );
const modules = [
  m("wall", "facade.wall", "wall"),
  ...moduleFamily("window"),
  ...moduleFamily("shop"),
  ...moduleFamily("office"),
  m("entry", "facade.shop-entry", "entrance"),
  m("lobby", "facade.lobby-entry", "entrance"),
  m("pier", "facade.pier", "pier"),
  m("office-pier", "facade.office-pier", "pier"),
  m("corner", "facade.corner", "corner"),
  m("cornice", "facade.cornice", "trim"),
  m("cap", "facade.cap", "trim"),
];
function pattern(
  id: string,
  repeat: string[],
  roles: LevelRole[],
  priority: number,
  remainder: string,
  start: string[] = [],
  end: string[] = [],
  facades: FacadeKind[] = ["front", "side"],
): FacadePattern {
  return {
    id,
    repeat,
    roles,
    priority,
    remainder,
    start,
    end,
    facades,
    minRepeat: 1,
    maxRepeat: 32,
    minWidth: 1,
  };
}
function style(
  id: string,
  label: string,
  patterns: FacadePattern[],
  ground: string[],
  upper: string[],
  entrance: string,
  corner: string,
  trim: string,
): BuildingStyle {
  const moduleSet = (ids: string[]) => [
    ...new Set([
      "wall",
      entrance,
      corner,
      trim,
      ...patterns
        .filter((p) => ids.includes(p.id))
        .flatMap((p) => [...p.start, ...p.repeat, ...p.end, p.remainder]),
    ]),
  ];
  return {
    id,
    version: 1,
    label,
    modules: JSON.parse(JSON.stringify(modules)) as BuildingModule[],
    patterns,
    levels: [
      {
        role: "ground",
        count: 1,
        moduleSet: moduleSet(ground),
        patterns: ground,
      },
      {
        role: "middle",
        count: "remaining",
        moduleSet: moduleSet(upper),
        patterns: upper,
        align: "upper",
      },
      {
        role: "top",
        count: 1,
        moduleSet: moduleSet(upper),
        patterns: upper,
        align: "upper",
      },
    ],
    singleStorey: "ground",
    fallback: "wall",
    entrance,
    corner: { module: corner, minRunWidth: 4 },
    topTrim: trim,
    frontOrder: ["PZ", "PX", "NZ", "NX"],
    groundY: 0,
  };
}
export const SHOP_STYLE_V1 = style(
  "shop",
  "상가형 · 프로젝트 예시",
  [
    pattern(
      "shopfront",
      ["shop-left", "shop-right"],
      ["ground"],
      100,
      "shop-single",
      [],
      [],
      ["front"],
    ),
    pattern(
      "ground-side",
      ["window-single", "pier"],
      ["ground"],
      70,
      "window-single",
      [],
      [],
      ["side"],
    ),
    pattern(
      "shop-rhythm",
      ["window-left", "window-right", "pier"],
      ["middle", "top"],
      100,
      "window-single",
    ),
    pattern(
      "shop-framed",
      ["window-left", "window-right"],
      ["middle", "top"],
      80,
      "window-single",
      ["pier"],
      ["pier"],
    ),
    pattern(
      "shop-pair",
      ["window-left", "window-right"],
      ["middle", "top"],
      50,
      "window-single",
    ),
  ],
  ["shopfront", "ground-side"],
  ["shop-rhythm", "shop-framed", "shop-pair"],
  "entry",
  "corner",
  "cornice",
);
export const OFFICE_STYLE_V1 = style(
  "office",
  "업무형 · 프로젝트 예시",
  [
    pattern(
      "lobby-glazing",
      ["office-left", "office-right"],
      ["ground"],
      100,
      "office-single",
      [],
      [],
      ["front"],
    ),
    pattern(
      "office-ground-side",
      ["office-single"],
      ["ground"],
      70,
      "office-single",
      [],
      [],
      ["side"],
    ),
    pattern(
      "office-pairs",
      ["office-left", "office-right"],
      ["middle", "top"],
      100,
      "office-single",
    ),
    pattern(
      "office-bays",
      [
        "office-left",
        "office-right",
        "office-left",
        "office-right",
        "office-pier",
      ],
      ["middle", "top"],
      80,
      "office-single",
    ),
  ],
  ["lobby-glazing", "office-ground-side"],
  ["office-pairs", "office-bays"],
  "lobby",
  "office-pier",
  "cap",
);

// V2 keeps the two ends distinct and fills the middle symmetrically.
// The facade interpreter reserves end columns first, so these patterns describe
// only the interior: OO…OO for even widths, OX…OXO for odd widths.
function symmetricStyle(
  base: BuildingStyle,
  window: "window" | "office",
  storefront: "shop" | "office",
  pier: string,
): BuildingStyle {
  const pair = (
    id: string,
    family: string,
    roles: LevelRole[],
    facades: FacadeKind[],
  ) =>
    pattern(
      id,
      [`${family}-left`, `${family}-right`],
      roles,
      100,
      `${family}-single`,
      [],
      [],
      facades,
    );
  const alternating = (
    id: string,
    family: string,
    roles: LevelRole[],
    facades: FacadeKind[],
  ) =>
    pattern(
      id,
      [`${family}-single`, pier],
      roles,
      90,
      `${family}-single`,
      [],
      [`${family}-single`],
      facades,
    );
  const front = `${base.id}-ground-pairs`,
    frontOdd = `${base.id}-ground-alternate`;
  const side = `${base.id}-side-pairs`,
    sideOdd = `${base.id}-side-alternate`;
  const upper = base.id === "shop" ? "shop-pair" : "office-pairs";
  const upperOdd = `${base.id}-alternate`;
  const result = style(
    base.id,
    base.label,
    [
      pair(front, storefront, ["ground"], ["front"]),
      alternating(frontOdd, storefront, ["ground"], ["front"]),
      pair(side, window, ["ground"], ["side"]),
      alternating(sideOdd, window, ["ground"], ["side"]),
      pair(upper, window, ["middle", "top"], ["front", "side"]),
      alternating(upperOdd, window, ["middle", "top"], ["front", "side"]),
    ],
    [front, frontOdd, side, sideOdd],
    [upper, upperOdd],
    base.entrance,
    base.corner.module,
    base.topTrim,
  );
  result.version = 2;
  result.corner.minRunWidth = 3;
  return result;
}
export const SHOP_STYLE_V2 = symmetricStyle(
  SHOP_STYLE_V1,
  "window",
  "shop",
  "pier",
);
export const OFFICE_STYLE_V2 = symmetricStyle(
  OFFICE_STYLE_V1,
  "office",
  "office",
  "office-pier",
);
// Optional policy preserves the embedded v1/v2 definitions without migration.
export const SHOP_STYLE: BuildingStyle = {
  ...SHOP_STYLE_V2,
  version: 3,
  entranceLayout: "centered-parity",
};
export const OFFICE_STYLE: BuildingStyle = {
  ...OFFICE_STYLE_V2,
  version: 3,
  entranceLayout: "centered-parity",
};

export function validateBuildingStyle(style: BuildingStyle) {
  const fail = () => {
    throw new Error("Invalid building style definition or unsupported rule.");
  };
  const id = (s: unknown) =>
    typeof s === "string" && /^[a-zA-Z0-9_.:-]+$/.test(s);
  if (
    !style ||
    !id(style.id) ||
    !Number.isSafeInteger(style.version) ||
    style.version < 1 ||
    typeof style.label !== "string" ||
    style.label.length > 120 ||
    style.groundY !== 0 ||
    (style.entranceLayout !== undefined &&
      !["single-center", "centered-parity"].includes(style.entranceLayout)) ||
    !Array.isArray(style.modules) ||
    !Array.isArray(style.patterns) ||
    !Array.isArray(style.levels) ||
    style.modules.length > 100 ||
    style.patterns.length > 100
  )
    fail();
  const defs = new Map<string, BuildingModule>();
  for (const mod of style.modules) {
    if (
      !mod ||
      !id(mod.id) ||
      defs.has(mod.id) ||
      !Object.hasOwn(FACADE_ASSETS, mod.assetId) ||
      mod.width !== 1 ||
      mod.height !== 1 ||
      !["wall", "window", "entrance", "pier", "corner", "trim"].includes(
        mod.semantic,
      ) ||
      !Array.isArray(mod.directions) ||
      !mod.directions.length ||
      mod.directions.some((d) => !walls.includes(d))
    )
      fail();
    if (
      mod.connection &&
      (!id(mod.connection.family) ||
        !["single", "left", "middle", "right"].includes(mod.connection.part))
    )
      fail();
    const asset = FACADE_ASSETS[mod.assetId];
    if (
      (mod.semantic === "trim") !==
      (mod.assetId === "facade.cornice" || mod.assetId === "facade.cap")
    )
      fail();
    const opening = "opening" in asset ? asset.opening : undefined;
    const part = mod.connection?.part;
    if (
      part &&
      (!opening ||
        !!("openLeft" in opening && opening.openLeft) !==
          (part === "right" || part === "middle") ||
        !!("openRight" in opening && opening.openRight) !==
          (part === "left" || part === "middle"))
    )
      fail();
    defs.set(mod.id, mod);
  }
  const validUnit = (key: string) =>
    defs.has(key) &&
    (!defs.get(key)!.connection ||
      defs.get(key)!.connection!.part === "single") &&
    defs.get(key)!.semantic !== "trim";
  const validGroup = (keys: string[]) => {
    if (!Array.isArray(keys) || keys.length > 32) return false;
    let family: string | undefined;
    let dimensions: string | undefined;
    for (const key of keys) {
      const mod = defs.get(key);
      if (!mod || mod.semantic === "trim" || mod.semantic === "entrance")
        return false;
      const c = mod.connection;
      if (!c || c.part === "single") {
        if (family) return false;
      } else if (c.part === "left") {
        if (family) return false;
        family = c.family;
        const asset = FACADE_ASSETS[mod.assetId] as {
          opening: { minY: number; maxY: number };
        };
        dimensions = `${asset.opening.minY}|${asset.opening.maxY}`;
      } else {
        if (family !== c.family) return false;
        const asset = FACADE_ASSETS[mod.assetId] as {
          opening: { minY: number; maxY: number };
        };
        if (dimensions !== `${asset.opening.minY}|${asset.opening.maxY}`)
          return false;
        if (c.part === "right") family = undefined;
      }
    }
    return !family;
  };
  const patterns = new Map<string, FacadePattern>();
  for (const p of style.patterns) {
    if (
      !p ||
      !id(p.id) ||
      patterns.has(p.id) ||
      !validGroup(p.start) ||
      !validGroup(p.repeat) ||
      !p.repeat.length ||
      !validGroup(p.end) ||
      !validUnit(p.remainder) ||
      !Number.isInteger(p.minRepeat) ||
      !Number.isInteger(p.maxRepeat) ||
      p.minRepeat < 1 ||
      p.maxRepeat < p.minRepeat ||
      p.maxRepeat > 32 ||
      !Number.isInteger(p.minWidth) ||
      p.minWidth < 1 ||
      p.minWidth > 32 ||
      !Number.isSafeInteger(p.priority) ||
      !Array.isArray(p.roles) ||
      !p.roles.length ||
      p.roles.some((r) => !["ground", "middle", "top"].includes(r)) ||
      !Array.isArray(p.facades) ||
      !p.facades.length ||
      p.facades.some((f) => !["front", "side"].includes(f))
    )
      fail();
    patterns.set(p.id, p);
  }
  if (
    style.levels.length !== 3 ||
    style.levels.map((l) => l.role).join() !== "ground,middle,top" ||
    style.levels.filter((l) => l.count === "remaining").length !== 1 ||
    style.levels[1].count !== "remaining"
  )
    fail();
  for (const l of style.levels) {
    if (
      (l.count !== "remaining" &&
        (!Number.isInteger(l.count) || l.count < 1 || l.count > 16)) ||
      (l.align !== undefined && !id(l.align)) ||
      !Array.isArray(l.moduleSet) ||
      !l.moduleSet.length ||
      l.moduleSet.some((key) => !defs.has(key)) ||
      !Array.isArray(l.patterns) ||
      !l.patterns.length ||
      l.patterns.some((key) => !patterns.has(key))
    )
      fail();
  }
  const fallback = defs.get(style.fallback);
  if (!fallback || walls.some((d) => !fallback.directions.includes(d))) fail();
  if (
    !["ground", "middle", "top"].includes(style.singleStorey) ||
    !validUnit(style.fallback) ||
    defs.get(style.fallback)?.semantic !== "wall" ||
    defs.get(style.entrance)?.semantic !== "entrance" ||
    !style.corner ||
    !validUnit(style.corner.module) ||
    !Number.isInteger(style.corner.minRunWidth) ||
    style.corner.minRunWidth < 2 ||
    defs.get(style.topTrim)?.semantic !== "trim" ||
    !["facade.cornice", "facade.cap"].includes(
      defs.get(style.topTrim)!.assetId,
    ) ||
    !Array.isArray(style.frontOrder) ||
    new Set(style.frontOrder).size !== 4 ||
    style.frontOrder.some((d) => !walls.includes(d))
  )
    fail();
  return style;
}

export function levelAt(
  style: BuildingStyle,
  y: number,
  minY: number,
  maxY: number,
): LevelDefinition {
  const [ground, middle, top] = style.levels;
  const height = maxY - minY + 1;
  if (height === 1)
    return minY === style.groundY
      ? style.levels.find((l) => l.role === style.singleStorey)!
      : top;
  // Reserve at least one top row in a short building. Floating volumes have no ground role.
  const groundCount =
    minY === style.groundY ? Math.min(ground.count as number, height - 1) : 0;
  const topCount = Math.min(top.count as number, height - groundCount);
  return y < minY + groundCount ? ground : y > maxY - topCount ? top : middle;
}
