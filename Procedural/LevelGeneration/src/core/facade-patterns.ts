import { validateBuildingStyle } from './building-style';
import type { Surface, Placement } from './analysis';
import type { FaceTrace, SelectionOptions } from './selection';
import { patternLookup } from './facade-fitting';
import { planFacadeLayout, type FacadeLayoutInput } from './facade-layout';
import { applyPatternSection, applyWallModule } from './facade-face-selection';
export { chooseFacadePattern } from './facade-fitting';
export type { FacadeTrace, PatternRunBand } from './facade-contract';

function applyRoofFinish(
  surface: Surface,
  input: FacadeLayoutInput,
  catalogIds: ReadonlySet<string>,
  placement: Placement,
  trace: FaceTrace,
): void {
  const { style, context } = input;
  if (surface.architecture?.interpretation === 'unsupported') return;
  const asset =
    surface.role === 'roof' ? style.roofAsset : surface.role === 'terrace' ? style.terraceAsset : undefined;
  if (!asset) return;
  const tileId = `${asset}.${context.verticalBands.profile?.palette ?? trace.architecture?.palette ?? 'clay'}`;
  if (!catalogIds.has(tileId)) throw new Error(`MISSING_FACADE_ASSET:${tileId}`);
  placement.tileId = tileId;
  placement.ruleId = 'building.roof-finish';
  trace.selection = { ...trace.selection, ruleId: placement.ruleId, tileId };
}

/** Plan ownership/layout first, then apply assets to copies of the base result. */
export function applyFacadeStyle<
  T extends { surfaces: Surface[]; placements: Placement[]; traces: FaceTrace[] },
>(base: T, options: SelectionOptions): T {
  if (!options.architecture) return base;
  const style = validateBuildingStyle(options.architecture),
    context = options.context;
  if (!context?.verticalBands || !context.entrances) throw new Error('ENV_PIPELINE_NOT_READY:facade-context');
  const lookup = patternLookup(style);
  for (const column of context.columns?.faces ?? []) {
    if (!lookup.modules.has(column.assetKey))
      lookup.modules.set(column.assetKey, {
        id: column.assetKey,
        assetId: column.assetKey,
        semantic: 'wall',
        width: 1,
        height: 1,
        directions: ['PX', 'NX', 'PZ', 'NZ'],
      });
  }
  const input: FacadeLayoutInput = {
    style,
    context: { ...context, verticalBands: context.verticalBands, entrances: context.entrances },
    surfaces: base.surfaces,
    lookup,
    family: style.alignedFamilies.find((f) => f.id === context.verticalBands!.alignment.familyId)!,
    bands: new Map(context.verticalBands.faceBands.map((b) => [b.faceId, b])),
    caps: new Set(
      context.verticalBands.boundaries.filter((b) => b.kind === 'local-cap').map((b) => b.hostFaceId),
    ),
    frontages: new Set(context.entrances.frontages.map((f) => `${f.direction}:${f.plane}`)),
  };
  const faces = new Map(base.surfaces.map((s) => [s.faceId, s])),
    catalogIds = new Set(options.catalog?.map((t) => t.tileId));
  const layout = planFacadeLayout(input, faces);
  const placements = base.placements.map((p) => ({ ...p })),
    traces = base.traces.map((t) => ({ ...t }));
  const byPlacement = new Map(placements.map((p) => [p.faceId, p])),
    byTrace = new Map(traces.map((t) => [t.faceId, t]));
  for (const surface of base.surfaces) {
    if (surface.role !== 'roof' && surface.role !== 'terrace') continue;
    applyRoofFinish(
      surface,
      input,
      catalogIds,
      byPlacement.get(surface.faceId)!,
      byTrace.get(surface.faceId)!,
    );
  }
  const output = { placements: byPlacement, traces: byTrace, faces, catalogIds };
  for (const [faceId, assignment] of layout.fixed)
    applyWallModule(faces.get(faceId)!, assignment.moduleId, assignment, assignment.groupId, input, output);
  for (const section of layout.sections) applyPatternSection(section, input, output);
  for (const column of context.columns?.faces ?? []) {
    if (faces.get(column.faceId)!.role === 'wall') continue;
    const placement = byPlacement.get(column.faceId)!,
      trace = byTrace.get(column.faceId)!;
    const tileId = `${lookup.modules.get(column.assetKey)!.assetId}.${context.verticalBands.profile?.palette ?? trace.architecture?.palette ?? 'clay'}`;
    if (!catalogIds.has(tileId)) throw new Error('MISSING_COLUMN_CAP');
    placement.tileId = tileId;
    placement.ruleId = 'column-display';
    trace.selection = { ...trace.selection, tileId, ruleId: placement.ruleId };
  }
  return { ...base, placements, traces };
}
