import type { Runner } from './runner';
import { overview, sameBenchInput, type BenchResult } from '../lab/bench';
import { $, ms } from './dom';

export function createBenchPanel(runner: Runner, toast: (message: string) => void) {
  let lastResult: BenchResult | null = null;
  const slots: { A: BenchResult | null; B: BenchResult | null } = { A: null, B: null };
  function renderBench() {
    const cols: Array<[string, BenchResult | null]> = [['최근', lastResult], ['A', slots.A], ['B', slots.B]];
    const shown = cols.filter(([, r]) => r);
    if (!shown.length) { $('#bench-body').innerHTML = '<p class="hint">같은 시나리오로 A 실행 → 결과 → A 저장 → 백엔드 변경 → 측정 → B 저장. 각 반복은 새 월드에서 워밍업 후 같은 기간을 측정합니다.</p>'; return; }
    const ov = shown.map(([k, r]) => [k, r!, overview(r!)] as const);
    const line = (label: string, f: (o: ReturnType<typeof overview>, r: BenchResult) => string) => `<tr><th>${label}</th>${ov.map(([, r, o]) => `<td>${f(o, r)}</td>`).join('')}</tr>`;
    const warn = slots.A && slots.B ? (slots.A.condition !== slots.B.condition ? '<p class="warn">A와 B의 조건이 다릅니다(단층·평면 ↔ 3D 적층): 동일 조건 비교가 아닌 실사용 후보 비교입니다.</p>' : !sameBenchInput(slots.A, slots.B) ? '<p class="warn">A와 B의 실험 입력(공급·경제·장치·페그·측정 설정 등)이 다릅니다.</p>' : '') : '';
    $('#bench-body').innerHTML = warn + `<table><tr><th></th>${ov.map(([k, r]) => `<th>${k}<small>${r.backends.plinko} + ${r.backends.pusher}<br>${r.scenario.preset} · seed ${r.scenario.seed} · ${r.condition === 'planar' ? '단층·평면' : '3D 적층'}</small></th>`).join('')}</tr>`
      + line('반복 · 측정 기간', (_, r) => `${r.repeats.length}회 · ${r.scenario.measureSec}s (워밍업 ${r.scenario.warmupSec}s)`)
      + line('원석 평균/최대 · 토큰 평균', o => `${ms(o.items, 0)}/${ms(o.itemsMax, 0)} · ${ms(o.tokens, 0)}`)
      + line('플링코 step 중앙 / p95 (ms)', o => `${ms(o.plinkoMedian)} / ${ms(o.plinkoP95)}`)
      + line('푸셔 step 중앙 / p95 (ms)', o => `${ms(o.pusherMedian)} / ${ms(o.pusherP95)} <small>반복 편차 ${ms(o.pusherMedianSpread)}</small>`)
      + line('  └ 엔진 밖 어댑터 중앙 (플링코/푸셔 ms)', o => `${ms(o.plinkoAdapterMedian)} / ${ms(o.pusherAdapterMedian)}`)
      + line('상태 전달 중앙 / p95 (ms)', o => `${ms(o.transferMedian)} / ${ms(o.transferP95)}`)
      + line('프레임 CPU 중앙 / p95 (ms)', o => `${ms(o.frameMedian, 2)} / ${ms(o.frameP95, 2)}`)
      + line('프레임 간격 중앙 (ms)', o => ms(o.intervalMedian, 1))
      + line('푸셔 활성 / 휴면', o => `${ms(o.active, 0)} / ${ms(o.sleeping, 0)}`)
      + line('초기화 (플링코/푸셔 ms)', o => `${ms(o.initPlinko, 1)} / ${ms(o.initPusher, 1)}`)
      + line('JS 힙 변화 (MB)', o => ms(o.heap, 1))
      + line('최대 겹침 % · 20%+ 겹침 쌍', (o, r) => r.condition === 'stacked' ? '측정 불가(적층 형상)' : `${ms(o.maxOverlapPct, 1)} · ${ms(o.overlappedPairs, 1)}`)
      + line('튀어오름 · 유실 · 끼임 보정', o => `${ms(o.high, 0)} · ${ms(o.lostTokens, 0)} · ${ms(o.unstuck, 0)}`)
      + line('완료 · 회수 토큰 · 보너스', o => `${ms(o.completed, 0)} · ${ms(o.tokensPaid, 0)} · ${ms(o.bonus, 0)}`)
      + line('버린 시간 (ms)', o => ms(o.droppedMs, 0))
      + line('설정', (_, r) => `<small>${Object.entries({ ...r.settings.plinko }).map(([k, v]) => `${k}=${v}`).join(', ')}<br>${Object.entries(r.settings.pusher).map(([k, v]) => `${k}=${v}`).join(', ')}</small>`)
      + `</table><p class="hint">환경: ${ov[0][1].env}. 마찰·감쇠 계수는 엔진마다 의미가 달라 같은 수치라도 감각이 다를 수 있습니다(설정 행 참고).</p>`;
  }

  runner.onBenchDone = r => { lastResult = r; renderBench(); toast(`측정 완료: ${r.label}`); $('#bench').classList.add('open'); };
  $('#bench-run').addEventListener('click', () => { $('#bench').classList.add('open'); void runner.runBench(); });
  $('#save-a').addEventListener('click', () => { if (lastResult) { slots.A = lastResult; renderBench(); } else toast('먼저 측정을 실행하세요.'); });
  $('#save-b').addEventListener('click', () => { if (lastResult) { slots.B = lastResult; renderBench(); } else toast('먼저 측정을 실행하세요.'); });
  $('#bench-toggle').addEventListener('click', () => $('#bench').classList.toggle('open'));
  $('#bench-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ A: slots.A, B: slots.B, history: runner.results }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `plinko-pusher-bench-${Date.now()}.json`; a.click(); URL.revokeObjectURL(a.href);
  });

  renderBench();
  return { slots, get lastResult() { return lastResult; } };
}
