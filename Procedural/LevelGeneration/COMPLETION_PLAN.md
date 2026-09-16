# 잔여 계획 완수 추적

상태: 아래 필수 항목 1~5 구현·검증 완료 (2026-09-16). 조건부/제외 항목은 구현 완료로 바꾸지 않고 별도로 유지한다.

사용자 요청(2026-09-16): 계획 문서의 내용을 완수할 때까지 계속 개발한다. 기존 MVP와 Region/Facade만 완료한 상태에서 작업을 끝내지 않는다.

## 필수 남은 작업

1. **입체 모듈 계약/에셋**: 공유된 창문·문 프레임, 모서리 대체, 처마, 평지붕/박공지붕/우진각 지붕을 실제 3D geometry로 제공한다. 정상 외피 coverage 유지, 두께/경계/부착 위치를 데이터와 실제 Mesh로 검증한다.
2. **대체 소유권**: 2면 모서리 모듈은 원본 두 Wall의 소유권을 제거한다. 직사각형 지붕은 N개 상면을 대체한다. 처마 등 장식은 별도 Attachment이고 구조 coverage를 충족하지 않는다. 선택·보류 이유를 Trace에 기록한다.
3. **Editor UX**: Box 추가/삭제, 선택 영역 Extrude, Undo/Redo, 기본 키보드 단축키. 실패/상한을 지키고 저장 재현 및 취소 후 일관성을 검증한다.
4. **도시 단위 입력**: Seed와 크기/밀도/높이 설정으로 여러 건물 부피를 생성한다. 도로 간격은 배치 공간으로 확보하되 지형이나 내부 공간 생성으로 확대하지 않는다. 생성 결과는 기존 Grid와 같은 경로로 분석·편집·저장한다.
5. **최종 감사**: 버전별 과거 Golden 보존, 신규 Golden/계약/coverage 테스트, 실제 편집·저장·Undo 흐름 E2E, 화면 smoke, 대표 성능 재측정, 문서와 완료 증거를 연결한다.

## 입체 배치의 초기 계약

- 기존 v1/v2는 고정한다. 새 Profile은 새 schema/algorithm/style 버전을 쓴다.
- 모든 기본 Face의 구조 소유자는 정확히 하나다: 단위 Placement 또는 coverageFaceIds를 명시한 Module.
- 모서리 모듈은 같은 Cell의 볼록한 수직 모서리를 공유하는 두 Wall을 대체하며, 두 면의 창문/상단 조건과 Palette가 맞을 때만 쓴다. 입구를 덮어쓰지 않는다.
- 입체 지붕은 상부 가림과 높은 인접 벽이 없는 직사각형 roof Region에만 쓴다. 붙어 있는 별동·오목한 지붕·덮인 상면은 해당 Style에 포함된 평지붕 모듈을 유지하고 이유를 기록한다. 높은 벽의 일부와 겹치는 지붕 end-cap을 억지로 만들지 않는다.
- 공유 지붕 prototype은 단위 footprint를 Region 크기로 배율 변환한다. 바닥 내부면은 만들지 않는다. 지붕의 structural coverage는 대체한 상면 집합이다.
- 모듈과 장식의 위치는 position2, 배율은 scale16 정수로 저장한다. 정적 Asset은 기준 좌표계와 local bounds를 가지며 Viewer는 Core 선택을 바꾸지 않는다.
- 프레임/처마 돌출은 1/8 unit 이하. 장식은 호스트 구조에 부착되며 의도적 접촉/겹침과 구조 소유권을 구분한다. 인접 점유 공간을 침범하지 않는 경우만 허용한다.
- Geometry는 Asset 종류별로 한 번 제작하여 공유한다. Voxel마다 최종 Mesh를 생성하지 않는다.

## 조건부/명시적 제외

- Incremental/Worker/WASM/GPU는 원 계획의 성능 측정 조건을 만족할 때만 검토한다. 목표 이내라면 미도입 사유와 측정값으로 조건을 종결한다.
- Godot는 현재 코드 작성 대상이 아니라 포팅 준비다. 좌표/Hash/정렬/coverage/Golden 계약을 제공하며 실제 엔진 실행을 완료로 주장하지 않는다.
- 지형, 내부 방/복도, 범용 Plugin/Rule DSL, 범용 제약 해결기, 모든 건축 형태 지원은 원 계획의 제외 범위다.

진행 상태와 근거는 구현이 끝난 항목마다 아래에 추가한다. 미완료 항목이 있는 동안 목표를 완료 처리하지 않는다.

## 최종 완료 감사

