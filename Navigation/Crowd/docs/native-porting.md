# 이식 계약과 검증

현재 CPU 알고리즘을 대상 엔진의 기본 언어로 옮기기 위한 문서입니다.
전체 계산 순서는 필요할 때 [architecture.md](architecture.md)를 확인하세요.
기계 판독 계약은 [porting/contract.json](../porting/contract.json), API는
[core/index.ts](../src/core/index.ts), 입력 검사는 [kernel-input.ts](../src/core/kernel-input.ts)와
[port-contract.ts](../src/core/port-contract.ts)가 기준입니다.

## 대상 프로그램의 경계

1. 원본과 같은 순서·정밀도로 계산 코어를 구현하고 고정 fixture를 통과시킵니다.
2. 엔진 어댑터에 객체 ID 매핑, 좌표·단위 변환, 고정 tick 호출, 상태 보간을 연결합니다.
3. float32·병렬화·게임별 기능 변경은 동등한 기준 구현을 확보한 다음 각각 검증합니다.

TS/Node는 개발용 참조 도구입니다. JS 실행 브리지, 브라우저/WebView, 원본 프로세스·서버 호출을
대상 게임의 실행 경로에 넣지 않습니다. 군중 코어와 엔진 물리가 같은 위치·속도를 이중 적분하지 않도록 합니다.

## 초기 상태와 소유권

```ts
import { CrowdKernel, DEFAULT_CROWD_CONFIG, snapshotCrowd } from './src/core';

const kernel = new CrowdKernel({ ...DEFAULT_CROWD_CONFIG }, 1);
kernel.initialize({
  flows: [{ id: 'east', goal: { x: 1100, y: 360 } }],
  obstacles: [], maxAgentRadius: 3.2,
  agents: [{ id: 'unit-42', flow: 0, radius: 3.2, x: 100, y: 360 }],
});
kernel.step();
const frame = snapshotCrowd(kernel); // tick 1의 복사된 관측값
```

- 설정은 `CrowdConfig` 전체, 초기 상태는 flows·obstacles·maxAgentRadius·agents입니다.
  배열 순서가 고정 solver 인덱스이며 문자열 id는 호스트의 객체 매핑용입니다.
- 유닛 필드는 `id, flow, radius, x, y, vx, vy, active, stalledFor, intentX, intentY, heading`입니다.
  직접 초기화에서는 속도·정체 시간 기본값 0, active 1, intent·heading은 경로 방향입니다.
  fixture는 모든 운동 값을 명시하므로 대상이 시드 배치까지 재현할 필요가 없습니다.
- 초기 데이터는 복사합니다. `state`는 step마다 교환되는 버퍼이므로 이전 참조를 최신 상태로 사용하지 않습니다.
  `snapshotCrowd()`의 출력은 독립 복사본입니다.
- capacity·월드 크기·격자 크기를 바꾸려면 새 코어를 만듭니다. `initialize()`는 tick 0으로 시작하고
  외력 기록을 지우며 generation을 증가시킵니다. 중간 저장/복원 API가 아닙니다.
- `active=0`은 충돌·이동 제외 상태입니다. 공통 목표를 바꾸면 도착한 유닛도 재활성화됩니다.
  생성·삭제와 개별 목표 변경은 현재 계약에 없습니다.

## 단위와 수치 순서

좌표는 x 오른쪽·y 아래인 2D 기준 픽셀, 시간은 초, heading은 radian,
turnSpeed는 degree/second입니다. 처음에는 코어 내부 단위를 유지하고 엔진 경계에서 변환합니다.

Float64 계산, 32비트 정수 래핑·`Math.imul`, 초기 배열 순서, 셀 안의 내림차순 인덱스,
가까운 셀 우선 탐색, 장애물 순서, 순차 swept-pair 갱신을 보존합니다.
작은 epsilon을 엔진의 일반 float 허용오차로 일괄 교체하지 않습니다.
`stateHash()`는 양자화한 회귀 진단값이므로 네이티브 수치 비교를 대신하지 않습니다.

## tick 명령과 출력

명령은 `tick` 오름차순, 같은 tick에서는 배열 순서로 **tick → tick+1 계산 전**에 적용합니다.

| kind | 입력 | 동작 |
|---|---|---|
| `goal` | `{tick,kind,x,y}` | 공통 목표 변경, 기존 속도·heading 유지 |
| `obstacles` | `{tick,kind,obstacles}` | 전체 장애물 교체·경로 갱신. 활성 유닛 clearance와 겹치면 거절 |
| `external` | `{tick,kind,input}` | 아래 외력 입력 전달. 재생 파일은 같은 tick과 generation 1 사용 |

재생 입력 스키마는 `crowd-port-fixture-v1`이며 `id, config, initial, commands, checkpoints`를 가집니다.
개별 명령의 오류는 재생을 중단합니다. 여러 명령을 묶은 tick 전체의 rollback은 제공하지 않습니다.

