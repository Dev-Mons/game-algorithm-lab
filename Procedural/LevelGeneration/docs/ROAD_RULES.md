# 도로 폭·연결·표시 규칙

2026-09-25. 사용자가 제공한 [T자](road-improvement-evidence/reference-T.png)·[ㄱ자](road-improvement-evidence/reference-L.png) 화면을 구조와 표시의 참고로 사용했다. 원본 프로그램의 내부 알고리즘이나 실제 교통 법규를 복원한 규칙은 아니다. 직선의 잔여 길이를 코너로 오분류하거나 부분 접속의 노출 경계를 지우던 문제를 해결한 규칙이다.

## 원본 입력과 형태

입력은 기존 SceneInputs2의 Y=0 정수 도로 셀 마스크다. 문서/schema/catalog 버전이나 설정 UI를 추가하지 않는다. 건물 점유와 도로의 입력 충돌, 마지막 입력 소유, Undo/Redo·JSON 계약은 유지한다.

[roads.ts](../src/core/roads.ts)의 `analyzeRoads`는 다음 순서를 따른다.

1. 각 Z행의 연속 X구간과 각 X열의 연속 Z구간을 찾고, 같은 구간이 이어지는 행/열을 묶는다. 가로로 긴 띠는 X 진행, 세로로 긴 띠는 Z 진행의 후보가 된다.
2. 실제로 두 축으로 뻗는 후보 띠의 겹침을 코너/교차부로 정의한다. 바깥으로 이어지는 방향이 2개면 ㄱ자, 3개면 T자, 4개면 십자다. 모듈을 잘라 놓은 내부 선은 이 판정에 쓰지 않는다.
3. 남은 셀을 진행 축과 동일 단면별로 묶는다. 이후에만 폭 단위 길이로 표시 모듈을 분할하며, 마지막 구간 길이가 짧아도 폭과 축을 유지한다. 폭4×길이6은 폭4 모듈로 유지되고 폭2 코너 두 개가 되지 않는다.
4. 각 모듈 변에서 실제 이웃 셀이 있는 부분을 `portSpans`, 없는 부분을 `boundarySpans`로 기록한다. 구간은 절대 횡단 좌표의 `[start,end)`이며 port에는 연결된 이웃 모듈 ID가 있다. 기존 `ports` 방향 배열과 `road:x,z` ID 형식은 유지한다.
5. 진행 축 옆 접촉/부분 폭 접속은 `transition`으로 표시하며, 완전한 교차로로 승격하지 않는다. 모든 셀은 정확히 한 모듈에 속한다. 구멍이나 오목부를 메우지 않는다.

숫자 좌표 정렬과 고정 방향 순서 east/west/north/south를 사용한다. 단독 정사각형 패치처럼 진행 방향이 없는 경우 Z를 명시적 동점 기본값으로 쓴다. 임의 마스크에서 실제 도로 사용 의도까지 알아내는 하중/교통 solver는 아니다. 시설·주차 keepout은 동일한 `isRoadJunction` 판정과 같은 실행의 모듈 자료를 사용한다. 기존 입력 기반 보행/차량 proof는 바꾸지 않는다.

## 표시 정책

- 폭2 이상 직선은 중앙 이중 황색선, 폭4 이상은 추가 백색 차선 점선을 사용한다. 폭1은 과밀 표시를 생략한다. `width`는 입력 셀 단면 폭이며 실제 미터 또는 법적 차로 수를 증명하지 않는다.
- ㄱ자/T자/십자의 중앙 면은 비워 둔다. 횡단보도는 폭2 이상 실제 연결 입구의 접근 도로에만 놓는다. T자는 3방향, ㄱ자는 2방향이다.
- 횡단보도 줄무늬 중심은 교차부 경계에서 바깥으로 0.3셀, 정지선은 0.7셀이다. 작은 황색 끝 표시도 도로 마스크 안에 둔다. 차선은 이 접근 표시 영역 앞에서 끝난다.
- 표시 전체가 원본 도로 안에 들어갈 때만 사용한다. 다른 교차부 중앙에 침범하거나 짧은 연결에서 반대쪽 횡단보도 영역과 겹치면 해당 횡단보도/정지선 묶음을 생략한다. 순서에 따른 임의 승자는 없다.
- 외곽선은 실제 노출 변에만 그린다. 한 칸 notch나 부분 접속에서도 필요한 경계를 남기고 내부 분할선에 테두리를 만들지 않는다.
- 표시는 기존 ScenePlacement의 road box 에셋 경로로 출력한다. core에 Three.js/DOM이나 새 런타임을 추가하지 않았다. 시각적 횡단보도는 보행/차량 예약의 crossing 인증과 별개다.

## 보존 비교와 export

