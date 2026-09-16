# Voxel Volume → Modular Tile Placement 개발 계획

상태: 구현 대상 및 후속 확장 완료, 조건부/제외 항목 별도 명시 · 기준일: 2026-09-16 · 대상: `Procedural/LevelGeneration`

이 문서는 초기 설계와 후속 개발의 기준이다. 문서 작성 이후 사용자의 개발 요청에 따라 아래 MVP 1~6을 순서대로 구현하고 검증했다. 실행 방법과 구현 경계는 [README](README.md), 실측 결과는 [benchmarks/README](benchmarks/README.md)에 기록한다. 아래 초기 목표 수치와 후속 확장 항목을 구현 완료나 성능 보장으로 해석하지 않는다.

## 구현 현황 — 2026-09-16

| 단계 | 결과 | 검증 근거 |
| --- | --- | --- |
| 1. Headless 수직 절편 | 완료 | 단일/인접/밀폐 공동의 정확한 6/10/54 외피, 공유면·공동 제외, 모든 하부면과 여섯 정수 기저 |
| 2. 단차·외부 특징 | 완료 | 성분별 Roof/Terrace, base/overhang, convex/concave/flat, 모서리·꼭짓점 접촉 진단, 대각 틈의 6-연결 규약 |
| 3. Tile Contract·Trace | 완료 | Catalog/Rule 검증, priority/ASCII 동률, 후보 탈락, coverage 경쟁/누락/중복, fallback |
| 4. 재현·Golden | 완료 | canonical 입출력, 알려지지 않은 버전/metadata 거부, 두 후보·Seed 재현, Hash 벡터, 10개 공통 Golden |
| 5. 비교 Viewer | 완료 | Three.js 공유 패널, 원본/분석/배치 레이어, 법선/Edge, 면 선택·Trace, 하부 카메라 smoke |
| 6. 편집·저장·측정 | 완료 | 좌표/선택 면 단일 셀 편집, JSON 저장/불러오기, 오류 표시, E2E 2건, 대표 11개 입력 측정 |
| 7. Surface Region / Facade | 완료 | 낮은 별동/테라스 분류, 영역 경계, 창문/중앙 출입구/상단 띠, 건물별 색상, 공유 패널 도안, v2 저장과 v1 호환 |
| 8. 입체 Asset / Style | 완료 | 공유 프레임·2면 Corner·N-cell 지붕·처마, 3종 지붕, 실제 Mesh 경계/접합/coverage, v3 저장 |
| 9. 대량 편집 / 이력 | 완료 | Box 추가·삭제, 영역 Extrude/깎기, Undo/Redo·단축키, 실패 이력 보존 |
| 10. 도시 부피 입력 | 완료 | Seed/필지/도로 간격/높이/밀도/중앙 광장, 일반 Grid 경로와 편집·저장 통합 |
| 11. 최종 감사 / 포팅 준비 | 완료 | 버전별 Golden, 67개 테스트·E2E 4건, 75개 성능 조합, PORTING_CONTRACT와 완료 증거 |

현재 `npm run verify`: Application/Core 타입 검사, 테스트 67건과 production build 통과. 브라우저 시나리오 4건 및 마지막 부착 모듈 검증이 통과했다. `npm run measure`: 15개 입력 × 5개 스타일, 조합별 warm-up 10회/측정 50회 완료. 전체 CPU 최대 p95 24.3ms, 입체 스타일 최대 22.7ms다. GPU 완료/화면 표시 시간은 제외한다. 항목별 최종 증거와 명시적 제외/조건부 범위는 [COMPLETION_PLAN](COMPLETION_PLAN.md), 버전별 이식 기준은 [PORTING_CONTRACT](PORTING_CONTRACT.md)에 기록했다. 아래 초기 계약은 v1의 기준으로 보존하며, Region/Facade는 v2, 입체 조립은 v3에 명시적으로 추가했다.

## 목표와 범위

사용자가 Voxel/Grid로 건물의 부피를 만들면, 형태와 이웃 관계를 분석하여 외벽·지붕·테라스·하부면의 역할을 자동 판단하고 기존 Modular Tile을 배치한다. 사용자가 면마다 역할을 지정하는 방식은 핵심 해법으로 사용하지 않는다.

```text
Grid → Shape Analysis → Rule Evaluation → Tile Selection / Placement → Visualization
```

Miniopolis는 장기적인 배치 품질과 완성도, Townscaper는 단순한 입력에서 구조가 만들어지는 경험의 참고다. 두 게임의 내부 알고리즘을 가정하거나 재현하는 계획은 아니다. 우선순위는 `Correctness → Observability / Debuggability → Algorithm Quality → Editor UX → Performance → Visual Quality`다.

**Occupied Cell은 연속된 건물 부피의 일부**다. 최종 Voxel 그래픽, 방 하나, 독립된 건축 부재가 아니다. 인접한 Occupied Cell의 공유면에는 Tile, Mesh, 칸막이, 내부 표면을 일절 만들지 않는다.

생성 대상은 외부와 연결된 빈 공간에 접한 외피와 이후 그 외피에 부착할 요소다. 외벽, 외부 상면, 외부 코너·경계, 돌출부 하단, 건물 전체의 외부 바닥면을 포함한다. **하부면도 다른 면과 동일한 외피 조건으로 반드시 생성**한다. 지면 높이, 지형과의 겹침, 카메라 방향, 현재 가시성은 Core 입력이나 생성 생략 조건이 아니다.

내부 방·복도·칸막이·층별 내부 바닥·천장·실내 구성과 밀폐 공동의 표면은 생성하지 않는다. 외피 판별을 위한 최소한의 빈 공간 연결성 분석은 허용한다. 지형 생성 및 지형에 의한 표면 제거는 범위 밖이다.

### 초기 지원 형태와 실패 정책

초기 형태는 정육면체 Grid의 축 정렬 부피다. 직육면체, L형, 오목한 외부 코너, 평평한 단차, 블록형 돌출부, 외부로 열린 홈·통로, 밀폐 공동을 지원한다. 분리된 부피는 독립적인 6-연결 성분으로 처리하며 자동 연결하지 않는다. 구조 안전성이나 실제 통행 가능성을 판정하는 시스템은 아니다.

초기 입력 상한은 축별 점유 AABB 길이 32 Cell, 좌표 절댓값 1,000,000 이하인 정수로 정한다. 최대 점유 수는 32³이며 외부 공기 분석용 한 겹 padding을 포함한 탐색 공간은 최대 34³이다. 이는 작은 Reference Implementation을 위한 **안전 한도**이며 성능 보장 수치가 아니다.

