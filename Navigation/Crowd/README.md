# Crowd Navigation Lab

1,000개 유닛의 RTS형 군중 이동을 재현하는 결정론적 2D 웹 시뮬레이션입니다. `pipeline=unified`는 Agent별 Reverse-Dijkstra Flow Field 위에 밀도·선두 간격·동일 흐름 평균 속도를 반영한 crowd preference를 만들고, 정적/동적/속도/가속도 제약을 하나의 local velocity authority에서 풉니다. 구형 우선순위 예약과 위치 완화는 잔여 충돌이 실제로 검출된 프레임의 safety fallback으로만 실행됩니다.

## 구현 범위

- 8방향 Reverse-Dijkstra 비용장과 exact clearance 선분 검증을 거치는 bilinear Flow Field 보간
- 원·예측 위치·TTC를 heading 공간의 차단 각도 구간으로 투영하는 free-gap steering
- 정적 AABB와 월드 경계의 반경·여백 확장, swept-circle TOI와 접선 슬라이드
- Phase A intent 계산 → Phase B acceleration-disk ORCA 투영 → Phase C 정적 적분/선후행 속도 예약 → Phase D 상태/메트릭 집계
- 같은 흐름의 앞뒤를 실제 진행 방향으로 판정하고, 충돌 시 후행 유닛의 자기 제안 변위만 단조 감소시키는 비관통 backstop
- 같은 프레임의 전체 steering intent 공유와 이전 회피 방향 히스테리시스
- 방향 회전율(`maxTurnRate`)과 속도 변화(`maxAcceleration`) 상한, 여유 거리/TTC 기반 연속 감속
- seed와 agent ID 기반의 안전한 분산 arrival slot
- 대형 stream splitter의 조기 formation-side 선택과 portal lane 분산
- swept AABB Spatial Hash와 predicted-separation 후보 선택
- 국소 밀도, 동일 흐름 평균 속도, leader gap/speed를 이용한 crowd-aware preferred velocity
- 서로 다른 spawn·goal을 가진 다중 flow와 Agent별 Flow Field
- shared conflict zone의 용량 기반 round-robin token, drain-before-switch, 완만한 정지선 감속
- opposing flow의 formation-order-preserving 오른쪽 차선 guidance
- acceleration-aware ORCA와 대칭 coupled velocity projection을 결합한 `unified` 파이프라인
- 정적 half-plane, 속도 원, 가속도 도달 원을 같은 velocity space에서 처리
- fallback 원인·호출률·unified infeasible 수와 Agent layer trace 계측
- merge/crossing의 Jain fairness, starvation, rolling throughput, lane-switch rate 계측
- exact-tangent 고착을 막는 0.06px 정적 접촉 스킨
- 활성 유닛만 색인하는 Uniform Grid Spatial Hash
- 1/60초 fixed timestep, typed-array 이중 버퍼, persistent steering state를 포함한 state hash
- Open Field, Obstacle Field, Dense Spawn, Merge/Opposing/Crossing 500+500 시나리오
- FixedClock alpha 위치 보간, 물리 이동과 분리된 visual heading, density/preferred/final/fallback Canvas 디버그

## 실행과 검증

Node.js 20.19 이상 또는 22.12 이상을 권장합니다.

```bash
cd Navigation/Crowd
npm install
npm run dev
```

```bash
npm run typecheck       # strict TypeScript
npm run test:run        # Vitest 단위/통합 회귀
npm run test:e2e        # Playwright 브라우저 회귀
npm run measure         # 60/300/600/900 step 측정
npm run measure:long    # Open/Dense 1,800, Obstacle 3,600 step 측정
npm run compare:pipelines -- --scenario=obstacle-field --steps=600
npm run trace:agent -- --pipeline=unified --scenario=obstacle-field --steps=600
npm run measure:flows -- --steps=900 --seed=42
npm run build           # 프로덕션 번들
npm run verify          # typecheck + Vitest + build
```

재현 URL 예시:

```text
?scenario=obstacle-field&agents=1000&seed=42&step=900&paused=true
```

`scenario`, `agents`, `seed`, `step`, `paused`, `pipeline`을 지원합니다.

### 파이프라인 A/B

