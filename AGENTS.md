# Repository overview

This repository is a collection of game algorithm experiments and R&D projects.

## Projects

- `Navigation/Crowd` — crowd navigation and movement algorithms.
- `Physics/Vehicle` — vehicle physics algorithms.
- `Procedural/LevelGeneration` — procedural level generation algorithms.

## Working guidance

- Work within the project directory relevant to the requested task.
- Check the target project's code and local documentation before making changes.
- Keep changes focused on the requested project and task.

# 다른 언어·엔진으로 이식

- 별도 지정이 없으면 이식은 대상 엔진의 기본 언어로 규칙·알고리즘을 재구현하는 작업이다. 각 프로젝트의 TypeScript 계산 코드는 동작 비교용 참조 구현이며 대상 프로그램의 실행 의존성이 아니다.
- 사용자가 명시적으로 요청하지 않은 JS/TS 실행 브리지는 도입하지 않는다. ClearScript, V8, Node.js, 브라우저/WebView, JS 실행용 WASM 런타임을 포함하며, 원본 생성기를 별도 프로세스·서버로 호출하는 우회도 동일하다.
- Three.js와 웹 Viewer는 참조·시각 검증 도구다. 대상에서는 엔진 고유 메시·재질·선택 API를 사용한다. 원본 TS 프로젝트 없이 대상이 자체 빌드·실행되어야 이식이 완료된 것이다.
- 참조 결과를 만드는 개발 도구에서는 기존 Node.js·Three.js를 사용할 수 있다. 이 도구와 의존성을 대상 게임의 빌드·실행 경로에 넣지 않는다.

# LevelGeneration 이식 자료와 검증

아래 안내는 `Procedural/LevelGeneration`에만 적용하며, 모든 명령은 해당 디렉터리에서 실행한다.

- 먼저 `Procedural/LevelGeneration/docs/NATIVE_PORTING.md`, `Procedural/LevelGeneration/docs/BUILDING_RULES_PORTING.md`, `Procedural/LevelGeneration/docs/PORTING_CONTRACT.md`를 읽고 규칙 계산의 동등성을 맞춘 뒤 렌더링 어댑터를 연결한다.

- `npm run port:export`는 기존 baseline을 읽기만 하며 순수 데이터·입출력 fixture·메시 자료를 새 폴더에 내보낸다. 생성 자료를 손으로 고치거나 변경 후 결과로 기존 baseline을 갱신해 차이를 숨기지 않는다.
- `Procedural/LevelGeneration/porting/check.py`는 Python 표준 라이브러리만 사용하는 개발용 검사기다. 자료 무결성, 입력 복원, 대상 출력의 JSON 경로별 비교 명령은 `Procedural/LevelGeneration/docs/NATIVE_PORTING.md`에 있다.
- 공유 규칙을 변경하면 `npm run verify`로 타입·테스트·빌드를 검증한다. 이식 자료/도구만 변경하면 `npm run typecheck`, 관련 보존 테스트와 `python -m unittest discover -s porting -p 'test_*.py'`, 실제 export/verify를 확인한다. 웹 동작을 바꾸지 않은 자료 작업에 브라우저 검사를 반복하지 않는다.
