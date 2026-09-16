# 엔진 독립 저장·포팅 계약

현재 Godot 코드를 작성하지 않는다는 원 계획의 범위를 유지한다. 아래 데이터와 Golden으로 먼저 headless 결과를 대조한 뒤 엔진 표시를 연결한다. 실제 Godot 포팅/성능/렌더 일치는 아직 검증하지 않았다.

## 공통

- 오른손 좌표계, +Y 위, Cell 최소 꼭짓점, Grid unit 1.
- Cell 정렬은 숫자 (x,y,z), 방향은 PX,NX,PY,NY,PZ,NZ. 성분은 6-연결이며 최소 Cell이 ID다.
- 점유 AABB에 1셀 padding을 두고 빈 공간 6-연결 flood fill. 공유면·밀폐 공동 제외, 외부 하부면 포함.
- position2는 실제 위치의 2배 정수. 여섯 정수 기저는 DEVELOPMENT_PLAN.md의 표 및 src/core/analysis.ts의 BASES를 따른다.
- h33-u32-v1은 seed부터 ASCII byte마다 (h * 33 + byte) mod 2^32. 64-bit 정수 중간값을 사용한다. fixtures/hash-vectors.json의 세 벡터를 먼저 통과해야 한다.
- Rule은 priority 내림차순/ASCII ID 오름차순, 후보 Tile은 ASCII ID 오름차순. canonical JSON은 객체 키 ASCII 정렬, 등록된 목록의 정규 순서, 공백 없음, UTF-8, 마지막 LF 하나다.
- 시간·카메라·GPU 상태는 Core 결과와 저장 입력에서 제외한다.

## 버전

v1 shell-v1과 v2 architecture-v1의 Golden은 변경 없이 유지한다. v2는 coplanar Region, 낮은 별동/테라스, 파사드와 성분별 Palette를 추가한다. v3 modules-v1은 v2의 Face 선택 이후 모듈 대체/부착 단계를 수행한다. v3의 style/canonical metadata는 v1/v2에 주입하지 않는다.

등록되지 않은 schema/algorithm/catalog/rule/style/설정과 바뀐 metadata를 거부한다. Rule 코드나 임의 실행 코드는 저장하지 않는다. 모든 기본값은 createDocument에서 명시하며 모듈 metadata는 assetKey 정렬 후 비교한다.

## v3 coverage와 변환

- 남은 단위 placements는 faceId 하나를 소유한다.
- modules 중 kind=structure는 faceIds 전체를 소유한다. 원래 그 면을 소유한 단위 Placement는 제거된다.
- kind=attachment는 faceIds가 빈 배열이며 hostFaceId에 부착된다. reason/clearanceCell에 실제 부착 조건과 비어 있음을 확인한 Cell을 기록한다.
- 모든 외피 Face에 구조 소유자가 정확히 하나여야 한다. 다른 면이나 공동에 소유자가 생기면 실패다.
- Module의 로컬 변환은 기준 기저 B, scale16/16, position2/2를 사용한다: world = position2/2 + B * (local * scale16/16).
- 출력 Module 순서는 정규 Region 순서의 지붕, 그 지붕의 정규 Face 순서/방향 PX,NX,PZ,NZ인 처마, cap 방향 PZ,PX,NZ,NX 순서다. 모든 지붕 이후 정규 Face 순서로 Corner를 제안한다. 별도로 moduleId 문자열 정렬을 적용하지 않는다. 남은 단위 Placement와 Face Trace는 원래 Face 순서를 유지한다.
- v3 Trace는 Face 선택 단계 뒤에 모듈 대체 단계를 기록한다. 대체된 이전 선택은 coverage-owned가 되고 assembly Rule이 최종 선택이다. 부착 모듈은 구조 선택을 바꾸지 않고 별도의 reason/clearanceCell을 가진다.
- corner의 hostFaceId가 주 면이다. 로컬 주 패널은 XY, z=0이며 두 번째 패널은 x=0.5, y∈[-0.5,0.5], z∈[-1,0]이다. faceIds 배열 첫 원소가 항상 host라고 가정하지 않는다.
- Roof prototype footprint는 로컬 XY [-0.5,0.5]², +Z 높이 0~1이며 바닥 면이 없다. 지붕 원점은 원래 상면 Region 중심, orientation은 PY다.
- 지붕 scale16=[16*X폭,16*Z폭,max(8,4*min(X폭,Z폭))]. 평지붕의 높이 scale16은 2다. 긴 축에 따라 x/z prototype을 고른다.
- 직사각형/하늘 열림/높은 인접 벽 없음의 조건을 만족하지 못한 roof는 단위 평지붕을 유지하고 이유를 기록한다.
- 처마 straight는 로컬 x∈[-0.5,0.5], y,z∈[0,0.125]. corner cap은 세 축 [0,0.125]. 저장된 orientation으로 열린 경계의 외향에 맞춘다.
- 모든 Asset의 bounds16/coverage metadata는 src/core/modules.ts와 v3 저장 문서에 들어 있다. 고정 Mesh recipe는 src/crafted-geometry.ts에 있으며 입력 Grid를 받아 Mesh를 만드는 함수가 아니다.

