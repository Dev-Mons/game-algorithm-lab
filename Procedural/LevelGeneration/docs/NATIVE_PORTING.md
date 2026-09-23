# 네이티브 언어 이식 진입점

이 프로젝트의 기본 이식 방식은 **대상 엔진의 기본 언어로 생성 알고리즘을 재구현**하는 것이다.
TypeScript는 동작과 결과를 확인하는 참조 구현이며, 기존 JS를 실행할 환경을 대상에 붙이는 것이 아니다.
대상 엔진/언어가 지정되지 않은 자료 준비 작업에서는 특정 언어 구현을 임의로 추가하지 않는다.

## 실행 경계

| 부분 | 참조 프로젝트 | 이식 대상 |
| --- | --- | --- |
| 규칙 계산 | `src/core` TypeScript | C#/C++/Rust/Python 등 선택된 언어의 자체 구현 |
| 정의/스타일/치수 | TS가 구성한 고정 데이터 | 내보낸 JSON을 읽거나 대상 언어 데이터로 변환 |
| 외피 메시 | Three.js가 만드는 참조 geometry | 제공된 버퍼를 가져오거나 엔진 고유 메시 코드로 재현 |
| UI/선택/렌더링 | 웹 Viewer, DOM, Three.js | 대상 엔진의 API |
| 검증 | 원본 생성기, 기존 baseline | JSON 파일 비교와 엔진별 메시/소유 검증 |

사용자가 요청하지 않은 ClearScript/V8/Node.js/WebView/브라우저/JS 실행용 WASM 도입,
원본 생성기의 subprocess·서버 호출은 이식 구현으로 인정하지 않는다.
대상 빌드·실행·배포에는 원본 TS 프로젝트가 필요 없어야 한다. 참조 export에서만
기존 Node.js/Vite/Three.js를 사용한다. Python 검사기도 개발 도구이며 게임 런타임 의존성이 아니다.
결과 비교의 성공만으로 이 조건을 입증할 수는 없으므로 대상의 의존성과 호출 경로도 확인한다.

## 참조 자료 생성

참조 저장소의 `Procedural/LevelGeneration`에서:

```sh
npm run port:export
# 다른 새 폴더에 생성할 때
npm run port:export -- --output artifacts/native-porting-next
python porting/check.py verify artifacts/native-porting
```

기본 출력은 `artifacts/native-porting`이다. 이미 있는 출력 폴더는 덮어쓰지 않는다.
실패한 부분 출력에는 `manifest.json`이 없으며 유효한 번들로 사용하지 않는다.
기존 `concept-preservation-baseline.json`의 214개 입력·419종 완성형 면 geometry에
모두 일치해야 마지막에 manifest를 쓴다. baseline을 새로 만드는 기능은 없다.
원본 커밋과 실제 소스 파일별 SHA256을 남겨 미커밋 변경도 구분할 수 있다.

자료 작업 검증:

```sh
npm run typecheck
npx vitest run tests/concept-preservation.test.ts
python -m unittest discover -s porting -p 'test_*.py'
```

## 번들 구성

| 경로 | 의미 |
| --- | --- |
| `START_HERE.md` | 이 문서의 사본. 이후 절차는 번들만으로 수행 가능 |
| `manifest.json` | 버전, 출처, coverage, 파일 무결성, fixture/메시/데이터 위치 |
| `data/*.json` | 최종 스타일, 모듈·타일 카탈로그, 패턴, 규칙 predicate, 치수, 상수, 팔레트 색상 |
| `cases/<id>/input.json` | 입력 문서. 공통 정의는 번들 내부 `$ref` 사용 |
| `cases/<id>/expected.json` | 실제 외부 계약의 기대 출력. 해시뿐 아니라 모든 값 포함 |
| `cases/<id>/reference.json` | 수직 계획/매스/구역·기둥·프레임·trace의 설명용 중간 결과 |
| `meshes/*.json` | 완성형 면별 정점 속성, 삼각형 인덱스, 재질 그룹, 로컬 bounds |
| `hash-vectors.json` | 기존 unsigned32 해시 검증 벡터 |
| `schemas/*.schema.json` | TS utility type을 따라갈 필요 없는 JSON 형식 명세 |
| `spec/*.md` | 층/패턴 식, 우선순위, 공간·에셋 계약의 사본 |
| `check.py` | 표준 라이브러리만 사용하는 독립 검사기 |

