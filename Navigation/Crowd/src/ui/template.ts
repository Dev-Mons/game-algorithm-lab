import { SCENARIOS } from '../scenarios/scenarios';

export function appTemplate(): string {
  const scenarios = SCENARIOS.map((scenario) => `<option value="${scenario.id}">${scenario.name}</option>`).join('');
  return `
    <header class="topbar">
      <div>
        <p class="eyebrow">NAVIGATION / CROWD</p>
        <h1>Crowd Navigation Lab</h1>
      </div>
      <div class="run-status"><span id="status-dot"></span><strong id="status-label">실행 중</strong><small id="step-label">Step 0</small></div>
    </header>
    <main class="workspace">
      <section class="stage-panel" aria-label="시뮬레이션 화면">
        <div class="canvas-wrap">
          <canvas id="crowd-canvas" width="1200" height="720" aria-label="군중 이동 시뮬레이션"></canvas>
          <div class="canvas-hint">캔버스를 클릭해 목표 이동</div>
          <div class="canvas-badges"><span id="scenario-badge">Open Field</span><span id="hash-badge">Hash —</span></div>
        </div>
        <div class="transport">
          <button id="run-toggle" class="primary" type="button">❚❚ 일시정지</button>
          <button id="single-step" type="button">＋ 한 스텝</button>
          <button id="reset" type="button">↺ 초기화</button>
          <label class="speed-control">배속
            <select id="time-scale"><option value="0.25">0.25×</option><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option><option value="4">4×</option></select>
          </label>
        </div>
        <div class="metrics-grid" aria-label="실시간 메트릭">
          ${metricCard('FPS', 'metric-fps', '0.0')}
          ${metricCard('평균 / 최대 스텝', 'metric-step-time', '0.00 / 0.00 ms')}
          ${metricCard('활성 객체', 'metric-active', '1,000')}
          ${metricCard('도착 / 도착률', 'metric-arrived', '0 / 0.0%')}
          ${metricCard('평균 속도', 'metric-speed', '0.0')}
          ${metricCard('겹친 쌍', 'metric-overlap', '0')}
          ${metricCard('정체 객체', 'metric-stalled', '0')}
          ${metricCard('평균 / 최대 이웃', 'metric-neighbors', '0.0 / 0')}
          ${metricCard('후보 검사 / step', 'metric-candidates', '0')}
          ${metricCard('역방향 / 강한 후진', 'metric-backward', '0 / 0')}
          ${metricCard('벽 반경 침투', 'metric-wall-overlap', '0')}
          ${metricCard('평균 / 최대 Δv', 'metric-velocity-delta', '0.00 / 0.00')}
          ${metricCard('Hard / Emergency stop', 'metric-hard-stop', '0 / 0')}
          ${metricCard('양보 감속 / 완전 정지', 'metric-reservation', '0 / 0')}
          ${metricCard('RVO 제약 / 투영 보정', 'metric-reciprocal', '0 / 0')}
          ${metricCard('Side switch / 재정지', 'metric-side-switch', '0 / 0')}
          ${metricCard('1초 인접 공동 정지', 'metric-adjacent-stop', '0')}
          ${metricCard('Safety fallback', 'metric-fallback', '0')}
          ${metricCard('Unified infeasible', 'metric-infeasible', '0')}
        </div>
      </section>
      <aside class="controls-panel">
        <section class="control-section">
          <h2>실험 설정</h2>
          <label>시나리오<select id="scenario-select">${scenarios}</select></label>
          <label>이동 파이프라인<select id="pipeline-select"><option value="current">Current</option><option value="minimal">Minimal</option><option value="unified">Unified</option></select></label>
          <p id="scenario-description" class="description"></p>
          <div class="split-fields">
            <label>객체 수<input id="agent-count" type="number" min="1" max="5000" step="100" value="1000"></label>
            <label>랜덤 시드<input id="seed" type="number" step="1" value="42"></label>
          </div>
        </section>
        <section class="control-section">
          <h2>이동 파라미터</h2>
          ${rangeControl('최대 속도', 'max-speed', 20, 180, 1, 86)}
          ${rangeControl('최대 가속도', 'max-acceleration', 40, 500, 5, 210)}
          ${rangeControl('최대 회전률 (rad/s)', 'max-turn-rate', 1, 12, 0.25, 4.5)}
          ${rangeControl('객체 반지름', 'agent-radius', 1.5, 8, 0.1, 3.2)}
          ${rangeControl('회피 탐색 거리', 'neighbor-radius', 8, 60, 1, 28)}
          ${rangeControl('객체 간 여유', 'agent-gap', 0.1, 3, 0.1, 0.4)}
          ${rangeControl('충돌 예측 시간', 'avoidance-horizon', 0.2, 1.5, 0.05, 0.3)}
          ${rangeControl('목표 반경', 'goal-radius', 20, 130, 1, 58)}
        </section>
        <section class="control-section">
          <h2>디버그 표시</h2>
          <div class="toggle-grid">
            ${toggle('Flow Field 방향', 'debug-flow', false)}
            ${toggle('Spatial Hash 셀', 'debug-grid', false)}
            ${toggle('Preferred 속도', 'debug-preferred', false)}
            ${toggle('최종 속도', 'debug-velocity', false)}
            ${toggle('국소 밀도', 'debug-density', false)}
            ${toggle('Safety fallback', 'debug-fallbacks', true)}
            ${toggle('이웃 탐색 반경', 'debug-neighbors', false)}
            ${toggle('겹친 객체', 'debug-overlaps', true)}
            ${toggle('정체 객체', 'debug-stalled', true)}
          </div>
        </section>
        <footer class="core-note"><span>CORE</span> Fixed 60 Hz · Reverse Dijkstra · Uniform Grid</footer>
      </aside>
    </main>`;
}

function metricCard(label: string, id: string, value: string): string {
  return `<article class="metric-card"><span>${label}</span><strong id="${id}">${value}</strong></article>`;
}

function rangeControl(label: string, id: string, min: number, max: number, step: number, value: number): string {
  return `<label class="range-row"><span>${label}<output id="${id}-output">${value}</output></span><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${value}"></label>`;
}

function toggle(label: string, id: string, checked: boolean): string {
  return `<label class="toggle"><input id="${id}" type="checkbox" ${checked ? 'checked' : ''}><span></span>${label}</label>`;
}
