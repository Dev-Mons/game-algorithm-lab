# 기존 구현과의 차이, 보존 계약, 개선 순서

[진입](../VIDEO_RULE_STUDY.md) · [제안 규칙](RULE_SPEC.md) · [인수 시나리오](ACCEPTANCE.md)

기준 커밋: `65701664aa9c4c4bb80320d58550e610511ea2b0`. 아래는 실제 코드를 읽어 확인한 내용이다. 테스트 파일의 존재와 의도는 확인했지만 이번 문서 작업에서 제품 테스트를 실행한 것은 아니다. 차이는 확인된 결함, 지원 한계, 확장 기회를 구분한다.

## 1. 코드 대응표

| ID | 이미 있는 기능과 파일 근거 | 일반화/확장 또는 새로 필요한 부분 | 판단 |
|---|---|---|---|
| C01 | [document.ts](../../src/core/document.ts)의 `createDocument` L92, schema6 L105, `loadDocument` L128; [scene-inputs.ts](../../src/core/scene-inputs.ts) L5–56: 입력 레이어, schema5 호환·폐기 설정 제거, object 직육면체·방향 검증 | 새 관계 자료는 파생 뷰로 추가. raw schema 변경은 실제 필요한 입력이 있을 때만 | 입력 체계 재작성 불필요. 영상에 맞춰 폐기 설정을 복원하지 않음 |
| C02 | [analysis.ts](../../src/core/analysis.ts) `partitionNormalizedCells` L102, `analyze` L123: 6이웃, 외부 공기, 실제 외피, rooftop/비다양체; [buildings.ts](../../src/core/buildings.ts) `inheritBuildings` L37; [design-profile.ts](../../src/core/design-profile.ts) 독립 해시 | 새 관계 identity가 성분 최소 좌표 변경 때문에 외형 seed를 바꾸지 않도록 기존 anchor와 연결 | R01/R02/R09의 대부분 존재. 큰 좌표/음수 지원을 작은 예제 좌표로 축소하지 않음 |
| C03 | [regions.ts](../../src/core/regions.ts) `analyzeVolume`, covered/annex 해석 L163 부근; [mass-relations.ts](../../src/core/mass-relations.ts) `analyzeMass` L255 및 층 DAG; [vertical-design.ts](../../src/core/vertical-design.ts) `planVertical` L50 | roof scope·관계·시설 지지를 함께 설명할 실행 인덱스. A/B/D 전체 높이와 C 지역 scope를 구분한 채 노출 | 매스 분석이 없는 것이 아님. DAG 라벨이 모든 층 배분을 통제하는 것도 아님 |
| C04 | [facade-layout.ts](../../src/core/facade-layout.ts) L51 `fixedAssignments`, L141 `planPhysicalRun`, L178 `planFacadeLayout`; [facade-face-selection.ts](../../src/core/facade-face-selection.ts), [facade-trims.ts](../../src/core/facade-trims.ts), [building-output.ts](../../src/core/building-output.ts): 선점·실제 run·마감/완성형 키 | 면/경계 판정 이유가 다른 소비자와 일치하도록 공통 관계 참조. 새로운 외형은 기존 출력 보존과 분리 | 현재 외벽 규칙을 영상별 프리셋으로 바꾸지 않음 |
| C05 | [roads.ts](../../src/core/roads.ts) L12 `analyzeRoads`: 큰 정사각형 분해, port·폭·L/T/십자, lane·crosswalk; [spatial-analysis.ts](../../src/core/spatial-analysis.ts) L19 `boundaryRuns`, L35 `analyzeSpatial` | road module과 frontage를 연결하는 교차부/경계 참조를 시설과 공유. 넓이 변화·노치에 대해 현재 분해 한계를 구분 실험 | 단순 도로 기능은 이미 있음. 신호등 문맥/교차부 소비 계약은 새 확장 후보. 기존 도로 버그라고 단정하지 않음 |
| C06 | [access-graph.ts](../../src/core/access-graph.ts) L27 `buildAccessGraph`, L58 `AccessSearch`: 지상/노출 상면, 동일 높이 4방향 edge, 몸체/sweep; [entrance-plan.ts](../../src/core/entrance-plan.ts) L27 `planEntrances` | 관계 뷰에서 접근 결과의 증명 수준·sourceRefs를 재사용. 수직 이동은 별도 입력·실체가 없으면 추가 금지 | 거리 기반 시설 배치보다 이미 강한 계약. 영상의 자유 카메라는 수직 접근 확장 근거가 아님 |
| C07 | [parking-rule.ts](../../src/core/parking-rule.ts) `PARKING_RULE`: open deck/column; [parking-circulation.ts](../../src/core/parking-circulation.ts), [parking-stalls.ts](../../src/core/parking-stalls.ts), [vehicle-motion.ts](../../src/core/vehicle-motion.ts), [parking-budget.ts](../../src/core/parking-budget.ts): 별도 지상 proof | 상층 주차의 실제 진입·경사로는 새 도메인. 현재 능력 표기·진단을 먼저 명확히 유지 | 외형 주차 구조와 차량 왕복 검증을 합쳐 “주차 완료”라 하지 않음 |
| C08 | [fixture-plan.ts](../../src/core/fixture-plan.ts) L53 `planFixtures`, L81 부근 문맥 family, L95 부근 각 칸 슬롯; [fixture-catalog.ts](../../src/core/fixture-catalog.ts) 13종; [wall-facilities.ts](../../src/core/wall-facilities.ts) L14 높이 기반 자동 종류, L21 원자적 조립 | 공통 support/context trace, fragment가 갈려도 같은 절대 칸의 의미 유지. 원본의 신호등·안테나 형태는 별도 envelope/후보 정책이 필요 | 시설 알고리즘 재작성보다 문맥 입력의 일관성이 우선. 외벽 계단/엘리베이터는 장식이며 `MOVEMENT_NOT_IMPLEMENTED` |
| C09 | [scene-inputs.ts](../../src/core/scene-inputs.ts) L65 식생 bottom/middle/top, L80 `vegetationPlacements`; [spatial-analysis.ts](../../src/core/spatial-analysis.ts) L53–54 유효 식생 전체 셀 solid; [environment-output.ts](../../src/core/environment-output.ts) L52 출력; [vegetation-geometry.ts](../../src/vegetation-geometry.ts) 전용 메시 | 식생 계획/지지 거절 설명을 동일 trace 방식으로 연결. 메시 수관 형태와 전셀 solid의 의미를 문서화 | **식생에 충돌 정보가 전혀 없다는 주장은 틀림.** 현재는 보수적 셀 solid이며 시설과 다른 출력 경로 |
| C10 | [environment-generation.ts](../../src/core/environment-generation.ts) `executeEnvironment`: 수직→preflight→spatial→차량→입구→구획→facade→시설→마감; [environment-cache.ts](../../src/core/environment-cache.ts): 제한 FIFO·논리 비용과 telemetry 분리 | 실행 중 관계 인덱스와 읽기 의존성 기록. 실제 병목 근거가 있기 전 증분 scheduler는 보류 | 규칙은 전체 재평가. Viewer 객체 재사용을 부분 생성이라 부르지 않음 |
| C11 | [surface-edit.ts](../../src/surface-edit.ts) `stepSurface`; [scene-editor.ts](../../src/scene-editor.ts) `objectFragments`, `editObjects`, `editRoads`; [environment-editor.ts](../../src/environment-editor.ts) `applyEnvironmentEdit`; [editor.ts](../../src/editor.ts) `DocumentHistory`; [main.ts](../../src/main.ts) L351 `regenerate`, L378 부근 `acceptDocument` | 새 관계 설명을 기존 Inspector에 표시. 편집 실패·no-op·상속을 기존 수락 경로에 연결 | 새 상세 편집 UI 불필요. 지지 상실은 보존된 의도와 진단이라는 현재 정책을 유지 |
| C12 | [viewer.ts](../../src/viewer.ts) L346 `sync`, L351 이전 face Mesh, L424 재사용; [face-mesh.ts](../../src/face-mesh.ts), [display-transform.ts](../../src/display-transform.ts); [column-prototype.ts](../../src/core/column-prototype.ts) `planColumns` | geometry와 의미의 분리 유지. 물/부지 경계·날씨·실제 이동·하중 해석은 별도 명세가 필요한 새 도메인 | 기둥은 기존 점유 run의 표시 해석. 실제 지형 입력/하중 solver가 있다고 볼 근거 없음 |

