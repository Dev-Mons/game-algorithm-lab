import { bonusFor, byproductValue, mainPayout, pegGain, type EconomyConfig, type FlowConfig, type PegKind } from './config';
import { Fifo } from './fifo';
import type { BoardLayout } from './layout';
import { Rng } from './rng';

/**
 * GameCore: 공급, 가공 점수, 부산물 가치, 재화 정산.
 * 물리 백엔드는 사실(페그 접촉·하단 도착·트레이 이탈·유실)만 전달하고, 지급·중복 방지·상한은 여기서만 처리한다.
 * 모든 가치는 정수이며 생성된 가치는 대기·이동·트레이·지급 중 정확히 한 곳에 존재한다.
 */
export interface ReleaseOrder { id: number; u: number; v: number; vu: number; vv: number }
export interface RawItem { id: number; processPoints: number; byproductPoints: number; scoredHits: number; touched: Set<number>; releasedAt: number }
export type TokenOrigin = 'produced' | 'seed';
export interface TokenRecord { id: number; units: number; value: number; origin: TokenOrigin; createdAt: number; batchId?: number; batchIndex?: number; batchSize?: number }
export interface ChutePacket { value: number; leftAt: number; arriveAt: number }
/** Physical line backpressure is supplied by the lab, without exposing any engine to the core. */
export interface ProcessGate { canPress: boolean; maxBatchSize?: number }
export type PressPhase = 'idle' | 'loading' | 'pressing' | 'retracting' | 'ready' | 'releasing';
export interface OffscreenEstimate { process: number; byproduct: number; recoveryPerSec: number; source: 'measured' | 'fallback' }

export type CoreEvent =
  | { type: 'main'; itemId: number; amount: number; u: number }
  | { type: 'byproduct'; value: number }
  | { type: 'press'; tokenId: number; units: number }
  | { type: 'bonus'; tokenId: number; amount: number; origin: TokenOrigin };

export interface CoreStats {
  supplied: number; released: number; completed: number; offscreenCompleted: number;
  pegContacts: number; scoredContacts: number;
  duplicateArrivals: number; duplicateExits: number; unknownEvents: number;
  lostItems: number; lostTokens: number;
  byproductEmitted: number; tokensMade: number; unitsMade: number; tokensFed: number;
  tokensPaid: number; producedValuePaid: number; seedPlaced: number; seedValuePlaced: number; seedPaid: number; seedValuePaid: number;
  offscreenPaid: number;
}

const WINDOW = 10;

export class GameCore {
  time = 0;
  rawQueue = 0;
  readonly items = new Map<number, RawItem>();
  readonly chute = new Fifo<ChutePacket>();
  compressorBuffer = 0;
  /** 실제 가압 사이클 경과 시간. 재료·다이 출구 여유가 없으면 새 사이클을 시작하지 않는다. */
  pressPhase: PressPhase = 'idle';
  pressTime = 0;
  compressionCount = 0;
  readonly feedQueue = new Fifo<TokenRecord>();
  readonly tray = new Map<number, TokenRecord>();
  readonly offscreenTray = new Fifo<TokenRecord>();
  offscreen = false;
  estimate: OffscreenEstimate | null = null;
  readonly ledger = { main: 0, bonusProduced: 0, bonusSeed: 0 };
  readonly stats: CoreStats = {
    supplied: 0, released: 0, completed: 0, offscreenCompleted: 0, pegContacts: 0, scoredContacts: 0,
    duplicateArrivals: 0, duplicateExits: 0, unknownEvents: 0, lostItems: 0, lostTokens: 0,
    byproductEmitted: 0, tokensMade: 0, unitsMade: 0, tokensFed: 0, tokensPaid: 0, producedValuePaid: 0,
    seedPlaced: 0, seedValuePlaced: 0, seedPaid: 0, seedValuePaid: 0, offscreenPaid: 0,
  };
  private supplyAcc = 0;
  private releaseAcc = 0;
  private nextItemId = 1;
  private nextTokenId = 1;
  private readonly rng: Rng;
  private readonly recentDone = new Fifo<number>();
  private readonly recentBonus = new Fifo<{ t: number; value: number; amount: number }>();
  private onscreenTime = 0;
  private sumProcess = 0; private sumByproduct = 0; private sampled = 0;
  private procAcc = 0; private byAcc = 0; private recoveryCredit = 0;
  private presentation: CoreEvent[] = [];

