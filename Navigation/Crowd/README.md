# Crowd Navigation Lab

여러 경로·회피·접촉·통행 정책을 같은 맵·seed·명령으로 실행하는 TypeScript/Vite 실험실입니다.
기존 방향별 유체 군중은 기본 **Legacy** 프리셋으로 보존했습니다. 새 비교군은 동일한
`AgentBuffer`, 반경, seeded spawn, 정적 벽, 명령·측정 인터페이스를 사용합니다.

## 빠른 시작과 프리셋별 시험

```powershell
cd Navigation/Crowd
npm ci
npm run dev
```

Windows에서는 **이 소스 폴더의 `run.bat`**을 실행해도 됩니다. 콘솔의 `[Source]`가 실행할
절대 경로이고 `[Open]`이 실제 주소입니다. 기본 포트는 `4273`이며, 같은 폴더의 서버만
재사용합니다. 다른 서버가 포트를 사용하면 다음 포트에서 시작합니다. 서버를 강제로 종료하지 않습니다.
`run.bat --no-open`은 브라우저를 열지 않고, `run.bat --port=4280`은 시작 포트를 지정합니다.
인자 없이 더블클릭하면 기존 서버를 재사용한 뒤에도 주소를 확인할 수 있도록 키 입력을 기다립니다.
브라우저 실행 완료를 기다리며, 실행 실패 시 오류와 직접 열 주소를 표시합니다.
개발 서버는 현재 폴더의 소스를 직접 읽으므로 `npm run build` 없이 변경을 반영합니다.

원본 저장소와 Git worktree는 서로 다른 소스입니다. 원본의 `run.bat`을 실행하면 원본 코드가
나옵니다. 여러 서버가 켜져 있을 때는 이전에 열어 둔 `4173` 탭이 아니라 이번 실행의
`[Open]` 주소를 사용하세요. 우측의 **알고리즘 실험실**과 **프리셋**이 신규 UI의 확인 지점입니다.

1. **객체 수 1000, seed 42, Open Field**에서 시작합니다. **알고리즘 실험실 → 프리셋**을
   고르면 초기 상태부터 일시정지합니다. **실행 → 일시정지 → 한 스텝 → 초기화**로 동작을 봅니다.
2. **B0 → B1**을 선택해 개별 A*와 공유 field를 비교합니다. 지역 이동·접촉 기본값은 같습니다.
   좁은 문·연속 코너로 바꾸면 경로 생성과 병목 차이가 드러납니다.
3. **R**에서 부대 회랑·대형과 ORCA를 봅니다. 초록색 도착자는 슬롯에 남아 충돌합니다.
   **직각 교차·목적지 밀집**에서 exit 모델과 slots 모델의 차이를 확인하세요.
4. **Q**를 양방향 통로에서 실행해 통행 방향별 batch·aging을 봅니다. **D**는 좁은 문이나
   깔때기에서 밀도 감속·혼잡 비용·유입 제어를 비교합니다. 어느 쪽도 전체 교착 해소를 보장하지 않습니다.
5. **계층별 교체 / Ablation**에서 회피만 Separation→ORCA 또는 속도 샘플링으로 바꾸고
   **조합 적용 / 초기화**를 누릅니다. Boids, 접촉 OFF/반복 수, queue, 밀도 감속과 경로 비용도 교체됩니다.
   formation은 부대 회랑, 혼잡 비용은 공유 field와만 조합할 수 있습니다. 잘못된 조합은 오류로 표시합니다.
6. **동일 조건 순차 비교**에서 step 수와 감사 모드를 고르고 **6개 프리셋 순차 비교**를 누릅니다.
   각각 새 solver로 같은 입력을 재생합니다. 모듈 교체 결과는 **현재 조합 재실행**으로 저장합니다.
   실행 중 **중단**할 수 있으며 완료 결과는 유지합니다.
