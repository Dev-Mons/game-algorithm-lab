import type { BoardDims, TrayDims } from '../core/config';
import { vec3, type Vec3 } from '../core/math';
import { trayGeometry } from '../physics/tray-geometry';

/**
 * 장치의 월드 배치(렌더러 비의존). 트레이 로컬(x, y, z)은 월드 (x, y, z + trayZ0)로 옮긴다.
 * 보드는 트레이 뒤쪽 위에 중심(boardAnchor)을 두고, 실제 방향은 배치 프리셋 Transform이 정한다.
 */
export interface DeviceLayout {
  trayZ0: number; trayTopY: number;
  boardAnchor: Vec3;
  compressor: Vec3; mainBin: Vec3; collector: Vec3;
  /** 컨베이어가 트레이 뒤쪽 공급 레일에 닿는 지점 */
  railStart: Vec3; railY: number; floorY: number;
}

export function deviceLayout(board: BoardDims, tray: TrayDims): DeviceLayout {
  const g = trayGeometry(tray), trayZ0 = -tray.depth / 2;
  const backWorld = trayZ0 + g.zBack;
  const boardBottom = 5.2;
  return {
    trayZ0, trayTopY: 0, floorY: -3.2,
    boardAnchor: vec3(0, boardBottom + board.height / 2, backWorld - 3.2),
    compressor: vec3(tray.width / 2 + 4.2, 2.2, backWorld - 1.2),
    mainBin: vec3(-board.width / 2 - 4.5, 0.2, backWorld - 3.2),
    collector: vec3(0, -2.1, tray.depth / 2 + 1.1),
    railStart: vec3(tray.width / 2 + 0.6, g.plateHeight + 0.55, trayZ0 + tray.faceMin + 0.3),
    railY: g.plateHeight + 0.55,
  };
}
