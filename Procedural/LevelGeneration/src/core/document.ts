import { ruleReference, type RuleData } from "./building-rules";
import { validateSceneInputs, type SceneInputs } from "./scene-inputs";
import { inheritBuildings, validateBuildings, type BuildingMetadata } from "./buildings";
import {
  SHOP_STYLE,
  OFFICE_STYLE,
  validateBuildingStyle,
  type BuildingStyle,
} from "./building-style";
import {
  FACADE_ASSETS,
  FACADE_MODULE_ASSETS,
  type FacadeAssetKey,
} from "./facade-assets";
import { normalizeGrid, type Vec3 } from "./analysis";
import {
  ascii,
  DEFAULT_CATALOG,
  DEFAULT_RULES,
  validateSelection,
  type Tile,
  type Rule,
} from "./selection";
import { VILLAGE_CATALOG, VILLAGE_RULES } from "./village";
import { CRAFTED_CATALOG, CRAFTED_RULES, MODULE_ASSETS } from "./modules";

export const SETTINGS = {
  gridUnit: 1,
  rolePolicy: "component-height-v1",
  connectivity: 6,
  maxAxisCells: 32,
  maxCoordinate: 1_000_000,
  padding: 1,
  hash: "h33-u32-v1",
} as const;
export type Profile =
  | "shop"
  | "office"
  | "reference"
  | "variants"
  | "village"
  | "crafted-hip"
  | "crafted-gable"
  | "crafted-flat";
