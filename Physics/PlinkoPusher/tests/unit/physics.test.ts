import { describe, expect, it, vi } from 'vitest';
import { defaultPusherParams, defaultTray } from '../../src/core/config';
import { localToWorld, type PlacementId } from '../../src/core/frame';
import { createScenario } from '../../src/lab/scenario';
import { Simulation } from '../../src/lab/simulation';
import { BodySnapshot, liveBackends, type PlinkoBackendId, type PusherBackend, type PusherBackendId, type PusherEvent } from '../../src/physics/contracts';
import { createPusher } from '../../src/physics/registry';
import { CustomStackPusher } from '../../src/physics/pusher-custom-stack';

async function runLocal(plinko: PlinkoBackendId, placement: PlacementId, ticks = 240) {
  const s = createScenario('basic', 77);
  s.backends = { plinko, pusher: 'custom' }; s.placement = placement; s.initialTokens = 0;
  const sim = await Simulation.create(s);
  const trace: number[] = [];
  for (let i = 0; i < ticks; i++) { sim.step(); sim.sync(); }
  const snap = sim.plinkoSnap;
  for (let k = 0; k < snap.count; k++) trace.push(snap.ids[k], snap.a[k], snap.b[k]);
  const world = Array.from({ length: snap.count }, (_, k) => localToWorld(sim.frame, snap.a[k], snap.b[k], 0.3));
  const result = { trace, world, frame: sim.frame, main: sim.core.ledger.main, completed: sim.core.stats.completed };
  sim.dispose();
  return result;
}

describe('플링코 로컬 2D 계약', () => {
  it.each(['custom', 'rapier2d'] as const)('%s: 보드 배치만 바꾸면 같은 로컬 입력에서 같은 로컬 이동과 수익이 나온다', async backend => {
    const a = await runLocal(backend, 'default'), b = await runLocal(backend, 'compound'), c = await runLocal(backend, 'tilt');
    expect(a.trace.length).toBeGreaterThan(9);
    expect(b.trace).toEqual(a.trace);
    expect(c.trace).toEqual(a.trace);
    expect(b.main).toBe(a.main); expect(b.completed).toBe(a.completed);
    // 월드 위치는 배치마다 다르다(같은 로컬, 다른 월드)
    expect(Math.abs(a.world[0].z - b.world[0].z) + Math.abs(a.world[0].x - b.world[0].x)).toBeGreaterThan(0.1);
  });
});

describe('백엔드 수명', () => {
  it('두 번째 백엔드의 초기화가 중간에 실패해도 생성한 자원을 모두 해제한다', async () => {
    const before = { ...liveBackends }, init = CustomStackPusher.prototype.init;
    const failure = vi.spyOn(CustomStackPusher.prototype, 'init').mockImplementation(async function (this: CustomStackPusher, spec, params) {
      await init.call(this, spec, params);
      throw new Error('controlled initialization failure');
    });
    try {
      const s = createScenario('empty');
      s.backends = { plinko: 'rapier2d', pusher: 'custom-stack' };
      await expect(Simulation.create(s)).rejects.toThrow('controlled initialization failure');
      expect(liveBackends).toEqual(before);
    } finally { failure.mockRestore(); }
  });

  it('교체를 반복해도 이전 월드·백엔드가 남지 않는다', async () => {
    const before = { ...liveBackends };
    const combos: Array<[PlinkoBackendId, PusherBackendId]> = [['custom', 'custom-stack'], ['custom', 'custom'], ['rapier2d', 'rapier3d-planar'], ['custom', 'rapier3d-stacked'], ['rapier2d', 'custom']];
    for (let round = 0; round < 2; round++) for (const [plinko, pusher] of combos) {
      const s = createScenario('basic'); s.backends = { plinko, pusher }; s.initialTokens = 40;
      const sim = await Simulation.create(s);
      expect(liveBackends.plinko).toBe(before.plinko + 1); expect(liveBackends.pusher).toBe(before.pusher + 1);
      for (let i = 0; i < 30; i++) sim.step();
      sim.dispose(); sim.dispose();
      const events: PusherEvent[] = [];
      sim.pusher.drainEvents(events);
      expect(events).toHaveLength(0);
    }
    expect(liveBackends).toEqual(before);
  });
});

async function pusherWith(id: PusherBackendId) {
  const p = createPusher(id), d = { ...defaultTray(), width: 6, depth: 8 };
  await p.init({ dims: d, wallHeight: 1.6 }, defaultPusherParams());
  return { p, d };
}
const zOf = (p: PusherBackend, id: number) => { const s = new BodySnapshot(8); p.snapshot(s); for (let k = 0; k < s.count; k++) if (s.ids[k] === id) return s.b[k]; return NaN; };

