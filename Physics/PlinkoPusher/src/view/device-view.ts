import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { localToWorld, rayToLocal } from '../core/frame';
import { pickPeg, type Peg } from '../core/layout';
import type { Quality } from '../lab/scenario';
import type { Simulation } from '../lab/simulation';
import { trayGeometry } from '../physics/tray-geometry';
import { LiveLabel, makeLabel } from './labels';

/**
 * Presentation: 3D 배치·메시·인스턴싱·공정 연출. 물리·경제 상태를 읽기만 하며 엔진 객체를 참조하지 않는다.
 * 원석의 월드 위치는 코어의 localToWorld(BoardFrame)로 계산한다(보드 메시는 같은 Transform을 쓰는 그룹).
 */
export type CameraPreset = 'all' | 'plinko' | 'pusher';
const ITEM_DEPTH = 0.3;
const C = {
  metal: 0x6a7176, metalLight: 0x9aa2a8, dark: 0x2b3034, darker: 0x1d2124, yellow: 0xe8b22a, orange: 0xff8a2a, green: 0x39d27a,
  floor: 0x34383b, ore: 0x8a6b4e, processed: 0x52d08a, byproduct: 0xff7a1f, steel: 0xc3cbd1, bundle2: 0xd9b56a, bundle3: 0xf2c24a, seed: 0x8fa8c8,
};

interface Falling { active: boolean; x: number; y: number; z: number; vy: number; vz: number; spin: number; t: number; color: THREE.Color }
interface Glint { active: boolean; t: number }

