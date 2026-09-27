# 구조와 알고리즘

현재 실행 코드의 책임과 수치 모델을 설명합니다. 이식 API는 [native-porting.md](native-porting.md),
개선·측정 절차는 [development.md](development.md)를 사용합니다.

## 계층과 소유권

```text
엔진 또는 웹 호스트: 입력 / 고정 tick 호출 / 좌표 변환 / 렌더링
  └─ CrowdKernel: 상태, 경로, 외력, 군중 이동, 충돌의 계산 순서
       ├─ FlowField: 정적 지형과 목표에 따른 경로 안내
       ├─ CrowdField → CrowdFlowSolver: 밀도·운동량 → 방향별 속도·압력
       └─ CrowdMovementSolver: 보행 제어 → 군중 접촉 → 정적 충돌

웹 실험실: CrowdSimulation extends CrowdKernel
  └─ 시드 배치 / 프리셋 교체 / 측정 / 기록 / Canvas 렌더링
```

| 책임 | 구현 |
|---|---|
| 공개 계산 진입점, 기본값, 상태 | [core/index.ts](../src/core/index.ts), [config.ts](../src/core/config.ts), [agent-state.ts](../src/core/agent-state.ts) |
| 초기화·목표·지형 변경·step | [crowd-kernel.ts](../src/core/crowd-kernel.ts) |
| 공유 경로 | [flow-field.ts](../src/algorithms/flow-field/flow-field.ts) |
| 면적 질량·방향별 수송·압력 | [crowd-field.ts](../src/core/crowd-field.ts), [crowd-flow-solver.ts](../src/core/crowd-flow-solver.ts) |
| 보행·접촉·정적 기하 | [crowd-movement-solver.ts](../src/core/crowd-movement-solver.ts), [obstacle-collision.ts](../src/core/obstacle-collision.ts) |
| 검색과 안전한 빈 영역 캐시 | [spatial-hash.ts](../src/algorithms/spatial-hash/spatial-hash.ts), [static-obstacle-index.ts](../src/core/static-obstacle-index.ts), [static-free-space.ts](../src/core/static-free-space.ts) |
| 외력 입력·수명 | [external-influences.ts](../src/core/external-influences.ts) |
| 실험실·프리셋·결과 | [lab/simulation.ts](../src/lab/simulation.ts), [registry.ts](../src/algorithms/lab/registry.ts), [lab-results.ts](../src/core/lab-results.ts) |

`src/core/simulation.ts`는 기존 실험실 import의 호환 경로입니다. 계산 코어만 가져올 때는
`src/core/index.ts`에서 시작합니다. `tsconfig.core.json`이 DOM·Node 타입 없는 의존 경계를 검사합니다.
코어의 시계 hook은 기본 비활성이며 실험실 어댑터만 실제 시간을 측정합니다.

`AgentBuffer`는 x/y, vx/vy, active, stalledFor, intentX/Y, heading을 별도 배열로 저장합니다.
코어가 위치·속도를 최종 결정하며, 렌더러는 `previousState`와 최신 `state`를 보간합니다.
엔진 물리가 같은 유닛을 다시 적분·밀어내면 원본과 다른 운동이 됩니다.

## 한 tick의 계산 순서

1. 이전 상태를 보존하고 도착자를 비활성화합니다.
2. 외력 입력을 소비해 물리 속도에 더합니다.
3. 실제 위치·속도를 CrowdField에 산포해 밀도와 운동량을 구성합니다.
4. 필요한 경로 필드를 갱신하고 각 유닛의 선호 이동 속도를 구합니다.
5. 방향별 격자 수송과 공유 밀도 압력을 풀어 이동 제안을 수정합니다.
6. 보행 방향 회전과 전체 모터 가속도를 제한해 이동을 예측합니다.
7. 정적 벽 sweep으로 예측 이동을 자른 뒤 접촉 격자를 만듭니다.
8. swept-pair 이동 제한과 XPBD 겹침·마찰 보정을 수행하고, 최종 정적 sweep으로 검사합니다.
9. 속도를 반영하고 도착·지표를 계산한 뒤 current/next 버퍼를 교환합니다.

### 경로 안내

