import { describe, expect, it } from 'vitest';
import { byproductValue, defaultBoard, defaultEconomy, defaultFlow, mainPayout, pegGain } from '../../src/core/config';
import { GameCore, type ReleaseOrder } from '../../src/core/game-core';
import { buildBoardLayout } from '../../src/core/layout';
import { Rng } from '../../src/core/rng';

const DT = 1 / 60;
function makeCore(mut?: (c: { flow: ReturnType<typeof defaultFlow>; economy: ReturnType<typeof defaultEconomy> }) => void) {
  const flow = defaultFlow(), economy = defaultEconomy();
  flow.autoSupply = false;
  mut?.({ flow, economy });
  return new GameCore(economy, flow, buildBoardLayout(defaultBoard(), { level: 1, pattern: 'mixed' }), 1);
}
function release(core: GameCore, n: number): ReleaseOrder[] {
  core.addRaw(n);
  const out: ReleaseOrder[] = [];
  for (let i = 0; i < 60 * 120 && out.length < n; i++) { core.beginTick(DT); core.takeReleases(DT, out); }
  return out;
}
const tick = (core: GameCore, seconds: number) => { for (let i = 0; i < Math.round(seconds / DT); i++) { core.beginTick(DT); core.stepByproduct(DT); } };
const expectConserved = (core: GameCore) => expect(core.conservationError()).toEqual({ produced: 0, seed: 0, raw: 0 });

describe('GameCore 경제 규칙', () => {
  it('하단 도착 시 본 재화를 정확히 한 번 지급하고 중복 도착은 무시한다', () => {
    const core = makeCore(), [order] = release(core, 1);
    core.onPegContact(order.id, 0);
    const pay = core.onArrive(order.id)!;
    const g = pegGain(core.layout.pegs[0].kind, 1);
    expect(pay.main).toBe(mainPayout(core.economy, g.process));
    expect(pay.byproduct).toBe(byproductValue(core.economy, g.byproduct));
    expect(core.onArrive(order.id)).toBeNull();
    expect(core.ledger.main).toBe(pay.main);
    expect(core.stats.duplicateArrivals).toBe(1);
    expect(core.stats.completed).toBe(1);
  });

  it('같은 페그 반복 접촉과 접촉 수 상한으로 점수가 무한히 늘지 않는다', () => {
    const core = makeCore(c => { c.economy.maxScoredHits = 3; }), [order] = release(core, 1);
    for (let i = 0; i < 100; i++) core.onPegContact(order.id, 0);
    const item = core.items.get(order.id)!;
    expect(item.scoredHits).toBe(1);
    for (let p = 0; p < core.layout.pegs.length; p++) core.onPegContact(order.id, p);
    expect(item.scoredHits).toBe(3);
    // 가공 점수 상한: 점수가 커도 지급은 processCap까지만
    item.processPoints = 10_000; item.byproductPoints = 10_000;
    const pay = core.onArrive(order.id)!;
    expect(pay.main).toBe(core.economy.mainBase + core.economy.mainPerProcess * core.economy.processCap);
    expect(pay.byproduct).toBe(core.economy.byproductCap);
  });

  it('부산물 생성·압축·트레이 도착만으로는 보너스를 주지 않고, 이탈 확정 시 한 번만 지급한다', () => {
    const core = makeCore();
    for (const o of release(core, 8)) { core.items.get(o.id)!.byproductPoints = 20; core.onArrive(o.id); }
    tick(core, 8);
    expect(core.feedQueue.length).toBeGreaterThan(0);
    const fed = [];
    while (core.canFeed()) fed.push(core.commitFeed()!);
    expect(core.ledger.bonusProduced).toBe(0);
    const token = fed[0];
    expect(core.onTokenExit(token.id)).toBe(Math.floor(token.value * core.economy.bonusRate));
    expect(core.onTokenExit(token.id)).toBeNull();
    expect(core.ledger.bonusProduced).toBe(Math.floor(token.value * core.economy.bonusRate));
    expect(core.stats.duplicateExits).toBe(1);
    expectConserved(core);
  });

  it('트레이·컨베이어 적체가 본 재화 지급을 막지 않는다', () => {
    const core = makeCore(c => { c.flow.trayMaxTokens = 0; c.flow.conveyorCapacity = 1; c.flow.compressCycleSec = 5; });
    const orders = release(core, 40);
    let paid = 0;
    for (const o of orders) { core.items.get(o.id)!.byproductPoints = 30; paid += core.onArrive(o.id)!.main; }
    tick(core, 20);
    expect(core.ledger.main).toBe(paid);
    expect(core.stats.completed).toBe(40);
    expect(core.commitFeed()).toBeNull();
    const a = core.account();
    expect(a.compressorBuffer + a.chuteValue).toBeGreaterThan(0);
    expect(a.feedCount + a.beltCount).toBeGreaterThan(0);
    expectConserved(core);
  });

  it('압축 묶음은 가치를 보존하고 대표 토큰은 묶인 단위 수만큼의 가치를 가진다', () => {
    const core = makeCore(c => { c.economy.tokenBundleMax = 4; c.flow.compressCycleSec = 1; });
    const [o] = release(core, 1);
    core.items.get(o.id)!.byproductPoints = 1000; // 상한 40 → 토큰 가치 8 × 5단위
    core.onArrive(o.id);
    tick(core, 8);
    let units = 0;
    core.feedQueue.forEach(t => { expect(t.value).toBe(t.units * core.economy.tokenValue); expect(t.units).toBeLessThanOrEqual(4); units += t.units; });
    expect(units * core.economy.tokenValue + core.compressorBuffer).toBe(core.economy.byproductCap);
    expectConserved(core);
  });

  it('무작위 사건 순서에서도 생산·초기 적재·원재료 수량이 보존된다', () => {
    const rng = new Rng(9), core = makeCore(c => { c.flow.autoSupply = true; c.flow.supplyPerSec = 5; c.flow.trayMaxTokens = 40; });
    core.placeSeed(30);
    const out: ReleaseOrder[] = [];
    for (let i = 0; i < 60 * 60; i++) {
      core.beginTick(DT);
      out.length = 0; core.takeReleases(DT, out);
      for (const id of [...core.items.keys()]) {
        if (rng.next() < 0.05) core.onPegContact(id, rng.int(core.layout.pegs.length));
        const r = rng.next();
        if (r < 0.02) core.onArrive(id); else if (r < 0.021) core.onItemLost(id);
        if (rng.next() < 0.001) core.onArrive(id); // 중복 도착 섞기
      }
      for (const id of [...core.tray.keys()]) { const r = rng.next(); if (r < 0.01) { core.onTokenExit(id); core.onTokenExit(id); } else if (r < 0.0105) core.onTokenLost(id); }
      if (core.canFeed() && rng.next() < 0.5) core.commitFeed();
      core.stepByproduct(DT);
      if (i % 300 === 0) expectConserved(core);
    }
    expectConserved(core);
    expect(core.stats.seedPaid).toBeGreaterThan(0);
    expect(core.ledger.bonusSeed).toBe(core.stats.seedValuePaid * core.economy.bonusRate);
  });
});

