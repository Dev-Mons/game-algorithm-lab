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
    description: '중앙 장벽을 위아래 통로로 우회하는 정적 Flow Field를 확인합니다.',
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
    description: '좁은 시작 영역에서 단일 국소 솔버의 흐름과 안정성을 확인합니다.',
    goal: { x: 1080, y: 360 },
    obstacles: [],
    spawn: { x: 90, y: 230, width: 220, height: 260 },
  },
  {
    id: 'merge-500-500',
    name: 'Merge 500 + 500',
    description: '두 입구의 동일 규모 흐름이 별도 신호나 예약 없이 하나의 목표로 합류합니다.',
    goal: { x: 1090, y: 360 },
    obstacles: [],
    spawn: { x: 70, y: 105, width: 300, height: 510 },
    flows: [
      { id: 'upper', spawn: { x: 70, y: 105, width: 300, height: 205 }, goal: { x: 1090, y: 360 } },
      { id: 'lower', spawn: { x: 70, y: 410, width: 300, height: 205 }, goal: { x: 1090, y: 360 } },
    ],
  },
  {
    id: 'opposing-500-500',
    name: 'Opposing 500 + 500',
    description: '같은 공간에서 정반대 목표를 가진 두 흐름의 국소 회피를 확인합니다.',
    goal: { x: 1090, y: 360 },
    obstacles: [],
    spawn: { x: 60, y: 245, width: 310, height: 230 },
    flows: [
      { id: 'eastbound', spawn: { x: 60, y: 245, width: 310, height: 230 }, goal: { x: 1110, y: 360 } },
      { id: 'westbound', spawn: { x: 830, y: 245, width: 310, height: 230 }, goal: { x: 90, y: 360 } },
    ],
  },
  {
    id: 'crossing-500-500',
    name: 'Crossing 500 + 500',
    description: '수평·수직 흐름이 별도 교차 신호 없이 중앙 공간을 공유합니다.',
    goal: { x: 1110, y: 360 },
    obstacles: [],
    spawn: { x: 60, y: 260, width: 300, height: 200 },
    flows: [
      { id: 'eastbound', spawn: { x: 60, y: 260, width: 300, height: 200 }, goal: { x: 1110, y: 360 } },
      { id: 'southbound', spawn: { x: 500, y: 35, width: 200, height: 300 }, goal: { x: 600, y: 685 } },
    ],
  },
];

export function getScenario(id: string): ScenarioDefinition {
  return SCENARIOS.find((scenario) => scenario.id === id) ?? SCENARIOS[0]!;
}
