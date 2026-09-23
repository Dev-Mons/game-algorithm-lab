import type { Direction } from './analysis';
import type { BuildingStyle, FacadeKind, FacadePattern } from './building-style';
import type { FacadeTrace, PatternRunBand } from './facade-contract';
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
type PatternRun = {
  width: number;
  start: number;
  anchor: number;
  level: PatternRunBand;
  kind: FacadeKind;
  direction: Direction;
};
type PatternFit = { pattern: FacadePattern; filler: number; prefix: number; repeats: number };

/** Per evaluation indexes only: no retained style cache or invalidation policy. */
export function patternLookup(style: BuildingStyle) {
  return {
    modules: new Map(style.modules.map((m) => [m.id, m])),
    patterns: new Map(style.patterns.map((p) => [p.id, p])),
  };
}
function compareFits(a: PatternFit, b: PatternFit) {
  return (
    Number(a.filler !== 0) - Number(b.filler !== 0) ||
    a.filler - b.filler ||
    b.pattern.priority - a.pattern.priority ||
    cmp(a.pattern.id, b.pattern.id)
  );
}

export function chooseFacadePattern(style: BuildingStyle, run: PatternRun, forced?: string) {
  return fitFacadePattern(patternLookup(style), run, forced);
}

function rejectionReason(
  pattern: FacadePattern,
  run: PatternRun,
  lookup: ReturnType<typeof patternLookup>,
  forced?: string,
): string {
  // Module compatibility overrides the other diagnostic reasons in authored rules.
  const keys = [...pattern.start, ...pattern.repeat, ...pattern.end, pattern.remainder];
  if (
    keys.some(
      (key) =>
        !run.level.moduleSet.includes(key) || !lookup.modules.get(key)!.directions.includes(run.direction),
    )
  )
    return 'module-set-or-direction';
  if (forced && pattern.id !== forced) return 'shared-floor-pattern';
  if (!pattern.roles.includes(run.level.role)) return 'level-role';
  if (!pattern.facades.includes(run.kind)) return 'facade-kind';
  if (run.width < pattern.minWidth) return 'minimum-width';
  return '';
}
function measureFit(pattern: FacadePattern, run: PatternRun): PatternFit {
  // Authored start pieces precede alignment filler, which uses absolute wall U.
  const period = pattern.repeat.length;
  const prefix = run.level.align
    ? (((run.anchor - run.start - pattern.start.length) % period) + period) % period
    : 0;
  const repeats = Math.min(
    pattern.maxRepeat,
    Math.floor((run.width - pattern.start.length - pattern.end.length - prefix) / period),
  );
  const suffix = run.width - pattern.start.length - pattern.end.length - prefix - repeats * period;
  return { pattern, prefix, repeats, filler: prefix + suffix };
}
function materializeFit(fit: PatternFit): PatternFit & { tokens: string[] } {
  const { pattern, prefix, repeats, filler } = fit;
  const tokens = [...pattern.start];
  for (let i = 0; i < prefix; i++) tokens.push(pattern.remainder);
  for (let i = 0; i < repeats; i++) tokens.push(...pattern.repeat);
  for (let i = prefix; i < filler; i++) tokens.push(pattern.remainder);
  tokens.push(...pattern.end);
  return { ...fit, tokens };
}
export function fitFacadePattern(lookup: ReturnType<typeof patternLookup>, run: PatternRun, forced?: string) {
  const candidates: FacadeTrace['candidates'] = [];
  let bestFit: PatternFit | undefined;
  for (const id of run.level.patterns) {
    const pattern = lookup.patterns.get(id)!;
    const fit = measureFit(pattern, run);
    const reason =
      rejectionReason(pattern, run, lookup, forced) ||
      (fit.repeats < pattern.minRepeat ? 'too-short-for-complete-group' : '');
    if (reason) {
      candidates.push({ id, reason });
      continue;
    }
    if (!bestFit || compareFits(fit, bestFit) < 0) bestFit = fit;
    candidates.push({ id, filler: fit.filler, reason: fit.filler ? 'integer-remainder' : 'exact-fit' });
  }
  // Only the winner gets a width-sized array; candidates remain scalar scores.
  const best = bestFit ? materializeFit(bestFit) : undefined;
  for (const candidate of candidates) {
    if (candidate.id !== best?.pattern.id && candidate.filler !== undefined)
      candidate.reason += ':lower-ranked';
  }
  return { best, candidates };
}
