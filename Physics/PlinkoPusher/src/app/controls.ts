import { MAX_PEG_LEVEL } from '../core/config';
import { PLACEMENTS, type PlacementId } from '../core/frame';
import { PRESETS, type PresetId, type Quality, type Scenario } from '../lab/scenario';
import type { PlinkoBackendId, PusherBackendId } from '../physics/contracts';
import { PLINKO_BACKENDS, PUSHER_BACKENDS } from '../physics/registry';
import type { CameraPreset, DeviceView } from '../view/device-view';
import type { Runner } from './runner';
import { $ } from './dom';

type Slider = { key: string; label: string; min: number; max: number; step: number; get: (s: Scenario) => number; set: (s: Scenario, v: number) => void; restart?: boolean; unit?: string };
const SLIDERS: Slider[] = [
  { key: 'supply', label: '공급량', unit: '/s', min: 0, max: 60, step: 0.5, get: s => s.flow.supplyPerSec, set: (s, v) => { s.flow.supplyPerSec = v; } },
  { key: 'release', label: '플링코 처리량', unit: '/s', min: 0.5, max: 60, step: 0.5, get: s => s.flow.plinkoReleasePerSec, set: (s, v) => { s.flow.plinkoReleasePerSec = v; } },
  { key: 'level', label: '페그 레벨', min: 1, max: MAX_PEG_LEVEL, step: 1, get: s => s.pegs.level, set: (s, v) => { s.pegs.level = v; } },
  { key: 'mainBase', label: '본 가치(기본)', min: 1, max: 50, step: 1, get: s => s.economy.mainBase, set: (s, v) => { s.economy.mainBase = v; } },
  { key: 'byCoef', label: '부산물 계수', min: 0, max: 5, step: 0.1, get: s => s.economy.byproductCoef, set: (s, v) => { s.economy.byproductCoef = v; } },
  { key: 'bundle', label: '한 번에 압축할 개수', min: 1, max: 24, step: 1, get: s => s.economy.tokenBundleMax, set: (s, v) => { s.economy.tokenBundleMax = v; } },
  { key: 'period', label: '푸셔 왕복 주기', unit: 's', min: 0.8, max: 6, step: 0.1, get: s => s.tray.period, set: (s, v) => { s.tray.period = v; } },
  { key: 'stroke', label: '푸셔 스트로크', min: 0.4, max: 4, step: 0.1, get: s => s.tray.stroke, set: (s, v) => { s.tray.stroke = v; }, restart: true },
  { key: 'trayMax', label: '트레이 토큰 상한', min: 50, max: 3000, step: 10, get: s => s.flow.trayMaxTokens, set: (s, v) => { s.flow.trayMaxTokens = v; }, restart: true },
  { key: 'seedTokens', label: '초기 적재 토큰', min: 0, max: 2400, step: 10, get: s => s.initialTokens, set: (s, v) => { s.initialTokens = v; }, restart: true },
];