7. **현재 결과 저장**, **결과 JSON 내보내기**로 보관합니다. 표의 **동일 입력**은 맵·물리 설정·seed·명령·종료 tick이
   같은 결과 수입니다. 도착 모델과 모듈 설정도 확인해야 합니다. R/Q의 유지 슬롯과 B0/B1/D의 출구 도착률은 동등한 지표가 아닙니다.
8. 개별 목표는 **개별 유닛 명령**에서 ID·X·Y로 보냅니다. 캔버스 클릭은 전원 공통 목표 명령입니다.
   명령 tick도 저장하고 재실행합니다. Legacy는 개별 명령을 지원하지 않아 이 명령이 있으면 6개 일괄 비교를 명시적으로 거절합니다.
9. **동적 길막**은 step 180에 벽 설치, 540에 철거합니다. 경로/field를 전역 무효화하여 먼 곳의
   의존 경로도 갱신합니다. 초기화하면 원래 지형으로 돌아갑니다. 유닛을 덮는 건설 요청은
   `updateObstacles`에서 지형을 바꾸기 전에 거절합니다. 슬롯에 도착해 남은 유닛도 점유자로 취급합니다.
10. 1만·5만은 **1천 기준 동일 밀도로 맵 확장**을 켭니다. 반경·속도·dt·격자 해상도는 그대로입니다.
    끄면 고정 면적 과밀 실험이며 생성 공간 부족 수를 반드시 확인해야 합니다. 확대 중에는 맵 편집을 잠급니다.

재현 URL: `/?preset=B1&scenario=narrow-door&agents=1000&seed=42&paused=true`.
대규모 초기 상태: `/?preset=D&agents=50000&scale=true&paused=true`.

| 프리셋 | 경로 | 희망 속도 / 회피 | 접촉 / 통행 / 도착 |
|---|---|---|---|
| Legacy | 기존 공유 field | 방향별 격자 속도·압력 | 기존 bounded XPBD·벽 sweep / 출구 |
| B0 | 개별 8방향 Grid A* | Seek·Arrival / Separation | 공통 PBD·원판 sweep·벽 sweep / 출구 |
| B1 | 목표·반경별 reverse Dijkstra field | B0와 동일 | B0와 동일 |
| R | 소부대 공유 Grid A* 회랑 | 가상 리더·안정 슬롯 / 원판 ORCA | 공통 접촉 / 도착자 유지 |
| Q | R | R | R + 명시한 통로의 방향 batch·aging |
| D | 공유 field·저주기 혼잡 비용 | 밀도 감속 / Separation | 공통 접촉 + 통로 대기 / 출구 |

ORCA는 실제 원판 velocity-obstacle 반평면과 속도 원 내부 최적화를 구현한 변형입니다.
불가능한 제약은 잔차를 줄이는 fallback을 사용합니다. 정적 벽 반평면을 포함하는 RVO2 전체 이식은 아닙니다.
Boids와 속도 샘플링은 별도 선택지입니다. PBD 접촉 후보는 회피 K와 분리해 반복마다 다시 구축합니다.
고속 원판의 substep과 swept-disc 제한이 있지만 유한 반복·근사 회피로 임의 고밀도 무겹침을 보장하지 않습니다.
새 코드는 원문 수식을 바탕으로 작성했으며 외부 구현을 복사하지 않았습니다.

공유 field는 목적지×반경 조합 **128개**까지 지원합니다. 전원 개별 목표는 B0의 개별 A*로 시험하세요.
Grid A*는 반경을 포함한 선분 통과성을 검사하며 셀 해상도보다 작은 길을 놓칠 수 있습니다.
도착 슬롯은 보이는 유효 공간의 안정적 lattice이며 접근 방향·위치 순으로 배정합니다.
도착자 사이에 한 유닛이 지나갈 통로를 남기므로 밀착 패킹보다 큰 면적을 사용합니다.
자리가 없으면 `unavailableSlots`로 기록합니다.
통로 정책은 지정된 축방향 gate 전용이고, 교차 시나리오의 임의 사거리 예약 문제까지 풀지는 않습니다.
전체 Continuum Crowds, NavMesh, 계층 portal cache, GPU/SIMD/LOD는 이번 군중 알고리즘과 구분한 후속 범위입니다.

