# 현재 환경 생성 인수 보고서

프로젝트 디렉터리에서 `npm run build` 후 `npx playwright test e2e/environment.spec.ts --grep '@measure'`를 실행합니다.

- application-cold: 새 context/page/Viewer20개, 자동 생성0, 빈 planner/환경 geometry cache에서 최초 수락·검증부터 sync/수락 publication까지. 사전 예열 없음.
- warm-repeat: 같은 입력 준비10회+측정50회.
- first-road-edit: 새 context에서 변경 전 입력을 정확히1회 생성하고 실제 도구 드래그로 전체 strip을 추가/제거. 각각 독립20회.
- first-area-edit: 같은 방식으로 R30의6×20 또는 경계 주차의6×28 마스크를 실제 드래그로 제거. 독립20회.

정렬한 표본의 `ceil(n*p)-1` 인덱스로 분위수를 계산합니다. 사용자 drag 이동·네트워크·GPU 완료·paint는 제외하며 명령, 입력/출력 signature, 검증, generation, sync, history, publication은 포함합니다. 접힌 Inspector 상태는 동일하고 필요 geometry library 초기화는 최초 생성 안에 포함합니다.

`environment-performance.json`은 rawSamples, 초기 상태, stage 시간, 실제/논리 expansion, cache, 입출력 signature, editId/호출 수/유용성, 정확한 입력 JSON, 기기/브라우저와 production artifact SHA256을 기록합니다. buildSHA는 정렬된 배포 JS/CSS artifact hash 목록의 SHA256이며 sourceBaseCommit과 추적 파일 diff 서명도 별도 기록합니다.

목표(p95): 보통 R30/16×8×16/별동2+폭4도로+시설의도64셀은 warm100ms/cold200ms, R30 첫 편집은 각각150ms. 경계 주차/32³ 건물은 warm250ms/cold500ms, 경계 주차 첫 편집은 각각300ms입니다. 주차의 양성 유용성·안전·미검증0도 동시에 확인합니다.

`parking-quality.json`은 R12/R30/L16/O30/D12와 도로 없는 음성 대조의 실제 구획/면적/예산/증명 결과입니다. `environment-performance.initial.json`은 최적화 중 실패한 최초 측정 자료를 보존하며 최종 합격 자료를 대신하지 않습니다.


실패 이력은 `environment-performance.initial.json`, `environment-performance.pre-immutable.json`, `environment-performance.dense-before-identity.json`, `environment-performance.dense-before-serialization.json`에 그대로 남깁니다. 각각 초기 전체 측정, immutable 조회 이전 전체 측정, dense 입력 identity 최적화 이전, canonical serialization 개선 이전의 자료이며 최종 인수 파일과 구별합니다. 캐시 키·원본·후보 실패 이유/안전 검사 범위를 줄이거나 임계값을 낮춰 통과시킨 것이 아닙니다.

`screenshots/`는 실제 e2e 실행에서 캡처한 현재 Viewer 증거입니다. 과거 결과와의 픽셀 동일성을 강제하는 golden fixture가 아닙니다.

## 최종 성능 결과 — 2026-09-17

모든 16개 분포가 지정 p95 목표를 통과했습니다. 수치는 ms이며 raw sample 전체는 `environment-performance.json`에 있습니다.

| 입력 | 실행 | 표본 | p50 | p95 | 최대 | p95 한도 |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| R30 | application-cold | 20 | 148.3 | 156.4 | 161.3 | 200 |
| R30 | warm-repeat | 50 | 12.2 | 14.7 | 16.7 | 100 |
| building | application-cold | 20 | 79.1 | 83.4 | 85.2 | 200 |
| building | warm-repeat | 50 | 25.2 | 33.0 | 38.8 | 100 |
| annex | application-cold | 20 | 93.7 | 97.2 | 106.5 | 200 |
| annex | warm-repeat | 50 | 37.3 | 49.8 | 55.0 | 100 |
| boundary | application-cold | 20 | 210.8 | 222.1 | 225.9 | 500 |
| boundary | warm-repeat | 50 | 19.3 | 29.5 | 32.0 | 250 |
| dense | application-cold | 20 | 442.0 | 458.7 | 462.0 | 500 |
| dense | warm-repeat | 50 | 171.5 | 214.9 | 238.6 | 250 |
| R30 | first-road-edit / road-add | 20 | 142.5 | 148.4 | 154.3 | 150 |
| R30 | first-road-edit / road-remove | 20 | 38.3 | 40.0 | 41.4 | 150 |
| R30 | first-area-edit / area-remove | 20 | 94.0 | 96.9 | 97.0 | 150 |
| boundary | first-road-edit / road-add | 20 | 203.6 | 208.8 | 208.9 | 300 |
| boundary | first-road-edit / road-remove | 20 | 52.0 | 57.7 | 58.7 | 300 |
| boundary | first-area-edit / area-remove | 20 | 198.3 | 204.5 | 210.5 | 300 |

Production artifact SHA256: `c8df65a6c6c45c4c93b7f7b6afc04d0a8a588f4588ce10abee2befeaa9ec0e03`.
브라우저: 153.0.8010.12; CPU: AMD Ryzen 9 7950X 16-Core Processor; OS: win32 10.0.26200.

같은 production build의 cold 100회, warm 측정250회(별도 준비50회), 독립 첫 편집120회를 기록했습니다. 도로 추가는 R30 양성 유용성을 재검증하고, 도로 삭제는 NO_ROAD_GATE/구획 제거/입력 보존을 확인합니다. 영역 편집은 120/168셀 제거, anchor/ID/도로 보존, 잔류 생성물 없음과 모든 구획 proof를 확인합니다.

## Issue #29 도시형 건물

`npm run measure:urban`은 Node 생성기의 27개 Style/Seed/매스 표본, 최대 32³ solid, 정책 임계값 비교와 한 칸 삭제 영향 범위를 `urban-generation.json`에 기록합니다. 입력마다 1회이며 Viewer를 제외한 관측값입니다.

`npm run build` 후 `npx playwright test e2e/urban-measure.spec.ts --grep "@measure"`는 기존 업무형과 도시형 업무형의 동일 32³ 볼륨을 비교합니다. 각 스타일의 새 context 최초 20회, 준비 10회 후 반복 50회를 `urban-browser-performance.json`에 기록합니다. 기존 cold 500ms / warm 250ms 기준은 보고서 행의 `passed`에서 판정하며, 테스트 통과 자체는 성능 합격을 의미하지 않습니다. GPU 완료와 paint는 측정 범위 밖입니다. 세부 계약과 결과는 [구현 기록](../docs/URBAN_BUILDINGS_29.md)을 참조하세요.