빈 입력은 정상적인 빈 결과를 반환한다. 중복 Cell은 집합으로 정규화한다. 비정수·범위 초과·잘못된 Catalog·알 수 없는 버전은 명시적인 오류로 거부한다. 실패한 생성과 이전의 유효한 결과를 UI에서 구분하여 오래된 결과를 새 결과처럼 표시하지 않는다.

면이 아니라 모서리·꼭짓점만으로 접촉하는 비다양체 경계는 건축 특징 해석의 지원 범위 밖이다. 해당 위치를 진단하고 Corner 추론 없이 기본 면 덮기 결과만 `degraded` 상태로 제공한다. 경사·곡면·아치·박공지붕, 방/층 해석, N-cell Tile, 장식은 MVP에 포함하지 않는다. 지원하지 않는 Style 요청을 조용히 다른 Style로 대체하지 않는다.

## 최소 책임 경계와 데이터 계약

Core는 순수 TypeScript 데이터와 함수로 Grid 정규화, 형태 분석, Rule 평가, 배치를 수행한다. Three.js, DOM, Browser API, 파일 I/O, 시계에 의존하지 않고 headless로 실행한다. Application이 입력/저장/편집과 실행 순서를 관리하고 시간 측정 및 결과 전달을 담당한다. Three.js Adapter는 Catalog의 공유 Asset을 찾아 Placement를 표시할 뿐, 역할이나 Tile을 다시 선택하지 않는다.

TypeScript와 Vitest로 작은 Core 검증부터 시작한다. Vite·Three.js는 시각화 단계에 추가하며, Playwright는 실제 편집·저장 흐름의 자동화가 필요할 때만 도입한다. 패키지 버전과 실행 명령은 해당 구현 단계에서 확인하고 고정한다. 범용 Framework, Plugin System, SDK, Rule Language, 다른 Procedural 프로젝트용 추상화는 만들지 않는다. 지금 Godot 코드는 작성하지 않는다.

아래 표현은 초기 계약이다. 후속 기능의 Class 계층이나 전체 파일 구조를 확정하지 않는다.

| 데이터 | 초기 필수 표현 |
| --- | --- |
| Grid | 중복 없는 정수 좌표 `(x,y,z)` 목록. 입력 순서에는 의미가 없다. Cell은 `[x,x+1] × [y,y+1] × [z,z+1]`의 부피다. |
| Surface | `faceId`, 소유 `cell`, `direction`, `componentId`, 자동 분류된 `role`. 외부 공기와 접한 단위 정사각형 하나다. |
| Feature | 정수 Grid 선분 양 끝점으로 식별한 Edge와 `convex/concave/flat/unsupported` 분류. 초기에는 배치 근거와 Debug용이다. |
| Tile Catalog | `tileId`, `assetKey`, 지원 `roles`, 허용 `orientationIds`, `footprint: unit-face`, `pivot: face-center`. 크기는 1×1, 초기 두께는 0이다. |
| Placement | `placementId`, `tileId`, `faceId`, `position2: [int,int,int]`, `orientationId`, `ruleId`. 한 Placement가 정확히 해당 Face 하나를 덮는다. |
| 생성 결과 | 정렬된 Surface·Feature·Placement, Face별 선택 Trace, 진단, 연산 카운터, `ok/degraded/error` 상태. 시간값은 Application의 별도 측정 결과다. |

초기에는 Face당 한 구조 Tile을 쓰지만 이를 모든 미래 Tile의 불변조건으로 일반화하지 않는다. Multi-cell 대체가 실제 필요해질 때만 coverage를 Face 집합으로 확장한다.

### Grid 좌표와 부착 위치

Core 좌표는 오른손 좌표계, `+Y` 위, `+X/+Z` 수평이며 Grid unit은 1이다. Cell 주소는 중심이 아니라 최소 꼭짓점이다. 외향 단위 법선 `n`에 대해 다음으로 면 중심을 계산한다.

```text
position2 = 2 * cell + (1,1,1) + n
position  = position2 / 2                  // Grid 단위의 실제 부착 위치
worldPosition = displayOrigin + position * displayScale
```

`position2`는 반 Cell 단위 위치를 손실 없이 저장하기 위한 정수다. Cell 주소와 혼용하지 않는다. 예를 들어 `(0,0,0)`의 `+X`면 중심은 `(1,0.5,0.5)`, `-Y`면 중심은 `(0.5,0,0.5)`다. `displayOrigin/displayScale`은 시각화 변환이며 Core의 생성 결과를 바꾸지 않는다.

Asset의 로컬 XY 평면은 `[-0.5,0.5]²`, Pivot은 면 중심, 외향은 로컬 `+Z`다. 초기 허용 회전은 아래 여섯 직교 방향뿐이며 면 내 roll은 0이다. Euler 각이나 부동소수점 Quaternion을 저장하지 않고 `orientationId`로 전달한다.

| ID / 법선 n | 로컬 X의 월드 방향 u | 로컬 Y의 월드 방향 v |
| --- | --- | --- |
| `PX` / `(1,0,0)` | `(0,0,-1)` | `(0,1,0)` |
| `NX` / `(-1,0,0)` | `(0,0,1)` | `(0,1,0)` |
| `PY` / `(0,1,0)` | `(1,0,0)` | `(0,0,-1)` |
| `NY` / `(0,-1,0)` | `(1,0,0)` | `(0,0,1)` |
| `PZ` / `(0,0,1)` | `(1,0,0)` | `(0,1,0)` |
| `NZ` / `(0,0,-1)` | `(-1,0,0)` | `(0,1,0)` |

각 행은 `u × v = n`을 만족해야 한다. Adapter는 이 정수 기저로 Transform을 만든다. 향후 면 내 90도 회전이나 두께를 허용할 때에는 Catalog 계약과 맞물림 Fixture를 먼저 확장한다.

## 형태 분석과 자동 역할 판정

### 외피 추출

점유 AABB에 상하좌우앞뒤 한 Cell의 빈 padding을 붙이고, padding의 최소 꼭짓점 Cell에서 빈 Cell만 6-방향 flood fill한다. 이때 도달한 집합이 `exteriorAir`다. 두 Occupied Cell 사이에는 면을 만들지 않으며, Occupied Cell의 이웃이 `exteriorAir`일 때만 그 방향의 Surface를 만든다. 도달하지 못한 빈 Cell은 밀폐 공동이므로 그 경계에도 Surface와 Placement를 만들지 않는다.

점유 연결 성분과 빈 공간 연결성 모두 면 공유인 6-연결을 사용한다. 대각선 접촉이나 점 크기의 틈은 외부 통로로 해석하지 않는다. 이 규약은 Godot에서도 유지한다. 아래쪽 padding도 동일하게 탐색하므로 높이 0의 건물 바닥과 공중 돌출부 하단이 별도 예외 없이 포함된다.

