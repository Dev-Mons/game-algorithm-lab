import { verticalCounts, rowsByHeight, sectionBands, programRows } from './vertical-allocation';
import { verticalBoundaries } from './vertical-boundaries';
import { BASES, type Surface, type Vec3 } from './analysis';
import {
  VERTICAL_BANDS,
  validateBuildingStyle,
  type BuildingStyle,
  type VerticalBand,
} from './building-style';
import type { BuildingDesignV1, DecisionTrace } from './environment-contract';
import { allocateProgram } from './architectural-program';
import { resolveDesignProfile, type BuildingDesignProfile } from './design-profile';
import { analyzeMass, type MassRelations } from './mass-relations';
export type WallDirection = 'PX' | 'NX' | 'PZ' | 'NZ';
export type RowRole = 'foot' | 'repeat' | 'head' | 'single';
export interface VerticalPlan {
  buildingId: string;
  datumY: number;
  heightCells: number;
  bands: { band: VerticalBand; yMin: number; yMaxExclusive: number }[];
  alignment: {
    anchor: Vec3;
    familyId: string;
    periodCells: number;
    phaseByDirection: Record<WallDirection, number>;
  };
  faceBands: { faceId: string; band: VerticalBand; rowRole: RowRole }[];
  boundaries: {
    id: string;
    hostFaceId: string;
    kind: 'base-belt' | 'crown-belt' | 'local-cap';
    edgeStart2: Vec3;
    edgeEnd2: Vec3;
  }[];
  traces: DecisionTrace[];
  profile?: BuildingDesignProfile;
  mass?: MassRelations;
  zones?: {
    id: string;
    massId: string;
    sectionId: string;
    regionId: string;
    yMin: number;
    yMaxExclusive: number;
    faceIds: string[];
  }[];
}
export const positiveMod = (n: number, d: number) => ((n % d) + d) % d;
export { verticalCounts } from './vertical-allocation';
export function planVertical(
  buildingId: string,
  cells: readonly Vec3[],
  surfaces: readonly Surface[],
  design: BuildingDesignV1,
  definition: BuildingStyle,
  seed = 0,
): VerticalPlan {
  const style = validateBuildingStyle(definition);
  const profile = resolveDesignProfile(style, design, seed);
  const family = profile
    ? style.alignedFamilies.find((f) => f.id === profile.familyId)!
    : [...style.alignedFamilies].sort(
        (a, b) => b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      )[0];
  const phaseByDirection = Object.fromEntries(
    (['PX', 'NX', 'PZ', 'NZ'] as const).map((d) => [
      d,
      positiveMod(
        design.anchor.reduce((n, v, i) => n + v * BASES[d].u[i], 0),
        family.periodCells,
      ),
    ]),
  ) as Record<WallDirection, number>;
  if (!cells.length)
    return {
      buildingId,
      datumY: 0,
      heightCells: 0,
      bands: [],
      alignment: {
        anchor: [...design.anchor],
        familyId: family.id,
        periodCells: family.periodCells,
        phaseByDirection,
      },
      faceBands: [],
      boundaries: [],
      traces: [],
    };
  let datumY = Infinity,
    top = -Infinity;
  for (const c of cells) {
    datumY = Math.min(datumY, c[1]);
    top = Math.max(top, c[1]);
  }
  const heightCells = top - datumY + 1,
    counts = verticalCounts(heightCells, style);
  const program = profile ? style.programs!.find((p) => p.id === profile.programId)! : undefined;
  const allocation = program ? allocateProgram(heightCells, program, datumY === style.groundY) : undefined;
  const bands = sectionBands(
    datumY,
    allocation?.sections ?? VERTICAL_BANDS.map((b) => ({ id: b, count: counts[b] })),
  );

  const walls = surfaces.filter((s) => s.componentId === buildingId && s.role === 'wall');
  const mass = style.massPolicy ? analyzeMass(cells, style.massPolicy) : undefined;
  const { faceBands, zones } = assignWallRows(walls, bands, mass, program, style.groundY);
  return {
    buildingId,
    datumY,
    heightCells,
    bands,
    ...(profile ? { profile } : {}),
    ...(mass ? { mass, zones } : {}),
    alignment: {
      anchor: [...design.anchor],
      familyId: family.id,
      periodCells: family.periodCells,
      phaseByDirection,
    },
    faceBands,
    boundaries: verticalBoundaries(walls, faceBands),
    traces: [
      {
        id: `vertical:${buildingId}`,
        ownerId: buildingId,
        ruleId: 'banded-facade-v1',
        ruleVersion: String(style.version),
        sourceRefs: [{ kind: 'building', id: buildingId }],
        selectedIds: bands.map((b) => b.band),
        candidates: [
          {
            candidateId: 'height-split',
            accepted: true,
            reasonCodes: allocation?.reasons ?? counts.reasonCodes,
            metrics: {
              height: heightCells,
              base: counts.base,
              body: counts.body,
              crown: counts.crown,
              requestedBase: counts.requestedBase,
              requestedCrown: counts.requestedCrown,
              family: family.id,
              ...(profile ? { program: profile.programId } : {}),
            },
            conflictIds: [],
          },
        ],
      },
    ],
  };
}

function assignWallRows(
  walls: readonly Surface[],
  bands: VerticalPlan['bands'],
  mass: MassRelations | undefined,
  program: import('./architectural-program').ArchitecturalProgram | undefined,
  groundY: number,
): Pick<VerticalPlan, 'faceBands' | 'zones'> {
  const scopeColumns = new Map(mass?.scopes.flatMap((s) => s.columns.map((c) => [c, s] as const)) ?? []);
  const globalRows = rowsByHeight(bands);
  const scopedRows = new Map(
    mass?.scopes.map((scope) => [
      scope.id,
      programRows(scope.yMin, scope.yMaxExclusive, groundY, program!),
    ]) ?? [],
  );
  const zones: NonNullable<VerticalPlan['zones']> = [],
    zoneMap = new Map<string, (typeof zones)[number]>();
  const faceBands = walls.map((s) => {
    const scope = scopeColumns.get(`${s.cell[0]},${s.cell[2]}`);
    const { band, rowRole } =
      (scope ? scopedRows.get(scope.id)!.get(s.cell[1]) : undefined) ?? globalRows.get(s.cell[1])!;
    if (mass) {
      const massId = scope?.id ?? 'building',
        regionId = s.architecture?.regionId ?? `${s.direction}:${s.faceId}`,
        key = `${massId}|${band.band}|${regionId}`;
      let zone = zoneMap.get(key);
      if (!zone) {
        zone = {
          id: `zone:${key}`,
          massId,
          regionId,
          sectionId: band.band,
          yMin: band.yMin,
          yMaxExclusive: band.yMaxExclusive,
          faceIds: [],
        };
        zoneMap.set(key, zone);
        zones.push(zone);
      }
      zone.faceIds.push(s.faceId);
    }
    return { faceId: s.faceId, band: band.band, rowRole };
  });

  return { faceBands, zones };
}
