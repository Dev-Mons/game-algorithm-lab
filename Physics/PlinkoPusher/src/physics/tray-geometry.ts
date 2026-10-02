import type { TrayDims } from '../core/config';

/** 트레이 고정 형상. 모든 푸셔 백엔드와 표시 계층이 같은 치수를 쓴다(엔진 비의존). */
export function trayGeometry(d: TrayDims) {
  const plateHeight = 0.9;
  const zBack = d.faceMin - d.pusherDepth - 0.4;
  return {
    plateHeight, zBack,
    /** 적층 모드 전용: 푸셔 판 위로 올라간 토큰을 후퇴 시 앞으로 긁어내리는 고정 립. 판 윗면과의 틈은 토큰 두께보다 작다. */
    lip: { zFront: d.faceMin - 0.02, yBottom: plateHeight + Math.min(0.06, d.tokenHalfHeight), height: 1.4 },
    wallThickness: 0.25,
    /** 측면 가드 높이(쌓인 더미가 옆으로 넘지 않게) */
    wallHeight: 3.2,
  };
}

/** 공통 푸셔 운동: 0.5(1 - cos) 왕복. 각 백엔드에는 이 값만 전달한다. */
export function pusherMotion(d: TrayDims, time: number) {
  const w = (Math.PI * 2) / d.period;
  return { face: d.faceMin + d.stroke * 0.5 * (1 - Math.cos(w * time)), velocity: d.stroke * 0.5 * w * Math.sin(w * time) };
}