Neighbor mask는 고정 방향 순서의 6비트 보조 표현으로만 사용한다. **빈 이웃이라는 국소 정보만으로는 밀폐 공동을 제외할 수 없으므로 외부 공기 판정을 생략하지 않는다.** 탐색 비용은 점유 수가 아니라 padded AABB 부피에도 의존한다. 큰 희소 공간의 최적화는 입력 한도와 실제 측정을 재검토한 뒤 결정한다.

### 상면과 하부면의 기본 정책

점유 Cell의 6-연결 성분별로 `minY/maxY`를 구한다. 성분 ID는 정규 순서에서 가장 작은 Cell 주소다. 초기 `component-height-v1` 정책은 다음과 같다.

| 외부 Surface 조건 | 자동 역할 / 설명 |
| --- | --- |
| 법선 `±X`, `±Z` | `wall` |
| 법선 `+Y`, 소유 Cell의 `y == maxY` | `roof` |
| 법선 `+Y`, 소유 Cell의 `y < maxY` | `terrace` |
| 법선 `-Y` | 항상 `underside`. `y == minY`이면 최하부 바닥, 그보다 높으면 돌출부 등 높은 하부 노출면이라는 Debug 특징을 붙인다. |

외부 하부면은 실내 천장이나 층별 바닥이 아니다. 상면이 최고 높이보다 낮은지는 같은 성분 안에서만 비교하므로 멀리 떨어진 별도 건물의 높이에 영향을 받지 않는다.

**선택 이유:** 단차의 넓은 낮은 상면도 Region 추출 없이 일관되게 Terrace로 해석하고, 위쪽 이웃 한 칸만 보는 규칙이 같은 평면을 Roof/Terrace로 쪼개는 문제를 피한다. **한계:** 연결된 낮은 별동의 지붕도 Terrace가 되고, 접근 불가능하거나 위에 돌출부가 있는 상면도 Terrace일 수 있다. 이는 통행 가능성·실제 건축 용도를 의미하지 않는 시각적 기본 정책이다. 낮은 별동/넓은 단차 Fixture에서 이 해석이 목적에 맞지 않으면, 후속 단계에서 상면 Region과 인접 높은 벽의 관계를 도입한다. 사용자의 면별 역할 지정을 필수 해법으로 삼지 않는다.

### Edge와 Corner

추출한 외부 Face의 네 변을 정수 끝점의 정규 쌍으로 모은다. 같은 평면의 경계는 `flat` 이음선이다. 직교하는 외부 Face가 만나는 Edge는 선분 주변 2×2 점유 단면을 확인하여 점유 사분면 1개면 `convex`, 3개면 `concave`로 분류한다. 외부 Face가 없는 내부 Edge는 특징으로 출력하지 않는다.

대각선 점유가 만나는 Edge나 꼭짓점 주변의 외부 Face 연결이 여러 fan으로 갈라지는 경우는 `unsupported` 위치 진단을 남긴다. 검사는 해당 Edge/Vertex 주변의 작은 이웃만 사용하며 범용 위상 라이브러리를 먼저 도입하지 않는다. 초기 Corner 표현은 이러한 특징과 서로 직교하는 면 Tile의 맞물림으로 충분한지 검증한다. 독립적인 3D Corner Tile 선택은 아직 하지 않는다.

초기 선택은 `외부 공기 flood fill + exposed faces + 점유 성분 높이 + 국소 Edge 특징`이다. Region, Polygon decomposition, 일반 Shape Grammar는 현재 최소 Fixture를 해결하는 데 필요하지 않으므로 보류한다. WFC/Socket/Wang Tiles도 채택하지 않는다. 초기 Tile은 동일한 단위 경계로 맞물리며 후보 간 제약 전파 문제가 아직 없다. 실제 Asset에서 이웃 선택에 따른 접합 실패가 관측될 때만 작은 사례로 추가 이점을 비교한다.

## 초기 Tile Set과 Rule 처리

### 최소 Asset 구성과 덮기 소유권

기본 Catalog는 네 ID `panel.wall`, `panel.roof`, `panel.terrace`, `panel.underside`로 시작한다. 네 ID는 **같은 unit panel Primitive Mesh**를 재사용하고 역할별 색/라벨만 다르게 표시한다. 아래쪽 Tile은 `NY` 부착으로 동일 Mesh를 뒤집어 사용한다. 벽 4방향, 상면 `PY`, 하부면 `NY`만 각 ID의 초기 허용 방향으로 등록한다.

Placeholder Mesh는 Adapter 초기화 때 한 번 만들거나 공유 Asset으로 준비하고 인스턴스/공유 Mesh로 배치한다. Voxel마다 최종 vertex/index/UV를 생성하는 Procedural Mesh 시스템을 구현하지 않는다. 디버그 선분 표시는 최종 건축물 생성과 별개다.

초기 구조 Tile은 두께 0의 정확한 면을 덮는다. 인접 면은 Grid 경계를 공유하며 면적이 있는 겹침이나 틈이 없어야 한다. Wall, Roof, Terrace, Underside에 서로 다른 임의 offset이나 epsilon을 주지 않는다. 이 정책은 논리적 접합을 검증하기 위한 것으로, 실제 두꺼운 Asset의 접합 품질이 확보되었다는 뜻은 아니다.

초기에는 Corner Tile이 없으므로 Wall과 Corner의 중복 덮기도 없다. 후속 Corner Asset이 필요하면 해당 Corner가 대체할 Face/부분 면 범위를 먼저 정의하고, 기존 Wall 소유권을 제거한 뒤 **대체**한다. coverage가 단위 Face 전체로 표현되지 않는 Asset은 계약 확장 전 Catalog에 받지 않는다. Corner를 기존 Wall 위에 단순 추가하여 문제를 숨기지 않는다.

구조 충돌은 동일 Face coverage를 두 개 이상 차지하거나 Asset이 약속한 영역을 침범하는 경우다. 서로 다른 직교 면이 Edge만 공유하는 것은 충돌이 아니다. 장식 Tile은 향후 별도 부착/겹침 허용 규칙으로 구조 Tile과 의도적으로 겹칠 수 있지만, 구조 coverage를 대신 충족하지 않는다. MVP에는 장식 배치 및 범용 공간 충돌 해결기를 넣지 않는다.

### 명시적 선택과 설명 가능한 실패