| 요구 | 구현 근거 | 검증 근거 | 판정 |
| --- | --- | --- | --- |
| 원본 Grid/외피/하부면/공동 규약 | core/analysis.ts, core/regions.ts | generate/analysis/architecture 테스트, v1/v2 Golden 유지 | 완료 |
| 실제 입체 Asset·두께·Pivot·접합 | crafted-geometry.ts, core/modules.ts, Tile.relief16 | modules.test.ts의 실제 Mesh bounds, asset-joints.test.ts의 두 면 꼭짓점/법선과 지붕 투영 덮기 | 완료 |
| Corner/N-cell 교체와 장식 분리 | assembleModules/validateAssembly, kind/faceIds/hostFaceId | 모든 형태의 소유권 합계, 중복 거부, 지붕 내부 바닥 없음, 점유 침범 검사 | 완료 |
| 선택/보류/부착 근거 | FaceTrace.assembly/assemblyNote, Module.reason/clearanceCell, Inspector | v3 Golden, 부착 모듈 선택 E2E | 완료 |
| 추가 Style | crafted-hip/gable/flat, 등록 Catalog/설정 | 세 Style의 실제 Mesh 및 round-trip/Golden, 스타일 전환 E2E | 완료 |
| 표면 드래그·영역 추가/제거·Undo/Redo | surface-edit.ts, surface-interaction.ts, main.ts의 입력 트랜잭션. 기존 Box 데이터 연산 보존 | editor.test.ts, surface-edit.test.ts, surface-edit.spec.ts의 교차 편집·선택 유지·취소·복원 | 완료 (2026-09-17 직접 조작 개편) |
| 도시 부피 입력 | core/city.ts, 도시 생성 UI | city.test.ts, city-golden.json, 중앙 광장 생성/저장 E2E | 완료 |
| 버전/결정론/재현 | core/document.ts, schema 1/2/3, metadata 복사/정렬 | 기존 Golden 13개 보존, 신규 v3 3개, Seed/순서/저장 테스트, 잘못된 metadata 거부 | 완료 |
| Viewer 비교/선택/하부/큰 좌표 | viewer.ts, display-transform.ts | 실제 화면 smoke, 1,000,000 좌표 GPU 변환 회귀와 브라우저 클릭 검증 | 완료 |
| 필수 검사와 성능 | 프로젝트 npm scripts, measurement.ts | verify 67건+타입+빌드, E2E 4개 흐름, measure 75개 조합×50표본 | 완료 |
| 엔진 독립 포팅 준비 | PORTING_CONTRACT.md, 버전별 Golden/Hash | TypeScript headless 대조 완료; Godot 실제 실행은 제외로 표시 | 완료 |

마지막 production build 성공. JS 청크 약 627 kB(압축 약 162 kB)의 Vite 크기 경고는 남는다. 대표 CPU 생성 p95 최대 24.3ms, 입체 Style 최대 22.7ms로 제안 목표 100ms 이내다. GPU 완료/프레임률·다른 브라우저·최대 입력 전체의 성능 보장은 검사 범위가 아니다.

## 원 계획의 조건부/제외 항목 판정

| 항목 | 현재 판정 | 근거 |
| --- | --- | --- |
| Incremental / Worker / WASM / GPU | 조건 미충족으로 미도입 | 대표 입력 전체 재생성 목표 이내. 막연한 최적화로 범위를 확대하지 않음 |
| Godot 런타임 | 명시적 현재 제외 | 원 문서에 지금 Godot 코드를 작성하지 않는다고 명시. 포팅 계약/Golden은 제공 |
| 지형·실내·범용 Plugin/DSL·WFC | 원 계획의 제외/보류 유지 | 외피 생성과 편집 목표에 필수 아님. 이들까지 구현했다고 주장하지 않음 |
| 모든 형태의 곡면/아치/복잡한 지붕 | 지원 범위 제한 유지 | 검증한 작은 Catalog와 명시적 평지붕 보류 정책 사용 |

원 계획의 필수 개발 항목을 남겨둔 채 다음 마일스톤으로 넘기지 않는다. 위 구현 대상은 완료했고, 조건부 항목은 조건과 미도입 사실을 명시했다.


## 추가 완료: 데이터 기반 층·Facade 스타일 (2026-09-17)

[BUILDING_STYLE_PLAN](BUILDING_STYLE_PLAN.md)의 범위에 따라 상가형/업무형 정의, 층별 구성, 실제 연속 구간과 정렬된 반복 패턴, 단위 좌우 연결 에셋, 정면 입구/모서리/상단 마감, v4 저장 및 Trace를 완료했다. 기존 Golden은 수정하지 않았다. 검증은 타입/83개 테스트/build, 브라우저 8개 시나리오와 실제 두 스타일 및 높이별 렌더 확인이다. 원본 BDF DSL·stretching·임의 층고·3칸 이상 에셋은 이번 완료 범위에 포함하지 않는다.
