# A–D 건물 규칙과 이식 범위

대상 언어 재구현의 시작점과 TypeScript 없이 읽는 입력/기대 출력·geometry 자료는
[네이티브 이식 진입점](NATIVE_PORTING.md)에 있다. 아래의 TS 파일명은 참조 구현 위치다.

현재 기준은 schema 6 / SceneInputs 2 / catalog 13이다. `building-style.ts`의 현재
`SHOP_STYLE`, `OFFICE_STYLE`, `URBAN_SHOP_STYLE`, `TOWER11_D_STYLE`를 대상으로 한다.
옛 저장 문서가 가진 사용자 스타일·수직 프로그램·패턴은 검증된 정의를 그대로 실행한다.
예제 부피의 층수나 후퇴 위치를 스타일 규칙으로 사용하지 않는다.

## 작은 핵심과 입력 → 출력

엔진과 무관한 계산은 `src/core/`에 있다. `tsconfig.core.json`은 DOM 형식 없이 검사한다.

| 파일 | 이식할 책임 |
|---|---|
| `analysis.ts`, `regions.ts` | 정수 점유, 연결 성분, 실제 외피, 면 역할·지지 해석 |
| `building-style.ts` | A–D의 작은 스타일 데이터와 기존 사용자 정의 검증 |
| `vertical-design.ts`, `vertical-allocation.ts`, `vertical-boundaries.ts` | 수직 계획 조율, 층 배분/층별 행 조회표, 실제 월드 경계와 호스트 우선순위 |
| `architectural-program.ts`, `design-profile.ts`, `mass-relations.ts` | C의 프로그램 선택; 층 DAG → 변화/연속 구간 → 같은 옥상 높이의 지역 scope |
| `facade-patterns.ts`, `facade-layout.ts` | 실행당 입력 인덱스/출력 사본 준비; 필수 선점 → 물리 run → 반복 구간 계획 |
| `facade-fitting.ts` | 후보 호환성, 정수 적합도, 결정론적 순위, 승자의 토큰만 구체화 |
| `facade-face-selection.ts`, `facade-tile-settings.ts` | 구간 연결 group, 행/cap → 옥상 → 사용자 타일 → 볼록 코너 에셋 적용 |
| `contextual-building-rule.ts`, `contextual-envelope.ts` | 대표 패널 결정/면별 확장/입면 적용과 출력 전 원본 기반 envelope 기술의 분리 |
| `building-plans.ts`, `building-execution.ts` | 시설·기둥·구형 프레임의 선점 조율; 불변 규칙 입력 → 등록 규칙 실행 → bounds/출입구 검증 |
| `facade-trims.ts`, `building-output.ts`, `complete-face-assets.ts` | 마감 조인트 후보 → 충돌/원자적 예약 → 호스트 면에 마감 및 완성형 키 결합 |
| `environment-generation.ts`, `environment-analysis.ts` | 단계 순서/준비 상태/예약 전달과 문서·외피 분석 캐시의 분리 |
| `environment-output.ts`, `environment-presentation.ts` | 확정 계획의 결과·진단 조립과 표시용 overlay; 규칙 판단에 역으로 전달하지 않음 |
| `*-assets.ts` | 변경하지 않은 실제 에셋 치수·재료·geometry 계약 |

규칙 평가에 필요한 최소 입력은 정규화한 `cells: [x,y,z][]`, 외피 `Surface[]`,
`buildingId`, `design.anchor`, 전역 `seed`, 검증된 `BuildingStyle`이다.
각 Surface는 `faceId`, `cell`, `direction`, `componentId`, `role`, `wallKind`와
지원되는 면인지 나타내는 해석을 가진다. C의 구역에는 `architecture.regionId`도 사용한다.
외피를 외접 직육면체로 대신하면 오목부·구멍·단차의 결과가 달라진다.

최종 입면 선택에는 공통 공간 계획이 확정한 출입구 면, 시설의 벽 교체,
기둥 면, 선택적 구형 다층 프레임 면도 입력한다. 출입구를 입면 계산에서 임의 추측하지 않는다.
출력은 각 면에 대한 `tileId`, `faceAssetKey`, `position2`, `orientationId`,
`ruleId`와 `placementId`이다. `VerticalPlan.faceBands`의 구간·행 역할,
`boundaries`의 마감 호스트, Inspector trace는 함께 유지한다.

