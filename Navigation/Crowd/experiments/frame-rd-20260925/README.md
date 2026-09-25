# Crowd 실제 앱 프레임 R&D — 2026-09-25

제품 기준: `65701664aa9c4c4bb80320d58550e610511ea2b0` (조사 시작·종료 시 main 동일). #32 후속 최적화 연구 자료. **제품 최적화를 적용한 커밋이 아니다.** 이 디렉터리는 측정 요약과 실험 패치의 기록이며, main·기존 baseline·기존 테스트 기대값을 수정하지 않았다.

## 실행 방법과 한계

- AMD EPYC 9V74 가상 CPU, 5개 visible core / cgroup 4 CPU quota, Debian 13 Chromium 144.0.7559.96 headless, Node 22.16.0, viewport 1440×960, DPR 1, Canvas backing 1200×720. CPU throttle 미사용. 물리 디스플레이/GPU 완료 시간은 측정하지 않았다.
- 컨테이너 브라우저의 localhost HTTP 접근이 `ERR_BLOCKED_BY_ADMINISTRATOR`로 차단됐다. 정책을 변경하지 않고, 고정 커밋의 프로덕션 main bundle과 CSS를 `set_content/evaluate`로 오프라인 실행했다. Vite modulepreload import와 URL query 공급 방식만 변경했다. **실제 main RAF → FixedClock → timedStep → 명령/UI 이벤트 → simulation → recorder → CanvasRenderer → DOM/해시 경로를 실행했다.** 별도 루프에서 sim.step을 RAF마다 직접 호출한 과거 측정과 다르다.
- 네이티브 URL 로딩, localStorage, 사용자의 Windows/Whale/GPU 환경과 정확한 원래 장면은 미검증이다. 스크린샷은 종료 후 일시정지 상태이므로 그때의 FPS 표시를 성능 근거로 사용하지 않는다.
- Legacy, seed42, timeScale1, radius3.2, gap0.4, speed86, acceleration210, turn360, dt1/60, 기본 격자/접촉 설정, dynamicRouting=false, 품질 감사 OFF. 기본 recovery/stalled 디버그만 ON. 10K는 scale=true, 실제 생성·활성 10,000 유지, 도착0. 월드 약3794.733×2276.840.
- tick0부터 실제 앱 루프로 실행. tick30에 생성 영역 중심의 고정 좌표로 실제 Canvas click handler를 호출했다. UI 폭발 radius100/speed400, UI 오른쪽 밀림 radius100/ax500/ay0/endTick90. 실제 기록된 rocky 클릭 좌표는 (189.73665961010278,1099.0406509490858), flat10K는 (741.0469535715334,1138.4199576606165). DOM 좌표 반올림 후 값을 비교 실행에서 동일하게 유지했다.
- 광역 입력은 UI가 아니라 공개 enqueueExternal API를 통한 별도 진단: radius160×sqrt(10), speed400, tick30. UI 결과와 합치지 않았다.
- 구간: pre5–29 / 직후30–44 / 지속45–89 / 종료90–119 / 회복120+. 프레임은 tickBefore로 분류한다. RAF 간격은 직전 프레임 작업을 반영하므로 경계에서 한 프레임 차이가 있으며 raw trace를 보존했다. 분위수는 sorted[floor(n*q)]. 표의 프레임은 RAF 간격이며 Canvas CPU 제출 시간과 구분한다.
- 60Hz 전체 프레임16.67ms와 sim/wall 0.98–1.02를 측정 전에 목표로 고정했다. 이 연구 결과는 성공 판정이 아니다. 최종 수락에는 >=10초 장면·반복 측정·독립 품질 통과가 필요하다.

## 실제 앱 신규 관측: tick45–89

시간 단위 ms. 단일 탐색 실행은 반복 실험과 구분한다. 모든 scaled 10K/20K 실행은 표의 개체 수를 끝까지 유지했다.

