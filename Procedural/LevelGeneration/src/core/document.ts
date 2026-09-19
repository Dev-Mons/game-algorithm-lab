import { canonicalJSON, exactKeys, cloneJSON } from "./canonical";
import {isStreamlineCCornerV9} from './streamline-c-assets';
import {isCurtainBCornerV10} from './curtain-b-assets';
import { defaultEnvironmentSettings, validateEnvironmentSettings, type EnvironmentSettings } from "./environment-settings";
import { emptySceneInputs } from "./scene-inputs";
import { adapterReferenceFor } from "./rule-spatial-adapters";
import { ruleReference, type RuleData } from "./building-rules";
import { validateSceneInputs, type SceneInputs } from "./scene-inputs";
import { inheritBuildings, validateBuildings, type BuildingMetadata } from "./buildings";
import {
  SHOP_STYLE,
  OFFICE_STYLE,
  URBAN_SHOP_STYLE, URBAN_OFFICE_STYLE, STYLE_E,
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
import { CRAFTED_CATALOG, CRAFTED_RULES } from "./modules";

export const SETTINGS = {
  gridUnit: 1,
  rolePolicy: "region-context-v1",
  connectivity: 6,
  maxAxisCells: 32,
  maxCoordinate: 1_000_000,
  padding: 1,
  hash: "h33-u32-v1",
} as const;
// Stable IDs preserve existing files and seed-based designs; labels are A–E.
export const BUILDING_PROFILES={shop:SHOP_STYLE,office:OFFICE_STYLE,'urban-shop':URBAN_SHOP_STYLE,'urban-office':URBAN_OFFICE_STYLE,'style-e':STYLE_E};
export type Profile = keyof typeof BUILDING_PROFILES;
function topAssetRole(key:string){const a=FACADE_ASSETS[key as FacadeAssetKey];return a&&'surfaceRole' in a?a.surfaceRole:undefined;}
export function profileData(profile: Profile) {
  if (Object.hasOwn(BUILDING_PROFILES,profile))
    return {
      catalog: [
        ...CRAFTED_CATALOG,
        ...Object.keys(FACADE_ASSETS).flatMap((asset) =>
          ["clay", "sage", "sand"].map((palette) => ({
            tileId: `${asset}.${palette}`,
            assetKey: asset as FacadeAssetKey,
            palette: palette as "clay" | "sage" | "sand",
            roles: (topAssetRole(asset)?[topAssetRole(asset)]:(asset.startsWith('facade.urban-column-')||asset.startsWith('facade.streamline-c-column-'))?["wall","roof","terrace","underside"]:["wall"]) as Tile["roles"],
            orientationIds: (topAssetRole(asset)?['PY']:(asset.startsWith('facade.urban-column-')||asset.startsWith('facade.streamline-c-column-'))?["PX","NX","PZ","NZ","PY","NY"]:["PX", "NX", "PZ", "NZ"]) as Tile["orientationIds"],
            footprint: "unit-face" as const,
            pivot: "face-center" as const,
          })),
        ),
      ],
      rules: CRAFTED_RULES,
      style: "environment-panels",
      rolePolicy: "region-context-v1" as const,
      architecture: JSON.parse(
        JSON.stringify(BUILDING_PROFILES[profile]),
      ) as BuildingStyle,
    };
  throw new Error("Unknown current building profile.");
}

export { canonicalJSON } from "./canonical";
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
  profile: Profile = "office",
  definition?: BuildingStyle,
  buildings?: BuildingMetadata[],
  sceneInputs?: SceneInputs,
  environment: EnvironmentSettings = defaultEnvironmentSettings(),
) {
  const options = profileData(profile);
  const architecture = validateBuildingStyle(definition ?? options.architecture ?? OFFICE_STYLE);
  validateSelection({ seed, ...options });
  const cells = normalizeGrid(grid);
  return {
    schemaVersion: 5 as const,
    algorithmVersion: "environment-plans-v1" as const,
    buildingDefinition: architecture,
    sceneInputs: validateSceneInputs(cells, sceneInputs ?? emptySceneInputs()),
    buildings: validateBuildings(cells, buildings ?? [], profile.endsWith('shop') ? "retail" : "office",seed),
    environment: validateEnvironmentSettings(environment),
    grid: cells, seed,
    catalog: {
      id: profile, version: 10,
      tiles: canonicalCatalog(profileData("office").catalog),
      modules: cloneJSON(canonicalModules([...FACADE_MODULE_ASSETS])),
    },
    ruleSet: { id: "environment", version: 1 },
    style: { id: "banded-facade-v1", version: 1 },
    settings: {...SETTINGS,rolePolicy:"region-context-v1",facadePolicy:"planned-portals-v1",palettePolicy:"anchor-h33-v1",assemblyPolicy:"module-cover-v1"},
  };
}
export type GenerationDocument = ReturnType<typeof createDocument>;
export function exportDocument(document: GenerationDocument): string {
  return canonicalJSON(loadDocument(canonicalJSON(document)));
}
export function loadDocument(text: string): GenerationDocument {
  const raw = JSON.parse(text);
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Document must be a JSON object.");
  if (raw.schemaVersion !== 5 || raw.algorithmVersion !== "environment-plans-v1")
    throw new Error("UNSUPPORTED_DOCUMENT_VERSION");
  exactKeys(raw as unknown,["schemaVersion","algorithmVersion","buildingDefinition","sceneInputs","buildings","environment","grid","seed","catalog","ruleSet","style","settings"]);
  if (!Array.isArray(raw.buildings)) throw new Error("INVALID_BUILDINGS");
  for (const b of raw.buildings) exactKeys(b,["componentId","rule","design","spatialAdapterRef"],["theme"]);
  if (!raw.catalog || !raw.ruleSet || !raw.style || ![2,3,4,5,6,7,8,9,10].includes(raw.catalog.version) || raw.ruleSet.version !== 1 || raw.style.version !== 1)
    throw new Error("Unknown catalog, rule or style version.");
  // Only registered immutable metadata is accepted under each ID/version.
  const expected = createDocument(
    raw.grid,
    raw.seed,
    raw.catalog.id,
    raw.buildingDefinition,
    raw.buildings,
    raw.sceneInputs,
    raw.environment,
  );
  if (raw.buildings.length !== expected.buildings.length) throw new Error("MISSING_BUILDING_METADATA");
  if (!Number.isInteger(raw.seed))
    throw new Error("Document must include an explicit integer seed.");
  validateSelection({ catalog: raw.catalog.tiles });
  const normalized = {
    ...raw,
    grid: normalizeGrid(raw.grid),
    buildings: expected.buildings,
    sceneInputs: expected.sceneInputs,
    catalog: {
      ...raw.catalog,
      tiles: canonicalCatalog(raw.catalog.tiles),
      ...(raw.catalog.modules !== undefined
        ? { modules: canonicalModules(raw.catalog.modules) }
        : {}),
    },
  };
  // Catalog 7 excludes C streamline modules; 6 excludes B curtain walls; 5 excludes A ribbons; 4 excludes style-specific frames.
  // earlier versions also
  // exclude urban prototypes (3) and rooftop variants (2).
  // Verify it against that exact catalog before upgrading; preserve authored styles.
  const registered = raw.catalog.version < 10 ? {
    ...expected, catalog: { ...expected.catalog, version: raw.catalog.version,
      tiles: expected.catalog.tiles.filter(t => !isCurtainBCornerV10(t.assetKey)&&(raw.catalog.version>=9||!isStreamlineCCornerV9(t.assetKey))&&(raw.catalog.version>=8||!t.assetKey.includes('streamline-c-'))&&(raw.catalog.version>=7||!t.assetKey.includes('curtain-b-'))&&(raw.catalog.version>=6||!t.assetKey.includes('ribbon-a-'))&&(raw.catalog.version>=5||!/^facade\.urban-(shop|office)-frame-/.test(t.assetKey))&&(raw.catalog.version>=4||!t.assetKey.startsWith('facade.urban-'))&&(raw.catalog.version!==2||!t.assetKey.startsWith('facade.rooftop-'))) },
  } : expected;
  if (canonicalJSON(normalized) !== canonicalJSON(registered))
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
    document.environment,
  );
}

