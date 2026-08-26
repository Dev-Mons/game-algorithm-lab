import type { ScenarioDefinition } from '../core/types';

export const SCENARIOS: readonly ScenarioDefinition[] = [
  {
    id: 'open-field',
    name: 'Open Field',
    description: '장애물 없는 넓은 공간에서 기본 군집 흐름을 확인합니다.',
    goal: { x: 1080, y: 360 },
    obstacles: [],
    spawn: { x: 70, y: 90, width: 330, height: 540 },
  },
  {
    id: 'obstacle-field',
    name: 'Obstacle Field',
    description: '중앙 장벽을 위아래 통로로 우회하는 Flow Field를 확인합니다.',
    goal: { x: 1080, y: 360 },
    obstacles: [
      { x: 504, y: 120, width: 72, height: 480 },
      { x: 744, y: 0, width: 48, height: 240 },
      { x: 744, y: 480, width: 48, height: 240 },
    ],
    spawn: { x: 65, y: 125, width: 310, height: 470 },
  },
  {
    id: 'dense-spawn',
    name: 'Dense Spawn',
    description: '좁은 시작 영역에서 Separation과 Spatial Hash 안정성을 확인합니다.',
    goal: { x: 1080, y: 360 },
    obstacles: [],
    spawn: { x: 90, y: 245, width: 190, height: 230 },
  },
];

export function getScenario(id: string): ScenarioDefinition {
  return SCENARIOS.find((scenario) => scenario.id === id) ?? SCENARIOS[0]!;
}
