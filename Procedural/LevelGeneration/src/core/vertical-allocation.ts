import type { BuildingStyle } from './building-style';
import type { VerticalPlan, RowRole } from './vertical-design';
import { allocateProgram, type ArchitecturalProgram } from './architectural-program';
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
/** Each integer floor has one section and row role; evaluate it once per scope,
 * then reuse it for all of that floor's facade cells. */
export function rowsByHeight(bands: VerticalPlan['bands']) {
  const rows = new Map<number, { band: VerticalPlan['bands'][number]; rowRole: RowRole }>();
  for (const band of bands)
    for (let y = band.yMin; y < band.yMaxExclusive; y++)
      rows.set(y, {
        band,
        rowRole:
          band.yMaxExclusive - band.yMin === 1
            ? 'single'
            : y === band.yMin
              ? 'foot'
              : y === band.yMaxExclusive - 1
                ? 'head'
                : 'repeat',
      });
  return rows;
}
export function verticalCounts(height: number, style: Pick<BuildingStyle, 'id'>) {
  const baseRatio = style.id === 'shop' ? 250 : 200,
    crownRatio = style.id === 'office' ? 200 : 100;
  if (!Number.isInteger(height) || height < 0) throw new Error('INVALID_BUILDING_HEIGHT');
  if (height === 0)
    return {
      base: 0,
      body: 0,
      crown: 0,
      requestedBase: 0,
      requestedCrown: 0,
      reasonCodes: ['EMPTY_BUILDING'],
    };
  if (style.id === 'tower11-d')
    return { base: 1, body: height - 1, crown: 0, requestedBase: 1, requestedCrown: 0, reasonCodes: [] };
  const requestedBase = Math.floor((height * baseRatio + 500) / 1000);
  const requestedCrown = Math.floor((height * crownRatio + 500) / 1000);
  if (height <= 3)
    return {
      base: 1,
      body: height - 1,
      crown: 0,
      requestedBase,
      requestedCrown,
      reasonCodes: ['SHORT_BUILDING_COLLAPSE'],
    };
  const base = clamp(requestedBase, height >= 8 ? 2 : 1, Math.min(4, height - 2));
  const crown = clamp(requestedCrown, 1, Math.min(3, height - base - 1));
  return {
    base,
    body: height - base - crown,
    crown,
    requestedBase,
    requestedCrown,
    reasonCodes: requestedBase !== base || requestedCrown !== crown ? ['BAND_COUNTS_CLAMPED'] : [],
  };
}

export function sectionBands(
  datumY: number,
  sections: readonly { id: string; count: number }[],
): VerticalPlan['bands'] {
  const bands: VerticalPlan['bands'] = [];
  let y = datumY;
  for (const section of sections) {
    if (section.count) bands.push({ band: section.id, yMin: y, yMaxExclusive: y + section.count });
    y += section.count;
  }
  return bands;
}
export function programRows(
  yMin: number,
  yMaxExclusive: number,
  groundY: number,
  program: ArchitecturalProgram,
) {
  return rowsByHeight(
    sectionBands(yMin, allocateProgram(yMaxExclusive - yMin, program, yMin === groundY).sections),
  );
}
