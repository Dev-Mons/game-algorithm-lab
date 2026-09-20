import { PRESETS } from '../algorithms/lab/registry';

export function labControls(): string {
  return `<section class="control-section">
    <h2>알고리즘 실험실</h2>
    <label>프리셋<select id="preset-select">${PRESETS.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}</select></label>
    <p id="preset-description" class="editor-help"></p><p id="preset-limitations" class="editor-help"></p>
    <p id="destination-description" class="editor-help"></p>
    <details><summary>계층별 교체 / Ablation</summary><fieldset id="module-controls">
      <label>경로<select id="module-planner"><option value="individual-astar">개별 Grid A*</option><option value="shared-flow">공유 Flow Field</option><option value="group-corridor">부대 공유 회랑</option></select></label>
      <label>희망 속도<select id="module-steering"><option value="seek">Seek / Arrival</option><option value="boids">Boids</option><option value="formation">리더 / 대형</option></select></label>
      <label>지역 회피<select id="module-avoidance"><option value="separation">Separation</option><option value="orca">원판 ORCA / 반평면 LP</option><option value="sampling">속도 샘플링</option><option value="none">끄기</option></select></label>
      <label>잔여 접촉<select id="module-contact"><option value="pbd">PBD</option><option value="none">끄기 / 품질 ablation</option></select></label>
      <label>도착 모델<select id="module-destination"><option value="exit">출구 / 도착자 제거</option><option value="slots">슬롯 / 도착자 점유 유지</option></select></label>
      <div class="split-fields"><label>회피 이웃 K<input id="module-maxNeighbors" type="number" min="1" max="64" value="12"></label><label>접촉 반복<input id="module-contactIterations" type="number" min="1" max="64" value="4"></label></div>
      <div class="split-fields"><label>예측 시간 (s)<input id="module-timeHorizon" type="number" min="0.05" max="10" step="0.05" value="1.5"></label><label>부대 크기<input id="module-groupSize" type="number" min="1" max="512" value="32"></label></div>
      <label class="plain-check"><input id="module-density" type="checkbox"> 밀도 감속</label>
      <label class="plain-check"><input id="module-congestion" type="checkbox"> 저주기 혼잡 경로 비용</label>
      <label class="plain-check"><input id="module-queue" type="checkbox"> 명시된 통로의 방향별 대기열</label>
      <button id="apply-modules" type="button">조합 적용 / 초기화</button>
    </fieldset></details>
    <details><summary>개별 유닛 명령</summary><fieldset id="individual-controls">
      <label>유닛 ID (0부터)<input id="command-agent" type="number" min="0" value="0"></label>
      <div class="split-fields"><label>목표 X<input id="command-x" type="number" min="0" value="1080"></label><label>목표 Y<input id="command-y" type="number" min="0" value="120"></label></div>
      <button id="send-agent-command" type="button">개별 목표 명령</button>
      <p class="editor-help">B0–D에서 지원합니다. 공유 field는 목적지×크기 128개까지입니다. 명령은 tick과 함께 저장·재생됩니다. Legacy를 포함한 전체 비교는 공통 명령만 사용합니다.</p>
    </fieldset></details>
    <p id="lab-error" role="alert" class="editor-status error" hidden></p>
    <label class="plain-check"><input id="scale-world" type="checkbox"> 1천 기준 동일 밀도로 맵 확장</label>
    <p class="editor-help">반경·속도·격자 크기는 그대로 두고 면적을 확대합니다. 큰 맵 편집은 확장을 끈 뒤 수행합니다.</p>
  </section>`;
}

export function labResults(): string {
  return `<section class="lab-results" aria-label="알고리즘 비교 결과">
    <h2>동일 조건 순차 비교</h2>
    <div class="lab-actions"><label>실행 스텝<input id="comparison-steps" type="number" min="1" max="100000" value="600"></label>
      <label>품질 감사<select id="quality-mode"><option value="0">끄기 / 성능 실행</option><option value="10">10 tick마다 전수 후보 감사</option><option value="1">매 tick 정밀 감사 (1천 권장)</option></select></label>
      <button id="run-current" type="button">현재 조합 재실행</button><button id="compare-presets" type="button">6개 프리셋 순차 비교</button>
      <button id="cancel-comparison" type="button" disabled>중단</button><button id="save-result" type="button">현재 결과 저장</button>
      <button id="export-results" type="button">결과 JSON 내보내기</button><button id="clear-results" type="button">결과 지우기</button></div>
    <p id="comparison-status" role="status" aria-live="polite">맵·seed·물리 설정·기록된 명령을 복제하여 처음부터 실행합니다. 모듈 교체는 현재 조합 재실행에 반영됩니다.</p>
    <p id="lab-live" class="lab-live"></p><p id="lab-passes" class="editor-help"></p>
    <p class="editor-help">실제 Hz는 벽시계 기준, 처리 용량 Hz는 이동 ms의 역수입니다. 프레임 간격은 렌더·이동·감사·UI 지연을 포함합니다. 정체는 저속 대기 지표이며 교착 확정이 아닙니다. 도착 모델이 다른 R/Q와 B0/B1/D의 도착률은 직접 동등 비교하지 마세요.</p>
    <div class="result-scroll"><table><thead><tr><th>실행 / 맵</th><th>요청 / 생성</th><th>활성 / 이동 / 대기 / 도착</th><th>이동 P50 / P95 ms</th><th>처리 용량 Hz</th><th>도착률</th><th>전수 감사 겹침 최대</th><th>벽 침투</th><th>동일 입력</th></tr></thead><tbody id="result-rows"></tbody></table></div>
    <p class="editor-help">결과는 이 브라우저에 최대 24개 저장합니다. JSON에 전체 설정·맵·명령·pass·활성수 추이·감사 오버헤드를 포함합니다. 감사 OFF의 겹침 칸은 미측정입니다.</p>
  </section>`;
}