export function bindControls(runner: Runner, view: DeviceView, afterPlacement: () => void) {
  function syncControls() {
    const s = runner.scenario;
    document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach(b => b.classList.toggle('active', b.dataset.preset === s.preset));
    document.querySelectorAll<HTMLButtonElement>('[data-placement]').forEach(b => b.classList.toggle('active', b.dataset.placement === s.placement));
    $('#preset-desc').textContent = PRESETS[s.preset].description;
    $('#placement-desc').textContent = PLACEMENTS[s.placement].description;
    $<HTMLSelectElement>('#plinko-backend').value = s.backends.plinko;
    $<HTMLSelectElement>('#pusher-backend').value = s.backends.pusher;
    $('#backend-note').textContent = `${PLINKO_BACKENDS[s.backends.plinko].note} / ${PUSHER_BACKENDS[s.backends.pusher].note}`;
    $<HTMLInputElement>('#auto').checked = s.flow.autoSupply;
    $<HTMLInputElement>('#seed').value = String(s.seed);
    $<HTMLSelectElement>('#quality').value = s.quality;
    $<HTMLSelectElement>('#peg-pattern').value = s.pegs.pattern;
    $('#demo').classList.toggle('active', runner.demo.on);
    for (const sl of SLIDERS) {
      const input = $<HTMLInputElement>(`#sl-${sl.key}`), v = sl.get(s);
      input.value = String(v); $(`#out-${sl.key}`).textContent = `${v}${sl.unit ?? ''}`;
    }
  }

  $('#sliders').innerHTML = SLIDERS.map(sl => `<label class="slider"><span>${sl.label}${sl.restart ? ' <i>(재시작)</i>' : ''}</span><output id="out-${sl.key}"></output>
    <input type="range" id="sl-${sl.key}" min="${sl.min}" max="${sl.max}" step="${sl.step}"></label>`).join('');
  for (const sl of SLIDERS) {
    const input = $<HTMLInputElement>(`#sl-${sl.key}`);
    input.addEventListener('input', () => {
      $(`#out-${sl.key}`).textContent = `${input.value}${sl.unit ?? ''}`;
      if (!sl.restart) void runner.configure(s => sl.set(s, Number(input.value)));
    });
    input.addEventListener('change', () => { if (sl.restart) void runner.configure(s => sl.set(s, Number(input.value)), true); });
  }

  document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach(b => b.addEventListener('click', () => { runner.demo.on = false; void runner.loadPreset(b.dataset.preset as PresetId, Number($<HTMLInputElement>('#seed').value) || 1234); }));
  $('#demo').addEventListener('click', async () => { await runner.loadPreset('basic'); runner.demo.on = true; runner.demo.t = 0; syncControls(); });
  $('#pause').addEventListener('click', () => { runner.setPaused(!runner.paused); $('#pause').textContent = $('#presentation-pause').textContent = runner.paused ? '재개' : '일시정지'; });
  $('#reset').addEventListener('click', () => void runner.restart());
  $<HTMLSelectElement>('#speed').addEventListener('change', e => runner.setSpeed(Number((e.target as HTMLSelectElement).value)));
  $<HTMLInputElement>('#seed').addEventListener('change', e => void runner.configure(s => { s.seed = Math.max(1, Math.floor(Number((e.target as HTMLInputElement).value) || 1)); }, true));
  $('#add1').addEventListener('click', () => runner.addRaw(1));
  $('#add10').addEventListener('click', () => runner.addRaw(10));
  $('#stock-add').addEventListener('click', () => runner.addRaw(100));
  $<HTMLInputElement>('#auto').addEventListener('change', e => void runner.configure(s => { s.flow.autoSupply = (e.target as HTMLInputElement).checked; }));
  $<HTMLSelectElement>('#plinko-backend').addEventListener('change', e => void runner.configure(s => { s.backends.plinko = (e.target as HTMLSelectElement).value as PlinkoBackendId; }, true));
  $<HTMLSelectElement>('#pusher-backend').addEventListener('change', e => void runner.configure(s => { s.backends.pusher = (e.target as HTMLSelectElement).value as PusherBackendId; }, true));
  $<HTMLInputElement>('#offscreen').addEventListener('change', e => { const on = (e.target as HTMLInputElement).checked; runner.setOffscreen(on); $('#offscreen-overlay').hidden = !on; });
  document.querySelectorAll<HTMLButtonElement>('[data-placement]').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.placement as PlacementId;
    void runner.setPlacement(id); afterPlacement(); syncControls();
  }));
  document.querySelectorAll<HTMLButtonElement>('[data-cam]').forEach(b => b.addEventListener('click', () => { runner.demo.on = false; view.setCamera(b.dataset.cam === 'reset' ? 'all' : b.dataset.cam as CameraPreset, b.dataset.cam !== 'reset'); syncControls(); }));
  $<HTMLInputElement>('#labels').addEventListener('change', e => view.setLabels((e.target as HTMLInputElement).checked));
  $<HTMLSelectElement>('#quality').addEventListener('change', e => void runner.configure(s => { s.quality = (e.target as HTMLSelectElement).value as Quality; }, true));
  $<HTMLSelectElement>('#peg-pattern').addEventListener('change', e => void runner.configure(s => { s.pegs.pattern = (e.target as HTMLSelectElement).value as Scenario['pegs']['pattern']; }));

  return syncControls;
}
