# Crowd Navigation Lab

결정론적 2D 군중 이동 실험입니다. 군중의 흐름은 방향별 Grid 속도가 만들고,
원형 접촉과 exact static sweep은 물리적 안전을 담당합니다. 모든 population과
시나리오가 같은 방향 선택 정책과 같은 접촉 예산을 사용합니다.

```text
Goal / Command
    ↓
CrowdField: mass / momentum scatter + conservative blur
    ↓
FlowField: shared local navigation policy / periodic route costs
    ↓
CrowdFlowSolver: 8 heading channels, desired velocity + momentum
    ↓
Shared density-capacity pressure: 8 projected Jacobi passes
    ↓
Corrected grid velocity → gather (retain dilute navigation detail)
    ↓
Acceleration-limited prediction
    ↓
Compact contact grid → at most 24 candidates / 8 pairs / 1 Jacobi pass
    ↓
Exact swept circle / static integration
```

선택 근거, 동일 머신 before/after, 한계와 UE5 Compute Shader 설계는
[개선 보고서](docs/fluid-crowd-report.md), 후보 비교는
[설계 결정](docs/fluid-crowd-design.md)에 기록합니다.

실행 시나리오는 평지와 아래 세 가지 컨셉입니다. 빨간 사각형은 초기 생성 영역,
파란 원은 목적지입니다. 생성은 초기화 때 한 번 이루어지며, 객체 수는 모든 생성 영역의 합계입니다.

| 시나리오 | URL ID | 관찰할 동작 |
|---|---|---|
| Open Field | `open-field` | 장애물이 없는 기본 이동 |
| 연속 코너 | `winding-corners` | 세 장벽을 아래→위→아래로 우회하는 연속 코너 이동 |
| 깔때기와 우회로 | `funnel-bypass` | 폭 288→72로 줄어드는 상단 길과 폭 168의 하단 길 사이의 혼잡 분산 |
| 네 생성 지점 합류 | `four-way-merge` | 네 입구에서 같은 수로 출발해 우측 하단의 한 목적지에 합류 |

깔때기는 기존 사각형 충돌 지형으로 계단식 경사를 구성합니다. 경로는 공통 FlowField가
현재 혼잡 비용으로 선택하며, 특정 인원 수를 기준으로 강제 우회시키지 않습니다.
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
npm run measure:flows -- --scenario=funnel-bypass --steps=1800 --dynamic=false
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

- **Navigation**: 정적 장애물과 목표, 저주기 혼잡 비용으로 경로를 고릅니다.
  LOS direct-goal은 공통 `FlowField` 경로에서 density/counter-flow/clearance로
  연속 blend합니다. 시나리오 ID·장애물 수·flow 수로 알고리즘을 바꾸지 않습니다.
- **Crowd dynamics**: Agent의 desired velocity와 실제 momentum을 방향별로
  bilinear scatter합니다. 8개 heading channel에 각 Agent가 인접한 두 각도
  가중치로 기여하므로 역방향 속도가 하나의 평균으로 상쇄되지 않습니다.
  공유 압력은 목표 밀도 초과와 예측 mass-flux divergence로 계산합니다.
  음의 압력·cohesion·Agent별 pressure probe는 없습니다.
- **Contact**: 후보 24, pair 8, iteration 1의 고정 예산입니다. population별
  contact/compliance 단계는 제거했습니다. 완전 중첩 입력에서도 작업량은 유계입니다.
  동일 위치 normal은 결정론적이며, symmetric Jacobi correction을 동시 publish합니다.
- **Static collision**: 접촉 publish 후 정적 투영, current→predicted exact sweep,
  월드/장애물 안전 검사를 유지합니다. Grid는 exact static safety를 대체하지 않습니다.

| 설정 | 의미 |
|---|---|
| `navCellSize` | 정적/동적 경로 Grid 해상도 |
| `crowdFieldCellSize` | density와 velocity Grid 해상도 |
| `pressureThreshold` | radius 3.2/cell 24 기준 목표 셀 질량; 반경²과 셀 면적으로 정규화 |
| `crowdPressureIterations` | 모든 셀에 동일하게 실행하는 압력 반복, 기본 8 |
| `crowdPressureRelaxationTime` | 압축 초과량과 예측 mass transport를 평가할 시간, 기본 .25초 |
| `crowdVelocityBlend` | 밀집 셀의 실제 운동량 비중, 기본 .68; 나머지는 navigation velocity |
| `maxAcceleration` | Agent 속도 변화 상한, static/contact 안전은 우선 |
| `contactCompliance` | 모든 population에 같은 XPBD compliance, 기본 .00001 |
| `maximumContactCorrection` | Agent당 한 step의 접촉 위치 보정 상한, 기본 1.25px |
| `contactCellSize` | 접촉 Grid 최대 셀 크기; 실제 크기는 contact diameter 이하 |
| `dynamicFlowRebuildInterval` | 경로 혼잡 비용 갱신 간격, 기본 8 step |

`dynamicFlow*` 비용은 대체 경로 선택에만 쓰입니다. 물리적인 압력·속도 보정은
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

## 범위와 한계

압력은 고정 횟수·셀 중심 속도·속도 상한을 사용하는 밀도 용량 근사입니다.
완전 비압축 물 solver, exact pair packing, 임의 장애물 형상에 대한 Grid 해상도
독립성은 보장하지 않습니다. 접촉은 완전 중첩과 강한 대향 흐름에서 여전히 중요합니다.
10k CPU 실측과 GPU mapping 설계를 제공하며, 100k GPU 실측을 주장하지 않습니다.