Rule은 TypeScript의 작은 데이터 테이블과 순수 조건 함수로 작성한다. 초기 Rule은 `role.wall`, `role.roof`, `role.terrace`, `role.underside`이며 각 Surface의 자동 역할, 방향, Style과 Catalog 호환성을 검사한다. JSON DSL이나 임의 스크립트 실행은 제공하지 않는다.

처리 순서는 다음과 같이 고정한다.

1. Face를 정규 순서로 순회하며 Rule의 조건 결과와 근거 특징을 기록한다. Rule은 `priority` 내림차순, 동률이면 ASCII `ruleId` 오름차순으로 평가한다. 기본 역할 Rule priority는 100이다.
2. 매칭 Rule 안에서 역할·방향·footprint가 호환되는 Tile만 남기고 `tileId` 오름차순으로 정렬한다. 첫 번째로 비어 있지 않은 후보 집합을 제공하는 Rule이 이긴다. 더 높은 Rule에 적합한 Tile이 없으면 그 이유를 기록하고 다음 Rule을 평가한다.
3. 그 후보 집합에서 아래 결정론 계약으로 하나를 선택한다. v1은 한 Face에 한 구조 Placement만 허용한다. 이후 경쟁 제안은 앞서 확정된 소유권을 덮어쓰지 않고 패자/이유를 Trace에 남긴다. 중복 Rule/Tile ID는 동률 처리 대상이 아니라 입력 오류다.
4. 모든 일반 Rule이 실패하면 최하위 fallback인 `fallback.unit-panel`을 사용한다. 예약 Tile `debug.missing`은 같은 단위 면 Asset을 재사용하며 모든 방향을 지원한다. 누락 위치를 가리지 않고 `degraded`와 원인 진단을 반환한다. 정상 Fixture에서는 fallback 0건이 완료 조건이다.

`debug.missing`은 다섯 번째 건축 카테고리가 아니라 오류 표시용 공유 패널이다. 이 fallback조차 계약을 만족하지 못하면 명시적 오류를 반환하며 성공으로 보고하지 않는다. 누락을 조용히 건너뛰지 않는다.

Face별 Trace에는 입력 특징/정책, 매칭 및 탈락 Rule과 조건, 후보 Tile과 탈락 이유, 최종 선택 기준, coverage 경쟁 결과, fallback 여부를 남긴다. 선택된 Tile만 나열하거나 자연어 이유를 사후 추측하지 않는다. Renderer에서 Face/Tile을 선택하면 같은 Trace를 확인할 수 있어야 한다.

## 결정론과 저장 계약

초기 필수 요구는 **동일한 전체 입력과 버전에서 동일한 정렬 결과**다. 부분 편집 후 다른 위치의 변형 유지라는 편집 안정성은 후속 요구이며, 성분 높이/역할이 바뀌면 주변 결과가 달라질 수 있다.

| 항목 | v1 규약 |
| --- | --- |
| Cell 순서/ID | 정수 `(x,y,z)`의 숫자 사전식 오름차순. ID는 부호 있는 10진수 `x,y,z`, 선행 0 없음, `-0`은 `0`. |
| 방향/Face ID | 순서 `PX,NX,PY,NY,PZ,NZ`; mask bit도 0..5로 일치시킨다. ID는 `x,y,z\|DIR`, 정렬은 Cell 숫자 순서 후 방향 순서다. |
| 성분/Edge | 성분 ID는 최소 Cell. Edge는 끝점을 Cell과 같은 숫자 비교로 정렬한 쌍이며 Edge 목록도 끝점 순서로 정렬한다. Region은 미도입이다. |
| Rule/후보 | priority 내림차순 후 고유 ID ASCII 코드 순서. Catalog/Rule 입력 배열 순서, Map/Set 삽입 순서, localeCompare에 의존하지 않는다. |
| 선택 Hash | 아래 `h33-u32-v1`로 후보 index를 정한다. `Math.random()` 및 전역 순회 RNG 상태를 사용하지 않는다. |
| 충돌/출력 | 정규 Face 순서에서 우선 Rule 하나만 coverage 소유. `placementId = p:<faceId>`. 최종 Placement는 Face 순서, 이후 ruleId/tileId 순으로 정렬한다. |
| 수치 | Grid와 position2는 정수, 회전은 여섯 ID. 부동소수점 계산으로 Rule/충돌을 판정하지 않는다. 시간/카메라/Renderer 상태는 결과에서 제외한다. |

ID의 표에 표시한 `\|`는 Markdown 표 구분자 이스케이프다. 실제 ID에는 역슬래시 없이 `|` 하나를 쓴다. ID는 ASCII 문자로 제한하고 한국어 표시명은 별도다.

초기 Hash는 통계적 품질보다 포팅의 단순성을 선택한 규약이다. `h = seed`로 시작하여 `faceId + "|" + ruleId`의 ASCII byte `b`마다 `h = (h * 33 + b) mod 4294967296`을 수행한다. Seed는 0..4294967295의 정수이며, 후보 수 `n`에 대해 `index = h mod n`을 사용한다. 중간 계산은 정확한 정수로 수행하고 각 byte 처리 후 unsigned 32-bit 범위로 줄인다. Godot에서는 64-bit 정수 중간값을 사용한다. Hash를 Face ID나 충돌 없는 입력 식별자로 사용하지 않는다.

후보가 하나이면 Seed가 달라도 같은 Tile이 나오는 것이 정상이다. 두 호환 후보를 가진 작은 시험용 Catalog로 선택 재현을 검증한다. Hash 자체의 공통 벡터는 `(seed=0, text="A") → 65`, `(0,"AB") → 2211`, `(4294967295,"A") → 32`로 고정한다. 실제 Face key와 최종 Placement golden도 함께 저장한다. 변형의 시각적 반복이 문제가 되면 버전을 바꾸어 선택기를 재검토한다.

저장은 JSON 한 문서로 하며 `schemaVersion`, `algorithmVersion`, 정규화된 Grid, Seed, Catalog ID/version 및 **실제 사용한 metadata 전체**, Rule Set ID/version, Style ID/version 및 해석 완료된 생성 설정을 담는다. 설정에는 Grid unit, `component-height-v1`, 연결성/입력 한도 등 결과에 영향을 주는 정책이 포함된다. 생략된 기본값도 저장 시 명시한다. Rule 코드는 저장하지 않으며 해당 ID/version의 내장 Rule 구현과 정확히 일치해야 한다.

