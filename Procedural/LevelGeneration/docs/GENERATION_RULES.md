# LevelGeneration 생성 규칙

현재 구현의 입력·공간·건물·도로·주차·시설·에셋 규칙을 이 문서에서 관리한다.
참조 구현은 `src/core/`이며, 다른 언어의 구현 절차와 참조 번들은 [네이티브 이식](NATIVE_PORTING.md)을 따른다.
예제 부피는 생성 규칙이 아니다. 영상에서 추론한 제안은 마지막 절에 별도로 표시한다.

- [입력과 실행](#입력과-실행)
- [공통 공간과 접근](#공통-공간과-접근)
- [건물 A–D](#건물-ad)
- [완성형 면 에셋](#완성형-면-에셋)
- [Blender 집과 부속 차고](#blender-집과-부속-차고)
- [도로](#도로)
- [지상 주차](#지상-주차)
- [인도·식생·시설과 관계](#인도식생시설과-관계)
- [편집·실패·검증 경계](#편집실패검증-경계)
- [영상 연구의 제안 ID](#영상-연구의-제안-id)

## 입력과 실행

현재 저장 형식은 **schema 6 / environment-plans-v1 / SceneInputs 3 / catalog 13**이다.
원본 입력은 정수 건물 부피, 건물 컨셉/등록 규칙·보존 anchor, 전역 seed,
도로·인도 셀, 방향과 category를 가진 오브젝트 의도, 지상 주차 마스크다.
외피·관계·수직/접근 계획·예약·에셋 키·진단은 파생 결과이며 원본을 덮어쓰지 않는다.

SceneInputs 2는 `sidewalks: []`를 붙여 3으로 읽는다. schema 5는 부피·컨셉·도로·오브젝트·주차·anchor를 유지하면서
폐기된 용도·층수 덮어쓰기·건물별 Seed/프로그램/재료/기둥 설정과 환경 설정을 버린다.
기존 사용자 스타일·패턴·프로그램은 등록/검증 계약에 맞는 정의를 유지한다.
새 문서에는 폐기 설정을 저장하지 않고, 환경 치수와 생성 기본값은 내부 상수로 처리한다.

`environment-generation.ts`의 공통 순서:

1. 문서 정규화·검증 → 연결 성분·실제 외피·매스 분석 → 주택 부속 차고 분류.
2. 수직 구간 → 원본 기반 rule preflight → 지지·고정 공간·공공 보행.
3. 주차 출입구·차량 동선 → 건물 출입구·보행 → 주차 구획의 최종 증명.
4. 시설 벽·기둥·프레임 선점과 필수 외피 → 독립 시설 → 선택 마감·완성형 면.
5. 면 소유·bounds·예약 검증 → 결과/진단 조립 → 편집 수락과 Viewer.

건물이 0개이거나 도로·주차만 있는 문서도 같은 실행 경로를 쓴다.
단계 상태는 `ready`, `not-applicable`, `not-implemented`, `blocked`를 구분한다.
필요 없는 단계와 미구현 단계는 다르며, 실제 미구현을 성공한 빈 계획으로 대체하지 않는다.

주요 내부 상수는 `environment-settings.ts`의 `ENVIRONMENT`, `PARKING_BUDGET`을 따른다.
단위는 별도 표시가 없으면 셀이다.

| 구분 | 값 |
|---|---|
| 보행 | 최대 경로 거리 24, curb band 1, 몸체 폭 8/16·높이 12/16 |
| 건물 입구 | 최대 4, 외벽 12셀/부피 128셀당 입구 기준, 최소 간격 4 |
| 지상 주차 | 차로 4, 구획 1×2, 보행 띠 1, 도로 연결 최대 4, gate 최대 2·최소 간격 8 |
| 인도 | 표면 높이 2/16, 둘러싸인 섬 최대 24셀, 두 도로 사이 연속 폭 최대 3 |
| 시설 | 휴식/거리 리듬 4, 조명 간격 상수 6, 소화전 8, 식생 반경 3, 도로변 반경 2, 광장 반경 6, 교차부 보호 2 |
| 주차 예산 | 입력 영역당 차로 expansion 1,500,000 / 최종 구획 500,000 / layout trial 128 |

간격 상수는 문맥 리듬에 사용한다. 명시적으로 칠한 조명·시설 칸을 자동 간격 억제로 비우지 않는다.

## 공통 공간과 접근

정수 좌표·면 기저·anchor·해시는 아래 건물의 [좌표·정렬·결정론](#좌표정렬결정론)을 공통으로 사용한다.
숫자 셀 → 등록된 고정 방향 → ASCII ID 동점 순서를 유지한다. 외피를 빈 곳까지 덮는 AABB로 대체하지 않는다.

- `RuleSpatialAdapter`는 정확한 rule ID/version/definition과 adapter reference를 검증한다.
  preflight에는 원본·분석·스타일·metadata만 전달하고 생성 결과나 후속 계획을 읽게 하지 않는다.
  cache hit에서도 실제 출력은 등록 bounds와 envelope 합집합 안에 있어야 한다.
- 예약 우선순위는 solid 1000 → 공공 900 → 차량 800 → 접근 700 → 구획 600 → 안전 500 → 조명 400 → 시설 300 → 부착 200이다.
  batch 예약은 원자적이다. 공유는 공통 예약 규칙과 인증된 crossing만 허용하며 임의 `crossingId`는 권한이 아니다.
- Box16은 1/16셀 정수, min 포함/max 제외다. 실제 본체와 보호 공간을 따로 검사한다.
- 보행은 실제 ground/노출 roof 지지, 몸체·edge sweep, 같은 높이의 연결을 검증한다.
  도로와 가까운 것만으로 접근을 성공 처리하거나 높이 차에 가짜 계단·승강 연결을 만들지 않는다.
  중앙분리대에 공공 도착점을 임의로 추가하지 않는다.
- 모든 일반 건물의 입구는 공통 접근 계획이 확정한다. 입면은 승인된 portal 면을 소비하고 다시 추측하지 않는다.
- 구조면은 정확히 한 소유자를 가진다. 선택 마감·도색은 구조 coverage 소유자가 아니며,
  원본 마스크의 구멍을 렌더링 편의를 위해 채우지 않는다.

`building-plans.ts`는 선점을 준비하고 `building-execution.ts`는 불변 입력·등록 규칙 실행·출력 검증을 담당한다.
`environment-output.ts`와 `environment-presentation.ts`는 확정 결과와 표시 진단만 조립한다.

## 건물 A–D

A=`shop`, B=`office`, C=`urban-shop`, D=`tower11-d`이다.
`building-style.ts`의 현재 `SHOP_STYLE`, `OFFICE_STYLE`, `URBAN_SHOP_STYLE`, `TOWER11_D_STYLE`를 따른다.
컨셉 선택은 외벽 패턴을 바꾸며 사용자 부피를 깎거나 예제의 층수·후퇴 위치를 강제하지 않는다.

### 작은 핵심과 입력 → 출력

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

### 좌표·정렬·결정론

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

### 높이 규칙

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

### 가로 반복·우선순위·옥상

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

### 작은 재현 예

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

### 엔진 어댑터와 갱신 비용

엔진 어댑터는 에셋 조회, 로컬 U/V/normal 배치, 재질, 공유 geometry/재질의 수명,
면당 Mesh 하나 생성·교체, 카메라/선택/Inspector 표시를 맡는다. 현재 구현은
`crafted-geometry.ts`, `viewer.ts`, `facade-finishes.ts`다. Three.js·DOM·Viewer 객체를
규칙 입력에 넣지 않는다. 지원되지 않는 조합은 등록된 fallback/진단을 쓴다.
공간 예약·접근·충돌·외벽 소유는 위의 공통 공간 계약을 함께 적용한다.

규칙 실행은 전체 재평가다. 패턴/모듈 lookup은 실행당 한 번 만들고,
각 후보의 폭 배열 대신 적합도 숫자만 비교한 뒤 승자의 모듈 배열만 만든다.
층별 band/rowRole은 scope마다 한 번 계산한다. 면마다 방향 검색, 앞면 목록 검색,
코너 모듈 검색을 반복하지 않는다. 실행을 넘는 새 규칙 cache는 없으므로 무효화나
영구 메모리 증가가 없다. 복잡도는 외피 F, 최대 높이 H, scope 수 S에 대해 층 선택
`O(S*H+F)`, 가로 배치 `O(F + 행별 정렬)`이며 C의 mass 분석과 공간 계획은 별도다.

환경 실행은 모든 건물 규칙에 `resolveBuildingRule(...).generate(ruleInput)`를 호출한다.
`contextualTemplates`는 역할/방향/옥상/지원 여부별 대표 면의 기본 패널 결정을 건물 실행마다 계산한다.
대표 면의 입력을 검증하고 등록 에셋 포함 여부는 불변 Set으로 검사한다.
모든 면의 선택 trace·소유·출력 bounds도 검증한다.
문서·외피 분석·주차 계획 cache는 FIFO 최대 64개/16MiB 예산을 사용한다.
이 예산은 키·결과·identity의 직렬화 크기 추정치이며 전체 JS heap의 상한은 아니다.
cache 적중·축출 telemetry는 생성 결과와 논리 평가 횟수를 바꾸지 않는다.

Viewer는 직전 화면의 `faceId → Mesh`만 현재 동기화 동안 참조하여 같은 면의 Mesh를 재사용한다.
매번 전체 생성 결과의 geometry 키, 마감 ID, 재질과 표시 원점을 포함한 행렬을 다시 지정한다.
없어진 면의 Mesh는 보관하지 않으며 재사용 표도 동기화가 끝나면 버린다. 따라서 새 Mesh 보관량은
현재 표시 면 수에 한정되고, 여러 편집 이력의 Mesh를 쌓는 캐시는 없다. 공유 geometry/재질은
기존 라이브러리의 수명에 따른다. 이것은 표시 객체 재사용이며 규칙·충돌 검사를 생략하는 부분 생성이 아니다.

높이 변경은 성분 전체의 층 배분을, 연결 성분 변경은 anchor 상속·여러 외벽·주변 접근과
시설 계획을 바꿀 수 있다. 셀 주위 면만 재계산하는 규칙은 도입하지 않았다.
기존 문서·분석·주차 계획 cache와 Viewer의 geometry/배치 재사용은 별도 계층이다.
추가·삭제·Undo/Redo·저장 복원에서도 동일 입력으로 전체 규칙을 평가할 수 있어야 한다.

### 내부 데이터 흐름

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

## 완성형 면 에셋

일반 건물의 벽·지붕·테라스·밑면은 **면 하나 = 실제 `THREE.Mesh` 객체 하나**다. 벽 본체, 프레임, 유리, 옥상 난간, 채택된 띠·상단·코너 마감을 같은 geometry에 포함한다. 자식 Mesh나 면을 묶는 InstancedMesh는 사용하지 않는다. geometry와 material은 같은 에셋끼리 공유한다. 한 객체의 재질 슬롯은 여러 draw call을 사용할 수 있다.

### 선택과 배치

1. 기존 facade 패턴·수직 구간·출입구 계획이 기본 타일과 팔레트를 선택한다. 옥상 난간은 수직 외벽의 기본 에셋에 포함되며 수평 지붕으로 옮기지 않는다.
2. `src/core/facade-trims.ts`가 기존 월드 경계 소유 규칙으로 straight/cut/convex/concave 마감을 선택하고 raw voxel·예약·envelope를 검사한다. 코너는 결정적인 한 호스트 면만 소유한다. 충돌 시 기존과 같이 해당 마감이 없는 고정 변형을 선택하며, 사유를 decision trace에 남긴다.
3. `src/core/complete-face-assets.ts`의 유한한 `FACE_FINISH_PROFILES`에서 완성형 키 `face-v1|<baseAssetKey>|<finishProfile>`를 선택한다. 치수·Grid·배치 행렬은 에셋 선택 계약에 들어가지 않는다. 마감 부품의 임의 좌표, 크기 조정, 잘라내기는 지원하지 않는다.
4. 파생 `Placement.faceAssetKey`는 완성형 에셋을, `finishIds`는 그 면이 소유하는 예약/결정 ID를 가리킨다. 별도 마감 render module은 출력하지 않는다. 예약의 `attachment` 종류와 실행 단계명은 공간 계획의 기존 의미로 유지한다.
5. `src/face-mesh.ts`는 그 키의 geometry와 팔레트 재질로 Mesh 하나를 만들고 면 중심·기저 회전만 적용한다. `userData.faceId`를 통해 유리나 돌출 코너를 눌러도 호스트 면을 선택한다. 선택/분석 오버레이와 독립 시설물은 이 외피 객체 수에 포함하지 않는다.

`faceAssetBounds()`는 완성형 키의 등록된 기본 면/마감 bounds를 합친 local bounds를 반환한다. 공간 검증은 기본 면의 required envelope와 마감의 deferred envelope 및 실제 예약 box들을 각각 사용한다. L자 코너의 전체 AABB를 solid로 예약해 빈 부분까지 막지 않는다. 마감 배치는 호스트와 동일 위치·방향이어야 한다.

### Blender 에셋 교체 지점

`src/crafted-geometry.ts`의 `buildCraftedGeometry(completeKey)`가 프로토타입 공급 경계다. 현재 데모는 고정 카탈로그 규격을 코드로 제작하며, 처음 사용하는 **에셋 키당 한 번** 단일 BufferGeometry로 준비하고 캐시한다. 볼륨이나 배치마다 조각을 합성·변형하지 않는다. 추후 이 경계를 완성형 키 → Blender에서 미리 제작한 단일 Mesh의 geometry 조회로 교체한다. 각 finish profile까지 포함한 완성형 모델이 필요하다. 런타임에 Blender 벽에 별도 마감을 덧붙이는 계약이 아니다.

- 로컬 좌표: 면 중심 pivot, U/V 범위 기본 ±0.5, +N 바깥쪽. 1셀 = 1단위, Box16은 1/16 단위다.
- 재질 슬롯: `0` 본체, `1` 프레임·필수 마감·난간, `2` 유리, `3` 독립 금속 accent(`FACE_MATERIAL_SLOTS`). 모든 삼각형은 한 슬롯에 속한다.
- 연결 창문의 좌우 경계, 출입구 aperture, 마감 끝점, 옥상 난간 높이와 등록된 bounds를 유지한다. 내보낸 실제 geometry의 bounds도 같은 검증을 통과해야 한다.
- 원본 문서에는 기존 타일/스타일/입력만 저장한다. 완성형 키와 마감 소유는 재생성하므로 기존 schema/catalog 버전을 바꾸지 않는다. Inspector에는 기본 타일과 완성형 키를 함께 표시한다.

현재 수평 roof/paving/soffit은 기존 단일 평면 형태를 유지한다. 개방형 주차장 건물의 슬래브·기둥, 도로·지상 주차장·식생·독립 시설물은 기존 경로를 유지한다. 등록 카탈로그 밖의 임의 코너 형상과 A~D 완성형 면의 Blender 파일 제작·임포터는 지원 범위 밖이다. C의 등록된 45도 외장 절삭은 위 건물 규칙을 따른다.

## Blender 집과 부속 차고

`residential-cream/red/brick/garage`는 `standard-contextual` 실행에서 별도의 순수 데이터 조립 경로를 사용한다. A~D 카탈로그와 baseline 출력은 변경하지 않는다. 집은 완성형 면 geometry 키 대신 `ScenePlacement`의 `house-kit:SM_…` 에셋과 `faceIds`로 구조 소유권을 기록한다. 일반 면 배치와 모듈의 소유 면을 합쳐 외피마다 정확히 한 소유자를 검사한다. 장식은 빈 `faceIds`를 가진다. 다른 성분의 면, 중복·누락된 면, 계획하지 않은 일반 출입문은 출력 검증에서 거부한다. Viewer의 인스턴스 배치는 공유 geometry/재질을 사용하며, 선택은 해당 인스턴스의 실제 소유 면을 따른다.

`src/assets/residential/kit.json`의 `assets`는 원본 피벗을 유지한 보수적인 Box16, 메시 출처·삼각형 수·설명이고, `examples`는 관측한 여섯 조립의 점유 셀과 모듈 transform이다. `meshes.json`의 `position/normal/uv`는 삼각형 순서로 풀어 쓴 실제 Blender 데이터다. Blender 미터 좌표 `(x,y,z)`는 `(x,z,-y)/3`으로 변환한다. yaw는 Y축 90도 단위이며 원본 스케일은 `[sx,sz,sy]`로 옮긴다. 피벗을 임의로 bounds 중심으로 이동하지 않는다. BaseColor는 sRGB, Normal/ORM은 선형이고 ORM의 R/G/B는 AO/roughness/metalness다. PNG는 원본의 패킹된 512px 아틀라스 바이트를 보존한다.

예제 셀 집합과 모듈 피벗에 네 방향 회전을 미리 적용한다. Y축 90° 회전에서 셀 최소 좌표는 `(x,y,z) → (z,y,-x-1)`, 점 피벗은 `(x,y,z) → (z,y,-x)`다. 각 회전의 셀 최소 좌표를 빼 정규화하고 yaw에 회전 수를 더한다. `matchingHouse`는 현재 부피의 평행 이동·네 방향 회전을 예제와 비교하므로 방향만 바꿔도 자유 부피 fallback으로 떨어지지 않는다.

`planResidential`은 네 회전의 정규화된 셀 서명 중 문자열 순서가 가장 작은 기준 프레임을 선택한다(동점은 첫 회전). 외피 셀·방향·문 계획의 faceId를 같은 프레임으로 옮기고 셀의 숫자 순서/방향 문자열 순서로 처리한 뒤, 실제 메시 피벗·yaw·소유 faceId를 월드 좌표로 복원한다. 이 기준에서 예제 부피는 교차·모임 지붕 패턴을 사용하고, 다른 부피는 현재 외벽과 같은 높이의 노출 상면에 2셀 이하 박공 띠를 조립한다. 자유 부피의 지붕 분할도 월드 X축에 고정되지 않는다. 차고 자유 부피는 평지붕이다. 없는 셀이나 높은 매스로 덮인 셀 위에 지붕을 추가하지 않는다. 완전히 대칭인 부피는 셀만으로 의도한 정면을 구별할 수 없어 기준 프레임 동점 규칙과 공통 접근 계획을 따른다. 임의 부피의 모든 골짜기·교차 연결을 추론하지 않는다. 비다양체 외벽은 해당 면만 솔리드 원본 모듈로 바꾼다.

관측한 조립 데이터는 그대로 보존하지만, `isResidentialEnvelopeAsset`의 허용 목록에 있는 벽·창/문·차고 외피·박공/다락창·지붕 연결재·처마·입면/지붕 마감만 실행한다. 예제의 베란다·계단·차양·굴뚝/플래싱·배수관·카포트·정원·차량은 생성하지 않는다. 계획된 출입문에도 발판·조명을 자동 추가하지 않는다. 선택적 부속물을 원본 부피가 요구한 구조나 오브젝트 입력으로 취급하지 않으며, 해당 부속물의 공간을 예약하지 않는다. 오브젝트 입력의 기존 시설·식생 계획은 유지한다.

사전 공간 계획은 필수 외피와 지상 각 면의 잠재 출입문에 대한 실제 에셋 bounds를 포함한다. 집의 최대 구조 halo 제한은 2셀이고 A~D는 기존 1셀이지만, 실제 예약에는 생성하는 필수 외피 bounds만 포함한다. 출입문은 접근 계획에서 확정한 면에만 배치하며, 회전한 원본 문 위치를 우선하되 실제 지지·충돌·도로 접근 검사를 통과해야 한다. 원본 주택 문은 폭 .75m/높이 1.875m의 고정 통과 몸체를 수용하고, 외부 경로·landing 예약은 공통의 더 큰 1.5m/2.25m 검사로 보수적으로 증명한다. 실내, 차량의 차고 진입, 문 애니메이션은 제공하지 않는다. 지상 접근이 막힌 원본 문은 다른 유효한 면으로 바뀔 수 있다.

집 자료는 런타임에 Blender/Art 프로젝트에 의존하지 않는다. 네이티브 대상은 동일 JSON/PNG를 읽고 조립 계산을 대상 언어로 구현해야 한다. 기존 `port:export`의 214개 A~D fixture·419종 완성형 면 번들에 집 자료를 포함했다고 간주하지 않는다. 재추출은 연결된 Blender에서 `tools/blender/export_residential.py`를 실행한다. 문서 내용 대신 exporter·고정 데이터·`residential.test.ts`와 `e2e/residential.spec.ts`가 재현 경로다.

### 주차 입력으로 붙이는 차고

`attached-garages.ts`는 저장한 주차 마스크를 바꾸지 않고 연결 성분별로 분류한다. 주택 컨셉(별도 차고 컨셉 제외)의 정상 지상 외벽과 접한, 면적 2칸 이상·축별 최대 4칸의 완전한 직사각형이며, 한 외벽 변의 전체 길이가 같은 집에 붙어야 한다. 여러 집에 닿거나 건물·도로·오브젝트와 겹친 입력, 막힌 입구, 출입 방향 깊이 2칸 미만은 차고로 채택하지 않는다. 큰/비정형/분리된 영역은 원래 지상 주차 계산을 사용한다. 같은 주차 입력에 떨어진 차고 성분과 일반 주차 성분이 함께 있어도 원본 area ID와 anchor는 유지한다.

차고는 `AttachedGaragePlan`의 주차 `areaId`가 소유한다. 도로가 전방 8칸 이내의 같은 출입 행에 있으면 가까운 방향을 우선하고, 그렇지 않으면 원본 집의 정면/스타일 순서를 따른다. 원본 메시로 높이 1셀의 평지붕·슬래브·외벽·차고 문을 만든다. 집과 맞닿는 면에는 차고 벽을 중복 생성하지 않고, `coveredWallFaces`로 집의 해당 1층 외벽을 솔리드 모듈로 바꾼다. 집의 원본 Grid·design·Surface ID는 유지한다.

차고의 실제 Box16과 1층 점유 부피는 호스트 집의 preflight solid 합집합에 포함한다. 같은 합성 solid의 sourceRefs에 주차 입력을 추가해 출입구·시설·다른 주차장에 실제 장애물로 전달한다. 채택된 차고 성분은 내부 지상 주차 계산용 마스크에서만 제외한다. `environment.attachedGarages`와 조건부 `garages` 단계·선택 trace·주차 소유 ScenePlacement를 별도로 출력한다. 차고만 있는 문서의 일반 parkingCirculation/parkingStalls 단계는 not-applicable이며, 빈 차량 계획을 성공한 증명으로 대신하지 않는다.

`access: road-facing | local`은 정면 도로의 관측이고 차량 경로 증명이 아니다. `vehicleProof: not-verified`를 유지하고, 기존 ParkingStall·왕복 경로·품질 지표에 차고를 합산하지 않는다. 주차 마스크 삭제/형태 변경/집 철거에 따라 조립과 공유 벽을 다시 계산한다. 재현 검사는 `attached-garages.test.ts`와 `e2e/attached-garages.spec.ts`에 있다.

## 도로

도로는 게임용 셀 마스크의 분석·표시 규칙이다. 원본 프로그램의 내부 알고리즘이나 법규를 복원한 것이 아니다.

### 원본 입력과 형태

입력은 SceneInputs 3의 Y=0 정수 도로 셀 마스크다. 이전 SceneInputs 2 입력도 호환 경로로 읽는다. 건물 점유와 도로의 입력 충돌, 마지막 입력 소유, Undo/Redo·JSON 계약은 유지한다.

[roads.ts](../src/core/roads.ts)의 `analyzeRoads`는 다음 순서를 따른다.

1. 각 Z행의 연속 X구간과 각 X열의 연속 Z구간을 찾고, 같은 구간이 이어지는 행/열을 묶는다. 가로로 긴 띠는 X 진행, 세로로 긴 띠는 Z 진행의 후보가 된다.
2. 실제로 두 축으로 뻗는 후보 띠의 겹침을 코너/교차부로 정의한다. 바깥으로 이어지는 방향이 2개면 ㄱ자, 3개면 T자, 4개면 십자다. 모듈을 잘라 놓은 내부 선은 이 판정에 쓰지 않는다.
3. 남은 셀을 진행 축과 동일 단면별로 묶는다. 이후에만 폭 단위 길이로 표시 모듈을 분할하며, 마지막 구간 길이가 짧아도 폭과 축을 유지한다. 폭4×길이6은 폭4 모듈로 유지되고 폭2 코너 두 개가 되지 않는다.
4. 각 모듈 변에서 실제 이웃 셀이 있는 부분을 `portSpans`, 없는 부분을 `boundarySpans`로 기록한다. 구간은 절대 횡단 좌표의 `[start,end)`이며 port에는 연결된 이웃 모듈 ID가 있다. 기존 `ports` 방향 배열과 `road:x,z` ID 형식은 유지한다.
5. 진행 축 옆 접촉/부분 폭 접속은 `transition`으로 표시하며, 완전한 교차로로 승격하지 않는다. 모든 셀은 정확히 한 모듈에 속한다. 구멍이나 오목부를 메우지 않는다.

숫자 좌표 정렬과 고정 방향 순서 east/west/north/south를 사용한다. 단독 정사각형 패치처럼 진행 방향이 없는 경우 Z를 명시적 동점 기본값으로 쓴다. 임의 마스크에서 실제 도로 사용 의도까지 알아내는 하중/교통 solver는 아니다. 시설·주차 keepout은 동일한 `isRoadJunction` 판정과 같은 실행의 모듈 자료를 사용한다. 기존 입력 기반 보행/차량 proof는 바꾸지 않는다.

### 표시 정책

- 폭2 이상 직선은 중앙 이중 황색선, 폭4 이상은 추가 백색 차선 점선을 사용한다. 폭1은 과밀 표시를 생략한다. `width`는 입력 셀 단면 폭이며 실제 미터 또는 법적 차로 수를 증명하지 않는다.
- ㄱ자/T자/십자의 중앙 면은 비워 둔다. 횡단보도는 폭2 이상 실제 연결 입구의 접근 도로에만 놓는다. T자는 3방향, ㄱ자는 2방향이다.
- 횡단보도 줄무늬 중심은 교차부 경계에서 바깥으로 0.3셀, 정지선은 0.7셀이다. 작은 황색 끝 표시도 도로 마스크 안에 둔다. 차선은 이 접근 표시 영역 앞에서 끝난다.
- 표시 전체가 원본 도로 안에 들어갈 때만 사용한다. 다른 교차부 중앙에 침범하거나 짧은 연결에서 반대쪽 횡단보도 영역과 겹치면 해당 횡단보도/정지선 묶음을 생략한다. 순서에 따른 임의 승자는 없다.
- 외곽선은 실제 노출 변에만 그린다. 한 칸 notch나 부분 접속에서도 필요한 경계를 남기고 내부 분할선에 테두리를 만들지 않는다.
- 표시는 기존 ScenePlacement의 road box 에셋 경로로 출력한다. core는 Three.js/DOM에 의존하지 않는다. 시각적 횡단보도는 보행/차량 예약의 crossing 인증과 별개다.

## 지상 주차

지상 마스크에서 실제 고정 장애물·도로·예약을 제외한 공간만 사용한다.

### 생성과 선택

1. 도로와 solid를 제외한 실제 셀에서 폭 4칸 차로의 연속 구간을 찾는다. 부지 단면이 달라지는 곳에서도 구간을 나누어 ㄱ자 날개의 독립 배치를 만들 수 있게 한다.
2. 각 구간 양쪽에 깊이 2칸 구획과 뒤쪽 보행 접근이 들어가는지 검사한다. 한쪽만 가능한 좁은 구간은 한쪽 주차열을 만든다. 서로의 차로·구획·보행 공간을 침범하지 않는 주차열들을 조합한다. 정형 부지를 위한 반복 띠 후보도 함께 비교한다.
3. 도로 출입 후보를 첫 4개로 제한하지 않으며, 가장자리 안쪽과 서로 떨어진 위치부터 시험한다. 임의의 다른 도로 접점으로 출입하는 연결은 금지한다.
4. 출입구와 차로 구간을 차량 회전 sweep으로 연결한다. 도달하지 못하는 구획은 진입·출차 증명에서 탈락한다. 부지 밖은 차량 공간으로 확장하지 않는다.
5. 보행·차량 공간의 교차는 기존 직사각형 crossing 인증을 통과해야 한다. 선택적인 내부 보행 띠를 연결 차로가 끊으면 해당 부분을 제거하고 보행 접근을 다시 검사한다. 기존 공용 보행 예약은 제거할 수 없다.
6. 각 후보에 **최종 구획과 동일한 진입·출차·보행 검증**을 적용하고 실제 통과 대수로 선택한다. 후보 구획 수는 가지치기 상한으로만 사용한다. 시험 비용은 차로 탐색 예산에 청구하여 최종 구획 검증 예산을 보존한다.
7. 두 번째 출입구는 같은 도로변에도 가능하다. 실제 주차 대수를 늘리거나, 대수를 유지하면서 출차 전이를 4전이 이상 줄일 때만 채택한다. 최대 2개이며 모든 추가 시도는 같은 부모 예산을 사용한다.
8. 건물 출입 계획을 반영한 뒤 구획을 최종 검증한다. 남은 열 끝 공간에만 조경 섬을 예약한다. 차로·보행·구획·건물 출입과 겹치는 섬은 생성하지 않는다.

계산은 [parking-layout.ts](../src/core/parking-layout.ts), [parking-circulation.ts](../src/core/parking-circulation.ts), [parking-stalls.ts](../src/core/parking-stalls.ts)에서 수행한다. Three.js 없이 실행되는 core 구조를 유지한다.

### 보행, 표시와 결과 계약

- 폭 6칸처럼 내부에 별도 보행 띠까지 넣기 어려운 경우, 바로 뒤의 **실제 비어 있는 지면**을 보행 공간으로 사용할 수 있다. `SpatialAnalysis.walkNodes`와 예약 충돌·연결 검증을 통과해야 하며 다른 주차 영역이나 solid를 통과할 수 없다. 이 외곽 보행 포장은 결과에 표시되지만 원본 주차 마스크에 셀을 추가하지 않는다.
- 다른 구획을 비워 둔다고 가정하지 않는다. 차량 경로는 도로·확정 차로·자기 구획 두 셀만 사용한다. 보행 검증도 다른 주차 셀을 임의의 통로로 쓰지 않도록 제한한다.
- 차로는 어두운 포장, 보행 공간은 밝은 포장으로 표시한다. 승인 구획의 U자 경계선, 인증된 횡단보도, 출입 및 양방향 차로 화살표, 둥근 경계석의 낮은 조경 섬을 표시한다.
- `layoutId`는 선택된 배치 후보를 식별한다. `axis`는 주 방향이며, 혼합 배치의 실제 각 열 방향은 구획의 `heading`을 따른다. 혼합 배치의 `periodCells`는 0이다.
- `search`에 출입 후보 수, 생성된 배치 조합 수, 평가·가지치기·미시도 수와 검증 대수를 기록한다. `complete`는 **생성한 후보 집합**에 대한 완료 여부이지 전역 최적성 증명이 아니다. 예산 미배정도 완료로 표시하지 않는다.
- 탐색 단계의 `search.provenStalls`는 이후 건물 출입 예약에 의해 최종 대수보다 클 수 있다. 사용자 요약은 최종 `quality.acceptedStalls`를 사용한다.
- `ParkingPlan.islands`와 `quality.islandCells`에 조경 섬을 기록한다. 면적 합계는 `차로 + 보행 전용 + 구획 + 조경 섬 + 미배정 = 유효 셀`이다.
- 기존 `untestedStalls`는 선택된 구획 집합에 관한 값이다. 사용자 요약은 이를 전체 탐색 완료처럼 표시하지 않고, 0대인 경우와 탐색 한도를 명시한다.

### 차량 모델과 예산

`vehicle-motion.ts`의 `grid-car-v1`은 rear+heading의 폭 1×길이 2 footprint,
전후진, 전체 4×4 정수 회전 sweep과 정확한 역전이를 사용한다.
차로 Dijkstra cost는 `10+4×새 차로 셀 수`이며 decrease-key와 고정 이웃 순서를 유지한다.
차량 경로의 시작은 gate 앞 `roadStates`다. 도시 전체의 출발지부터 실제 주행을 증명하지 않는다.

`parking-budget-v1`은 부모 입력 영역당 차로 1,500,000·구획 500,000·시도 128을 공유한다.
`U_i=12*N_i+32*floor(P_i/2)`의 구획 상태 상한을 먼저 보호한 뒤 성분별로 예산을 나눈다
(정의와 배분은 `parking-budget.ts`; `N_i`는 stateCellBound, `P_i`는 eligibleCells다). cache는 논리 비용을 동일하게 재현하고 실제 작업·시간은 별도 telemetry다.
구획 검증은 base graph 1회/BFS 2회와 후보별 추가 상태 16 이하를 사용한다.

개방형 주차 **건물 규칙**(`parking-rule.ts`)은 데크·기둥·주차 줄의 외형 프로토타입이다.
원본 셀 전체를 solid로 예약하며 지상 `ParkingStall` 계획과 연결되지 않는다.
줄 수를 검증 대수로 해석하지 않는다. 상층 경사로·층간 주행·연속 차량 운동학·실제 교통 법규 검증은 지원하지 않는다.

## 인도·식생·시설과 관계

`scene-relations.ts`의 `SupportIndex`는 실제 외피와 설치 열을,
`SceneRelationIndex`는 공간 경계·도로 모듈·port·도착점을 연결한다.
시설·식생·Inspector는 같은 실행의 관계를 공유한다.
관계·`sourceRefs`·`readDependencies`는 읽기 전용 파생 설명이며 저장 문서나 증분 스케줄러가 아니다.

### 지지와 식생

호환 오브젝트 fragment의 연속 수직 열은 같은 설치 지지·높이를 사용한다.
지지를 잃은 열만 생성에서 제외하고 원본 입력·진단을 남긴다.
유효 식생은 실제 원본 셀 전체를 solid 1000으로 예약하고 외접 박스로 빈 곳을 메우지 않는다.
수관 메시와 보수적인 점유 셀의 모양이 달라도 충돌 예약을 임의로 약화하지 않는다.

### 조명과 일반 시설

각 명시 칸은 독립 슬롯이다. 대표 슬롯 재선택·자동 간격 억제로 다른 칸을 비우지 않는다.
시설 종류(`contextual-fixtures` 2.0.0)는 외부 문맥과 절대 좌표를 사용하고,
칠한 이웃 칸·입력 범위는 종류 결정에 사용하지 않는다. 문맥 family 우선순위는
외벽/조명 → 주차 구역 → 옥상 → 중앙분리대 → 식생 인근 → 도로변 → 광장 → 인접 벽 설비 → 기본 설비다.

| 문맥 | 종류/배치 기준 |
|---|---|
| 조명 | 지상/옥상 칠한 열마다 lamp, 외벽은 wall-lamp. 도로 방향(없으면 0)·고정 후보 순서 사용 |
| 주차 gate | 개구부 옆 raised-barrier-post, 그 뒤 pay-station |
| 주차 열 끝 / 중앙분리대 | safety-bollard; 주차 경계/내부 일반 시설은 lamp |
| 옥상 높이 1 | air-conditioner; 같은 높이 건물 셀이 이웃하면 벽을 등진 roof-vent |
| 옥상 높이 2 / 3 / 4 이상 | water-tank / lattice-tower / antenna-mast |
| 식생 인근 | 절대 접선 좌표 리듬의 휴식 시설 |
| 도로 2칸 이내 | 벤치·벤치·휴지통·자전거 거치대 리듬, 연석 줄 8칸마다 소화전 |
| 도로 6칸 이내 광장 | 화분·벤치·휴지통 격자 |
| 도로가 먼 건물 벽 앞 / 그 밖 | 벽을 등진 설비함·실외기 리듬 / 설비함 |

리듬 위상은 도로/식생/벽 방향의 접선 좌표 + `h33(seed,'fixtures-v2|rhythm')`다.
광장은 `positiveMod(x+3*z+rhythmPhase, PLAZA_LATTICE.length)`를 쓴다.
정확한 family·리듬·후보 순서는 `fixture-plan.ts`, 실제 본체/보호 bounds는 `fixture-catalog.ts`를 따른다.
빈 패턴 칸은 없다. 본체·보호 예약 때문에 불가능할 때만 다음 후보를 선택하고,
전체 배치 뒤 사용/유지보수 접근을 검사한다. 도로 근접성을 접근 성공으로 사용하지 않는다.
시설·주차 keepout은 같은 실행의 공통 도로 교차부 판정을 사용한다.

### 외벽 시설

자동 종류는 호환되는 연속 열로 판별한다. 높이 1은 Y=0이면 `awning`, 아니면 `balcony`다.
높이 2 이상은 지면 도달 시 `elevator`, 그렇지 않으면 `fire-escape`다.
기존 JSON의 명시 종류가 우선하며 원본 fragment별 예약 승인/거절은 원자적이다.
계단·엘리베이터 외형은 실제 수직 이동을 증명하지 않는다.

### 인도와 교통섬

`sidewalks.ts`의 입력은 SceneInputs 3의 Y=0 마스크다. 도로와 겹칠 수 없고,
편집에서는 나중에 칠한 도로/인도가 해당 칸을 소유한다. 건물·주차·오브젝트와는 공존할 수 있다.
건물·주차 아래 인도 포장은 숨기고 원본은 보존한다. 표시 높이는 2/16이며 도로 쪽 변에 연석을 둔다.

4방향 연결 성분마다 `roadEdges`/`openEdges`/도로 방향을 센다.
건물(Y=0)·주차 마스크가 덮은 성분은 `COVERED_BY_BUILDING_OR_PARKING` 일반 인도다.
덮이지 않은 성분은 다음 중 하나일 때 교통섬이다.

- open 변 0이고 24셀 이하: `ENCLOSED_BY_ROADS`.
- ±X 또는 ±Z 양쪽에 도로가 있고 그 축의 최장 연속 길이 3셀 이하: `BETWEEN_ROADS`.

섬은 연석 테두리·화단으로 표시하고 그 위 지상 오브젝트는 median 문맥을 사용한다.
섬 위 safety-bollard는 교차부 keepout에서 제외한다.
표시 전용 `surfaceOffset=surfaceTop16/16`은 덮이지 않은 인도 셀의 지상 오브젝트에만 붙인다.
center·bounds·예약은 바꾸지 않고 인도는 접근 그래프·출입구·주차 증명을 바꾸지 않는다.
판정 근거는 Inspector의 `sidewalk-landscape` 추적에서 확인한다.

## 편집·실패·검증 경계

입력 선택과 표시 설정은 생성 입력을 구분한다. 카메라·표시 지면·분석 overlay·표시 원점은
원본 좌표·예약·접근 계획을 바꾸지 않는다. 인도 표면 오프셋도 표시에서만 적용한다.

부피·도로·오브젝트·주차 편집 뒤 전체 규칙을 재평가한다.
성분 분리/병합은 이전 성분 부피와 숫자 좌표 동점 순서로 design/anchor를 상속한다.
주차 마스크 합집합/차집합도 area ID와 보존 anchor를 유지한다.
같은 완전한 입력(컨셉·seed·anchor·명시 설정 포함)은 같은 결과를 내야 한다.
최종 grid만 같고 상속 anchor가 다르면 같은 입력으로 보지 않는다.

높이 변화는 scope 전체의 층 배분, 성분 연결은 여러 외벽·주변 접근, 도로 단절은 먼 경로의 소비자까지 바꿀 수 있다.
인접 한 칸만 재계산하는 부분 생성은 지원하지 않는다. `readDependencies`는 파생 설명이며 증분 스케줄러가 아니다.
실행 내 인덱스·제한 FIFO 캐시·Viewer Mesh 재사용은 전체 규칙 검증을 생략할 근거가 아니다.

정상 생성 실패(공간 부족·도로 없음·지지 상실·선택 마감 탈락)는 원본 의도와 이유를 남기고 가능한 나머지 결과를 유지한다.
접근 상태는 `public`, `local-only`, `service-unverified`를 구분한다. 모든 시설 본체를 배치한 뒤 접근을 다시 검사한다.
유지보수 경로를 확보하지 못했다고 명시 슬롯을 임의로 옮기지 않는다.
문서/버전 오류·envelope 이탈·필수 소유 중복·무권한 crossing·필수 단계 미구현 같은 계약 오류는
편집의 마지막 수락 문서·화면·이력을 유지한다.

비다양체 모서리/꼭짓점은 직접 닿은 면만 기본 패널로 낮추고 `DEGRADED`와 진단을 유지한다.
정상 이웃 면의 스타일·입구를 보존하며 원본 부피를 자동 수정하지 않는다.
설치 지지와 이동 지지는 하중 증명과 다르다. 실내·시설 승강/계단 이동·상층 주차 연결·지형·구조 하중 해석은 지원 범위 밖이다.

### 검증과 참조 자료

- 변경한 공유 규칙은 `npm run verify`로 타입·단위 테스트·빌드를 검증한다.
  편집/Viewer 변화가 있을 때 해당 브라우저 사례를 확인한다. 전체 검사를 매번 반복하지 않는다.
- 건물 출력/geometry 검사: `tests/concept-preservation.test.ts`, 면 소유/형상: `tests/complete-faces.test.ts`.
  네이티브 참조 번들의 범위와 비교 절차는 [이식 절차](NATIVE_PORTING.md#참조-자료-생성)를 따른다.
- 도로 회귀: `tests/road-topology.test.ts`, `e2e/road-topology.spec.ts`.
  3×3 마스크 511개의 셀 소유·port·노출 경계·표시 bounds 검사는 사용자의 모든 도로 의도 추정 증명이 아니다.
- 주차 회귀: `tests/parking-layout-v2.test.ts`, `e2e/parking-layout-v2.spec.ts`와 기존 차로·구획·예산 검사.
- 관계/시설: `tests/scene-relations.test.ts`, `e2e/scene-relations.spec.ts`.
- 검사·측정 명령과 시간의 해석은 [검증·측정 안내](../benchmarks/README.md)를 따른다.

## 영상 연구의 제안 ID

아래 R01–R10은 2026-09-25 영상 연구의 가설·시나리오를 연결하는 ID다.
현재 실행 정책은 위 본문을 따른다. 원본 Miniopolis의 내부 구현이나 모든 제안의 완료를 뜻하지 않는다.
관찰 O01–O15, 미확정 H01–H10, 분석 당시 C01–C12, 제안 검증 T01–T16은 [참조 연구](VIDEO_RULE_STUDY.md)에 있다.

| ID | 설계 원칙 / 현재 적용 경계 |
|---|---|
| R01 | 의도 정규화·원본/anchor 보존·원자적 편집 수락 |
| R02 | 실제 외피·구멍·지지·덮임 관계; 비다양체 면만 보수적 fallback |
| R03 | A/B/D 전체 높이와 C 지역 scope, 선점·물리 run·anchor 기반 반복 |
| R04 | 실제 경계의 단일 마감 소유; 물가 난간은 지형 입력 없는 현재 범위 밖 |
| R05 | 도로 점유·경계·교차부 공통 문맥; 정적 신호등 후보는 미채택 제안이며 교통 시뮬레이션 없음 |
| R06 | 검증된 portal·landing·접근 경로를 외벽이 소비; 높이 차에 가짜 연결 금지 |
| R07 | 외형 주차 건물과 지상 구획 proof 분리; 빈 구획 가정/상층 이동 성공 금지 |
| R08 | 명시 칸·지지·열 높이·외부 문맥으로 시설/식생 해석; 원본 영상의 정확한 수식은 미확정 |
| R09 | 같은 완전한 입력의 결정론·전체 재평가; 의존 변화에 따른 합법적 전파 |
| R10 | 확정 의미 결과와 엔진 표시 분리; 새 날씨/물/후처리는 연구 제안의 핵심 범위 밖 |