describe('화면 밖 처리', () => {
  function running() {
    const core = makeCore(c => { c.flow.autoSupply = true; c.flow.supplyPerSec = 3; });
    core.placeSeed(10);
    const out: ReleaseOrder[] = [];
    for (let i = 0; i < 60 * 15; i++) {
      core.beginTick(DT); out.length = 0; core.takeReleases(DT, out);
      for (const id of [...core.items.keys()]) { core.onPegContact(id, (id * 7) % 50); if ((id + i) % 90 === 0) core.onArrive(id); }
      while (core.canFeed()) core.commitFeed();
      for (const id of [...core.tray.keys()]) if ((id + i) % 400 === 0) core.onTokenExit(id);
      core.stepByproduct(DT);
    }
    return core;
  }

  it('전환 전후 대기량·처리 중·트레이 잔존 가치·기지급 보상을 보존한다', () => {
    const core = running();
    const before = core.account(), ledger = { ...core.ledger }, inBoard = [...core.items.keys()], tray = [...core.tray.keys()];
    core.setOffscreen(true);
    const mid = core.account();
    expect(mid.rawQueue).toBe(before.rawQueue);
    expect(mid.inBoard).toBe(before.inBoard);
    expect(mid.trayProduced + mid.traySeed).toBe(before.trayProduced + before.traySeed);
    expect(mid.byproductWaiting).toBe(before.byproductWaiting);
    expect(core.ledger).toEqual(ledger);
    for (let i = 0; i < 40; i++) core.advanceOffscreen(0.5);
    expectConserved(core);
    expect([...core.items.keys()]).toEqual(inBoard); // 보드 위 원재료는 정지 상태로 보존
    expect([...core.tray.keys()]).toEqual(tray);
    core.setOffscreen(false);
    expect(core.offscreenTray.length).toBe(0);
    expectConserved(core);
    // 화면 밖에서 지급된 토큰은 트레이 기록에 없으므로 이탈 사건이 와도 다시 지급되지 않는다
    const total = core.total;
    expect(core.onTokenExit(-1)).toBeNull();
    expect(core.total).toBe(total);
  });

  it('숨김 탭 경과 시간은 상한과 제한된 청크 수로만 정산한다', () => {
    const core = running();
    const r = core.settleElapsed(10_000);
    expect(r.settled).toBe(core.flow.hiddenSettleCapSec);
    expect(r.clipped).toBe(10_000 - core.flow.hiddenSettleCapSec);
    expect(r.chunks).toBe(Math.ceil(core.flow.hiddenSettleCapSec / 0.5));
    expect(core.offscreen).toBe(false);
    expectConserved(core);
  });
});