  constructor(readonly economy: EconomyConfig, readonly flow: FlowConfig, readonly layout: BoardLayout, seed: number) {
    this.rng = new Rng(seed ^ 0x51ed270b);
  }

  get total() { return this.ledger.main + this.ledger.bonusProduced + this.ledger.bonusSeed; }

  // ---------- 공급 ----------
  addRaw(count: number) {
    const n = Math.max(0, Math.floor(count));
    this.rawQueue += n; this.stats.supplied += n;
  }

  private supply(dt: number) {
    if (!this.flow.autoSupply) return;
    this.supplyAcc += this.flow.supplyPerSec * dt;
    const n = Math.floor(this.supplyAcc);
    if (n > 0) { this.supplyAcc -= n; this.addRaw(n); }
  }

  /** 고정 스텝 1회의 시간 진행과 공급. */
  beginTick(dt: number) {
    this.time += dt; this.onscreenTime += dt;
    this.supply(dt);
  }

  /** 플링코 처리량과 동시 수용량에 따라 투입할 원재료를 꺼낸다. */
  takeReleases(dt: number, out: ReleaseOrder[]) {
    const f = this.flow, d = this.layout.dims;
    this.releaseAcc = Math.min(this.releaseAcc + f.plinkoReleasePerSec * dt, 1 + f.plinkoReleasePerSec * dt);
    while (this.releaseAcc >= 1 && this.rawQueue > 0 && this.items.size < f.plinkoMaxActive) {
      this.releaseAcc -= 1; this.rawQueue--; this.stats.released++;
      const id = this.nextItemId++;
      this.items.set(id, { id, processPoints: 0, byproductPoints: 0, scoredHits: 0, touched: new Set(), releasedAt: this.time });
      out.push({ id, u: d.width / 2 + this.rng.range(-d.hopperSpread, d.hopperSpread), v: d.itemRadius + 0.25, vu: this.rng.range(-0.6, 0.6), vv: 0.5 });
    }
    if (this.rawQueue === 0) this.releaseAcc = Math.min(this.releaseAcc, 1);
  }

  // ---------- 플링코 사실 처리 ----------
  onPegContact(itemId: number, pegIndex: number) {
    const item = this.items.get(itemId), peg = this.layout.pegs[pegIndex];
    if (!item || !peg) { this.stats.unknownEvents++; return; }
    this.stats.pegContacts++;
    if (item.touched.has(pegIndex)) return; // 같은 페그 반복 접촉은 점수 없음
    item.touched.add(pegIndex);
    if (item.scoredHits >= this.economy.maxScoredHits) return;
    const g = pegGain(peg.kind, peg.level);
    item.processPoints += g.process; item.byproductPoints += g.byproduct; item.scoredHits++;
    this.stats.scoredContacts++;
  }

  /** 하단 처리기 도착: 본 재화 즉시 1회 지급 + 부산물 배출. 하류 적체와 무관하다. */
  onArrive(itemId: number, u = 0): { main: number; byproduct: number } | null {
    const item = this.items.get(itemId);
    if (!item) { this.stats.duplicateArrivals++; return null; }
    this.items.delete(itemId);
    return this.complete(item.processPoints, item.byproductPoints, itemId, u, true);
  }

  private complete(processPoints: number, byproductPoints: number, itemId: number, u: number, sampled: boolean) {
    const main = mainPayout(this.economy, processPoints), by = byproductValue(this.economy, byproductPoints);
    this.ledger.main += main; this.stats.completed++;
    this.recentDone.push(this.time);
    if (sampled) { this.sumProcess += processPoints; this.sumByproduct += byproductPoints; this.sampled++; }
    if (by > 0) {
      this.stats.byproductEmitted += by;
      this.chute.push({ value: by, leftAt: this.time, arriveAt: this.time + this.flow.chuteSeconds });
    }
    this.emit({ type: 'main', itemId, amount: main, u });
    if (by > 0) this.emit({ type: 'byproduct', value: by });
    return { main, byproduct: by };
  }

  /** 보드 밖 유실(비정상). 가치를 버리지 않도록 원재료를 대기열로 되돌린다. */
  onItemLost(itemId: number) {
    if (!this.items.delete(itemId)) { this.stats.unknownEvents++; return; }
    this.stats.lostItems++; this.rawQueue++;
  }

