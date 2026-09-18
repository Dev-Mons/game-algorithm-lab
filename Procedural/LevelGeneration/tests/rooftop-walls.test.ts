import { expect, it } from 'vitest';
import { analyzeVolume, generate, DEFAULT_CATALOG, DEFAULT_RULES, validateCoverage, type Vec3, type Rule } from '../src/core/generate';
import { createDocument, replaceGrid, exportDocument, loadDocument } from '../src/core/document';
import { generateDocument } from '../src/core/generate-document';
import { EnvironmentCache } from '../src/core/environment-cache';
import { SHOP_STYLE, OFFICE_STYLE, validateBuildingStyle } from '../src/core/building-style';
import { faceAssetBounds, faceBounds16, containedInUnion, boxesOverlap, cellBox16 } from '../src/core/placement-bounds';
import { ROOFTOP_FACADE_ASSETS, type RooftopFacadeKey } from '../src/core/rooftop-facade-assets';
import { box } from '../src/fixtures';

const stepped = box(6, 5, 4).filter(([x, y]) => y < 2 || x >= 3);
const face = (result: ReturnType<typeof analyzeVolume>, id: string) => result.surfaces.find(s => s.faceId === id)!;

it.each(['component-height-v1', 'region-context-v1'] as const)('classifies local rooftop walls independently of horizontal roles under %s', policy => {
  const result = analyzeVolume(stepped, policy);
  for (const id of ['0,1,0|NX', '0,1,0|NZ', '2,1,3|PZ', '5,4,3|PX'])
    expect(face(result, id).wallKind, id).toBe('rooftop');
  for (const id of ['0,0,0|NX', '5,3,3|PX', '3,2,0|NX'])
    expect(face(result, id).wallKind, id).toBe('regular');
  expect(result.surfaces.filter(s => s.direction === 'PY' || s.direction === 'NY').every(s => s.wallKind === undefined)).toBe(true);
  const covered = analyzeVolume([[0,0,0],[0,1,0],[0,2,0],[1,0,0],[1,2,0]], policy);
  expect(face(covered, '1,0,0|PX').wallKind).toBe('regular');
  expect(face(covered, '1,2,0|PX').wallKind).toBe('rooftop');
});

it('supports rooftop/regular predicates with deterministic selection and normal fallback', () => {
  const rules: Rule[] = ['rooftop', 'regular'].map(kind => ({
    ruleId: `test.${kind}`, priority: 200, roles: ['wall'], orientationIds: ['PX','NX','PZ','NZ'],
    predicate: kind === 'rooftop' ? 'rooftop-wall' : 'regular-wall', tileIds: [`test.${kind}`],
  }));
  const catalog = [...DEFAULT_CATALOG, ...rules.map(r => ({ ...DEFAULT_CATALOG[0], tileId: r.ruleId }))];
  const result = generate(stepped, { rules: [...DEFAULT_RULES, ...rules], catalog });
  for (const trace of result.traces.filter(t => t.role === 'wall'))
    expect(trace.selection.tileId).toBe(`test.${trace.wallKind}`);
  expect(generate([...stepped].reverse(), { rules: [...rules, ...DEFAULT_RULES].reverse(), catalog: [...catalog].reverse() })).toEqual(result);
  const fallback = generate(stepped, { rules: [...DEFAULT_RULES, { ...rules[0], tileIds: ['absent'] }], catalog });
  expect(fallback.counters.fallbackCount).toBe(0);
  expect(fallback.traces.find(t => t.wallKind === 'rooftop')!.selection.tileId).toBe('panel.wall');
});

