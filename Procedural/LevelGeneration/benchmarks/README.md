# 검증·측정 안내

명령은 `Procedural/LevelGeneration`에서 실행한다. 생성 계약은 [통합 규칙](../docs/GENERATION_RULES.md),
네이티브 참조 자료의 생성·비교는 [이식 절차](../docs/NATIVE_PORTING.md)를 따른다.

## 기능 검사

| 명령 | 확인 범위 |
|---|---|
| `npm run verify` | 타입·단위 테스트·프로덕션 빌드 |
| `npm run test:e2e` | 실제 브라우저 편집·선택·Undo/Redo·JSON 회귀; 성능 측정 제외 |
| `npx vitest run tests/concept-preservation.test.ts` | 고정 입력의 의미 출력·geometry, 편집/저장 복원·cache 동등성 |
| `npx vitest run tests/road-topology.test.ts tests/parking-layout-v2.test.ts` | 도로 경계/연결·지상 주차 배치/증명 |
| `python -m unittest discover -s porting -p 'test_*.py'` | 독립 이식 자료 검사기 |

변경한 기능과 실패 위험에 맞는 검사만 수행한다. 필요한 검사가 통과하면 구체적인 추가 우려 없이 전체 검사를 반복하지 않는다.

## 성능 측정

전체 환경 측정:

```powershell
npm run build
npx playwright test e2e/environment.spec.ts --grep '@measure'
```

`environment-performance.json`은 최초 생성·반복 생성·실제 도로/주차 영역 편집의 표본,
단계 시간·논리/실제 작업량·cache·입출력 signature·기기/브라우저/빌드 정보를 기록한다.
`parking-quality.json`은 승인 구획·면적·예산·차량/보행 증명 결과다.
현재 코드의 성능 판정은 새 실행 결과와 테스트에 정의된 기준으로 확인한다.

건물의 실제 E/Q·연속 드래그 및 빈 캐시 최초 장면 측정:

```powershell
npm run build
$env:BUILDING_MEASURE_OUTPUT='benchmarks/building-edit.current.json'
npx playwright test --config playwright.building-measure.config.ts building-edit-measure.spec.ts
$env:BUILDING_STARTUP_OUTPUT='benchmarks/building-startup.current.json'
npx playwright test --config playwright.building-measure.config.ts building-startup-measure.spec.ts
```

입력은 A/C, Seed 42, 28×24×28, 옥상 선택 784칸이다. 최초 추가/제거는 각각 새 context 10개,
반복 E/Q는 준비 4회 후 30회, 연속 드래그는 3층 추가/제거 제스처 5회다.
최초 편집에는 초기 장면의 cache가 이미 있으며 빈 캐시 최초 장면 측정(스타일당 새 context 3개)과 구분한다.

수직/입면 순수 계산은 다음 명령으로 측정한다.

```powershell
$env:FACADE_BENCH_REPORT='benchmarks/facade-core.current.json'
npx vitest run experiments/facade-core-performance.test.ts
```

24³·Seed 17, 스타일당 최초 1회와 반복 40회이며 외피 분석·기본 배치는 측정 밖이다.
매회 수직/입면을 다시 계산한다. 전체 환경 생성·Viewer·GPU 비용을 포함하지 않는다.

## 결과 해석

- p50/p95는 정렬 표본의 `ceil(n*p)-1` 인덱스(nearest-rank)로 계산한다. 최초 표본은 반복 통계에서 제외한다.
- 실제 편집 시간은 native event부터 새 WebGL render 호출의 CPU 반환까지다.
  최초 장면의 두 rAF 구간은 화면을 그릴 기회이며 GPU 완료·compositor paint·모니터 표시 지연은 측정하지 않는다.
- `inputQueueMs`, 동기 수락, 생성, Viewer, geometry 준비, render submission을 구분한다.
  geometry 준비는 face Mesh 구간에 포함되므로 하위 구간을 중복 합산하지 않는다.
- 최초 편집 n=10과 최초 장면 n=3의 p95는 최댓값이다. 적은 표본으로 안정적인 극단 지연을 추정하지 않는다.
- 브라우저·CPU·WebGL renderer와 빌드 정보를 함께 읽고 다른 GPU/기기로 수치를 일반화하지 않는다.
  측정은 다른 테스트/벤치마크와 겹치지 않게 실행한다.
- 연속 드래그에서 render 전에 대체된 중간 상태는 `supersededBeforeRender`로 확인한다.
  테스트 통과와 성능 목표 충족을 구분한다.
