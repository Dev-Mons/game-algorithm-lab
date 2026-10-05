import { boardTransformFor, frameFromTransform, projectedGravity, PLACEMENTS, type BoardFrame, type PlacementId, type Transform } from '../core/frame';
import { GameCore, type ReleaseOrder } from '../core/game-core';
import { buildBoardLayout, type BoardLayout } from '../core/layout';
import { vec3 } from '../core/math';
import { Rng } from '../core/rng';
import { BodySnapshot, type PlinkoBackend, type PlinkoEvent, type PusherBackend, type PusherEvent } from '../physics/contracts';
import { createPlinko, createPusher } from '../physics/registry';
import { pusherMotion, trayGeometry } from '../physics/tray-geometry';
import { deviceLayout, coinTransferPoint, coinExitVelocity, COIN_TRANSFER_SECONDS, PROCESSOR_EXIT_V, POCKET_COUNT, POCKET_LEAD, POCKET_WALL_HALF, rawFeedRoute, pressStroke, OUTLET_STAGGER_SECONDS, PLANAR_LOWER_SECONDS, type DeviceLayout } from './device-layout';
import { Silo2D } from '../physics/silo-2d';
import { ScrapPress } from '../physics/scrap-press';
import { SCRAP_BELT_SECONDS, RAMP_START, VISIBLE_EXIT_FRACTION } from './device-layout';
import { localToWorld } from '../core/frame';
import type { Scenario } from './scenario';

const now = () => globalThis.performance.now();

export interface StepTiming { plinkoMs: number; pusherMs: number; coreMs: number }
export interface ExitVisual { id: number; x: number; y: number; z: number; vx?: number; vy?: number; vz?: number; rotation?: [number, number, number, number]; value: number; origin: 'produced' | 'seed' }

/**
 * 한 실험의 공통 고정 스텝 파이프라인. 렌더링과 무관하며 브라우저와 Node 측정 스크립트가 같이 쓴다.
 * 순서: 시간·공급 → 투입 → 플링코 step → 플링코 사실 정산 → 공통 푸셔 운동 → 트레이 공급 게이트 → 푸셔 step → 이탈 정산 → 부산물 공정.
 */
export class Simulation {
  readonly core: GameCore;
  readonly layout: BoardLayout;
  readonly device: DeviceLayout;
  readonly silo: Silo2D;
  readonly scrap: ScrapPress;
  scrapLoaded = 0;
  private pileAge = 0;
  readonly feedSlots = new Map<number,number>();
  boardWorld!: Transform; boardParent!: Transform; frame!: BoardFrame;
  tick = 0;
  readonly plinkoSnap = new BodySnapshot(64);
  readonly pusherSnap = new BodySnapshot(256);
  /** 투입 판정은 렌더링 sync 주기와 무관하게 현재 물리 상태를 읽는다. */
  private readonly feedSnapshot = new BodySnapshot(256);
  readonly timing: StepTiming = { plinkoMs: 0, pusherMs: 0, coreMs: 0 };
  initMs = { plinko: 0, pusher: 0 };
  pusherFace = 0;
  readonly exitVisuals: ExitVisual[] = [];
  readonly gateStats = { blocked: 0, fed: 0 };
  private releases: ReleaseOrder[] = [];
  private plinkoEvents: PlinkoEvent[] = [];
  private pusherEvents: PusherEvent[] = [];
  readonly discharge = { progress:0, blocked:false, lowerProgress:0, releaseAt:-Infinity, lastCount:0, elapsed:0, batchSize:0, batchId:0,
    ports:Array.from({length:4},()=>({progress:0,lowerProgress:0,done:false,blocked:false,releaseAt:-Infinity,nozzleAt:-Infinity})) };
  readonly batchStats = { dumps: 0, largestDump: 0 };
  readonly handovers: Array<{ id: number; x: number; y: number; z: number; vy: number; vz: number; tick: number; port: number; slot: number; batchId: number }> = [];
  readonly pegFlashes = new Map<number, number>();
  private disposed = false;