라인은 기준 커밋의 위치 안내이며 링크와 심볼명을 함께 사용한다. 오래된 설계 문서가 현재 코드와 다르면 현재 코드·최신 계약을 우선한다.

## 2. 보존해야 할 행동과 경계

1. **입출력:** schema6/environment-plans-v1/SceneInputs2/catalog13, schema5 읽기 호환, 폐기한 세부 설정 제거, 기존 사용자 정의 style/rule/adapter 검증. 새 입력이 없는 단계에서 버전부터 올리지 않는다.
2. **좌표:** 정수 Y-up, 각 축 span32, ±1,000,000, XYZ 숫자 정렬, 고정 방향, ASCII 동점, Box16 min 포함/max 제외. 표시 원점은 원본 좌표를 바꾸지 않는다.
3. **결정론:** unsigned32 h33, 음수 modulo, 절대 좌표와 보존 anchor, 기존 성분 상속, 입력 순서 독립성. 실행 시간·GPU·실제 탐색 작업 수는 의미 결과 밖 telemetry.
4. **부피/면:** 원본 구멍·돌출부·밑면, 외부 공기 정책, 영향 면에 한정한 비다양체 fallback. 구조면마다 소유자 하나. 선택 마감과 도색을 구조 coverage로 세지 않는다.
5. **A–D:** 현재 수직 비율, C 1.5층 창/지역 높이, D 고정 흰색, 코너·옥상·사용자 타일 우선순위, 기존 import 경로/호출 계약. `mass`가 존재한다는 이유로 A/B/D에 C의 scope를 강제하지 않는다.
6. **공간:** 원본 기반 preflight, 실제 출력 bounds 포함, 캐시 적중 때도 검증, 예약 우선순위/원자성, 권한 있는 crossing만 공유, portal을 외벽이 재추론하지 않음.
7. **접근/주차:** 몸체·sweep, 가짜 수직 연결 금지, grid-car-v1 전체4×4 회전 sweep/정확한 역전이, 기존 예산과 구획 proof. 보행/차량의 안전 조건을 장식 다양성을 위해 완화하지 않는다.
8. **오브젝트:** 그린 칸의 절대 위치 유지, 한 칸 삭제에 다른 칸을 대표 슬롯으로 재배치하지 않음, 지지 없는 입력 보존, JSON의 명시 시설 종류 유지. 장식 시설의 미검증 이동 상태를 숨기지 않는다.
9. **편집:** 왼쪽 영역 선택/정사각뿔 직접 부피 편집, Undo/Redo·JSON, no-op, 마지막 수락 문서/화면 유지. 컨셉 선택 중심. 기존 타일 설정을 삭제하지도, 새 상세 생성 파라미터 UI를 추가하지도 않는다.
10. **렌더링/이식:** 일반 건물 면당 실제 Mesh 하나에 채택 마감 포함, 공유 geometry/material. Three.js·DOM이 core에 들어가지 않음. 향후 이식은 native 재구현이며 JS 실행 브리지·원본 generator 서버 호출 금지.

