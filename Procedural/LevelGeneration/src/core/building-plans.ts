import type { GenerationDocument } from './document';
import type { AnalysisComponent, Surface } from './analysis';
import type { VerticalPlan } from './vertical-design';
import type { EntrancePlan } from './entrance-contract';
import type { ReservationBook } from './reservations';
import { planColumns } from './column-prototype';
import { planWallFacilities } from './wall-facilities';
import { planFacade } from './facade-plan';

/** Claims become stricter in order: entrances → facilities → columns → frames. */
export function planBuildingStructure(
  document: GenerationDocument,
  surfaces: Surface[],
  buildingsById: ReadonlyMap<string, GenerationDocument['buildings'][number]>,
  componentsById: ReadonlyMap<string, AnalysisComponent>,
  vertical: VerticalPlan[],
  entrances: EntrancePlan[],
  finalBook: ReservationBook | undefined,
) {
  const portalFacesForFacilities = new Set(entrances.flatMap((e) => e.entrances.flatMap((p) => p.faceIds)));
  const wallFacilities = finalBook
    ? planWallFacilities(document, surfaces, vertical, portalFacesForFacilities, finalBook)
    : undefined;
  const facadeFixed = new Set([
    ...portalFacesForFacilities,
    ...(wallFacilities?.changes.map((c) => c.faceId) ?? []),
  ]);
  const columnFixed = new Set([
    ...facadeFixed,
    ...surfaces.filter((s) => s.architecture?.interpretation === 'unsupported').map((s) => s.faceId),
    ...(wallFacilities?.groups.filter((g) => g.accepted).flatMap((g) => g.faceIds) ?? []),
  ]);
  const columns = vertical.map((v) => {
    const b = buildingsById.get(v.buildingId)!,
      style = b.theme ?? document.buildingDefinition;
    return planColumns(
      v.buildingId,
      componentsById.get(v.buildingId)!.cells,
      surfaces,
      style.programs ? 'auto' : 'building',
      columnFixed,
    );
  });
  const columnFaces = new Set(columns.flatMap((c) => c.faces.map((f) => f.faceId)));
  columnFaces.forEach((id) => facadeFixed.add(id));
  const facades = vertical.flatMap((v) => {
    const style = buildingsById.get(v.buildingId)!.theme ?? document.buildingDefinition;
    return style.facadeGrammar ? [planFacade(surfaces, v, style.facadeGrammar, facadeFixed)] : [];
  });

  return { wallFacilities, columns, columnFaces, facades };
}