대상 출력은 `crowd-port-output-v1`의 `{schema,id,frames:[{tick,goals,agents}]}`입니다.
tick n은 n번 계산한 직후이자 tick n 명령 적용 전입니다. tick 0과 모든 checkpoint에서
비활성 유닛까지 초기 순서대로 모든 필드를 출력합니다. 벽시계·실험실 통계·해시는 포함하지 않습니다.
관측 frame만으로 외력의 대기 입력·wave hit mask와 내부 필드 상태를 복원할 수는 없습니다.

## 외력 입력

공통 필드는 고유 문자열 `id`, 적용 `tick`, 현재 `generation`입니다.
target은 `{agent:<배열 인덱스>}` 또는 `{x,y,radius,flow?}`입니다.

| kind | 추가 필드·수명 |
|---|---|
| `impulse` | `target,dvx,dvy`: 한 번 Δv 적용 |
| `acceleration` | `target,ax,ay,endTick`: `[tick,endTick)` 동안 적용 |
| `blast` | `x,y,radius,speed,expansionSpeed?`: 거리별 선형 감쇠. 확장 시 각 유닛에 한 번 |
| `proxy` | `body,x,y,toX,toY,radius`: 원형 밀림의 한 tick 경로. 이후 마지막 끝점 유지 |
| `remove-proxy` | `body`: 원형 도구 제거 |
| `cancel` | `input`: 알려진 외력 ID 취소. proxy는 remove-proxy 사용 |

동일 ID·동일 내용 재전송은 `false`, 충돌하는 내용·잘못된 값은 예외입니다. 입력은 복사하며
외력 내부 처리 순서는 tick, 문자열 ID의 ordinal 비교 순입니다. 취소된 ID도 초기화 전에는 재사용하지 않습니다.
한 body에는 tick당 경로 하나만 허용하며, 순간이동·반경 변경은 제거 후 다시 생성합니다.

지원 상한은 [EXTERNAL_PROFILE와 검증 코드](../src/core/external-influences.ts)에 있습니다:
dt ≤1/30초, Δv 및 직접 구동 속도 600px/s, 가속도 1200px/s², proxy 속도 300px/s,
proxy 반경 1.5~64px, proxy 8개, 대기·진행 입력 합계 32개, generation당 기록 4,096개입니다.
현재보다 36,000tick을 초과해 앞선 입력과 36,000tick보다 긴 지속 입력은 거절합니다.
원의 강체 접촉·벽 차폐·양방향 차량 반응은 외력 API가 제공하지 않습니다.

## 자료 내보내기와 비교

모든 명령은 `Navigation/Crowd`에서 실행합니다. `--output`은 존재하지 않는 폴더를 지정합니다.

```powershell
npm run port:verify
npm run port:export -- --output=test-results/crowd-port
python porting/check.py verify test-results/crowd-port
python porting/check.py compare porting/fixtures/open-goal.json path/to/open-goal.json
python porting/check.py compare-all porting/fixtures path/to/engine-output
```

`port:verify`는 fixture 해시·코어 import 경계와 TS의 기대 출력 완전 일치를 검사합니다.
`port:export`는 그 검사 후 고정 입력·기대 출력, 계약, Python 검사기, 코어 의존 소스를 복사합니다.
기준 8개 사례는 평지 목표 변경·코너·혼합 크기·다중 흐름·지형 변경·외력·동적 경로·도착입니다.
분리 전 기준 소스와 무결성 해시는 [fixture manifest](../porting/fixtures/manifest.json)에 있습니다.
현재 결과에 맞춰 기존 fixture·baseline을 덮어쓰지 않습니다.

Python 3.9+ 표준 라이브러리만 필요합니다. 연속 수치의 기본 허용오차는
`abs(actual-expected) <= 1e-8 + 1e-10*abs(expected)`입니다. ID·tick·flow·active·키·배열 길이와 순서는
정확히 비교하며 누락·추가 필드와 비유한 수치는 실패합니다. 불일치 경로를 출력하고 종료 코드
1은 수치·형태 불일치, 2는 입력·무결성 오류입니다. `--atol=0 --rtol=0`은 수치 완전 일치 검사입니다.

개발용 TS 출력으로 비교기 연결만 확인하려면:

```powershell
npm run port:verify -- --output=test-results/crowd-reference-output
python porting/check.py compare-all porting/fixtures test-results/crowd-reference-output --atol=0 --rtol=0
```

이 검사는 실제 엔진 실행·성능을 증명하지 않습니다. 대상 언어가 자체 생성한 출력으로 통과한 뒤
엔진의 좌표 변환·고정 tick·렌더링을 별도로 검증합니다. float32·GPU·임의 collider·live spawn/despawn 지원도 별도 범위입니다.
