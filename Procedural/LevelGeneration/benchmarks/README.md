# CPU 생성 측정 — 최종 5개 스타일 비교

2026-09-16, production Chromium에서 15개 입력 × 5개 스타일을 측정했다. 각 조합은 warm-up 10회 후 전체 재생성 50회이며, [latest.json](latest.json)에 입력·버전·계수·원시 표본·p50/p95·기기 정보를 보존했다.

- Windows 10.0.26200 x64 / AMD Ryzen 9 9950X3D / 논리 CPU 32개
- Node.js 22.22.0 / Playwright 1.63.0 / Headless Chromium 153.0.8010.12
- Seed 42, 등록된 reference / village / crafted-hip / crafted-gable / crafted-flat 프로필
- 범위: 정규화 → 외피/영역 분석 → 선택/모듈 조립 → Adapter 동기화 완료
- 공유 Asset 초기화, GPU 완료, paint, Inspector DOM 갱신, 프레임 대기는 제외한다. 5회마다 프레임에 제어를 돌려준다.
- percentile은 정렬 후 ceil(n × p) - 1 위치다. 작은 입력의 0ms는 타이머 해상도 이하를 뜻한다.

| 스타일 | 가장 느린 입력 | 최대 p95 (ms) | 생성 도시 p50 / p95 (ms) |
| --- | --- | ---: | ---: |
| reference | cantilever | 13.6 | 9.3 / 11.6 |
| village | dense | 24.3 | 11.8 / 14.1 |
| crafted-hip | dense | 22.7 | 13.9 / 17.5 |
| crafted-gable | dense | 21.1 | 13.0 / 17.7 |
| crafted-flat | dense | 20.1 | 13.1 / 18.0 |

생성 도시 사례는 Seed 42, 3×3 필지, 필지 폭 4, 도로 간격 2, 최대 높이 6, 밀도 100%, 격자 배치다. 점유 Cell 436개와 외피 Face 742개이며, 각 스타일은 동일한 원본 외피를 덮는다. 입체 스타일은 단위 Placement 일부를 N-cell/Corner 모듈로 대체하므로 Placement 수 자체는 다르다.

입력 묶음은 단일/인접/2³/L/단차/돌출/밀폐·열린 공동, 16×16×8의 조밀·단차·돌출, 낮은 별동, 파사드, 고정 마을 블록, 생성 도시다. 상세 단계별 수치는 JSON의 rows[].timings에서 확인할 수 있다.

전체 최대 CPU p95는 24.3ms, 입체 스타일 최대는 22.7ms로 제안 목표 100ms 이내다. 따라서 원 계획의 Incremental/Worker/WASM/GPU 도입 조건은 충족되지 않았다. 전체 재생성과 공유 Asset을 유지한다.

스타일을 순차 측정했으므로 JIT·GC·시스템 부하 차이가 있다. 작은 차이를 개선/회귀로 단정하지 않는다. 단계별 percentile은 서로 다른 표본이므로 합이 전체 p95와 같지 않다. 특정 기기와 대표 입력의 측정이며, 모든 기기·최대 32³ 입력·GPU 프레임률의 보장은 아니다. 명령 재실행은 latest.json을 덮어쓴다.