- 같은 목표·반경 클래스는 FlowField를 공유합니다. 생성 그룹은 통계상 구분되어도 같은 목표면 같은 장을 씁니다.
- `goalRegions`를 지정하면 모든 생성 그룹이 반경 클래스별로 다중 출발 역방향 Dijkstra 필드를 공유합니다.
  최대 32개 사각형과 닿는 셀 중 실제 원형 clearance·구간 검사를 통과한 내부 지점을 출구 seed로 삼습니다.
  셀보다 작은 영역은 셀 중심에서 유효 내부 지점까지의 거리 비용을 포함합니다. 벽 셀을 출구라는 이유로 열지 않습니다.
  각 셀은 최소 비용으로 이어지는 seed를 보관합니다. 방향 보간에서는 다른 목적지로 향하는 화살표를 섞어
  서로 상쇄하지 않으며, 직선 접근도 선택된 영역과의 실제 충돌 검사를 통과해야 합니다.
  넓은 출구는 중심에 몰리지 않고 가까운 유효 가장자리로 진입합니다. 균등 배정이나 출구별 정원 정책은 없습니다.
- 기본 `dynamicRouting=false`: 목표나 지형 변경에만 경로를 다시 만듭니다. 밀집했다고 자동 우회하지 않습니다.
- `dynamicRouting=true`는 비교용 선택 기능입니다. 밀도·과부하·역방향 흐름 비용, 평활화와 방향 hysteresis를 적용합니다.
- 직선 목표 접근은 LOS와 clearance 검사를 통과해야 합니다. 경로 샘플 실패를 벽을 향한 직진으로 대체하지 않습니다.
- 기본 반경 이하와 큰 반경의 두 clearance 클래스를 사용합니다. 큰 유닛은 `maxAgentRadius` 기준의 보수적인 장을 공유합니다.
- `preserveBlockedGoal=true`이면 장애물로 막힌 목표 셀을 열지 않고 경로를 도달 불가능 상태로 둡니다. 기본값은 기존 참조 재생을 보존하는 false입니다.
- `routeGates`는 통과량을 재는 영역이며 이동을 지시하는 중간 목표가 아닙니다.
- 영역 목적지의 도착은 유닛 중심이 사각형에 포함되고 정적 clearance가 유효할 때입니다.
  `goalRadius`는 적용하지 않습니다. 영역 밖에서 감속만 하다가 멈추지 않도록 최소 접근 속도를 유지합니다.
  목표/지형 변경은 seed와 목적지 선택도 갱신하며, `setGoal()`은 영역을 해제하고 기존 한 점 방식으로 돌아갑니다.

### 밀도와 압력

각 유닛의 질량 가중치는 `(radius / agentRadius)²`입니다. 위치·운동량은 bilinear scatter와
보존적 blur를 거치고, 8개 heading channel에 인접한 두 방향의 가중치로 기여합니다.
반대 흐름을 하나의 평균 속도로 상쇄하지 않기 위한 구성입니다.

공유 압력은 목표 밀도 초과량과 예측 mass-flux divergence로 계산합니다. 셀 중심의 유한 반복
투영이며, 양의 압력만 사용합니다. 음의 압력·인력으로 내부 구멍을 채우는 모델은 아닙니다.
Gather는 희박한 구역의 경로 세부를 유지합니다. 압력 보정은 이 단계에서 한 번 적용합니다.

### 보행과 접촉

`turnSpeed`는 보행 목표 방향의 회전을 제한합니다. 전체 속도 변화는 `maxAcceleration` 안에서
이뤄지므로 목표 변경이나 걷기 속도 상한이 외력의 운동량을 즉시 지우지 않습니다.
가속도가 0이면 방해받지 않는 기존 속도는 유지됩니다. 벽·접촉 안전 보정은 회전 제한보다 우선합니다.
`excessSpeedHalfLife>0`을 지정하면 이전 tick 속도 중 `maxSpeed` 초과분만 해당 반감기(초)로 감쇠합니다.
새 외력 입력 전에 적용하므로 이번 tick의 밀림을 즉시 약화하지 않습니다. 기본값 0은 감쇠를 끄며,
보행 속도 이하의 동작은 유지됩니다. 강한 밀림 뒤 회복을 조정할 때 TinyDead의 게임 영역 설정인 0.15초를 사용할 수 있습니다.