  // ---------- Inline press: load → stamp → retract → release directly below ----------
  stepByproduct(dt: number, gate?: ProcessGate) {
    while (this.chute.length && this.chute.peek()!.arriveAt <= this.time + 1e-9) this.compressorBuffer += this.chute.shift()!.value;
    const f = this.flow;
    this.pressTime += dt;
    switch (this.pressPhase) {
      case 'idle':
        if (this.feedQueue.length) { this.setPressPhase('ready'); break; } // exceptional returned inventory
        if (this.compressorBuffer > 0 && (!gate || gate.canPress)) {
          this.compressionCount = Math.min(this.compressorBuffer, Math.min(24, Math.max(1, Math.floor(this.economy.tokenBundleMax))), gate?.maxBatchSize ?? 24);
          this.setPressPhase('loading');
        }
        break;
      case 'loading':
        if (this.pressTime + 1e-9 >= f.pressLoadSec) this.setPressPhase('pressing');
        break;
      case 'pressing':
        if (this.pressTime + 1e-9 < f.compressCycleSec) break;
        {
          const count = this.compressionCount, batchId = this.nextTokenId;
          this.compressorBuffer -= count;
          for (let i = 0; i < count; i++) this.feedQueue.push({ id: this.nextTokenId++, units: 1, value: 1, origin: 'produced', createdAt: this.time, batchId, batchIndex: i, batchSize: count });
          this.stats.tokensMade += count; this.stats.unitsMade += count;
          this.compressionCount = 0;
          this.emit({ type: 'press', tokenId: batchId, units: count });
          this.setPressPhase('retracting');
        }
        break;
      case 'retracting':
        if (this.pressTime + 1e-9 >= f.pressRetractSec) this.setPressPhase('ready');
        break;
      case 'ready':
        if (!this.feedQueue.length) this.setPressPhase('releasing');
        break;
      case 'releasing':
        if (this.pressTime + 1e-9 >= f.pressOpenSec) this.setPressPhase(this.feedQueue.length ? 'ready' : 'idle');
        break;
    }
    if (this.offscreen && this.pressPhase === 'ready') {
      while (this.feedQueue.length) this.offscreenTray.push(this.feedQueue.shift()!);
      this.setPressPhase('releasing');
    }
  }

  private setPressPhase(phase: PressPhase) { this.pressPhase = phase; this.pressTime = 0; }

  // ---------- 트레이 ----------
  canFeed() { return (this.pressPhase === 'ready' || this.pressPhase === 'idle') && !this.offscreen && this.feedQueue.length > 0 && this.tray.size < this.flow.trayMaxTokens; }
  /** 투입구 대기열 맨 앞 토큰을 트레이(물리)로 옮긴다. */
  commitFeed(): TokenRecord | null {
    if (!this.canFeed()) return null;
    const token = this.feedQueue.shift()!;
    this.tray.set(token.id, token); this.stats.tokensFed++;
    return token;
  }

  canFeedBatch(count: number) { return count > 0 && this.canFeed() && this.feedQueue.length >= count && this.tray.size + count <= this.flow.trayMaxTokens; }
  /** Commit the whole gate load atomically: no partial capacity overflow or duplicated cargo. */
  commitFeedBatch(count: number): TokenRecord[] {
    if (!this.canFeedBatch(count)) return [];
    const tokens: TokenRecord[] = [];
    for (let i = 0; i < count; i++) tokens.push(this.commitFeed()!);
    this.setPressPhase('releasing');
    return tokens;
  }

  /** 초기 적재 토큰. 생산된 부산물과 별도로 기록한다. */
  placeSeed(count: number): TokenRecord[] {
    const out: TokenRecord[] = [];
    for (let i = 0; i < count; i++) {
      const token: TokenRecord = { id: this.nextTokenId++, units: 1, value: this.economy.tokenValue, origin: 'seed', createdAt: this.time };
      this.tray.set(token.id, token); this.stats.seedPlaced++; this.stats.seedValuePlaced += token.value; out.push(token);
    }
    return out;
  }

  /** 트레이에 둘 자리가 없는 초기 적재 토큰은 투입 대기열에 넣는다(가치 보존). */
  queueSeed(count: number) {
    for (let i = 0; i < count; i++) {
      const token: TokenRecord = { id: this.nextTokenId++, units: 1, value: this.economy.tokenValue, origin: 'seed', createdAt: this.time };
      this.feedQueue.push(token); this.stats.seedPlaced++; this.stats.seedValuePlaced += token.value;
    }
  }

