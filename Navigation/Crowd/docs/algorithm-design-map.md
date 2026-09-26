# 군중 알고리즘 등록 및 실행 계약

현재 실행 가능한 프리셋은 Legacy · 방향별 유체 군중 하나입니다.
B0/B1/R/Q/D의 A*, ORCA, Boids, 속도 샘플링, 대형·슬롯 배정, 통로 대기열,
밀도 감속 파이프라인 구현은 제거했습니다. Legacy가 사용하는 FlowField,
CrowdField, CrowdFlowSolver, CrowdMovementSolver와 SpatialHash는 유지합니다.

## 계산 코어와 네이티브 이식

`src/core/index.ts`는 `CrowdKernel`, `CrowdConfig`, 초기 상태·명령·출력 타입과 재생 함수를
공개합니다. 이 진입점의 의존 파일에는 브라우저, Node, 시드 배치, 프리셋 레지스트리가 없습니다.
`tsconfig.core.json`은 DOM·Node 타입 없이 ES2022만으로 이 경계를 검사하며 `npm run typecheck`에 포함됩니다.
`src/lab/simulation.ts`의 `CrowdSimulation`은 이 코어를 상속하여 기존 실험실의 배치·프리셋·
통계·시계 측정을 제공합니다. 기존 `src/core/simulation.ts` import는 호환용으로 유지합니다.
계산 코어의 시간 측정 hook은 기본적으로 0/비활성이며 움직임에 영향을 주지 않습니다.

대상 엔진에서는 이 코어를 기본 언어로 재구현합니다. TS 실행 브리지나 원본 프로그램 호출은
대상의 실행 경로에 넣지 않습니다. 엔진 어댑터는 좌표 변환·게임 객체 ID 매핑·고정 tick 호출·
렌더 보간을 담당하고, 유닛의 위치·속도 적분 및 충돌 보정은 군중 코어 하나가 맡습니다.

```ts
import { CrowdKernel, DEFAULT_CROWD_CONFIG, snapshotCrowd } from './src/core';

const kernel = new CrowdKernel({ ...DEFAULT_CROWD_CONFIG }, 1);
kernel.initialize({
  flows: [{ id: 'east', goal: { x: 1100, y: 360 } }],
  obstacles: [], maxAgentRadius: 3.2,
  agents: [{ id: 'unit-42', flow: 0, radius: 3.2, x: 100, y: 360 }],
});
kernel.step(); // exactly one config.fixedDelta, independent of render frame time
const frame = snapshotCrowd(kernel); // owned values; frame.tick === 1
```

기계 판독용 상세 계약은 `porting/contract.json`, 타입과 런타임 검사는
`src/core/kernel-input.ts`, `src/core/port-contract.ts`에 있습니다.

- **초기 상태:** 전체 계산 설정, `flows[{id,goal}]`, `obstacles`, `maxAgentRadius`, 순서가 고정된
  `agents`를 전달합니다. 초기 데이터는 복사하며 위치·속도·방향을 직접 지정할 수 있습니다.
  생략한 속도·정체 시간은 0, active는 1, intent·heading은 초기 경로 방향입니다.
  내보낸 fixture는 모든 운동 상태 값을 명시하므로 대상에서 난수 생성·배치를 재현할 필요가 없습니다.
- **단위와 정밀도:** 원본 픽셀·초·Float64를 기준으로 삼습니다. heading은 radian,
  turnSpeed는 degree/second입니다. 최초 이식은 내부 단위를 보존하고 엔진 경계에서 변환합니다.
  float32, 병렬 계산 또는 다른 충돌 알고리즘으로의 변경은 별도 동등성 검증이 필요합니다.
- **순서와 상태 소유권:** 배열 인덱스가 세션 동안 고정된 solver ID이며 문자열 id는 게임 객체 매핑용입니다.
  이웃 탐색·장애물·접촉 처리 순서를 유지합니다. `state` 버퍼는 step마다 교환하므로 최신 참조를 다시 읽습니다.
  초기화 시 capacity와 월드 크기·격자 크기가 정해집니다. 이를 바꿀 때는 새 코어를 만듭니다.