| 장면/입력 | 실제 N | RAF P50/P95/P99 | step P95 | sim/wall |
|---|---:|---:|---:|---:|
| 평지 none |10000|33.3/50.0/50.1|31.3|0.4688|
| 평지 UI blast |10000|33.3/50.0/50.1|28.4|0.4892|
| 평지 UI wind |10000|33.4/50.0/50.0|34.0|0.4327|
| 바위 협곡 UI wind, R1 |10000|116.7/150.1/216.7|132.5|0.1324|
| 바위 협곡 UI blast |10000|116.6/150.0/166.6|133.8|0.1466|
| 평지 UI wind |1000|16.7/16.7/16.8|4.9|0.7759|
| 평지 UI wind |20000|83.3/83.4/150.0|64.8|0.2143|
| 평지 API wide blast |10000|33.4/50.0/66.5|38.9|0.4018|

폭발 첫 rocky tick30: step242.4ms, 6substeps, 직접656명, contactAffected8892명, pairs276856, planningFallbacks0. 직후30–44 RAF P95 250.1ms. wind 지속45–89에는 2substeps, planningFallbacks0; 이 구간의 저하는 보수적 벽 fallback 하나로 설명되지 않는다.

wind가 tick90에 끝나도 rocky tick359까지 외력 상태398명이 남고 전역 물리 Contact가 유지됐다. 120–359 RAF P50/P95=149.9/166.7ms, sim/wall0.1158, 직접 영향0, 활성10000. 잔류 상태가 모두 잘못된 것인지는 판정하지 않았다.

scale=false로 요청10000만 바꾼 별도 probe는 실제4368명이었다. 그 결과를 실제10K로 사용하지 않는다. 이 경우 <5000 렌더 경로 CPU P95가 약15.6ms였으나 실제 scaled10K의 렌더 병목과 혼동하지 않는다.

## 병목 분해: rocky wind R1, tick45–89 평균

| 계측 | ms | 의미 |
|---|---:|---|
| frame callback |117.667|GPU 완료 시간 아님|
| simulation step |112.964|아래 simulation pass 포함|
| movement/contact |84.236|예측·계획·물리 Contact·정적 적분 포함|
| desired/Navigation |17.536|실제 FlowField.sampleDirection/LOS 비용|
| CrowdFlow |7.391|기존 pass.avoidance라는 이름에 들어감|
| CrowdField |1.836|pass.density|
| external contact 내부 |74.553|movement/contact에 포함, 더해서 합산하면 안 됨|
| substep planning |2.744|movement/contact에 포함|
| external query |0.396|일부 초기화/수명 비용은 잔여 시간에 있음|
| render CPU 제출 |1.884|GPU 완료/표시 지연 아님|
| recorder.record |0.367|sim.step 외부|
| UI 전체 |2.342|아래 hash 포함|
| stateHash |2.158|UI에 포함, 중복 합산 금지|
| 관측 카운터 자체 |0.027|전체 계측 비용의 완전한 상한은 아님|

평균139,388 pairs/tick(2substeps 합계), 직접 약621명, contactAffected 약9005명, 전원10000명이 물리 경로에 들어갔다. Contact 보정을 받은 수와 외력 상태 플래그 수는 다른 의미다. 외력 입력용1회 + 물리2회 인덱스 rebuild; 첫 계획 인덱스는 첫 substep에서 재사용하므로 그 부분을 중복이라고 세지 않는다.

별도 CDP CPU sampling: rocky 전체 캡처에서 move13.3%, querySegment12.3%, query7.1%, queryCandidates5.7%, GC1.4%. 동일 이름 solve 함수들을 합친21%는 특정 솔버 단독 점유율이 아니다. 함수 귀속은 pass 계측과 함께 판단한다. GC allocation-site trace와 개별 멈춤의 인과관계까지 확인한 것은 아니다.