접촉 예산은 유닛당 **후보 24 / 저장 쌍 8 / 반복 8회**로 고정됩니다. 검색은 가까운 셀부터
시작하고, 자기 이동량과 보정 여유를 포함합니다. 빠른 높은 ID 유닛도 swept pair를 소유할 수 있습니다.
고정된 후보 목록에서 swept-pair 보정은 두 끝점을 순차 변경하고, XPBD 잔여 보정은 배열에 모아
동시 반영합니다. 전체 과정을 병렬 Jacobi로 간주해 그대로 병렬화하면 안 됩니다.
후보를 고르는 동안 위치가 고정되므로 개체별 검색 여유 폭을 한 번 계산하며, 선택된 쌍의 접촉 지름은
8회 반복에서 재사용합니다. 두 캐시는 매 tick 갱신해 반경·간격·입력 속도 변경을 반영합니다.

접촉 수에 따른 보정 완화는 여러 이웃의 합산 반발을 줄입니다. `maximumContactCorrection`은
8회에 걸친 **XPBD 겹침 수리 이동량**의 상한입니다. 이미 움직이는 물체를 멈추는 swept 충돌이나
정적 벽 보정 전체의 변위 상한은 아닙니다. 후보 제한 때문에 모든 접촉 검출과 완전 비침투를 보장하지 않습니다.

정적 BVH·주변 후보 캐시는 장애물 순서를 유지합니다. 빈 영역 인증은 안전한 이동의 빠른 경로이며,
정확한 원/사각형 거리와 swept-circle 검사를 대체하는 근사 충돌은 아닙니다.

순차 정적 투영 후에도 장애물 침투가 남으면, 시작점과 겹친 최대 8개 사각형의 4개 면에서
가장 가까운 유효 탈출점을 찾습니다. 후보는 월드 경계·반경 여유를 만족하고 처음에 겹치지 않은
장애물을 이동 구간에서 침범하지 않아야 합니다. 첫 적분에서 복구한 위치가 접촉 후에도 유효하면
마지막 적분에서 재사용합니다. 정상 위치나 단순 정체에 순간이동을 적용하지 않습니다.
완전히 막힌 영역이나 모든 제한 후보가 차단된 경우에는 복구할 수 없으며, 깊은 초기 침투의
원래 연결 영역·연속 탈출·개체 간 비침투까지 보장하지 않습니다.

### 외력

외력 입력은 위치를 쓰거나 별도 이동 모드를 선택하지 않습니다. impulse는 Δv, acceleration은
`a × dt`, blast는 거리별 선형 감쇠를 속도에 더합니다. 확장 충격파는 유닛별 한 번 적용 마스크를 유지합니다.
영역 외력은 벽의 차폐를 계산하지 않으며, 이후 이동의 벽 충돌은 일반 솔버가 처리합니다.