## 측정·검증 명령과 결과 읽기

```powershell
npm run verify
npm run test:e2e
npm run measure:lab -- --presets=B0,B1,R,Q,D,legacy --agents=1000 --scenario=open-field --steps=900 --warmup=60 --quality=1 --output=baselines/my-quality.json
npm run measure:lab -- --presets=R,D --agents=10000,50000 --scenario=open-field --steps=180 --warmup=30 --quality=0 --scale=true --timeout=120 --output=baselines/my-scale.json
npm run measure:lab -- --presets=B0,B1 --agents=1000 --destinations=32 --steps=300 --quality=0 --output=baselines/my-goals.json
```

`measure:lab`는 각 사례를 별도 프로세스에서 순차 실행합니다. `--timeout`은 초기화까지 포함한 실제 제한이고
실패·timeout·생성 수 감소도 결과에 남습니다. 감사 OFF 성능 run과 감사 ON 품질 run을 분리하세요.
`--destinations=1|4|32|N`은 열린 평지의 고정 개별 목표 부하입니다. N개의 독립 field 생성과 공유 field의 비용을 혼동하지 않습니다.

- 요청·실제 생성·활성·이동·대기·도착·접촉 활성 수를 구분합니다. 활성 수가 감소한 후의 시간은 전원 활성 시간과 다릅니다.
- `initMs`는 spawn/최초 경로/슬롯 비용, `stepMs`는 이동 tick 시간, `passes`는 계층별 비용입니다.
  Legacy의 `avoidance`는 격자 수송, `contact`는 기존 접촉+정적 적분의 합입니다. CPU timer는 GPU 시간이 아닙니다.
- 처리 용량 Hz는 평균 이동 ms의 역수이고 실제 실행 Hz와 다릅니다. 브라우저의 frame interval은 렌더·UI·감사·대기까지 포함합니다.
  headless 결과에는 렌더 FPS가 없습니다. 프로세스 RSS/heap과 브라우저 JS heap은 전체 앱 범위이고 solver 전용 메모리가 아닙니다.
- 정밀 감사는 별도 공간 인덱스에서 후보를 자르지 않습니다. 매 tick 또는 10 tick 표본이며 `auditMs`를 별도로 기록합니다.
  swept 감사는 게시된 두 상태 사이 직선에 대한 검사이므로 내부 substep의 굽은 궤적을 전부 관찰하지는 않습니다.
- 통로 처리량은 측정선의 ID+방향별 중복 없는 통과 수입니다. 정체는 저속 시간의 대리지표이며 정상 대기와 실제 교착을 자동 구분하지 않습니다.
  방향 진동은 일정 속도 이상에서 진행 접선 대비 횡방향 속도 부호 전환을 셉니다.
- 같은 런타임·설정·seed·명령 순서에서의 재현을 검사합니다. CPU/GPU·다른 JS 엔진의 bit equality를 검증한 것은 아닙니다.

[이번 실측 결과와 한계](docs/lab-measurements.md), [설계·후보별 구현 매핑](docs/algorithm-design-map.md),
[가져온 기존 변경의 SHA-256 출처](docs/import-provenance-2026-09-20.json)를 함께 확인하세요.
연속 코너의 장시간 재현·원인·수정 결과는 [코너 완주 회귀 보고서](docs/corner-regression.md)에 있습니다.
R/Q의 초록 빈 원은 실제 개별 도착 슬롯입니다. 파란 원은 공통 명령 중심이며, 주변의 보이는 공간에
슬롯을 배정하므로 일부 유닛은 마지막 벽 앞쪽 슬롯에 도착합니다. 공통 출구 완주와 구분해서 읽어야 합니다.
1만·5만 활성 이동은 측정 대상이지 60 FPS 달성 실적이 아닙니다. 10만은 이번 검증 범위에 포함하지 않습니다.