## 좌표·정렬·결정론

- 원본은 Y-up 정수 셀, 허용 좌표 ±1,000,000, 현재 문서 최대 축 span 32이다.
  셀 `(x,y,z)`는 각 축 `[n,n+1)`을 점유한다.
- 면 ID는 `x,y,z|direction`, 배치 ID는 `p:<faceId>`다. 방향은 PX/NX/PY/NY/PZ/NZ다.
  면 중심의 두 배 좌표는 `position2 = 2*cell + [1,1,1] + normal`이다.
- 벽 U 축은 PX:`-Z`, NX:`+Z`, PZ:`+X`, NZ:`-X`이며 V는 모두 `+Y`다.
  면 plane은 PX:`x+1`, NX:`x`, PZ:`z+1`, NZ:`z`다.
- `positiveMod(n,p) = ((n % p)+p)%p`. `phase = positiveMod(dot(anchor,U),period)`.
  성분의 새 최소 좌표나 벽 길이를 anchor로 다시 쓰지 않는다. 분리·병합의 anchor 상속은
  `buildings.ts`의 기존 부피/숫자 좌표 동점 규칙을 따른다.
- A/B의 비율 반올림은 `floor((height*permille+500)/1000)`이다.
  엔진의 banker's rounding이나 음수 remainder 의미에 맡기지 않는다.
- C의 `designHash`는 unsigned 32-bit로 `h = (h*33 + charCode) mod 2^32`를 반복한다.
  문자열은 `design-v1|<anchor x,y,z>|<style.id>|<decision>`이고 초기 h는 전역 Seed다.
  program/family/material은 각각 독립 해시다. 정렬된 ID 배열의 `hash % length`를 선택한다.
  program ID는 `mixed-1`, `mixed-2`, family ID는 `bay-2`, `bay-3`, `bay-4`다.
- 일반 팔레트는 `selection.ts`의 `hash33(seed, '<anchor>|facade.palette')`로 고른다.
  C는 profile의 material 해시를 쓴다. D는 팔레트 ID를 보존하되 실제 마감색은 흰색으로 고정한다.
- 충돌·예약 Box16은 1/16셀 단위의 **정수**, min 포함/max 제외다. `faceBounds16`은
  변환된 min을 floor, max를 ceil하여 보수적으로 감싼다. 씬 배치 bounds는 부동소수점
  오차 보정을 위해 min에 `+1e-8`, max에 `-1e-8`을 적용한 뒤 floor/ceil한다.
  렌더용 에셋 세부 치수에는 `.125`, `.25` 등의 분수가 있으므로 해당 geometry 좌표까지
  정수로 반올림하지 않는다. 등록된 에셋 bounds와 실제 마감 예약 검사를 유지한다.

연결 성분 계산은 `analysis.ts:partitionNormalizedCells` 한 구현을 문서의 상속·검증과
외피 분석에서 공유한다. 입력은 `normalizeGrid`가 만든 중복 없는 XYZ 숫자 정렬 셀이다.
로컬 좌표 `(x-minX+1,y-minY+1,z-minZ+1)`에 `strideY=Zspan+2`,
`strideX=(Yspan+2)*strideY`를 사용하여 `key=localX*strideX+localY*strideY+localZ`를 만든다.
각 축 양쪽의 빈 패딩 덕분에 `±strideX, ±strideY, ±1` 이웃 조회가 행을 넘어 잘못 연결되지 않는다.
최대 span32에서 키는 작은 정확한 정수이고 음수/큰 월드 좌표와 무관하다.
이 키는 한 번의 계산 안에서만 쓰며, 성분 ID·면 ID·anchor는 원래 월드 좌표를 유지한다.
성분과 성분 안 셀의 숫자 정렬도 동일하다. 매 편집에서 전체 성분을 다시 계산한다.
C의 `mass-relations.ts`도 층별·최상단 높이별 열 그룹에 같은 함수를 사용한다.
각 호출이 하나의 Y 평면이므로 수직 이웃은 없고 원래의 X/Z 4방향 연결과 동일하다.
전체 매스 DAG·분리/재병합 관계·scope·zone 진단은 계속 계산한다.

