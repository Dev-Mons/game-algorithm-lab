# 환경 생성 포팅 계약

현재 문서 실행 기준은 schema5 / environment-plans-v1입니다. 언어를 바꿀 때 원본 입력과 파생 계획을 분리하고 동일한 공통 실행 순서를 유지합니다. 구버전 형식 재현은 범위에 없습니다.

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

`npm run verify`, `npm run test:e2e`와 `e2e/environment.spec.ts --grep '@measure'`를 현재 구현의 인수 경로로 사용합니다. JS/GPU 표시 원점은 파생 표시 변환이며 문서 좌표·계획을 변경하지 않습니다.
