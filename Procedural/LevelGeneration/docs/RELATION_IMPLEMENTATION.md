# 공통 관계 구현 기록

> 후속 정정: 사용자 지적 뒤 [도로 규칙 진단](ROAD_RULE_DIAGNOSIS.md)에서 비정형 길이의 직선 도로가 코너/교차로로 오분류되고 시설 keepout까지 영향을 받는 반례를 확인했다. 아래 테스트 통과 기록은 실제 수행 결과이지만 도로 규칙의 정확성까지 충분히 입증하지 못했다. 이후 ㄱ/T자 참고 이미지에 따른 [도로 규칙 개선](ROAD_RULES.md)으로 해당 오류를 수정했다. 최신 검증과 도시 4개 도로 출력의 의도한 변경은 후속 기록을 따른다.

기준: `65701664aa9c4c4bb80320d58550e610511ea2b0`. 시작 작업 트리는 깨끗했고 분석 기준과 코드 차이가 없었다. 이전 분석의 진입 문서와 폴더 전체 108개 파일(JPEG 97장)을 원본 수정 없이 복사하고 SHA256 일치를 확인했다. [분석 진입](VIDEO_RULE_STUDY.md), [인수 시나리오](video-rule-study/ACCEPTANCE.md).

## 구현 전 고정한 정책

- 보존: schema6/SceneInputs2/catalog13, A–D 외피·수직 배분·anchor, 원본 점유와 빈 공간, 예약 우선순위·원자성, 보행/차량 proof, 완성형 면, 공개 호출 경로. 기존 baseline은 읽기만 한다.
- 관계: 실행마다 원본 점유/실제 외피/SurfaceRegion/VerticalPlan/MassRelations를 읽는 인덱스를 만들고 지지 검사, 시설 문맥, 식생 예약과 출력, Inspector가 공유한다. SpatialAnalysis의 경계/도로 도착점과 기존 road module/port를 연결한다. 접근 성공은 후속 계획의 기존 증명만 사용한다.
- 의도한 새 행동: 호환되는 오브젝트 fragment에 걸친 연속 수직 열은 하나의 높이·설치 지지를 갖는다. 동일 열의 지지/높이가 유지되면 fragment ID·사각형 경계가 바뀌어도 종류·위치·방향을 유지한다. 일반 시설·식생은 지지를 잃은 열만 제외한다. 다른 열의 유효 모델은 보존한다. 식생의 지상/옥상/중앙분리대 문맥도 열별로 판정한다.
- 외벽 자동 종류는 같은 방향·자동/명시 종류·벽 요청을 가진 연속 열에서 결정한다. 실제 경계에 맞춰 닫히는 직육면체 조립과 각 원본 fragment의 원자적 승인/거절을 유지한다. 명시 종류는 자동 판단보다 우선한다.
- 반례에서 지지 한 칸을 제거하자 살아남은 옥상 조명이 보행 여유 점수 때문에 같은 칸 안에서 이동했다. 조명 방향은 기존 같은 높이의 도로 방향(없으면 0), 위치는 고정 후보 순서(-6/16, 중앙)로 선택하도록 바꾼다. 후보가 본체/보호 예약에 맞지 않을 때만 다음 위치를 사용하며, 접근 판정은 위치 선택 뒤에 계속 수행한다. 과거 접근 점수가 고른 조명 위치·방향은 의도적으로 달라질 수 있다.
- 새 관계·지지 사유는 설명 출력이며 문서에 저장하지 않는다. 미검증 서비스 접근은 성공으로 승격하지 않는다. 전체 재평가를 유지한다.
- 범위 밖: 새 에셋/신호등 정책, 상세 파라미터 UI, 하중/지형/물/날씨, 실제 수직 이동, 상층 주차 경사로, 증분 스케줄러. H05/H08/H09를 원본의 확정 알고리즘으로 해석하지 않는다.

## 연결된 구현

