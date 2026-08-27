# Crowd Navigation Lab

최대 10,000개 원형 Agent의 결정론적 2D 군중 이동 실험입니다. 모든 동적 이동은 하나의 `CrowdMovementSolver`가 담당하지만, 군중 규모에 따라 물리 품질과 처리량의 우선순위를 명시적으로 바꿉니다.

## 이동 구조

```text
Command / Flow Goal
        ↓
Static Flow Field
        ↓
Desired Velocity
        ↓
CrowdMovementSolver
├─ 5,000개 미만: reciprocal collision half-planes + nearest neighbors
└─ 5,000개 이상: overlap-tolerant linear path + acceleration limit
        ↓
Static Broad Phase → Exact Swept Static Integration when needed
        ↓
Static Invalid-state Recovery
```

역할은 겹치지 않습니다.

- Flow Field는 정적 장애물을 피해 어디로 갈지만 정합니다.
- Desired Velocity는 선호하는 방향과 속도만 정합니다.
- 5,000개 미만에서는 가까운 Agent끼리 ORCA 제약으로 분리합니다.
- 5,000개 이상에서는 TD/RTS의 의도적인 동적 겹침을 허용하고, 쌍별 제약과 위치 복구를 수행하지 않습니다.
- 정적 sweep과 투영은 규모와 관계없이 벽 통과를 막습니다.

목표를 반대로 바꾸면 기존 속도의 새 목표 방향 성분만 남기고 반대 성분은 명령 프레임에서 제거합니다. 렌더링 heading은 물리 속도와 분리되어 새 intent를 즉시 표시하며, 다음 fixed step부터 새 방향으로 이동합니다.

## 실행

```bash
npm install
npm run dev
```

검증과 측정:

```bash
npm run verify
npm run test:e2e
npm run measure
npm run measure:flows
```

URL 파라미터:

- `scenario`: `open-field`, `obstacle-field`, `dense-spawn`, `merge-500-500`, `opposing-500-500`, `crossing-500-500`
- `agents`: Agent 수, 최대 10,000 (배치 영역과 반경에 따라 실제 생성 수가 제한될 수 있음)
- `seed`: 결정론적 배치 seed
- `step`: 해당 fixed step까지 계산
- `paused=true`: 일시정지 상태로 시작

예시:

```text
/?scenario=obstacle-field&agents=1000&seed=42&step=600&paused=true
```

## 핵심 설정

- `maxSpeed`: 물리 속도 상한
- `maxAcceleration`: 목표 속도 변화 상한. 충돌·정적 안전과 invalid recovery는 이 선호보다 우선합니다.
- `agentRadius`, `agentGap`: 물리 반경과 ORCA 안전 여유
- `neighborRadius`: 밀도·정렬을 계산하는 국소 반경
- `avoidanceHorizon`: reciprocal collision 예측 시간
- `goalRadius`, `arrivalSlowRadius`: 도착 판정과 감속 범위
- `fixedDelta`: 기본 `1 / 60`초

## 대규모 군중 최적화

2,000 Agent를 넘으면 객체 크기에 맞춰 Spatial Hash 셀을 더 촘촘하게 구성하고, 가까운 이웃 제약만 단계적으로 선택합니다. 2,000개 이하의 회귀 경로는 기존 32-neighbor 품질을 그대로 사용합니다.

5,000개 이상은 알고리즘을 부분 교체합니다. ORCA와 쌍별 위치 복구는 “동적 객체가 서로 겹치면 안 된다”는 문제에는 적합하지만, 벽 앞에서 수천 개가 의도적으로 겹치는 TD/RTS 조건에서는 같은 공간을 계속 비우려 하므로 비용과 정체가 함께 증가합니다. 대규모 경로는 다음만 수행합니다.

- Spatial Hash를 한 번 구성해 셀 밀도만 계측합니다.
- 현재 속도에서 desired velocity까지 가속도 상한 안에서 직접 이동합니다.
- 동적 겹침은 이동 결과에 피드백하지 않습니다.
- 벽과 닿을 가능성이 없는 이동은 AABB broad phase에서 바로 적분하고, 가능성이 있을 때만 정확한 swept-circle 충돌을 풉니다.
- 겹침 진단은 Agent당 최대 8개 후보만 표본 검사합니다. 따라서 대규모 모드의 `overlapPairs`는 전체 쌍 수가 아닌 bounded sample입니다.