동일 ID/version에 다른 내용의 Catalog/Rule을 배포하지 않는다. 알 수 없는 schema/알고리즘/Rule/Style 버전이나 metadata 불일치는 load 시 거부한다. 별도의 마이그레이션 Framework는 만들지 않는다. canonical export는 객체 key를 재귀적으로 ASCII 오름차순으로 정렬하고, 배열은 위 정규 순서(그 외 ID 목록은 ASCII 순서)로 정렬한다. 공백 없는 JSON, 정수 표기, UTF-8, 마지막 LF 한 개를 사용한다. UI 선택 상태, 실행 시간, 카메라는 재현 입력에서 분리한다.

초기에는 Placement를 저장한 결과만 믿는 대신 입력을 다시 생성하여 비교한다. fixture JSON의 기대 출력에는 정렬된 Face ID/역할, Tile ID, position2, orientationId, ruleId, 필요한 특징과 결정적 Trace가 들어간다. Godot 포팅은 동일 입력/기대 데이터를 그대로 읽어 엔진 표시 전에 비교하는 방식으로 시작한다.

## Fixture, Debug View와 성능 관찰

아래 숫자는 규칙에서 도출한 **기대값**이다. 이번 문서 작업에서 알고리즘을 실행해 얻은 실측값이 아니다. `box(a,b,c)`는 원점부터 각 축 길이만큼 채운 직육면체다.

| Fixture | 핵심 기대 결과 |
| --- | --- |
| 단일 `(0,0,0)` | 외피/Placement 6개: Wall 4, Roof 1, Underside 1. 여섯 방향과 반 Cell 좌표 확인. |
| X 인접 두 Cell | 총 10개: Wall 6, Roof 2, Underside 2. 공유면 2개 모두 없음. |
| `box(2,2,2)` | 외피 24개: Wall 16, Roof 4, Underside 4. 내부 공유면 없음. |
| L: `(0,0,0),(1,0,0),(0,0,1)` | 외피 14개: Wall 8, Roof 3, Underside 3. 볼록 Edge와 `(1,y,1)`의 오목한 수직 Edge를 구분. |
| 단차: `(0,0,0),(1,0,0),(1,1,0)` | 외피 14개: Wall 10, Roof 1, Terrace 1, Underside 2. 낮은 상면의 자동 Terrace 확인. |
| 돌출: `(0,0,0),(0,1,0),(1,1,0)` | 외피 14개: Wall 10, Roof 2, Underside 2. y=0의 바닥과 y=1의 떠 있는 하부면 각각 1개. |
| 밀폐 공동: `box(3,3,3)`에서 `(1,1,1)` 제거 | 외피 54개: Wall 36, Roof 9, Underside 9. 공동에 접한 6면은 0개. |
| 열린 공동: 위 형태에서 `(1,1,0)`도 제거 | 외피 62개. 새로 외부와 연결된 홈의 면을 포함하여 폐쇄/개방의 차이를 검증. |

공유면 수가 같다는 이유만으로 통과시키지 않는다. 정확한 Face ID 집합과 Placement coverage를 비교하고, 모든 외피 Face에 소유자가 정확히 하나인지, 내부/공동 Face의 소유자는 0인지 검사한다. 변환된 Tile 꼭짓점이 해당 Face의 네 Grid 꼭짓점과 일치하고 인접 면이 경계를 공유하는지도 데이터로 검증한다.

위 Fixture를 재사용해 Cell·Catalog·Rule 순서 섞기, 동일 입력 반복, 음수 좌표 평행 이동, 다른 높이로 전체 이동, save/load round-trip을 검증한다. 오류용 최소 사례로 중복 ID, 후보 없음, 입력 한도 초과, 모서리/점 접촉을 추가한다. Corner/경계는 개수만 아니라 위치·종류를 확인한다. 성분별 높이 정책은 서로 다른 높이의 분리된 두 부피로 추가 확인한다.

Debug View는 원본 Voxel, 분석된 Surface/법선/볼록·오목 Edge, Tile Placement를 독립 토글/비교한다. 원본 부피와 Tile을 동시에 볼 때의 투명도나 표시용 offset은 Adapter의 Debug 옵션일 뿐 생성 좌표를 변경하지 않는다. 선택 패널은 Cell/Face ID, 역할, Rule, 후보, 탈락 이유와 최종 선택을 표시한다. 아래에서 보는 카메라 preset으로 바닥과 돌출부 하단을 확인한다. Screenshot은 보조 증거이고 Core 정합성의 판정 기준이 아니다.

Application에서 점유 수, padded 탐색 Cell 수, 분석 Face 수, Rule 조건 평가 수, Placement 수를 표시한다. 분석 시간, Rule/Placement 생성 시간, Renderer 동기화 시간, 전체 생성 시간을 각각 기록한다. Face 수는 추출된 외피 Face 수, Rule 평가 수는 실패와 fallback을 포함한 실제 조건 검사 횟수다. Core에는 연산 카운터만 두고 시계는 주입하지 않는다. 전체 시간은 정규화 시작부터 Adapter 동기화 완료까지의 실제 경과 시간이며, 비동기 GPU 완료/다음 화면 표시까지의 시간과 혼동하지 않는다.

성능 대표 입력은 작은 Fixture 묶음과 16×16×8 범위의 조밀한 부피/단차/돌출 시나리오로 시작한다. 입력·Seed·버전·점유/Face 수·기기·브라우저·빌드 모드를 함께 기록하고, warm-up 10회 후 전체 재생성 50회의 p50/p95를 남긴다. 초기 목표는 이 대표 입력에서 CPU 전체 생성 p95 100ms 이하로 제안하되 **미검증 UX 목표**다. MVP 완료에 필요한 것은 측정과 병목/목표 차이의 기록이며, 아직 이 수치를 달성했다고 전제하지 않는다. Region 도입 후에만 Region 수와 분석 비용을 추가한다.

## 초기 MVP: 구현 순서와 종료 기준

MVP는 아래 **6개 작업**으로 나눈다. 각 작업은 제한된 변경과 해당 검증을 끝낼 수 있는 단위다. 앞 단계의 계약/Fixture를 검증한 뒤 다음 단계로 진행한다. 아래는 구현에 사용한 초기 작업 분해이며, 경로는 모두 `Procedural/LevelGeneration/` 기준이다. 최종 책임 분할과 실제 파일은 README를 따른다.

### 1. 고정 Fixture의 headless 수직 절편

