import type { CrowdSimulation } from '../core/simulation';
import type { Rect, ScenarioDefinition, Vec2 } from '../core/types';

export const LAB_SCENARIOS: readonly ScenarioDefinition[] = [
  {
    id: 'narrow-door', name: '좁은 문', description: '72px 문으로 1,000명이 합류합니다. 큰 반경과 처리량을 비교하세요.',
    spawn: { x: 48, y: 60, width: 360, height: 600 }, goal: { x: 1080, y: 360 },
    obstacles: [{ x: 576, y: 0, width: 48, height: 324 }, { x: 576, y: 396, width: 48, height: 324 }],
    routeGates: [{ id: 'door', region: { x: 568, y: 324, width: 64, height: 72 } }],
  },
  {
    id: 'bidirectional-corridor', name: '양방향 통로', description: '반대 목표를 가진 50:50 흐름. Q의 방향별 대기·점유와 회피만의 결과를 비교합니다.',
    spawn: { x: 36, y: 96, width: 300, height: 528 }, goal: { x: 1110, y: 360 },
    obstacles: [{ x: 432, y: 0, width: 336, height: 324 }, { x: 432, y: 396, width: 336, height: 324 }],
    flows: [
      { id: 'east', spawn: { x: 36, y: 96, width: 300, height: 528 }, goal: { x: 1110, y: 360 } },
      { id: 'west', spawn: { x: 864, y: 96, width: 300, height: 528 }, goal: { x: 90, y: 360 } },
    ],
    routeGates: [{ id: 'corridor', region: { x: 416, y: 324, width: 368, height: 72 } }],
  },
  {
    id: 'crossing-streams', name: '직각 교차', description: '독립 목적지 네 개를 향하는 흐름이 중앙에서 교차합니다.',
    spawn: { x: 24, y: 240, width: 260, height: 240 }, goal: { x: 1110, y: 360 }, obstacles: [],
    flows: [
      { id: 'east', spawn: { x: 24, y: 240, width: 260, height: 240 }, goal: { x: 1110, y: 360 } },
      { id: 'west', spawn: { x: 916, y: 240, width: 260, height: 240 }, goal: { x: 90, y: 360 } },
      { id: 'south', spawn: { x: 360, y: 24, width: 480, height: 168 }, goal: { x: 600, y: 660 } },
      { id: 'north', spawn: { x: 360, y: 528, width: 480, height: 168 }, goal: { x: 600, y: 60 } },
    ],
  },
  {
    id: 'crowded-goal', name: '목적지 밀집', description: '작은 목적지 주변. exit는 제거, slots는 도착자 점유 유지·수용량 부족 대기를 구분합니다.',
    spawn: { x: 48, y: 84, width: 384, height: 552 }, goal: { x: 1020, y: 360 },
    obstacles: [{ x: 936, y: 168, width: 240, height: 48 }, { x: 936, y: 504, width: 240, height: 48 }],
  },
  {
    id: 'dynamic-blocking', name: '동적 길막', description: 'Step 180에 중앙 벽 설치, 540에 철거. 같은 명령을 모든 preset에 재생합니다.',
    spawn: { x: 48, y: 96, width: 300, height: 528 }, goal: { x: 1110, y: 360 }, obstacles: [],
  },
];

export type LabCommand = { step: number; type: 'goal'; goal: Vec2 }
  | { step: number; type: 'obstacles'; obstacles: Rect[] }
  | { step: number; type: 'agent-goals'; goals: Array<{ agent: number; goal: Vec2 }> };

export function defaultCommands(scenario: ScenarioDefinition, scale = 1): LabCommand[] {
  if (scenario.id !== 'dynamic-blocking') return [];
  return [
    { step: 180, type: 'obstacles', obstacles: [{ x: 720 * scale, y: 132 * scale, width: 48 * scale, height: 456 * scale }] },
    { step: 540, type: 'obstacles', obstacles: [] },
  ];
}

export function applyCommands(simulation: CrowdSimulation, commands: readonly LabCommand[]): void {
  for (const command of commands) {
    if (command.step !== simulation.stepCount) continue;
    if (command.type === 'goal') simulation.setGoal(command.goal.x, command.goal.y);
    else if (command.type === 'agent-goals') simulation.setAgentGoals(command.goals);
    else simulation.updateObstacles(command.obstacles.map(obstacle => ({ ...obstacle })));
  }
}

/** Equal density scaling keeps radius, gap, speed, dt and grid resolution fixed. */
export function scaleScenario(scenario: ScenarioDefinition, scale: number): ScenarioDefinition {
  const point = (p: Vec2): Vec2 => ({ x: p.x * scale, y: p.y * scale });
  const rect = (r: Rect): Rect => ({ ...point(r), width: r.width * scale, height: r.height * scale });
  return {
    ...scenario, goal: point(scenario.goal), spawn: rect(scenario.spawn), obstacles: scenario.obstacles.map(rect),
    flows: scenario.flows?.map(flow => ({ ...flow, goal: point(flow.goal), spawn: rect(flow.spawn) })),
    routeGates: scenario.routeGates?.map(gate => ({ ...gate, region: rect(gate.region) })),
  };
}
