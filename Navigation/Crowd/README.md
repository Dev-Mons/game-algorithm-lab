# Crowd Navigation Lab

1,000개 원형 Agent의 결정론적 2D 군중 이동 실험입니다. 현재 구현에는 선택 가능한 레거시 파이프라인이 없으며, 모든 동적 이동을 하나의 국소 속도 솔버가 결정합니다.

## 이동 구조

```text
Command / Flow Goal
        ↓
Static Flow Field
        ↓
Desired Velocity
- 국소 밀도에 따른 속도 감소
- 같은 방향 이웃과 약한 방향 정렬
        ↓
One Local Velocity Solver
- bounded nearest-neighbor query
- reciprocal collision half-planes
- max speed / forward constraint
- acceleration-limited desired change
        ↓
Swept Static Integration
        ↓
Invalid-state Recovery
```

역할은 겹치지 않습니다.

- Flow Field는 정적 장애물을 피해 어디로 갈지만 정합니다.
- Desired Velocity는 군중 속에서 선호하는 방향과 속도만 정합니다.
- `CrowdMovementSolver`가 이번 fixed step의 실제 속도를 한 번 결정합니다.
- 정적 sweep은 벽 통과를 막습니다.
- 위치 복구는 외부에서 주입된 겹침이나 수치 오차가 있을 때만 별도로 계측됩니다.

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
- `agents`: Agent 수, 최대 5,000
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

## 회귀 기준

고정 조건은 1,000 Agent, seed 42, 60 Hz입니다. 저장된 결과는 `baselines/baseline-movement-v2.json`에 있습니다.

| 시나리오 | 구간 | 핵심 결과 |
|---|---:|---|
| Dense Spawn | 60 step | 목표 진행 속도 35px/s 이상, 보고 가능한 겹침 0 |
| Obstacle Field | 600 step | x=660 gate 처리량 25 Agent/s 이상, 도착 Agent 존재, 겹침·벽 침투 0 |
| Merge / Crossing | 900 step | 양쪽 흐름 진행, crossing Jain fairness 0.9 이상 |
| 1,000개 완전 중첩 | 1 step | bounded query, 브라우저 250ms 미만, 정지하지 않음 |

`overlapPairs`는 `0.01px` 미만 침투를 접촉 수치 오차로 취급합니다. 실제 복구 호출은 `recoveredAgents`와 `maxRecoveryDistance`로 숨기지 않고 별도 표시합니다.

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
tests/simulation/movement-v2.test.ts   reversal, overlap, 1,000-Agent acceptance
```

## 범위와 한계

- 사람 보행 연구용 모델이나 rigid formation 시스템이 아닙니다.
- 다중 흐름은 시나리오별 신호·lane·token 없이 동일한 국소 규칙을 사용하므로 도착 시점은 흐름별로 달라질 수 있습니다.
- 완전히 같은 좌표에 대량 Agent를 주입하는 입력은 정상 이동이 아니라 invalid-state recovery로 처리합니다. 이 경로는 연산량이 제한되며 여러 step에 걸쳐 분리될 수 있습니다.
- 복구나 정적 안전 투영이 발생한 Agent는 순간 가속도 선호를 넘을 수 있으므로 recovery 지표와 함께 해석해야 합니다.
