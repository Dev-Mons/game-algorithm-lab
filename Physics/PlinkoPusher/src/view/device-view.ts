import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { localToWorld, rayToLocal } from '../core/frame';
import { pickPeg, type Peg } from '../core/layout';
import type { Quality } from '../lab/scenario';
import type { Simulation, ExitVisual } from '../lab/simulation';
import { ITEM_DEPTH, PROCESS_FRACTION, cargoOffset, byproductPoint } from '../lab/device-layout';
import { DeviceScene } from './device-scene';
import { DeviceCamera, type CameraPreset } from './device-camera';
import { C, createDeviceMaterials, type DeviceMaterials } from './materials';
import { ResourceScope } from './resources';

/**
 * Presentation: 3D 배치·메시·인스턴싱·공정 연출. 물리·경제 상태를 읽기만 하며 엔진 객체를 참조하지 않는다.
 * 원석의 월드 위치는 코어의 localToWorld(BoardFrame)로 계산한다(보드 메시는 같은 Transform을 쓰는 그룹).
 */
export type { CameraPreset } from './device-camera';
interface Falling { active: boolean; x: number; y: number; z: number; vx: number; vy: number; vz: number; spin: number; t: number; color: THREE.Color; rotation: THREE.Quaternion }
interface Glint { active: boolean; t: number }

