# Issue #29 — 도시형 수직 프로그램과 입면 Prototype

대상 이슈: [#29](https://github.com/Dev-Mons/game-algorithm-lab/issues/29). 구현은 ① → ② → ③ → ④ 순서로 진행하며, 각 단계에서 실제 생성과 해당 회귀를 통과한 뒤 다음 단계를 연결했다. 원래 `shop`/`office` 프리셋은 보존한다. 새 `urban-shop`/`urban-office` 스타일을 선택하면 모든 기능이 같은 문서 실행 경로에서 동작한다.

## 사용

- 건축 스타일에서 도시형 복합 상가 또는 도시형 업무를 선택한다. Voxel 한 행을 논리층 하나로 본다.
- 건물 선택 후 디자인 Seed, 수직 프로그램, bay family, 재료를 지정할 수 있다. 빈 override는 보존 Seed에서 선택한다. 전역 Seed 변경은 각 건물의 designSeed도 갱신한다.
- 오브젝트 설치 → 시설 → 발코니/외부 계단/엘리베이터를 선택하고 외벽 영역을 지정한다. 깊이 1셀의 직사각형 U/V 영역을 지원한다. 옆면의 인접 영역을 추가하거나 제거하면 종류와 외벽 변경 의도를 보존하며 조립을 다시 계획한다.
- 시설의 외벽 솔리드 변경은 선택 사항이다. 단순 부착은 기본 패턴을 유지한다. 선택된 시설은 모두 표시용이며 상층 portal이나 이동 경로를 만들지 않는다.
- 세로 기둥은 건물별로 자동/일반 건물 유지/명시적 기둥 표시를 고를 수 있다. 자동은 슬래브 접합이 있는 후보만 선택한다. 고립된 1×1 건물은 모호성 진단과 함께 일반 건물로 남긴다.
- Inspector의 분석·계획에서 프로그램, 매스 DAG, Zone의 실제 faceId 마스크, FacadePlan의 축약/예산 사유, 시설 승인과 기둥 판정을 확인한다.

## ① 수직 프로그램과 디자인 프로필

`architectural-program.ts`는 임의 구간 ID를 처리한다. 필수 최소 → 선택 최소(우선순위) → 선호 높이 → 반복 잔여의 순서로 정수 층을 배분한다. 필수 최소가 불가능하면 Style의 명시적 fallback 하나를 적용한다. 구간은 ground/repeat/upper 적용 범위, 최소 성립 높이, min/preferred/max, 우선순위를 가진다. 실제 용도를 점유에서 추론하지 않는다.

`design-profile.ts`는 designSeed와 보존 anchor, Style ID, 결정 항목 이름으로 프로그램·2/3/4칸 bay family·재료를 선택한다. 순차 RNG, region/component 최소 셀, run 길이를 선택 입력으로 쓰지 않는다. 수직/수평 강조는 bay의 창/기둥 구성으로 반영한다. 저층 큰 개구, 반복 오피스, 작은 상층 개구, 설비 루버는 실제 geometry가 다르다. 디자인 조합은 현재 두 프로그램과 세 family의 유한한 프로토타입이다.

`BuildingDesignV1`의 추가 의도(designSeed, overrides, columnMode)는 기존 부피 우선 merge/split 상속을 따른다. 현재 문서는 schema 5 / SceneInputs 2 / catalog 4다. Catalog 2/3을 각 버전의 정확한 메타데이터로 검증한 뒤 4로 읽는다. 저장된 legacy Style과 Seed 필드가 없던 design은 그대로 보존한다. 파생 계획은 저장하지 않는다.

검증: 높이 1~32 × 두 도시형 Style × 두 Seed = 128개 전체 생성. 층 누락/중복, 외피 소유, 실제 geometry, 임의 구간 ID, 축약, 저장·복원, 입력 순서, cache, root 변경, merge/split, Undo/Redo를 검사했다. 단계 당시 `verify` 175개 테스트와 양쪽 Style 브라우저 렌더링을 통과했다.

## ② 매스 관계와 정확한 Zone

`mass-relations.ts`는 각 높이의 2D 연결 영역과 인접 높이의 실제 겹침을 연결한다. 재합류 가능한 DAG에 persist/shrink/expand/reshape/split/merge 이벤트와 지속 span을 기록한다. 의미 판정은 Style의 minArea/minWidth/minPersistence/changePermille로 구분한다. 모든 셀에 대해 바로 위 셀을 한 번 조회한다. 현재 기본 임계값은 면적 4, 폭 2, 지속 2층, 변화 150‰이며 실험의 정책 비교 표를 함께 기록한다.

하늘에 노출되는 로컬 상단 plateau의 실제 X/Z 마스크로 프로그램 적용 범위를 정하고, 최종 Zone은 매스 × 구간 × SurfaceRegion의 실제 faceId 목록이다. 각 외벽은 정확히 하나의 Zone에 속한다. 작은 plateau는 전체 건물 프로그램에 남으며 `local-cap`은 별도로 유지한다. 지상 구간은 실제 지상에서만 배정하고 Tower 시작점에는 다시 만들지 않는다.

검증: 직육면체, 복수 Tower, 낮은 별동, 계단형 Setback, 열린/닫힌 중정, 밀폐 공동, 분기 후 재합류, 한 칸 홈. ② 단계의 관련 31개 회귀와 Tower/별동/Setback의 브라우저 출력을 통과했다. 한 칸 홈에서 의미 이벤트 증가와 반대쪽 벽 변경이 없음을 확인했다.

한계: 매스의 건축적 역할은 의도 기반 휴리스틱이다. 안정적인 매스별 Seed 승계는 도입하지 않았고 모든 매스가 건물 프로필을 공유한다. 매우 좁은/작은 상단에는 별도 상층 구간 대신 일반 구간과 로컬 cap을 적용한다.

## ③ 다층 FacadePlan과 접합

`facade-plan.ts`는 기존 1D run 배치 앞에 공통 U/V 기준점을 둔다. 기본은 보존 anchor 기준 absolute 위상이며 Style이 `restart`를 선택하면 해당 Zone 안에서만 재시작한다. 완전한 실제 면 마스크, 동일 Zone, portal/승인된 외벽 변경/기둥의 고정 제약을 검사한다. 없는 면, 다른 평면, 다른 Zone, 옥상 난간을 넘어 프레임을 연결하지 않는다.

프레임은 4방향 경계 bit의 16개 고정 에셋으로 공급한다. 면마다 완성형 Mesh 하나, 유한한 키별 geometry 공유를 유지한다. 열린 U/V port는 같은 완전 그룹의 실제 이웃과 맞아야 한다. 그룹이 끊기면 그룹 전체를 기존 완전 연결창/단독 패턴으로 축약한다. 최소 크기 미달, 불완전 마스크, 고정 제약, 예산 초과를 각각 기록한다. 기본 후보 예산은 건물당 4,096개이며 탐색/전파/WFC는 사용하지 않는다. 중앙 대칭 정책과 최적화 탐색은 아직 없다.

검증: 주기 2/3/4, 음수 anchor, 기존 authored-start, 짧은 벽, 실제 프레임 rail의 가로/세로 geometry 접합, 삭제, 고정 제약, 예산 초과, cache/전체 재계산 동등성. 단계 당시 관련 35개 회귀 및 브라우저 프레임/삭제 출력을 통과했다. 지정한 한 칸 삭제에서 기존 면 5개만 에셋이 바뀌고 보정 범위 밖 변경은 0이었다. 이는 해당 실험의 결과이며 모든 의미 경계 변경에 대한 보장은 아니다.

## ④ 시설과 기둥 연계

`wall-facilities.ts`는 원본 외피/Zone에서 부착 가능 면을 구하고 공통 출입구·보행·차량·주차 계획 이후, facade 생성 전에 시설 전체 예약을 원자적으로 승인한다. 완성된 Mesh는 계획 입력이 아니다. 모든 부재의 bounds가 의도 영역에 들어가고 기존 예약과 충돌하지 않아야 한다. 승인된 solid 요청만 facade의 고정 제약이 된다. 삭제하면 의도/예약이 사라져 원래 기준 패턴을 재계산하며 지지가 없어지면 의도는 남고 전체 출력은 무효화된다.

시설은 가로/세로 single/start/repeat/end와 4방향 조립 port를 가진 48개 코드 기반 프로토타입이다. 지지·보호 공간·방향·종류가 맞아야 전체 그룹을 채택한다. 검증은 단독/가로/세로/직사각형, 네 외벽 방향, resize/부분 삭제, 지원 제거, 충돌/portal 거절, 원자적 외벽 변경, 복원과 geometry bounds를 포함한다.

`column-prototype.ts`는 수평 네 방향에 이웃이 없는 셀의 연속 Y 구간을 찾고, 지면/슬래브/자유단/중간 분기로 구간을 나눈다. 일반 건물로 남길지 선택할 수 있으며, 기둥 표시에서는 본체·끝 collar·슬래브 transition·좁은 cap을 면 에셋으로 선택한다. 원본 점유·faceId·예약을 유지하고 일반 옥상 난간과 facade trim을 자동으로 붙이지 않는다. 통행 가능 공간을 늘리지 않는다.

## 재현과 결과

```sh
npm run verify
npm run test:e2e
npm run measure:urban
npx playwright test e2e/urban-measure.spec.ts --grep "@measure"
```

`tests/urban-*.test.ts`가 계약 회귀, `e2e/urban.spec.ts`가 실제 Viewer 객체·브라우저 출력 검증이다. 스크린샷은 `test-results/urban-*/`에 생성된다. 측정은 [urban-generation.json](../benchmarks/urban-generation.json)에 저장되며 일반 표본 27개, 최대 32³ solid, 임계값 sweep, 삭제 영향 범위, 전체/cache 동등성, 논리 작업량을 기록한다. Node 시간은 입력별 1회, 같은 프로세스에서 문서 생성 및 Viewer를 제외하고 측정한 값이다. 이 값만으로 앱 전체 성능 SLA나 최적화 완료를 주장하지 않는다. 별도 [브라우저 측정](../benchmarks/urban-browser-performance.json)은 기존/도시형 32³ 입력의 새 context 최초 20회, 준비 10회 후 반복 50회를 같은 production build에서 비교한다. 수락·검증·생성·Viewer 동기화·이력을 포함하고 GPU 완료/paint는 제외한다. 측정 테스트의 통과는 기록 완료를 뜻하며, 지연 기준 통과 여부는 각 행의 `passed` 값으로 구분한다.

상층 실제 이동·계단 접근 증명, solid/통행 변경, 가변 층고, 최종 아트 제작, 중앙 대칭 최적화, 모든 도시형 매스에 대한 의미 정확도는 후속 범위다. 이 Prototype의 통과를 그 항목들의 완료로 취급하지 않는다.

실제 렌더링 증거: [복수 Tower](../benchmarks/screenshots/urban-towers.png), [외벽 시설](../benchmarks/screenshots/urban-wall-facilities.png), [기둥 표시](../benchmarks/screenshots/urban-columns.png).

## 최종 검증 및 성능 이력

- `npm run verify`: 타입 검사, 40개 파일의 201개 단위/동작 테스트, production build 통과.
- `npm run test:e2e`: 기존 흐름을 포함한 브라우저 회귀 32개 통과. 후속 캐시 수정 후 도시형 네 흐름과 같은 build의 기존/도시형 최대 볼륨 성능 측정(총 5개 테스트)을 추가로 통과했다. 성능 기준 미달은 아래와 같이 별도로 판정한다.
- `npm run measure:urban`: 27개 일반 표본과 32³ solid, 정책 sweep, 삭제 영향 범위 실험 통과.
- 초기 앱 측정은 trace 수집을 켠 240초 harness 제한으로 중단되어 `urban-browser-performance.initial.json`에 미완료 표시로 보존했다. 현재 프로토콜은 trace/screenshot을 끄고 실행한다.
- 첫 완료 측정에서 도시형 32³의 cold p95 504.2ms / warm p95 539ms가 기준을 넘었다. 원인은 패널 템플릿의 캐시 키에 원본 분석과 새 파생 계획을 모두 직렬화해 16MB FIFO에서 문서/분석을 밀어내는 반복 축출이었다. 실패 표본은 `urban-browser-performance.before-cache-fix.json`에 남겼다.
- 템플릿 캐시 키를 실제 대표 표면·진단·선택 옵션·디자인·palette 의존성으로 한정했다. 파생 facade/예약/매스의 계획과 검증은 그대로 실행한다. `urban-cache.test.ts`가 32³ 반복 시 축출 0, 신규 쓰기 0, 출력 동일성과 palette/형태/시설 변경의 cache/전체 재계산 일치를 검증한다.

production build의 단일 JS 청크는 약 861KB(minified)여서 기존 Vite 크기 경고는 남아 있다. GPU 완료 및 실시간 FPS는 이 인수 범위에서 측정하지 않았다.

### 최종 브라우저 성능 판정

| Style | 실행 | p95(ms) | 기준(ms) | 판정 |
| --- | --- | ---: | ---: | --- |
| office | cold | 445.8 | 500 | 통과 |
| office | warm | 203.1 | 250 | 통과 |
| urban-office | cold | 529.4 | 500 | 미달 |
| urban-office | warm | 292.0 | 250 | 미달 |

기능·계약 회귀는 완료했으나 **최대 32³ 도시형 장면의 앱 전체 성능 인수는 미달**이다. 캐시 축출을 해결한 뒤에도 파생 매스/Zone/입면 계획 계산과 전체 문서 수락 비용이 남아 있다. 이 비용을 줄이는 추가 최적화와 GPU 프레임 시간 측정은 후속 작업으로 남긴다. 임계값을 낮추거나 표본을 버려 합격으로 바꾸지 않았다.
