import { SCENARIOS } from '../scenarios/scenarios';

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
        <div class="canvas-wrap">
          <canvas id="crowd-canvas" width="1200" height="720" aria-label="군중 이동 시뮬레이션"></canvas>
          <div class="canvas-hint">캔버스를 클릭해 목표 이동</div>
          <div class="canvas-badges"><span id="scenario-badge">Open Field</span><span id="hash-badge">Hash —</span></div>
        </div>
        <div class="transport">
          <button id="run-toggle" class="primary" type="button">❚❚ 일시정지</button>
          <button id="single-step" type="button">＋ 한 스텝</button>
          <button id="reset" type="button">↺ 초기화</button>
          <label class="speed-control">배속<select id="time-scale"><option value="0.25">0.25×</option><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option><option value="4">4×</option></select></label>
        </div>
        <div class="metrics-grid" aria-label="실시간 메트릭">
          ${metricCard('FPS', 'metric-fps', '0.0')}
          ${metricCard('평균 / 최대 스텝', 'metric-step-time', '0.00 / 0.00 ms')}
          ${metricCard('활성 객체', 'metric-active', '1,000')}
          ${metricCard('도착 / 도착률', 'metric-arrived', '0 / 0.0%')}
          ${metricCard('평균 속도', 'metric-speed', '0.0')}
          ${metricCard('겹친 쌍 / 5k+ 표본', 'metric-overlap', '0')}
          ${metricCard('복구 객체 / 최대 보정', 'metric-recovery', '0 / 0.00 px')}
          ${metricCard('정체 객체', 'metric-stalled', '0')}
          ${metricCard('평균 / 최대 이웃', 'metric-neighbors', '0.0 / 0')}
          ${metricCard('후보 검사 / step', 'metric-candidates', '0')}
          ${metricCard('역방향 객체', 'metric-backward', '0')}
          ${metricCard('벽 반경 침투', 'metric-wall-overlap', '0')}
          ${metricCard('평균 / 최대 Δv', 'metric-velocity-delta', '0.00 / 0.00')}
          ${metricCard('평균 / 최대 가속도', 'metric-acceleration', '0.0 / 0.0')}
          ${metricCard('Dynamic rebuild', 'metric-dynamic-rebuild', 'age 0 / 8 step')}
        </div>
      </section>
      <aside class="controls-panel">
        <section class="control-section">
          <h2>실험 설정</h2>
          <label>시나리오<select id="scenario-select">${scenarios}</select></label>
          <p id="scenario-description" class="description"></p>
          <div class="split-fields">
            <label>객체 수<input id="agent-count" type="number" min="1" max="10000" step="100" value="1000"></label>
            <label>랜덤 시드<input id="seed" type="number" step="1" value="42"></label>
          </div>
        </section>
        <section class="control-section">
          <h2>이동 파라미터</h2>
          ${rangeControl('최대 속도', 'max-speed', 20, 180, 1, 86)}
          ${rangeControl('최대 가속도', 'max-acceleration', 40, 500, 5, 210)}
          ${rangeControl('객체 반지름', 'agent-radius', 1.5, 8, 0.1, 3.2)}
          ${rangeControl('회피 탐색 거리', 'neighbor-radius', 8, 60, 1, 28)}
          ${rangeControl('객체 간 여유', 'agent-gap', 0, 3, 0.1, 0.4)}
          ${rangeControl('충돌 예측 시간', 'avoidance-horizon', 0.1, 1.5, 0.05, 0.5)}
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
            ${toggle('Dynamic density cost', 'debug-dynamic-density', false)}
            ${toggle('Dynamic overload cost', 'debug-dynamic-overload', false)}
            ${toggle('Dynamic counter-flow cost', 'debug-dynamic-counter', false)}
            ${toggle('Dynamic wall cost', 'debug-dynamic-wall', false)}
            ${toggle('겹침 복구', 'debug-recovery', true)}
            ${toggle('이웃 탐색 반경', 'debug-neighbors', false)}
            ${toggle('겹친 객체', 'debug-overlaps', false)}
            ${toggle('정체 객체', 'debug-stalled', true)}
          </div>
        </section>
        <section class="control-section">
          <h2>Dynamic Flow Field</h2>
          ${rangeControl('Rebuild fixed step', 'dynamic-rebuild-interval', 6, 12, 1, 8)}
          ${rangeControl('Target density', 'dynamic-target-density', 0.1, 1.5, 0.05, 0.45)}
          ${rangeControl('Density weight', 'dynamic-density-weight', 0, 20, 0.5, 6)}
          ${rangeControl('Overload age weight', 'dynamic-overload-weight', 0, 2, 0.05, 0.35)}
          ${rangeControl('Counter-flow weight', 'dynamic-counter-weight', 0, 8, 0.25, 2.5)}
          ${rangeControl('Wall clearance weight', 'dynamic-wall-weight', 0, 2, 0.05, 0.15)}
          ${rangeControl('Cost smoothing', 'dynamic-cost-smoothing', 0.05, 1, 0.05, 0.35)}
          ${rangeControl('Direction hysteresis', 'dynamic-direction-hysteresis', 0, 2, 0.05, 0.2)}
        </section>
        <footer class="core-note"><span>CORE</span> Fixed 60 Hz · Flow Field · One Local Solver</footer>
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