  /** 보상 가장자리를 넘어 낙하가 확정된 토큰. 트레이 기록에서 제거하므로 같은 토큰은 두 번 지급되지 않는다. */
  onTokenExit(tokenId: number): number | null {
    const token = this.tray.get(tokenId);
    if (!token) { this.stats.duplicateExits++; return null; }
    this.tray.delete(tokenId);
    return this.payToken(token);
  }

  private payToken(token: TokenRecord) {
    const amount = bonusFor(this.economy, token.value);
    if (token.origin === 'seed') { this.ledger.bonusSeed += amount; this.stats.seedPaid++; this.stats.seedValuePaid += token.value; }
    else { this.ledger.bonusProduced += amount; this.stats.producedValuePaid += token.value; }
    this.stats.tokensPaid++;
    if (!this.offscreen) this.recentBonus.push({ t: this.time, value: token.value, amount });
    this.emit({ type: 'bonus', tokenId: token.id, amount, origin: token.origin });
    return amount;
  }

  /** 트레이 밖으로 비정상 이탈(관통·측면 이탈). 보너스 없이 투입구 대기열로 되돌려 가치를 보존한다. */
  onTokenLost(tokenId: number) {
    const token = this.tray.get(tokenId);
    if (!token) { this.stats.unknownEvents++; return; }
    this.tray.delete(tokenId); this.stats.lostTokens++; this.feedQueue.push(token);
  }

  // ---------- 화면 밖 처리 ----------
  computeEstimate(): OffscreenEstimate {
    const f = this.flow, window = Math.min(30, this.onscreenTime);
    this.pruneRecent();
    let recovered = 0;
    this.recentBonus.forEach(b => { if (b.t >= this.time - 30) recovered += b.value; });
    const measured = this.sampled >= 5;
    const recoveryMeasured = window >= 10 && recovered > 0;
    return {
      process: measured ? this.sumProcess / this.sampled : f.offscreenFallbackProcess,
      byproduct: measured ? this.sumByproduct / this.sampled : f.offscreenFallbackByproduct,
      recoveryPerSec: recoveryMeasured ? recovered / window : f.offscreenFallbackRecoveryPerSec,
      source: measured && recoveryMeasured ? 'measured' : 'fallback',
    };
  }

  setOffscreen(on: boolean) {
    if (on === this.offscreen) return;
    if (on) {
      this.estimate = this.computeEstimate();
      this.offscreen = true; this.recoveryCredit = 0;
      while (this.feedQueue.length) this.offscreenTray.push(this.feedQueue.shift()!);
    } else {
      this.offscreen = false;
      // 화면 밖 트레이 풀에 남은 토큰은 지급되지 않았으므로 실제 투입구 앞쪽으로 돌려보낸다.
      this.feedQueue.unshiftAll(this.offscreenTray.drainAll());
      this.estimate = null;
    }
  }

  /**
   * 처리량 기반 배치 근사. 물리 월드는 정지 상태로 보존되며(보드 위 원재료·트레이 토큰은 그대로),
   * 대기열에서 새로 꺼낸 원재료만 평균 점수로 즉시 완료 처리한다.
   */
  advanceOffscreen(dt: number) {
    if (!this.offscreen) throw new Error('advanceOffscreen은 화면 밖 모드에서만 호출합니다.');
    const est = this.estimate!, f = this.flow;
    this.time += dt;
    this.supply(dt);
    this.releaseAcc = Math.min(this.releaseAcc + f.plinkoReleasePerSec * dt, 1 + f.plinkoReleasePerSec * dt);
    while (this.releaseAcc >= 1 && this.rawQueue > 0) {
      this.releaseAcc -= 1; this.rawQueue--; this.stats.released++; this.stats.offscreenCompleted++;
      this.procAcc += est.process; this.byAcc += est.byproduct;
      const p = Math.floor(this.procAcc), b = Math.floor(this.byAcc);
      this.procAcc -= p; this.byAcc -= b;
      this.complete(p, b, -1, this.layout.dims.width / 2, false);
    }
    if (this.rawQueue === 0) this.releaseAcc = Math.min(this.releaseAcc, 1);
    this.stepByproduct(dt);
    this.recoveryCredit += est.recoveryPerSec * dt;
    while (this.offscreenTray.length && this.recoveryCredit >= this.offscreenTray.peek()!.value) {
      const token = this.offscreenTray.shift()!;
      this.recoveryCredit -= token.value; this.stats.offscreenPaid++;
      this.payToken(token);
    }
    if (!this.offscreenTray.length) this.recoveryCredit = Math.min(this.recoveryCredit, est.recoveryPerSec);
  }

