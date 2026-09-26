# Crowd Navigation Lab

2D 원형 군중의 경로 안내·밀도 압력·접촉·벽 충돌을 계산하는 CPU 참조 구현과 웹 실험실입니다.
현재 프리셋은 **Legacy · 방향별 유체 군중** 하나입니다. 게임 엔진에는 계산 코어를
대상 언어로 재구현하며, 원본 웹 앱을 실행 의존성으로 연결하지 않습니다.

## 필요한 문서만 읽기

| 작업 | 읽을 문서 |
|---|---|
| 현재 구조, 알고리즘, 책임 경계, 한계 파악 | [구조와 알고리즘](docs/architecture.md) |
| 다른 언어·게임 엔진으로 이식 | [이식 계약과 검증](docs/native-porting.md) → 필요한 계산 모듈 |
| 알고리즘 개선, 새 프리셋, 테스트·성능 측정 | [개발과 검증](docs/development.md) → 수정할 모듈 |
| 내부 공동 회복 실험만 다루기 | [독립 실험 프로토콜](experiments/fluid-navigation/particle-protocol.md) |

문서를 전부 순서대로 읽을 필요는 없습니다. `docs/research`, `docs/measurements`,
`baselines`, `porting/fixtures`는 목적이 있는 검증에서만 여는 데이터입니다.
개발 연혁은 Git 이력으로 확인하고, 과거 측정값을 현재 코드의 성능 보장으로 사용하지 않습니다.

## 기술 스택과 코드 진입점

| 계층 | 기술과 진입점 |
|---|---|
| 계산 코어 | TypeScript / ES2022, Float64 배열, 단일 CPU 실행. [src/core/index.ts](src/core/index.ts) |
| 실험실 어댑터 | 시드 배치·프리셋·측정. [src/lab/simulation.ts](src/lab/simulation.ts) |
| 화면·도구 | Canvas 2D, HTML/CSS, Vite. [src/main.ts](src/main.ts) |
| 검증 | Vitest, Playwright, 이식 비교용 Python 3.9+ 표준 라이브러리 |

계산 코어는 DOM·Node·실시간 시계에 의존하지 않습니다. Worker·WASM·GPU 백엔드는 없습니다.
개발 도구의 버전과 설치 기준은 [package.json](package.json), [package-lock.json](package-lock.json)입니다.

## 실행

`Navigation/Crowd`에서 실행합니다.

```powershell
npm ci
npm run dev
```

Windows에서는 `run.bat`도 사용할 수 있습니다. 기본 포트는 4273입니다.
콘솔의 실행 소스·주소를 확인하고 해당 주소를 사용하세요.

- 실행 / 일시정지 / 한 스텝 / 초기화로 이동을 확인하고, 캔버스 클릭으로 공통 목표를 바꿉니다.
- 클릭 도구에서 폭발·확장 충격파·지속 밀림·이동 원형 밀림을 선택할 수 있습니다.
- 맵 편집, 혼합 크기, 동일 밀도 확장, 결과 저장·비교 방법은 [개발 도구 사용](docs/development.md#실험실-사용)에 있습니다.
- 재현 예: `/?scenario=winding-corners&agents=1000&seed=42&paused=true`.
- 1만 개 확장 예: `/?scenario=rocky-pass&agents=10000&scale=true&seed=42&paused=true`.

기본 검증은 `npm run verify`, 이식 기준 보존 검증은 `npm run port:verify`입니다.
변경 범위별 추가 검사와 측정 명령은 [검증 선택](docs/development.md#검증-선택)을 따릅니다.