  private constructor(readonly scenario: Scenario, readonly plinko: PlinkoBackend, readonly pusher: PusherBackend) {
    this.layout = buildBoardLayout(scenario.board, scenario.pegs);
    this.core = new GameCore(scenario.economy, scenario.flow, this.layout, scenario.seed);
    for (const peg of scenario.pegOverrides) this.core.setPeg(peg.index, peg.kind, peg.level);
    this.device = deviceLayout(scenario.board, scenario.tray, pusher.mode === 'stacked');
    this.silo = new Silo2D(this.device.silo);
    this.scrap = new ScrapPress(this.device.scrap,this.device.scrapCoverY);
    this.setPlacement(scenario.placement);
  }

  static async create(scenario: Scenario): Promise<Simulation> {
    const sim = new Simulation(scenario, createPlinko(scenario.backends.plinko), createPusher(scenario.backends.pusher));
    try {
      const s = scenario;
      const gravity = s.plinko.gravityMode === 'world-projected' ? projectedGravity(sim.frame, vec3(0, -s.plinko.gravity, 0)) : { u: 0, v: s.plinko.gravity };
      let t = now();
      await sim.plinko.init({ width: s.board.width, height: s.board.height + PROCESSOR_EXIT_V, receiving: { start:s.board.height+POCKET_LEAD,count:POCKET_COUNT,halfThickness:POCKET_WALL_HALF }, pegs: sim.layout.pegs, pegRadius: s.board.pegRadius, gravity }, s.plinko);
      sim.initMs.plinko = now() - t;
      t = now();
      await sim.pusher.init({ dims: s.tray, wallHeight: trayGeometry(s.tray).wallHeight }, s.pusher);
      sim.initMs.pusher = now() - t;
      sim.core.addRaw(s.initialRaw);
      sim.silo.syncStock(sim.core.rawQueue, true);
      sim.seedTray(s.initialTokens);
      sim.pusherFace = s.tray.faceMin;
      sim.pusher.setPusher(s.tray.faceMin, 0);
      return sim;
    } catch (error) {
      sim.dispose();
      throw error;
    }
  }

  /** 보드 배치만 바꾼다. 로컬 물리 상태는 그대로이며 표시·선택 변환만 달라진다. */
  setPlacement(id: PlacementId) {
    const b = this.scenario.board, anchor = { ...this.device.boardAnchor };
    let t = boardTransformFor(PLACEMENTS[id], anchor, b.width, b.height, this.device.boardScale);
    const frame = frameFromTransform(t.world);
    const low = Math.min(...[0, b.width / 2, b.width].map(u => localToWorld(frame, u, b.height + PROCESSOR_EXIT_V, 0.3).y));
    if (low < this.device.pressIn.y + 0.7) {
      anchor.y += this.device.pressIn.y + 0.7 - low;
      t = boardTransformFor(PLACEMENTS[id], anchor, b.width, b.height, this.device.boardScale);
    }
    this.boardParent = t.parent; this.boardWorld = t.world; this.frame = frameFromTransform(t.world);
    this.scenario.placement = id;
  }

  private seedTray(count: number) {
    if (count <= 0) return;
    if (this.pusher.mode === 'stacked') { this.seedHeap(count); return; }
    const d = this.scenario.tray, r = d.tokenRadius;
    const spacing = r * 2 * 1.02, rowStep = spacing * Math.sqrt(3) / 2;
    const z0 = d.faceMin + d.stroke + r - 0.12, z1 = d.depth - r - 0.3, x0 = -d.width / 2 + r + 0.02, x1 = d.width / 2 - r - 0.02;
    const slots: Array<[number, number]> = [];
    for (let row = 0, z = z0; z <= z1; row++, z += rowStep) for (let x = x0 + (row % 2 ? spacing / 2 : 0); x <= x1; x += spacing) slots.push([x, z]);
    const rng = new Rng(this.scenario.seed * 31 + 5);
    for (let i = slots.length - 1; i > 0; i--) { const j = rng.int(i + 1); [slots[i], slots[j]] = [slots[j], slots[i]]; }
    // 단층 조건: 한 층 슬롯을 넘는 초기 토큰은 겹쳐 넣지 않고 투입 대기열로 보낸다(투입구 게이트를 통해 들어감).
    const onTray = Math.min(count, slots.length);
    this.core.placeSeed(onTray).forEach((token, i) => {
      const [x, z] = slots[i];
      this.pusher.spawn({ id: token.id, x, y: d.tokenHalfHeight, z, radius: r, halfHeight: d.tokenHalfHeight });
    });
    if (count > onTray) this.core.queueSeed(count - onTray);
  }

