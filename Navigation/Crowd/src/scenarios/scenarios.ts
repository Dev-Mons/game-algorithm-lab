import type { ScenarioDefinition } from '../core/types';
import { LAB_SCENARIOS } from './lab-scenarios';
import { ROCKY_PASS } from './rocky-pass';

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
    id: 'winding-corners',
    name: '연속 코너',
    description: '좌측 상단에서 출발해 아래→위→아래로 이어지는 세 장벽의 코너를 돌아 우측 하단에 도착합니다.',
    goal: { x: 1116, y: 612 },
    spawn: { x: 48, y: 48, width: 240, height: 288 },
    obstacles: [
      { x: 360, y: 0, width: 48, height: 504 },
      { x: 624, y: 216, width: 48, height: 504 },
      { x: 888, y: 0, width: 48, height: 504 },
    ],
  },
  {
    id: 'funnel-bypass',
    name: '깔때기와 우회로',
    description: '상단 길은 폭 288→72로 좁아지는 깔때기, 하단 길은 폭 168의 우회로입니다. 하나의 고정 경로 필드를 따라 병목을 통과합니다.',
    goal: { x: 1116, y: 360 },
    spawn: { x: 48, y: 120, width: 288, height: 240 },
    // Rectangular strips approximate a taper without introducing another collision primitive.
    obstacles: [
      ...Array.from({ length: 10 }, (_, index) => {
        const inset = index * 12;
        return [
          { x: 432 + index * 48, y: 0, width: 48, height: 72 + inset },
          { x: 432 + index * 48, y: 360 - inset, width: 48, height: 144 + inset },
        ];
      }).flat(),
      { x: 432, y: 672, width: 480, height: 48 },
    ],
    routeGates: [
      { id: 'funnel', region: { x: 864, y: 180, width: 48, height: 72 }, capacity: 1 },
      { id: 'bypass', region: { x: 864, y: 504, width: 48, height: 168 }, capacity: 168 / 72 },
    ],
  },
  {
    id: 'four-way-merge',
    name: '네 생성 지점 합류',
    description: '좌측의 네 생성 구역에서 같은 수의 유닛이 출발해 통로 끝에서 합류하고, 우측 하단의 한 목적지로 이동합니다.',
    goal: { x: 1116, y: 612 },
    spawn: { x: 48, y: 36, width: 240, height: 648 },
    obstacles: [
      { x: 0, y: 168, width: 432, height: 24 },
      { x: 0, y: 348, width: 432, height: 24 },
      { x: 0, y: 528, width: 432, height: 24 },
    ],
    flows: [36, 216, 396, 576].map((y, index) => ({
      id: `inlet-${index + 1}`,
      spawn: { x: 48, y, width: 240, height: 108 },
      goal: { x: 1116, y: 612 },
    })),
  },
  ROCKY_PASS,
  ...LAB_SCENARIOS,
];

export function getScenario(id: string): ScenarioDefinition {
  return SCENARIOS.find((scenario) => scenario.id === id) ?? SCENARIOS[0]!;
}
