# A–D 리팩터링 결과 보존 증거

기준은 커밋 `0254855612632472645d360bfc77ec18eeb931d4`의 실제 생성기와 production Viewer다. 기준 checkout에는 별도 opt-in 시간 계측만 추가했으며, 스타일·부피·타일·카메라·Seed·재료는 변경하지 않았다. `benchmarks/concept-preservation-baseline.json`은 이 checkout에서 캡처한 SHA256 기준값이다. 변경 후 결과로 기준값을 다시 만들지 않는다.

## 의미 있는 생성 결과

`tests/concept-preservation-fixtures.ts`의 214개 입력을 `tests/concept-preservation.test.ts`에서 **캐시 없는 전체 생성**으로 비교한다.

- A~D 각각 높이 1~32 전부, 폭 1~8과 음수 X/Z 시작점.
- 대표 장면, 2층 저층, 24층 고층, 3단 후퇴형 매스, 덮인 상면, 벽 중간의 구멍.
- 혼합 타일 설정(저층 D·코너 B·중앙 C·상층 A), 솔리드 타일, anchor를 유지한 최소 좌표 확장.
- 도로와 옥상 시설을 포함한 도시 컨셉 4개, C의 낮은 옥탑과 큰 개구부 예제.
- Seed 0·17·43의 후퇴형 부피를 각 스타일에 추가하여 팔레트·수직 프로그램·가로 반복의 다른 선택을 확인한다.

비교 대상은 실제 배치 ID·면 ID·방향·위치·타일·완성형 에셋·마감 ID, 외피와 면 소유, 층 배분·행 역할·anchor 정렬, 출입구와 접근 경로, 공간 예약, 단계 상태와 진단이다. 사용한 타일 메타데이터와 재료 색상도 별도 해시로 비교한다. 후보 trace·캐시 기록·논리 카운터·중간 계획 표현은 동등성 조건으로 고정하지 않는다.

생성 결과가 사용한 **완성형 면 에셋 419종**의 모든 정점 속성(position/normal/UV 등), index, 재질 group을 해시로 비교한다. 따라서 단순히 타일 이름만 보존한 결과가 아니다.

| 대표 입력 | 부피 셀 | 외부 면/실제 Mesh | 출입구 | 예약 |
| --- | ---: | ---: | ---: | ---: |
| A 트윈 타워 | 4,670 | 2,492 | 1 | 338 |
| B 커튼월 | 1,080 | 636 | 1 | 2 |
| C 고층+옥탑 | 645 | 488 | 1 | 2 |
| D 두 번의 후퇴 | 2,204 | 1,200 | 1 | 2 |

별도 4개 스타일 편집 검사는 12×16×10 부피에서 넓은 상부 한 층 추가, 일부 제거, 연결 성분 분리, 역순 Undo와 Redo, JSON 저장·복원을 수행한다. 각 상태에서 캐시 결과와 캐시를 끈 전체 생성 결과가 같고, 예약·타일·마감·출입구까지 유지되는지 검사한다. 캐시 byte 상한도 확인한다. 순수 입력만큼 동일한 모든 내부 객체 참조를 요구하지 않는다.

변경 후 central `npm run verify`에서 이 214개 입력의 결과 해시, 419종 geometry 해시, 4개 스타일의 편집·history·저장/복원 검사가 모두 통과했다.

## 실제 렌더

`e2e/concept-preservation.spec.ts`는 production build를 별도 포트에서 실행하고 Seed 42, Chromium, 1440×960 viewport, 동일 순서의 입력과 카메라 preset을 사용한다. 각 스타일의 대표·저층·고층·후퇴형·혼합 타일 20개 입력을 등각 시점으로 캡처하고, 대표 4개는 입면 시점도 추가해 **24개 실제 canvas 이미지**를 비교한다.

캡처마다 Viewer 안의 실제 Mesh를 조회하여 `count = uniqueFaces = 생성 면 수`, instanced face 0, 자식 Mesh 0, 추가 배치 객체 0, 마감 면 수와 유리 면 수를 확인한다. geometry 공유와 면당 Mesh 하나 계약을 바꾸어 성능을 얻는 것을 방지한다.

같은 e2e 파일의 일반 회귀 검사 2개는 A의 7→8층, C의 3→4층을 실제 지붕 선택과 E/Q 입력으로 편집한다. 추가·제거·Undo·Redo·JSON 다운로드 후 복원의 5개 상태마다 캐시 없는 전체 생성으로 Mesh 수를 검증하고, 독립 browser context의 새 Viewer에서 동일 문서를 불러온 이미지와 비교한다. UI overlay만 숨기며 실제 geometry·재료·마감·그림자는 그대로 비교한다. 이 검사는 기존 face Mesh를 재사용하면서 층 배분·옥상 타일·원점 변환 갱신을 빠뜨리는 실패를 겨냥한다.

두 회귀 검사가 모두 통과했다. 10개 편집 상태와 각각의 새 Viewer 이미지는 PNG byte까지 동일하며, 추가와 Undo, 제거와 Redo·복원의 이미지 해시도 각각 동일하다. 결과는 `benchmarks/concept-edit-render-A.json`, `concept-edit-render-C.json`, 원본 비교 PNG 20개는 로컬 `artifacts/concept-preservation/edits-{A,C}/`에 있다.