[건물 규칙 이식](../BUILDING_RULES_PORTING.md), [환경 계약](../PORTING_CONTRACT.md), [완성형 면 계약](../COMPLETE_FACE_ASSETS.md), [보존 증거](../BUILDING_REFACTOR_PRESERVATION.md), [이식 자료](../NATIVE_PORTING.md)를 함께 읽는다. 기존 214개 입력·419종 메시 baseline은 보존 비교 자료이며 전체 가능한 부피의 전수 증명은 아니다. 새 결과로 baseline을 덮어써 차이를 숨기지 않는다.

## 3. 우선순위와 선행 의존성

| 단계 | 목적·구체적 작업 | 선행 | 완료 기준 |
|---|---|---|---|
| P0 근거·보존 고정 | 현재 계약과 위 C표 확인, 관찰/가설/제안 구분 유지, 새로운 행동별 기대 출력 작성 | 없음 | T01/T02의 비교 기준과 미확정 가설 처리 방침이 정해짐 |
| P1 공통 관계와 설명 | 기존 외피/영역/매스/spatial을 실행 중 인덱스로 연결. 노출·덮임·지지·frontage·같은 경계의 sourceRefs를 일관되게 제공. 시설과 Inspector의 실제 두 소비자에 연결 | P0 | 소비자들이 같은 지지/경계 이유를 보고; 기존 A–D/공간 결과 보존; 새 인덱스만 만드는 작업으로 끝내지 않음 |
| P2 경계·시설 갱신 일반화 | L/U/단차/돌출부/옥상별 문맥을 검증. object fragment 분리 뒤 절대 칸의 위치와 해당 열의 시설 의미 유지. 식생·외벽 시설·일반 시설의 지지 실패 설명 통일 | P1 | T03–T11의 양성/음성 조건. 이미 통과하는 행동은 재구현하지 않음 |
| P3 공간 인터페이스 확장 | 도로 port/frontage/junction 참조 연결, 시설 후보의 교차부 문맥/보호 공간 검사. 필요하면 명시 조명 의도에 한정한 정적 신호등형 후보의 별도 정책 검토 | P1/P2 | T07/T10/T12, 기대한 의미 변경만 발생. 신호등 자동성은 H05 미확정으로 남겨도 됨 |
| P4 외형 다양성·측정 | 같은 의미/소유/envelope 안에서 등록 에셋 변형, 코너/접합 품질, 다양한 조합. 실제 편집 병목이 확인되면 실행 비용을 측정 | P2/P3 | T13–T16 및 변경 규모에 맞는 실제 Viewer 검증. 다양성이 구조·접근 품질을 훼손하지 않음 |
| 별도 연구 | 지형/물 경계, 자동 하중 지지, 진짜 수직 이동, 상층 주차 경사로, 교통 시뮬레이션, 증분 규칙 scheduler, 날씨 효과 | 별도 범위와 계약 필요 | 이번 후속 핵심 구현의 완료 조건에 포함하지 않음 |