export class DeviceView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 1, 0.1, 600);
  private readonly navigation: DeviceCamera;
  get controls() { return this.navigation.controls; }
  private showLabels = false;
  private readonly sun = new THREE.DirectionalLight(0xfff2e0, 2.2);
  private readonly mats: DeviceMaterials;
  private readonly lifetimeResources = new ResourceScope();
  private readonly resizeObserver: ResizeObserver;
  private disposed = false;
  private sim: Simulation | null = null;
  private device: DeviceScene | null = null;
  private falling: Falling[] = []; private glintPool: Glint[] = [];
  private lastFlowTime = 0; private mainCollected = 0;
  private pressTimer = 0; private collectTimer = 0;
  private readonly m4 = new THREE.Matrix4(); private readonly q = new THREE.Quaternion(); private readonly v = new THREE.Vector3(); private readonly s = new THREE.Vector3(1, 1, 1);
  private readonly color = new THREE.Color(); private readonly ore = new THREE.Color(C.ore); private readonly done = new THREE.Color(C.processed);
  private readonly tokenColors = { 1: new THREE.Color(C.steel), 2: new THREE.Color(C.bundle2), 3: new THREE.Color(C.bundle3), seed: new THREE.Color(C.seed) };

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color(0x111820);
    this.scene.fog = new THREE.Fog(0x111820, 90, 260);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.scene.environment = this.lifetimeResources.own(pmrem.fromScene(room, 0.04)).texture;
    room.dispose();
    this.scene.environmentIntensity = 0.85;
    pmrem.dispose();
    this.scene.add(new THREE.HemisphereLight(0xdfe8ee, 0x2a2622, 0.55));
    this.sun.position.set(18, 40, 26);
    this.scene.add(this.sun, this.sun.target);
    this.mats = createDeviceMaterials();
    this.navigation = new DeviceCamera(this.camera, this.renderer.domElement);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  private resize() {
    const w = Math.max(1, this.container.clientWidth), h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  setQuality(q: Quality) {
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(q === 'low' ? 1 : q === 'medium' ? Math.min(dpr, 1.5) : Math.min(dpr, 2));
    this.renderer.shadowMap.enabled = q !== 'low';
    this.sun.castShadow = q !== 'low';
    this.sun.shadow.mapSize.set(q === 'high' ? 2048 : 1024, q === 'high' ? 2048 : 1024);
    this.sun.shadow.map?.dispose(); (this.sun.shadow as { map: unknown }).map = null;
    if (this.device) this.device.tokens.castShadow = q === 'high';
    this.resize();
  }

  build(sim: Simulation) {
    this.clear();
    this.sim = sim;
    const device = new DeviceScene(this.mats);
    this.device = device;
    this.scene.add(device.root);
    device.build(sim);
    device.setLabels(this.showLabels);
    this.navigation.bind(sim, device.size);
    this.sun.target.position.set(0, 0, 0);
    const cam = this.sun.shadow.camera, r = 30 * device.size;
    cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r; cam.near = 1; cam.far = 140 * device.size; cam.updateProjectionMatrix();
    this.setQuality(sim.scenario.quality);
    this.falling = Array.from({ length: 96 }, () => ({ active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, spin: 0, t: 0, color: new THREE.Color(), rotation: new THREE.Quaternion() }));
    this.glintPool = Array.from({ length: 32 }, () => ({ active: false, t: 0 }));
    this.updateItems(sim); this.updateTokens(sim);
  }

  clear() {
    this.sim = null;
    this.navigation.bind(null);
    this.device?.dispose(); this.device = null;
    this.falling = []; this.glintPool = [];
    this.pressTimer = 0; this.collectTimer = 0; this.lastFlowTime = 0; this.mainCollected = 0;
  }

  refreshPegColors() { this.device?.refreshPegColors(); }
  updatePlacement() { this.device?.updatePlacement(); }
  setLabels(on: boolean) { this.showLabels = on; this.device?.setLabels(on); }
  setCamera(preset: CameraPreset, animate = true) { this.navigation.setCamera(preset, animate); }

  // ---------- 선택 ----------
  /** 화면 좌표 → 월드 광선 → 보드 로컬 (u, v) → 페그. 판정은 로컬 좌표에서만 한다. */
  pick(clientX: number, clientY: number): { peg: Peg | null; u: number; v: number } | null {
    const sim = this.sim;
    if (!sim) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, this.camera);
    const o = ray.ray.origin, d = ray.ray.direction;
    const hit = rayToLocal(sim.frame, { x: o.x, y: o.y, z: o.z }, { x: d.x, y: d.y, z: d.z }, ITEM_DEPTH);
    if (!hit || hit.u < -1 || hit.u > sim.scenario.board.width + 1 || hit.v < -1 || hit.v > sim.scenario.board.height + 1) return null;
    return { peg: pickPeg(sim.layout, hit.u, hit.v, 0.3), u: hit.u, v: hit.v };
  }

  showSelection(peg: Peg | null) {
    if (!this.device) return;
    if (!peg) { this.device!.selected.visible = false; return; }
    this.device!.selected.visible = true; this.device!.selected.position.set(peg.u, -peg.v, 0.62);
  }

  /** 테스트·검증용: 로컬 좌표가 화면 어디에 그려지는지(Three 투영). */
  projectLocal(u: number, v: number): { x: number; y: number } {
    const p = localToWorld(this.sim!.frame, u, v, ITEM_DEPTH), rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector3(p.x, p.y, p.z).project(this.camera);
    return { x: rect.left + (ndc.x + 1) / 2 * rect.width, y: rect.top + (1 - ndc.y) / 2 * rect.height };
  }
  /** 테스트·검증용: 보드 그룹(Three Transform)으로 계산한 페그 월드 위치와 코어 변환의 차이. */
  placementError(): number {
    const sim = this.sim!;
    this.device!.boardGroup.updateMatrixWorld(true);
    let max = 0;
    for (const p of sim.layout.pegs) {
      const a = new THREE.Vector3(p.u, -p.v, 0.2).applyMatrix4(this.device!.boardGroup.matrixWorld), b = localToWorld(sim.frame, p.u, p.v, 0.2);
      max = Math.max(max, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
    }
    return max;
  }

  // ---------- 프레임 갱신 ----------
  update(dt: number, frozen: boolean) {
    const sim = this.sim;
    if (!sim) return;
    this.navigation.update(dt);
    const core = sim.core, s = sim.scenario;
    if (!frozen) {
      this.updateItems(sim);
      this.updateTokens(sim);
      this.device!.pusherMesh.position.z = sim.pusherFace - s.tray.pusherDepth / 2;
      for (const e of core.drainPresentationEvents()) {
        if (e.type === 'press') this.pressTimer = 0.28;
        else if (e.type === 'main') this.spawnGlint();
        else if (e.type === 'bonus') this.collectTimer = 0.4;
      }
      for (const x of sim.exitVisuals.splice(0)) this.spawnFalling(x);
    }
    this.updateFlow(sim, frozen ? 0 : Math.max(0, core.time - this.lastFlowTime));
    this.lastFlowTime = core.time;
    const a = core.account();
    this.device!.live.raw.set(`대기 ${a.rawQueue}`);
    this.device!.live.buffer.set(`압축 ${core.compressionCount} / 대기 ${a.compressorBuffer + a.chuteValue}`);
    this.device!.live.feed.set(`배출 대기 ${a.feedCount} / 동시 낙하 ${sim.batchStats.largestDump}`);
    this.device!.live.bonus.set(`+${core.ledger.bonusProduced + core.ledger.bonusSeed}`);
    this.device!.live.main.set(`+${core.ledger.main}`);
    this.renderer.render(this.scene, this.camera);
  }

  private updateItems(sim: Simulation) {
    const snap = sim.plinkoSnap, f = sim.frame, n = Math.min(snap.count, this.device!.items.instanceMatrix.count), axis = new THREE.Vector3(f.normal.x, f.normal.y, f.normal.z);
    const cap = sim.scenario.economy.processCap, spin = new THREE.Quaternion();
    for (let k = 0; k < n; k++) {
      const p = localToWorld(f, snap.a[k], snap.b[k], ITEM_DEPTH);
      spin.setFromAxisAngle(axis, -snap.c[k]);
      this.q.copy(spin).multiply(this.device!.boardQuat);
      this.m4.compose(this.v.set(p.x, p.y, p.z), this.q, this.s.setScalar(f.scale));
      this.device!.items.setMatrixAt(k, this.m4);
      const item = sim.core.items.get(snap.ids[k]);
      this.color.copy(this.ore).lerp(this.done, Math.min(1, (item?.processPoints ?? 0) / Math.max(1, cap * 0.4)));
      this.device!.items.setColorAt(k, this.color);
    }
    this.device!.items.count = n;
    this.device!.items.instanceMatrix.needsUpdate = true;
    if (this.device!.items.instanceColor) this.device!.items.instanceColor.needsUpdate = true;
    // 호퍼 대기열 표시(표시 수 제한, 실제 수량은 라벨)
    const shown = Math.min(sim.core.rawQueue, 30), W = sim.scenario.board.width;
    for (let k = 0; k < shown; k++) {
      this.m4.makeTranslation(W / 2 + ((k % 6) - 2.5) * Math.min(0.5, sim.scenario.board.hopperSpread / 2.5), 2.35 + Math.floor(k / 6) * 0.43, 0.35);
      this.device!.rocks.setMatrixAt(k, this.m4); this.device!.rocks.setColorAt(k, this.ore);
    }
    this.device!.rocks.count = shown; this.device!.rocks.instanceMatrix.needsUpdate = true;
    if (this.device!.rocks.instanceColor) this.device!.rocks.instanceColor.needsUpdate = true;
  }

  private tokenColor(units: number, seed: boolean) { return seed ? this.tokenColors.seed : units >= 3 ? this.tokenColors[3] : units === 2 ? this.tokenColors[2] : this.tokenColors[1]; }

  private updateTokens(sim: Simulation) {
    const snap = sim.pusherSnap, n = Math.min(snap.count, this.device!.tokens.instanceMatrix.count);
    for (let k = 0; k < n; k++) {
      this.q.set(snap.quat[k * 4], snap.quat[k * 4 + 1], snap.quat[k * 4 + 2], snap.quat[k * 4 + 3]);
      this.m4.compose(this.v.set(snap.a[k], snap.c[k], snap.b[k]), this.q, this.s.setScalar(1));
      this.device!.tokens.setMatrixAt(k, this.m4);
      const rec = sim.core.tray.get(snap.ids[k]);
      this.device!.tokens.setColorAt(k, this.tokenColor(rec?.units ?? 1, rec?.origin === 'seed'));
    }
    this.device!.tokens.count = n;
    this.device!.tokens.instanceMatrix.needsUpdate = true;
    if (this.device!.tokens.instanceColor) this.device!.tokens.instanceColor.needsUpdate = true;
  }

  private spawnFalling(x: ExitVisual) {
    const slot = this.falling.find(f => !f.active);
    if (!slot) return;
    // Preserve the last physical position, velocity and orientation: no reset above the reward rim.
    Object.assign(slot, { active: true, x: x.x, y: x.y, z: x.z, vx: x.vx ?? 0, vy: x.vy ?? 0, vz: x.vz ?? 0.4, spin: 0, t: 0 });
    if (x.rotation) slot.rotation.fromArray(x.rotation); else slot.rotation.identity();
    slot.color.copy(this.tokenColor(Math.round(x.value / Math.max(1, this.sim!.scenario.economy.tokenValue)), x.origin === 'seed'));
  }
  private spawnGlint() { const g = this.glintPool.find(p => !p.active); if (g) { g.active = true; g.t = 0; } }

  private updateFlow(sim: Simulation, dt: number) {
    const core = sim.core, time = core.time, t = sim.scenario.tray;
    // 낙하 연출
    let n = 0;
    for (const f of this.falling) {
      if (!f.active) continue;
      f.t += dt; f.vy -= sim.scenario.pusher.gravity * dt; f.y += f.vy * dt; f.x += f.vx * dt; f.z += f.vz * dt;
      const side = t.width / 2 + 1.2 - t.tokenRadius, front = t.depth + 3.4 - t.tokenRadius;
      if (Math.abs(f.x) > side) { f.x = Math.sign(f.x) * side; f.vx *= -0.15; }
      if (f.z > front) { f.z = front; f.vz *= -0.15; }
      if (f.y < -2.75) { f.active = false; continue; }
      this.q.copy(f.rotation);
      this.m4.compose(this.v.set(f.x, f.y, f.z), this.q, this.s.setScalar(1));
      this.device!.fall.setMatrixAt(n, this.m4); this.device!.fall.setColorAt(n, f.color); n++;
    }
    this.device!.fall.count = n; this.device!.fall.instanceMatrix.needsUpdate = true; if (this.device!.fall.instanceColor) this.device!.fall.instanceColor.needsUpdate = true;
    // Every byproduct value unit is a visible piece; the same unit becomes one coin.
    n = 0;
    core.chute.forEach(p => {
      const elapsed = time - p.leftAt, duration = p.arriveAt - p.leftAt;
      for (let i = 0; i < p.value && n < this.device!.chunks.instanceMatrix.count; i++) {
        const delay = duration * (PROCESS_FRACTION + 0.12 * i / Math.max(1, p.value));
        if (elapsed < delay) continue;
        const u = Math.min(1, Math.max(0, (elapsed - delay) / Math.max(1e-6, duration - delay)));
        const o = cargoOffset(sim.device, i % sim.device.cargoColumns);
        const pt = byproductPoint(sim.scenario.board, sim.frame, sim.device, u * u, o.x, (i % 2 ? 0.12 : -0.12));
        this.q.setFromEuler(new THREE.Euler(time * 3 + i, time * 2, i));
        this.m4.compose(this.v.copy(pt), this.q, this.s.setScalar(1));
        this.device!.chunks.setMatrixAt(n++, this.m4);
      }
    });
    this.device!.chunks.count = n; this.device!.chunks.instanceMatrix.needsUpdate = true;
    const dev = sim.device;
    sim.layout.pegs.forEach((p, i) => {
      const age = time - (sim.pegFlashes.get(i) ?? -100), hit = Math.max(0, 1 - age / 0.22);
      this.color.setHex(p.kind === 'refiner' ? 0x8dbc40 : p.kind === 'splitter' ? 0xf4ba3c : 0xb59c68).multiplyScalar((p.kind === 'basic' ? 0.18 : 0.75) + hit * 2.5);
      this.device!.pegRings.setColorAt(i, this.color);
    });
    if (this.device!.pegRings.instanceColor) this.device!.pegRings.instanceColor.needsUpdate = true;
    // 본 재화 반짝임
    n = 0;
    for (const g of this.glintPool) {
      if (!g.active) continue;
      g.t += dt / sim.scenario.flow.chuteSeconds;
      if (g.t >= 1) { g.active = false; this.mainCollected++; continue; }
      if (g.t < PROCESS_FRACTION) continue;
      this.m4.compose(this.v.copy(this.device!.mainCurve.getPointAt((g.t - PROCESS_FRACTION) / (1 - PROCESS_FRACTION))), this.q.identity(), this.s.setScalar(1));
      this.device!.glints.setMatrixAt(n++, this.m4);
    }
    this.device!.glints.count = n; this.device!.glints.instanceMatrix.needsUpdate = true;
    // 압축기·수거함 연출
    this.pressTimer = Math.max(0, this.pressTimer - dt); this.collectTimer = Math.max(0, this.collectTimer - dt);
    const phase = core.pressPhase, flow = sim.scenario.flow, intake = dev.pressIn, die = dev.die;
    const load = Math.min(1, core.pressTime / flow.pressLoadSec);
    const stamp = Math.min(1, core.pressTime / flow.compressCycleSec);
    const retract = Math.min(1, core.pressTime / flow.pressRetractSec);
    const press = phase === 'pressing' ? Math.max(0, (stamp - 0.3) / 0.7) : phase === 'retracting' ? 1 - Math.min(1, retract / 0.65) : 0;
    const forward = phase === 'pressing' ? Math.min(1, stamp / 0.3) : phase === 'retracting' ? 1 - Math.max(0, (retract - 0.65) / 0.35) : 0;
    const count = core.compressionCount;
    this.device!.pressCharge.count = phase === 'loading' || phase === 'pressing' ? count : 0;
    for (let i = 0; i < count; i++) {
      const o = cargoOffset(dev, i), descent = phase === 'loading' ? load * load : 1;
      this.v.set(die.x + o.x, intake.y + (die.y - intake.y) * descent + o.y * (1.5 - press * 0.5), die.z);
      this.m4.compose(this.v, this.q.identity(), this.s.set(1, 1 - press * 0.55, 1));
      this.device!.pressCharge.setMatrixAt(i, this.m4);
    }
    const blanks = Math.min(core.feedQueue.length, dev.cargoColumns * dev.cargoRows);
    this.device!.pressBlank.count = blanks;
    for (let i = 0; i < blanks; i++) {
      this.m4.compose(this.v.copy(sim.diePosition(i)), this.q.identity(), this.s.setScalar(1));
      this.device!.pressBlank.setMatrixAt(i, this.m4);
      this.device!.pressBlank.setColorAt(i, this.tokenColor(1, core.feedQueue.at(i)?.origin === 'seed'));
    }
    const pending = Math.min(24, Math.max(0, core.compressorBuffer - count));
    this.device!.bufferChunks.count = pending;
    for (let i = 0; i < pending; i++) {
      const o = cargoOffset(dev, i);
      this.m4.compose(this.v.set(intake.x + o.x, intake.y + o.y, intake.z), this.q.identity(), this.s.setScalar(1));
      this.device!.bufferChunks.setMatrixAt(i, this.m4);
    }
    this.device!.pressCharge.instanceMatrix.needsUpdate = this.device!.pressBlank.instanceMatrix.needsUpdate = this.device!.bufferChunks.instanceMatrix.needsUpdate = true;
    if (this.device!.pressBlank.instanceColor) this.device!.pressBlank.instanceColor.needsUpdate = true;
    this.device!.mainStock.visible = this.mainCollected > 0;
    const rows = Math.max(1, Math.ceil((count || blanks) / dev.cargoColumns));
    const raised = dev.pressTop - 0.5, pressed = die.y + (rows - 1) * dev.layerPitch + t.tokenHalfHeight + 0.25;
    this.device!.piston.position.y = raised + (pressed - raised) * press;
    this.device!.piston.position.z = dev.ramParkZ + (die.z - dev.ramParkZ) * forward;
    this.device!.inletGate.position.z = intake.z + (phase === 'loading' ? 1.4 : 0);
    const release = phase === 'releasing' ? Math.min(1, (1 - core.pressTime / flow.pressOpenSec) * 4) : sim.discharge.progress;
    this.device!.outletGate.position.z = die.z + 1.6 * release;
    this.device!.outletGate.position.y = sim.dischargeY - t.tokenHalfHeight - 0.06;
    this.device!.processorRotor.rotation.x = core.stats.completed > 0 ? time * 3 : 0;
    this.device!.collectorGlow.scale.x = 0.85 + Math.min(0.15, this.collectTimer);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.resizeObserver.disconnect();
    this.clear();
    this.lifetimeResources.dispose();
    this.scene.environment = null;
    this.sun.shadow.dispose();
    for (const m of Object.values(this.mats)) { m.map?.dispose(); m.dispose(); }
    this.navigation.dispose(); this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
