# Crowd Navigation Lab

1,000개 객체가 하나의 목표 영역으로 이동하는 2D 군중 이동 알고리즘을 독립적으로 연구하고 재현하는 웹 시뮬레이션입니다. 렌더링과 브라우저 UI는 알고리즘 코어에서 분리되어 있어 Unity, Unreal 또는 자체 엔진으로 코어를 옮길 수 있습니다.

## 현재 구현 범위

- 8방향 Reverse Dijkstra 통합 비용장과 보간된 Flow Field 방향
- Flow Field Following, Separation, 약한 Alignment, Arrival, 속도/가속도 제한
- 활성 객체만 색인하는 Uniform Grid Spatial Hash
- 1/60초 고정 timestep, 렌더 루프 분리, 현재/다음 상태 이중 버퍼
- 시드 기반 결정론적 배치, 결정론적 state hash, URL 기반 자동 정지
- Open Field, Obstacle Field, Dense Spawn 시나리오
- Canvas 목표 재지정, 파라미터 조작, 6종 디버그 표시와 9종 메트릭

## 실행과 테스트

Node.js 20.19 이상 또는 22.12 이상을 권장합니다.

```bash
cd Navigation/Crowd
npm install
npm run dev
```

```bash
npm run typecheck   # strict TypeScript 검사
npm run test:run    # Vitest 단위/시뮬레이션 테스트
npm run test:e2e    # Playwright 브라우저 테스트
npm run build       # 프로덕션 빌드
npm run verify      # typecheck + Vitest + build
```

재현 URL 예시:

```text
?scenario=open-field&agents=1000&seed=42&step=600&paused=true
```

`scenario`, `agents`, `seed`, `step`, `paused`를 지원합니다. `step`이 있으면 해당 스텝까지 결정론적으로 계산한 뒤 정지합니다. 브라우저 콘솔에서는 `window.crowdDebug.getSnapshot()`으로 step, hash, 활성/도착 수를 읽을 수 있습니다.

## 알고리즘 처리 순서

1. 현재 활성 객체로 Spatial Hash를 재구축합니다.
2. 각 객체 위치에서 Flow Field 선호 방향을 보간합니다.
3. 반경 내 후보만 검사해 Separation과 Alignment를 계산합니다.
4. Arrival, 최대 가속도, 최대 속도를 적용합니다.
5. 결과를 다음 typed-array 상태 버퍼에 씁니다.
6. 상태 버퍼를 교체하고 도착 객체를 이후 색인에서 제외합니다.
7. 겹침, 정체, 속도, 이웃 및 후보 검사 메트릭을 집계합니다.
8. Canvas 렌더러가 읽기 전용 현재 상태를 그립니다.

## 주요 파라미터

- `maxSpeed`, `maxAcceleration`: 이동 속도와 가속도의 상한
- `agentRadius`: 렌더 크기 및 겹침 판정 반경
- `neighborRadius`: 지역 이웃 탐색 범위
- `separationWeight`: 가까운 객체로부터 멀어지는 힘
- `alignmentWeight`: 주변 속도와 맞추는 약한 힘. Cohesion은 0으로 두어 사용하지 않습니다.
- `goalRadius`: 내부 진입 시 도착 처리하고 활성 업데이트/이웃 검색에서 제외하는 반경
- `timeScale`: 렌더링과 무관하게 고정 스텝을 몇 배속으로 소비할지 결정

## 시나리오

- **Open Field**: 장애물 없는 기본 흐름과 처리 성능 확인
- **Obstacle Field**: 중앙 장벽과 통로를 통한 Reverse Dijkstra 우회 확인
- **Dense Spawn**: 좁은 영역의 Separation, Alignment, Spatial Hash 안정성 확인

## 성능 메트릭

FPS, 평균/최대 시뮬레이션 스텝 시간, 활성/도착 수와 도착률, 평균 속도, 겹친 객체 쌍, 일정 시간 저속인 정체 객체, 평균/최대 실제 이웃 수, 스텝당 Spatial Hash 후보 검사 수를 표시합니다. 후보 검사 수는 O(N²) 전수 검사 대신 지역 색인이 작동하는지 관찰하는 지표입니다.

## 구조와 엔진 이식 경계

```text
src/core                         상태, clock, RNG, 수학, 메트릭, 시뮬레이션 조정
src/algorithms/flow-field        GlobalNavigator 구현
src/algorithms/spatial-hash      NeighborIndex 구현
src/algorithms/steering          LocalMovementSolver 구현
src/scenarios                    월드 입력 데이터
src/rendering                    Canvas Renderer와 debug drawing
src/ui                           DOM 템플릿과 스타일
tests/unit | simulation | browser
```

게임 엔진으로 이식할 때 `core`, `algorithms`, `scenarios`는 Canvas/DOM 의존 없이 유지할 수 있습니다. 엔진 좌표계와 메모리 컨테이너에 맞춰 상태 저장소를 교체하고, `GlobalNavigator`, `NeighborIndex`, `LocalMovementSolver`, `Renderer` 경계를 유지하면 됩니다.

## 현재 한계와 2차 확장

- 장애물은 정적 격자 사각형이며 객체-장애물 연속 충돌 검사는 단순한 축별 되돌림입니다.
- Flow Field는 목표나 장애물 변경 시 전체를 다시 계산합니다.
- 도착 객체는 목표 원 내부에서 비활성화되며 별도의 개별 도착 슬롯은 없습니다.
- 고밀도에서 물리적으로 완전한 비관통을 보장하는 ORCA/RVO 해법은 아닙니다.

혼잡도 기반 양갈래 선택은 `FlowField.computeCosts`가 사용하는 이동 비용에 `CellCostProvider` 성격의 동적 비용 입력을 추가하는 방식으로 확장할 수 있습니다. Spatial Hash의 셀별 활성 밀도를 저주기로 비용 스냅샷에 반영하고, 히스테리시스와 재계산 주기를 두어 경로 진동을 억제하는 것이 핵심입니다. 렌더러나 상태 버퍼는 이 변경의 영향을 받지 않습니다.
