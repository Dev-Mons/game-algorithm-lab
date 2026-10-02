import {
  defaultBoard, defaultEconomy, defaultFlow, defaultPegSetup, defaultPlinkoParams, defaultPusherParams, defaultTray,
  type BoardDims, type EconomyConfig, type FlowConfig, type PegKind, type PegSetup, type PlinkoParams, type PusherParams, type TrayDims,
} from '../core/config';
import type { PlacementId } from '../core/frame';
import type { PlinkoBackendId, PusherBackendId } from '../physics/contracts';

export type PresetId = 'structure' | 'basic' | 'rawSurplus' | 'byproductSurplus' | 'growth' | 'stress' | 'empty';
export type Quality = 'low' | 'medium' | 'high';

/** 공통 시나리오: 백엔드를 바꿔도 같은 초기 상태와 입력 일정으로 다시 시작한다. */
export interface Scenario {
  preset: PresetId; label: string; description: string;
  seed: number; fixedDt: number;
  board: BoardDims; tray: TrayDims; economy: EconomyConfig; flow: FlowConfig; pegs: PegSetup;
  pegOverrides: Array<{ index: number; kind: PegKind; level: number }>;
  plinko: PlinkoParams; pusher: PusherParams;
  initialRaw: number; initialTokens: number;
  /** 틱별 투입 일정 (tick, 개수) */
  schedule: Array<{ tick: number; count: number }>;
  placement: PlacementId; quality: Quality;
  backends: { plinko: PlinkoBackendId; pusher: PusherBackendId };
  measure: { warmupSec: number; measureSec: number; repeats: number };
}

export const PRESETS: Record<PresetId, { label: string; description: string }> = {
  structure: { label: '구조 확인', description: '자동 공급 없이 원재료 몇 개만 순서대로 투입해 공정 경로를 확인한다.' },
  basic: { label: '기본 가동', description: '공급량이 플링코 처리량보다 약간 낮은 정상 가동.' },
  rawSurplus: { label: '원재료 과잉', description: '공급(6/s)이 처리량(3/s)을 넘어 원재료 대기가 계속 증가한다.' },
  byproductSurplus: { label: '부산물 과잉', description: '분리 페그·부산물 계수 증가로 압축·트레이 회수량을 넘는 부산물 공급.' },
  growth: { label: '성장 후', description: '페그 레벨 3, 처리량·압축·푸셔 성능을 올린 후반 상태.' },
  stress: { label: '스트레스', description: '원석 약 200개·토큰 약 2,000개 더미. 큰 보드와 넓은 트레이(22×16)를 사용한다.' },
  empty: { label: '빈 상태', description: '원재료·토큰 없이 시작. 직접 투입해 확인한다.' },
};

export function createScenario(preset: PresetId, seed = 1234): Scenario {
  const base: Scenario = {
    preset, ...PRESETS[preset], seed, fixedDt: 1 / 60,
    board: defaultBoard(), tray: defaultTray(), economy: defaultEconomy(), flow: defaultFlow(), pegs: defaultPegSetup(),
    plinko: defaultPlinkoParams(), pusher: defaultPusherParams(),
    initialRaw: 6, initialTokens: 650, schedule: [], pegOverrides: [], placement: 'default', quality: 'medium',
    // 측정 결과에 따른 권장 기본 구성(README 참고). UI·URL로 교체 가능.
    backends: { plinko: 'rapier2d', pusher: 'rapier3d-stacked' },
    measure: { warmupSec: 20, measureSec: 10, repeats: 3 },
  };
  const s = base;
  switch (preset) {
    case 'structure':
      s.flow.autoSupply = false; s.initialRaw = 0; s.initialTokens = 220;
      s.schedule = [{ tick: 30, count: 1 }, { tick: 150, count: 1 }, { tick: 300, count: 3 }, { tick: 600, count: 5 }];
      break;
    case 'basic': break;
    case 'rawSurplus':
      s.flow.supplyPerSec = 6; s.initialRaw = 20; s.initialTokens = 620;
      break;
    case 'byproductSurplus':
      s.pegs.pattern = 'byproduct'; s.economy.byproductCoef = 2.5; s.economy.byproductCap = 60; s.economy.tokenBundleMax = 2;
      s.flow.supplyPerSec = 4; s.flow.plinkoReleasePerSec = 4; s.flow.conveyorCapacity = 10; s.flow.trayMaxTokens = 1100;
      s.initialTokens = 650;
      break;
    case 'growth':
      s.pegs.level = 3; s.flow.supplyPerSec = 6; s.flow.plinkoReleasePerSec = 6; s.flow.plinkoMaxActive = 60;
      s.flow.compressCycleSec = 0.25; s.flow.conveyorCapacity = 24; s.tray.period = 2.2; s.tray.stroke = 2.6;
      s.initialRaw = 30; s.initialTokens = 700;
      break;
    case 'stress':
      s.board = { ...s.board, width: 22, height: 26, rows: 18, cols: 16, itemRadius: 0.26, pegRadius: 0.16, hopperSpread: 7 };
      s.tray = { ...s.tray, width: 22, depth: 16 };
      s.flow.supplyPerSec = 40; s.flow.plinkoReleasePerSec = 60; s.flow.plinkoMaxActive = 200; s.flow.trayMaxTokens = 3200;
      s.flow.compressCycleSec = 0.12; s.flow.conveyorCapacity = 40;
      s.initialRaw = 260; s.initialTokens = 2000; s.quality = 'low';
      s.measure = { warmupSec: 20, measureSec: 10, repeats: 3 };
      break;
    case 'empty':
      s.flow.autoSupply = false; s.initialRaw = 0; s.initialTokens = 0;
      break;
  }
  return s;
}

export const cloneScenario = (s: Scenario): Scenario => structuredClone(s);
