import * as THREE from 'three';
import { localToWorld } from '../core/frame';
import type { Simulation } from '../lab/simulation';
import { trayGeometry } from '../physics/tray-geometry';
import { LiveLabel, makeLabel } from './labels';
import type { DeviceMaterials } from './materials';
import { ResourceScope } from './resources';

/** 한 실험의 정적 장치와 표시용 메시. 생성 설정과 GPU 자원의 수명을 함께 관리한다. */
export class DeviceScene {
  readonly root = new THREE.Group();
  readonly boardGroup = new THREE.Group();
  private readonly trayGroup = new THREE.Group();
  private readonly chuteGroup = new THREE.Group();
  private readonly resources = new ResourceScope();
  private readonly placementResources = new ResourceScope();
  private sim: Simulation | null = null;
  items!: THREE.InstancedMesh; pegs!: THREE.InstancedMesh; tokens!: THREE.InstancedMesh;
  belt!: THREE.InstancedMesh; feed!: THREE.InstancedMesh; fall!: THREE.InstancedMesh;
  chunks!: THREE.InstancedMesh; rocks!: THREE.InstancedMesh; glints!: THREE.InstancedMesh;
  pusherMesh!: THREE.Mesh; piston!: THREE.Mesh; pressGlow!: THREE.Mesh; collectorGlow!: THREE.Mesh;
  selected!: THREE.Mesh;
  mainCurve!: THREE.CatmullRomCurve3; byCurve!: THREE.CatmullRomCurve3; beltPath!: THREE.CurvePath<THREE.Vector3>;
  readonly feedPoint = new THREE.Vector3();
  readonly boardQuat = new THREE.Quaternion();
  live!: { raw: LiveLabel; buffer: LiveLabel; feed: LiveLabel; bonus: LiveLabel; main: LiveLabel };
  size = 1;
  private readonly m4 = new THREE.Matrix4();
  private readonly color = new THREE.Color();

  constructor(private readonly mats: DeviceMaterials) {}