export class DeviceView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 1, 0.1, 600);
  readonly controls: OrbitControls;
  private showLabels = true;
  private root = new THREE.Group();
  private boardGroup = new THREE.Group();
  private trayGroup = new THREE.Group();
  private sun = new THREE.DirectionalLight(0xfff2e0, 2.2);
  private readonly mats: Record<string, THREE.MeshStandardMaterial>;
  private owned: Array<THREE.BufferGeometry | THREE.Material | THREE.Texture> = [];
  private sim: Simulation | null = null;
  private quality: Quality = 'medium';
  private items!: THREE.InstancedMesh; private pegs!: THREE.InstancedMesh; private tokens!: THREE.InstancedMesh;
  private belt!: THREE.InstancedMesh; private feed!: THREE.InstancedMesh; private fall!: THREE.InstancedMesh;
  private chunks!: THREE.InstancedMesh; private rocks!: THREE.InstancedMesh; private glints!: THREE.InstancedMesh;
  private pusherMesh!: THREE.Mesh; private piston!: THREE.Mesh; private pressGlow!: THREE.Mesh; private collectorGlow!: THREE.Mesh;
  private selected!: THREE.Mesh;
  private mainCurve!: THREE.CatmullRomCurve3; private byCurve!: THREE.CatmullRomCurve3; private beltPath!: THREE.CurvePath<THREE.Vector3>;
  private feedPoint = new THREE.Vector3();
  private chuteGroup = new THREE.Group();
  private falling: Falling[] = []; private glintPool: Glint[] = [];
  private pressTimer = 0; private collectTimer = 0;
  private live!: { raw: LiveLabel; buffer: LiveLabel; feed: LiveLabel; bonus: LiveLabel; main: LiveLabel };
  private tween: { from: [THREE.Vector3, THREE.Vector3]; to: [THREE.Vector3, THREE.Vector3]; t: number } | null = null;
  private readonly m4 = new THREE.Matrix4(); private readonly q = new THREE.Quaternion(); private readonly v = new THREE.Vector3(); private readonly s = new THREE.Vector3(1, 1, 1);
  private readonly color = new THREE.Color(); private readonly ore = new THREE.Color(C.ore); private readonly done = new THREE.Color(C.processed);
  private readonly tokenColors = { 1: new THREE.Color(C.steel), 2: new THREE.Color(C.bundle2), 3: new THREE.Color(C.bundle3), seed: new THREE.Color(C.seed) };
  private boardQuat = new THREE.Quaternion();
  private size = 1;

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color(0x202427);
    this.scene.fog = new THREE.Fog(0x202427, 90, 260);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    pmrem.dispose();
    this.scene.add(new THREE.HemisphereLight(0xdfe8ee, 0x2a2622, 0.9));
    this.sun.position.set(18, 40, 26);
    this.scene.add(this.sun, this.sun.target, this.root);
    const m = (color: number, metalness = 0.55, roughness = 0.45, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, metalness, roughness, ...extra });
    this.mats = {
      metal: m(C.metal), metalLight: m(C.metalLight, 0.6, 0.35), dark: m(C.dark, 0.5, 0.6), darker: m(C.darker, 0.4, 0.7),
      yellow: m(C.yellow, 0.3, 0.5), floor: m(C.floor, 0.1, 0.9),
      orangeGlow: m(0x5a2a08, 0.2, 0.5, { emissive: C.orange, emissiveIntensity: 1.6 }),
      greenGlow: m(0x0f3a20, 0.2, 0.5, { emissive: C.green, emissiveIntensity: 1.3 }),
      amberEdge: m(0x5a3a05, 0.2, 0.4, { emissive: 0xffb020, emissiveIntensity: 1.4 }),
      glass: m(0xa8d0e6, 0.1, 0.1, { transparent: true, opacity: 0.18, depthWrite: false }),
      greenChute: m(0x1d5a35, 0.3, 0.5, { emissive: C.green, emissiveIntensity: 0.25, transparent: true, opacity: 0.85 }),
      orangeChute: m(0x6a3a14, 0.3, 0.5, { emissive: C.orange, emissiveIntensity: 0.25, transparent: true, opacity: 0.85 }),
      peg: m(0xffffff, 0.6, 0.3), item: m(0xffffff, 0.15, 0.75, { flatShading: true }),
      token: m(0xffffff, 0.85, 0.32), chunk: m(C.byproduct, 0.2, 0.6, { emissive: C.byproduct, emissiveIntensity: 0.5, flatShading: true }),
      glint: m(0x1f6b40, 0.1, 0.4, { emissive: C.green, emissiveIntensity: 2 }),
      selected: m(0xffffff, 0, 0.3, { emissive: 0xffffff, emissiveIntensity: 1.2 }),
    };
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = 1.42; this.controls.minPolarAngle = 0.12;
    this.controls.minAzimuthAngle = -1.7; this.controls.maxAzimuthAngle = 1.7;
    this.controls.addEventListener('start', () => { this.tween = null; });
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  private resize() {
    const w = Math.max(1, this.container.clientWidth), h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  setQuality(q: Quality) {
    this.quality = q;
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(q === 'low' ? 1 : q === 'medium' ? Math.min(dpr, 1.5) : Math.min(dpr, 2));
    this.renderer.shadowMap.enabled = q !== 'low';
    this.sun.castShadow = q !== 'low';
    this.sun.shadow.mapSize.set(q === 'high' ? 2048 : 1024, q === 'high' ? 2048 : 1024);
    this.sun.shadow.map?.dispose(); (this.sun.shadow as { map: unknown }).map = null;
    if (this.tokens) this.tokens.castShadow = q === 'high';
    this.resize();
  }

  // ---------- 구성 ----------
  private own<T extends THREE.BufferGeometry | THREE.Material | THREE.Texture>(x: T): T { this.owned.push(x); return x; }
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
    this.setLabels(this.showLabels);
    this.sun.target.position.set(0, 0, 0);
    const cam = this.sun.shadow.camera, r = 30 * this.size;
    cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r; cam.near = 1; cam.far = 140 * this.size; cam.updateProjectionMatrix();
    this.setQuality(s.quality);
    this.falling = Array.from({ length: 96 }, () => ({ active: false, x: 0, y: 0, z: 0, vy: 0, vz: 0, spin: 0, t: 0, color: new THREE.Color() }));
    this.glintPool = Array.from({ length: 32 }, () => ({ active: false, t: 0 }));
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
    this.rocks = new THREE.InstancedMesh(this.own(new THREE.IcosahedronGeometry(b.itemRadius * 1.05, 0)), this.mats.item, 30);
    this.rocks.count = 0; G.add(this.rocks);
    // 페그
    const pegGeo = this.own(new THREE.CylinderGeometry(b.pegRadius, b.pegRadius, 0.6, 10)); pegGeo.rotateX(Math.PI / 2); pegGeo.translate(0, 0, 0.3);
    this.pegs = new THREE.InstancedMesh(pegGeo, this.mats.peg, sim.layout.pegs.length);
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
    this.items = new THREE.InstancedMesh(this.own(new THREE.IcosahedronGeometry(b.itemRadius, 0)), this.mats.item, Math.max(16, sim.scenario.flow.plinkoMaxActive + 8));
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
    const tokenGeo = this.own(new THREE.CylinderGeometry(t.tokenRadius, t.tokenRadius, t.tokenHalfHeight * 2, this.quality === 'low' ? 10 : 16));
    this.tokens = new THREE.InstancedMesh(tokenGeo, this.mats.token, sim.scenario.flow.trayMaxTokens + 64);
    this.tokens.count = 0; this.tokens.receiveShadow = true; this.tokens.frustumCulled = false; T.add(this.tokens);
    this.fall = new THREE.InstancedMesh(tokenGeo, this.mats.token, 96); this.fall.count = 0; this.fall.frustumCulled = false; T.add(this.fall);
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
    this.belt = new THREE.InstancedMesh(smallToken, this.mats.token, cap); this.belt.count = 0; this.belt.frustumCulled = false; this.root.add(this.belt);
    this.feed = new THREE.InstancedMesh(smallToken, this.mats.token, 12); this.feed.count = 0; this.feed.frustumCulled = false; this.root.add(this.feed);
    this.chunks = new THREE.InstancedMesh(this.own(new THREE.TetrahedronGeometry(0.28, 0)), this.mats.chunk, 48); this.chunks.count = 0; this.chunks.frustumCulled = false; this.root.add(this.chunks);
    this.glints = new THREE.InstancedMesh(this.own(new THREE.OctahedronGeometry(0.26, 0)), this.mats.glint, 32); this.glints.count = 0; this.glints.frustumCulled = false; this.root.add(this.glints);
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
    for (const child of [...this.chuteGroup.children]) if (child.name !== 'byLabel') { this.chuteGroup.remove(child); const m = child as THREE.Mesh; m.geometry?.dispose(); }
    const tube = (curve: THREE.Curve<THREE.Vector3>, mat: THREE.Material) => { const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.42, 8, false), mat); mesh.castShadow = true; this.chuteGroup.add(mesh); };
    tube(this.mainCurve, this.mats.greenChute); tube(this.byCurve, this.mats.orangeChute);
    const arrow = (curve: THREE.Curve<THREE.Vector3>, at: number, mat: THREE.Material) => {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.9, 8), mat);
      cone.position.copy(curve.getPointAt(at)).add(new THREE.Vector3(0, 0.75, 0));
      cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), curve.getTangentAt(at));
      this.chuteGroup.add(cone);
    };
    arrow(this.mainCurve, 0.55, this.mats.greenGlow); arrow(this.byCurve, 0.5, this.mats.orangeGlow); arrow(this.beltPath, 0.5, this.mats.orangeGlow);
    const byLabel = this.chuteGroup.getObjectByName('byLabel');
    if (byLabel) byLabel.position.copy(this.byCurve.getPointAt(0.5)).add(new THREE.Vector3(0, 2.2, 0));
  }

  private clear() {
    for (const x of this.owned) x.dispose();
    this.owned = [];
    for (const child of [...this.chuteGroup.children]) (child as THREE.Mesh).geometry?.dispose();
    for (const g of [this.root, this.boardGroup, this.trayGroup, this.chuteGroup]) g.clear();
    this.root.clear();
    this.sun.shadow.map?.dispose();
  }

  setLabels(on: boolean) {
    this.showLabels = on;
    this.root.traverse(o => { if ((o as THREE.Sprite).isSprite) o.visible = on; });
  }

  // ---------- 카메라 ----------
  cameraPose(preset: CameraPreset): [THREE.Vector3, THREE.Vector3] {
    const sim = this.sim!, k = this.size, b = sim.scenario.board, t = sim.scenario.tray;
    if (preset === 'plinko') {
      const f = sim.frame, c = localToWorld(f, b.width / 2, b.height / 2, 0), n = f.normal, dist = b.height * 1.95 * f.scale;
      const target = new THREE.Vector3(c.x, c.y, c.z);
      return [target.clone().add(new THREE.Vector3(n.x, n.y, n.z).multiplyScalar(dist)).add(new THREE.Vector3(0, 1.5, 0)), target.add(new THREE.Vector3(0, 0.8, 0))];
    }
    // 낮은 앞-옆 각도: 더미 높이와 가장자리 무너짐이 보이게
    if (preset === 'pusher') return [new THREE.Vector3(t.width * 0.62, t.depth * 0.42 + 2.2, t.depth * 0.5 + 7.5), new THREE.Vector3(0, 0.4, 0.3)];
    return [new THREE.Vector3(31 * k, 30 * k, 44 * k), new THREE.Vector3(0, 7.5 * k, -3 * k)];
  }

  setCamera(preset: CameraPreset, animate = true) {
    if (!this.sim) return;
    const to = this.cameraPose(preset);
    this.controls.minDistance = 6; this.controls.maxDistance = 130 * this.size;
    if (!animate) { this.camera.position.copy(to[0]); this.controls.target.copy(to[1]); this.controls.update(); this.tween = null; return; }
    this.tween = { from: [this.camera.position.clone(), this.controls.target.clone()], to, t: 0 };
  }

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
    if (!peg) { this.selected.visible = false; return; }
    this.selected.visible = true; this.selected.position.set(peg.u, -peg.v, 0.62);
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
    this.boardGroup.updateMatrixWorld(true);
    let max = 0;
    for (const p of sim.layout.pegs) {
      const a = new THREE.Vector3(p.u, -p.v, 0.2).applyMatrix4(this.boardGroup.matrixWorld), b = localToWorld(sim.frame, p.u, p.v, 0.2);
      max = Math.max(max, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
    }
    return max;
  }

  // ---------- 프레임 갱신 ----------
  update(dt: number, frozen: boolean) {
    const sim = this.sim;
    if (!sim) return;
    if (this.tween) {
      this.tween.t = Math.min(1, this.tween.t + dt / 0.7);
      const e = 1 - Math.pow(1 - this.tween.t, 3);
      this.camera.position.lerpVectors(this.tween.from[0], this.tween.to[0], e);
      this.controls.target.lerpVectors(this.tween.from[1], this.tween.to[1], e);
      if (this.tween.t >= 1) this.tween = null;
    }
    this.controls.update();
    const core = sim.core, s = sim.scenario;
    if (!frozen) {
      this.updateItems(sim);
      this.updateTokens(sim);
      this.pusherMesh.position.z = sim.pusherFace - s.tray.pusherDepth / 2;
      for (const e of core.drainPresentationEvents()) {
        if (e.type === 'press') this.pressTimer = 0.28;
        else if (e.type === 'main') this.spawnGlint();
        else if (e.type === 'bonus') this.collectTimer = 0.4;
      }
      for (const x of sim.exitVisuals.splice(0)) this.spawnFalling(x);
    }
    this.updateFlow(sim, frozen ? 0 : dt);
    const a = core.account();
    this.live.raw.set(`대기 ${a.rawQueue}`);
    this.live.buffer.set(`압축 대기 ${a.compressorBuffer + a.chuteValue}`);
    this.live.feed.set(`투입 대기 ${a.feedCount + a.offCount}`);
    this.live.bonus.set(`+${core.ledger.bonusProduced + core.ledger.bonusSeed}`);
    this.live.main.set(`+${core.ledger.main}`);
    this.renderer.render(this.scene, this.camera);
  }

  private updateItems(sim: Simulation) {
    const snap = sim.plinkoSnap, f = sim.frame, n = Math.min(snap.count, this.items.instanceMatrix.count), axis = new THREE.Vector3(f.normal.x, f.normal.y, f.normal.z);
    const cap = sim.scenario.economy.processCap, spin = new THREE.Quaternion();
    for (let k = 0; k < n; k++) {
      const p = localToWorld(f, snap.a[k], snap.b[k], ITEM_DEPTH);
      spin.setFromAxisAngle(axis, -snap.c[k]);
      this.q.copy(spin).multiply(this.boardQuat);
      this.m4.compose(this.v.set(p.x, p.y, p.z), this.q, this.s.setScalar(f.scale));
      this.items.setMatrixAt(k, this.m4);
      const item = sim.core.items.get(snap.ids[k]);
      this.color.copy(this.ore).lerp(this.done, Math.min(1, (item?.processPoints ?? 0) / Math.max(1, cap * 0.4)));
      this.items.setColorAt(k, this.color);
    }
    this.items.count = n;
    this.items.instanceMatrix.needsUpdate = true;
    if (this.items.instanceColor) this.items.instanceColor.needsUpdate = true;
    // 호퍼 대기열 표시(표시 수 제한, 실제 수량은 라벨)
    const shown = Math.min(sim.core.rawQueue, 30), W = sim.scenario.board.width;
    for (let k = 0; k < shown; k++) {
      this.m4.makeTranslation(W / 2 + ((k % 6) - 2.5) * 0.62, 2.0 + Math.floor(k / 6) * 0.5 + (k % 2) * 0.1, 0.35 + ((k * 7) % 3 - 1) * 0.12);
      this.rocks.setMatrixAt(k, this.m4); this.rocks.setColorAt(k, this.ore);
    }
    this.rocks.count = shown; this.rocks.instanceMatrix.needsUpdate = true;
    if (this.rocks.instanceColor) this.rocks.instanceColor.needsUpdate = true;
  }

  private tokenColor(units: number, seed: boolean) { return seed ? this.tokenColors.seed : units >= 3 ? this.tokenColors[3] : units === 2 ? this.tokenColors[2] : this.tokenColors[1]; }

  private updateTokens(sim: Simulation) {
    const snap = sim.pusherSnap, n = Math.min(snap.count, this.tokens.instanceMatrix.count);
    for (let k = 0; k < n; k++) {
      this.q.set(snap.quat[k * 4], snap.quat[k * 4 + 1], snap.quat[k * 4 + 2], snap.quat[k * 4 + 3]);
      this.m4.compose(this.v.set(snap.a[k], snap.c[k], snap.b[k]), this.q, this.s.setScalar(1));
      this.tokens.setMatrixAt(k, this.m4);
      const rec = sim.core.tray.get(snap.ids[k]);
      this.tokens.setColorAt(k, this.tokenColor(rec?.units ?? 1, rec?.origin === 'seed'));
    }
    this.tokens.count = n;
    this.tokens.instanceMatrix.needsUpdate = true;
    if (this.tokens.instanceColor) this.tokens.instanceColor.needsUpdate = true;
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
      this.fall.setMatrixAt(n, this.m4); this.fall.setColorAt(n, f.color); n++;
    }
    this.fall.count = n; this.fall.instanceMatrix.needsUpdate = true; if (this.fall.instanceColor) this.fall.instanceColor.needsUpdate = true;
    // 슈트 부산물(표시 수 제한, 가치는 코어에 그대로)
    n = 0;
    core.chute.forEach(p => {
      if (n >= this.chunks.instanceMatrix.count) return;
      const u = Math.min(1, Math.max(0, (time - p.leftAt) / Math.max(1e-6, p.arriveAt - p.leftAt)));
      const pt = this.byCurve.getPointAt(u);
      this.q.setFromEuler(new THREE.Euler(time * 3 + n, time * 2, 0));
      this.m4.compose(this.v.copy(pt).add(new THREE.Vector3(0, 0.2, 0)), this.q, this.s.setScalar(0.7 + Math.min(1.2, p.value / 20)));
      this.chunks.setMatrixAt(n++, this.m4);
    });
    this.chunks.count = n; this.chunks.instanceMatrix.needsUpdate = true;
    // 컨베이어 토큰
    n = 0;
    core.belt.forEach(b => {
      if (n >= this.belt.instanceMatrix.count) return;
      const u = Math.min(1, Math.max(0, (time - b.enterAt) / Math.max(1e-6, b.arriveAt - b.enterAt)));
      this.m4.compose(this.v.copy(this.beltPath.getPointAt(u)).add(new THREE.Vector3(0, 0.05, 0)), this.q.identity(), this.s.setScalar(1));
      this.belt.setMatrixAt(n, this.m4); this.belt.setColorAt(n, this.tokenColor(b.token.units, false)); n++;
    });
    this.belt.count = n; this.belt.instanceMatrix.needsUpdate = true; if (this.belt.instanceColor) this.belt.instanceColor.needsUpdate = true;
    // 투입구 대기(최대 12개 표시, 수량은 라벨)
    const waiting = Math.min(12, core.feedQueue.length + core.offscreenTray.length);
    for (let k = 0; k < waiting; k++) {
      const token = core.feedQueue.at(k) ?? core.offscreenTray.at(k - core.feedQueue.length);
      this.m4.compose(this.v.copy(this.feedPoint).add(new THREE.Vector3(0, 0.1 + k * t.tokenHalfHeight * 2.1, 0)), this.q.identity(), this.s.setScalar(1));
      this.feed.setMatrixAt(k, this.m4); this.feed.setColorAt(k, this.tokenColor(token?.units ?? 1, token?.origin === 'seed'));
    }
    this.feed.count = waiting; this.feed.instanceMatrix.needsUpdate = true; if (this.feed.instanceColor) this.feed.instanceColor.needsUpdate = true;
    // 본 재화 반짝임
    n = 0;
    for (const g of this.glintPool) {
      if (!g.active) continue;
      g.t += dt / 0.8;
      if (g.t >= 1) { g.active = false; continue; }
      this.m4.compose(this.v.copy(this.mainCurve.getPointAt(g.t)).add(new THREE.Vector3(0, 0.25, 0)), this.q.identity(), this.s.setScalar(1));
      this.glints.setMatrixAt(n++, this.m4);
    }
    this.glints.count = n; this.glints.instanceMatrix.needsUpdate = true;
    // 압축기·수거함 연출
    this.pressTimer = Math.max(0, this.pressTimer - dt); this.collectTimer = Math.max(0, this.collectTimer - dt);
    const cp = sim.device.compressor, press = this.pressTimer > 0 ? Math.sin((this.pressTimer / 0.28) * Math.PI) : 0;
    this.piston.position.y = cp.y + 1.0 - press * 1.3;
    (this.pressGlow.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.6;
    this.pressGlow.scale.setScalar(0.6 + press * 0.6);
    this.collectorGlow.scale.x = 0.85 + Math.min(0.15, this.collectTimer);
  }

  dispose() {
    this.clear();
    for (const m of Object.values(this.mats)) m.dispose();
    this.controls.dispose(); this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