  /**
   * 적층 조건 초기 적재: 뒤쪽·가운데가 높고 앞쪽·가장자리가 낮은 더미. 층마다 반 칸 어긋나게 둔다.
   * 슬롯이 모자라면 최대 층수를 올린다. 배치 후 첫 몇 초 동안 더미가 스스로 무너지며 자리를 잡는다.
   */
  private seedHeap(count: number) {
    const d = this.scenario.tray, r = d.tokenRadius, h = d.tokenHalfHeight;
    const spacing = r * 2 * 1.02, rowStep = spacing * Math.sqrt(3) / 2;
    const z0 = d.faceMin + d.stroke + r - 0.12, z1 = d.depth - r - 0.3, x0 = -d.width / 2 + r + 0.02, x1 = d.width / 2 - r - 0.02;
    const rng = new Rng(this.scenario.seed * 31 + 5);
    const heightAt = (x: number, z: number, maxLayers: number) => maxLayers * (1 - 0.7 * (z - z0) / Math.max(1e-6, z1 - z0)) * (1 - 0.45 * Math.abs(x) / (d.width / 2));
    let slots: Array<[number, number, number]> = [];
    for (let maxLayers = 1; maxLayers < 40; maxLayers++) {
      slots = [];
      for (let layer = 0; layer < maxLayers + 1; layer++) {
        const layerSlots: Array<[number, number, number]> = [], ox = layer % 2 ? spacing / 2 : 0, oz = layer % 2 ? rowStep / 3 : 0;
        for (let row = 0, z = z0 + oz; z <= z1; row++, z += rowStep) for (let x = x0 + ox + (row % 2 ? spacing / 2 : 0); x <= x1; x += spacing) if (layer === 0 || heightAt(x, z, maxLayers) > layer) layerSlots.push([x, z, layer]);
        for (let i = layerSlots.length - 1; i > 0; i--) { const j = rng.int(i + 1); [layerSlots[i], layerSlots[j]] = [layerSlots[j], layerSlots[i]]; }
        slots.push(...layerSlots);
      }
      if (slots.length >= count) break;
    }
    this.core.placeSeed(count).forEach((token, i) => {
      const [x, z, layer] = slots[i % slots.length];
      this.pusher.spawn({ id: token.id, x: x + rng.range(-0.04, 0.04), y: h + layer * (2 * h + 0.004) + 0.001, z: z + rng.range(-0.04, 0.04), radius: r, halfHeight: h });
    });
  }

  addRaw(count: number) { this.core.addRaw(count); }