렌더링도 5,000개부터 개별 사각형이나 `drawImage`를 반복하지 않습니다. 작은 원형 stamp를 투명 픽셀 레이어에 래스터화한 뒤 한 번만 합성해, 반지름 `1.5`에서도 깨진 사각 점처럼 보이는 현상을 줄이면서 draw call을 고정합니다. heading과 겹침/정체 경고는 각각 최대 1,000개만 표시하고, 대규모 모드에서 정상 상태인 겹침 경고는 기본으로 끕니다.

로컬 측정에서 10,000개 Obstacle Field 장면(반지름 `1.5`, 간격 `0.1`)의 후반 60스텝 중앙값은 약 `143ms → 7.8ms`로 줄었습니다. 360스텝 동안 x=660 관문 통과는 `4,042개`, 벽 침투는 `0`이었습니다. Chromium에서 원형 픽셀 레이어를 적용한 상태로 60 Hz fixed step을 유지했고, 시뮬레이션 스텝 평균 `4.46ms`를 확인했습니다. 절대 수치는 실행 환경에 따라 달라집니다.

10,000개를 실제로 배치하려면 현재 Open Field 시작 영역 기준으로 객체 반지름을 `1.5`, 객체 간 여유를 `0.05` 정도로 낮춰야 합니다. 요청 수가 배치 영역의 물리적 수용량보다 크면 `unspawnedCount`에 생성하지 못한 수가 기록됩니다.

## 회귀 기준

고정 조건은 1,000 Agent, seed 42, 60 Hz입니다. 저장된 결과는 `baselines/baseline-movement-v2.json`에 있습니다.

| 시나리오 | 구간 | 핵심 결과 |
|---|---:|---|
| Dense Spawn | 60 step | 목표 진행 속도 35px/s 이상, 보고 가능한 겹침 0 |
| Obstacle Field | 600 step | x=660 gate 처리량 25 Agent/s 이상, 도착 Agent 존재, 겹침·벽 침투 0 |
| Merge / Crossing | 900 step | 양쪽 흐름 진행, crossing Jain fairness 0.9 이상 |
| 1,000개 완전 중첩 | 1 step | bounded query, 브라우저 250ms 미만, 정지하지 않음 |
| 10,000개 완전 중첩 | 60 step | Agent당 후보 최대 8개, 겹침 유지 상태에서도 평균 속도 80px/s 초과 |
| 10,000개 Obstacle Field | 360 step | 후보 최대 80,000/step, x=660 통과 3,000개 초과, 벽 침투·정체 0 |

`overlapPairs`는 `0.01px` 미만 침투를 접촉 수치 오차로 취급합니다. 5,000개 미만에서는 전체 국소 조회 결과이고, 5,000개 이상에서는 프레임 비용 상한을 위한 표본 값입니다. 실제 정적 복구 호출은 `recoveredAgents`와 `maxRecoveryDistance`로 별도 표시합니다.

## 디버그와 결정론

UI에서 Flow Field, Spatial Hash, desired/final velocity, density, recovery, overlap, stall을 켤 수 있습니다. 브라우저 콘솔에서는 다음 API를 제공합니다.

```ts
window.crowdDebug.getSnapshot();
window.crowdDebug.simulation();
```

같은 scenario/config/seed와 동일한 명령 순서는 같은 `stateHash()`를 만듭니다. hot path의 Agent·이웃·제약 저장소는 초기화 시 할당하고 step 중에는 재사용합니다.

## 주요 파일

```text
src/core/simulation.ts                 fixed-step orchestration and desired velocity
src/core/crowd-movement-solver.ts      single local velocity authority and recovery
src/core/spawn-layout.ts               deterministic non-overlapping placement
src/algorithms/flow-field/flow-field.ts
src/algorithms/spatial-hash/spatial-hash.ts
src/core/obstacle-collision.ts         exact swept circle/static integration
tests/simulation/movement-v2.test.ts   reversal, overlap, 1,000/10,000-Agent acceptance
```

## 범위와 한계

- 사람 보행 연구용 모델이나 rigid formation 시스템이 아닙니다.
- 다중 흐름은 시나리오별 신호·lane·token 없이 동일한 국소 규칙을 사용하므로 도착 시점은 흐름별로 달라질 수 있습니다.
- 5,000개 이상에서는 Agent끼리 물리적으로 분리되지 않습니다. 정확한 개체 간 접촉, rigid formation, 개인 공간이 필요하면 대규모 경로의 대상이 아닙니다.
- 대규모 `overlapPairs`와 겹침 색상은 bounded sample이므로 전체 물리 쌍 수를 의미하지 않습니다.
- 복구나 정적 안전 투영이 발생한 Agent는 순간 가속도 선호를 넘을 수 있으므로 recovery 지표와 함께 해석해야 합니다.