  /** 숨김 탭 복귀 등 경과 시간을 상한·청크 수가 제한된 비용으로 정산한다. */
  settleElapsed(seconds: number, chunk = 0.5): { settled: number; clipped: number; chunks: number } {
    const settled = Math.max(0, Math.min(seconds, this.flow.hiddenSettleCapSec));
    if (settled <= 0) return { settled: 0, clipped: Math.max(0, seconds), chunks: 0 };
    const wasOffscreen = this.offscreen;
    if (!wasOffscreen) this.setOffscreen(true);
    const chunks = Math.ceil(settled / chunk);
    for (let i = 0; i < chunks; i++) this.advanceOffscreen(settled / chunks);
    if (!wasOffscreen) this.setOffscreen(false);
    return { settled, clipped: Math.max(0, seconds - settled), chunks };
  }

  // ---------- 조회 ----------
  setPeg(index: number, kind: PegKind, level: number) {
    const peg = this.layout.pegs[index];
    if (peg) { peg.kind = kind; peg.level = level; }
  }

  private pruneRecent() {
    while (this.recentDone.length && this.recentDone.peek()! < this.time - WINDOW) this.recentDone.shift();
    while (this.recentBonus.length && this.recentBonus.peek()!.t < this.time - 30) this.recentBonus.shift();
  }

  recentRates() {
    this.pruneRecent();
    const span = Math.max(1e-6, Math.min(WINDOW, this.time));
    let tokens = 0, bonus = 0;
    this.recentBonus.forEach(b => { if (b.t >= this.time - WINDOW) { tokens++; bonus += b.amount; } });
    return { completedPerSec: this.recentDone.length / span, tokensPerSec: tokens / span, bonusPerSec: bonus / span };
  }

  account() {
    let inBoardMain = 0, inBoardByproduct = 0, feedValue = 0, trayProduced = 0, traySeed = 0, offProduced = 0, offSeed = 0, chuteValue = 0, feedSeed = 0;
    for (const item of this.items.values()) { inBoardMain += mainPayout(this.economy, item.processPoints); inBoardByproduct += byproductValue(this.economy, item.byproductPoints); }
    this.chute.forEach(p => { chuteValue += p.value; });
    this.feedQueue.forEach(t => { if (t.origin === 'seed') feedSeed += t.value; else feedValue += t.value; });
    for (const t of this.tray.values()) { if (t.origin === 'seed') traySeed += t.value; else trayProduced += t.value; }
    this.offscreenTray.forEach(t => { if (t.origin === 'seed') offSeed += t.value; else offProduced += t.value; });
    return {
      rawQueue: this.rawQueue, inBoard: this.items.size, inBoardMain, inBoardByproduct,
      chuteValue, compressorBuffer: this.compressorBuffer,
      feedValue, feedSeed, feedCount: this.feedQueue.length,
      trayProduced, traySeed, trayCount: this.tray.size, offProduced, offSeed, offCount: this.offscreenTray.length,
      byproductWaiting: chuteValue + this.compressorBuffer + feedValue + offProduced,
    };
  }

  /** 가치 보존 검사. 0이면 생성된 모든 부산물 가치와 초기 적재 가치가 정확히 한 곳에 있다. */
  conservationError() {
    const a = this.account(), s = this.stats;
    const produced = s.byproductEmitted - (a.chuteValue + a.compressorBuffer + a.feedValue + a.trayProduced + a.offProduced + s.producedValuePaid);
    const seed = s.seedValuePlaced - (a.traySeed + a.feedSeed + a.offSeed + s.seedValuePaid);
    const raw = s.supplied - (this.rawQueue + this.items.size + s.completed);
    return { produced, seed, raw };
  }

  private emit(event: CoreEvent) {
    if (this.presentation.length >= 1024) this.presentation.splice(0, 512); // 표시용 이벤트만 버린다(정산과 무관)
    this.presentation.push(event);
  }
  drainPresentationEvents(): CoreEvent[] { const out = this.presentation; this.presentation = []; return out; }
}
