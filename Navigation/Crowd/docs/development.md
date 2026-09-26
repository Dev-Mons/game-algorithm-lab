# 개발과 검증

수정할 계산 단계는 [architecture.md](architecture.md), 언어 간 입출력 비교는
[native-porting.md](native-porting.md)를 참고합니다. 명령은 `Navigation/Crowd`에서 실행합니다.

## 수정할 위치

| 변경 | 시작점 | 보존할 경계 |
|---|---|---|
| 경로·코너 안내 | [flow-field.ts](../src/algorithms/flow-field/flow-field.ts) | 반경 clearance, 안전한 LOS, 목표 공유 |
| 밀도·내부 틈·속도 제안 | [crowd-flow-solver.ts](../src/core/crowd-flow-solver.ts) | 실제 위치 재산포, 면적 질량, 최종 이동과의 일관성 |
| 회전·외력 반응·군중 충돌 | [crowd-movement-solver.ts](../src/core/crowd-movement-solver.ts) | 가속도, 고정 접촉 예산, thin-wall·swept 안전 |
| 정적 검색 최적화 | [static-obstacle-index.ts](../src/core/static-obstacle-index.ts) | 장애물 순서와 최종 정확 기하 검사 |
| 입력·상태 모델 | [crowd-kernel.ts](../src/core/crowd-kernel.ts), [port-contract.ts](../src/core/port-contract.ts) | tick 순서·상태 소유권·이식 계약 |
| 화면·맵 편집 | [main.ts](../src/main.ts), [editor](../src/editor), [rendering](../src/rendering) | 계산 책임을 렌더러로 옮기지 않기 |

내부 틈 개선은 압력 강도만 높여 해결했다고 판단하지 않습니다. 같은 초기 상태에서 경로 고정/동적 경로,
격자 보정 전후와 최종 속도, 접촉 예산, subcell 위치를 필요한 항목만 비교합니다.
위치 보정이 다음 tick 속도로 들어가는 경로와 보정 에너지를 함께 봅니다. 접촉을 꺼서 얻은 부드러움은 품질 통과가 아닙니다.