  step() {
    if (this.disposed) return;
    const s = this.scenario, dt = s.fixedDt, core = this.core;
    let t0 = now();
    core.beginTick(dt);
    for (const entry of s.schedule) if (entry.tick === this.tick) core.addRaw(entry.count);
    this.releases.length = 0;
    this.silo.syncStock(core.rawQueue);
    this.silo.step(dt);
    core.takeReleases(dt, this.releases, u => rawFeedRoute(s.board, this.frame, this.device, u).seconds, () => {
      if (!this.silo.takeAtOutlet()) return null;
      const p=this.silo.lastExit!;
      return vec3(this.device.silo.x+p.x,p.y,this.device.silo.z);
    });
    for (const r of this.releases) this.plinko.spawn({ ...r, radius: s.board.itemRadius });
    let coreMs = now() - t0;

    t0 = now();
    this.plinko.step(dt);
    this.timing.plinkoMs = now() - t0;

    t0 = now();
    this.plinkoEvents.length = 0;
    this.plinko.drainEvents(this.plinkoEvents);
    for (const e of this.plinkoEvents) {
      if (e.type === 'peg') { core.onPegContact(e.id, e.peg); this.pegFlashes.set(e.peg, core.time); }
      else if (e.type === 'arrive') core.onArrive(e.id, e.u, e,s.flow.chuteSeconds+SCRAP_BELT_SECONDS);
      else core.onItemLost(e.id);
    }
    const motion = pusherMotion(s.tray, (this.tick + 1) * dt);
    this.pusherFace = motion.face;
    this.pusher.setPusher(motion.face, motion.velocity);
    this.feedTray(dt);
    coreMs += now() - t0;

    t0 = now();
    this.pusher.step(dt);
    this.timing.pusherMs = now() - t0;

    t0 = now();
    this.pusherEvents.length = 0;
    this.pusher.drainEvents(this.pusherEvents);
    for (const e of this.pusherEvents) {
      if (e.type === 'exit') {
        const token = core.tray.get(e.id);
        if (core.onTokenExit(e.id) !== null && token && this.exitVisuals.length < 256) this.exitVisuals.push({ ...e, value: token.value, origin: token.origin });
      } else core.onTokenLost(e.id);
    }
    this.stepScrap(dt);
    this.timing.coreMs = coreMs + now() - t0;
    this.tick++;
  }

