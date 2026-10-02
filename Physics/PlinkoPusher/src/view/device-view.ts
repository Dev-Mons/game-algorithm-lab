import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { localToWorld, rayToLocal } from '../core/frame';
import { pickPeg, type Peg } from '../core/layout';
import type { Quality } from '../lab/scenario';
import type { Simulation } from '../lab/simulation';
import { DeviceScene } from './device-scene';
import { DeviceCamera, type CameraPreset } from './device-camera';
import { C, createDeviceMaterials, type DeviceMaterials } from './materials';
import { ResourceScope } from './resources';

/**
 * Presentation: 3D 배치·메시·인스턴싱·공정 연출. 물리·경제 상태를 읽기만 하며 엔진 객체를 참조하지 않는다.
 * 원석의 월드 위치는 코어의 localToWorld(BoardFrame)로 계산한다(보드 메시는 같은 Transform을 쓰는 그룹).
 */
export type { CameraPreset } from './device-camera';
const ITEM_DEPTH = 0.3;
interface Falling { active: boolean; x: number; y: number; z: number; vy: number; vz: number; spin: number; t: number; color: THREE.Color }
interface Glint { active: boolean; t: number }

export class DeviceView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 1, 0.1, 600);
  private readonly navigation: DeviceCamera;
  get controls() { return this.navigation.controls; }
  private showLabels = true;
  private readonly sun = new THREE.DirectionalLight(0xfff2e0, 2.2);
  private readonly mats: DeviceMaterials;
  private readonly lifetimeResources = new ResourceScope();
  private readonly resizeObserver: ResizeObserver;
  private disposed = false;
  private sim: Simulation | null = null;
  private device: DeviceScene | null = null;
  private falling: Falling[] = []; private glintPool: Glint[] = [];
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
    this.scene.background = new THREE.Color(0x202427);
    this.scene.fog = new THREE.Fog(0x202427, 90, 260);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.scene.environment = this.lifetimeResources.own(pmrem.fromScene(room, 0.04)).texture;
    room.dispose();
    this.scene.environmentIntensity = 0.55;
    pmrem.dispose();
    this.scene.add(new THREE.HemisphereLight(0xdfe8ee, 0x2a2622, 0.9));
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
    this.falling = Array.from({ length: 96 }, () => ({ active: false, x: 0, y: 0, z: 0, vy: 0, vz: 0, spin: 0, t: 0, color: new THREE.Color() }));
    this.glintPool = Array.from({ length: 32 }, () => ({ active: false, t: 0 }));
  }

  clear() {
    this.sim = null;
    this.navigation.bind(null);
    this.device?.dispose(); this.device = null;
    this.falling = []; this.glintPool = [];
    this.pressTimer = 0; this.collectTimer = 0;
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
    this.updateFlow(sim, frozen ? 0 : dt);
    const a = core.account();
    this.device!.live.raw.set(`대기 ${a.rawQueue}`);
    this.device!.live.buffer.set(`압축 대기 ${a.compressorBuffer + a.chuteValue}`);
    this.device!.live.feed.set(`투입 대기 ${a.feedCount + a.offCount}`);
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
      this.m4.makeTranslation(W / 2 + ((k % 6) - 2.5) * 0.62, 2.0 + Math.floor(k / 6) * 0.5 + (k % 2) * 0.1, 0.35 + ((k * 7) % 3 - 1) * 0.12);
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

  private spawnFalling(x: { x: number; y: number; z: number; value: number; origin: 'produced' | 'seed' }) {
    const slot = this.falling.find(f => !f.active);
    if (!slot) return; // 표시 풀 한도. 보상은 이미 정산되었으므로 연출만 생략된다.
    Object.assign(slot, { active: true, x: x.x, y: Math.max(x.y, 0.08), z: x.z, vy: 0, vz: 1.4, spin: (x.x * 13) % 3, t: 0 });
    slot.color.copy(this.tokenColor(Math.round(x.value / Math.max(1, this.sim!.scenario.economy.tokenValue)), x.origin === 'seed'));
  }
  private spawnGlint() { const g = this.glintPool.find(p => !p.active); if (g) { g.active = true; g.t = 0; } }

  private updateFlow(sim: Simulation, dt: number) {
    const core = sim.core, time = core.time, t = sim.scenario.tray;
    // 낙하 연출
    let n = 0;
    for (const f of this.falling) {
      if (!f.active) continue;
      f.t += dt; f.vy -= 22 * dt; f.y += f.vy * dt; f.z += f.vz * dt; f.vz *= 0.97;
      if (f.y < -2.5) { f.active = false; continue; }
      this.q.setFromEuler(new THREE.Euler(f.t * 6 + f.spin, 0, f.t * 3));
      this.m4.compose(this.v.set(f.x, f.y, Math.min(f.z, t.depth + 2)), this.q, this.s.setScalar(1));
      this.device!.fall.setMatrixAt(n, this.m4); this.device!.fall.setColorAt(n, f.color); n++;
    }
    this.device!.fall.count = n; this.device!.fall.instanceMatrix.needsUpdate = true; if (this.device!.fall.instanceColor) this.device!.fall.instanceColor.needsUpdate = true;
    // 슈트 부산물(표시 수 제한, 가치는 코어에 그대로)
    n = 0;
    core.chute.forEach(p => {
      if (n >= this.device!.chunks.instanceMatrix.count) return;
      const u = Math.min(1, Math.max(0, (time - p.leftAt) / Math.max(1e-6, p.arriveAt - p.leftAt)));
      const pt = this.device!.byCurve.getPointAt(u);
      this.q.setFromEuler(new THREE.Euler(time * 3 + n, time * 2, 0));
      this.m4.compose(this.v.copy(pt).add(new THREE.Vector3(0, 0.2, 0)), this.q, this.s.setScalar(0.7 + Math.min(1.2, p.value / 20)));
      this.device!.chunks.setMatrixAt(n++, this.m4);
    });
    this.device!.chunks.count = n; this.device!.chunks.instanceMatrix.needsUpdate = true;
    // 컨베이어 토큰
    n = 0;
    core.belt.forEach(b => {
      if (n >= this.device!.belt.instanceMatrix.count) return;
      const u = Math.min(1, Math.max(0, (time - b.enterAt) / Math.max(1e-6, b.arriveAt - b.enterAt)));
      this.m4.compose(this.v.copy(this.device!.beltPath.getPointAt(u)).add(new THREE.Vector3(0, 0.05, 0)), this.q.identity(), this.s.setScalar(1));
      this.device!.belt.setMatrixAt(n, this.m4); this.device!.belt.setColorAt(n, this.tokenColor(b.token.units, false)); n++;
    });
    this.device!.belt.count = n; this.device!.belt.instanceMatrix.needsUpdate = true; if (this.device!.belt.instanceColor) this.device!.belt.instanceColor.needsUpdate = true;
    // 투입구 대기(최대 12개 표시, 수량은 라벨)
    const waiting = Math.min(12, core.feedQueue.length + core.offscreenTray.length);
    for (let k = 0; k < waiting; k++) {
      const token = core.feedQueue.at(k) ?? core.offscreenTray.at(k - core.feedQueue.length);
      this.m4.compose(this.v.copy(this.device!.feedPoint).add(new THREE.Vector3(0, 0.1 + k * t.tokenHalfHeight * 2.1, 0)), this.q.identity(), this.s.setScalar(1));
      this.device!.feed.setMatrixAt(k, this.m4); this.device!.feed.setColorAt(k, this.tokenColor(token?.units ?? 1, token?.origin === 'seed'));
    }
    this.device!.feed.count = waiting; this.device!.feed.instanceMatrix.needsUpdate = true; if (this.device!.feed.instanceColor) this.device!.feed.instanceColor.needsUpdate = true;
    // 본 재화 반짝임
    n = 0;
    for (const g of this.glintPool) {
      if (!g.active) continue;
      g.t += dt / 0.8;
      if (g.t >= 1) { g.active = false; continue; }
      this.m4.compose(this.v.copy(this.device!.mainCurve.getPointAt(g.t)).add(new THREE.Vector3(0, 0.25, 0)), this.q.identity(), this.s.setScalar(1));
      this.device!.glints.setMatrixAt(n++, this.m4);
    }
    this.device!.glints.count = n; this.device!.glints.instanceMatrix.needsUpdate = true;
    // 압축기·수거함 연출
    this.pressTimer = Math.max(0, this.pressTimer - dt); this.collectTimer = Math.max(0, this.collectTimer - dt);
    const cp = sim.device.compressor, press = this.pressTimer > 0 ? Math.sin((this.pressTimer / 0.28) * Math.PI) : 0;
    this.device!.piston.position.y = cp.y + 1.0 - press * 1.3;
    (this.device!.pressGlow.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.6;
    this.device!.pressGlow.scale.setScalar(0.6 + press * 0.6);
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
    for (const m of Object.values(this.mats)) m.dispose();
    this.navigation.dispose(); this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