렌더 OFF/record OFF/얇은 계측 실행에서도 rocky RAF 중앙값 약116.6ms였다. 기능 제거는 원인 분리용이며 제품 채택안이 아니다. thin의 render/record 0은 미계측이지 비용0이 아니다.

## 비교 실험 A: 정확한 차단 장애물 증거 재사용

FlowField의 셀마다 마지막 차단 장애물 ID를 보관하되, **현재 정확한 segment와 clearance로 다시 검사**한다. 여전히 막혀 있을 때만 빠르게 false를 반환하고 아니면 기존 전체 조회를 수행한다. 셀별 visibility bool을 그대로 재사용하지 않는다. 맵/목표 rebuild 시 무효화한다. 추가 용량은 navCells×4B/FlowField, 이10K 맵에서 약60KB다. 물리 배열·입력·쌍 순서·품질 상한을 바꾸지 않는 제한적 실험이다.

| 실행 | baseline step P95 | cell-witness step P95 | baseline RAF P95 | cell-witness RAF P95 |
|---|---:|---:|---:|---:|
|1|132.5|126.3|150.1|133.3|
|2|128.5|108.6|149.9|133.4|
|3|126.9|113.2|133.4|133.4|
|3회 중앙값|128.5|113.2|149.9|133.4|

각 실행 평균의 중앙값: step108.556→96.073ms, desired15.589→2.176ms, movement82.316→82.791ms. Step P95 약11.9% 개선이지만 contact는 남고60FPS는 실패한다. cold spike와 P99도 보존했으며 최상의 한 회만 선택하지 않았다. seed42 단일 시나리오·가상CPU 3회로 일반적인 개선율을 보장하지 않는다.

평지1K 180tick + rocky10K 150tick에서 모든 현재 AgentBuffer view와 external affected/direct를 **매 tick byte-for-byte 비교**, 불일치0. 별도 stateHash 일치. 기존 외력/FlowField/정적 인덱스/시계 테스트44개 통과. 기존 품질 실패가 고쳐졌다는 의미가 아니다.

## 비교 실험 B: 속도 반복 중 동일 wallSeparates 캐시

ExternalContactSolver의 좌표가 변하지 않는4 velocity iterations에만 pair별 Int8 캐시를 재사용한다. 위치 안정화에는 사용하지 않는다. 추가32B/Agent,10K 약320KB. 단일 탐색 실행 step평균108.30ms, P95 131.4ms; baseline R1은112.964/132.5ms. RAF P95는150.1ms로 같았다. 최종150tick 상태 배열 동일. 반복적 P95 이득 근거가 부족하므로 보류한다.

## 비교 실험 C: default1x step cap1→2 진단

현재 FixedClock은 maxStepsPerFrame4가 있어도1x에서는 ceil(speed)=1 때문에 프레임당1step이다. 남은 whole tick을 accumulator%=dt로 버린다. **기본1x에서 다중 catch-up 폭증 가설은 반증됐다.** 시뮬레이션 처리량 부족과 시간 버림이 관측된 문제다.

| 장면 | baseline RAF P95 / simWall | cap2 RAF P95 / simWall |
|---|---:|---:|
|1K wind|16.7 /0.7759|16.7 /1.0000|
|10K wind|50.0 /0.4327|83.3 /0.4731|

실제 FixedClock을 사용하는 합성120프레임/2.0001초, 60Hz ±0.1ms 교대 jitter에서 cap1은60tick(1초), cap2는120tick(2초)을 실행했다. 가벼운 장면의 시간 손실도 확인됐다. 그러나 cap2를 무조건 적용하면10K 화면이 악화된다. 후보 기각; 여유 예산 기반 따라잡기와 drop/lag 공개 정책을 별도 설계해야 한다. 기존 fixed-clock 테스트 기대값은 변경하지 않았다.

## 국소화 비용 추정과 독립 품질 감사