- **명령:** `{tick,kind:'goal',x,y}`, `{tick,kind:'obstacles',obstacles}`,
  `{tick,kind:'external',input}`을 tick 오름차순, 같은 tick에서는 배열 순서로 실행합니다.
  명령은 `tick → tick+1` 계산 전에 적용합니다. 외력 내부에서는 기존 tick·문자열 ID 정렬을 유지합니다.
  재생 파일의 외력은 명령과 같은 tick, generation 1을 사용합니다. 초기화를 다시 하면 generation이 증가합니다.
- **출력:** `crowd-port-output-v1`의 `id`, `frames[{tick,goals,agents}]`를 출력합니다.
  tick n은 n번 계산한 직후이자 tick n 명령 적용 전입니다. 비활성 유닛을 포함해 초기 순서와 모든 상태 필드를 유지합니다.
  벽시계·프로파일링은 비교에서 제외합니다. 상태 출력은 관측값이며 중간 실행 저장/복원 형식이 아닙니다.
- **현재 기능 범위:** 2D 원과 축 정렬 사각형, 기본·큰 반경 clearance 클래스, 흐름별 초기 목표와
  공통 목표 변경, 외력을 지원합니다. 런타임 생성·삭제·순서 변경·개별 목표 변경은 제공하지 않습니다.
  도착 시 비활성화되어 충돌에서 빠지는 기존 정책과 이동 원형 밀림의 비강체 성격을 유지합니다.
  게임에서 정지 유닛의 공간 점유나 다른 지형 형상이 필요하면 별도의 기능 확장으로 다룹니다.

### 이식 자료 생성과 비교

모든 명령은 `Navigation/Crowd`에서 실행합니다.

```powershell
npm run port:verify
npm run port:export -- --output=test-results/crowd-port
python porting/check.py verify test-results/crowd-port

# 대상 엔진이 출력한 JSON 하나 또는 전체 8개 비교
python porting/check.py compare porting/fixtures/open-goal.json path/to/open-goal.json
python porting/check.py compare-all porting/fixtures path/to/engine-output

# 검사기 연결을 확인하는 개발용 TS 출력 (엔진 이식 성공을 의미하지 않음)
npm run port:verify -- --output=test-results/crowd-reference-output
python porting/check.py compare-all porting/fixtures test-results/crowd-reference-output --atol=0 --rtol=0
python -m unittest discover -s porting -p 'test_*.py'
```

`port:verify`는 자료 해시, 코어 import 경계, 분리 전 기준 출력과 현재 TS의 수치 완전 일치를 확인합니다.
`port:export`는 이 검증 후 새 폴더에 입력·기대 출력 8개, 계약, Python 검사기와 코어 의존 소스를 복사합니다.
`--output` 폴더는 기존 폴더이면 거절합니다. 기존 baseline/fixture를 새 결과로 덮어쓰지 않습니다.
fixture는 평지 목표 변경, 코너, 혼합 크기, 다중 흐름, 지형 변경, 외력, 동적 경로, 도착을 포함하며
분리 전 소스 커밋과 SHA-256을 `porting/fixtures/manifest.json`에 기록했습니다.

Python 3.9 이상 표준 라이브러리만 필요합니다. 기본 수치 허용오차는
`abs(actual-expected) <= 1e-8 + 1e-10*abs(expected)`입니다. ID·tick·flow·active·키·배열 길이와 순서는
정확히 같아야 하며 누락·추가 필드와 비유한 수치는 실패합니다. `--atol`, `--rtol`은 명시적으로만 바꾸고
원래 허용오차의 실패를 숨기지 않습니다. 실패 경로는 `$.frames[...].agents[...].x`처럼 표시되고
불일치 종료 코드는 1, 입력·무결성 오류는 2입니다. 검사기는 네이티브 실행 자체를 수행하지 않습니다.

계산 코어 변경 시 `npm run verify`, `npm run port:verify`와 관련 브라우저 경계 테스트를 실행합니다.
이식 도구만 바꿀 때는 타입 검사, 관련 계약 테스트, Python 테스트, 실제 export/verify/compare를 확인합니다.

## 새 알고리즘 추가

1. 별도 모듈에서 src/algorithms/lab/pipeline.ts의 LabPipeline을 구현합니다.
   공유 LabWorld의 상태·반경·목표·지형을 사용하며 step은 current를 읽고 next를 작성합니다.
   preferredX/Y, 경로 방향 sample, targets, available, navigators, stats를 제공해야 합니다.
   targets는 유닛별 목적지이며 available은 유효 목적지 여부입니다.
   Legacy 이외의 구현은 자체 경로 생성과 도착 판정을 담당합니다.
