// 미확정 수치는 모두 여기 설정으로 분리한다. 단위는 논리 단위(길이)와 초(시간)다.

export type PegKind = 'basic' | 'refiner' | 'splitter';
export interface PegKindSpec { label: string; process: number; byproduct: number }
/** 레벨 1 기준 페그 1회(원재료당 페그별 최초 1회) 접촉 점수. 실제 점수 = 기준 × 레벨. */
export const PEG_KINDS: Record<PegKind, PegKindSpec> = {
  basic: { label: '기본 페그', process: 1, byproduct: 1 },
  refiner: { label: '정련 페그', process: 3, byproduct: 0 },
  splitter: { label: '분리 페그', process: 0, byproduct: 3 },
};
export const MAX_PEG_LEVEL = 5;

export interface EconomyConfig {
  /** 가공 재화 = mainBase + floor(mainPerProcess × min(가공 점수, processCap)) */
  mainBase: number; mainPerProcess: number; processCap: number;
  /** 부산물 가치 = min(byproductCap, byproductBase + floor(byproductCoef × 부산물 점수)) */
  byproductBase: number; byproductCoef: number; byproductCap: number;
  /** 원재료 1개가 점수를 얻는 서로 다른 페그 수 상한 */
  maxScoredHits: number;
  /** 부산물 가치 1당 코인 1개. tokenBundleMax는 한 번에 압축할 코인 수 상한. tokenValue는 초기 적재 가치(8)로 유지한다. */
  tokenValue: number; tokenBundleMax: number;
  /** 회수 보너스 = floor(토큰 가치 × bonusRate) */
  bonusRate: number;
}

export interface FlowConfig {
  autoSupply: boolean;
  /** 자동 공급량(개/초) */
  supplyPerSec: number;
  /** 플링코 처리량: 투입구가 대기열에서 꺼내는 속도(개/초)와 보드 동시 수용량 */
  plinkoReleasePerSec: number; plinkoMaxActive: number;
  /** 처리기 → 압축기 슈트 이동 시간 */
  chuteSeconds: number;
  /** 압축기 1회 가압 주기 */
  compressCycleSec: number;
  /** 중앙 프레스의 투입·복귀·배출 게이트 시간 */
  pressLoadSec: number; pressRetractSec: number; pressOpenSec: number;
  /** 트레이에 동시에 존재할 수 있는 물리 토큰 수(토큰 수 설정) */
  trayMaxTokens: number;
  /** 화면 밖 처리: 측정값이 부족할 때 쓰는 기본 추정치 */
  offscreenFallbackProcess: number; offscreenFallbackByproduct: number; offscreenFallbackRecoveryPerSec: number;
  /** 숨김 탭 복귀 시 정산할 최대 시간(초) */
  hiddenSettleCapSec: number;
}

export interface BoardDims {
  width: number; height: number; rows: number; cols: number;
  pegRadius: number; itemRadius: number; topMargin: number; bottomMargin: number;
  /** 호퍼 투입 위치의 u 범위(중앙 기준 ±) */
  hopperSpread: number;
}

export interface TrayDims {
  width: number; depth: number; tokenRadius: number; tokenHalfHeight: number;
  /** 푸셔 판 앞면이 움직이는 범위: faceMin ~ faceMin + stroke */
  pusherDepth: number; faceMin: number; stroke: number; period: number;
}

export interface PegSetup { level: number; pattern: 'mixed' | 'basic' | 'byproduct' }

export interface PlinkoParams {
  gravity: number; linearDamping: number; restitution: number; friction: number;
  substeps: number; maxSpeed: number; itemCollisions: boolean;
  /** 끼임 보정: stuckSeconds 동안 stuckSpeed 미만이면 nudgeSpeed로 옆으로 민다. */
  stuckSpeed: number; stuckSeconds: number; nudgeSpeed: number;
  engineSolverIterations: number; engineCcd: boolean;
  /** device: 장치 내부 중력(+v 고정). world-projected: 월드 중력을 보드에 투영(선택 옵션). */
  gravityMode: 'device' | 'world-projected';
}

