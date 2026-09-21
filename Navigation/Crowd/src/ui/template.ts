import { SCENARIOS } from '../scenarios/scenarios';
import { labControls, labResults } from './lab-panel';

export function appTemplate(): string {
  const scenarios = SCENARIOS
    .map((scenario) => `<option value="${scenario.id}">${scenario.name}</option>`)
    .join('');
  return `
    <header class="topbar">
      <div><p class="eyebrow">NAVIGATION / CROWD</p><h1>Crowd Navigation Lab</h1></div>
      <div class="run-status"><span id="status-dot"></span><strong id="status-label">실행 중</strong><small id="step-label">Step 0</small></div>
    </header>
    <main class="workspace">
      <section class="stage-panel" aria-label="시뮬레이션 화면">
        <div id="editor-toolbar" class="editor-toolbar" hidden>
          <div class="editor-tool-group" role="group" aria-label="맵 편집 도구">
            <button type="button" data-editor-tool="select" aria-pressed="true">선택 / 이동</button>
            <button type="button" data-editor-tool="obstacle" aria-pressed="false">장애물 그리기</button>
            <button type="button" data-editor-tool="spawn" aria-pressed="false">생성 영역 그리기</button>
            <button type="button" data-editor-tool="goal" aria-pressed="false">목적지 배치</button>
          </div>
          <div class="editor-tool-group">
            <label><input id="editor-snap" type="checkbox" checked> 12px 스냅</label>
            <button id="editor-undo" type="button" title="Ctrl+Z">실행 취소</button>
            <button id="editor-redo" type="button" title="Ctrl+Shift+Z">다시 실행</button>
          </div>
        </div>
        <div class="canvas-wrap">
          <canvas id="crowd-canvas" width="1200" height="720" aria-label="군중 이동 시뮬레이션"></canvas>
          <canvas id="editor-canvas" width="1200" height="720" tabindex="0" aria-label="맵 편집 캔버스. 선택한 물체는 방향키로 이동합니다." hidden></canvas>
          <div id="canvas-hint" class="canvas-hint">빨간 영역: 생성 · 파란 원: 목적지 · 클릭해 목표 이동</div>
          <div class="canvas-badges"><span id="scenario-badge">Open Field</span><span id="hash-badge">Hash —</span></div>
        </div>
        <div class="transport">
          <button id="run-toggle" class="primary" type="button">❚❚ 일시정지</button>
          <button id="single-step" type="button">＋ 한 스텝</button>
          <button id="reset" type="button">↺ 초기화</button>
          <button id="map-edit" type="button">맵 편집</button>
          <label class="speed-control">배속<select id="time-scale"><option value="0.25">0.25×</option><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option><option value="4">4×</option></select></label>
        </div>
        <div class="metrics-grid" aria-label="실시간 메트릭">
          ${metricCard('FPS', 'metric-fps', '0.0')}
          ${metricCard('평균 / 최대 스텝', 'metric-step-time', '0.00 / 0.00 ms')}
          ${metricCard('활성 객체', 'metric-active', '1,000')}
          ${metricCard('도착 / 도착률', 'metric-arrived', '0 / 0.0%')}
          ${metricCard('평균 속도', 'metric-speed', '0.0')}
          ${metricCard('겹친 쌍 / solver 진단', 'metric-overlap', '0')}
          ${metricCard('복구 객체 / 최대 보정', 'metric-recovery', '0 / 0.00 px')}
          ${metricCard('정체 객체', 'metric-stalled', '0')}
          ${metricCard('평균 / 최대 이웃', 'metric-neighbors', '0.0 / 0')}
          ${metricCard('후보 검사 / step', 'metric-candidates', '0')}
          ${metricCard('역방향 객체', 'metric-backward', '0')}
          ${metricCard('벽 반경 침투', 'metric-wall-overlap', '0')}
          ${metricCard('평균 / 최대 Δv', 'metric-velocity-delta', '0.00 / 0.00')}
          ${metricCard('평균 / 최대 가속도', 'metric-acceleration', '0.0 / 0.0')}
          ${metricCard('경로 필드', 'metric-dynamic-rebuild', '고정 · 1개')}
        </div>
        ${labResults()}
      </section>
      <aside class="controls-panel">
        ${labControls()}
        <section id="editor-panel" class="control-section" hidden>
          <h2>맵 에디터 <small>1200 × 720</small></h2>
          <label>맵 이름<input id="editor-name" type="text" maxlength="60" autocomplete="off"></label>
          <p class="editor-help">드래그로 영역을 그립니다. 선택 도구로 이동하고, 우측 아래 노란 손잡이로 크기를 조절하세요.</p>
          <label>배치된 물체<select id="editor-objects" size="6" aria-label="배치된 물체"></select></label>
          <div class="split-fields editor-inspector">
            <label>X<input id="editor-x" type="number" min="0" max="1200" step="1" disabled></label>
            <label>Y<input id="editor-y" type="number" min="0" max="720" step="1" disabled></label>
            <label>가로<input id="editor-width" type="number" min="4" max="1200" step="1" disabled></label>
            <label>세로<input id="editor-height" type="number" min="4" max="720" step="1" disabled></label>
          </div>
          <button id="editor-delete" type="button" disabled>선택 삭제</button>
          <p class="editor-help">생성 영역마다 같은 수로 분배되어 공통 목적지로 이동합니다. 방향키: 이동 · Shift: 1px · Delete: 삭제</p>
          <div class="editor-actions">
            <button id="editor-apply" type="button" class="primary">적용하고 실행</button>
            <button id="editor-save" type="button">브라우저 저장</button>
            <button id="editor-export" type="button">JSON 내보내기</button>
            <button id="editor-import" type="button">JSON 가져오기</button>
            <button id="editor-blank" type="button">빈 맵으로 시작</button>
            <button id="editor-cancel" type="button">편집 취소</button>
          </div>
          <input id="editor-file" type="file" accept=".json,application/json" hidden>
          <p id="editor-status" class="editor-status" role="status" aria-live="polite"></p>
          <p class="editor-help">적용은 현재 세션에만 반영됩니다. 새로고침 후에도 사용하려면 브라우저에 저장하거나 JSON을 내보내세요.</p>
        </section>
        <section class="control-section">
          <h2>실험 설정</h2>
          <label>시나리오<select id="scenario-select">${scenarios}</select></label>
          <p id="scenario-description" class="description"></p>
          <p id="map-library-status" class="editor-status error" role="status" hidden></p>
          <div class="split-fields">
            <label>객체 수<input id="agent-count" type="number" min="1" max="50000" step="100" value="1000"></label>
            <label>랜덤 시드<input id="seed" type="number" step="1" value="42"></label>
          </div>
        </section>
        <section class="control-section">
          <h2>이동 파라미터</h2>
          ${rangeControl('최대 속도', 'max-speed', 20, 180, 1, 86)}
          ${rangeControl('최대 가속도', 'max-acceleration', 40, 500, 5, 210)}
          ${rangeControl('이동 회전 속도 (°/초)', 'turn-speed', 0, 720, 30, 360)}
          ${rangeControl('객체 반지름', 'agent-radius', 1.5, 8, 0.1, 3.2)}
          ${rangeControl('큰 객체 비율 (%)', 'large-agent-percent', 0, 100, 1, 0)}
          ${rangeControl('큰 객체 크기 배율 (×)', 'large-agent-scale', 1, 4, 0.1, 2)}
          <p class="description">예: 5% · 2× → 일부 객체만 두 배 크기로 섞입니다. 노란색이 큰 객체이며, 조절을 마치면 다시 배치됩니다.</p>
          <p id="agent-size-summary" class="editor-status" role="status" aria-live="polite"></p>
          ${rangeControl('회피 탐색 거리', 'neighbor-radius', 8, 60, 1, 28)}
          ${rangeControl('객체 간 여유', 'agent-gap', 0, 3, 0.1, 0.4)}
          ${rangeControl('밀도 압축 완화 시간', 'pressure-relaxation', 0.1, 0.5, 0.05, 0.25)}
          ${rangeControl('목표 반경', 'goal-radius', 20, 130, 1, 58)}
        </section>
        <section class="control-section">
          <h2>디버그 표시</h2>
          <div class="toggle-grid">
            ${toggle('Flow Field 방향', 'debug-flow', false)}
            ${toggle('Spatial Hash 셀', 'debug-grid', false)}
            ${toggle('Desired 속도', 'debug-desired', false)}
            ${toggle('실제 속도', 'debug-velocity', false)}
            ${toggle('국소 밀도', 'debug-density', false)}
            ${toggle('겹침 복구', 'debug-recovery', true)}
            ${toggle('이웃 탐색 반경', 'debug-neighbors', false)}
            ${toggle('겹친 객체', 'debug-overlaps', false)}
            ${toggle('정체 객체', 'debug-stalled', true)}
          </div>
        </section>
        <section class="control-section">
          <h2>지원 범위</h2>
          <p class="editor-help">2D 원판·사각형 벽·고정 tick. 같은 런타임의 seed/명령 재현을 지원합니다.
          방향별 격자 속도·압력과 XPBD 접촉을 사용하며 정적 벽은 sweep으로 처리합니다. 유한 접촉 반복은 무겹침 보장이 아닙니다.</p>
        </section>
        <footer class="core-note"><span>CORE</span> Fixed dt 1/60 s · Measured Hz / FPS separately</footer>
      </aside>
    </main>`;
}

function metricCard(label: string, id: string, value: string): string {
  return `<article class="metric-card"><span>${label}</span><strong id="${id}">${value}</strong></article>`;
}

function rangeControl(
  label: string,
  id: string,
  min: number,
  max: number,
  step: number,
  value: number,
): string {
  return `<label class="range-row"><span>${label}<output id="${id}-output">${value}</output></span><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${value}"></label>`;
}

function toggle(label: string, id: string, checked: boolean): string {
  return `<label class="toggle"><input id="${id}" type="checkbox" ${checked ? 'checked' : ''}><span></span>${label}</label>`;
}
