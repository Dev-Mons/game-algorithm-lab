# Crowd Navigation Lab

같은 맵·seed·명령으로 군중 이동 알고리즘을 선택하고 측정하는 TypeScript/Vite 실험실입니다.
현재 등록된 알고리즘은 **Legacy · 방향별 유체 군중** 하나입니다.
B0/B1/R/Q/D와 해당 전용 구현·설정 UI는 제거했습니다.
알고리즘 등록, 선택, 공통 실행 인터페이스, 순차 비교, 결과 저장·내보내기는 유지합니다.

## 실행과 비교

```powershell
cd Navigation/Crowd
npm ci
npm run dev
```

Windows에서는 이 폴더의 **run.bat**을 실행해도 됩니다. 기본 포트는 4273이며,
콘솔의 [Source]와 [Open]으로 실행 소스와 주소를 확인합니다.
원본 저장소와 worktree는 다른 소스입니다. 기존 브라우저 탭보다 이번 실행 주소를 사용하세요.

1. **알고리즘 실험실 → 프리셋**에서 알고리즘을 선택합니다. 현재는 Legacy만 표시됩니다.
2. **실행 / 일시정지 / 한 스텝 / 초기화**로 동작을 확인합니다. 캔버스 클릭은 공통 목표 명령입니다.
3. **동일 조건 순차 비교**의 실행 스텝과 품질 감사를 정하고 등록된 프리셋을 순차 실행합니다.
   선택 목록과 비교 개수는 등록 목록에서 자동으로 생성됩니다.
4. **현재 프리셋 재실행**, **현재 결과 저장**, **결과 JSON 내보내기**를 사용합니다.
   맵·물리 설정·seed·명령·종료 tick과 도착 모델을 확인하여 결과를 비교하세요.
5. 대규모 실험은 **1천 기준 동일 밀도로 맵 확장**을 사용합니다.
   반경·속도·dt·격자 해상도는 그대로이며, 공간이 부족하면 실제 생성 수를 확인합니다.

Legacy는 개별 유닛 목표 명령과 계층별 모듈 교체를 지원하지 않습니다.
**이동 회전 속도 (°/초)**는 실제 이동 속도 벡터가 꺾이는 각도를 제한합니다.
기본값은 360이며 0~720으로 조절합니다(0은 자발적 방향 전환 정지).
60°/초처럼 낮추면 코너에서 더 크게 돌아가거나 벽 앞에서 감속하며,
가속도 제한도 함께 작용하므로 높은 설정끼리는 차이가 작을 수 있습니다.
방향 표시는 이 이동 방향을 보간합니다. 목표를 바꿀 때 기존 운동량을 즉시 지우지 않습니다.
군중 접촉과 벽 충돌의 밀어내기·미끄러짐은 안전을 위해 회전 제한보다 우선합니다.
회전 방향은 이동 상태 해시에 포함됩니다.
동적 길막 시나리오는 step 180에 벽을 설치하고 540에 철거합니다.
유닛과 겹치는 벽 설치는 거절하며, 지형 변경 시 공유 경로를 갱신합니다.

재현 URL: `/?preset=legacy&scenario=narrow-door&agents=1000&seed=42&paused=true`.

```powershell
npm run verify
npm run test:e2e
npm run measure:lab -- --presets=legacy --agents=1000 --scenario=open-field --steps=900 --warmup=60 --quality=1 --output=baselines/my-quality.json
```

CLI에서 --presets를 생략하면 등록된 모든 알고리즘을 실행합니다.
감사 OFF 성능과 감사 ON 품질 실행을 구분하세요. headless 시간에는 렌더링이 포함되지 않습니다.
정체는 저속 시간의 지표이며 교착 확정이 아닙니다. Legacy의 contact 시간은 접촉과 정적 적분을 합칩니다.

## 알고리즘 확장 구조

[등록 및 실행 계약](docs/algorithm-design-map.md)을 따라 새 구현을 추가하고
`src/algorithms/lab/registry.ts`의 PRESETS에 등록합니다.
선택 UI, 순차 비교, CLI 측정은 같은 등록 목록을 사용합니다.
Legacy의 격자·접촉 구조를 유지하며, 회전 제한을 포함한 이동 재현을 검증합니다.

기존 측정 JSON, 소스 스냅샷과 연구 보고서는 과거 실험 기록입니다.
삭제된 알고리즘의 과거 기록은 현재 실행 가능한 프리셋을 의미하지 않습니다.
브라우저에 저장된 과거 비교 결과도 조회·내보내기용으로 유지됩니다.

## Legacy solver와 기존 도구
### 외력 실험

캔버스 아래 **클릭 도구**에서 폭발·확장 충격파·지속 밀림·이동 원형 물체를 선택합니다.
군중 근처를 클릭하고 실행하거나 한 스텝을 진행하면 적용됩니다. 외력 반응과 이동 물체의 디버그 윤곽은 그리지 않습니다.
입력은 고정 tick으로 기록되어 기존 재실행·결과 내보내기에 포함됩니다.
외부 프로그램은 `CrowdSimulation.enqueueExternal()`을 사용합니다.

실행 통계에는 시뮬레이션/실시간 비율, 누적 지연과 시간 손실이 표시됩니다.
가벼운 프레임은 남은 CPU 예산으로 고정 tick을 따라잡고, 과부하의 시간 버림과
긴 프레임 제한은 별도로 기록합니다. 상태 해시는 일시정지 및 명시적 결과 조회에서 계산합니다.
`window.crowdDebug.getFrameTrace()`는 최근 4,096개 실제 앱 프레임의 원시 기록을 내보냅니다.
실제 HTTP 앱 루프 측정은 `node scripts/measure-frame.mjs --url=http://127.0.0.1:4273`을 사용합니다.
이 도구는 tick 30에 실제 캔버스 입력을 보내며, 구간별 요약과 원시 기록을 함께 저장합니다.
`--quality=on`은 독립 품질 감사 실행입니다. 이 실행의 프레임 시간을 성능 결과로 사용하지 않습니다.