카탈로그·스타일의 `$ref`는 **번들 루트 기준 경로**다. 네트워크 참조나 코드를 실행하는
표현식이 아니다. 해당 JSON 값으로 치환하면 기존 schema6 문서가 된다. 설정의 문자열
predicate와 규칙 ID는 대상 언어의 명시적인 분기/등록 항목으로 구현한다. `eval`에 전달하지 않는다.
자료에는 알고리즘 실행 코드가 없으므로, JSON만 로드해서 모든 생성 규칙이 실행되는 것은 아니다.
`spec`의 소스 파일명은 참조 위치이며 대상 런타임에 그 파일을 연결하라는 의미가 아니다.
사본 문서의 역사적 성능 보고서/스크린샷 링크는 원본 저장소의 참고 자료다.

## 대상 구현의 입력/출력

번들을 다른 머신으로 복사한 뒤 Node.js·npm·Three.js 없이 수행할 수 있다:

```sh
python check.py verify .
python check.py materialize . native-inputs
# 대상 언어 구현을 자체 실행하여 native-results/<id>.json에 결과를 기록한다.
python check.py compare . native-results
# 특정 입력 또는 구현 중인 단계만 비교
python check.py compare . native-results --case C-low-reference --section vertical
```

`materialize`는 생성기를 실행하지 않고 JSON 참조만 확장한다. 새 출력 디렉터리만 받는다.
대상은 각 입력의 `grid`, `seed`, `buildingDefinition`, `buildings`, `sceneInputs`,
`catalog`, `ruleSet`, `style`, `settings`를 처리하고 다음 `semantic-v1` 객체를 출력한다.
버전은 document6 / SceneInputs2 / catalog13 / environment-plans-v1이다.

| 출력 필드 | 핵심 내용 |
| --- | --- |
| `status`, `diagnostics` | 상태와 외부 진단 |
| `surfaces` | 면 ID, 셀, 방향, 성분 소유, 면 역할 및 옥상/밑면 분류 |
| `placements` | 면당 배치 ID, 타일, `position2`, 방향, 규칙, 완성형 키, 마감 ID |
| `modules`, `scenePlacements` | 구조·도로·시설·주차 등 계약상 출력. 빈 배열도 유지 |
| `vertical` | 층 구간, anchor 정렬, 면별 band/rowRole |
| `entrances` | 실제 출입구 면·접근 경로·frontage·미충족 수 |
| `reservations` | 소유, 우선순위, 셀, 정수 Box16, crossing 식별자 |
| `stages` | 단계 준비 상태와 사유 |

배열 순서는 계약에 포함되고 객체 멤버 순서는 비교하지 않는다. 정수 `1`과 숫자 `1.0`은
같지만 bool과 숫자, 필드 없음과 null은 다르다. 별도의 오차 허용은 없다.
불일치는 `C-low-reference /placements/4/tileId`처럼 최초 JSON 경로와 양쪽 값을 출력한다.
종료 코드는 0=일치, 1=출력 차이/누락, 2=자료 또는 사용 오류다.
`--section` 통과는 해당 단계의 부분 검증이며 전체 이식 완료가 아니다.

`reference.json`의 내부 매스 DAG·중간 계획·후보 trace·카운터를 동일하게 구현할 필요는 없다.
`expected.json`과 사용자 정의 규칙의 계약을 유지한다. schema는 입출력 형태를 설명하며
공간 유효성이나 스타일의 모든 교차 제약은 `spec/PORTING_CONTRACT.md`와 규칙 명세를 따른다.

## 권장 구현 순서

