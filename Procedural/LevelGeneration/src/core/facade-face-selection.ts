import type { BuildingModule } from './building-style';
import type { AssetRow } from './banded-facade-assets';
import { facadeTileAsset, facadeTileBand } from './facade-tile-settings';
import { FACADE_ASSETS, type FacadeAssetKey } from './facade-assets';
import { cellId, type Surface, type Placement } from './analysis';
import type { FaceTrace } from './selection';
import type { WallDirection } from './vertical-design';
import {
  facadeKind,
  type FacadeDecision,
  type FacadePatternSection,
  type FacadeLayoutInput,
} from './facade-layout';
import { wallRowId, wallU, wallPlane } from './facade-coordinates';
// Negative/positive U neighbors for the four authored vertical face bases.
const CORNER_DIRECTIONS: Record<WallDirection, readonly [WallDirection, WallDirection]> = {
  PX: ['PZ', 'NZ'],
  NX: ['NZ', 'PZ'],
  PZ: ['NX', 'PX'],
  NZ: ['PX', 'NX'],
};

/** Resolve row/cap, rooftop, custom tile, then convex corner in that order. */
export function applyWallModule(
  s: Surface,
  moduleId: string,
  decision: FacadeDecision,
  groupId: string | undefined,
  input: FacadeLayoutInput,
  output: FacadeOutput,
): void {
  const { style, context, lookup, bands, caps, frontages } = input;
  const vertical = context.verticalBands,
    defs = lookup.modules;
  const { patternId, reason, candidates, portal } = decision;
  const key = moduleId;
  const { faces, catalogIds } = output;
  const def = defs.get(key),
    band = bands.get(s.faceId),
    p = output.placements.get(s.faceId),
    trace = output.traces.get(s.faceId);
  if (!def || !band || !p || !trace || !def.directions.includes(s.direction))
    throw new Error('INVALID_FACADE_MODULE');
  const { asset, rooftopAsset, tileSet, tileBand, corner } = selectWallAsset(
    s,
    def,
    band,
    decision,
    style,
    caps,
    faces,
  );
  const palette = vertical.profile?.palette ?? trace.architecture?.palette ?? 'clay',
    tileId = `${asset}.${palette}`;
  if (!catalogIds.has(tileId)) throw new Error(`MISSING_FACADE_ASSET:${tileId}`);
  p.tileId = tileId;
  p.ruleId = portal ? 'building.entrance' : 'building.banded';
  if (rooftopAsset && !portal) p.ruleId = 'building.rooftop-wall';
  trace.selection = { ...trace.selection, ruleId: p.ruleId, tileId };
  trace.facade = {
    styleId: style.id,
    styleVersion: style.version,
    level: band.band,
    rowRole: band.rowRole,
    phase: vertical.alignment.phaseByDirection[s.direction as 'PX' | 'NX' | 'PZ' | 'NZ'],
    topBoundary: caps.has(s.faceId),
    facade: decision.row?.kind ?? facadeKind(s, frontages),
    runId: decision.row?.id ?? wallRowId(s),
    patternId,
    moduleId: key,
    reason,
    candidates,
    ...(groupId ? { groupId } : {}),
    ...(def.connection ? { part: def.connection.part } : {}),
    ...(portal
      ? {
          portalId: portal.id,
          portalRole: portal.role,
          portalAccess: portal.access,
          entranceSpan: portal.widthCells,
        }
      : {}),
  };

  trace.facade.wallKind = s.wallKind;
  if (tileSet) {
    delete trace.facade.groupId;
    delete trace.facade.part;
    trace.facade.reason = `custom ${corner ? 'corner' : tileBand} tile: ${tileSet}`;
  }

  if (decision.framePanelId) trace.facade.framePanelId = decision.framePanelId;
}

function selectWallAsset(
  s: Surface,
  def: BuildingModule,
  band: FacadeLayoutInput['context']['verticalBands']['faceBands'][number],
  assignment: FacadeDecision,
  style: FacadeLayoutInput['style'],
  caps: ReadonlySet<string>,
  faces: ReadonlyMap<string, Surface>,
) {
  const { patternId, portal } = assignment;
  const isCap = caps.has(s.faceId);
  const rowAsset = (isCap ? `${band.rowRole}-cap` : band.rowRole) as AssetRow;
  const rooftopAsset = s.wallKind === 'rooftop' ? def.rooftopAssets?.[rowAsset] : undefined;
  let asset = rooftopAsset ?? def.rowAssets?.[rowAsset] ?? def.assetId;
  let left = false,
    right = false;
  // Plain prototypes have no convex variant. Only custom tiles or a descriptor
  // with corner variants need neighboring face IDs.
  if (style.tileSettings || 'cornerAssets' in FACADE_ASSETS[asset]) {
    const [leftDirection, rightDirection] = CORNER_DIRECTIONS[s.direction as WallDirection];
    const cell = cellId(s.cell);
    left = faces.has(`${cell}|${leftDirection}`);
    right = faces.has(`${cell}|${rightDirection}`);
  }
  const tileBand = facadeTileBand(band.band),
    corner = patternId === 'corner' || left || right;
  const tileSet =
    !portal &&
    patternId !== 'approved-facility-wall' &&
    patternId !== 'column-display' &&
    patternId !== 'multi-floor-frame'
      ? corner
        ? (style.tileSettings?.corner ?? style.tileSettings?.[tileBand])
        : style.tileSettings?.[tileBand]
      : undefined;
  if (tileSet) asset = facadeTileAsset(tileSet, tileBand, rowAsset, s.wallKind === 'rooftop', corner);
  const descriptor = FACADE_ASSETS[asset];
  if ('cornerAssets' in descriptor && descriptor.cornerAssets) {
    const cut = left && right ? 'both' : left ? 'left' : right ? 'right' : undefined;
    if (cut) asset = (descriptor.cornerAssets[cut] ?? asset) as FacadeAssetKey;
  }

  return { asset, rooftopAsset, tileSet, tileBand, corner };
}

export interface FacadeOutput {
  placements: ReadonlyMap<string, Placement>;
  traces: ReadonlyMap<string, FaceTrace>;
  faces: ReadonlyMap<string, Surface>;
  catalogIds: ReadonlySet<string>;
}
export function applyPatternSection(
  section: FacadePatternSection,
  input: FacadeLayoutInput,
  output: FacadeOutput,
): void {
  const first = section.faces[0];
  const decision: FacadeDecision = {
    row: { id: wallRowId(first), kind: facadeKind(first, input.frontages) },
    patternId: section.patternId,
    reason: 'absolute anchor / complete connected groups',
    candidates: section.candidates,
  };
  const groupPrefix = `group:${first.componentId}:${first.direction}:${first.cell[1]}:`;
  const plane = wallPlane(first);
  let groupId: string | undefined;
  for (let i = 0; i < section.tokens.length; i++) {
    const moduleId = section.tokens[i],
      surface = section.faces[i],
      connection = input.lookup.modules.get(moduleId)!.connection;
    if (connection?.part === 'left') groupId = `${groupPrefix}${wallU(surface)}:${plane}`;
    applyWallModule(surface, moduleId, decision, groupId, input, output);
    if (connection?.part === 'right' || connection?.part === 'single' || !connection) groupId = undefined;
  }
}
