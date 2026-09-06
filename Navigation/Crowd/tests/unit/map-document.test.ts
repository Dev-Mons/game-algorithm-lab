import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, CrowdSimulation } from '../../src/core/simulation';
import {
  MAP_STORAGE_KEY, MapHistory, loadMaps, mapFromScenario, parseMap, saveMap, scenarioFromMap, validateMap,
} from '../../src/editor/map-document';
import { getScenario, SCENARIOS } from '../../src/scenarios/scenarios';

const flat = () => mapFromScenario(getScenario('open-field'));

describe('custom map documents', () => {
  it.each(SCENARIOS.map((scenario) => scenario.id))('copies and validates %s without modifying the built-in', (id) => {
    const original = getScenario(id);
    const snapshot = JSON.stringify(original);
    const map = parseMap(JSON.parse(JSON.stringify(mapFromScenario(original))));
    expect(validateMap(map, DEFAULT_CONFIG)).toContain('연결됨');
    const restored = scenarioFromMap(map, 'custom-test');
    expect(restored.obstacles).toEqual(original.obstacles);
    expect(restored.flows?.map((flow) => flow.spawn)).toEqual(original.flows?.map((flow) => flow.spawn) ?? [original.spawn]);
    restored.goal.x = 12;
    restored.obstacles.push({ x: 600, y: 0, width: 24, height: 720 });
    map.spawns[0]!.x = 99;
    expect(JSON.stringify(original)).toBe(snapshot);
  });

  it('rejects broken routes, walls over spawns, and invalid goal placement before applying', () => {
    const map = flat();
    map.obstacles = [{ x: 600, y: 0, width: 24, height: 720 }];
    expect(() => validateMap(map, DEFAULT_CONFIG)).toThrow('목적지로 갈 수 없습니다');
    map.obstacles = [{ ...map.spawns[0]! }];
    expect(() => validateMap(map, DEFAULT_CONFIG)).toThrow('장애물과 겹칩니다');
    map.obstacles = [{ x: 1050, y: 300, width: 60, height: 120 }];
    expect(() => validateMap(map, DEFAULT_CONFIG)).toThrow('목적지가 벽');
  });

  it('reports insufficient spawn capacity without inventing agents', () => {
    const map = flat();
    map.spawns = [{ x: 48, y: 48, width: 36, height: 36 }];
    expect(validateMap(map, DEFAULT_CONFIG)).toContain('명만 생성');
  });

  it('rejects malformed or unbounded JSON data', () => {
    expect(() => parseMap(null)).toThrow();
    expect(() => parseMap({ ...flat(), version: 2 })).toThrow();
    expect(() => parseMap({ ...flat(), spawns: [] })).toThrow();
    expect(() => parseMap({ ...flat(), goal: { x: Infinity, y: 10 } })).toThrow();
    expect(() => parseMap({ ...flat(), obstacles: [{ x: -10, y: 0, width: 24, height: 48 }] })).toThrow();
    expect(() => parseMap({ ...flat(), spawns: Array(17).fill(flat().spawns[0]) })).toThrow();
    expect(() => parseMap({ ...flat(), obstacles: Array(257).fill({ x: 600, y: 0, width: 24, height: 48 }) })).toThrow();
  });

  it('undoes and redoes independent snapshots, clearing redo after a new edit', () => {
    const initial = flat();
    const history = new MapHistory(initial);
    const next = structuredClone(initial);
    next.goal.x = 960;
    history.commit(next);
    next.goal.x = 100;
    expect(history.current.goal.x).toBe(960);
    history.undo();
    expect(history.current).toEqual(initial);
    history.redo();
    expect(history.current.goal.x).toBe(960);
    history.undo();
    history.commit({ ...initial, name: '다른 편집' });
    expect(history.canRedo).toBe(false);
  });

  it('persists multiple maps and updates only the requested map', () => {
    const data = new Map<string, string>();
    const storage = { getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => { data.set(key, value); } };
    saveMap(storage, { id: 'custom-one', map: flat() });
    saveMap(storage, { id: 'custom-two', map: { ...flat(), name: '두 번째' } });
    saveMap(storage, { id: 'custom-one', map: { ...flat(), name: '수정본' } });
    expect(loadMaps(storage).map((entry) => entry.map.name)).toEqual(['수정본', '두 번째']);
    data.set(MAP_STORAGE_KEY, 'invalid');
    expect(() => saveMap(storage, { id: 'custom-three', map: flat() })).toThrow();
    expect(data.get(MAP_STORAGE_KEY)).toBe('invalid');
  });

  it('runs a reimported custom map through the same deterministic bounded solver', () => {
    const map = mapFromScenario(getScenario('four-way-merge'));
    const scenario = scenarioFromMap(parseMap(JSON.parse(JSON.stringify(map))), 'custom-merge');
    const a = new CrowdSimulation({ ...DEFAULT_CONFIG, agentCount: 200 }, scenario);
    const b = new CrowdSimulation({ ...DEFAULT_CONFIG, agentCount: 200 }, getScenario('four-way-merge'));
    for (let step = 0; step < 300; step += 1) {
      a.step(); b.step();
      expect(a.metrics.wallOverlapCount).toBe(0);
      expect(a.metrics.candidateChecks).toBeLessThanOrEqual(a.state.count * 24);
      expect(a.metrics.contactConstraints).toBeLessThanOrEqual(a.state.count * 8);
    }
    expect(a.stateHash()).toBe(b.stateHash());
  });
});