- `current`: 기존 free-gap → reciprocal projection → static slide → priority reservation.
- `minimal`: P1/P2 실험군. 단순 ORCA와 routine 위치 완화를 유지합니다.
- `unified`: crowd preference → acceleration-aware ORCA → coupled velocity agreement → exact static validation. Priority/position correction은 residual safety fallback일 때만 실행합니다.

UI의 **이동 파이프라인** 선택기나 `pipeline` URL 파라미터로 같은 seed/config에서 전환할 수 있습니다. 측정 비교:

```bash
npm run measure -- --pipeline=current   # 기존 4중 회피 파이프라인
npm run measure -- --pipeline=minimal   # P1 실험 파이프라인
npm run measure -- --pipeline=unified   # 통합 velocity authority
npm run compare:pipelines -- --scenario=obstacle-field --steps=600
```

고정 조건(1,000 Agent, seed 42, 60 Hz)의 첫 acceptance 결과는 다음과 같습니다.

| 시나리오 | 핵심 결과 |
|---|---|
| `dense-spawn`, step 60 | 평균 Goal 진척 35.10px, long stop 0, strong backward 0, overlap 0, fallback 0 |
| `obstacle-field`, step 600 | 도착 4, gate 49.2 agent/s, stop-move-stop 102, long stop 0, overlap/wall 0, fallback 0.043% |
| `merge-500-500`, step 900 | flow crossing 422/424, Jain 1.000, 최대 starvation 98 step, rolling gate 최저 14.4 agent/s, fallback 0.024% |
| `crossing-500-500`, step 900 | flow crossing 411/434, Jain 0.999, 최대 starvation 147 step, rolling gate 최저 23.6 agent/s, fallback 0.007% |
| 성능 | paired A/B에서 current 6,592ms, unified 7,731ms로 +17.3% |

seed 7/42/73의 Merge/Opposing/Crossing 9개 run은 모두 Jain fairness 0.978 이상, starvation 157 step 이하, 5초 rolling throughput 양수, fallback 0.039% 이하, overlap/wall 0을 기록했습니다. 기준 측정값은 `baselines/`에 저장합니다. 시각 품질 지표:
`headingDeltaP95Deg`(프레임당 방향 변화 p95), `averageSpeedStd1s`(1초 창 속도
표준편차), `gateThroughputPerSec`(병목 관문 통과율),
`averageGoalProgress`, `safetyFallbackRate`, `unifiedInfeasibleRate`,
`relaxationCorrectedAgents`/`maximumRelaxationCorrection`입니다. 브라우저 콘솔의 `window.crowdDebug.getSnapshot()`은 현재 step, hash, pipeline, 활성/도착 수와 안전성·부드러움 메트릭을 반환합니다.

`FlowBehaviorTracker`는 flow별 conflict-plane crossing/arrival, Jain fairness, 최대 starvation, 300-step rolling throughput, conflict-zone lane-switch rate를 Agent-frame 기준으로 계산합니다. 다중-flow 시나리오를 UI에서 선택하면 기본 파이프라인이 `unified`로 전환되며, 명시적인 URL 파라미터나 선택기로 다른 파이프라인과 비교할 수 있습니다.

## 데이터 흐름

1. Planning은 Agent별 Flow Field, splitter portal lane, arrival slot을 조합해 전역 진행 방향을 만듭니다.
2. Multi-flow guidance는 shared conflict zone의 queue/capacity token과 opposing-flow 오른쪽 차선을 preferred path에 반영합니다. red flow는 정지선까지 연속적으로 감속하고, 기존 token의 Agent가 zone을 비운 뒤 다음 flow로 권한을 넘깁니다.
3. Crowd Preference는 국소 밀도, 평균 co-flow velocity, 같은 lane의 leader gap/speed를 읽어 preferred velocity를 만듭니다.
4. Swept Spatial Hash는 0.5초 horizon의 swept AABB가 교차하는 후보만 모읍니다.
5. acceleration-aware ORCA가 static/dynamic half-plane, max-speed 원, `maxAcceleration × dt` 도달 원을 동시에 풉니다.
6. Coupled Velocity Projector가 독립 LP 사이의 잔여 pair agreement를 대칭적으로 맞춥니다. 예측 단계에는 작은 comfort skin을 두고, 실제 endpoint 단계에는 물리 접촉 skin만 둡니다.
7. exact swept static integration이 선형화한 정적 제약을 검증합니다. 잔여 pair나 static slide가 있을 때만 Priority solver를 safety fallback으로 호출하며, 남은 수치 epsilon 침투에만 최대 0.01px position relaxation을 허용합니다.
8. 실제 변위/`dt`로 velocity를 동기화하고 도착, 겹침, 후진, 정체, fallback, infeasible, 가속도와 처리량을 집계합니다.