  private stepScrap(dt:number) {
    const core=this.core,phase=core.pressPhase;
    const target=Math.min(24,Math.max(1,Math.floor(core.economy.tokenBundleMax)),this.device.cargoColumns*this.device.cargoRows);
    if(!this.scrap.bodies.length && phase!=='loading' && phase!=='pressing')this.scrap.admissionLimit=target;
    this.scrap.syncStock(Math.max(0,core.compressorBuffer-this.scrapLoaded));
    this.scrap.gateOpen=false;
    this.scrap.intakeOpen=phase!=='loading' && phase!=='pressing' && phase!=='retracting';
    if(phase==='pressing') {
      this.scrap.time+=dt;
      const t=(core.pressTime+dt)/this.scenario.flow.compressCycleSec;
      this.scrap.lower(Math.max(0,Math.min(1,(t-.2)/.6)));
      while(this.scrapLoaded<core.compressionCount && this.scrap.takeCovered())this.scrapLoaded++;
    } else if(phase==='retracting') {
      this.scrap.time+=dt;
    } else {
      this.scrap.step(dt);
    }
    this.pileAge=core.compressorBuffer>0?this.pileAge+dt:0;
    const settled=this.scrap.bodies.some(b=>b.y<this.device.scrap.bottom+.45);
    const enough=this.scrap.bodies.length>=this.scrap.admissionLimit || this.pileAge>=1.4;
    const loaded=this.scrapLoaded>=core.compressionCount || this.scrap.bodies.every(b=>b.y+b.radius<this.device.scrap.top-.02 && Math.abs(b.vy)<.7);
    core.stepByproduct(dt,{canPress:this.feedSlots.size===0 && settled && enough,
      preparedBatchSize:this.scrap.bodies.length,maxBatchSize:this.device.cargoColumns*this.device.cargoRows,
      loaded,processed:this.scrapLoaded>=core.compressionCount});
    if(phase==='idle' && core.pressPhase==='loading')this.pileAge=0;
    if(phase==='loading' && core.pressPhase==='pressing')this.scrap.beginStroke();
    if(phase==='pressing' && core.pressPhase==='retracting')this.scrapLoaded=0;
    if(phase==='retracting' && core.pressPhase==='ready')this.scrap.resetStroke();
    this.scrap.syncStock(Math.max(0,core.compressorBuffer-this.scrapLoaded));
  }
  get actuatorStroke() { return pressStroke(this.core.pressPhase,this.core.pressTime,this.scenario.flow.compressCycleSec,this.scenario.flow.pressRetractSec); }
  get pressPose() {
    const core=this.core,bin=this.device.scrap,parkY=bin.top+.02,parkZ=bin.z-.95;
    const clamp=(x:number)=>Math.max(0,Math.min(1,x));
    if(core.pressPhase==='loading')return {y:parkY,z:parkZ+.95*clamp(core.pressTime/this.scenario.flow.pressLoadSec),floorDrop:0};
    if(core.pressPhase==='pressing') {
      const t=core.pressTime/this.scenario.flow.compressCycleSec;
      const y=t<.2?parkY+(this.scrap.contactY-parkY)*clamp(t/.2):this.scrap.contactY-this.scrap.floorDrop;
      return {y,z:bin.z,floorDrop:this.scrap.floorDrop};
    }
    if(core.pressPhase==='retracting') {
      const t=clamp(core.pressTime/this.scenario.flow.pressRetractSec),rise=clamp(t/.8);
      const low=this.scrap.contactY-this.scrap.travel;
      return {y:low+(parkY-low)*rise,z:bin.z-.95*clamp((t-.8)/.2),floorDrop:this.scrap.floorDrop*(1-rise)};
    }
    return {y:parkY,z:parkZ,floorDrop:0};
  }
  get dischargeY() { return this.diePosition(0).y; }
  diePosition(index:number) {
    const port=this.discharge.ports[index%this.device.outletCount];
    const p=coinTransferPoint(this.device,index,port.progress);
    if(this.pusher.mode!=='stacked')p.y+=(this.device.dropY-this.device.outletY)*port.lowerProgress;
    return p;
  }
  feedDisplay() {
    const out:Array<{id:number;slot:number;seed:boolean}>=[];
    for(let i=0;i<this.core.feedQueue.length && out.length<24;i++) {
      const t=this.core.feedQueue.at(i)!;
      if(this.feedSlots.size && !this.feedSlots.has(t.id))continue;
      out.push({id:t.id,slot:this.feedSlots.get(t.id)??i,seed:t.origin==='seed'});
    }
    return out;
  }
  /** Internal transfers remain real queued inventory; only coins at the nozzle mouth are visible. */
  outletDisplay() {
    return this.feedDisplay().filter(t=>this.discharge.ports[t.slot%this.device.outletCount].progress>=VISIBLE_EXIT_FRACTION);
  }