`validateGrid`는 셀의 정수·좌표 한계·전체 span 검증을 맡고, `normalizeGrid`는 이를 호출한 뒤
중복 제거·음수 영 정리·XYZ 정렬 사본을 만든다. 두 경로의 입력 검증 수준은 같다.
`validateSceneInputs`의 건물·도로·오브젝트·주차 합집합 검사는 정렬 결과를 사용하지 않으므로
`validateGrid`만 호출하여 버려질 전체 셀 사본과 정렬을 만들지 않는다.

## 높이 규칙

H는 성분의 `maxY-minY+1`이다. A/B/D는 성분 전체의 H와 최소 Y에서 시작한다.
`clamp(x,lo,hi)=max(lo,min(hi,x))`, `roundP(H,p)=floor((H*p+500)/1000)`으로 쓴다.

| 스타일 | 저층 | 중앙 | 상층 | 낮은 건물 |
|---|---|---|---|---|
| A / `shop` | `clamp(roundP(H,250), H>=8?2:1, min(4,H-2))` | 나머지 | `clamp(roundP(H,100),1,min(3,H-base-1))` | H=1..3은 base=1, body=H-1, crown=0 |
| B / `office` | A와 같은 clamp, 비율은 200 | 나머지 | 같은 clamp, 비율은 200 | H=1..3은 A와 같음 |
| C / `urban-shop` | 지면 시작이면 retail=2 | office는 나머지 | upper 1 또는 2, H>=12이면 mechanical=1 추가 | 아래 표 참조 |
| D / `tower11-d` | base=1 | body=H-1 | crown=0 | H=1은 base만 사용 |

H=0은 빈 계획이다. A/B에서 crown 계산은 먼저 결정한 base를 사용한다.
현재 C의 `mixed-1`/`mixed-2`는 각각 upper의 선호 길이가 1/2인 차이만 있다.
`mechanical`은 현재 C에서 루버가 아니라 `crown-single` 창으로 렌더링된다.
Trace의 일반 base/body/crown 숫자가 아니라 실제 `VerticalPlan.bands/faceBands`가 C의 배치 기준이다.

| C의 지역 높이 | yMin=0 | yMin≠0 |
|---|---|---|
| 1–2 | 전부 retail (1층 또는 2층) | 전부 retail: 기존 프로그램 fallback 유지 |
| 3 | retail 2 + office 1 | office 3 |
| 4 | retail 2 + office 1 + upper 1 | office `4-upper` + upper `1/2` |
| 5–11 | retail 2 + office `H-2-upper` + upper `1/2` | office `H-upper` + upper `1/2` |
| 12–32 | 위 식에서 office를 1 줄이고 마지막 mechanical 1 | 동일 |

C는 X/Z 기둥별 최상단 높이가 같은 인접 열을 묶는다. 그룹 면적≥4, X/Z 중 짧은
폭≥2, 최소 바닥에서 꼭대기까지 높이≥2일 때 지역 scope를 만든다. 지역 높이와 시작 Y로
같은 프로그램을 다시 평가한다. scope가 없는 열은 성분 전체 구간을 쓴다.
이 때문에 낮은 날개와 높은 몸체의 상층은 각각 생긴다. DAG의 `podium/tower/annex`
라벨은 진단이며 배분 식의 다른 비율을 선택하지 않는다. scope/zone ID는 시설·Inspector에 사용한다.

각 구간이 1층이면 `single`, 아니면 첫 층 `foot`, 마지막 `head`, 사이 `repeat`다.
위쪽에 같은 방향 외벽이 없으면 별도로 `-cap`을 붙인다. 이 판정은 하늘 노출과 다르다.

## 가로 반복·우선순위·옥상

| 스타일 | 반복 단위 | 나머지·코너 | 유지할 실제 디테일 |
|---|---|---|---|
| A | left, right, pier / 3셀 | single; 실제 연속 run 폭≥3이면 양 끝 pier | base foot/single의 창 V=-6..1/16, 나머지 -3.5..3/16; 밝은 수평 띠와 연속창 |
| B | left, right, single / 3셀 | single; run 폭≥3 양 끝 pier | base head/single와 crown foot/single은 전체 불투명 벨트. body 창 V=-5.75..7.75/16, 나머지 -7.75..7.75/16. 볼록 코너에 폭1/16 흰 기둥 |
| C | left, right 뒤에 pier `period-2`개 / 2·3·4셀 | single; run 폭≥3 양 끝 pier. mechanical은 crown-single 반복 | retail 첫 층 V=-8..8/16, 다음 층 -8..0/16의 1.5층 창. cap 첫 층은 상단6/16. 다른 창은 -3..4/16. 볼록 외장 45도 절삭 |
| D | window / 1셀 | 같은 window; run 폭≥2 끝 edge도 같은 창 에셋 | base 창 V=-6.65..7/16, body -4..7.5/16, 얇은 슬래브·독립 창틀 |

