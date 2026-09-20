import { FlowField } from '../algorithms/flow-field/flow-field';
import { distanceSquaredToRect } from '../core/obstacle-collision';
import { createSpawnLayout } from '../core/spawn-layout';
import type { Rect, ScenarioDefinition, SimulationConfig, Vec2 } from '../core/types';

export const MAP_STORAGE_KEY = 'crowd-lab.maps.v1';
export const CUSTOM_MAP_PREFIX = 'custom-';
export const MAX_OBSTACLES = 256;
export const MAX_SPAWNS = 16;

export interface MapDocument {
  version: 1;
  name: string;
  width: 1200;
  height: 720;
  obstacles: Rect[];
  spawns: Rect[];
  goal: Vec2;
}

export interface SavedMap { id: string; map: MapDocument }

export function mapFromScenario(scenario: ScenarioDefinition): MapDocument {
  return structuredClone({
    version: 1, name: scenario.name, width: 1200, height: 720,
    obstacles: scenario.obstacles,
    spawns: scenario.flows?.map((flow) => flow.spawn) ?? [scenario.spawn],
    goal: scenario.goal,
  });
}

export function scenarioFromMap(map: MapDocument, id: string): ScenarioDefinition {
  const copy = structuredClone(map);
  return {
    id, name: copy.name, description: `사용자 맵 · 생성 영역 ${copy.spawns.length}곳 · 장애물 ${copy.obstacles.length}개`,
    obstacles: copy.obstacles, goal: copy.goal, spawn: copy.spawns[0]!,
    flows: copy.spawns.map((spawn, index) => ({ id: `spawn-${index + 1}`, spawn, goal: { ...copy.goal } })),
  };
}

/** Explicitly reconstruct external data: no untrusted properties reach the engine or UI. */
export function parseMap(value: unknown): MapDocument {
  const data = object(value);
  if (data.version !== 1 || data.width !== 1200 || data.height !== 720) {
    throw new Error('버전 1, 크기 1200 × 720인 맵 JSON이 필요합니다.');
  }
  if (typeof data.name !== 'string' || !data.name.trim() || data.name.trim().length > 60) {
    throw new Error('맵 이름은 1~60자로 입력하세요.');
  }
  function rectangles(value: unknown, label: string, min: number, max: number): Rect[] {
    if (!Array.isArray(value) || value.length < min || value.length > max) {
      throw new Error(`${label}은 ${min}~${max}개여야 합니다.`);
    }
    return value.map((item) => {
      const rect = object(item);
      const x = finite(rect.x), y = finite(rect.y);
      const width = finite(rect.width), height = finite(rect.height);
      if (x < 0 || y < 0 || width < 4 || height < 4 || x + width > 1200 || y + height > 720) {
        throw new Error(`${label}은 맵 안에 있어야 하며 가로·세로가 4 이상이어야 합니다.`);
      }
      return { x, y, width, height };
    });
  }
  const goal = object(data.goal);
  const x = finite(goal.x), y = finite(goal.y);
  if (x < 0 || x >= 1200 || y < 0 || y >= 720) throw new Error('목적지를 맵 안에 놓아주세요.');
  return {
    version: 1, name: data.name.trim(), width: 1200, height: 720,
    obstacles: rectangles(data.obstacles, '장애물', 0, MAX_OBSTACLES),
    spawns: rectangles(data.spawns, '생성 영역', 1, MAX_SPAWNS), goal: { x, y },
  };
}