it.each(['shop', 'office'] as const)('selects %s rooftop geometry in every palette without losing facade openings or coverage', profile => {
  const palettes = new Set<string>();
  for (const seed of [0, 1, 3]) {
    const doc = createDocument(stepped, seed, profile), result = generateDocument(doc);
    const tiles = new Map(doc.catalog.tiles.map(t => [t.tileId, t]));
    expect(result.status).toBe('ok');
    expect(validateCoverage(result.surfaces.map(s => s.faceId), result.placements)).toEqual([]);
    for (const trace of result.traces.filter(t => t.role === 'wall')) {
      const tile = tiles.get(trace.selection.tileId)!;
      expect(tile.assetKey.startsWith('facade.rooftop-'), trace.faceId).toBe(trace.wallKind === 'rooftop');
      expect(tile.assetKey).toContain(profile);
      expect(tile.palette).toBe(trace.architecture!.palette);
      palettes.add(tile.palette!);
      if (trace.wallKind !== 'rooftop') continue;
      expect(trace.selection.ruleId).toBe('building.rooftop-wall');
      const placement = result.placements.find(p => p.faceId === trace.faceId)!;
      const bounds = faceBounds16(faceAssetBounds(tile.assetKey), placement.position2, placement.orientationId);
      expect(containedInUnion(bounds, result.environment!.preflight[0].envelope.requiredBoxes16)).toBe(true);
      const descriptor = ROOFTOP_FACADE_ASSETS[tile.assetKey as RooftopFacadeKey];
      const parapet = descriptor.reliefBoxes16.filter(b => b.min[1] >= 8);
      expect(parapet.length).toBeGreaterThan(0);
      for (const local of parapet) {
        const world = faceBounds16(local, placement.position2, placement.orientationId);
        expect(stepped.some(c => boxesOverlap(world, cellBox16(c)))).toBe(false);
      }
    }
    expect(new Set(result.surfaces.filter(s => s.wallKind === 'rooftop').map(s => s.cell[1]))).toEqual(new Set([1, 4]));
  }
  expect(palettes).toEqual(new Set(['clay','sage','sand']));
});

it('rebuilds roof positions after add/remove, including warm cache and serialization', () => {
  const cache = new EnvironmentCache(), doc = createDocument(box(2, 1, 2), 42, 'shop');
  const raised = replaceGrid(doc, [...doc.grid, [0,1,0]]);
  for (const current of [doc, raised, replaceGrid(raised, doc.grid)]) {
    const cold = generateDocument(current, { cache: false });
    expect(generateDocument(current, { cache })).toEqual(cold);
    expect(generateDocument(current, { cache })).toEqual(cold);
    expect(generateDocument(loadDocument(exportDocument(current)), { cache })).toEqual(cold);
    const base = cold.traces.find(t => t.faceId === '0,0,0|NX')!;
    expect(base.wallKind).toBe(current.grid.length === 5 ? 'regular' : 'rooftop');
    expect(base.selection.tileId.startsWith('facade.rooftop-')).toBe(current.grid.length !== 5);
    if (current.grid.length === 5) expect(cold.traces.find(t => t.faceId === '0,1,0|NX')!.wallKind).toBe('rooftop');
  }
});

it('keeps rooftop variants optional for existing styles and validates authored variant groups', () => {
  const legacy = structuredClone(SHOP_STYLE);
  legacy.version = 4;
  legacy.modules.forEach(m => delete m.rooftopAssets);
  const doc = createDocument(box(2,1,2), 42, 'shop', legacy);
  const result = generateDocument(doc);
  expect(result.placements.some(p => p.tileId.startsWith('facade.rooftop-'))).toBe(false);
  expect(Math.max(...result.environment!.preflight[0].envelope.requiredBoxes16.map(b => b.max[1]))).toBe(16);
  const saved = JSON.parse(JSON.stringify(doc));
  saved.catalog.version = 2;
  saved.catalog.tiles = saved.catalog.tiles.filter((t: { assetKey: string }) => !t.assetKey.startsWith('facade.rooftop-'));
  const loaded = loadDocument(JSON.stringify(saved));
  expect(loaded.catalog.version).toBe(3);
  expect(loaded.buildingDefinition).toEqual(legacy);
  saved.catalog.tiles[0].assetKey = 'unit-panel';
  expect(() => loadDocument(JSON.stringify(saved))).toThrow();
  for (const style of [SHOP_STYLE, OFFICE_STYLE]) {
    const invalid = structuredClone(style);
    invalid.modules.find(m => m.id === 'body-left')!.rooftopAssets!.repeat = 'facade.rooftop-banded-shop-body-repeat-cap-right';
    expect(() => validateBuildingStyle(invalid)).toThrow('INVALID_BANDED_BUILDING_STYLE');
  }
});