단계는 다음 순서를 유지한다.

1. 지붕·테라스 에셋을 선택한다. unsupported 면은 기본 패널을 유지한다.
2. 검증된 출입구 → 승인된 시설 벽 → 구조 기둥 → 구형 다층 프레임을 선점한다.
   같은 면을 두 필수 결과가 덮으면 실패한다.
3. 성분/방향/plane/Y별 벽을 U로 정렬하고, 셀 사이 구멍마다 실제 run을 끊는다.
   run 끝의 코너는 선점된 면을 덮지 않는다.
4. 선점 면, band, rowRole, rooftop 여부, local-cap 경계가 달라지면 반복 구간을 끊는다.
5. 각 구간의 반복을 계산하고 완전한 left/right 쌍만 놓는다.
6. row/cap → rooftop 변형 → 사용자 타일 → 실제 볼록 코너 변형 순으로 에셋을 결정한다.
   재료 팔레트와 완성형 마감 키를 연결한다.

가로 계산은 구간 폭 W, 첫 절대 U를 S, anchor phase를 A, authored start 길이를 L,
repeat 길이를 P로 두면 `prefix=positiveMod(A-S-L,P)`다.
`repeatCount=min(maxRepeat,floor((W-start.length-end.length-prefix)/P))`이고
최소 반복 횟수에 미달하면 fallback single을 사용한다. 현재 A–D의 start/end는 빈 배열,
minRepeat=1, maxRepeat=32다. 채운 뒤 남은 suffix도 single로 채운다.
기존 사용자 패턴은 exact fit → filler 수 최소 → priority 최대 → ASCII ID 순으로 선택한다.
현재 스타일은 구간당 후보 하나여서 후보별 폭 배열을 만들거나 정렬할 필요가 없다.

코너 변형은 같은 셀의 U 음/양 방향 수직 면 노출로 판정한다. PX는 PZ/NZ,
NX는 NZ/PZ, PZ는 NX/PX, NZ는 PX/NX를 확인한다. 양쪽이 노출되면 both다.
오목 코너에 볼록 변형을 붙이지 않는다. 1–2셀 반환벽에도 이 판정이 적용된다.

`wallKind=rooftop`은 **전체 입력의 같은 X/Z 열에서 하늘에 노출된 최상단 셀**의 벽이다.
낮은 계단과 후퇴부도 동일하며, 위에 다른 부피가 덮인 테라스는 제외한다.
현재 rooftop 실제 난간 상단은 면 중심 기준 A=11/16, B=12/16, C=11.25/16,
D=12/16이다. 보수적 bounds는 모두12/16까지 포함한다.
B/C/D는 에셋에 마감이 통합되어 있다. A는 `facade-trims.ts`에서 실제 경계·충돌·예약을
검사하여 채택한 마감을 같은 면의 완성형 geometry에 합친다. 마감 geometry를 생략하지 않는다.

사용자 타일은 base/retail→base, crown/upper→crown, 나머지→body로 매핑한다.
corner 설정이 있으면 해당 band 설정보다 우선하고, 없으면 band 설정을 쓴다.
선택한 A/B/C/D/wall 타일은 독립적인 single/pier를 사용하므로 연결 group/part를 제거한다.
출입구·시설 벽·기둥·다층 프레임은 이 설정으로 교체하지 않는다. 옥상 판정과 cap,
코너 형상은 설정 후에도 자동이다. `wall`은 기존 A 솔리드 에셋이다.

## 작은 재현 예

