import {DIRECTIONS,type Direction,type Vec3,type Role} from './analysis';
import {DEFAULT_CATALOG,DEFAULT_RULES,PALETTES,selectTiles,type Palette,type Tile,type Rule} from './selection';
import {FACADE_MODULE_ASSETS} from './facade-assets';
const specs:{name:string;asset:Tile['assetKey'];role:Role}[]=[{name:'plaster',asset:'crafted.plaster',role:'wall'},{name:'roof',asset:'crafted.roof',role:'roof'},{name:'paving',asset:'crafted.paving',role:'terrace'},{name:'soffit',asset:'crafted.soffit',role:'underside'}];
export const CRAFTED_CATALOG:Tile[]=[...DEFAULT_CATALOG,...specs.flatMap(s=>PALETTES.map(palette=>({tileId:`${s.asset}.${palette}`,assetKey:s.asset,palette,relief16:2 as const,roles:[s.role],orientationIds:s.role==='wall'?['PX','NX','PZ','NZ'] as Direction[]:s.role==='underside'?['NY'] as Direction[]:['PY'] as Direction[],footprint:'unit-face' as const,pivot:'face-center' as const})))];
export const CRAFTED_RULES:Rule[]=[...DEFAULT_RULES,...specs.map(s=>({ruleId:`architecture.${s.name}`,priority:150,roles:[s.role],orientationIds:[...DIRECTIONS],tileIds:PALETTES.map(p=>`${s.asset}.${p}`),predicate:'supported' as const}))];
export const MODULE_ASSETS=FACADE_MODULE_ASSETS;
export type ModuleAssetKey=string;
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
