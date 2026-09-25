# 환경 생성 포팅 계약

다른 언어·엔진으로의 기본 이식은 대상 언어로의 재구현이다. 실행 브리지 금지 범위,
순수 JSON/메시 자료와 독립 비교 절차는 [네이티브 이식 진입점](NATIVE_PORTING.md)을 따른다.

현재 문서 실행 기준은 schema6 / environment-plans-v1 / SceneInputs2 / catalog13입니다. 언어를 바꿀 때 원본 입력과 파생 계획을 분리하고 동일한 공통 실행 순서를 유지합니다. schema5 읽기 호환은 `document.ts`에 남아 있습니다.

A~D의 최소 입력·출력, 높이별 배분, 가로 반복, 코너·출입구·옥상 우선순위와 계산 예제는 [건물 규칙 이식 문서](BUILDING_RULES_PORTING.md)를 먼저 참고하세요. 기존 리팩터링의 [결과 보존 증거](BUILDING_REFACTOR_PRESERVATION.md)와 [실제 편집 성능](BUILDING_EDIT_PERFORMANCE.md)은 측정 당시 조건과 함께 참고하세요.

- 정수 좌표 Y-up, 방향 순서는 `analysis.ts`/`environment-contract.ts`의 등록 순서를 사용합니다. numeric cell→고정 방향→ASCII ID의 동점을 그대로 유지합니다.
- Box16은 1/16셀 단위, min 포함/max 제외입니다. 면 기저와 배치 행렬은 `BASES`, `faceCenter2`, `faceBounds16`의 정의를 따릅니다. 빈 셀을 덮는 AABB 근사로 사전 외피를 바꾸지 않습니다.
- uint32 h33 해시는 곱셈/덧셈마다 unsigned32로 줄입니다. `fixtures/hash-vectors.json`으로 검증합니다. 외관/시설 phase는 보존 anchor·절대 좌표를 사용합니다.
- RuleSpatialAdapter는 정확한 rule ID/version/definition과 adapter reference를 검증한 뒤 실행합니다. 사전 계산에는 원본/분석/스타일/metadata만 제공하며 생성 결과나 후속 계획을 전달하지 않습니다. 실제 출력은 cache hit여도 등록 bounds와 envelope 합집합에 포함되어야 합니다.
- 공공900, 차량800, 접근700, 구획600, 안전500, 조명400, 시설300, 부착200 순서입니다. 고정 solid는1000입니다. 예약 batch는 원자적이고 인증되지 않은 crossingId는 권한이 아닙니다.
- 보행은 실제 ground/노출 roof 지지, 몸체와 edge sweep를 사용합니다. 임의 높이 연결/중앙분리대 도착점을 추가하지 않습니다.
- grid-car-v1은 rear+heading 인접 셀의 footprint, 전후진, 전체4×4 정수 회전 sweep와 정확한 역전이를 사용합니다. Dijkstra cost는10+4×새 차로 셀 수입니다. decrease-key와 고정 이웃 순서를 유지합니다.
- parking-budget-v1은 입력당1,500,000/500,000/128이며 U_i=12*N_i+32*floor(P_i/2)를 구획 pool에서 먼저 보호합니다. cache는 논리 비용을 동일하게 재현하며 실제 작업·시간은 결과 밖 telemetry입니다.
- 구획 proof의 허용 mask는 원본 road+확정 gate/connector/aisle+자기 두 셀뿐입니다. base graph1회/BFS2회, 후보의 추가 상태는16 이하입니다.
- 구조면마다 정확히 한 소유자를 유지합니다. 선택 마감과 도색은 구조 coverage 소유자가 아닙니다. 원본 마스크의 구멍을 렌더링 편의를 위해 채우지 않습니다.
- 일반 건물은 완성형 면 키를 선택하고 면당 Mesh 객체 하나에 본체·프레임·유리·채택 마감을 모두 포함합니다. 고정 finish profile과 호스트 소유 규칙은 `COMPLETE_FACE_ASSETS.md`를 따릅니다. 마감 예약/결정은 유지하지만 별도 마감 렌더 모듈은 만들지 않습니다. 여러 재질 슬롯과 공유 geometry는 허용하며 단일 객체가 단일 draw call을 뜻하지는 않습니다.

`npm run verify`, `npm run test:e2e`와 `e2e/environment.spec.ts --grep '@measure'`를 현재 구현의 인수 경로로 사용합니다. JS/GPU 표시 원점은 파생 표시 변환이며 문서 좌표·계획을 변경하지 않습니다.

책임 분리 후에도 단계 순서와 규칙/어댑터 등록 계약은 동일합니다.
`environment-generation.ts`가 단계 상태와 예약 전달을 조율하고,
`building-plans.ts`가 건물 선점을 준비하며, `building-execution.ts`가 불변 입력 준비·규칙 실행·출력 검증을 담당합니다.
`environment-output.ts`와 `environment-presentation.ts`는 확정 결과와 표시용 진단을 조립합니다.
이 내부 분할은 문서 schema, 에셋 catalog, 규칙 version을 변경하지 않습니다.

## 지지·시설·관계

`scene-relations.ts`의 `SupportIndex`는 실제 외피와 설치 열을, `SceneRelationIndex`는 기존 공간 경계·도로 모듈·port·도착점을 연결합니다. 시설·식생·Inspector는 같은 실행의 관계를 공유합니다. 관계, `sourceRefs`, `readDependencies`는 읽기 전용 파생 설명이며 저장 문서나 증분 갱신 스케줄러가 아닙니다. 편집 시 전체 규칙을 재평가합니다.

- 호환되는 오브젝트 fragment의 연속 수직 열은 같은 설치 지지·높이를 사용합니다. 지지를 잃은 열만 생성에서 제외하고 원본 입력과 진단을 남깁니다. 유효 식생의 실제 원본 셀 전체는 solid1000으로 예약하며 외접 박스로 빈 곳을 메우지 않습니다.
- 일반 시설은 절대 칸을 유지합니다. 조명은 같은 높이의 도로 방향(없으면 0)과 고정 후보 순서를 사용하며, 본체·보호 예약 때문에 불가능할 때만 다음 후보를 선택합니다. 접근 검증은 배치 후 계속 수행합니다.
- 외벽 시설의 자동 종류는 호환되는 연속 열로 정하되 JSON의 명시 종류가 우선합니다. 예약 승인·거절은 원본 fragment별로 원자적입니다. 계단·엘리베이터 외형은 실제 수직 이동을 증명하지 않습니다.
- 도로 근접성으로 접근 성공을 추정하지 않습니다. 실제 경로 결과의 도착 셀을 관계에 연결하고, 시설·주차의 교차부 보호는 [도로 규칙](ROAD_RULES.md)의 공통 판정을 사용합니다.
- 설치 지지는 하중 증명과 다릅니다. 실제 수직 이동·상층 주차 연결·지형·하중 해석은 지원 범위 밖이며 서비스 접근 미검증을 성공으로 승격하지 않습니다.

관련 회귀는 `tests/scene-relations.test.ts`와 `e2e/scene-relations.spec.ts`에 있습니다. 과거 대표 편집의 [원시 비용 표본](relation-evidence/span32-edit-cost.json)은 추가/제거 각 1회이며 최대 32³ 성능이나 GPU 완료 시간을 입증하지 않습니다.
