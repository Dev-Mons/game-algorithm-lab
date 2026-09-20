/// <reference types="vite/client" />
import type { ParticleScene, Sample } from './particles/types';

interface Replay {
  scene: ParticleScene;
  record: {fixtureHash: string; passed: boolean; failure: string | null; samples: Sample[];
    recovery: number | null; checks: Record<string,boolean>; duration: number};
  frames: {time: number; xy: number[]}[];
}
const assets = import.meta.glob('../../docs/research/fluid-navigation/particle-results/*-42-*.json',
  {eager: true,query: '?url',import: 'default'}) as Record<string,string>;
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const sceneSelect = element<HTMLSelectElement>('scene'), slider = element<HTMLInputElement>('time');
const moving = element<HTMLInputElement>('comoving'), region = element<HTMLInputElement>('region');
const play = element<HTMLButtonElement>('play'), end = element<HTMLButtonElement>('end');
let pair: [Replay,Replay] | null = null, playing = false, loadVersion = 0, previous = 0;

function draw(replay: Replay, canvas: HTMLCanvasElement, time: number, enabled: boolean): void {
  const ctx = canvas.getContext('2d')!;
  const rect = canvas.getBoundingClientRect(), ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width*ratio); canvas.height = Math.round(rect.height*ratio);
  ctx.scale(ratio,ratio);
  const width = rect.width, height = rect.height, s = replay.scene;
  const frame = replay.frames.reduce((best,f) => Math.abs(f.time-time) < Math.abs(best.time-time) ? f : best,replay.frames[0]!);
  const spanX = moving.checked ? 28 : 28+s.speed*replay.record.duration;
  const scale = Math.min((width-36)/spanX,(height-36)/28);
  const x0 = (width-spanX*scale)/2, y0 = (height-28*scale)/2;
  const camera = moving.checked ? s.speed*frame.time : 0;
  const sx = (x: number) => x0+(x-6-camera)*scale, sy = (y: number) => y0+(34-y)*scale;
  ctx.fillStyle = '#0f1926'; ctx.fillRect(0,0,width,height);
  ctx.strokeStyle = '#1c2a3b'; ctx.lineWidth = 1;
  for (let x = 6; x <= 34; x += 4) { ctx.beginPath(); ctx.moveTo(sx(x+camera),sy(6)); ctx.lineTo(sx(x+camera),sy(34)); ctx.stroke(); }
  for (let y = 6; y <= 34; y += 4) { ctx.beginPath(); ctx.moveTo(x0,sy(y)); ctx.lineTo(x0+spanX*scale,sy(y)); ctx.stroke(); }
  ctx.fillStyle = enabled ? '#75d7c1' : '#a2b1c8';
  for (let a = 0; a < s.disks.length; a++) {
    ctx.beginPath(); ctx.arc(sx(frame.xy[2*a]!),sy(frame.xy[2*a+1]!),s.disks[a]!.radius*scale,0,2*Math.PI); ctx.fill();
  }
  if (region.checked) {
    ctx.strokeStyle = '#f2ca74'; ctx.lineWidth = 1.5; ctx.setLineDash([5,4]);
    const r = s.repairRegion, offset = s.speed*frame.time;
    if ('radius' in r) { ctx.beginPath(); ctx.arc(sx(r.x+offset),sy(r.y),r.radius*scale,0,2*Math.PI); ctx.stroke(); }
    else ctx.strokeRect(sx(r.minX+offset),sy(r.maxY),(r.maxX-r.minX)*scale,(r.maxY-r.minY)*scale);
    ctx.setLineDash([]);
  }
  ctx.fillStyle = '#8299b2'; ctx.font = '11px Segoe UI'; ctx.fillText(`${s.disks.length}개 · ${frame.time.toFixed(1)} s`,16,height-13);
}
function render(): void {
  if (!pair) return;
  const time = Number(slider.value);
  element('time-label').textContent = `${time.toFixed(1)} / ${Number(slider.max).toFixed(1)} s`;
  pair.forEach((replay,i) => {
    const prefix = i ? 'on' : 'off';
    draw(replay,element<HTMLCanvasElement>(prefix),time,Boolean(i));
    const sample = [...replay.record.samples].reverse().find(s => s.time <= time+1e-6) ?? replay.record.samples[0]!;
    const first = replay.record.samples[0]!;
    const recovery = first.voidArea ? Math.max(0,1-sample.voidArea/first.voidArea)*100 : 0;
    const change = (sample.footprintArea/first.footprintArea-1)*100;
    element(`${prefix}-stats`).innerHTML = [
      ['빈 공간 면적',`${sample.voidArea.toFixed(2)} d²`],
      ['회복률',first.voidArea ? `${recovery.toFixed(1)}%` : '공동 없음'],
      ['외곽 면적 변화',`${change >= 0 ? '+' : ''}${change.toFixed(1)}%`],
    ].map(([label,value]) => `<div class="stat"><span>${label}</span><strong>${value}</strong></div>`).join('');
  });
}
async function load(): Promise<void> {
  const version = ++loadVersion;
  playing = false; play.textContent = '재생'; play.disabled = true; end.disabled = true; pair = null;
  const message = element('message'); message.className = 'message'; message.textContent = '같은 초기 상태의 기록을 불러오고 있습니다…';
  try {
    const results = await Promise.all(['off','on'].map(async mode => {
      const suffix = `/${sceneSelect.value}-42-${mode}.json`;
      const url = Object.entries(assets).find(([path]) => path.endsWith(suffix))?.[1];
      if (!url) throw new Error('기록이 없습니다. npm run research:repair 실행 후 다시 열어 주세요.');
      const response = await fetch(url);
      if (!response.ok) throw new Error(`기록을 읽을 수 없습니다 (${response.status}).`);
      return response.json() as Promise<Replay>;
    }));
    if (version !== loadVersion) return;
    const [off,on] = results as [Replay,Replay];
    if (off.record.fixtureHash !== on.record.fixtureHash) throw new Error('두 기록의 초기 상태가 다릅니다.');
    pair = [off,on]; slider.max = String(Math.min(off.record.duration,on.record.duration)); slider.value = '0';
    play.disabled = false; end.disabled = false;
    element('scope').textContent = `동일 초기 상태 · ${on.scene.disks.length}개 · seed 42`;
    const passed = results.every(r => r.record.passed);
    message.textContent = passed ? '검증 통과 · 침투, 속도, 질량, 외곽 변화와 회복 목표를 함께 확인했습니다.'
      : `검증 실패 · ${results.map(r => r.record.failure ?? Object.entries(r.record.checks).filter(([,v]) => !v).map(([k]) => k).join(', ')).filter(Boolean).join(' / ')}`;
    if (!passed) message.className = 'message error';
    element('validation').textContent = `두 실행의 초기 상태 SHA-256: ${on.record.fixtureHash}. 전체 기준 solver의 반복 상한은 200회이며 수렴 실패를 성공으로 처리하지 않습니다.`;
    render();
  } catch (error) {
    if (version !== loadVersion) return;
    message.className = 'message error'; message.textContent = error instanceof Error ? error.message : String(error);
  }
}
sceneSelect.addEventListener('change',() => void load());
slider.addEventListener('input',render); moving.addEventListener('change',render); region.addEventListener('change',render);
end.addEventListener('click',() => { playing = false; play.textContent = '재생'; slider.value = slider.max; render(); });
play.addEventListener('click',() => {
  if (Number(slider.value) >= Number(slider.max)) slider.value = '0';
  playing = !playing; play.textContent = playing ? '일시정지' : '재생'; previous = performance.now();
});
function tick(now: number): void {
  if (playing && pair) {
    const value = Math.min(Number(slider.max),Number(slider.value)+(now-previous)/1000);
    // Range inputs quantize to their step; retain elapsed time until a recorded frame changes.
    if (value-Number(slider.value) >= .099 || value >= Number(slider.max)) {
      slider.value = String(value); previous = now; render();
    }
    if (value >= Number(slider.max)) { playing = false; play.textContent = '재생'; }
  }
  requestAnimationFrame(tick);
}
window.addEventListener('resize',render);
void load(); requestAnimationFrame(tick);