## 보존된 Legacy solver와 기존 도구
기본 경로 안내는 **동일 목표·반경 클래스당 하나의 고정 Flow Field**를 공유합니다.
혼잡도에 따른 우회 재계산은 꺼져 있으며, 목표 또는 맵이 바뀔 때만 경로를 갱신합니다.

```text
Goal / Command
    ↓
CrowdField: mass / momentum scatter + conservative blur
    ↓
FlowField: shared static route / rebuild on goal or geometry change
    ↓
CrowdFlowSolver: 8 heading channels, desired velocity + momentum
    ↓
Shared density-capacity pressure: 8 projected Jacobi passes
    ↓
Corrected grid velocity → gather (retain dilute navigation detail)
    ↓
Acceleration-limited prediction
    ↓
Compact contact grid → at most 24 candidates / 8 pairs / 8 relaxed Jacobi passes
    ↓
Exact swept circle / static integration
```

선택 근거, 동일 머신 before/after, 한계와 UE5 Compute Shader 설계는
[개선 보고서](docs/compact-crowd.md), 후보 비교는
[설계 결정](docs/fluid-crowd-design.md)에 기록합니다.

중앙의 긴 틈과 접촉 떨림을 줄인 현재 설정의 변경 근거, 전후 수치와 CPU 비용은
[밀집 흐름 개선 기록](docs/compact-crowd.md)에서 확인할 수 있습니다.

실행 시나리오는 평지와 아래 세 가지 컨셉입니다. 빨간 사각형은 초기 생성 영역,
파란 원은 목적지입니다. 생성은 초기화 때 한 번 이루어지며, 객체 수는 모든 생성 영역의 합계입니다.

| 시나리오 | URL ID | 관찰할 동작 |
|---|---|---|
| Open Field | `open-field` | 장애물이 없는 기본 이동 |
| 연속 코너 | `winding-corners` | 세 장벽을 아래→위→아래로 우회하는 연속 코너 이동 |
| 깔때기와 우회로 | `funnel-bypass` | 고정된 경로 안내로 폭 288→72의 상단 길 또는 폭 168의 하단 길을 통과 |
| 네 생성 지점 합류 | `four-way-merge` | 네 입구에서 같은 수로 출발해 우측 하단의 한 목적지에 합류 |

깔때기는 기존 사각형 충돌 지형으로 계단식 경사를 구성합니다. 경로는 공통 FlowField가
정적 지형과 목적지로 선택합니다. 혼잡해져도 경로 방향장을 다시 계산하지 않습니다.
`routeGates`는 경로 이용량을 측정하는 영역이고 이동을 지시하는 중간 목적지가 아닙니다.

새 시나리오는 `src/scenarios/scenarios.ts`의 `SCENARIOS`에 추가하면 선택 목록과
측정 대상에 반영됩니다. 기존 제거된 시나리오는 `tests/fixtures/navigation-scenarios.ts`에
엔진 회귀 테스트 전용으로 보존합니다.

## 크기가 다른 군중

**이동 파라미터 → 큰 객체 비율 (%)**을 `5`, **큰 객체 크기 배율 (×)**을 `2`로 설정하면
전체 중 5%가 반지름 두 배의 노란색 객체로 섞입니다. 1,000명 기준 50명이며,
큰 객체도 개별 반지름에 맞춰 충돌하고 벽을 피해 이동합니다. 밀도에는 반지름 제곱에 비례하는 면적을 반영합니다.

비율은 0–100%, 배율은 1–4배입니다. 기본 비율 0%는 기존 동일 크기 군중입니다.
조절을 마치면 처음부터 다시 배치하며, 같은 시드는 같은 위치와 크기 배치를 재현합니다.
인원은 반올림하고 생성 영역별로 나눕니다. 공간이 부족하면 비율을 유지하며 생성 인원을 줄여 화면에 표시합니다.
통로를 지나갈 수 없는 크기의 객체는 벽을 관통하지 않습니다.

