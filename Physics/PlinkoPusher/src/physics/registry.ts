import type { PlinkoBackend, PlinkoBackendId, PusherBackend, PusherBackendId } from './contracts';
import { CustomPlinko } from './plinko-custom';
import { RapierPlinko } from './plinko-rapier';
import { CustomPusher } from './pusher-custom';
import { CustomStackPusher } from './pusher-custom-stack';
import { RapierPusher } from './pusher-rapier';

export const PLINKO_BACKENDS: Record<PlinkoBackendId, { label: string; note: string }> = {
  custom: { label: 'Custom 2D', note: '원·페그·벽 충돌, 고정 서브스텝' },
  rapier2d: { label: 'Rapier 2D', note: '네이티브 2D 엔진(평면 제약 불필요)' },
};
export const PUSHER_BACKENDS: Record<PusherBackendId, { label: string; note: string; condition: 'planar' | 'stacked' }> = {
  'custom-stack': { label: 'Custom 적층 2.5D', note: '중력·얹힘·무너짐(받침 밖 미끄러짐)·연쇄 붕괴, 회전 동역학 없음', condition: 'stacked' },
  custom: { label: 'Custom 단층(참고)', note: '수평 원판 단층 근사. 쌓임 없음(겹침은 표시만)', condition: 'planar' },
  'rapier3d-planar': { label: 'Rapier 3D 평면 제약', note: 'Y 이동·기울기 잠금 단층 비교 조건', condition: 'planar' },
  'rapier3d-stacked': { label: 'Rapier 3D 적층', note: '중력·마찰·실제 적층 후보 조건', condition: 'stacked' },
};

export function createPlinko(id: PlinkoBackendId): PlinkoBackend {
  return id === 'rapier2d' ? new RapierPlinko() : new CustomPlinko();
}
export function createPusher(id: PusherBackendId): PusherBackend {
  if (id === 'rapier3d-planar') return new RapierPusher('planar');
  if (id === 'rapier3d-stacked') return new RapierPusher('stacked');
  if (id === 'custom-stack') return new CustomStackPusher();
  return new CustomPusher();
}