모바일 유닛은 Flow Field의 전역 장애물로 넣지 않습니다. 일반 간격 유지는 velocity steering이 담당하며, 마지막 비관통 backstop도 새 위치를 만들어 밀어내지 않고 각 유닛이 이미 제안한 변위만 축소합니다. 물리 충격, 질량, 운동량 전달은 모델링하지 않습니다. 따라서 충돌은 충격량 전파가 아니라 사전 양보와 국소 감속으로 보입니다.

## 주요 파라미터

- `maxSpeed`: 최고 속도(px/s)
- `maxAcceleration`: fixed step 사이 속도 변화 상한(px/s²)
- `maxTurnRate`: heading 회전율 상한(rad/s)
- `agentRadius`, `agentGap`: 물리 반경과 선호 간격
- `neighborRadius`: Spatial Hash 지역 탐색 반경
- `avoidanceHorizon`, `avoidanceBiasSeconds`: TTC 예측과 좌우 히스테리시스 시간
- `wallMargin`: 반경 밖 정적 안전 여백
- `goalRadius`, `arrivalSlowRadius`: 도착 판정과 접근 감속 범위
- `timeScale`: 렌더링과 무관하게 fixed step을 소비하는 배율

## 구조

```text
src/core                         상태, fixed-step 조정, 도착 슬롯, 정적 접촉/우선순위 안전 감속
src/algorithms/flow-field        Reverse-Dijkstra GlobalNavigator
src/algorithms/spatial-hash      지역 NeighborIndex
src/algorithms/steering          angular free-gap + reciprocal velocity solver
src/scenarios                    월드 입력 데이터
src/rendering | src/ui           Canvas 표시와 조작 UI
scripts                          재현 가능한 측정·진단 도구
tests/unit | simulation | behavior | browser
```

`core`, `algorithms`, `scenarios`에는 Canvas/DOM 의존성이 없어 엔진 좌표계와 상태 컨테이너만 맞추면 이식할 수 있습니다.

## 현재 한계

- 정적 장애물은 축 정렬 사각형입니다. 다중 목표의 합류·정면·교차 흐름은 지원하지만, flow control은 명시적인 conflict-zone metadata를 사용하며 임의 topology에서 zone을 자동 추출하지 않습니다.
- 극고밀도 다중 접촉에서 acceleration-reachable 해가 없으면 safety fallback이 가속도 상한을 넘길 수 있습니다. 이는 정상 solver 결과와 분리되어 `safetyFallbackCount`, `fallbackReason`, `emergencyStopCount`로 계측됩니다.
- seed 7/42/73 obstacle acceptance에서 fallback은 0.026–0.055%이고 multi-flow에서는 최대 0.039%이지만 0은 아닙니다. trace 도구로 해당 Agent와 레이어별 속도 변화를 재현할 수 있습니다.
- 대형 splitter 판정은 월드 횡축의 50%를 기준으로 하므로, 더 복잡한 국소 복도에는 명시적 portal graph 또는 topology metadata가 필요합니다.
- temporary closure나 움직이는 blocker의 실시간 global reroute는 아직 별도 모델이 없습니다. 목표·정적 장애물이 바뀌면 Flow Field 전체를 다시 계산하고 formation 좌표는 초기 배치 순서를 유지합니다.

참고: [GDC Vault – AI Navigation: It’s Not a Solved Problem](https://www.gdcvault.com/play/1014514/AI-Navigation-It-s-Not), [GameDev StackExchange의 공개 원리 요약](https://gamedev.stackexchange.com/questions/191954/how-can-i-create-the-arriving-engaging-in-combat-movement-like-in-starcraft-2)