- 목표: 점유 정보와 외부 공기만으로 공유면·공동을 제외하고 하부면까지 기존 패널 배치 데이터로 표현할 수 있는지 검증한다.
- 범위: 최소 TypeScript/Vitest 환경, 정규 Cell 순서, padding flood fill, 외부 Face 추출, 방향별 Wall/Roof/Underside 기본 Rule, 공유 unit panel Catalog와 정수 Transform. 첫 세 검증 입력은 단일 Cell, X 인접 두 Cell, 밀폐 공동이다.
- 주요 변경: 최소 패키지/타입 검사 설정과 `src/core/generate.ts`, `tests/generate.test.ts`, `fixtures/single.json`, `fixtures/adjacent-x.json`, `fixtures/sealed-cavity.json` 정도만 제안한다. 작은 데이터 타입/Rule 표는 우선 함께 두고 필요 전에는 계층을 분할하지 않는다.
- 제외: 성분별 단차 정책, Edge 특징, 변형 선택 확장, Browser/Editor/Renderer, 실제 Asset, 성능 최적화.
- 검증/완료/진입: 세 입력의 6/10/54개 **정확한** Face/Placement와 공유면·공동 0개, 모든 하부면, 여섯 Transform, 입력 순서 불변성을 Vitest와 타입 검사로 통과한다. 이 수직 절편이 통과해야 2로 간다.

### 2. 단차 의미와 외부 특징

- 목표: 수동 면 태그 없이 단차와 돌출부를 설명하고 코너 특징을 재현한다.
- 범위: 점유 성분/minY/maxY, `component-height-v1`, 하부 특징, 외부 Edge convex/concave/flat, 국소 비다양체 진단과 기본 면 fallback. Region/별도 Corner Asset은 제외한다.
- 주요 변경: 기존 Core 분석 부분과 Fixture/기대 데이터 확장. 분석이 분리될 만큼 커진 경우에만 인접 파일로 나눈다.
- 검증/완료/진입: 나머지 표의 형태, 분리 성분, 대각 접촉에서 정확한 역할/Edge 위치/진단 확인. 모든 외피 coverage가 유지되고 단차의 Terrace 및 돌출 하부면이 확인되면 3으로 간다.

### 3. Tile Contract, 선택 충돌과 Trace

- 목표: Tile 선택 이유와 누락/경쟁을 재현 가능한 데이터로 설명한다.
- 범위: Catalog 검증, priority/동률 처리, 후보 필터, Face 소유권, fallback, 결정적 Trace. 범용 제약 해결기와 장식은 제외한다.
- 주요 변경: 선택 처리와 결과 Trace, 계약/오류 Fixture 보강. 단위 패널 외 Asset schema는 추가하지 않는다.
- 검증/완료/진입: Rule 동률/후보 순서/후보 없음/중복 ID 테스트, coverage 중복·누락 탐지, 모든 정상 Fixture의 fallback 0건, 선택·탈락 근거 확인. 계약 위반을 조용히 통과시키지 않으면 4로 간다.

### 4. 재현 입력과 공통 Golden

- 목표: 같은 전체 입력과 버전에서 같은 결과를 저장·재생성하고 포팅의 기준을 고정한다.
- 범위: Seed 선택 규약, 두 호환 후보 시험, canonical JSON 입출력, 버전 검증, 엔진 독립 golden. 편집 안정성/마이그레이션은 제외한다.
- 주요 변경: 필요한 작은 직렬화 함수와 fixture 입력/기대 출력, Hash 벡터. 별도 저장소/버전 Framework는 만들지 않는다.
- 검증/완료/진입: 순서 교란·반복·round-trip 후 정렬 결과/결정적 Trace 동일, 알 수 없는 버전 거부, Hash 세 벡터 통과. 브라우저 없이 재현 가능한 공통 Fixture가 완성되면 5로 간다.

### 5. 읽기 전용 비교 Viewer

- 목표: Voxel → 분석 → Placement와 선택 이유를 눈으로 추적한다.
- 범위: 이때 필요한 만큼만 Vite·Three.js 추가, 공유 Primitive, 고정 Fixture 선택, 표시 토글, Face/Tile 선택과 Trace, 하부 카메라. 편집기/고급 재질/Blender는 제외한다.
- 주요 변경: 최소 Application 진입점과 Three.js Adapter; 이 둘이 Core의 생성 판단을 복제하지 않는지 확인한다.
- 검증/완료/진입: Core 테스트와 해당 프로젝트의 타입/빌드 검사, Viewer 수동 smoke. 세 표현을 비교하고 하부면/선택 근거를 확인하며, 카메라를 바꿔도 Placement가 동일하면 6으로 간다. Screenshot만으로 Core를 승인하지 않는다.

### 6. 작은 편집·저장 흐름과 측정

- 목표: 작은 부피를 수정하고 재현 입력을 저장·불러오는 MVP 사용자 경험을 완성한다.
- 범위: 정수 좌표 입력 또는 단일 Cell 추가/삭제, 전체 재생성, JSON 저장/불러오기, 오류/상한 표시, 계수·단계별 시간. Box/Extrude/Undo, incremental, Worker는 제외한다.
- 주요 변경: Application의 작은 편집/파일 연결과 측정 표시. Browser API는 Core 밖에 둔다.
- 검증/완료: 단일 Cell → 단차/돌출 수정 → 저장 → 새 상태에서 불러오기 후 결과 동일을 확인한다. UI 연결 검증 자동화가 필요하면 이 흐름 하나에만 Playwright를 도입한다. 카메라·표시용 지면 높이를 바꿔도 하부 Placement가 유지되어야 하며, 대표 입력 측정 기록을 남긴다.

**MVP 종료:** 작은 부피를 입력/수정하고, 공유면·밀폐 공동 없이 외피가 자동 배치되며, 단차의 Roof/Terrace와 바닥/돌출 하부면을 확인할 수 있다. 원본·분석·배치 비교와 선택 근거 조회, 입력 저장/재현, 결정론 Fixture, 중복/누락 진단 및 기초 측정이 모두 가능하면 종료한다. 고품질 Asset, 모든 건축 형태, 고급 편집 UX, Godot 실행은 이 종료 조건에 포함하지 않는다.

## 후속 마일스톤과 조건부 확장

아래는 초기 확장 조건이며, 현재 결과를 각 항목 끝에 기록한다. 미구현 기술을 구현 완료로 표시하지 않는다.

**의미/배치 품질:** 낮은 별동 정책의 실패 사례 또는 반복 창문·입구·넓은 테라스 요구가 생기면 필요한 Surface Region/Facade 규칙을 도입한다. 먼저 기존 정책과 비교할 Fixture와 기대 해석을 고정한다. 다양한 지붕은 지원 형상과 경계 Tile을 작은 Catalog 단위로 추가한다.

완료: v2의 낮은 별동/넓은 테라스 Fixture와 영역/파사드, v3의 직사각형 우진각·박공·평지붕을 구현했다. 지원하지 않는 접합 형상은 동일 Style의 평지붕을 유지하고 보류 근거를 남긴다.