export interface PusherParams {
  gravity: number; friction: number; restitution: number;
  /** Custom: 겹침 해소 반복 수, 반복당 최대 보정 거리(반지름 비율) */
  iterations: number; maxCorrection: number;
  maxSpeed: number; sleepSpeed: number; sleepSeconds: number;
  engineSolverIterations: number;
  /** Custom 적층: 이웃 칸보다 (반지름 × reposeSlope) 이상 높으면 무너진다. coupling = 위 토큰이 받침 속도를 따라가는 비율 */
  reposeSlope: number; coupling: number;
  /** Custom 적층: 위에 하중이 있는 토큰이 가장자리 너머로 버티는 돌출 길이(반지름 비율) */
  overhang: number;
}

export const defaultEconomy = (): EconomyConfig => ({
  mainBase: 10, mainPerProcess: 1, processCap: 60,
  byproductBase: 2, byproductCoef: 1, byproductCap: 40,
  maxScoredHits: 24, tokenValue: 8, tokenBundleMax: 12, bonusRate: 1,
});

export const defaultFlow = (): FlowConfig => ({
  autoSupply: true, supplyPerSec: 2.5, plinkoReleasePerSec: 3, plinkoMaxActive: 40,
  chuteSeconds: 1.2, compressCycleSec: 0.4, pressLoadSec: 0.3, pressRetractSec: 0.2, pressOpenSec: 0.35,
  trayMaxTokens: 1500,
  offscreenFallbackProcess: 10, offscreenFallbackByproduct: 10, offscreenFallbackRecoveryPerSec: 12,
  hiddenSettleCapSec: 1800,
});

export const defaultBoard = (): BoardDims => ({
  width: 12, height: 16, rows: 12, cols: 9, pegRadius: 0.18, itemRadius: 0.3,
  topMargin: 2.2, bottomMargin: 1.4, hopperSpread: 1.2,
});

export const defaultTray = (): TrayDims => ({
  width: 14, depth: 11, tokenRadius: 0.5, tokenHalfHeight: 0.085,
  pusherDepth: 2.4, faceMin: 1.2, stroke: 2.2, period: 2.8,
});

export const defaultPegSetup = (): PegSetup => ({ level: 1, pattern: 'mixed' });

export const defaultPlinkoParams = (): PlinkoParams => ({
  gravity: 30, linearDamping: 0.12, restitution: 0.42, friction: 0.08,
  substeps: 4, maxSpeed: 24, itemCollisions: true,
  stuckSpeed: 0.35, stuckSeconds: 1.2, nudgeSpeed: 3,
  engineSolverIterations: 4, engineCcd: false, gravityMode: 'device',
});

export const defaultPusherParams = (): PusherParams => ({
  gravity: 20, friction: 0.5, restitution: 0.05,
  iterations: 6, maxCorrection: 0.5, maxSpeed: 6, sleepSpeed: 0.04, sleepSeconds: 0.4,
  engineSolverIterations: 4,
  reposeSlope: 0.9, coupling: 0.9, overhang: 0.5,
});

export function pegGain(kind: PegKind, level: number): { process: number; byproduct: number } {
  const lv = Math.max(1, Math.min(MAX_PEG_LEVEL, Math.round(level)));
  return { process: PEG_KINDS[kind].process * lv, byproduct: PEG_KINDS[kind].byproduct * lv };
}

export const mainPayout = (e: EconomyConfig, processPoints: number) => e.mainBase + Math.floor(e.mainPerProcess * Math.min(Math.max(0, processPoints), e.processCap));
export const byproductValue = (e: EconomyConfig, byproductPoints: number) => Math.min(e.byproductCap, e.byproductBase + Math.floor(e.byproductCoef * Math.max(0, byproductPoints)));
export const bonusFor = (e: EconomyConfig, tokenValue: number) => Math.floor(tokenValue * e.bonusRate);