export function documentOptions(document: GenerationDocument) {
  return {catalog:document.catalog.tiles,rules:CRAFTED_RULES,style:'environment-panels',rolePolicy:'region-context-v1' as const,seed:document.seed,architecture:document.buildingDefinition};
}

export function setBuildingTheme(document: GenerationDocument, componentId: string, theme: BuildingStyle) {
  return createDocument(document.grid, document.seed, document.catalog.id, document.buildingDefinition,
    [...(document.buildings ?? []).filter(b => b.componentId !== componentId), { ...document.buildings?.find(b => b.componentId === componentId), componentId, theme }], document.sceneInputs, document.environment);
}

export function replaceSceneInputs(document: GenerationDocument, sceneInputs: SceneInputs) {
  return createDocument(document.grid, document.seed, document.catalog.id, document.buildingDefinition, document.buildings, sceneInputs, document.environment);
}

export function setBuildingRule(document: GenerationDocument, componentId: string, ruleId: string, metadata: RuleData = {}) {
  const previous = document.buildings?.find(b => b.componentId === componentId);
  return createDocument(document.grid, document.seed, document.catalog.id, document.buildingDefinition,
    [...(document.buildings ?? []).filter(b => b.componentId !== componentId), { ...previous, componentId, rule: ruleReference(ruleId, metadata), spatialAdapterRef: adapterReferenceFor(ruleReference(ruleId, metadata)) }], document.sceneInputs, document.environment);
}