  private feedTray(dt:number) {
    const core=this.core,d=this.scenario.tray,dev=this.device,stacked=this.pusher.mode==='stacked';
    this.discharge.blocked=false;
    if(core.pressPhase!=='ready')return;
    if(!this.feedSlots.size) {
      const count=Math.min(core.feedQueue.length,dev.cargoColumns*dev.cargoRows);
      if(!count)return;
      for(let i=0;i<count;i++)this.feedSlots.set(core.feedQueue.at(i)!.id,i);
      this.discharge.batchSize=count;this.discharge.batchId++;
    }
    if(this.discharge.elapsed===0 && !core.canFeedBatch(this.discharge.batchSize)) {
      this.discharge.blocked=true;this.gateStats.blocked++;return;
    }
    this.discharge.elapsed+=dt;
    this.pusher.snapshot(this.feedSnapshot);
    for(let outlet=0;outlet<dev.outletCount;outlet++) {
      const port=this.discharge.ports[outlet];port.blocked=false;
      if(port.done)continue;
      const entries=[...this.feedSlots].filter(([,slot])=>slot%dev.outletCount===outlet);
      if(!entries.length){port.done=true;continue;}
      if(this.discharge.elapsed<outlet*OUTLET_STAGGER_SECONDS)continue;
      if(!core.canFeedBatch(entries.length)||!this.inletClear(entries.map(([,slot])=>slot))) {
        port.blocked=true;this.discharge.blocked=true;this.gateStats.blocked++;continue;
      }
      let nextProgress=Math.min(1,port.progress+dt/COIN_TRANSFER_SECONDS);
      if(stacked && port.progress<RAMP_START)nextProgress=Math.min(RAMP_START,nextProgress);
      const opening=stacked && port.progress===RAMP_START && nextProgress>RAMP_START;
      if(opening && core.time-Math.max(...this.discharge.ports.map(p=>p.nozzleAt))<OUTLET_STAGGER_SECONDS-1e-9) {
        port.blocked=true;this.discharge.blocked=true;this.gateStats.blocked++;continue;
      }
      // Hold inside the nozzle until the moving plate will support the complete falling group.
      if(stacked && (opening || nextProgress===1)
        && !this.plateLandingClear(entries.map(([,slot])=>slot),nextProgress===1?1:port.progress)) {
        port.blocked=true;this.discharge.blocked=true;this.gateStats.blocked++;continue;
      }
      if(!this.transferClear(entries.map(([,slot])=>slot),nextProgress)) {
        port.blocked=true;this.discharge.blocked=true;this.gateStats.blocked++;continue;
      }
      if(opening)port.nozzleAt=core.time;
      port.progress=nextProgress;
      this.discharge.progress=Math.max(this.discharge.progress,port.progress);
      if(port.progress<1)continue;
      if(!stacked) {
        let safe=true;
        if(port.lowerProgress===0)for(let time=0;time<=PLANAR_LOWER_SECONDS*2;time+=dt) {
          if(pusherMotion(d,core.time+time).face>dev.feedZ-d.tokenRadius-.03){safe=false;break;}
        }
        if(!safe){port.blocked=true;this.discharge.blocked=true;this.gateStats.blocked++;continue;}
        port.lowerProgress=Math.min(1,port.lowerProgress+dt/PLANAR_LOWER_SECONDS);
        this.discharge.lowerProgress=Math.max(this.discharge.lowerProgress,port.lowerProgress);
        if(port.lowerProgress<1)continue;
      }
      const tokens=core.commitFeedGroup(entries.map(([id])=>id)),velocity=stacked?coinExitVelocity(dev):vec3();
      if(!tokens.length)continue;
      for(const token of tokens) {
        const slot=this.feedSlots.get(token.id)!,p=this.diePosition(slot);
        const handover={id:token.id,x:p.x,y:p.y,z:p.z-dev.trayZ0,vy:velocity.y,vz:velocity.z,tick:this.tick,port:outlet,slot,batchId:this.discharge.batchId};
        this.pusher.spawn({...handover,radius:d.tokenRadius,halfHeight:d.tokenHalfHeight});
        this.handovers.push(handover);if(this.handovers.length>96)this.handovers.shift();
      }
      this.gateStats.fed+=tokens.length;port.done=true;port.releaseAt=core.time;
    }
    if(this.discharge.ports.every(p=>p.done)) {
      this.batchStats.dumps++;this.batchStats.largestDump=Math.max(this.batchStats.largestDump,this.discharge.batchSize);
      this.discharge.releaseAt=core.time;this.discharge.lastCount=this.discharge.batchSize;
      core.finishFeedBatch();this.resetDischarge(true);
    }
  }

  private inletClear(slots:readonly number[]):boolean {
    const d=this.scenario.tray,dev=this.device,stacked=this.pusher.mode==='stacked';
    const snap=this.feedSnapshot,radius=Math.hypot(d.tokenRadius,d.tokenHalfHeight);
    if(!stacked && this.pusherFace>dev.feedZ-d.tokenRadius-.015)return false;
    for(const slot of slots) {
      const x=coinTransferPoint(dev,slot,1).x;
      for(let k=0;k<snap.count;k++) {
        if(Math.hypot(snap.a[k]-x,snap.b[k]-dev.feedZ)>(stacked?2*radius+.15:2*d.tokenRadius+.015))continue;
        if(!stacked || snap.c[k]+radius>dev.dropY-d.tokenHalfHeight-.25)return false;
      }
    }
    return true;
  }