기준/변경 manifest는 `benchmarks/concept-render-baseline.json`, `concept-render-after.json`, 대표 이미지는 `benchmarks/screenshots/building-refactor/{baseline,after}/`에 있다. 전체 원본 PNG는 로컬 `artifacts/concept-preservation/{baseline,after}/`에 보관한다. 두 manifest는 원래 PNG SHA256과 production JS/CSS SHA256을 보존한다. 브라우저 버전·GPU·폰트가 달라진 환경의 픽셀 일치까지 보장하는 일반 golden test로 사용하지 않는다.

2026-09-23 비교 결과 **23개 PNG는 byte까지 동일**하다. A 대표 등각 시점 하나는 카메라 버튼 바의 둥근 하단 테두리에서 12픽셀, 채널당 최대 1/255 차이가 발생했다. 첫 엄격 PNG 검사가 이 차이로 실패한 뒤 디코딩한 RGBA를 조사했다. 차이 bbox는 x=270~602, y=786~788이고, 같은 872×850 canvas에서 측정한 실제 `.camera-bar` DOM 영역은 x=[268,604), y=[745,789)다. 계산된 `box-shadow`는 `none`이며 추가 제외 여백은 **0**이다.

해당 DOM 영역만 제외한 **24개 이미지의 모든 픽셀이 오차 0으로 일치**했다. 모델 픽셀 허용 오차를 늘리지 않았다. `benchmarks/concept-render-comparison.json`은 각 이미지의 차이 수, 최대 채널 차이, bbox, 실제 제외 영역을 기록한다. 원본 이미지를 다시 찍거나 기준을 변경하여 차이를 지우지 않았고, `CONCEPT_PRESERVATION_REVIEW_ONLY=1`로 원래 24쌍을 재검사했다.

## 재현

일반 검사는 저장된 기준을 읽기만 한다.

```powershell
npx vitest run tests/concept-preservation.test.ts
```

기준을 새로 캡처할 때는 반드시 위 기준 커밋의 독립 checkout에서 아래 명령을 사용하고 `benchmarks/concept-preservation-baseline.json`을 가져온다. 현재 구현에서 이 명령을 실행하면 이전 결과 보존을 입증할 수 없다.

```powershell
$env:CAPTURE_CONCEPT_BASELINE='1'
npx vitest run tests/concept-preservation.test.ts -t 'pre-refactor'
```

브라우저 비교는 기준과 변경 후 두 build가 필요하다. 같은 `CONCEPT_PRESERVATION_OUTPUT` 디렉터리를 지정하고 각각 `CONCEPT_PRESERVATION_PHASE=baseline`, `after`로 opt-in 테스트를 실행한다. 별도 Playwright config로 preview 포트 5181을 사용하며 최종 성능 표본 수집과 분리한다. 일반 e2e 실행에서는 opt-in 비교만 건너뛰며 실제 편집/새 Viewer 비교는 실행한다. 스크린샷 수집은 성능 표본에 포함하지 않는다.

다른 서버와 충돌하지 않으면 기본 Playwright config의 5178 포트로도 순차 재현할 수 있다. 같은 절대 출력 폴더를 유지하고, 기준 checkout의 `baseline` 실행 후 변경 checkout에서 `after`로 바꾸어 실행한다.

```powershell
$env:CONCEPT_PRESERVATION_OUTPUT='E:/tmp/concept-preservation'
$env:CONCEPT_PRESERVATION_PHASE='baseline' # 변경 checkout에서는 'after'
npm run build
npx playwright test e2e/concept-preservation.spec.ts --grep '@preservation'
```

## 실행한 검사

- `npm run verify`: DOM 없는 core를 포함한 타입 검사, 50개 파일의 단위 검사 309개, production 빌드 통과.
- 일반 브라우저 검사: 47개 통과, 별도로 실행한 렌더 비교 1개는 opt-in이라 기본 실행에서 제외. 시설 진단 기대값 1개는 실패 원인을 분리한 뒤 수정한 검사만 재실행하여 통과했다. 결과적으로 일반 검사 48개를 모두 확인했다.
- 실패했던 시설 검사는 기준 커밋에서도 동일하게 재현됐다. 기존 동작은 도로 제거 후 16개 셀의 설비를 `service-unverified`로 유지하며 `MAINTENANCE_ROUTE_UNVERIFIED`와 `NO_ROAD`를 표시한다. 오래된 `NO_PUBLIC_ACCESS` 기대값을 이 계약에 맞추고 배치 수·위치·접근 상태 검사도 추가했다. 시설 생성 코드는 바꾸지 않았다.
- 변경한 브라우저 검사 파일의 TypeScript 검사와 해당 시설 검사 재실행 통과. 이미 통과한 전체 단위·브라우저 검사는 다시 실행하지 않았다.

## 범위와 한계

32층까지 모든 높이의 배분 경계와 좁은 폭을 검사했지만, 허용되는 모든 32³ 격자 조합의 전수 검사는 아니다. 실제 렌더는 위 20개 입력·24시점으로 한정된다. 큰 부피의 실제 마우스 드래그 지연, 최초 편집과 반복 편집의 시간 분포는 별도 성능 보고서에서 다룬다. 이 문서의 SHA256 비교로 속도 향상을 주장하지 않는다.
