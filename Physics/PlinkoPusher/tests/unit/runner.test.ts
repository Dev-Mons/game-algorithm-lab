import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Runner } from '../../src/app/runner';
import { benchMeta, sameBenchInput } from '../../src/lab/bench';
import { createScenario } from '../../src/lab/scenario';
import { Simulation } from '../../src/lab/simulation';
import { liveBackends } from '../../src/physics/contracts';

let frame: FrameRequestCallback;
let runner: Runner;
let view: ConstructorParameters<typeof Runner>[0];
let time: number;
beforeEach(() => {
  vi.stubGlobal('document', { hidden: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('window', { devicePixelRatio: 1 });
  vi.stubGlobal('navigator', { userAgent: 'test' });
  vi.stubGlobal('innerWidth', 1440); vi.stubGlobal('innerHeight', 900);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frame = callback; return 1; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  view = { build: vi.fn(), update: vi.fn(), clear: vi.fn(), refreshPegColors: vi.fn(), updatePlacement: vi.fn(), setCamera: vi.fn() };
  runner = new Runner(view);
  time = performance.now();
});
afterEach(() => { runner.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const scenario = () => {
  const s = createScenario('empty');
  s.backends = { plinko: 'custom', pusher: 'custom-stack' };
  s.measure = { warmupSec: 0, measureSec: 0.05, repeats: 2 };
  return s;
};

describe('측정 세션', () => {
  it('재시작 초기화 실패 시 이전 장면도 해제하고 다시 시작할 수 있다', async () => {
    const before = { ...liveBackends };
    await runner.restart(scenario());
    vi.mocked(view.clear).mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const create = vi.spyOn(Simulation, 'create').mockRejectedValueOnce(new Error('controlled failure'));
    await expect(runner.restart()).rejects.toThrow('controlled failure');
    expect(view.clear).toHaveBeenCalledOnce();
    expect(runner.sim).toBeNull();
    expect(liveBackends).toEqual(before);
    create.mockRestore();
    await runner.restart();
    expect(runner.sim).not.toBeNull();
  });

  it('초기화 도중 종료해도 뒤늦게 월드를 다시 연결하지 않는다', async () => {
    const before = { ...liveBackends };
    const pending = runner.restart(scenario());
    await Promise.resolve(); // 생성이 시작된 후 종료
    runner.dispose();
    await pending;
    expect(runner.sim).toBeNull();
    expect(liveBackends).toEqual(before);
    expect(document.removeEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });

  it('데모 입력을 중단하고 같은 페그 설정으로 정확한 틱 수를 반복 측정한다', async () => {
    await runner.restart(scenario());
    runner.editPeg(0, 'splitter', 4);
    runner.demo = { on: true, t: 8, cam: 0 };
    runner.speed = 4;
    await runner.runBench();
    runner.start();
    for (let i = 0; i < 20 && !runner.results.length; i++) {
      frame(time += 100);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    expect(runner.results).toHaveLength(1);
    const result = runner.results[0];
    expect(result.repeats.map(r => r.plinkoStep.n)).toEqual([3, 3]);
    expect(result.repeats.map(r => r.droppedMs)).toEqual([0, 0]);
    expect(runner.sim!.core.stats.supplied).toBe(0);
    expect(runner.speed).toBe(4);
    expect(result.input.pegOverrides).toEqual([{ index: 0, kind: 'splitter', level: 4 }]);
    expect(runner.sim!.layout.pegs[0]).toMatchObject({ kind: 'splitter', level: 4 });
    const replay = await Simulation.create(result.input);
    try { expect(replay.layout.pegs[0]).toMatchObject({ kind: 'splitter', level: 4 }); }
    finally { replay.dispose(); }
  });

  it('초기화 중 중복 시작은 무시하고 설정 변경은 측정을 취소한다', async () => {
    await runner.restart(scenario());
    const starting = runner.runBench(), session = runner.bench;
    await runner.runBench();
    expect(runner.bench).toBe(session);
    await runner.configure(s => { s.flow.supplyPerSec = 30; });
    await starting;
    expect(runner.bench).toBeNull();
    expect(runner.sim!.scenario.flow.supplyPerSec).toBe(30);
    expect(runner.results).toHaveLength(0);
    await runner.runBench();
    runner.editPeg(0, 'refiner', 3);
    expect(runner.bench).toBeNull();
    expect(runner.sim!.layout.pegs[0]).toMatchObject({ kind: 'refiner', level: 3 });
  });

  it('전체 입력을 별도 사본으로 저장하고 공급·경제·푸셔 설정 차이를 구분한다', async () => {
    await runner.restart(scenario());
    const a = { ...benchMeta(runner.sim!, 'test', 'A'), repeats: [] };
    await runner.configure(s => { s.flow.supplyPerSec = 30; s.economy.byproductCoef = 3; s.tray.period = 0.8; });
    const b = { ...benchMeta(runner.sim!, 'test', 'B'), repeats: [] };
    expect(a.input.flow.supplyPerSec).toBe(2.5);
    expect(b.input.tray.period).toBe(0.8);
    expect(sameBenchInput(a, b)).toBe(false);
    const backendOnly = structuredClone(a);
    backendOnly.input.backends.pusher = 'rapier3d-stacked';
    expect(sameBenchInput(a, backendOnly)).toBe(true);
  });
});
