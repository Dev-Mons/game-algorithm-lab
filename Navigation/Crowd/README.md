# Crowd Navigation Lab

최대 10,000개 원형 Agent의 결정론적 2D 군중 이동 실험입니다. 모든 동적 이동은 하나의 `CrowdMovementSolver`와 하나의 predicted-position 접촉 공식이 담당하며, 군중 규모에 따라 접촉 후보 수와 반복 횟수만 조절합니다.

## 이동 구조

```text
Command / Flow Goal
        ↓
Static Flow Field
        ↓
CrowdField (density + momentum + pressure + alignment)
        ↓
Preferred Velocity
        ↓
CrowdMovementSolver
├─ acceleration-limited predicted positions
├─ contact-only Spatial Hash
├─ bounded XPBD/Jacobi circle contacts
└─ bounded tangential contact damping
        ↓
Static Broad Phase → Exact Swept Static Integration when needed
        ↓
Static Invalid-state Recovery
```

역할은 겹치지 않습니다.

- Flow Field는 정적 장애물을 피해 어디로 갈지만 정합니다.
- CrowdField는 모든 규모에서 동일하게 밀도 압력과 같은 방향 흐름 정렬을 preferred velocity에 반영합니다.
- 모든 규모에서 `Cij = distance(pi, pj) - contactDiameter`인 같은 XPBD 제약을 풉니다.
- 작은 침투는 compliance와 bounded work 때문에 허용되지만, 깊은 압축은 매 fixed step 접촉 보정에 피드백됩니다.
- Jacobi iteration 중에는 위치를 즉시 덮어쓰지 않고 Agent별 correction을 모아 동시에 적용합니다.
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
npm run measure:quality
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

- `navCellSize`: 정적 Flow Field 해상도
- `crowdFieldCellSize`: 밀도·운동량·압력 Grid 해상도
- `contactCellSize`: Agent 접촉 후보용 Spatial Hash 해상도
- `maxSpeed`: 물리 속도 상한
- `maxAcceleration`: 목표 속도 변화 상한. 충돌·정적 안전과 invalid recovery는 이 선호보다 우선합니다.
- `agentRadius`, `agentGap`: 물리 반경과 접촉 안전 여유
- `neighborRadius`: 밀도·정렬을 계산하는 국소 반경
- `avoidanceHorizon`: pressure steering look-ahead 상한
- `goalRadius`, `arrivalSlowRadius`: 도착 판정과 감속 범위
- `fixedDelta`: 기본 `1 / 60`초
- `pressureStrength`, `pressureThreshold`, `maximumPressureAcceleration`: 과밀 압력 반응과 상한
- `viscosityStrength`: 같은 방향의 셀 평균 속도에 대한 약한 정렬
- `minimumForwardSpeedRatio`: pressure 중에도 보존할 최소 목표 진행 비율
- `contactCompliance`: `fixedDelta²`로 정규화되는 XPBD compliance
- `contactFriction`: 실제 침투 접촉에만 적용되는 Coulomb-bounded 접선 감쇠
- `maximumContactCorrection`: 한 Agent가 한 Jacobi iteration에서 받을 수 있는 위치 보정 상한

`CrowdField`는 active Agent의 density와 momentum을 4개 셀에 bilinear splat하고, 고정 1회 separable blur 뒤 pressure와 central-difference gradient를 계산합니다. 모든 Grid와 smoothing 버퍼는 생성 시 할당해 매 step 재사용합니다. 장애물 셀과 월드 경계는 no-flux stencil로 처리하므로 낮은 obstacle pressure가 Agent를 벽 안으로 끌어들이지 않습니다.

## 대규모 군중 최적화

접촉 후보 Grid는 정적 Flow Field와 CrowdField에서 분리되어 있으며 predicted position으로 매 step 한 번 rebuild합니다. 각 Agent는 고정 크기 SoA에 가까운 후보만 보관하고, contact lambda는 그 fixed step의 Jacobi 반복 동안 유지됩니다.

| Agent 수 | maxContacts | Jacobi iterations | compliance scale |
|---:|---:|---:|---:|
| 1~1,000 | 16 | 3 | 0.05 |
| 1,001~4,000 | 12 | 2 | 0.5 |
| 4,001~10,000 | 8 | 1 | 1.0 |

4,990/5,000/5,010은 같은 품질 단계에 있어 5,000에서 물리나 작업량이 전환되지 않습니다. 모든 단계가 같은 XPBD 식, 결정론적 동일 위치 normal, Jacobi publish, 정적 sweep을 사용합니다.

- `contactConstraints <= activeAgents × maxContacts × constraintIterations`를 매 step 계측합니다.
- 한 iteration의 correction은 `maximumContactCorrection`으로 clamp하고 비유한 값은 적용하지 않습니다.
- 접선 감쇠는 normal correction과 목표 진행의 5% 상한에 묶이며, 같은 흐름 정렬은 계속 CrowdField viscosity만 담당합니다.
- 접촉 correction을 publish한 직후 정적 투영하고, 마지막에는 current→predicted exact swept-circle 적분을 적용합니다.
- `recoveredAgents`와 `maxRecoveryDistance`는 접촉 보정이 아니라 정적 안전 투영만 뜻합니다.
- 벽과 닿을 가능성이 없는 이동은 AABB broad phase에서 바로 적분합니다.