외력 Contact는 f64 WebAssembly 커널을 사용합니다. 교차 출처 격리가 가능한 브라우저에서는
충돌 쌍을 개체가 겹치지 않는 그룹으로 정렬해 main과 최대 3개 worker에서 계산합니다.
Vite 개발·preview 서버는 필요한 COOP/COEP 헤더를 제공합니다. 다른 호스트에서는
`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`가
필요합니다. 지원하지 않는 환경은 단일 스레드 WebAssembly 또는 TypeScript로 실행합니다.
직접 생성한 `CrowdSimulation`을 폐기할 때는 `dispose()`로 worker를 종료하세요.
worker 실패 시 부분 결과를 버리고 같은 tick을 CPU에서 다시 계산합니다. 커널 수정 후 `npm run build:contact`로 생성 파일을 갱신하세요.
`npm run verify`는 생성 파일과 원본의 일치도 확인합니다. 이 변경 자체가 10K 60FPS 수락을 뜻하지는 않습니다.

지원 범위, 단위, 중복·reset·끼임 정책은 [외력 설계 및 입력 계약](docs/external-forces.md),
실제 수치와 한계는 [외력 검증 결과](docs/external-forces-results.md)에 있습니다.
외력 최적화 이후의 측정 조건과 남은 한계는 [외력 계약](docs/external-forces.md#performance-evidence-and-limits)에 정리되어 있습니다.
현재 #33 후보는 외력 없는 성능과 표본 접촉 품질을 개선했지만, 실제 10K 외력의
60FPS·실시간 진행률 수락 기준에는 미달합니다. 원시 측정은 `baselines/frame-20260926/`에 보존합니다.

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
Acceleration- and turn-rate-limited prediction
    ↓
Compact contact grid → at most 24 candidates / 8 pairs / 8 relaxed Jacobi passes
    ↓
Exact swept circle / static integration
```

중앙의 긴 틈과 접촉 떨림을 줄인 현재 설정의 변경 근거, 전후 수치와 CPU 비용은
[밀집 흐름 개선 기록](docs/compact-crowd.md)에서 확인할 수 있습니다.

실행 시나리오는 평지와 아래 네 가지 컨셉입니다. 빨간 사각형은 초기 생성 영역,
파란 원은 목적지입니다. 생성은 초기화 때 한 번 이루어지며, 객체 수는 모든 생성 영역의 합계입니다.

| 시나리오 | URL ID | 관찰할 동작 |
|---|---|---|
| Open Field | `open-field` | 장애물이 없는 기본 이동 |
| 연속 코너 | `winding-corners` | 세 장벽을 아래→위→아래로 우회하는 연속 코너 이동 |
| 깔때기와 우회로 | `funnel-bypass` | 고정된 경로 안내로 폭 288→72의 상단 길 또는 폭 168의 하단 길을 통과 |
| 네 생성 지점 합류 | `four-way-merge` | 네 입구에서 같은 수로 출발해 우측 하단의 한 목적지에 합류 |
| 바위 협곡 | `rocky-pass` | 이미지의 바위섬·꺾인 장벽을 지나 왼쪽 세로 생성 영역에서 오른쪽 중앙 목적지로 이동 |

바위 협곡은 참고 이미지의 지형을 1200×720 맵에 맞추고 12px 사각형으로 근사합니다.
왼쪽 생성 영역은 기본 1,000명을 수용하도록 폭을 확보했습니다. 이미지의 빨간 원 위치가
목적지이며, 화면에서는 기존 목적지 표시인 파란 원으로 보입니다.
재현 URL: `/?scenario=rocky-pass&agents=1000&seed=42&paused=true`.

**1만 개용 확장 맵**: `/?scenario=rocky-pass&agents=10000&scale=true&seed=42&paused=true`.
객체 반경은 기본 3.2를 유지하고 맵·장애물·생성 영역의 가로와 세로를 √10배로 확대합니다.
월드는 약 3795×2277, 면적은 10배이며 기본 크기의 객체 10,000개를 배치합니다.
UI에서는 객체 수를 10,000으로 설정하고 **1천 기준 동일 밀도로 맵 확장**을 켜면 됩니다.
확장 모드에서는 맵 편집을 지원하지 않습니다.

복잡한 지형의 경로·충돌 검사는 정적 장애물 공간 인덱스와 주변 후보 캐시를 사용합니다.
바위 협곡의 정적 장애물 조회는 BVH와 작은 영역 후보 캐시를 사용하며, 최종 거리·충돌 판정과 장애물 순서를 유지합니다. 과거 headless Chromium 측정(seed 42, 반경 3.2, 동일 밀도 확장, 감사 OFF, 예열 30 + 측정 120스텝)에서 10k 스텝 평균은 92.56→31.01ms, P95는 102.20→37.20ms였습니다. [변경 전](docs/measurements/rocky-pass-before.json)과 [변경 후](docs/measurements/rocky-pass-after.json) 원시 자료를 보존합니다. 당시 150스텝 상태 해시가 일치했으나 60FPS·장시간 이동·GPU 성능을 보장하는 결과는 아닙니다.

성능 재현은 `npm run dev` 실행 후 별도 터미널에서 `node scripts/profile-performance.mjs http://127.0.0.1:4273`을 사용합니다. 결과는 `test-results/performance-profile/`에 저장됩니다.

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
