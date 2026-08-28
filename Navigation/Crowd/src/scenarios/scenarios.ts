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
  {
    id: 'different-capacity-gates',
    name: 'Wide + Narrow Gates',
    description: '폭이 다른 두 관문에서 정적 길이와 동적 처리 용량의 균형을 확인합니다.',
    goal: { x: 1100, y: 360 },
    obstacles: [
      { x: 520, y: 0, width: 48, height: 120 },
      { x: 520, y: 280, width: 48, height: 160 },
      { x: 520, y: 520, width: 48, height: 200 },
    ],
    spawn: { x: 70, y: 145, width: 320, height: 430 },
    routeGates: [
      { id: 'wide', region: { x: 515, y: 120, width: 58, height: 160 }, capacity: 2 },
      { id: 'narrow', region: { x: 515, y: 440, width: 58, height: 80 }, capacity: 1 },
    ],
  },
  {
    id: 'equal-capacity-congested-gates',
    name: 'Equal Gates + Early Congestion',
    description: '같은 폭의 두 관문 중 시작점에 가까운 관문이 먼저 혼잡해질 때 분산을 확인합니다.',
    goal: { x: 1100, y: 360 },
    obstacles: [
      { x: 520, y: 0, width: 48, height: 144 },
      { x: 520, y: 264, width: 48, height: 192 },
      { x: 520, y: 576, width: 48, height: 144 },
    ],
    spawn: { x: 70, y: 115, width: 320, height: 360 },
    routeGates: [
      { id: 'upper', region: { x: 515, y: 144, width: 58, height: 120 }, capacity: 1 },
      { id: 'lower', region: { x: 515, y: 456, width: 58, height: 120 }, capacity: 1 },
    ],
  },
  {
    id: 'merge-then-split',
    name: 'Merge then Split',
    description: '두 흐름이 중앙 관문에서 합류한 뒤 두 출구로 다시 분기합니다.',
    goal: { x: 1120, y: 360 },
    obstacles: [
      { x: 360, y: 0, width: 48, height: 300 },
      { x: 360, y: 420, width: 48, height: 300 },
      { x: 720, y: 240, width: 48, height: 240 },
    ],
    spawn: { x: 60, y: 80, width: 260, height: 560 },
    flows: [
      { id: 'upper-merge', spawn: { x: 60, y: 80, width: 260, height: 220 }, goal: { x: 1120, y: 360 } },
      { id: 'lower-merge', spawn: { x: 60, y: 420, width: 260, height: 220 }, goal: { x: 1120, y: 360 } },
    ],
    routeGates: [
      { id: 'upper-split', region: { x: 715, y: 80, width: 58, height: 160 }, capacity: 1 },
      { id: 'lower-split', region: { x: 715, y: 480, width: 58, height: 160 }, capacity: 1 },
    ],
  },
  {
    id: 'opposing-occupied-corridor',
    name: 'Opposing Occupied Corridor',
    description: '두 관문 중 하나를 반대 흐름이 점유할 때 flow별 counter-flow 비용과 우회를 확인합니다.',
    goal: { x: 1110, y: 210 },
    obstacles: [
      { x: 520, y: 0, width: 48, height: 144 },
      { x: 520, y: 264, width: 48, height: 192 },
      { x: 520, y: 576, width: 48, height: 144 },
    ],
    spawn: { x: 60, y: 120, width: 300, height: 260 },
    flows: [
      { id: 'eastbound', spawn: { x: 60, y: 120, width: 300, height: 260 }, goal: { x: 1110, y: 210 } },
      { id: 'westbound', spawn: { x: 840, y: 150, width: 300, height: 360 }, goal: { x: 90, y: 520 } },
    ],
    routeGates: [
      { id: 'upper', region: { x: 515, y: 144, width: 58, height: 120 }, capacity: 1 },
      { id: 'lower', region: { x: 515, y: 456, width: 58, height: 120 }, capacity: 1 },
    ],
  },
];

export function getScenario(id: string): ScenarioDefinition {
  return SCENARIOS.find((scenario) => scenario.id === id) ?? SCENARIOS[0]!;
}
