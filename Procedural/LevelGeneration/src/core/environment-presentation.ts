import type { EnvironmentResult } from './environment-contract';
import type { Surface } from './analysis';
import { faceCenter2 } from './analysis';
import { faceBounds16 } from './placement-bounds';
import type { AccessSearch } from './access-graph';
import type { SourceRef } from './environment-contract';
import type { Vec3 } from './analysis';
export interface AccessProbe {
  ref: SourceRef;
  cell: Vec3;
  access: ReturnType<AccessSearch['query']>;
}
function verticalOverlays(
  vertical: NonNullable<EnvironmentResult['vertical']>,
  faceLookup: ReadonlyMap<string, Surface>,
): NonNullable<EnvironmentResult['overlays']> {
  const zoneColors: Record<string, string> = {
    base: '#edb76c',
    retail: '#edb76c',
    body: '#70c5bf',
    office: '#70c5bf',
    crown: '#c69be7',
    upper: '#c69be7',
    mechanical: '#9babb5',
  };
  return vertical.flatMap((v) =>
    (
      v.zones ??
      v.bands.map((b) => ({
        id: `band:${v.buildingId}:${b.band}`,
        sectionId: b.band,
        faceIds: v.faceBands.filter((f) => f.band === b.band).map((f) => f.faceId),
      }))
    ).map((z) => ({
      id: z.id,
      sourceRefs: [{ kind: 'building' as const, id: v.buildingId }],
      boxes16: z.faceIds.map((id) => {
        const s = faceLookup.get(id)!;
        return faceBounds16(
          { min: [-8, -8, 0], max: [8, 8, 1] },
          faceCenter2(s.cell, s.direction),
          s.direction,
        );
      }),
      color: zoneColors[z.sectionId] ?? '#99b6c5',
    })),
  );
}

/** Presentation-only geometry; never fed back into rule or reservation decisions. */
export function environmentOverlays(
  entrances: NonNullable<EnvironmentResult['entrances']>,
  circulation: NonNullable<EnvironmentResult['parkingCirculation']>,
  vertical: NonNullable<EnvironmentResult['vertical']>,
  faceLookup: ReadonlyMap<string, Surface>,
  probes: readonly AccessProbe[],
): NonNullable<EnvironmentResult['overlays']> {
  return [
    ...entrances.flatMap((p) =>
      p.entrances.map((e) => ({
        id: e.id,
        sourceRefs: [{ kind: 'building' as const, id: p.buildingId }],
        path: e.pathCells,
        color: '#f6d968',
      })),
    ),
    ...circulation.flatMap((a) =>
      a.components.flatMap((p) => [
        {
          id: `aisle:${p.componentKey}`,
          sourceRefs: [{ kind: 'parking' as const, id: a.areaId }],
          boxes16: p.aisleCells.map((c) => ({
            min: [c[0] * 16, 0, c[2] * 16] as [number, number, number],
            max: [(c[0] + 1) * 16, 1, (c[2] + 1) * 16] as [number, number, number],
          })),
          color: '#ec9866',
        },
        {
          id: `walk:${p.componentKey}`,
          sourceRefs: [{ kind: 'parking' as const, id: a.areaId }],
          boxes16: p.walkCells.map((c) => ({
            min: [c[0] * 16, 1, c[2] * 16] as [number, number, number],
            max: [(c[0] + 1) * 16, 2, (c[2] + 1) * 16] as [number, number, number],
          })),
          color: '#83cfb9',
        },
        ...p.gates.map((g) => ({
          id: g.id,
          sourceRefs: [{ kind: 'parking' as const, id: a.areaId }],
          path: g.openingCells,
          color: '#fff082',
        })),
      ]),
    ),
    ...verticalOverlays(vertical, faceLookup),
    ...probes
      .filter((p) => p.access.reachable)
      .map((p) => ({ id: `access:${p.ref.id}`, sourceRefs: [p.ref], path: p.access.path, color: '#ffe887' })),
  ];
}