재현 URL: `/?agents=1000&largePercent=5&largeScale=2&seed=42`.
측정 명령에도 `--large-percent=5 --large-scale=2`를 전달할 수 있습니다.

## 맵 에디터

시뮬레이션 아래 **맵 편집**을 누르면 현재 시나리오를 복사해 편집합니다.
기본 시나리오는 바뀌지 않으며, 편집 중에는 시뮬레이션이 일시정지됩니다.

1. **장애물 그리기 / 생성 영역 그리기**를 선택하고 캔버스를 드래그합니다.
2. **목적지 배치**를 선택하고 공통 목적지를 클릭합니다.
3. **선택 / 이동**으로 물체를 드래그하거나 우측 아래 노란 손잡이로 크기를 바꿉니다.
   오른쪽 목록에서 물체를 선택하면 X·Y·가로·세로를 숫자로 입력할 수도 있습니다.
4. **적용하고 실행**으로 처음부터 시뮬레이션합니다. 생성 영역·벽 겹침과 현재 객체 크기에서의
   통로 연결을 검사합니다. 생성 공간이 부족하면 실제로 생성할 수 있는 인원을 표시합니다.
5. **브라우저 저장**을 누르면 새로고침 후에도 시나리오 목록의 **내 맵**에서 다시 선택할 수 있습니다.
   적용만 한 맵은 현재 세션에만 남습니다. **JSON 내보내기 / 가져오기**로 파일을 보관하거나 다른 브라우저로 옮깁니다.

12px 스냅을 끄면 1px 단위로 배치할 수 있습니다. 선택한 물체는 방향키로 이동하고,
Shift+방향키로 1px 이동합니다. Delete는 선택 삭제, Ctrl+Z / Ctrl+Shift+Z는 실행 취소 / 다시 실행입니다.
빈 맵으로 시작하거나 JSON을 불러온 작업도 실행 취소할 수 있습니다. **편집 취소**는 적용되지 않은
편집을 버리고 기존 시뮬레이션으로 돌아갑니다. 이미 브라우저에 저장한 내용은 유지됩니다.

첫 버전은 1200×720 크기, 사각형 장애물 최대 256개, 생성 영역 1~16개, 공통 목적지 하나를 지원합니다.
객체 수는 모든 생성 영역의 합계이며 동일 비율로 분배합니다. 브라우저 저장은 현재 사이트 주소의
로컬 저장소를 사용하며 최대 30개입니다. 다른 포트·브라우저에서는 JSON으로 가져와야 합니다.
에디터는 맵 데이터만 만들고 기존 FlowField와 접촉 솔버를 그대로 사용합니다.
콘솔 측정 스크립트는 코드에 등록된 시나리오를 대상으로 하며 브라우저 저장 맵을 자동으로 읽지 않습니다.

## 실행과 검증

```bash
npm install
npm run dev
npm run verify
npm run test:e2e
npm run measure
npm run measure:flows
npm run measure -- --scenario=winding-corners --steps=2400
npm run measure:flows -- --scenario=funnel-bypass --steps=1800
npm run measure:flows -- --scenario=funnel-bypass --steps=1800 --dynamic=true
npm run measure:flows -- --scenario=four-way-merge --steps=1500
npm run measure:quality
npm run measure -- --agents=10000 --radius=1.5 --gap=0.05 --steps=360
npm run measure:fluid -- --output=artifacts/fluid-crowd/after-fluid.json
```

`measure:fluid`는 등록된 시나리오의 1,000-Agent/900-step 품질과
10,000-Agent 요청/360-step 품질을 기록합니다. `--scenario`, `--agents`, `--steps`,
`--output`으로 범위를 지정할 수 있습니다. 진단은 simulation 타이밍 밖에서 실행합니다.

URL 파라미터: `scenario`, `agents`, `seed`, `radius`, `gap`, `step`, `paused=true`.