외피·접근 계획이 입력한 선점 면이 없는 A의 body 구간을 가정한다.
PZ, `anchor=[0,0,0]`, U=1부터 폭8이면 prefix=2이고 결과 모듈은
`single, single, left, right, pier, left, right, pier`다.
left 모듈은 절대 U=3과6에서 시작한다. 폭2면 완전한 3셀 반복이 없어 single 두 개다.
이는 **코너/출입구 선점 후 남은 구간**의 예이며 전체 벽의 코너를 무시하는 규칙이 아니다.

A 높이12는 base3/body8/crown1, B 높이12는 base2/body8/crown2,
D 높이12는 base1/body11이다. C의 지면부터 높이8인 scope는
mixed-1이면 retail2/office5/upper1, mixed-2이면 retail2/office4/upper2다.
같은 C의 높이2 scope는 retail2이고 first foot+head가 1.5층 창을 만든다.

예를 들어 `cell=[3,4,2]`, PZ의 중심은 `[7,9,6]`(2배 좌표)이고 `faceId=3,4,2|PZ`다.
A body repeat-left의 기본 키는 `facade.ribbon-a-body-repeat-left`이며, 실제 local-cap,
rooftop, 사용자 타일, 마감이 있으면 위 순서로 변형된다. 최종 어댑터는
`face-v1|<baseAssetKey>|<sorted finish keys or plain>`과 팔레트를 조회한다.

## 엔진 어댑터와 갱신 비용

엔진 어댑터는 에셋 조회, 로컬 U/V/normal 배치, 재질, 공유 geometry/재질의 수명,
면당 Mesh 하나 생성·교체, 카메라/선택/Inspector 표시를 맡는다. 현재 구현은
`crafted-geometry.ts`, `viewer.ts`, `facade-finishes.ts`다. Three.js·DOM·Viewer 객체를
규칙 입력에 넣지 않는다. 지원되지 않는 조합은 등록된 fallback/진단을 쓴다.
공간 예약, 실제 접근 경로, 충돌, 외벽 소유는 [기존 포팅 계약](PORTING_CONTRACT.md)을 함께 이식한다.

이번 정리의 규칙 실행은 전체 재평가다. 패턴/모듈 lookup은 실행당 한 번 만들고,
각 후보의 폭 배열 대신 적합도 숫자만 비교한 뒤 승자의 모듈 배열만 만든다.
층별 band/rowRole은 scope마다 한 번 계산한다. 면마다 방향 검색, 앞면 목록 검색,
코너 모듈 검색을 반복하지 않는다. 실행을 넘는 새 규칙 cache는 없으므로 무효화나
영구 메모리 증가가 없다. 복잡도는 외피 F, 최대 높이 H, scope 수 S에 대해 층 선택
`O(S*H+F)`, 가로 배치 `O(F + 행별 정렬)`이며 C의 mass 분석과 공간 계획은 별도다.

환경 실행은 모든 건물 규칙에 `resolveBuildingRule(...).generate(ruleInput)`를 호출한다.
일반 건물만 별도로 `building-panels` cache를 조회하던 실행 분기는 제거했다.
`contextualTemplates`는 역할/방향/옥상/지원 여부별 대표 면의 기본 패널 결정만 수행하므로
건물 실행마다 한 번 다시 계산한다. 이전 cache는 작은 결정 결과를 저장하기 위해 스타일과
전체 에셋 카탈로그를 포함한 키를 직렬화했고, 큰 부피의 추가·삭제에서 분석 cache와 같은
용량을 경쟁했다. 현재는 이 키와 결과를 보관하지 않아 해당 직렬화·무효화 경로가 없다.
대표 면의 입력 검증은 유지하며 등록 에셋 포함 여부는 불변 Set으로 검사한다.
실제 모든 면의 선택 trace·소유·출력 bounds 검증은 이전과 같은 경로로 수행한다.
남은 문서·외피 분석·주차 계획 cache는 기존 FIFO 최대64개/16MiB 예산을 유지한다.
이 예산은 키와 결과 및 보관 identity의 직렬화 크기 추정치이며 전체 JS heap의 상한은 아니다.
cache 적중·축출 telemetry는 달라질 수 있지만 생성 결과와 논리 평가 횟수는 바꾸지 않는다.