기존 `benchmarks/concept-preservation-baseline.json`을 변경하지 않았다. 214개 중 도로가 있는 A/B/C/D-city 4개는 의도적으로 도로 출력이 달라진다. 210개는 기존 전체 의미 결과를 비교하고, 4개는 **road 종류의 ScenePlacement만** 분리해 나머지 건물·시설·순서·예약·접근·재료를 기존 baseline과 비교한다. 419종 완성형 건물 면 geometry도 기존 해시와 비교한다.

비교용 [road-presentation-v1.json](../tests/fixtures/road-presentation-v1.json)은 변경 전 커밋 `65701664aa9c4c4bb80320d58550e610511ea2b0`의 `roads.ts`로 기존 두 도시 도로 마스크를 평가해 추출했다. 해당 원본 커밋과 파일 SHA256을 포함한다. 새 결과로 만든 대체 baseline이 아니며 제품 런타임에서는 사용하지 않는다. [검사 도우미](../tests/road-preservation-contract.ts)는 알려지지 않은 옛 마스크나 road 출력 순서 변경을 거절한다.

네이티브 자료 export도 같은 보존 검사를 사용한다. `expected.json`에는 **현재 실제 생성 결과**가 들어간다. fixture의 `baseline`은 과거 비교 지문, `outputFingerprint`는 현재 결과 지문, `intentionalChanges`는 허용한 도로 표시 변경이다. manifest는 4개 변경 사례와 과거 도로 근거 파일을 명시한다. 따라서 원본 baseline과 현재 도로 표시가 완전히 같다고 표시하지 않는다. geometry 및 도로 외 출력의 불일치는 여전히 export를 실패시킨다.

## 검증과 화면

[road-topology.test.ts](../tests/road-topology.test.ts)는 폭1–8의 임의 길이 직선, 회전/음수 좌표, 폭1–5의 ㄱ/T/십자, 서로 다른 폭의 접속, notch, 짧은 교차로 연결, 기존 가짜 교차로 조명 반례, cache/Undo/Redo/JSON을 검사한다. 작은 3×3 마스크 511개는 셀 단일 소유, 구멍, port 양방향 대응, 모든 노출 경계, 표시 bounds를 검사한다. 511개의 임의 마스크 전체에 사용자가 의도한 도로 형태를 추정했다는 뜻은 아니다.

[실제 브라우저 테스트](../e2e/road-topology.spec.ts)는 T자의 한 팔을 드래그/Q로 삭제해 ㄱ자로 바꾸고 Undo/Redo·저장복원한다. 직선 4×8→4×6 편집과 notch 표시도 검사한다.

- [T자 상부](road-improvement-evidence/T-road-top.png) · [T자 사선](road-improvement-evidence/T-road-perspective.png)
- [ㄱ자 상부](road-improvement-evidence/L-road-top.png) · [ㄱ자 사선](road-improvement-evidence/L-road-perspective.png)
- [수정된 4×6 직선](road-improvement-evidence/straight-4x6-fixed.png) · [notch 외곽선](road-improvement-evidence/notch-edge-fixed.png)

## 실제 검증 결과

- `npm run verify`: 타입 검사, 52개 파일/353개 테스트, Vite 빌드 통과. 기존 번들 크기 경고는 남아 있다.
- 기존 214입력 보존 검사: 210개 전체 의미 출력 일치, 도시 4개는 명시한 road 출력 변경을 제외한 모든 필드 일치. 419종 건물 면 geometry 일치. 기존 baseline 파일 변경 없음.
- `npx playwright test e2e/road-topology.spec.ts e2e/roads.spec.ts --output test-results/road-improvement`: 3개 통과. 실제 T→ㄱ 편집, 4×8→4×6, notch, 오브젝트 덮어쓰기·복원, Undo/Redo·JSON 확인. 상부/사선 스크린샷 6장을 직접 확인했다.
- `npx playwright test e2e/environment.spec.ts --grep-invert '@measure' --output test-results/road-environment`: 7개 통과. 도로 단절에 따른 접근·시설 갱신, 주차 proof/표시, 마지막 수락 화면 보존 등을 확인했다.
- `python -m unittest discover -s porting -p 'test_*.py'`: 6개 통과.
- `npm run port:export -- --output artifacts/native-porting-road-v2`: 새 폴더에 214입력/419메시 생성 완료. manifest에 도시 4개의 `road-presentation-v2` 변경과 역사적 비교 근거를 명시했다.
- `python porting/check.py verify artifacts/native-porting-road-v2`: 214입력/419메시 검증 통과.
- `git diff --check` 통과. 테스트가 자동 재작성한 `benchmarks/parking-quality.json`은 작업 전 상태로 복구했다.

전체 브라우저 테스트와 성능 분포 측정은 반복하지 않았다. 이번 작업은 native 엔진 이식이나 실제 교통 시뮬레이션 검증이 아니며, 내보낸 참조 자료 검증을 그 성공으로 주장하지 않는다.