```text
/?scenario=open-field&agents=10000&radius=1.5&gap=0.05&seed=42&step=360&paused=true
```

요청 population이 spawn의 물리적 수용량보다 크면 `unspawnedCount`를 기록합니다.
측정에는 요청 수와 실제 수를 모두 기록합니다.

## 역할과 파라미터

- **Navigation**: 정적 장애물과 목표로 고정된 경로를 고릅니다. 같은 목표의 생성
  그룹들은 동일한 `FlowField` 인스턴스를 공유하며, 생성 그룹 ID는 통계에 남습니다.
  큰 객체는 실제 반경에 맞는 clearance 필드를 공유합니다. LOS direct-goal과
  안전한 코너 샘플링도 군중 밀도와 무관하게 동작합니다.
- **Crowd dynamics**: Agent의 desired velocity와 실제 momentum을 방향별로
  bilinear scatter합니다. 8개 heading channel에 각 Agent가 인접한 두 각도
  가중치로 기여하므로 역방향 속도가 하나의 평균으로 상쇄되지 않습니다.
  공유 압력은 목표 밀도 초과와 예측 mass-flux divergence로 계산합니다.
  음의 압력·cohesion·Agent별 pressure probe는 없습니다.
- **Contact**: 후보 24, pair 8, iteration 8의 고정 예산입니다. population별
  contact/compliance 단계는 제거했습니다. 완전 중첩 입력에서도 작업량은 유계입니다.
  동일 위치 normal은 결정론적이며, Jacobi correction을 동시 publish합니다.
  여러 접촉의 합을 접촉 수로 완화해 과도한 반발과 내부 틈을 줄입니다.
  한 번 만든 후보 목록에는 보정 중 닿을 가까운 쌍도 포함하며, 8회 전체의
  누적 접촉 이동 길이가 `maximumContactCorrection`을 넘지 않습니다.
- **Static collision**: 접촉 publish 후 정적 투영, current→predicted exact sweep,
  월드/장애물 안전 검사를 유지합니다. Grid는 exact static safety를 대체하지 않습니다.

| 설정 | 의미 |
|---|---|
| `navCellSize` | 정적/동적 경로 Grid 해상도 |
| `crowdFieldCellSize` | density와 velocity Grid 해상도 |
| `pressureThreshold` | radius 3.2/cell 24 기준 목표 셀 질량, 기본 12; 반경²과 셀 면적으로 정규화 |
| `crowdPressureIterations` | 모든 셀에 동일하게 실행하는 압력 반복, 기본 8 |
| `crowdPressureRelaxationTime` | 압축 초과량과 예측 mass transport를 평가할 시간, 기본 .25초 |
| `crowdVelocityBlend` | 밀집 셀의 실제 운동량 비중, 기본 .68; 나머지는 navigation velocity |
| `maxAcceleration` | Agent 속도 변화 상한, static/contact 안전은 우선 |
| `contactCompliance` | 모든 population에 같은 XPBD compliance, 기본 .00001 |
| `maximumContactCorrection` | Agent당 한 step의 접촉 위치 보정 상한, 기본 1.25px |
| `contactCellSize` | 접촉 Grid 최대 셀 크기; 실제 크기는 contact diameter 이하 |
| `dynamicFlowRebuildInterval` | 경로 혼잡 비용 갱신 간격, 기본 8 step |
| `dynamicFlowTargetDensity` | 경로 우회 비용이 시작되는 정규화 밀도, 기본 .75 |
| `dynamicFlowDensityWeight` | 기준을 넘은 밀도의 제곱에 곱하는 혼잡 비용, 기본 72 |

`dynamicRouting`의 기본값은 `false`입니다. 위 `dynamicFlow*` 설정은 비교 연구에서
명시적으로 `dynamicRouting: true`를 지정할 때만 쓰입니다. CLI 비교는
`npm run measure:flows -- --dynamic=true`로 실행합니다. 화면에는 동적 우회 조절기를
표시하지 않습니다. 물리적인 압력·속도 보정은
`CrowdFlowSolver`가 담당합니다. Agent steering에서 같은 force를 다시 더하지 않습니다.
`neighborRadius`는 기존 이웃 반경 디버그 표시용이며 movement neighbor budget을 바꾸지 않습니다.