Viewer는 직전 화면의 `faceId → Mesh`만 현재 동기화 동안 참조하여 같은 면의 Mesh를 재사용한다.
매번 전체 생성 결과의 geometry 키, 마감 ID, 재질과 표시 원점을 포함한 행렬을 다시 지정한다.
없어진 면의 Mesh는 보관하지 않으며 재사용 표도 동기화가 끝나면 버린다. 따라서 새 Mesh 보관량은
현재 표시 면 수에 한정되고, 여러 편집 이력의 Mesh를 쌓는 캐시는 없다. 공유 geometry/재질은
기존 라이브러리의 수명에 따른다. 이것은 표시 객체 재사용이며 규칙·충돌 검사를 생략하는 부분 생성이 아니다.

높이 변경은 성분 전체의 층 배분을, 연결 성분 변경은 anchor 상속·여러 외벽·주변 접근과
시설 계획을 바꿀 수 있다. 셀 주위 면만 재계산하는 규칙은 도입하지 않았다.
기존 문서·분석·주차 계획 cache와 Viewer의 geometry/배치 재사용은 별도 계층이다.
추가·삭제·Undo/Redo·저장 복원에서도 동일 입력으로 전체 규칙을 평가할 수 있어야 한다.

순수 규칙 측정은 `experiments/facade-core-performance.test.ts` 및
`benchmarks/facade-core-before.json`, `benchmarks/facade-core-after.json`이다.
24³, Seed17, 스타일별 최초1회+반복40회이며 analysis/base 선택은 측정 밖이다.
매번 수직/입면을 다시 평가한다. 이 수치는 공간 계획·입력 처리·geometry·GPU를 포함하지 않으며,
편집의 화면 반영 지연은 별도의 편집 경로 보고서를 기준으로 판단한다.
중앙값(p50)과 p95는 앱과 같은 nearest-rank인 `sorted[ceil(n*p)-1]`을 사용한다.
최초 표본은 반복 통계에서 제외한다. 최초1회만으로 cold 지연의 분포를 추정할 수는 없다.

## 책임 분리 후 내부 데이터 흐름

`planVertical`은 스타일/Seed를 해석한 뒤 전역 배분과 지역 scope별 배분을 계산한다.
`rowsByHeight`를 scope마다 한 번 만들고 외벽은 열 scope와 Y로 조회한다.
`mass-relations.ts`의 진단 DAG/변화 라벨과 실제 층 배분 scope는 별도 단계이며,
지역 프로그램의 높이는 계속 같은 높이의 옥상 열 그룹에서 결정한다.

입면은 `FacadeLayoutInput`의 읽기 전용 조회표를 공유한다. `planFacadeLayout`은
출입구·시설·기둥·프레임·실제 run 끝을 선점한 작은 Map과 반복 구간을 반환한다.
일반 면마다 중간 배치 객체를 보관하지 않는다. 구간의 패턴/진단/행 정보를 공유하면서
`applyPatternSection`이 연결 group을 만들고 `applyWallModule`이 결과 사본에 적용한다.
레이아웃 판단은 placement/trace 변경을 읽지 않는다. 원본 base 객체는 수정하지 않는다.
코너 설정 또는 코너 변형 descriptor가 있을 때만 이웃 면을 조회하며, 등록된 모든
코너·옥상·사용자 타일 선택 순서는 위 계약과 같다.

`planFacadeTrims`의 후보 구성은 호스트와 양끝 절삭을 먼저 확정한다.
`reserveTrimCandidate`만 예약 book을 변경하며, 채택 결과는
`completeBuildingFaces`에서 호스트·변환을 검증하고 기존 완성형 에셋 키에 결합한다.
시설과 마감이 동일 book을 순서대로 사용하는 원자적 우선순위를 유지한다.

`generateBuildings`는 건물별 면/영역과 계획을 실행당 한 번 인덱싱한다.
일반 contextual 규칙은 해당 성분의 셀과 geometry 계획, 자기 solid 예약을 받고,
사용자 정의 규칙은 기존 전체 분석 셀/features와 trace/예약 문맥을 그대로 받는다.
모든 등록 규칙은 동일 실행/검증 경로를 거친다. `assembleEnvironmentResult`는
확정된 계획과 예약 snapshot만 받으며 생성·예약·캐시 결정을 수행하지 않는다.
공개 `planVertical`, `verticalCounts`, `chooseFacadePattern`, `applyFacadeStyle`의
기존 import 경로와 호출 계약은 유지한다.