**Asset/Style:** 실제 제작 Asset은 두께·Pivot·경계 맞물림 테스트를 통과한 뒤 적용한다. 추가 Style, Corner 대체, N-cell Tile은 기존 단위 패널로 표현할 수 없는 구체적 사례가 있을 때만 계약을 확장한다. 상세 장식은 구조 coverage와 의도적인 겹침을 분리해 도입한다. Blender 작업과 고품질 Material은 이 단계의 일이다.

완료: 고정 공유 Mesh recipe와 Material을 제작했고 모든 Asset의 bounds/두께와 접합을 검증했다. 두 면을 대체하는 Corner, N-cell 지붕, coverage 없는 처마/모서리 cap과 선택 근거를 구현했다. Asset 제작은 코드로 관리하는 공유 prototype 방식을 사용하며, 검증 가능한 geometry와 Material을 제공한다.

**Editor UX:** 단일 Cell 편집이 실제 사용을 막는 시점에 Box 편집, Extrude, Undo/Redo를 추가한다. 형태 판정을 수동 Wall/Roof 태그 UI로 대신하지 않는다.

완료: 여러 건물 부피를 다루도록 Box/영역 Extrude·깎기/Undo/Redo/단축키와 도시 입력 생성을 추가했다. 역할 수동 태그 없이 매번 전체 분석으로 재생성한다.

**성능:** 우선 전체 재생성의 병목과 목표 응답 시간의 차이를 측정한다. 반복 측정에서 초과가 확인되고 분석/선택 비용이 원인일 때만 Incremental Regeneration을 검토한다. 한 Cell이 공동을 개방하거나 성분을 합치면 멀리 떨어진 외피/역할도 달라지므로 단순 이웃 반경 갱신의 정확성을 가정하지 않는다. Renderer가 병목이면 공유 Mesh/배치 동기화를 먼저 점검한다. Worker는 UI 차단과 통신 비용, WASM/GPU Compute는 실제 연산 병목 및 전송 비용의 순이익이 입증될 때만 별도 실험한다.

조건 종결: 대표 입력 CPU p95가 100ms 목표 이내여서 Incremental/Worker/WASM/GPU 도입 조건이 충족되지 않았다. 현재 구현은 결정적인 전체 재생성과 공유 Asset을 유지한다. 모든 기기/최대 32³ 성능을 보장하지 않는다.

**Godot 준비:** 동일 golden을 먼저 headless로 대조하고 그 뒤 MeshInstance3D/MultiMesh 등으로 시각화한다. 유지할 계약은 좌표/단위/Pivot, 여섯 정수 기저, 외부 공기 6-연결, 역할 정책, ID·정렬·Hash 연산, Catalog/Rule 버전, coverage/Trace다. 엔진의 Transform 생성·렌더링 순서는 달라도 Core의 정렬 Placement는 같아야 한다. 이 문서는 지금 Godot API 구현이나 포팅 성공을 주장하지 않는다.

준비 완료: v1/v2/v3의 공통 입력/출력 Golden과 Hash 벡터, 모듈 변환/coverage 계약 및 검사 순서를 제공한다. 실제 Godot 실행은 원 계획의 현재 제외 범위로 남으며 수행했다고 주장하지 않는다.

## 주요 위험과 가장 먼저 검증할 가정

| 가정 또는 Open Question | 검증 방법 | 결정 시점 |
| --- | --- | --- |
| 외부 공기 + 단위 면 Tile로 기본 외피를 빠짐없이 표현할 수 있다. | 첫 작업의 공유면/공동/하부면과 Transform golden. | 1 완료 전. 실패하면 Viewer보다 계약 수정 우선. |
| 6-연결 공기가 열린 홈/공동의 의도에 맞는다. | 공동 개방 쌍, 대각 틈, 비다양체 진단 비교. | 2 완료 전 기본 규약 고정. |
| 성분 최고 높이 정책이 단차 검증에 충분하다. | 단차, 분리 성분, 낮은 별동, 가려진 낮은 상면 비교. | 2에서 기본값 확정; 품질 실패 시 MVP 후 Region 재검토. |
| 두께 없는 공유 패널로 Corner Asset 없이 논리적 이음을 검증할 수 있다. | 꼭짓점/Edge 일치 검사와 L/돌출 Viewer. | 3 및 5. 실제 Asset 적용 전 별도 두께 계약 결정. |
| 기본 전체 재생성이 초기 편집에 충분하다. | 지정 대표 입력의 단계별 p50/p95와 목표 차이 기록. | 측정 완료, 대표 입력 목표 이내. 상세 기록은 benchmarks/latest.json. |
| 간단한 Hash와 정수 Transform이 엔진 간 충분히 재현된다. | TS golden/Hash 벡터를 만들고 향후 Godot에서 그대로 비교. | 4에서 계약 고정, Godot 포팅 시 실제 교차 검증. |

이 결정들은 요구사항에서 도출한 초기 정책이며 외부 게임 구현이나 성능 연구 결과에 의존하지 않는다. 이번 문서에는 확인되지 않은 구현 방식/벤치마크를 사실로 인용하지 않는다.

## 초기 계획 문서 작성 당시의 검토 이력

초기 계획 작성 시 확인한 저장소 기준은 main의 `9b5ee2954a3338f5e6e3360148c6b310e3e6d34e`다. 루트 `AGENTS.md`를 확인했으며 당시 `Procedural` 및 대상 폴더에 별도 지침/기존 계획 문서는 없고 대상에는 `.gitkeep`만 있었다. Navigation 전용 불변조건은 이 프로젝트의 요구로 복사하지 않는다.

초기 변경은 이 문서 한 파일을 작성하고 계약·기대값·범위의 논리적 일관성을 검토한 작업이었다. 이번 구현은 `Procedural/LevelGeneration` 안에 한정했고, 별도 프로젝트인 Navigation/Crowd의 기존 작업과 artifacts는 변경하지 않았다. 검증 명령은 이 프로젝트의 패키지에서만 실행했다.

## 초기 권장 구현 절편 — 구현 완료

**작업 하나: 세 개 고정 Fixture로 외피 추출 → 단위 패널 Placement의 headless 수직 절편을 구현한다.**