2. registry.ts의 PRESETS에 고유 id, 표시 이름, 설명, 한계, options와 createPipeline을 등록합니다.
   options.destination은 exit 또는 slots이며 결과 감사와 렌더링의 도착자 취급에 사용됩니다.
   Legacy만 팩토리 없이 CrowdKernel의 내장 solver를 사용합니다.
3. 설정 변경을 지원하면 validateOptions를 제공합니다. 개별 목표를 지원하는 구현은
   supportsIndividualGoals를 지정하고 팩토리에 전달된 overrides를 처리합니다.
   설정 UI는 알고리즘에 맞게 추가합니다. 삭제된 구현의 모듈 선택지는 노출하지 않습니다.
4. 초기화, 목표 명령, 지형 변경 시 팩토리를 호출합니다. 이전 상태가 필요하면 previous를 사용합니다.
   누적 경로·field·통과 카운터는 CrowdSimulation이 보존하므로 중복 누적하지 않습니다.
   매 step의 이동·대기·도착·접촉 수와 pass 시간을 구현에서 기록합니다.
5. 동일 맵·seed·명령으로 Legacy와 비교하고 새 구현에 필요한 검증을 추가합니다.

선택 목록과 비교 버튼 개수는 PRESETS로 생성됩니다. main.ts의 순차 비교와
scripts/measure-lab.ts의 기본 실행 목록도 이 레지스트리를 사용합니다.
LabRecorder의 공통 결과 스키마, JSON 내보내기, 독립 기하 감사와 시나리오 명령 재생을 유지합니다.
새 프리셋을 추가할 때 UI나 CLI에 별도 프리셋 목록을 복제할 필요가 없습니다.

## 현재 검증과 과거 기록

기존 tests/simulation/legacy-baseline.test.ts는 평지·코너·혼합 크기에서
초기화, 이동, 목표 변경, 재초기화의 회전 제한 적용 후 해시를 검증합니다.
브라우저 algorithm-lab.spec.ts는 레지스트리 기반 선택, 실행, 비교, 저장·내보내기를 검증합니다.

baselines/의 JSON 및 소스 스냅샷은
제거 전 알고리즘의 역사적 측정 자료입니다. 현재 구현 목록이나 실행 가이드로 사용하지 않습니다.

## 측정 해석

`npm run measure:lab`은 프리셋/장면/개체 수 조합마다 독립 Node 프로세스로 실행하고 JSON을 저장합니다. `--steps`에는 예열이 포함되며 시간 통계는 `--warmup` 이후입니다. `--quality=0|1|10`은 감사 끔/매 tick/10 tick마다를 뜻합니다. 초기 접촉까지 검사하려면 `--warmup=0`을 사용합니다.

`--scale=true`는 월드 좌표를 `sqrt(N/1000)`배로 확장하고 반경·속도·dt·격자 크기를 유지합니다. 실제 생성 수와 요청 수를 구분하며, 긴 경로의 도착 시간을 같은 조건으로 간주하지 않습니다. timeout/error/capacity-reduced는 성공 실행이 아니며 종료 코드도 실패입니다.

`stepMs`는 시뮬레이션만의 시간이고 `simulationCapacityHz`는 평균 step 시간의 역수로 렌더 FPS가 아닙니다. 독립 품질 감사와 recorder 등의 비용은 별도이며 서로 포함된 pass 시간을 합산하지 않습니다. 도착률은 실제 생성 수를 분모로 사용합니다. 침투 감사는 별도 공간 검색을 사용하지만 tick 끝점 검사로 substep 전체의 관통을 증명할 수는 없습니다. 저속 지속은 교착 확정이 아닙니다.

과거 `baselines/lab-*.json`은 삭제된 프리셋을 포함한 코너 수정 전 측정입니다. `corners-before/after/verified/final/acceptance/fixed-*.json`은 수정 단계별 기록이고, 실패·중간 결과를 최종 결과와 구분합니다. `scripts/diagnose-corners.ts --source=baselines/corner-fixed-source`로 보존 소스를 선택할 수 있으며, 현재 Legacy의 성능·품질 근거로 재사용하지 않습니다.