`proxy`는 움직이는 원형 밀림 도구입니다. 강체 장애물이나 차량과의 양방향 충돌이 아니며,
밀집 군중과 도구의 원이 겹칠 수 있습니다. 이동 입력이 없으면 마지막 위치에서 유지됩니다.
`external.active`는 지속 입력 존재, `direct`와 `stats.affected`는 이번 tick에 직접 속도를 받은 대상을 뜻합니다.
이 값으로 일반 이동 계산을 켜거나 끄지 않습니다. [입력 수명과 제한](native-porting.md#외력-입력)을 확인하세요.

지속적으로 관측하는 물체에는 기록을 쌓지 않는 `external.setKinematicProxies()`를 사용할 수 있습니다.
같은 원형 밀기 수식을 사용하며, 직접 접촉한 도착 생존자를 다시 활성화합니다. 고정 배열의 presence
마스크는 호스트가 제공하고 제거 슬롯은 active도 0으로 유지해야 합니다. API의 교체·수명 계약은
[연속 원형 밀기](native-porting.md#연속-원형-밀기)에 있습니다.

## TinyDead에서 반영한 범위

2026-09-27 `E:\UnrealProjects\TinyDead`의 `Source/TinyDead/Crowd/Core` 작업 상태를 기준으로
CPU 접촉 캐시·정적 이음새 복구·막힌 목표 보존·초과 속도 감쇠·연속 원형 밀기를 TypeScript로 반영했습니다.
기준 HEAD는 `5ed39755ead17ea4149c497a1edfea34c7406e98`이며 이음새 복구와 막힌 목표 보존은
그 위의 미커밋 변경도 포함합니다. 원본 프로젝트는 실행 의존성이 아닙니다.

Unreal `ParallelFor`, 슬롯 생성·제거 어댑터, 월드 충돌에서 내비게이션 생성, 차량 자세 수집과 ISM은
이 웹 실험실의 기능 범위에 포함하지 않습니다. GPU 구현은 Unreal RDG/HLSL·비동기 readback에
의존하며, 이 프로젝트에는 GPU 백엔드를 추가하지 않았습니다. WebGPU 이식에는 별도 셰이더·버퍼·
동기화·FP32 품질 검증이 필요합니다. CPU의 고정 후보 예산과 순차 접촉 순서를 유지합니다.

## 조정할 설정

전체 필드·기본값은 [CrowdConfig](../src/core/types.ts)와 [config.ts](../src/core/config.ts)가 기준입니다.

| 설정군 | 의미와 주의점 |
|---|---|
| `navCellSize`, `crowdFieldCellSize` | 경로 격자와 군중 격자의 해상도. 변경하면 통과 가능성·수치 비용을 함께 비교 |
| `pressureThreshold` | 반경 3.2 / 셀 24 기준 질량 12를 기본으로 사용. 반경²·셀 면적에 맞춰 정규화 |
| `crowdPressureIterations`, `crowdPressureRelaxationTime` | 기본 8회, .25초. 반복 수는 정확한 비압축성 보장이 아님 |
| `crowdVelocityBlend` | 밀집 셀에서 실제 운동량의 비중. 기본 .68 |
| `maxSpeed`, `maxAcceleration`, `turnSpeed` | 보행 목표 속도, 모터 속도 변화, 목표 방향 회전. 물리 충돌 제한과 구분 |
| `contactCompliance`, `contactFriction`, `maximumContactCorrection` | 접촉 유연성·마찰·겹침 수리 예산. 기본 보정 상한 1.25px |
| `contactCellSize` | 격자 크기 상한. 실제 검색 격자는 기본 접촉 지름 이하로 구성 |
| `dynamicFlow*` | 동적 경로가 켜진 경우에만 사용. 기본 갱신 간격 8tick, 밀도 기준 .75, 비용 가중치 72 |

`neighborRadius`는 실험실의 이웃 표시 설정이며 이동 솔버의 후보 예산을 바꾸지 않습니다.

## 기능 범위와 알려진 한계

- 평면상의 원과 축 정렬 사각형을 처리합니다. 경사·높이·다층·회전 메시 충돌은 없습니다.
- 초기 흐름별 점 목표, 공통 점 목표 변경과 공통 목적지 영역 집합을 지원합니다. 런타임 생성·삭제·배열 재정렬·개별 목표 명령은 없습니다.
- 도착 반경 안에서는 `active=0`이 되어 충돌에서도 빠집니다. 목적지에서 정지 유닛의 공간을 유지하는 정책은 별도 확장입니다.
- 밀집 압축은 여러 tick에 남을 수 있습니다. 전역 침투 0.5px 이하나 운동에너지 단조 감소를 보장하지 않습니다.
- 압력은 밀도 용량 근사입니다. 정확한 원 패킹, 임의 크기 공동 회복, 격자 해상도 독립성을 보장하지 않습니다.
- Float64 CPU 재현성이 다른 언어의 float32·GPU·네트워크 lockstep의 비트 일치를 뜻하지 않습니다.
- 수만 유닛의 전체 게임 프레임 성능은 검증된 계약이 아닙니다. 렌더 FPS와 시뮬레이션 처리량을 분리해 측정합니다.
- 영역 경로 비용은 격자 근사이며 연속 공간의 정확한 최단 거리나 출구 간 균등 이용을 보장하지 않습니다.
  목표 구역 자체는 장애물이 아니며, 구역 경계가 유닛 반경만큼 안쪽으로 축소되는 것은 아닙니다.