기능 수가 아니라 관계의 일반성을 기준으로 순서를 정한다. 새 에셋·신호등·안테나를 대량 추가하기 전에 같은 입력 의미가 다른 위치/높이/편집 순서에서도 일관되는지 검증한다. P3의 새 시각 후보는 증거와 설계 판단을 분리하고 현재 결과를 깨뜨리는 기본값 전환을 하지 않는다.

## 4. 구조적 다양성과 외형적 다양성

| 구조적 다양성 | 외형적 다양성 |
|---|---|
| L/U/구멍/브리지/서로 다른 높이, 도로 접점 변경, 지지 상실, 시설 영역 분할, 실제 접근/예약 충돌 | 재료, 창 프레임, 난간 프로필, 수목 메시, 실외기 외관, 조명 색, 날씨·후처리 |
| 점유·관계·의존성과 실패 조건을 바꾼다 | 같은 의미라도 bounds가 바뀌면 preflight부터 재검증한다 |
| 우선적으로 다양한 입력으로 검증 | semantic 출력 보존과 geometry 검증을 나누어 검증 |

원본과 같은 카메라·조명으로 예쁘게 보이는 예제 하나를 완료 기준으로 삼지 않는다. “병원” 같은 이름을 보고 특별한 문 배치나 기둥 좌표 분기를 추가하지 않는다.