  private plateLandingClear(slots:readonly number[],progress:number):boolean {
    const d=this.scenario.tray,g=trayGeometry(d),gravity=this.scenario.pusher.gravity;
    if(gravity<=0 || this.device.feedZ-d.tokenRadius<g.lip.zFront+.06)return false;
    const vy=coinExitVelocity(this.device).y,remaining=(1-progress)*COIN_TRANSFER_SECONDS;
    const inset=Math.min(d.tokenRadius+.08,Math.max(.12,d.stroke-d.tokenRadius-.1));
    for(const slot of slots) {
      const height=coinTransferPoint(this.device,slot,1).y-g.plateHeight-d.tokenHalfHeight;
      const fall=(vy+Math.sqrt(vy*vy+2*gravity*Math.max(0,height)))/gravity;
      for(const margin of [-2,0,2]) {
        const face=pusherMotion(d,this.core.time+remaining+fall+margin*this.scenario.fixedDt).face;
        if(this.device.feedZ<face-d.pusherDepth+inset || this.device.feedZ>face-inset)return false;
      }
    }
    return true;
  }

  /** A stopped lane may occupy another lane's turn across the deck: reserve space before moving. */
  private transferClear(slots:readonly number[],progress:number):boolean {
    const t=this.scenario.tray,port=slots[0]%this.device.outletCount;
    for(const slot of slots) {
      const a=coinTransferPoint(this.device,slot,progress);
      for(const other of this.feedSlots.values()) {
        if(other%this.device.outletCount===port || this.discharge.ports[other%this.device.outletCount].done)continue;
        const b=this.diePosition(other);
        if(Math.abs(a.y-b.y)<2*t.tokenHalfHeight+.02 && Math.hypot(a.x-b.x,a.z-b.z)<2*t.tokenRadius+.04)return false;
      }
    }
    return true;
  }

  /** 표시·측정용 상태 전달. 호출 주기는 물리 결과에 영향을 주지 않는다. */
  sync(): number {
    const t0 = now();
    this.plinko.snapshot(this.plinkoSnap);
    this.pusher.snapshot(this.pusherSnap);
    return now() - t0;
  }

  setOffscreen(on: boolean) {
    this.core.setOffscreen(on);
    if (on) this.resetDischarge(); else this.reconcileScrap();
  }
  /** Hidden-tab settlement can pay/reorder output; restart the planar descent guide from the die. */
  settleElapsed(seconds: number) {
    const result = this.core.settleElapsed(seconds);
    if (result.settled > 0) { this.resetDischarge(); this.reconcileScrap(); }
    return result;
  }
  private resetDischarge(keepExitTimes=false) {
    this.feedSlots.clear();this.discharge.progress=0;this.discharge.lowerProgress=0;this.discharge.blocked=false;this.discharge.elapsed=0;
    for(const p of this.discharge.ports) {p.progress=0;p.lowerProgress=0;p.done=false;p.blocked=false;p.nozzleAt=-Infinity;if(!keepExitTimes)p.releaseAt=-Infinity;}
  }
  /** Offscreen approximation is explicitly reconciled, never used as a normal physical intake. */
  private reconcileScrap() {
    this.scrap.resetStroke();
    this.scrapLoaded=this.core.compressionCount;
    this.scrap.bodies.length=0;this.scrap.gateOpen=false;
    this.scrap.syncStock(Math.max(0,this.core.compressorBuffer-this.scrapLoaded));
  }
  advanceOffscreen(dt: number) { this.core.advanceOffscreen(dt); }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    try { this.plinko.dispose(); } finally { this.pusher.dispose(); }
  }
  get isDisposed() { return this.disposed; }
}