export function validateMap(map: MapDocument, config: SimulationConfig): string {
  const valid = parseMap(map);
  const clearance = config.agentRadius + config.wallMargin;
  if (valid.goal.x < clearance || valid.goal.y < clearance
    || valid.goal.x > valid.width - clearance || valid.goal.y > valid.height - clearance
    || valid.obstacles.some((rect) => distanceSquaredToRect(valid.goal.x, valid.goal.y, rect) < clearance ** 2)) {
    throw new Error('목적지가 벽과 너무 가깝습니다. 빈 공간으로 옮겨주세요.');
  }
  for (let index = 0; index < valid.spawns.length; index += 1) {
    const spawn = valid.spawns[index]!;
    if (valid.obstacles.some((wall) => intersects(spawn, wall))) {
      throw new Error(`생성 영역 ${index + 1}이 장애물과 겹칩니다.`);
    }
    if (valid.spawns.slice(0, index).some((other) => intersects(spawn, other))) {
      throw new Error(`생성 영역 ${index + 1}이 다른 생성 영역과 겹칩니다.`);
    }
  }
  const scenario = scenarioFromMap(valid, 'validation');
  const navigation = new FlowField(config.width, config.height, config.navCellSize);
  navigation.rebuild(valid.goal, valid.obstacles, clearance);
  const goalCell = Math.floor(valid.goal.y / config.navCellSize) * navigation.columns
    + Math.floor(valid.goal.x / config.navCellSize);
  if (navigation.blocked[goalCell]) throw new Error('목적지 주변의 공간이 너무 좁습니다. 넓은 곳으로 옮겨주세요.');
  const points = createSpawnLayout({
    count: config.agentCount, seed: config.seed, agentRadius: config.agentRadius, agentGap: config.agentGap,
    largeAgentPercent: config.largeAgentPercent, largeAgentScale: config.largeAgentScale,
    wallMargin: config.wallMargin, worldWidth: config.width, worldHeight: config.height,
    obstacles: valid.obstacles, flows: scenario.flows!,
  });
  if (points.length === 0) throw new Error('생성할 공간이 없습니다. 생성 영역을 넓혀주세요.');
  const represented = new Set(points.map((point) => point.flow));
  if (represented.size < Math.min(config.agentCount, valid.spawns.length)) {
    throw new Error('일부 생성 영역에 유닛이 들어갈 공간이 없습니다. 영역을 넓혀주세요.');
  }
  const sizeNavigation = new Map<number, FlowField>([[config.agentRadius, navigation]]);
  for (const point of points) {
    let navigator = sizeNavigation.get(point.radius);
    if (!navigator) {
      navigator = new FlowField(config.width, config.height, config.navCellSize);
      navigator.rebuild(valid.goal, valid.obstacles, point.radius + config.wallMargin);
      sizeNavigation.set(point.radius, navigator);
    }
    const cell = Math.floor(point.y / config.navCellSize) * navigator.columns + Math.floor(point.x / config.navCellSize);
    if (!Number.isFinite(navigator.staticPotential[cell])) {
      throw new Error(`생성 영역 ${point.flow + 1}에서 목적지로 갈 수 없습니다. 벽을 열거나 통로를 넓혀주세요.`);
    }
  }
  return points.length < config.agentCount
    ? `공간 부족으로 ${config.agentCount.toLocaleString()}명 중 ${points.length.toLocaleString()}명만 생성됩니다.`
    : `${points.length.toLocaleString()}명 생성 가능 · 목적지까지 연결됨`;
}

export function loadMaps(storage: Pick<Storage, 'getItem'>): SavedMap[] {
  const raw = storage.getItem(MAP_STORAGE_KEY);
  if (!raw) return [];
  if (raw.length > 2_000_000) throw new Error('저장된 맵 데이터가 너무 큽니다.');
  const data: unknown = JSON.parse(raw);
  if (!Array.isArray(data) || data.length > 30) throw new Error('저장된 맵 목록을 읽을 수 없습니다.');
  const ids = new Set<string>();
  return data.map((entry) => {
    const value = object(entry);
    if (typeof value.id !== 'string' || !/^custom-[\w-]{1,80}$/.test(value.id) || ids.has(value.id)) {
      throw new Error('저장된 맵 ID가 잘못되었습니다.');
    }
    ids.add(value.id);
    return { id: value.id, map: parseMap(value.map) };
  });
}

export function saveMap(storage: Pick<Storage, 'getItem' | 'setItem'>, entry: SavedMap): void {
  const maps = loadMaps(storage);
  const index = maps.findIndex((saved) => saved.id === entry.id);
  const safe = { id: entry.id, map: parseMap(entry.map) };
  if (index >= 0) maps[index] = safe;
  else {
    if (maps.length >= 30) throw new Error('브라우저에는 최대 30개 맵을 저장할 수 있습니다. JSON으로 내보내주세요.');
    maps.push(safe);
  }
  storage.setItem(MAP_STORAGE_KEY, JSON.stringify(maps));
}

export class MapHistory {
  private past: MapDocument[] = [];
  private future: MapDocument[] = [];
  constructor(public current: MapDocument) {}
  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }
  commit(next: MapDocument): void {
    if (JSON.stringify(next) === JSON.stringify(this.current)) return;
    this.past.push(structuredClone(this.current));
    if (this.past.length > 50) this.past.shift();
    this.current = structuredClone(next);
    this.future = [];
  }
  undo(): void {
    const previous = this.past.pop();
    if (!previous) return;
    this.future.push(this.current);
    this.current = previous;
  }
  redo(): void {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(this.current);
    this.current = next;
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('올바른 맵 JSON이 아닙니다.');
  return value as Record<string, unknown>;
}
function finite(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('좌표와 크기는 유한한 숫자여야 합니다.');
  return value;
}
function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