- [scene-relations.ts](../src/core/scene-relations.ts): 실행 중 `SupportIndex`가 실제 면과 설치 열을 인덱싱하고 `SceneRelationIndex`가 기존 spatial 경계·도로 모듈/port·도착점을 연결한다. 관계와 설명 스냅샷은 동결한다. 영구 캐시·문서 필드를 추가하지 않았다.
- [spatial-analysis.ts](../src/core/spatial-analysis.ts): 지원되지 않는 열의 공통 사유/관계 ID를 진단에 남긴다. 유효 식생의 모든 원본 셀은 계속 solid1000으로 예약한다. 외접 박스로 빈 공간을 채우지 않는다.
- [fixture-plan.ts](../src/core/fixture-plan.ts), [wall-facilities.ts](../src/core/wall-facilities.ts), [scene-inputs.ts](../src/core/scene-inputs.ts): 같은 설치 지지와 연속 열을 시설 선택·검증·식생 출력에서 사용한다. 외벽은 원본 fragment별 예약 batch와 명시 종류를 유지한다. 잘린 부분의 조립 마감/연결부는 새 경계에 따라 달라질 수 있다.
- [entrance-plan.ts](../src/core/entrance-plan.ts): 기존 경로 검색 결과의 실제 도로 도착 셀을 모듈/port/frontage에 연결해 근거를 표시한다. 도로 거리로 접근 성공을 추정하지 않는다. 조명 교차부 keepout과 도로 출력도 같은 모듈 분석 결과를 사용한다.
- [plan-inspector.ts](../src/plan-inspector.ts): 선택 원본의 지지 면/소유자, region/scope/zone, 정확한 상부 덮임, 경계, 도로 관계를 표시한다. 설치 지지와 하중/이동 증명을 구분한다. 시설 trace는 해당 열과 실제로 읽은 식생·도로·주차 원본을 참조한다.
- [main.ts](../src/main.ts): 실제 브라우저 인수 검사에서 발견한 오류 상태 복구를 수정했다. 잘못된 JSON 뒤에 마지막 수락 문서와 동일한 정상 문서를 불러오면 오류 표시를 해제한다. 생성·Viewer 동기화·이력 횟수는 증가하지 않는다.

인덱스 구축은 점유/외피/기존 scope·zone·경계를 한 번씩 방문하고 열을 정렬한다. 도로 문맥은 조회 셀마다 도로 셀을 선형 탐색하고 실행 내에서만 재사용한다. 전역 면 쌍 탐색이나 실행 이력을 쌓는 캐시를 추가하지 않았다. sourceRefs와 readDependencies는 설명이며 증분 무효화 scheduler가 아니다. 덮임은 정확한 X/Z 열의 실제 점유를 조회한다. region 전체의 `covered-terrace` 해석과 개별 셀의 `coveredBy`가 다를 수 있으며 이를 구분해 표시한다.

## 실제 검증 결과 (2026-09-25)

| 검사 | 결과와 범위 |
|---|---|
| `npm run verify` | 최종 제품 코드에서 타입 검사 + 51개 테스트 파일/334개 테스트 + Vite 빌드 통과. 기존 번들 크기 500kB 경고는 남음 |
| 기존 보존 | 기존 `concept-preservation-baseline.json`의 214입력/419종 완성형 면 geometry와 의미·재료 비교 통과. baseline 변경 없음 |
| 새 관계 회귀 | [scene-relations.test.ts](../tests/scene-relations.test.ts) 25개: L/U/구멍/notch/bridge/기둥 밑 빈 공간, 덮인 테라스, 부분 지지 상실/복원, 수직 fragment, 자동/명시 외벽 종류, ±X/±Z와 큰/음수 좌표, 중앙분리대, 폭1/2/4 교차로와 단절, 밀폐 공기, 순열·cache·동결·JSON·이력 |
| 기존 공간·에셋 계약 | 전체 테스트에 anchor 분리/병합, 사용자 rule/style/adapter, preflight/bounds, 예약 원자성, 비다양체 fallback, 주차 예산·왕복 proof, 접근·portal, geometry/면 소유·에셋 공유 검사가 포함됨 |
| 실제 Chromium | `e2e/scene-relations.spec.ts`, `object-area.spec.ts`, `editing-regressions.spec.ts`, `environment.spec.ts`의 관련 16개 시나리오 통과(초기 15개 통과, JSON 오류 복구 수정 후 실패 경로 재검증). 전체 브라우저 회귀를 반복하지 않음 |
| 브라우저 편집/표시 | 실제 클릭·드래그·E/Q, 오브젝트 한 칸 삭제, 3종 영역/높이, 외벽 자동 종류, 원점 유지, Inspector, no-op, 실패 후 마지막 수락 상태, Undo/Redo·저장복원, 도로 단절, 주차 표시, 면당 Mesh 검사 통과 |
| 변경 범위 | `git diff --check` 통과. 테스트가 자동 재작성한 `benchmarks/parking-quality.json`은 요청 범위 밖 생성 보고서여서 시작 상태로 복구함. 이식 자료/도구는 변경하지 않아 export/Python 검사는 적용하지 않음 |