## 품질 진단

기존 jerk, penetration, gate throughput, fairness, wall overlap 지표를 유지합니다.
추가 진단은 `CrowdQualityTracker`에서 10 step마다 수집됩니다.

- 같은 flow의 bounded 최근접 거리 P50/P95/variance 및 표본 coverage.
- 내부 셀 밀도의 squared coefficient of variation (`densityVariance`).
- 네 축으로 3셀 이내 군중에 둘러싸인 내부 empty cell 비율 (`interiorVoidFraction`).
  월드 외부·정상 군중 외부·정적 장애물 너머는 제외합니다.
- 같은 flow의 근접 속도 차이 RMS (`sameFlowVelocityRms`, 낮을수록 좋음).
- 기존 100,000 상한 jerk와 함께 10,000,000 범위의 `jerkExtendedP95`,
  기존 상한을 넘는 비율 `jerkClippedFraction`.

거리/속도 진단은 Agent당 최대 256 후보, 반경 4 diameter로 유계입니다.
`truncatedQueryFraction`이 높으면 정확한 최근접 분포가 아닌 표본 추정입니다.
Void 지표는 작은 내부 구멍을 위한 local proxy이며 임의 크기/모양의 구멍 검출기는 아닙니다.
`maxPenetrationDepth`는 마지막 step의 bounded 표본 최대이고, `measure:fluid`의
`maximumPenetration`은 실행 전체의 그 최대값입니다. `overlapPairs`도 전체 쌍 수가 아닙니다.

## 주요 파일

```text
src/core/simulation.ts                  공통 navigation과 pass orchestration
src/core/crowd-field.ts                 shared density / momentum / overload
src/core/crowd-flow-solver.ts           directional grid velocity / capacity pressure
src/core/crowd-movement-solver.ts       bounded residual XPBD / static safety
src/algorithms/spatial-hash/spatial-hash.ts  count / prefix sum / contiguous indices
src/core/crowd-continuity-metrics.ts    spacing / interior density / void / velocity RMS
src/core/crowd-quality-metrics.ts       기존+새 품질 진단
scripts/measure-fluid.ts                동일 조건 비교와 pass profiling / ablation
```

브라우저에서 `window.crowdDebug.getSnapshot()`과 `.simulation()`을 사용할 수 있습니다.
같은 config/seed/명령 순서는 같은 `stateHash()`를 만듭니다. Float64 CPU 결정론이
GPU floating-point atomic 결정론이나 CPU/GPU bit equality를 뜻하지는 않습니다.

## 내부 빈 공간 회복 실험

실제 원형 객체의 내부 공동을 채우는 독립 기준 backend와 OFF/ON 재생 화면을
추가했습니다. `npm run dev` 후 `/experiments/fluid-navigation/`에서 확인합니다.
`npm run research:repair`로 고정 초기 상태를 실행하고, `npm run research:audit`로
진단 해상도에 따른 차이를 확인할 수 있습니다.

현재 범위는 미리 지정한 내부 영역을 쓰는 P0~P2a입니다. 24회 실행 결과,
수치 방법, 강한 압축에서의 수렴 한계와 후속 작업은
[구현 결과](docs/fluid-navigation-implementation.md)에 기록했습니다.

## 범위와 한계

압력은 고정 횟수·셀 중심 속도·속도 상한을 사용하는 밀도 용량 근사입니다.
완전 비압축 물 solver, exact pair packing, 임의 장애물 형상에 대한 Grid 해상도
독립성은 보장하지 않습니다. 접촉은 완전 중첩과 강한 대향 흐름에서 여전히 중요합니다.
10k CPU 실측과 GPU mapping 설계를 제공하며, 100k GPU 실측을 주장하지 않습니다.