1. 정수 셀/면 방향, 좌표 정렬, hash33-u32, negative modulo, anchor와 ID를 구현한다.
2. 점유·연결 성분·외피 분석과 층/지역 scope를 구현하고 `surfaces`, `vertical`을 비교한다.
3. preflight·공간 예약·실제 접근·출입구를 구현한다. 입면에서 입구를 임의로 추측하지 않는다.
4. 시설/기둥/프레임 선점, 물리 run 분리, 패턴 선택, 에셋/사용자 타일, 마감을 구현한다.
5. 전체 `semantic-v1`을 비교한 뒤 엔진 고유 메시·재질·선택·문서 편집을 연결한다.

좌표/Box16은 정수로 유지하고 h33은 unsigned32 wrap을 명시한다. 문자열 동점은
locale 정렬이 아닌 명세 순서를 쓴다. JS `number` 수치 계산을 재현할 때는 binary64와
명시적인 floor/ceil/반올림 규칙을 사용하고 엔진 float 변환은 표시 경계에서 한다.
Map/Set 열거 순서가 필요한 곳은 언어 기본 동작에 의존하지 말고 원래 순서를 유지한다.
검증이 끝나기 전에 병렬 평가나 엔진 물리 시스템으로 예약 규칙을 대체하지 않는다.

## Three.js 없는 메시 연결

메시 JSON은 런타임 클래스가 없는 평범한 숫자 배열이다. `geometry.attributes`의
각 속성에는 `itemSize`와 평탄한 `array`가 있고, `index`의 세 정수가 삼각형 하나다.
`groups.start/count`는 삼각형 수가 아닌 **인덱스 원소 수**다.
실제 재질 슬롯은 0=벽/기본 면, 1=프레임/마감, 2=유리, 3=금속 accent다.
`data/constants.json`의 `faceMaterialSlots`를 기준으로 한다.

메시 좌표는 로컬 U/V/N, 면 중심 pivot, 1셀=1단위다. 월드 정점은
`position2 / 2 + U * local.x + V * local.y + N * local.z`로 계산한다.
방향별 U/V/N은 `faceBases`에 있다. 대상 엔진의 handedness, up 축, winding, UV 원점
변환은 어댑터에서 일관되게 적용하고 문서의 원본 좌표/ID를 바꾸지 않는다.
면 소유 단위, 연결 창 경계, 개구부, 난간·마감, 재질 그룹과 bounds를 보존한다.
하나의 완성형 면을 만들기 위해 대상에서 Three.js를 실행할 필요가 없다.

참조 geometry SHA256은 정점 순서까지 고정한다. 대상 엔진이 인덱스를 재정렬했다면
배열 해시만으로 형상 차이라고 단정하지 않고 정규화한 삼각형/속성·그룹·bounds를 검증한다.
이 번들의 `verify`는 참조 버퍼의 무결성을 검사하며 대상 렌더러의 구현을 검사하지는 않는다.

## 포함 범위와 완료 조건

214개 A–D 입력의 실제 출력과 그 입력에서 사용한 419종 완성형 면 메시를 포함한다.
모든 카탈로그/마감 조합, 모든 사용자 정의 규칙, 모든 32³ 부피의 전수 검증은 아니다.
현재 스타일 데이터와 전체 등록 외벽/마감 descriptor는 제공하지만, 사용하지 않은
완성형 조합은 대상의 native geometry 구현 또는 별도 오프라인 에셋 제작이 필요하다.
독립 시설·도로·식생의 메시, 브라우저 canvas 텍스처, 조명/카메라/UI는 포함하지 않는다.
팔레트 JSON은 색상 자료이며 재질/텍스처 전체를 대체하지 않는다.

완료 보고에는 전체 출력 비교, geometry·재질·면 소유 검증, 대상 엔진 편집/저장 검증,
지원하는 사용자 정의 규칙 범위와 성능 측정 범위를 구분한다. 대상이 원본 TS와 JS
실행 브리지 없이 자체 빌드·실행됨을 함께 확인한다. 기존 출력 파일을 복사해 비교기를
통과시키는 것은 검사기 smoke check일 뿐 실제 이식의 증거가 아니다.