Core의 위치와 Renderer의 표시 원점을 섞지 않는다. 큰 좌표는 GPU float 정밀도를 위해 표시 원점을 CPU에서 먼저 적용한다. 이것은 저장 위치/선택 결과를 바꾸지 않는다.

## 검증 순서

1. Hash 벡터와 여섯 기저의 u×v=n, 단일 Cell의 여섯 Transform을 대조한다.
2. fixtures/golden/*.json 10개의 input을 읽고 output 전체(Trace/카운터 포함)를 대조한다.
3. fixtures/golden-v2/*.json 3개로 Region/Facade를 대조한다.
4. fixtures/golden-v3/*.json 3개로 모서리·지붕·처마, coverage 대체, 최종 Trace를 대조한다.
5. fixtures/city-golden.json은 선택적 도시 입력 생성기의 city-grid-v1 기준이다. 도시 생성 결과를 다시 일반 Grid 경로로 전달한다.
6. 원본/분석/배치/하부면을 표시하고, 실제 Mesh의 bounds·경계·정수 변환을 검사한다. Screenshot만으로 Core를 승인하지 않는다.


## v4 건축 스타일 추가 계약

schema 4 / building-patterns-v1은 v3 기반 외피/지붕 조립을 재사용하되 벽면 패턴을 데이터로 선택한다. 입력의 `buildingDefinition`은 실제 스타일 ID/버전/모듈/층/패턴 정의이며 해석기가 지원하는 구조화 데이터다. 이 정의까지 저장해야 사용자 정의 변경 후에도 재현된다. `documentOptions(document)`를 통해 저장된 정의를 생성 옵션으로 전달한다. 기존 v1~v3 경로와 Golden은 변하지 않는다.

- 셀 Y 행 하나가 층 단위다. 기본 ground 1행 / middle 남는 행 / top 1행; 단층은 ground와 로컬 cap을 함께 갖는다. 떠 있거나 성분 minY가 0이 아니면 입구를 만들지 않는다.
- 같은 Region/방향/Y/로컬 상단 상태의 실제 인접 열만 구간이다. 구멍·문·예약된 모서리에서 나눈다.
- 각 구간의 local u는 기존 BASES를 그대로 사용한다. seed는 건물 palette를 정하며 패턴 동률은 ASCII ID로 정한다.
- 공유 배열은 폭 내림차순, Y 오름차순, ASCII Face ID 순으로 결정한 첫 적합 패턴/시작 열을 기준으로 한다. align이 같은 Region의 이후 행은 반복 위상을 공유하고 필요한 앞/뒤 칸을 단독 모듈로 채운다.
- 후보 순위는 필수 조건, 정확한 채움, 보충 수 최소, priority 내림차순, ID 오름차순이다.
- left와 right는 개별 unit-face 소유자다. groupId는 왼쪽 Face ID와 패턴 ID를 포함한다. 현재는 두 조각만 지원하며 중간에 문/구멍/다른 소유자가 끼면 그 묶음을 배치하지 않는다.
- 벽/프레임/유리는 같은 Placement 행렬로 표시한다. 유리는 local z=1/64; joint x=±0.5와 동일 높이, 내부 세로 프레임 없음이 에셋 계약이다. 방향에 따른 u 축 부호를 생략하거나 임의 반전하지 않는다.
- 새 Facade 면은 기존 2면 corner.window 대체에서 제외한다. 새 cap/cornice는 empty faceIds의 attachment이며 전체 구조 coverage는 정확히 한 번이다. 새 부착물은 기존 지붕/처마 뒤에 정규 Face 순서로 추가한다.
- fixtures/golden-v4/shop.json, office.json으로 정의를 포함한 입력과 전체 출력/Trace를 대조한다. 기존 Golden을 v4 출력으로 갱신하지 않는다.


### building-patterns-v2의 입구 정책

schema는 4를 유지한다. definition.entranceLayout이 centered-parity이면 algorithmVersion/settings.facadePolicy는 building-patterns-v2다. undefined 또는 single-center는 building-patterns-v1과 기존 선택 결과를 유지한다. 정면의 실제 접지 run 길이 N에서 span=N이 짝수일 때 2, 홀수일 때 1이며, 시작 열은 floor((N-span)/2)다. 연속 span개 Face를 출입구로 확보한다. 새 Trace는 entranceSpan을 포함한다. v1/v2 스타일 Golden은 덮어쓰지 않으며 v3 스타일의 새 골든은 golden-v4-style-v3에 둔다.