const variantCatalog: Tile[] = [
  ...DEFAULT_CATALOG,
  { ...DEFAULT_CATALOG[0], tileId: "panel.wall.alt" },
];
const variantRules: Rule[] = DEFAULT_RULES.map((r) =>
  r.ruleId === "role.wall"
    ? { ...r, tileIds: ["panel.wall", "panel.wall.alt"] }
    : r,
);
export function profileData(profile: Profile) {
  if (profile === "shop" || profile === "office")
    return {
      catalog: [
        ...CRAFTED_CATALOG,
        ...Object.keys(FACADE_ASSETS).flatMap((asset) =>
          ["clay", "sage", "sand"].map((palette) => ({
            tileId: `${asset}.${palette}`,
            assetKey: asset as FacadeAssetKey,
            palette: palette as "clay" | "sage" | "sand",
            roles: ["wall"] as Tile["roles"],
            orientationIds: ["PX", "NX", "PZ", "NZ"] as Tile["orientationIds"],
            footprint: "unit-face" as const,
            pivot: "face-center" as const,
          })),
        ),
      ],
      rules: CRAFTED_RULES,
      style: "crafted-panels",
      rolePolicy: "region-context-v1" as const,
      assembly: "flat" as const,
      architecture: JSON.parse(
        JSON.stringify(profile === "shop" ? SHOP_STYLE : OFFICE_STYLE),
      ) as BuildingStyle,
    };
  if (["crafted-hip", "crafted-gable", "crafted-flat"].includes(profile))
    return {
      catalog: CRAFTED_CATALOG,
      rules: CRAFTED_RULES,
      style: "crafted-panels",
      rolePolicy: "region-context-v1" as const,
      assembly: profile.slice(8) as "hip" | "gable" | "flat",
    };
  if (profile === "village")
    return {
      catalog: VILLAGE_CATALOG,
      rules: VILLAGE_RULES,
      style: "village-panels",
      rolePolicy: "region-context-v1" as const,
    };
  if (profile !== "reference" && profile !== "variants")
    throw new Error("Unknown catalog/rule profile.");
  return profile === "reference"
    ? { catalog: DEFAULT_CATALOG, rules: DEFAULT_RULES }
    : { catalog: variantCatalog, rules: variantRules };
}
export function canonicalJSON(value: unknown): string {
  function normalize(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(normalize);
    if (v && typeof v === "object")
      return Object.fromEntries(
        Object.entries(v)
          .sort(([a], [b]) => ascii(a, b))
          .map(([k, val]) => [k, normalize(val)]),
      );
    return v;
  }
  return JSON.stringify(normalize(value)) + "\n";
}
function canonicalCatalog(catalog: Tile[]) {
  return catalog
    .map((t) => ({
      ...t,
      roles: [...t.roles].sort(ascii),
      orientationIds: [...t.orientationIds].sort(ascii),
    }))
    .sort((a, b) => ascii(a.tileId, b.tileId));
}
function canonicalModules<T extends { assetKey: string }>(
  input: readonly T[],
): T[] {
  if (
    !Array.isArray(input) ||
    input.some(
      (m) => !m || typeof m !== "object" || typeof m.assetKey !== "string",
    )
  )
    throw new Error("Invalid module asset metadata.");
  return [...input].sort((a, b) => ascii(a.assetKey, b.assetKey));
}
export function createDocument(
  grid: unknown,
  seed = 0,
  profile: Profile = "reference",
  definition?: BuildingStyle,
  buildings?: BuildingMetadata[],
  sceneInputs?: SceneInputs,
) {
  const options = profileData(profile);
  if (definition && !options.architecture)
    throw new Error("Building definition requires schema v4.");
  const architecture = options.architecture
    ? validateBuildingStyle(
        JSON.parse(
          JSON.stringify(definition ?? options.architecture),
        ) as BuildingStyle,
      )
    : undefined;
  const { catalog } = options;
  validateSelection({ seed, ...options });
  return {
    schemaVersion: architecture
      ? 4
      : options.assembly
        ? 3
        : profile === "village"
          ? 2
          : 1,
    algorithmVersion: architecture
      ? architecture.entranceLayout === "centered-parity"
        ? "building-patterns-v2"
        : "building-patterns-v1"
      : options.assembly
        ? "modules-v1"
        : profile === "village"
          ? "architecture-v1"
          : "shell-v1",
    ...(architecture ? { buildingDefinition: architecture } : {}),
    ...(sceneInputs ? { sceneInputs: validateSceneInputs(normalizeGrid(grid), sceneInputs) } : {}),
    ...(buildings?.length ? { buildings: validateBuildings(normalizeGrid(grid), buildings) } : {}),
    grid: normalizeGrid(grid),
    seed,
    catalog: {
      id: profile,
      version: 1,
      tiles: canonicalCatalog(catalog),
      ...(options.assembly
        ? {
            modules: canonicalModules(
              [
                ...MODULE_ASSETS,
                ...(architecture ? FACADE_MODULE_ASSETS : []),
              ].map((m) => ({
                ...m,
                bounds16: {
                  min: [...m.bounds16.min],
                  max: [...m.bounds16.max],
                },
              })),
            ),
          }
        : {}),
    },
    ruleSet: { id: profile, version: 1 },
    style: { id: options.style ?? "unit-panels", version: 1 },
    settings: {
      ...SETTINGS,
      ...(profile === "village" || options.assembly
        ? {
            rolePolicy: "region-context-v1",
            facadePolicy: "base-run-entry-v1",
            minAnnexWidth: 2,
            palettePolicy: "component-h33-v1",
          }
        : {}),
      ...(options.assembly
        ? {
            assemblyPolicy: "module-cover-v1",
            roofStyle: options.assembly,
            maxRelief16: 2,
          }
        : {}),
      ...(architecture
        ? {
            facadePolicy:
              architecture.entranceLayout === "centered-parity"
                ? "building-patterns-v2"
                : "building-patterns-v1",
            groundPolicy: "component-base-y0-v1",
            patternFit: "exact-filler-priority-id-v1",
          }
        : {}),
    },
  };
}
export type GenerationDocument = ReturnType<typeof createDocument>;
export function exportDocument(document: GenerationDocument): string {
  return canonicalJSON(loadDocument(JSON.stringify(document)));
}
export function loadDocument(text: string): GenerationDocument {
  const raw = JSON.parse(text);
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Document must be a JSON object.");
  if (
    !(
      (raw.schemaVersion === 1 && raw.algorithmVersion === "shell-v1") ||
      (raw.schemaVersion === 2 && raw.algorithmVersion === "architecture-v1") ||
      (raw.schemaVersion === 3 && raw.algorithmVersion === "modules-v1") ||
      (raw.schemaVersion === 4 &&
        ["building-patterns-v1", "building-patterns-v2"].includes(
          raw.algorithmVersion,
        ))
    )
  )
    throw new Error("Unknown schema or algorithm version.");
  if (
    !raw.catalog ||
    !raw.ruleSet ||
    !raw.style ||
    raw.catalog.version !== 1 ||
    raw.ruleSet.version !== 1 ||
    raw.style.version !== 1
  )
    throw new Error("Unknown catalog, rule or style version.");
  // Preserve saved scenes from before the misc -> facility category rename.
  if (raw.sceneInputs?.version === 1 && Array.isArray(raw.sceneInputs.objects))
    for (const input of raw.sceneInputs.objects)
      if (input?.category === "misc") input.category = "facility";
  // Only registered immutable metadata is accepted under each ID/version.
  const expected = createDocument(
    raw.grid,
    raw.seed,
    raw.catalog.id,
    raw.buildingDefinition,
    raw.buildings,
    raw.sceneInputs,
  );
  if (!Number.isInteger(raw.seed))
    throw new Error("Document must include an explicit integer seed.");
  validateSelection({ catalog: raw.catalog.tiles });
  const normalized = {
    ...raw,
    grid: normalizeGrid(raw.grid),
    catalog: {
      ...raw.catalog,
      tiles: canonicalCatalog(raw.catalog.tiles),
      ...(raw.catalog.modules !== undefined
        ? { modules: canonicalModules(raw.catalog.modules) }
        : {}),
    },
  };
  if (canonicalJSON(normalized) !== canonicalJSON(expected))
    throw new Error(
      "Document metadata/settings do not match the registered version.",
    );
  return expected;
}
export function replaceGrid(
  document: GenerationDocument,
  grid: Vec3[],
): GenerationDocument {
  return createDocument(
    grid,
    document.seed,
    document.catalog.id,
    document.buildingDefinition,
    inheritBuildings(document.grid, grid, document.buildings ?? []),
    document.sceneInputs,
  );
}

export function documentOptions(document: GenerationDocument) {
  return {
    ...profileData(document.catalog.id),
    seed: document.seed,
    ...(document.buildingDefinition
      ? { architecture: document.buildingDefinition }
      : {}),
  };
}

export function setBuildingTheme(document: GenerationDocument, componentId: string, theme: BuildingStyle) {
  return createDocument(document.grid, document.seed, document.catalog.id, document.buildingDefinition,
    [...(document.buildings ?? []).filter(b => b.componentId !== componentId), { ...document.buildings?.find(b => b.componentId === componentId), componentId, theme }], document.sceneInputs);
}

export function replaceSceneInputs(document: GenerationDocument, sceneInputs: SceneInputs) {
  return createDocument(document.grid, document.seed, document.catalog.id, document.buildingDefinition, document.buildings, sceneInputs);
}

export function setBuildingRule(document: GenerationDocument, componentId: string, ruleId: string, metadata: RuleData = {}) {
  const previous = document.buildings?.find(b => b.componentId === componentId);
  return createDocument(document.grid, document.seed, document.catalog.id, document.buildingDefinition,
    [...(document.buildings ?? []).filter(b => b.componentId !== componentId), { ...previous, componentId, rule: ruleReference(ruleId, metadata) }], document.sceneInputs);
}