물리 후보 리스트와 별개인 uncapped spatial graph에서 rocky tick45 외력/direct seed788명 → 순간접촉 연결 범위5210명. 600px/s 지원속도와 dt 기반30px 보수적 거리 그래프는10000명 전체가 연결됐다. tick60/90/120의 순간 연결 범위5350/5467/5558명. 이 그래프는 **작업량 추정**이지 구현된 island solver, 완전한 swept 경계 증명, 예상 가속 배수가 아니다. 누적 위치 보정까지 완전히 보수적으로 감싼다고 주장하지 않는다. 국소 외력이라고 비용이 반드시 수백명으로 줄지는 않는다.

별도 품질 ON 실행: 독립 uncapped spatial index,10tick마다 모든 활성 Agent와 주변쌍 검사. rocky10K 15개 표본 tick, flat1K 18개 표본 tick. 프레임 chord swept 검사는 곡선 substep 경로 전체를 증명하지 않는다.

| 신규 감사 | 최대 침투 px | 벽 겹침 | 후보 포화 max/tick | 후보와 baseline 상태 |
|---|---:|---:|---:|---|
|평지1K wind|0|0|0|매tick byte 동일|
|rocky10K wind|6.375291|0|19|매tick byte 동일|

**rocky 정상 품질 gate0.5px/포화0 실패가 계속된다.** 기존 문서의6.209px/6은 다른 실행의 과거 기록이고 위 값은 새 측정이다. 작은 장면의 전수쌍·고속교차/벽/복귀 검증은 실행한 external-influences 테스트 범위에 한정한다. 이 연구에서 모든 요구 조합의 대규모 품질 감사를 수행한 것은 아니다.

## 검증 상태

- 최초 bundle CI는 shallow checkout 부모 SHA 부재로 setup 실패했다. 테스트 실패와 구분한다.
- [고정 제품 커밋 CI](https://github.com/Dev-Mons/game-algorithm-lab/actions/runs/36138349342): Ubuntu24.04.5/AMD EPYC7763/Node22.16.0. npm ci 및 typecheck 통과, verify181개 중177통과/4시간초과 + worker onTaskUpdate timeout. 테스트 뒤 && build는 실행되지 않았다.
- 컨테이너에서 실패4개만 worker1로 재검증:3통과, `movement-v2: moves 10000 XPBD-contact agents through obstacle gates with bounded work`는 기존15000ms 제한 시간초과. timeout·기대값은 낮추거나 늘리지 않았다.
- 원본 별도 `npm run build` 통과. candidate build 통과. candidate 관련44개 테스트 통과. 이를 전체 verify 통과라고 표현하지 않는다.
- 공식 HTTP 기반 browser E2E는 정책 차단으로 미실행. 오프라인 실제 UI 실행24개는 완료/JS 오류0/측정 timeout0; 이 숫자는 공식 E2E 테스트 개수가 아니다.
- 원본 source와 verified 복사본 대조 불일치0. 기존 baseline은 덮어쓰지 않았다.

## 자료 공개 범위

이 요약·실험 패치와 후속 이슈의 핵심 수치는 GitHub에 공개한다. 24개 실행의 전체 frame/step JSON, 최종 상태 배열, CPU profile, 독립 품질 결과, 실행 스크립트, 계측 패치, 소스 해시, 스크린샷·로그는 **대화 첨부 evidence ZIP**으로 제공하며 현재 GitHub에 전부 업로드한 자료는 아니다. GitHub Actions의 source/dependency/verify artifact는2026-10-02 만료 예정이며 성능 실험 artifact와 구분한다. 관측 JSON을 보존하는 계측과 LabRecorder도 heap을 사용하므로 memoryBefore/After 차이를 제품 순수 누수량으로 해석하지 않는다.

전체 실험은 임시 연구 디렉터리에서 수행했다. 제품 최적화의 대규모 구현, PR, main 병합, #32 종료, 다른 엔진 이식은 하지 않았다.
