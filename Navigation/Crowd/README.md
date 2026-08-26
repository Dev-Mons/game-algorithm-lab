# Crowd Navigation Lab

1,000개 유닛의 RTS형 군중 이동을 재현하는 결정론적 2D 웹 시뮬레이션입니다. Reverse-Dijkstra Flow Field가 전역 경로를 제공하고, 동적 유닛은 angular free-gap steering과 제한된 원형 비관통 보정으로 처리합니다. 공개된 StarCraft II GDC 설계 원리에서 계층 분리와 지역 여유 공간 선택을 참고했지만, SC2의 실제 구현을 복제한 코드는 아닙니다.

## 구현 범위

- 8방향 Reverse-Dijkstra 비용장과 exact clearance 선분 검증을 거치는 bilinear Flow Field 보간
- 원·예측 위치·TTC를 heading 공간의 차단 각도 구간으로 투영하는 free-gap steering
- 정적 AABB와 월드 경계의 반경·여백 확장, swept-circle TOI와 접선 슬라이드
- Phase A intent 계산 → Phase B 네 번의 Jacobi 속도 조정 → Phase C 정적 적분/원형 위치 제약 → Phase D 상태/메트릭 집계
- 같은 프레임의 전체 steering intent 공유와 이전 회피 방향 히스테리시스
- 방향 회전율(`maxTurnRate`)과 속도 변화(`maxAcceleration`) 상한, 여유 거리/TTC 기반 연속 감속
- seed와 agent ID 기반의 안전한 분산 arrival slot
- 대형 stream splitter의 조기 formation-side 선택과 portal lane 분산
- exact-tangent 고착을 막는 0.06px 정적 접촉 스킨
- 활성 유닛만 색인하는 Uniform Grid Spatial Hash
- 1/60초 fixed timestep, typed-array 이중 버퍼, persistent steering state를 포함한 state hash
- Open Field, Obstacle Field, Dense Spawn 시나리오와 Canvas 디버그 UI

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
npm run build           # 프로덕션 번들
npm run verify          # typecheck + Vitest + build
```

재현 URL 예시:

```text
?scenario=obstacle-field&agents=1000&seed=42&step=900&paused=true
```

`scenario`, `agents`, `seed`, `step`, `paused`를 지원합니다. 브라우저 콘솔의 `window.crowdDebug.getSnapshot()`은 현재 step, hash, 활성/도착 수와 안전성·부드러움 메트릭을 반환합니다.

## 데이터 흐름

1. Planning은 Flow Field를 샘플링하고, stream splitter의 portal lane과 목표 근처 arrival slot을 혼합해 preferred heading을 만듭니다.
2. Spatial Hash에서 지역 이웃을 모아 agent ID 순으로 재사용 버퍼에 정렬합니다.
3. Steering Phase A는 유닛 원, 예측 위치, TTC, 장애물, 월드 경계의 차단 각도 구간을 병합하고 preferred heading에서 가장 가까운 열린 간격을 선택합니다.
4. Steering Phase B는 모든 유닛의 동일 스냅샷 intent를 이용해 안전 속도를 계산하고, 네 번의 동시 Jacobi pass로 접촉 법선 속도를 조정합니다.
5. Collision Phase C는 swept-circle TOI에서 법선 성분만 제거하고 접선 속도를 보존한 뒤, 6~8회의 제한된 원형 Jacobi 보정과 결정론적 component fallback을 적용합니다.
6. Phase D는 실제 변위와 저장 속도를 동기화하고 상태 버퍼를 교체하며 도착, 겹침, 후진, 정체, 가속도, jerk, hard-stop, side-switch, 후보 검사 수를 집계합니다.

모바일 유닛은 Flow Field의 전역 장애물로 넣지 않습니다. 일반 간격 유지는 velocity steering이 담당하며, 마지막 위치 보정은 다음 step의 실제 침투와 기존 겹침만 다룹니다. 물리 충격, 질량, 운동량 전달, 전체 ORCA 선형계획은 구현하지 않습니다. 다만 새 접촉이 제한된 Jacobi 반복 뒤에도 남으면 안전을 위해 접촉 component의 공통 변위를 사용하는 kinematic backstop이 작동합니다.

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
src/core                         상태, fixed-step 조정, 도착 슬롯, 정적/군중 충돌
src/algorithms/flow-field        Reverse-Dijkstra GlobalNavigator
src/algorithms/spatial-hash      지역 NeighborIndex
src/algorithms/steering          angular free-gap LocalMovementSolver
src/scenarios                    월드 입력 데이터
src/rendering | src/ui           Canvas 표시와 조작 UI
scripts                          재현 가능한 측정·진단 도구
tests/unit | simulation | browser
```

`core`, `algorithms`, `scenarios`에는 Canvas/DOM 의존성이 없어 엔진 좌표계와 상태 컨테이너만 맞추면 이식할 수 있습니다.

## 현재 한계

- 정적 장애물은 축 정렬 사각형이며, 서로 다른 목표를 가진 양방향 군중의 최적 통과는 범위 밖입니다.
- 마지막 비관통 보정은 안전을 우선하므로 극고밀도 접촉에서는 설정된 steering 가속도보다 큰 위치 보정이 `emergencyStopCount`로 별도 계수될 수 있습니다. 이 값은 실제 완전 정지만이 아니라 모든 acceleration 초과 안전 보정의 agent-frame 수입니다.
- component fallback은 운동량을 전달하지 않고 침투를 만들지 않지만, 밀집 접촉 그래프에서는 많은 유닛의 한-step 변위를 결합할 수 있습니다. 후보 검사와 jerk가 늘어나는 현재 구현의 가장 큰 성능·모션 절충입니다.
- 대형 splitter 판정은 월드 횡축의 50%를 기준으로 하므로, 더 복잡한 국소 복도에는 명시적 portal graph 또는 topology metadata가 필요합니다.
- 목표나 장애물이 바뀌면 Flow Field 전체를 다시 계산하고 formation 좌표는 초기 배치 순서를 유지합니다.

참고: [GDC Vault – AI Navigation: It’s Not a Solved Problem](https://www.gdcvault.com/play/1014514/AI-Navigation-It-s-Not), [GameDev StackExchange의 공개 원리 요약](https://gamedev.stackexchange.com/questions/191954/how-can-i-create-the-arriving-engaging-in-combat-movement-like-in-starcraft-2)