describe('푸셔 백엔드 공통 동작', () => {
  it.each(['custom-stack', 'custom', 'rapier3d-planar', 'rapier3d-stacked'] as const)('%s: 전진 시 밀고, 후퇴 시 끌어당기지 않는다', async id => {
    const { p, d } = await pusherWith(id);
    const r = d.tokenRadius, dt = 1 / 60;
    p.spawn({ id: 1, x: 0, y: d.tokenHalfHeight + 0.001, z: d.faceMin + r + 0.02, radius: r, halfHeight: d.tokenHalfHeight });
    p.setPusher(d.faceMin, 0);
    for (let i = 0; i < 30; i++) p.step(dt);
    const z0 = zOf(p, 1);
    let face = d.faceMin;
    for (let i = 0; i < 60; i++) { face += 1.5 * dt; p.setPusher(face, 1.5); p.step(dt); }
    const z1 = zOf(p, 1);
    expect(z1).toBeGreaterThan(z0 + 1.0);
    for (let i = 0; i < 60; i++) { face -= 1.5 * dt; p.setPusher(face, -1.5); p.step(dt); }
    for (let i = 0; i < 60; i++) p.step(dt);
    const z2 = zOf(p, 1);
    expect(z2).toBeGreaterThanOrEqual(z1 - 0.02); // 후퇴하는 판이 토큰을 끌고 오지 않는다
    p.dispose();
  });

  it.each(['custom-stack', 'custom', 'rapier3d-planar', 'rapier3d-stacked'] as const)('%s: 보상 가장자리를 넘은 토큰은 이탈 사실을 한 번만 보고한다', async id => {
    const { p, d } = await pusherWith(id);
    const r = d.tokenRadius;
    p.spawn({ id: 7, x: 0, y: d.tokenHalfHeight + 0.001, z: d.depth - 0.05, radius: r, halfHeight: d.tokenHalfHeight });
    p.spawn({ id: 8, x: 1, y: d.tokenHalfHeight + 0.001, z: d.depth - 2, radius: r, halfHeight: d.tokenHalfHeight });
    const events: PusherEvent[] = [];
    // 판을 가장자리 너머까지 전진시켜 두 토큰을 모두 밀어 떨어뜨린다
    for (let i = 0; i < 360; i++) { const face = Math.min(d.depth + 0.5, d.faceMin + i * 0.03); p.setPusher(face, 1.8); p.step(1 / 60); p.drainEvents(events); }
    for (const tokenId of [7, 8]) expect(events.filter(e => e.type === 'exit' && e.id === tokenId)).toHaveLength(1);
    expect(events.filter(e => e.type === 'lost')).toHaveLength(0);
    p.remove(7); // 이미 제거된 물체 제거는 무시된다
    p.dispose();
  });
});

describe('Custom 적층 회귀', () => {
  it('표시 스냅숏 갱신 주기가 달라도 같은 투입·물리 상태·정산 결과가 나온다', async () => {
    const run = async (syncEvery: number) => {
      const s = createScenario('basic', 1234);
      s.backends = { plinko: 'custom', pusher: 'custom-stack' };
      const sim = await Simulation.create(s);
      try {
        for (let i = 1; i <= 1800; i++) {
          sim.step();
          if (i % syncEvery === 0) sim.sync();
        }
        sim.sync();
        const snap = sim.pusherSnap;
        return {
          ids: Array.from(snap.ids.slice(0, snap.count)),
          x: Array.from(snap.a.slice(0, snap.count)),
          y: Array.from(snap.c.slice(0, snap.count)),
          z: Array.from(snap.b.slice(0, snap.count)),
          stats: { ...sim.core.stats }, ledger: { ...sim.core.ledger },
          gate: { ...sim.gateStats }, conservation: sim.core.conservationError(),
        };
      } finally { sim.dispose(); }
    };
    const eachTick = await run(1), grouped = await run(4);
    expect(eachTick.gate.fed).toBeGreaterThan(0);
    expect(grouped).toEqual(eachTick);
    expect(grouped.conservation).toEqual({ produced: 0, seed: 0, raw: 0 });
  }, 60000);

  it('고유입에서도 더미가 내려앉아 공중으로 솟은 토큰 덩어리가 생기지 않는다', async () => {
    const s = createScenario('growth', 1234);
    s.backends = { plinko: 'rapier2d', pusher: 'custom-stack' };
    s.flow.supplyPerSec = 20; s.flow.plinkoReleasePerSec = 20; s.flow.compressCycleSec = 0.1; s.economy.byproductCoef = 3;
    const sim = await Simulation.create(s);
    for (let i = 0; i < 30 * 60; i++) { sim.step(); sim.sync(); }
    const snap = sim.pusherSnap, plateTop = 0.9;
    let high = 0;
    for (let k = 0; k < snap.count; k++) if (snap.c[k] > plateTop + 1) high++;
    expect(high).toBeLessThan(20); // 결합 버그 당시 30초에 150개
    expect(sim.core.conservationError()).toEqual({ produced: 0, seed: 0, raw: 0 });
    sim.dispose();
  }, 60000);
});