브라우저 검사 중 발견한 기존 JSON no-op 오류 표시는 실제 제품 수정으로 해결했다. 이후 테스트의 실행 횟수 조회를 기존 measurement API로 교정하고 최종 실패 경로를 통과했다. 이전 분석 폴더의 자료는 분석 당시 그대로 보존했다. 이 기록의 신규 검증과 이전 문서의 관찰 O01–O15/미실행 T 시나리오 서술을 혼동하지 않는다.

## 시각 근거와 편집 비용

- [덮인 테라스·시설과 관계 Inspector](relation-evidence/covered-terrace-relations.png)
- [지지 상실 뒤 입력 유지·식생 제외](relation-evidence/retained-unsupported-plant.png)
- [옥상 지지 Inspector](relation-evidence/roof-support-inspector.png), [한 칸 삭제 후 남은 조명 3개](relation-evidence/roof-light-corner-deleted.png)
- [span32 L형 복원·실제 면 소유](relation-evidence/span32-restored.png), [원시 측정값](relation-evidence/span32-edit-cost.json)

위 캡처를 직접 확인했다. 덮개 아래 빈 공간, 남은 시설 위치, 지지 제거 위치의 구멍, 복원된 L형 외피가 보인다. 면당 실제 Mesh 수는 화면만으로 추정하지 않고 Viewer 객체 계수와 생성 결과를 비교했다.

Chromium 153.0.8010.12, 1440×960, C 컨셉, 32×6×8 범위 L형 960셀에서 실제 한 칸 추가/제거 각 1회 측정:

| 작업 | 전체 규칙 생성 | 공간 단계(관계 포함) | Viewer 동기화 | 입력→CPU 렌더 제출 |
|---|---:|---:|---:|---:|
| 추가 960→961 | 58.4ms | 3.8ms | 6.3ms | 172.5ms |
| 제거 961→960 | 27.1ms | 4.5ms | 5.0ms | 146.6ms |

전체 지연에는 입력 큐와 문서/이력 수락 비용이 포함된다. GPU 완료·물리 화면 표시 시간은 측정하지 않았다. 관계 인덱스만의 독립 비용이나 최대 32³ 밀집 부피, p95/성능 향상을 입증하는 비교 측정이 아니다. 전체 규칙 재평가는 계속 수행한다.

## 남은 한계

15개 영상의 숨은 알고리즘·수식은 복원했다고 주장하지 않는다. 특히 H05 신호등 자동성, H08 종류 선택 수식, H09 외벽 시설 의미는 미확정이며 이번 정책은 이 프로젝트의 설계다. 실제 수직 이동/하중/상층 차량 연결과 모든 입력 조합 전수 검증은 범위 밖이다. 관계 API는 현재 외피·접근 정책을 설명하며 밀폐 공기를 외부 지지로 승격하지 않는다. 외벽 조립은 같은 원본 fragment 안에서 한 호스트라도 부적합하면 전체를 거절하는 기존 원자적 계약을 유지한다.