  private own<T extends { dispose(): void }>(x: T): T { return this.resources.own(x); }
  private box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0, parent: THREE.Object3D = this.root, shadow = true) {
    const mesh = new THREE.Mesh(this.own(new THREE.BoxGeometry(w, h, d)), mat);
    mesh.position.set(x, y, z); mesh.castShadow = shadow; mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  build(sim: Simulation) {
    this.clear();
    this.sim = sim;
    const s = sim.scenario, b = s.board, t = s.tray, dev = sim.device, g = trayGeometry(t);
    this.size = Math.max(1, t.width / 14, b.height / 16);
    this.root.add(this.boardGroup, this.trayGroup, this.chuteGroup);
    // 바닥과 안전선
    const floor = new THREE.Mesh(this.own(new THREE.PlaneGeometry(400, 400)), this.mats.floor);
    floor.rotation.x = -Math.PI / 2; floor.position.y = dev.floorY; floor.receiveShadow = true; this.root.add(floor);
    const fw = t.width + 14, fd = t.depth - g.zBack + b.height * 0.5 + 16, fz = dev.trayZ0 + (t.depth + g.zBack) / 2 - b.height * 0.2;
    for (const [w, d, x, z] of [[fw, 0.25, 0, fz - fd / 2], [fw, 0.25, 0, fz + fd / 2], [0.25, fd, -fw / 2, fz], [0.25, fd, fw / 2, fz]] as const) this.box(w, 0.02, d, this.mats.yellow, x, dev.floorY + 0.01, z, this.root, false);

    this.buildBoard(sim);
    this.buildTray(sim);
    this.buildStations(sim);
    this.buildLabels(sim);
    this.updatePlacement();
  }

  private buildBoard(sim: Simulation) {
    const b = sim.scenario.board, G = this.boardGroup, W = b.width, H = b.height;
    this.box(W + 0.8, H + 0.8, 0.3, this.mats.dark, W / 2, -H / 2, -0.16, G);
    for (const x of [-0.55, W + 0.55]) {
      this.box(0.5, H + 4.6, 0.9, this.mats.metal, x, -H / 2 - 0.6, 0.15, G);
      this.box(0.12, H + 0.4, 0.12, this.mats.orangeGlow, x + (x < 0 ? 0.31 : -0.31), -H / 2, 0.55, G, false);
    }
    this.box(W + 1.6, 0.5, 0.9, this.mats.metal, W / 2, 0.55, 0.15, G);
    // 호퍼(V자 깔때기)
    const hopper = new THREE.Group(); hopper.position.set(W / 2, 1.9, 0.35); G.add(hopper);
    for (const side of [-1, 1]) { const wing = this.box(3.0, 0.22, 0.9, this.mats.metalLight, side * 1.25, 0.15, 0, hopper); wing.rotation.z = side * 0.55; }
    this.box(0.9, 0.3, 0.9, this.mats.yellow, -2.6, 0.95, 0, hopper); this.box(0.9, 0.3, 0.9, this.mats.yellow, 2.6, 0.95, 0, hopper);
    this.rocks = this.own(new THREE.InstancedMesh(this.own(new THREE.IcosahedronGeometry(b.itemRadius * 1.05, 0)), this.mats.item, 30));
    this.rocks.count = 0; G.add(this.rocks);
    // 페그
    const pegGeo = this.own(new THREE.CylinderGeometry(b.pegRadius, b.pegRadius, 0.6, 10)); pegGeo.rotateX(Math.PI / 2); pegGeo.translate(0, 0, 0.3);
    this.pegs = this.own(new THREE.InstancedMesh(pegGeo, this.mats.peg, sim.layout.pegs.length));
    sim.layout.pegs.forEach((p, i) => { this.m4.makeTranslation(p.u, -p.v, 0); this.pegs.setMatrixAt(i, this.m4); });
    this.refreshPegColors();
    this.pegs.castShadow = true; G.add(this.pegs);
    const ring = this.own(new THREE.TorusGeometry(b.pegRadius + 0.14, 0.05, 6, 20));
    this.selected = new THREE.Mesh(ring, this.mats.selected); this.selected.visible = false; G.add(this.selected);
    // 하단 처리기와 두 출구
    const py = -(H + 1.05);
    this.box(W * 0.62, 1.7, 1.9, this.mats.metal, W / 2, py, 0.35, G);
    this.box(W * 0.4, 0.18, 0.5, this.mats.orangeGlow, W / 2, py + 0.88, 0.9, G, false);
    this.box(W * 0.62 + 0.1, 0.12, 0.1, this.mats.yellow, W / 2, py - 0.86, 1.31, G, false);
    this.box(1.1, 1.0, 1.4, this.mats.greenGlow, W / 2 - W * 0.31 - 0.5, py - 0.2, 0.35, G);
    this.box(1.1, 1.0, 1.4, this.mats.orangeGlow, W / 2 + W * 0.31 + 0.5, py - 0.2, 0.35, G);
    // 보드 위 원석(월드 공간 인스턴스)
    this.items = this.own(new THREE.InstancedMesh(this.own(new THREE.IcosahedronGeometry(b.itemRadius, 0)), this.mats.item, Math.max(16, sim.scenario.flow.plinkoMaxActive + 8)));
    this.items.count = 0; this.items.castShadow = true; this.items.frustumCulled = false;
    this.root.add(this.items);
  }

  refreshPegColors() {
    if (!this.sim) return;
    const kindColor = { basic: new THREE.Color(0xb7c0c6), refiner: new THREE.Color(0x58d38f), splitter: new THREE.Color(0xff9a3d) };
    this.sim.layout.pegs.forEach((p, i) => {
      this.color.copy(kindColor[p.kind]).multiplyScalar(0.7 + 0.12 * p.level);
      this.pegs.setColorAt(i, this.color);
    });
    if (this.pegs.instanceColor) this.pegs.instanceColor.needsUpdate = true;
  }

  private buildTray(sim: Simulation) {
    const t = sim.scenario.tray, dev = sim.device, g = trayGeometry(t), T = this.trayGroup;
    T.position.set(0, dev.trayTopY, dev.trayZ0);
    const len = t.depth - g.zBack, midZ = (t.depth + g.zBack) / 2;
    const floor = this.box(t.width, 0.4, len, this.mats.metalLight, 0, -0.2, midZ, T); floor.castShadow = false;
    this.box(t.width + 1.4, 2.7, len + 0.4, this.mats.dark, 0, -1.75, midZ - 0.2, T);
    this.box(t.width, 0.04, 0.16, this.mats.amberEdge, 0, 0.02, t.depth - 0.08, T, false);
    for (const side of [-1, 1]) {
      const wh = g.wallHeight;
      const glass = this.box(0.08, wh, len, this.mats.glass, side * (t.width / 2 + 0.06), wh / 2, midZ, T, false); glass.renderOrder = 5;
      this.box(0.35, wh + 0.3, 0.35, this.mats.yellow, side * (t.width / 2 + 0.2), wh / 2 - 0.05, t.depth - 0.2, T);
      this.box(0.35, wh + 0.3, 0.35, this.mats.yellow, side * (t.width / 2 + 0.2), wh / 2 - 0.05, g.zBack + 0.2, T);
      this.box(0.25, 0.2, len, this.mats.metal, side * (t.width / 2 + 0.2), wh + 0.02, midZ, T);
    }
    this.pusherMesh = this.box(t.width - 0.04, g.plateHeight, t.pusherDepth, this.mats.metal, 0, g.plateHeight / 2, t.faceMin - t.pusherDepth / 2, T);
    this.box(t.width - 0.1, 0.16, 0.06, this.mats.yellow, 0, g.plateHeight * 0.55, t.pusherDepth / 2 + 0.01, this.pusherMesh, false);
    if (sim.pusher.mode === 'stacked') {
      const lipDepth = g.lip.zFront - g.zBack;
      this.box(t.width, g.lip.height, lipDepth, this.mats.dark, 0, g.lip.yBottom + g.lip.height / 2, g.zBack + lipDepth / 2, T);
    }
    const tokenGeo = this.own(new THREE.CylinderGeometry(t.tokenRadius, t.tokenRadius, t.tokenHalfHeight * 2, sim.scenario.quality === 'low' ? 10 : 16));
    this.tokens = this.own(new THREE.InstancedMesh(tokenGeo, this.mats.token, sim.scenario.flow.trayMaxTokens + 64));
    this.tokens.count = 0; this.tokens.receiveShadow = true; this.tokens.frustumCulled = false; T.add(this.tokens);
    this.fall = this.own(new THREE.InstancedMesh(tokenGeo, this.mats.token, 96)); this.fall.count = 0; this.fall.frustumCulled = false; T.add(this.fall);
    // 보너스 수거함
    const cz = t.depth + 1.15;
    this.box(t.width + 0.6, 0.2, 2.2, this.mats.dark, 0, -2.7, cz, T);
    this.collectorGlow = this.box(t.width - 0.4, 0.05, 1.8, this.mats.orangeGlow, 0, -2.58, cz, T, false);
    this.box(t.width + 0.6, 1.1, 0.2, this.mats.metal, 0, -2.15, cz + 1.1, T);
    this.box(t.width + 0.6, 0.12, 0.08, this.mats.yellow, 0, -1.55, cz + 1.18, T, false);
    for (const side of [-1, 1]) this.box(0.2, 1.1, 2.2, this.mats.metal, side * (t.width / 2 + 0.3), -2.15, cz, T);
  }

  private buildStations(sim: Simulation) {
    const s = sim.scenario, t = s.tray, dev = sim.device, cp = dev.compressor;
    // 가공 재화 수거함
    const mb = dev.mainBin;
    this.box(3.2, 2.2, 3.2, this.mats.dark, mb.x, mb.y - 1.0, mb.z);
    this.box(2.8, 0.1, 2.8, this.mats.greenGlow, mb.x, mb.y + 0.12, mb.z, this.root, false);
    // 압축기
    this.box(3.2, 0.7, 2.6, this.mats.dark, cp.x, cp.y - 1.6, cp.z);
    for (const dx of [-1.25, 1.25]) this.box(0.45, 3.6, 0.45, this.mats.metal, cp.x + dx, cp.y + 0.1, cp.z);
    this.box(3.2, 0.6, 1.4, this.mats.metal, cp.x, cp.y + 2.0, cp.z);
    this.box(3.3, 0.14, 0.12, this.mats.yellow, cp.x, cp.y + 2.0, cp.z + 0.72, this.root, false);
    this.piston = this.box(1.6, 0.9, 1.4, this.mats.metalLight, cp.x, cp.y + 1.0, cp.z);
    this.pressGlow = this.box(1.8, 0.08, 1.6, this.mats.orangeGlow, cp.x, cp.y - 1.2, cp.z, this.root, false);
    // 컨베이어: 압축기 출구 → 트레이 측면 → 공급 레일
    const railZ = dev.trayZ0 + t.faceMin + t.stroke * 0.5;
    const a = new THREE.Vector3(cp.x - 1.7, cp.y - 1.15, cp.z), bpt = new THREE.Vector3(t.width / 2 + 1.25, dev.railY, cp.z), c = new THREE.Vector3(t.width / 2 + 1.25, dev.railY, railZ);
    this.beltPath = new THREE.CurvePath<THREE.Vector3>();
    this.beltPath.add(new THREE.LineCurve3(a, bpt)); this.beltPath.add(new THREE.LineCurve3(bpt, c));
    this.feedPoint.copy(c);
    for (const [p, q] of [[a, bpt], [bpt, c]] as const) {
      const len = p.distanceTo(q), mid = p.clone().add(q).multiplyScalar(0.5);
      const belt = this.box(0.9, 0.16, len + 0.9, this.mats.darker, mid.x, mid.y - 0.12, mid.z);
      belt.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), q.clone().sub(p).normalize());
      for (const side of [-0.5, 0.5]) { const rail = this.box(0.08, 0.22, len + 0.9, this.mats.yellow, 0, 0.1, 0, belt, false); rail.position.x = side; }
    }
    this.box(t.width + 1.6, 0.18, 0.5, this.mats.metal, 0.2, dev.railY + 0.5, railZ);
    this.box(t.width + 1.6, 0.06, 0.06, this.mats.orangeGlow, 0.2, dev.railY + 0.4, railZ + 0.26, this.root, false);
    const cap = s.flow.conveyorCapacity + 4;
    const smallToken = this.own(new THREE.CylinderGeometry(t.tokenRadius, t.tokenRadius, t.tokenHalfHeight * 2, 12));
    this.belt = this.own(new THREE.InstancedMesh(smallToken, this.mats.token, cap)); this.belt.count = 0; this.belt.frustumCulled = false; this.root.add(this.belt);
    this.feed = this.own(new THREE.InstancedMesh(smallToken, this.mats.token, 12)); this.feed.count = 0; this.feed.frustumCulled = false; this.root.add(this.feed);
    this.chunks = this.own(new THREE.InstancedMesh(this.own(new THREE.TetrahedronGeometry(0.28, 0)), this.mats.chunk, 48)); this.chunks.count = 0; this.chunks.frustumCulled = false; this.root.add(this.chunks);
    this.glints = this.own(new THREE.InstancedMesh(this.own(new THREE.OctahedronGeometry(0.26, 0)), this.mats.glint, 32)); this.glints.count = 0; this.glints.frustumCulled = false; this.root.add(this.glints);
  }

  private buildLabels(sim: Simulation) {
    const b = sim.scenario.board, t = sim.scenario.tray, dev = sim.device, W = b.width, H = b.height, k = this.size;
    const add = (sprite: THREE.Sprite, parent: THREE.Object3D, x: number, y: number, z: number) => { sprite.position.set(x, y, z); sprite.scale.multiplyScalar(k); parent.add(sprite); this.ownSprite(sprite); return sprite; };
    add(makeLabel('1 원재료 투입', '호퍼 → 대기열', '#f0a050'), this.boardGroup, -3.6, 1.8, 0.8);
    add(makeLabel('2 플링코 가공', '페그 접촉 → 가공 점수', '#f0a050'), this.boardGroup, W + 3.9, -H * 0.3, 0.8);
    add(makeLabel('3 하단 처리기', '도착 즉시 본 재화 지급', '#f0a050'), this.boardGroup, W / 2, -(H + 2.75), 1.2);
    add(makeLabel('4 가공 재화 출구', '본 재화', '#39d27a'), this.root, dev.mainBin.x, dev.mainBin.y + 2.1, dev.mainBin.z);
    add(makeLabel('5 부산물 출구', '→ 압축기', '#ff8a2a'), this.chuteGroup, 0, 0, 0).name = 'byLabel';
    add(makeLabel('6 압축기', '부산물 → 토큰', '#ff8a2a'), this.root, dev.compressor.x, dev.compressor.y + 3.4, dev.compressor.z);
    add(makeLabel('7 토큰 공급', '컨베이어 → 트레이 뒤쪽', '#f0a050'), this.root, this.feedPoint.x + 2.6, this.feedPoint.y + 1.4, this.feedPoint.z);
    add(makeLabel('8 푸셔', '전진·후퇴 왕복', '#e8b22a'), this.trayGroup, -t.width / 2 - 2.6, 1.3, t.faceMin);
    add(makeLabel('9 보상 가장자리', '넘어 낙하 시 보너스', '#e8b22a'), this.trayGroup, t.width / 2 + 3.0, 0.7, t.depth - 0.4);
    add(makeLabel('10 보너스 수거함', '회수 보너스', '#ff8a2a'), this.trayGroup, -t.width / 2 - 2.6, -2.0, t.depth + 1.2);
    this.live = { raw: new LiveLabel('#f4c27a'), buffer: new LiveLabel('#ff9a4a'), feed: new LiveLabel('#f4c27a'), bonus: new LiveLabel('#ffb24a'), main: new LiveLabel('#5be39a') };
    const liveAt = (l: LiveLabel, parent: THREE.Object3D, x: number, y: number, z: number) => { l.sprite.position.set(x, y, z); l.sprite.scale.multiplyScalar(k); parent.add(l.sprite); this.ownSprite(l.sprite); };
    liveAt(this.live.raw, this.boardGroup, W / 2, 3.6, 0.8);
    liveAt(this.live.buffer, this.root, dev.compressor.x, dev.compressor.y - 2.6, dev.compressor.z + 1.8);
    liveAt(this.live.feed, this.root, this.feedPoint.x + 1.6, this.feedPoint.y + 0.4, this.feedPoint.z + 1.2);
    liveAt(this.live.bonus, this.trayGroup, t.width / 2 + 2.6, -2.0, t.depth + 1.2);
    liveAt(this.live.main, this.root, dev.mainBin.x, dev.mainBin.y + 0.9, dev.mainBin.z + 2.0);
  }

  private ownSprite(sprite: THREE.Sprite) {
    const mat = sprite.material as THREE.SpriteMaterial;
    this.own(mat); if (mat.map) this.own(mat.map);
  }

  /** 보드 Transform 변경(배치 프리셋) 반영. 슈트 경로도 새 처리기 위치로 다시 만든다. */
  updatePlacement() {
    const sim = this.sim;
    if (!sim) return;
    const w = sim.boardWorld;
    this.boardQuat.set(w.rotation.x, w.rotation.y, w.rotation.z, w.rotation.w);
    this.boardGroup.position.set(w.position.x, w.position.y, w.position.z);
    this.boardGroup.quaternion.copy(this.boardQuat);
    this.boardGroup.scale.set(w.scale.x, w.scale.y, w.scale.z);
    const b = sim.scenario.board, f = sim.frame, dev = sim.device, py = b.height + 1.25;
    const toV = (p: { x: number; y: number; z: number }) => new THREE.Vector3(p.x, p.y, p.z);
    const mainStart = toV(localToWorld(f, b.width / 2 - b.width * 0.31 - 0.5, py, 0.35));
    const byStart = toV(localToWorld(f, b.width / 2 + b.width * 0.31 + 0.5, py, 0.35));
    const mainEnd = new THREE.Vector3(dev.mainBin.x, dev.mainBin.y + 0.3, dev.mainBin.z);
    const byEnd = new THREE.Vector3(dev.compressor.x, dev.compressor.y + 2.4, dev.compressor.z);
    const mid = (a: THREE.Vector3, c: THREE.Vector3, lift: number) => a.clone().lerp(c, 0.5).add(new THREE.Vector3(0, lift, 0));
    this.mainCurve = new THREE.CatmullRomCurve3([mainStart, mid(mainStart, mainEnd, 0.4), mainEnd]);
    this.byCurve = new THREE.CatmullRomCurve3([byStart, mid(byStart, byEnd, 0.8), byEnd]);
    this.placementResources.dispose();
    for (const child of [...this.chuteGroup.children]) if (child.name !== 'byLabel') this.chuteGroup.remove(child);
    const tube = (curve: THREE.Curve<THREE.Vector3>, mat: THREE.Material) => { const mesh = new THREE.Mesh(this.placementResources.own(new THREE.TubeGeometry(curve, 24, 0.42, 8, false)), mat); mesh.castShadow = true; this.chuteGroup.add(mesh); };
    tube(this.mainCurve, this.mats.greenChute); tube(this.byCurve, this.mats.orangeChute);
    const arrow = (curve: THREE.Curve<THREE.Vector3>, at: number, mat: THREE.Material) => {
      const cone = new THREE.Mesh(this.placementResources.own(new THREE.ConeGeometry(0.42, 0.9, 8)), mat);
      cone.position.copy(curve.getPointAt(at)).add(new THREE.Vector3(0, 0.75, 0));
      cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), curve.getTangentAt(at));
      this.chuteGroup.add(cone);
    };
    arrow(this.mainCurve, 0.55, this.mats.greenGlow); arrow(this.byCurve, 0.5, this.mats.orangeGlow); arrow(this.beltPath, 0.5, this.mats.orangeGlow);
    const byLabel = this.chuteGroup.getObjectByName('byLabel');
    if (byLabel) byLabel.position.copy(this.byCurve.getPointAt(0.5)).add(new THREE.Vector3(0, 2.2, 0));
  }

  clear() {
    this.sim = null;
    this.placementResources.dispose();
    this.resources.dispose();
    for (const group of [this.root, this.boardGroup, this.trayGroup, this.chuteGroup]) group.clear();
  }

  dispose() { this.clear(); this.root.removeFromParent(); }

  setLabels(on: boolean) {
    this.root.traverse(o => { if ((o as THREE.Sprite).isSprite) o.visible = on; });
  }

}
