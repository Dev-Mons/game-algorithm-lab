import type { Runner } from './runner';
import type { BenchResult } from '../lab/bench';
import { liveBackends } from '../physics/contracts';
import { $, row, n0, ms } from './dom';

export function renderStats(runner: Runner, lastResult: BenchResult | null) {
  const sim = runner.sim;
  if (!sim) return;
  const c = sim.core, a = c.account(), st = c.stats, rate = c.recentRates(), led = c.ledger;
  $('#flow').innerHTML = [
    ['원재료 대기', n0(a.rawQueue)], ['처리 중', n0(a.inBoard)], ['완료', n0(st.completed)],
    ['본 재화', n0(led.main), 'green'], ['부산물 대기', n0(a.byproductWaiting), 'orange'], ['트레이', `${n0(a.trayCount)}개`],
    ['보너스', n0(led.bonusProduced + led.bonusSeed), 'orange'], ['합계', n0(c.total), 'total'],
  ].map(([k, v, cls]) => `<div class="chip ${cls ?? ''}"><span>${k}</span><b>${v}</b></div>`).join('<i>›</i>');
  $('#economy').innerHTML =
    row('원재료 대기 / 처리 중 / 완료', `${n0(a.rawQueue)} / ${n0(a.inBoard)} / ${n0(st.completed)}`)
    + row('처리 중 예상 본 재화', n0(a.inBoardMain))
    + row('본 재화 (가공)', n0(led.main), 'green')
    + row('생성 부산물 / 압축 코인 (가치 1)', `${n0(st.byproductEmitted)} / ${n0(st.tokensMade)}`)
    + row('압축 중 / 바닥 배출 대기', `${c.compressionCount} / ${a.feedCount}`)
    + row('일괄 배출 횟수 / 최대 개수', `${sim.batchStats.dumps} / ${sim.batchStats.largestDump}`)
    + row('부산물: 슈트 · 압축 버퍼', `${n0(a.chuteValue)} · ${n0(a.compressorBuffer)}`)
    + row('프레스 상태 / 배출 가치', `${({ idle: '대기', loading: '재료 받기', pressing: '가압', retracting: '램 복귀', ready: '배출 준비', releasing: '낙하' })[c.pressPhase]} / ${n0(a.feedValue + a.feedSeed)}`)
    + (c.offscreen ? row('화면 밖 트레이 풀', `${n0(a.offProduced + a.offSeed)} (${a.offCount})`) : '')
    + row('트레이 잔존 가치 (생산 / 초기)', `${n0(a.trayProduced)} / ${n0(a.traySeed)}`)
    + row('낙하 수량 (생산 / 초기)', `${n0(st.tokensPaid - st.seedPaid)} / ${n0(st.seedPaid)}`)
    + row('회수 보너스 (생산 / 초기)', `${n0(led.bonusProduced)} / ${n0(led.bonusSeed)}`, 'orange')
    + row('합계 (본 + 보너스)', n0(c.total), 'total')
    + row('최근 10초 완료 · 토큰 · 보너스', `${rate.completedPerSec.toFixed(2)} · ${rate.tokensPerSec.toFixed(2)} · ${rate.bonusPerSec.toFixed(1)} /s`)
    + (c.offscreen && c.estimate ? row('근사 추정치', `가공 ${c.estimate.process.toFixed(1)} · 부산물 ${c.estimate.byproduct.toFixed(1)} · 회수 ${c.estimate.recoveryPerSec.toFixed(1)}/s (${c.estimate.source === 'measured' ? '측정' : '기본값'})`) : '');
  const cons = c.conservationError(), ok = !cons.produced && !cons.seed && !cons.raw;
  $('#checks').innerHTML = row('가치 보존 오차 (부산물/초기/원재료)', `${cons.produced} / ${cons.seed} / ${cons.raw}`, ok ? 'green' : 'red')
    + row('중복 무시 (도착 / 이탈)', `${st.duplicateArrivals} / ${st.duplicateExits}`)
    + row('유실 복구 (원석 / 토큰)', `${st.lostItems} / ${st.lostTokens}`)
    + row('페그 접촉 / 점수 반영', `${n0(st.pegContacts)} / ${n0(st.scoredContacts)}`)
    + row('투입구 막힘(누적 틱)', n0(sim.gateStats.blocked))
    + row('활성 월드 (플링코/푸셔/엔진)', `${liveBackends.plinko} / ${liveBackends.pusher} / ${liveBackends.engineWorlds}`);
  const ps = sim.pusher.stats(), ls = sim.plinko.stats(), fw = runner.frameWork.summary(), fi = runner.frameInterval.summary();
  const pl = runner.plinkoMs.summary(), pu = runner.pusherMs.summary(), tr = runner.transferMs.summary();
  $('#perf-note').textContent = `${ls.label} + ${ps.label}`;
  const corr = (o: Record<string, number>) => Object.entries(o).map(([k, v]) => `${k} ${v}`).join(' · ');
  $('#perf').innerHTML = row('FPS (프레임 간격 중앙값)', Number.isFinite(fi.median) ? `${(1000 / fi.median).toFixed(0)} (${fi.median.toFixed(1)}ms)` : '—')
    + row('프레임 CPU 중앙 / p95', `${ms(fw.median, 2)} / ${ms(fw.p95, 2)} ms`)
    + row('플링코 step 중앙 / p95', `${ms(pl.median)} / ${ms(pl.p95)} ms`)
    + row('푸셔 step 중앙 / p95', `${ms(pu.median)} / ${ms(pu.p95)} ms`)
    + row('상태 전달 중앙 / p95', `${ms(tr.median)} / ${ms(tr.p95)} ms`)
    + row('원석 / 토큰 (실제 물리 수)', `${ls.bodies} / ${ps.bodies}`)
    + row('푸셔 활성 / 휴면', `${ps.active} / ${ps.sleeping ?? '측정 불가'}`)
    + row('초기화 시간 (플링코/푸셔)', `${sim.initMs.plinko.toFixed(1)} / ${sim.initMs.pusher.toFixed(1)} ms`)
    + row('버린 시간(따라잡기 상한)', `${runner.droppedMs.toFixed(0)} ms`)
    + row('메모리', ps.memoryBytes !== null ? `${(((ps.memoryBytes ?? 0) + (ls.memoryBytes ?? 0)) / 1024).toFixed(0)} KB (${ps.memoryNote})` : ps.memoryNote)
    + `<p class="hint">보정: ${corr(ls.corrections)} | ${corr(ps.corrections)}</p>`
    + `<p class="hint">설정: ${Object.entries({ ...ls.settings }).map(([k, v]) => `${k}=${v}`).join(', ')} | ${Object.entries(ps.settings).map(([k, v]) => `${k}=${v}`).join(', ')}</p>`;
  const prog = runner.benchProgress();
  $('#bench-status').textContent = prog ? `${prog.phase === 'preparing' ? '준비' : prog.phase === 'warmup' ? '워밍업' : '측정'} ${prog.repeat}/${prog.repeats} · ${prog.pct}%` : lastResult ? `최근: ${lastResult.label}` : '';
  $('#pause').textContent = runner.paused ? '재개' : '일시정지';
  $<HTMLSelectElement>('#speed').value = String(runner.speed);
  document.body.classList.toggle('benching', !!prog);
}