렌더링도 5,000개부터 개별 사각형이나 `drawImage`를 반복하지 않습니다. 작은 원형 stamp를 투명 픽셀 레이어에 래스터화한 뒤 한 번만 합성해, 반지름 `1.5`에서도 깨진 사각 점처럼 보이는 현상을 줄이면서 draw call을 고정합니다. heading과 겹침/정체 경고는 각각 최대 1,000개만 표시하고, 대규모 모드에서 정상 상태인 겹침 경고는 기본으로 끕니다.

로컬 Node 측정(10,000 Agent, 반지름 `1.5`, gap `0.05`, 360 step)에서 Open Field는 P50 `7.66ms` / P95 `8.86ms`로 목표(P50 `8ms` / P95 `16ms`)를 통과했습니다. Obstacle Field는 P50 `14.24ms` / P95 `20.70ms`로 목표를 통과하지 못했습니다. 같은 Obstacle 측정에서 x=660 관문 통과는 `1,039개`, 벽 침투는 `0`이었습니다. 절대 수치는 실행 환경에 따라 달라집니다.

10,000개를 실제로 배치하려면 현재 Open Field 시작 영역 기준으로 객체 반지름을 `1.5`, 객체 간 여유를 `0.05` 정도로 낮춰야 합니다. 요청 수가 배치 영역의 물리적 수용량보다 크면 `unspawnedCount`에 생성하지 못한 수가 기록됩니다.

## 회귀 기준

고정 조건은 1,000 Agent, seed 42, 60 Hz입니다. 저장된 결과는 `baselines/baseline-movement-v2.json`에 있습니다.

4,990/5,000/5,010 품질 결과와 완전 중첩·저밀도·다중 흐름 결과는 `baselines/baseline-crowd-quality.json`에 저장합니다. `measure:quality`는 평균 목표 진행, 관문 처리량, 점유 면적, density P95, jerk P95, 최대 침투, step P50/P95가 인접 규모에서 15% 넘게 바뀌면 실패합니다. 세 규모의 timing은 JIT·scheduler 편향을 줄이기 위해 interleave합니다.

| 시나리오 | 구간 | 핵심 결과 |
|---|---:|---|
| Dense Spawn | 60 step | 목표 진행 속도 35px/s 이상, 보고 가능한 겹침 0 |
| Obstacle Field | 600 step | x=660 gate 처리량 25 Agent/s 이상, 도착 Agent 존재, bounded 접촉 압축·벽 침투 0 |
| Merge / Crossing | 900 step | 양쪽 흐름 진행, crossing Jain fairness 0.9 이상 |
| 32개 완전 중첩 | 1 step | 유한 correction, iteration 상한 준수, 80% 이상 계속 이동 |
| 10,000개 완전 중첩 | 60 step | constraint 상한 준수, occupied area 증가, 최대/P95 침투 감소 |
| 10,000개 Obstacle Field | 360 step | constraint 상한 준수, x=660 통과 1,000개 초과, 벽 침투·정체 0 |

`overlapPairs`는 `0.01px` 미만 침투를 접촉 수치 오차로 취급하며, solver가 보관한 bounded contact 목록의 진단값입니다. 실제 침투 깊이와 P95는 `CrowdQualityTracker`가 별도 bounded 표본으로 측정합니다. 접촉 보정량과 정적 안전 투영은 각각 `maxContactCorrection`과 `recoveredAgents`/`maxRecoveryDistance`로 분리됩니다.

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
src/core/crowd-field.ts                reusable density/momentum/pressure Grid
src/core/crowd-quality-metrics.ts      bounded deterministic quality histograms
src/core/crowd-movement-solver.ts      bounded XPBD/Jacobi contact and static safety
src/core/spawn-layout.ts               deterministic non-overlapping placement
src/algorithms/flow-field/flow-field.ts
src/algorithms/spatial-hash/spatial-hash.ts
src/core/obstacle-collision.ts         exact swept circle/static integration
tests/simulation/movement-v2.test.ts   reversal, overlap, 1,000/10,000-Agent acceptance
```

## 범위와 한계

- 사람 보행 연구용 모델이나 rigid formation 시스템이 아닙니다.
- 다중 흐름은 시나리오별 신호·lane·token 없이 동일한 국소 규칙을 사용하므로 도착 시점은 흐름별로 달라질 수 있습니다.
- 대규모 접촉은 bounded 후보와 compliance를 사용하므로 완전 비압축 rigid-body 해법이 아닙니다.
- `overlapPairs`와 겹침 색상은 bounded contact 표본이므로 전체 물리 쌍 수를 의미하지 않습니다.
- 복구나 정적 안전 투영이 발생한 Agent는 순간 가속도 선호를 넘을 수 있으므로 recovery 지표와 함께 해석해야 합니다.