- 검증할 핵심 가정: 점유 부피와 외부 공기의 6-연결성만으로 공유면/밀폐 공동을 제외하면서 외부 바닥을 포함한 완전한 단위 외피를 구하고, 기존 패널의 ID/정수 Transform만으로 이를 덮을 수 있다.
- 최소 범위: 단일 Cell, X 인접 두 Cell, 3³ 밀폐 공동 Fixture; padding flood fill, 노출 Face, 방향별 기본 Wall/Roof/Underside 선택, 한 Face당 한 Placement, 정규 순서와 여섯 기저. 초기 Catalog는 공유 panel metadata이며 실제 Mesh는 만들지 않는다. 개발환경도 이 검증에 필요한 TypeScript/Vitest/타입 검사만 준비한다.
- 제외 범위: 단차의 성분 높이 정책, Corner/Region, 완성형 Rule 처리기, 저장 UI, Vite/Three.js, Editor, 실제 Asset, Godot, Worker/성능 최적화. 전체 시스템 골격을 먼저 만들지 않는다.
- 초기 변경 파일: `package.json`, lockfile, `tsconfig.json`, `src/core/generate.ts`, `tests/generate.test.ts`, `fixtures/single.json`, `fixtures/adjacent-x.json`, `fixtures/sealed-cavity.json`. 이후 분석·선택·저장 책임이 커져 인접 Core 파일로 분리했다. 별도 Vitest 설정 파일은 필요하지 않았다.
- 통과한 초기 테스트: 외피/Placement 정확한 집합 6/10/54개, 공유면/공동 0개, 하부면 존재, 여섯 방향의 position2/기저/Face coverage 일치, 반복 및 Cell 순서 변경 시 결과 동일. 테스트 코드와 기대 JSON을 구현에 포함했다.
- 완료 조건: 해당 프로젝트의 타입 검사와 위 headless 테스트가 통과하고, Core에 엔진/Browser 의존성이 없으며, 누락·중복·내부면 배치가 0건임을 데이터로 확인한다. 실행 명령과 결과를 구현 작업의 완료 보고에 남긴다.
- 진행 결과: MVP, Surface Region/Facade, 입체 모듈/지붕/처마, 대량 편집과 이력, 도시 부피 입력 및 최종 검증까지 완료했다. 남은 조건부/제외 항목은 위 범위 표와 COMPLETION_PLAN.md에 명시한다.


## 표면 직접 조작 개편 — 2026-09-17

사용자 지정 조작으로 좌표/셀/Box/Extrude 및 Undo/Redo 버튼 UI를 대체했다. 기존 Box/Extrude 데이터 연산은 회귀 계약으로 보존한다.

- 왼쪽 표면 드래그 → release 시 한 층 추가 → 새 표면에 선택 유지 → 좌클릭마다 한 층 추가.
- 오른쪽 드래그/클릭은 동일한 영역에서 제거. 좌·우 클릭을 번갈아도 평면과 면적을 유지한다.
- Esc는 영역 및 진행 중 드래그 해제. 선택 없는 단순 클릭은 편집하지 않는다.
- 마지막 층 제거 뒤에도 가상 선택 평면을 유지하고 다음 추가로 복원한다. 빈 바닥에서 새 부피를 시작할 수 있다.
- 카메라: 가운데 드래그 회전, Shift+가운데 드래그 이동, 휠 확대. 문서 변경/Undo/Redo는 이전 편집 선택을 해제한다.
- 드래그 중은 미리보기만 표시한다. 포인터 취소·포커스 이탈·뷰포트 밖 release는 커밋하지 않는다. 범위/충돌 오류는 부피와 이력을 보존한다.
- 표시 레이어와 상세 Inspector를 접어 기본 UI를 단순화했다. 스타일, 도시 생성, 저장/불러오기, 카메라 프리셋은 유지한다.
- 검증: 타입 검사, 단위/회귀 71건, production build, 브라우저 7개 시나리오 통과. 기존 성능 기록은 이전 측정값이며 새 수치로 갱신하지 않았다.


## 데이터 기반 건축 스타일 — 2026-09-17

구현·검증 완료. 상세한 공식 발표 근거/우리 정책/지원 문법/제약은 [BUILDING_STYLE_PLAN.md](BUILDING_STYLE_PLAN.md)에 기록한다.

- typed BuildingStyle, LevelDefinition, BuildingModule, FacadePattern과 정수 해석기를 추가했다. 상가형·업무형은 프로젝트 고유 예시다.
- ground/middle/top, 성분 바닥 Y=0의 단일 정면 출입구, 로컬 상단 마감과 낮은 별동, 실제 연속 행 분할, 후보 적합성/정확한 폭/보충 수/우선순위/ID 순위를 구현했다.
- 모서리/입구 선점 후 패턴을 배치하고 반복층의 패턴과 가로 기준을 공유한다. 연결 창문은 실제 single/left/right 에셋으로 제작하며 결합 경계의 유리와 프레임 높이를 맞춘다.
- 새 스타일 면은 기존 window corner 대체에서 제외하며, 지붕·처마와 coverage 없는 상단 부착물을 조립한다. 최종 구조 소유권은 기존 검사로 검증한다.
- schema v4/building-patterns-v1에 실제 buildingDefinition을 포함한다. 기존 v1~v3 Golden은 그대로 보존하며, 별도 v4 Golden 2개를 추가했다.
- 직접 편집/선택/카메라와 Undo/Redo 유지. Inspector에 스타일/층/패턴/묶음/조각/대체 이유를 추가했다.
- 최종 `npm run verify`: 타입 검사, 단위/회귀 83건, build 통과. `npm run test:e2e`: 8개 시나리오 통과. 실제 두 스타일, 층별 갤러리와 접합부 렌더를 확인했다. 신규 성능 수치를 주장하지 않으며 기존 benchmark는 이전 버전 기록이다.


## 후속 완료: 좌우 마감·대칭 반복 (스타일 v2)

상가형·업무형에 양끝 마감과 중앙 반복을 분리한 v2 데이터를 추가했다. 짝수는 XOOOOX, 홀수는 XOXOX 계열을 정확한 정수 폭으로 배치한다. 기존 해석기/geometry와 스타일 v1 저장 결과를 유지하고 v2 Golden을 별도 추가했다. Facade rhythm 비교 예제, 네 방향/폭 3~10/반복층 회귀를 포함한 타입 검사·86개 테스트·production build를 통과했다. 브라우저 검증은 기존 8개 시나리오에 대칭 구성 및 렌더 확인을 포함한다.


## 짝수 정면 출입구 균형 — 완료

상가형/업무형 v3에서 중앙 입구를 짝수 폭 2칸, 홀수 폭 1칸으로 배치하여 양측 창문 구간의 폭을 맞췄다. optional entranceLayout 정책과 building-patterns-v2 저장 계약을 추가하고 기존 스타일/Golden은 보존했다. 폭 14 예제, 네 방향의 1~6/13~16 폭, 삭제/Undo/Redo, 실제 렌더를 확인했다. 타입 검사·89개 테스트·build와 브라우저 검증을 통과했다.
