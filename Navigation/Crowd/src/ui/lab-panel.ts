import { PRESETS } from '../algorithms/lab/registry';

export function labControls(): string {
  return `<section class="control-section">
    <h2>알고리즘 실험실</h2>
    <label>프리셋<select id="preset-select">${PRESETS.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}</select></label>
    <p id="preset-description" class="editor-help"></p><p id="preset-limitations" class="editor-help"></p>
    <p id="destination-description" class="editor-help"></p>
    <label class="plain-check"><input id="scale-world" type="checkbox"> 1천 기준 동일 밀도로 맵 확장</label>
    <p class="editor-help">반경·속도·격자 크기는 그대로 두고 면적을 확대합니다. 큰 맵 편집은 확장을 끈 뒤 수행합니다.</p>
  </section>`;
}

export function labResults(): string {
  return `<section class="lab-results" aria-label="알고리즘 비교 결과">
    <h2>동일 조건 순차 비교</h2>
    <div class="lab-actions"><label>실행 스텝<input id="comparison-steps" type="number" min="1" max="100000" value="600"></label>
      <label>품질 감사<select id="quality-mode"><option value="0">끄기 / 성능 실행</option><option value="10">10 tick마다 전수 후보 감사</option><option value="1">매 tick 정밀 감사 (1천 권장)</option></select></label>
      <button id="run-current" type="button">현재 프리셋 재실행</button><button id="compare-presets" type="button">${PRESETS.length}개 프리셋 순차 비교</button>
      <button id="cancel-comparison" type="button" disabled>중단</button><button id="save-result" type="button">현재 결과 저장</button>
      <button id="export-results" type="button">결과 JSON 내보내기</button><button id="clear-results" type="button">결과 지우기</button></div>
    <p id="comparison-status" role="status" aria-live="polite">맵·seed·물리 설정·기록된 명령을 복제하여 처음부터 실행합니다.</p>
    <p id="lab-live" class="lab-live"></p><p id="lab-passes" class="editor-help"></p>
    <p class="editor-help">실제 Hz는 벽시계 기준, 처리 용량 Hz는 이동 ms의 역수입니다. 프레임 간격은 렌더·이동·감사·UI 지연을 포함합니다. 정체는 저속 대기 지표이며 교착 확정이 아닙니다. 도착 모델이 다른 알고리즘의 도착률은 직접 동등 비교하지 마세요.</p>
    <div class="result-scroll"><table><thead><tr><th>실행 / 맵</th><th>요청 / 생성</th><th>활성 / 이동 / 대기 / 도착</th><th>이동 P50 / P95 ms</th><th>처리 용량 Hz</th><th>도착률</th><th>전수 감사 겹침 최대</th><th>벽 침투</th><th>동일 입력</th></tr></thead><tbody id="result-rows"></tbody></table></div>
    <p class="editor-help">결과는 이 브라우저에 최대 24개 저장합니다. JSON에 전체 설정·맵·명령·pass·활성수 추이·감사 오버헤드를 포함합니다. 감사 OFF의 겹침 칸은 미측정입니다.</p>
  </section>`;
}