새 기능의 첫 검증 경계는 다음과 같습니다. 구현된 기능 목록은 [현재 범위](architecture.md#기능-범위와-알려진-한계)와 구분합니다.

- 생성·삭제: 고정 배열 인덱스, 외력 target/hit mask, 버퍼·격자 수명과 ID 재사용.
- 개별 목표·정지형 도착: 목표 수에 따른 공유 필드 수, 재경로 요청 비용, 목적지의 실제 수용량.
- 병목·교행: 통과량과 공정성을 함께 측정. 수용량을 넘는 유입과 통행 정책은 더 강한 반발력으로 대체하지 않음.
- 병렬화·GPU: swept pair의 양 끝점 쓰기 충돌과 계산 순서를 먼저 해결. 화면에 보이는 수와 실제 활성·계산 대상을 구분.
- 내부 공동 회복: donor 질량과 외곽·분기 판별, 실제 원의 비침투를 함께 검증. [독립 실험](../experiments/fluid-navigation/particle-protocol.md)은 알려진 내부 영역만 다룸.

## 새 프리셋과 시나리오

1. [LabPipeline](../src/algorithms/lab/pipeline.ts)을 구현합니다. `current`를 읽고 `next`에 쓰며
   선호속도·목표·available·navigators·sample·stats를 제공합니다. 새 구현이 경로 생성·도착을 담당합니다.
2. [PRESETS](../src/algorithms/lab/registry.ts)에 id·설명·한계·options·createPipeline을 등록합니다.
   `destination`은 `exit` 또는 `slots`입니다. Legacy만 팩토리 없이 내장 코어를 사용합니다.
3. 옵션 변경은 validateOptions, 개별 목표는 supportsIndividualGoals와 overrides 처리를 함께 제공합니다.
   초기화·목표·지형 변경마다 팩토리가 호출됩니다. 이전 상태는 previous에서 전달받습니다.
4. 매 step 통계와 누적 통계를 구분합니다. 어댑터가 보존하는 경로·필드·통과 카운터를 이중 누적하지 않습니다.
5. 동일 맵·초기 상태·명령에서 비교합니다. UI 선택·순차 비교·CLI 목록은 레지스트리를 공유합니다.

새 시나리오는 [SCENARIOS](../src/scenarios/scenarios.ts)에 등록합니다.
[LabCommand](../src/scenarios/lab-scenarios.ts)는 목표·지형·외력 명령 재생을 연결합니다.
지형 변경은 `updateObstacles()`를 통해 경로까지 무효화합니다. `routeGates`는 계측용입니다.

## 검증 선택

| 변경 범위 | 필요한 검사 |
|---|---|
| 계산 코어·공유 규칙 | `npm run verify`, `npm run port:verify`; 실제로 바뀐 웹 경계만 Playwright 검사 |
| 이식 계약·도구 | `npm run typecheck`, 계약 테스트, Python 검사기 테스트, 실제 export/verify/compare |
| UI·에디터·clock | 타입 검사와 관련 단위 테스트·브라우저 테스트 |
| 문서만 | 링크·경로·명령 옵션·현재 계약 대조. 계산 테스트와 전체 빌드를 반복하지 않음 |

```powershell
npm run test:run -- tests/simulation/port-contract.test.ts
python -m unittest discover -s porting -p 'test_*.py'
npm run test:e2e -- tests/browser/algorithm-lab.spec.ts tests/browser/external-reference.spec.ts
```

회귀 위치: `legacy-baseline`은 이동·재명령·초기화 해시, `external-influences`는 외력 수명과
API/직접 속도 동등성, `movement-v2`는 접촉 예산·혼합 크기·과밀, `static-index-equivalence`와
`exact-cache-equivalence`는 최적화 전후의 기하·상태 동등성을 검사합니다.
`port-contract`는 분리 전 고정 기대값을 비교합니다. 움직임이 달라졌다는 이유로 기준값을 먼저 바꾸지 않습니다.
필수 검사가 통과하면 새 변경·실패·구체적인 우려가 없는 한 검증을 확대하지 않습니다.

## 성능과 품질 재현

### 계산만 측정

```powershell
npm run measure:lab -- --presets=legacy --agents=1000 --scenario=open-field --steps=900 --warmup=60 --quality=0 --output=test-results/crowd-performance.json
npm run measure:lab -- --presets=legacy --agents=1000 --scenario=open-field --steps=900 --warmup=0 --quality=1 --output=test-results/crowd-quality.json
npm run measure:fluid -- --scenario=winding-corners --agents=1000 --steps=900 --output=test-results/crowd-continuity.json
```

CLI 목록은 프리셋 등록을 따릅니다. `measure:lab`은 조합별 별도 Node 프로세스에서 실행하며 steps에
warmup이 포함됩니다. quality=0/1/10은 감사 없음/매 tick/10tick마다입니다. 초기 접촉 검사는 warmup=0을 씁니다.
`stepMs`는 시뮬레이션만, `simulationCapacityHz`는 평균 step 시간의 역수입니다. 렌더 FPS가 아닙니다.
감사·recorder·명령 비용은 별도이며 Legacy의 contact 시간에는 정적 적분이 포함됩니다.

동일 밀도 확장은 월드·지형·생성 영역을 `sqrt(N/1000)`배로 키우고 반경·속도·dt·격자 크기는 유지합니다.
`measure:lab`의 scale 기본값은 true이며 동일 월드 비교에는 `--scale=false`를 명시합니다.
요청/실제 생성/활성 수와 도착으로 줄어드는 부하를 구분합니다. capacity-reduced·timeout·error는 성공이 아닙니다.

### 실제 웹 프레임 측정

`npm run dev`로 서버를 별도로 실행한 후 사용합니다. source identity가 이번 체크아웃인지 확인합니다.

```powershell
node scripts/measure-frame.mjs --url=http://127.0.0.1:4273 --agents=6000,10000 --scenarios=rocky-pass --modes=none,blast --ticks=360 --repeats=3 --quality=off --output=test-results/crowd-frame-performance.json.gz
node scripts/measure-frame.mjs --url=http://127.0.0.1:4273 --agents=6000,10000 --scenarios=rocky-pass --modes=none,blast,blast-repeat --ticks=660 --repeats=1 --quality=on --output=test-results/crowd-frame-quality.json.gz
npx vite-node scripts/measure-local-push.ts --output=test-results/crowd-local-push.json
```

실제 RAF·고정 clock·renderer·recorder를 측정하며 tick 30에 캔버스 입력을 보냅니다.
감사 ON의 시간을 성능 OFF와 섞지 않습니다. `window.crowdDebug.getFrameTrace()`는 최근 4,096개
실제 앱 프레임을 제공합니다. simulated/wall 비율, debt, dropped, clamped 시간도 함께 확인합니다.
`getSnapshot()`과 `simulation()`은 상태 진단용이며 해시는 일시정지·명시적 결과 조회에서 계산합니다.

### 지표를 해석하는 범위

- 정체는 저속 지속 시간이며 교착 확정이 아닙니다. 도착률의 분모는 실제 생성 수입니다.
- 런타임 `overlapPairs`, `maxPenetrationDepth`는 제한된 후보 표본입니다. 실행 전체의 최대와 마지막 tick 값을 구분합니다.
- 독립 감사도 샘플 사이의 모든 곡선 이동을 증명하지 않습니다. thin-wall·혼합 반경 crossing의 작은 회귀를 함께 유지합니다.
- `CrowdQualityTracker`는 10step마다 근접 거리·같은 흐름의 속도 RMS·내부 밀도 분산·국소 빈 셀 비율을 수집합니다.
  거리/속도 진단은 유닛당 256후보·4지름 범위입니다. truncatedQueryFraction이 높으면 표본 추정입니다.
- interiorVoidFraction은 가까운 내부 구멍의 proxy이며 임의 크기 공동 검출기가 아닙니다.
  jerk와 jerkExtendedP95는 각각 상한 100,000과 10,000,000이 있으므로 clipping 비율도 봅니다.

알려진 한계의 재현 근거는 [unified 요약](../baselines/unified-20260926/summary.json)과
[과밀 진단](../baselines/unified-20260926/overpacked-quality.json)에 있습니다.
해당 소스의 10k rocky-pass는 무외력에서도 60FPS에 못 미쳤고, 감사 표본 침투는 최대 약 1.66px였습니다.
현재 코드·대상 엔진에 대한 최신 성능 보장으로 옮겨 쓰지 말고 같은 조건에서 다시 측정합니다.

## 실험실 사용

- 실행·초기화 후 캔버스 목표 명령을 기록하고, 같은 명령으로 순차 비교·현재 결과 저장·JSON 내보내기를 합니다.
  과거 저장 결과는 조회용이며 현재 실행 가능한 알고리즘 목록이 아닙니다.
- 기본 시나리오는 평지, 연속 코너, 깔때기 우회, 네 입구 합류, 바위 협곡입니다. 좁은 문·교행·교차·
  목적지 밀집·동적 길막도 등록돼 있습니다. 동적 길막은 tick 180 설치, 540 철거를 재생합니다.
- 회전 속도 UI는 0~720°/초이며 0은 자발적 방향 전환 정지입니다. 표시 방향은 보행 heading을 보간합니다.
- 큰 객체 비율 0~100%, 배율 1~4를 설정하면 초기 배치를 다시 만듭니다. 같은 seed는 같은 배치를 재현합니다.
  공간 부족 시 크기 비율을 유지하며 실제 인원을 줄입니다. 예: `/?agents=1000&largePercent=5&largeScale=2&seed=42`.
- URL은 `preset`, `scenario`, `agents`, `seed`, `radius`, `gap`, `step`, `paused`, `scale` 등을 받습니다.
  바위 협곡은 12px 사각형으로 지형을 근사합니다. 10k 동일 밀도 확장에서는 맵 편집을 지원하지 않습니다.
- 맵 편집은 현재 시나리오 복사본에서 일시정지하여 벽·spawn·공통 목표를 수정합니다.
  기본 1200×720, 사각형 장애물 최대 256개, spawn 1~16개입니다. 적용 시 배치·벽 겹침·반경별 연결성을 검사합니다.
- 드래그·숫자 입력으로 편집하며 12px/1px 스냅, 방향키, Shift+방향키 1px, Delete,
  Ctrl+Z / Ctrl+Shift+Z를 지원합니다. 취소는 미적용 편집만 버립니다.
- 브라우저 저장은 사이트 주소별 localStorage에 최대 30개입니다. 다른 브라우저·포트로는 JSON을 옮깁니다.
  CLI 측정기는 코드 등록 맵을 사용하며 브라우저 저장 맵을 자동으로 읽지 않습니다.

## 보존 자료와 문서 관리

| 위치 | 용도·읽을 때 |
|---|---|
| [porting/fixtures](../porting/fixtures) | 현재 이식 기준. 수치 비교할 때만 개별 사례를 열기 |
| [tests/fixtures](../tests/fixtures) | 회귀 장면. UI 등록 목록과 구분 |
| [docs/research](research), [실험 fixtures](../experiments/fluid-navigation/fixtures) | 독립 실험의 입력·재생 데이터. 일부 JSON을 웹 빌드가 직접 사용 |
| [baselines](../baselines), [docs/measurements](measurements) | 소스별 측정·보존 스냅샷. 개선 원인이나 과거 실패를 조사할 때만 읽기 |
| [import provenance](import-provenance-2026-09-20.json), [연구 source manifest](research/fluid-navigation/source-manifest.json) | 당시 파일·해시의 기록. 현재 파일 인덱스로 해석하지 않기 |

개발 경과·완료 보고·과거 구현 설명은 Git 이력으로 확인합니다. 현재 문서에 누적하지 않습니다.
새 계약은 담당 문서 한 곳만 갱신하고 다른 문서는 링크합니다. 결과 생성은 `test-results/` 등 별도 출력으로 보냅니다.
`scripts/report-external.ts`는 보존 external-v1 데이터의 보고서 재생 도구이며 현재 성능 검사기가 아닙니다.
해당 도구도 기본 출력은 `test-results/external-v1-report.md`입니다.
fixture·baseline·재생 이미지·JSON은 문서 정리 대상이 아니며 값·경로를 변경하지 않습니다.
