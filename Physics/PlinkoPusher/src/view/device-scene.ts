import * as THREE from 'three';
import { processorPaths, byproductPoint } from '../lab/device-layout';
import type { Simulation } from '../lab/simulation';
import { trayGeometry } from '../physics/tray-geometry';
import { LiveLabel, makeLabel } from './labels';
import type { DeviceMaterials } from './materials';
import { ResourceScope } from './resources';
import type { Vec3 } from '../core/math';

/** Machine meshes follow the same centre lines used by Simulation. All passages are open geometry. */
export class DeviceScene {
  readonly root = new THREE.Group();
  readonly boardGroup = new THREE.Group();
  private readonly trayGroup = new THREE.Group();
  private readonly chuteGroup = new THREE.Group();
  private readonly resources = new ResourceScope();
  private readonly placementResources = new ResourceScope();
  private sim: Simulation | null = null;
  items!: THREE.InstancedMesh; pegs!: THREE.InstancedMesh; tokens!: THREE.InstancedMesh;
  fall!: THREE.InstancedMesh; bufferChunks!: THREE.InstancedMesh;
  chunks!: THREE.InstancedMesh; rocks!: THREE.InstancedMesh; glints!: THREE.InstancedMesh;
  pegRings!: THREE.InstancedMesh;
  pusherMesh!: THREE.Mesh; piston!: THREE.Mesh; pressGlow!: THREE.Mesh; collectorGlow!: THREE.Mesh;
  outletGate!: THREE.Mesh; inletGate!: THREE.Mesh;
  processorRotor!: THREE.Mesh; pressCharge!: THREE.InstancedMesh; pressBlank!: THREE.InstancedMesh;
  readonly mainStock = new THREE.Group();
  selected!: THREE.Mesh;
  mainCurve!: THREE.CurvePath<THREE.Vector3>;
  readonly boardQuat = new THREE.Quaternion();
  live!: { raw: LiveLabel; buffer: LiveLabel; feed: LiveLabel; bonus: LiveLabel; main: LiveLabel };
  size = 1;
  private readonly m4 = new THREE.Matrix4();
  private readonly color = new THREE.Color();
  constructor(private readonly mats: DeviceMaterials) {}
  private own<T extends { dispose(): void }>(x: T): T { return this.resources.own(x); }
  private box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0, parent: THREE.Object3D = this.root, shadow = true) {
    const mesh = new THREE.Mesh(this.own(new THREE.BoxGeometry(w, h, d)), mat);
    mesh.position.set(x, y, z); mesh.castShadow = shadow; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  private cylinder(r: number, h: number, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = this.root, sides = 12) {
    const mesh = new THREE.Mesh(this.own(new THREE.CylinderGeometry(r, r, h, sides)), mat);
    mesh.position.set(x, y, z); mesh.castShadow = true; parent.add(mesh); return mesh;
  }
  private bolt(x: number, y: number, z: number, parent: THREE.Object3D = this.root) {
    const bolt = this.cylinder(0.10, 0.08, this.mats.metalLight, x, y, z, parent, 6); bolt.rotation.x = Math.PI / 2;
  }
  private plate(w: number, h: number, x: number, y: number, z: number, parent: THREE.Object3D) {
    this.box(w, h, 0.13, this.mats.metal, x, y, z, parent);
    for (const dx of [-1, 1]) for (const dy of [-1, 1]) this.bolt(x + dx * (w / 2 - 0.16), y + dy * (h / 2 - 0.16), z + 0.11, parent);
  }
  private stripes(w: number, h: number, x: number, y: number, z: number, parent: THREE.Object3D) {
    this.box(w, h, 0.04, this.mats.yellow, x, y, z, parent, false);
    for (let dx = -w / 2 + 0.5; dx < w / 2 - 0.3; dx += 1.1) {
      const shape = new THREE.Shape().moveTo(-0.28, -h / 2).lineTo(0.12, -h / 2).lineTo(0.42, h / 2).lineTo(0.02, h / 2).closePath();
      const stripe = new THREE.Mesh(this.own(new THREE.ShapeGeometry(shape)), this.mats.darker);
      stripe.position.set(x + dx, y, z + 0.023); parent.add(stripe);
    }
  }
  private path(points: readonly Vec3[]) {
    const path = new THREE.CurvePath<THREE.Vector3>();
    for (let i = 1; i < points.length; i++) path.add(new THREE.LineCurve3(new THREE.Vector3(points[i - 1].x, points[i - 1].y, points[i - 1].z), new THREE.Vector3(points[i].x, points[i].y, points[i].z)));
    return path;
  }
  /** Open U-channel, centre line is the cargo centre (floor below, rails outside its radius). */
  private channel(path: THREE.CurvePath<THREE.Vector3>, width: number, clearance: number, material: THREE.Material, parent: THREE.Object3D, temporary = false) {
    const own = <T extends { dispose(): void }>(r: T) => temporary ? this.placementResources.own(r) : this.own(r);
    for (const segment of path.curves) {
      const a = segment.getPoint(0), b = segment.getPoint(1), dir = b.clone().sub(a).normalize();
      const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
      const up = new THREE.Vector3().crossVectors(dir, right).normalize();
      const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, dir));
      const center = a.clone().add(b).multiplyScalar(0.5), len = a.distanceTo(b);
      for (const [w, h, dx, dy, mat] of [[width + 0.22, 0.12, 0, -clearance, this.mats.metal], [0.12, 0.55, -width / 2 - 0.06, -clearance + 0.23, material], [0.12, 0.55, width / 2 + 0.06, -clearance + 0.23, material]] as const) {
        const m = new THREE.Mesh(own(new THREE.BoxGeometry(w, h, len + 0.12)), mat);
        m.position.copy(center).addScaledVector(right, dx).addScaledVector(up, dy); m.quaternion.copy(q); m.castShadow = true; m.receiveShadow = true; parent.add(m);
      }
    }
  }

  build(sim: Simulation) {
    this.clear(); this.sim = sim;
    const b = sim.scenario.board, t = sim.scenario.tray, dev = sim.device;
    this.size = Math.max(1, t.width / 14, b.height / 16);
    this.root.add(this.boardGroup, this.trayGroup, this.chuteGroup);
    const floor = new THREE.Mesh(this.own(new THREE.PlaneGeometry(400, 400)), this.mats.floor);
    floor.rotation.x = -Math.PI / 2; floor.position.y = dev.floorY; floor.receiveShadow = true; this.root.add(floor);
    this.box(t.width + 12, 0.35, t.depth + 12, this.mats.darker, 0, dev.floorY + 0.18, -4);
    for (const x of [-t.width / 2 - 1, t.width / 2 + 1]) {
      this.box(0.7, 2.2, t.depth + 8, this.mats.dark, x, -2.35, -3);
      this.box(0.12, 0.3, t.depth + 8, this.mats.yellow, x + Math.sign(x) * 0.4, -1.6, -3);
      for (const z of [-10, -5, 0, 5]) this.box(1.3, 0.3, 1.3, this.mats.metal, x, -3.3, z);
    }
    // The processor rests on a common service chassis, with exposed hydraulic supports.
    this.box(t.width * 0.64, 3.2, 1.8, this.mats.dark, 0, 1.5, dev.boardAnchor.z - 0.6);
    for (const side of [-1, 1]) {
      const x = side * t.width * 0.36;
      this.cylinder(0.38, 4.0, this.mats.metal, x, 1.4, dev.boardAnchor.z);
      this.cylinder(0.19, 2.3, this.mats.metalLight, x, 3.2, dev.boardAnchor.z);
      this.box(1.1, 0.5, 2.4, this.mats.yellow, x, -0.9, dev.boardAnchor.z);
      for (let z = -4; z < t.depth / 2; z += 3) {
        const brace = this.box(0.6, 1.4, 1.3, this.mats.metal, side * (t.width / 2 + 0.6), -0.65, z);
        brace.rotation.x = -0.25;
        this.box(0.64, 0.18, 1.5, this.mats.yellow, side * (t.width / 2 + 0.6), -0.08, z);
      }
    }
    this.buildBoard(sim); this.buildTray(sim); this.buildStations(sim); this.buildLabels(sim); this.updatePlacement();
  }

  private buildBoard(sim: Simulation) {
    const b = sim.scenario.board, G = this.boardGroup, W = b.width, H = b.height, m = this.mats;
    this.box(W, H + 2.0, 0.32, m.board, W / 2, -H / 2 + 1, -0.18, G);
    for (const x of [-0.48, W + 0.48]) {
      this.box(1.15, H + 5, 1.5, m.dark, x, -H / 2, -0.18, G);
      this.box(0.26, H + 4, 1.25, m.paint, x, -H / 2, -0.05, G);
      // The inner face agrees with the 2D wall at u=0/W.
      this.box(0.16, H + 2.8, 0.9, m.metal, x < 0 ? -0.08 : W + 0.08, -H / 2 + 0.5, 0.3, G);
      for (let y = 1; y > -H - 1; y -= 2.8) {
        this.plate(1.65, 0.85, x, y, 0.85, G);
        this.box(0.18, 0.36, 0.13, m.orangeGlow, x, y - 0.7, 0.62, G, false);
      }
    }
    // Open hopper: broad outlet matches hopperSpread; no cross-beam across its throat.
    const mouth = Math.min(W - 0.5, b.hopperSpread * 2 + b.itemRadius * 2 + 0.7);
    this.box(mouth + 1.7, 2.4, 0.16, m.metal, W / 2, 2.15, -0.1, G);
    for (const side of [-1, 1]) {
      const x = W / 2 + side * (mouth / 2 + 0.22);
      const wing = this.box(0.25, 2.1, 1.2, m.yellow, x, 1.8, 0.4, G); wing.rotation.z = -side * 0.18;
      this.plate(0.85, 0.7, x, 2.5, 1.02, G);
    }
    this.box(mouth + 1.4, 0.55, 0.35, m.dark, W / 2, 3.3, 0.65, G);
    this.stripes(mouth + 1.25, 0.24, W / 2, 3.3, 0.85, G);
    this.box(mouth, 0.4, 0.08, m.glass, W / 2, 1.25, 0.91, G, false);
    this.rocks = this.instances(new THREE.IcosahedronGeometry(b.itemRadius, 0), m.item, 30, G);
    const pegGeo = new THREE.CylinderGeometry(b.pegRadius, b.pegRadius * 1.2, 0.62, 8); pegGeo.rotateX(Math.PI / 2); pegGeo.translate(0, 0, 0.3);
    this.pegs = this.instances(pegGeo, m.peg, sim.layout.pegs.length, G);
    this.pegRings = this.instances(new THREE.TorusGeometry(b.pegRadius + 0.08, 0.055, 6, 12), m.pegGlow, sim.layout.pegs.length, G);
    sim.layout.pegs.forEach((p, i) => {
      this.pegs.setMatrixAt(i, this.m4.makeTranslation(p.u, -p.v, 0));
      this.pegRings.setMatrixAt(i, this.m4.makeTranslation(p.u, -p.v, 0.1));
    });
    this.pegs.count = this.pegRings.count = sim.layout.pegs.length; this.refreshPegColors();
    this.selected = new THREE.Mesh(this.own(new THREE.TorusGeometry(b.pegRadius + 0.2, 0.045, 6, 20)), m.selected); this.selected.visible = false; G.add(this.selected);
    for (const x of [1, W - 1]) {
      const lamp = new THREE.PointLight(0xffbf65, 22, H * 0.58, 2); lamp.position.set(x, -H * 0.42, 1.3); G.add(lamp);
    }
    // Armour seam strips and replaceable peg-bed panels.
    for (let y = -2.1; y > -H; y -= 3.4) {
      this.box(W - 0.4, 0.045, 0.035, m.dark, W / 2, y, 0.01, G, false);
      for (const x of [0.38, W - 0.38]) this.bolt(x, y - 0.2, 0.045, G);
    }
    for (const side of [-1, 1]) {
      const x = side < 0 ? -1 : W + 1;
      this.box(1.3, 2.0, 1.8, m.dark, x, -H + 0.1, 0.25, G);
      this.plate(1.5, 1.3, x, -H + 0.1, 1.2, G);
      this.box(0.3, 1.55, 0.1, m.yellow, x, -H + 0.1, 1.32, G);
    }
    // The processor has a left resource port and an actual wide, open underside for scrap.
    const sill = (W + 0.1 - sim.device.passageWidth) / 2;
    for (const side of [-1, 1]) this.box(sill, 0.22, 1.7, m.dark, W / 2 + side * (sim.device.passageWidth + sill) / 2, -H - 1.75, 0.38, G);
    this.box(0.18, 1.8, 1.7, m.dark, W + 0.1, -H - 0.85, 0.38, G);
    this.box(W + 0.1, 1.8, 0.2, m.metal, W / 2, -H - 0.85, -0.48, G);
    this.box(W + 0.1, 1.9, 0.2, m.metal, W / 2, -H - 0.6, 1.18, G);
    this.stripes(W, 0.3, W / 2, -H - 0.52, 1.3, G);
    for (const x of [0.35, W - 0.35]) this.plate(0.6, 1.1, x, -H - 1.15, 1.33, G);
    for (let x = 1.3; x < W - 1; x += 0.5) this.box(0.22, 0.45, 0.08, m.darker, x, -H - 1.2, 1.31, G);
    this.processorRotor = this.cylinder(0.4, W - 0.4, m.metalLight, W / 2, -H - 0.45, 0.3, G); this.processorRotor.rotation.z = Math.PI / 2;
    {
      const x = -0.28, glow = m.greenGlow;
      // Port frame: back and sill, not a solid glowing plug.
      this.box(0.45, 0.13, 1.4, glow, x, -H - 1.65, 0.3, G, false);
      this.box(0.45, 0.13, 1.4, m.yellow, x, -H - 0.65, 0.3, G);
    }
    this.items = this.instances(new THREE.IcosahedronGeometry(b.itemRadius, 0), m.item, Math.max(16, sim.scenario.flow.plinkoMaxActive + 8), this.root);
  }
  private instances(geometry: THREE.BufferGeometry, mat: THREE.Material, cap: number, parent: THREE.Object3D) {
    const mesh = this.own(new THREE.InstancedMesh(this.own(geometry), mat, cap));
    mesh.count = 0; mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; parent.add(mesh); return mesh;
  }
  refreshPegColors() {
    if (!this.sim) return;
    const colors = { basic: 0x74797b, refiner: 0x85b842, splitter: 0xe1a12c };
    this.sim.layout.pegs.forEach((p, i) => {
      this.color.setHex(colors[p.kind]); this.pegs.setColorAt(i, this.color);
      this.pegRings.setColorAt(i, this.color.clone().multiplyScalar(p.kind === 'basic' ? 0.18 : 0.85));
    });
    if (this.pegs.instanceColor) this.pegs.instanceColor.needsUpdate = true;
    if (this.pegRings.instanceColor) this.pegRings.instanceColor.needsUpdate = true;
  }

  private buildTray(sim: Simulation) {
    const t = sim.scenario.tray, dev = sim.device, g = trayGeometry(t), T = this.trayGroup, m = this.mats;
    T.position.set(0, dev.trayTopY, dev.trayZ0);
    const len = t.depth - g.zBack, mid = (t.depth + g.zBack) / 2;
    this.box(t.width, 0.4, len, m.metalLight, 0, -0.2, mid, T);
    this.box(t.width + 1.0, 1.7, len - 0.5, m.dark, 0, -1.3, mid - 0.3, T);
    this.box(t.width, 0.055, 0.14, m.amberEdge, 0, 0.025, t.depth - 0.08, T, false);
    for (const side of [-1, 1]) {
      const x = side * (t.width / 2 + g.wallThickness), wh = g.wallHeight;
      this.box(g.wallThickness * 2, wh, len, m.glass, x, wh / 2, mid, T, false).renderOrder = 5;
      this.box(0.16, 1.05, len, m.paint, x + side * 0.06, 0.55, mid, T);
      this.box(0.08, wh - 1.2, len, m.meshGuard, x, (wh + 1.2) / 2, mid, T, false);
      this.box(0.75, 0.4, len + 0.6, m.dark, x, 0, mid, T);
      this.box(0.3, 0.16, len, m.metal, x, wh + 0.08, mid, T);
      for (const z of [g.zBack, t.faceMin, t.depth * 0.6, t.depth]) {
        this.box(0.38, wh + 0.4, 0.45, m.metal, x + side * 0.28, wh / 2, z, T);
        this.plate(0.75, 0.6, x, 0.15, z + 0.3, T);
      }
      this.box(0.3, 0.12, len, m.metal, x, -0.35, mid, T, false);
    }
    this.pusherMesh = this.box(t.width - 0.04, g.plateHeight, t.pusherDepth, m.metal, 0, g.plateHeight / 2, t.faceMin - t.pusherDepth / 2, T);
    this.stripes(t.width - 0.16, 0.5, 0, 0, t.pusherDepth / 2 + 0.04, this.pusherMesh);
    for (const x of [-t.width * 0.34, t.width * 0.34]) {
      this.box(0.45, 0.08, t.pusherDepth - 0.2, m.metalLight, x, g.plateHeight / 2 + 0.03, 0, this.pusherMesh);
      const rod = this.cylinder(0.15, t.pusherDepth + t.stroke + 1.0, m.metalLight, x, 0.38, g.zBack - 0.4, T); rod.rotation.x = Math.PI / 2;
    }
    if (sim.pusher.mode === 'stacked') {
      const depth = g.lip.zFront - g.zBack;
      this.box(t.width, g.lip.height, depth, m.dark, 0, g.lip.yBottom + g.lip.height / 2, g.zBack + depth / 2, T);
      this.stripes(t.width - 0.2, 0.28, 0, g.lip.yBottom + g.lip.height - 0.2, g.lip.zFront + 0.015, T);
    }
    const tokenGeo = new THREE.CylinderGeometry(t.tokenRadius, t.tokenRadius, t.tokenHalfHeight * 2, sim.scenario.quality === 'low' ? 10 : 16);
    this.tokens = this.instances(tokenGeo, m.token, sim.scenario.flow.trayMaxTokens + 64, T);
    this.fall = this.instances(tokenGeo.clone(), m.token, 96, T);
    // Wide open collector starts beneath the unsupported rim, including partially overhanging bodies.
    const front = t.depth + 3.4, back = t.depth - t.tokenRadius - 0.3, width = t.width + 2.4;
    this.box(width, 0.22, front - back, m.dark, 0, -3.0, (front + back) / 2, T);
    this.collectorGlow = this.box(width - 0.6, 0.06, 0.22, m.amberEdge, 0, -2.86, front - 0.35, T, false);
    for (const side of [-1, 1]) this.box(0.28, 2.4, front - back, m.metal, side * width / 2, -1.9, (front + back) / 2, T);
    this.box(width, 1, 0.25, m.metal, 0, -2.5, front, T);
    this.stripes(width - 0.2, 0.28, 0, -1.93, front + 0.15, T);
    this.box(width, 0.8, 0.2, m.glass, 0, -1.57, front, T, false);
  }

  private buildStations(sim: Simulation) {
    const s = sim.scenario, t = s.tray, d = sim.device, cp = d.compressor, m = this.mats;
    const mb = d.mainBin;
    this.box(3.4, 0.22, 3.2, m.metal, mb.x, mb.y - 0.6, mb.z);
    for (const side of [-1, 1]) this.box(0.2, 1.2, 3.2, m.dark, mb.x + side * 1.7, mb.y, mb.z);
    this.box(3.4, 1.0, 0.2, m.metal, mb.x, mb.y - 0.1, mb.z + 1.6);
    this.box(3.3, 0.12, 0.14, m.greenGlow, mb.x, mb.y + 0.46, mb.z + 1.72, this.root, false);
    this.root.add(this.mainStock); this.mainStock.visible = false;
    for (let i = 0; i < 12; i++) this.box(0.43, 0.2, 0.48, i % 3 ? m.metalLight : m.greenChute, mb.x + ((i % 4) - 1.5) * 0.61, mb.y - 0.34 + (i % 2) * 0.06, mb.z + (Math.floor(i / 4) - 1) * 0.6, this.mainStock);
    // Inline press: rear parked ram, receiving shutter and open-bottom die over the tray.
    const pressWidth = d.passageWidth, roof = d.pressTop;
    for (const side of [-1, 1]) {
      const x = side * (t.width / 2 + 0.9);
      this.box(0.55, roof - d.floorY + 0.4, 0.65, m.paint, x, (roof + d.floorY) / 2, d.ramParkZ);
      this.box(1.25, 0.25, 1.5, m.metal, x, d.floorY + 0.3, d.ramParkZ);
      this.plate(0.95, 1.0, x, d.die.y, d.ramParkZ + 0.38, this.root);
      // Cantilever arms remain above the entire pusher stroke and outside the falling coins.
      this.box((t.width - pressWidth) / 2 + 0.9, 0.35, 1.4, m.dark, side * ((t.width + pressWidth) / 4 + 0.4), d.die.y - 0.22, cp.z);
      this.box(0.22, 1.05, 3.4, m.paint, side * (pressWidth / 2 + 0.18), d.die.y + 0.3, cp.z - 0.7);
      this.box(0.12, 0.16, 3.4, m.metalLight, side * (pressWidth / 2 + 0.18), roof - 0.3, cp.z - 0.7);
    }
    this.box(t.width + 2.2, 0.55, 0.65, m.paint, 0, roof, d.ramParkZ);
    this.stripes(t.width + 1.8, 0.22, 0, roof - 0.12, d.ramParkZ + 0.34, this.root);
    this.piston = this.box(pressWidth - 0.2, 0.5, 1.1, m.metalLight, 0, roof - 0.5, d.ramParkZ);
    this.stripes(pressWidth - 0.3, 0.18, 0, 0, 0.57, this.piston);
    this.outletGate = this.box(pressWidth, 0.12, 1.4, m.metalLight, 0, d.die.y - t.tokenHalfHeight - 0.06, cp.z);
    this.inletGate = this.box(pressWidth, 0.12, 1.0, m.metal, 0, d.pressIn.y - 0.3, cp.z);
    for (const side of [-1, 1]) this.box(0.16, 0.75, 1.0, m.paint, side * (pressWidth / 2 + 0.08), d.pressIn.y + 0.04, cp.z);
    this.box(pressWidth, 0.75, 0.10, m.metal, 0, d.pressIn.y + 0.04, cp.z - 0.5);
    this.box(pressWidth, 0.75, 0.06, m.glass, 0, d.pressIn.y + 0.04, cp.z + 0.5, this.root, false);
    this.pressCharge = this.instances(new THREE.DodecahedronGeometry(0.19, 0), m.chunk, 24, this.root);
    this.pressBlank = this.instances(new THREE.CylinderGeometry(t.tokenRadius, t.tokenRadius, t.tokenHalfHeight * 2, 16), m.token, 24, this.root);
    this.bufferChunks = this.instances(new THREE.DodecahedronGeometry(0.19, 0), m.chunk, 24, this.root);
    this.pressGlow = this.box(pressWidth + 0.15, 0.08, 0.12, m.orangeGlow, 0, d.die.y - 0.15, cp.z + 0.84);
    this.chunks = this.instances(new THREE.DodecahedronGeometry(0.19, 0), m.chunk, Math.max(512, s.flow.plinkoMaxActive * s.economy.byproductCap), this.root);
    this.glints = this.instances(new THREE.BoxGeometry(0.48, 0.24, 0.38), m.glint, 32, this.root);
    // Service cabinet and hydraulic hoses make the support frame read as factory equipment.
    const cabinetX = -t.width / 2 - 2.1;
    this.box(2.2, 2.7, 1.1, m.paint, cabinetX, -0.7, 0.4);
    this.plate(1.9, 2.4, cabinetX, -0.7, 1.02, this.root);
    for (let y = -1.5; y < -0.9; y += 0.18) this.box(1.2, 0.06, 0.04, m.darker, cabinetX, y, 1.11);
    this.box(0.12, 0.5, 0.1, m.darker, cabinetX + 0.66, -0.55, 1.16);
    for (const dx of [-0.3, 0, 0.3]) this.cylinder(0.075, 0.09, dx === 0 ? m.orangeGlow : m.greenGlow, cabinetX + dx, 0.05, 1.15).rotation.x = Math.PI / 2;
    for (const side of [-1, 1]) {
      const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(cp.x + side * (d.pressHalfWidth + 0.2), roof - 0.2, cp.z - 1.2), new THREE.Vector3(cp.x + side * (d.pressHalfWidth + 0.8), cp.y + 2, cp.z - 1.5), new THREE.Vector3(cp.x + side * (d.pressHalfWidth + 0.2), d.die.y - 0.25, cp.z - 1.2)]);
      const hose = new THREE.Mesh(this.own(new THREE.TubeGeometry(curve, 20, 0.11, 8, false)), m.darker); this.root.add(hose);
    }
    // Work lights illuminate the same material family as the reference, without bloom obscuring paths.
    for (const p of [{ x: cp.x, y: cp.y + 0.7, z: cp.z + 1.0 }, { x: 0, y: 1.1, z: t.depth / 2 + 0.5 }]) {
      const light = new THREE.PointLight(0xffb431, 16, 7, 2); light.position.copy(p); this.root.add(light);
    }
  }

  private buildLabels(sim: Simulation) {
    const d = sim.device, b = sim.scenario.board;
    const add = (text: string, sub: string, color: string, p: Vec3, parent: THREE.Object3D = this.root) => {
      const sprite = makeLabel(text, sub, color); sprite.position.copy(p); sprite.scale.multiplyScalar(this.size * 0.85); parent.add(sprite); this.ownSprite(sprite);
    };
    add('RAW MATERIALS', '호퍼 · 원재료', '#e5b541', { x: b.width / 2, y: 4.1, z: 0.6 }, this.boardGroup);
    add('PROCESSED', '본 재화 · 수거', '#86bd55', { x: d.mainBin.x, y: d.mainBin.y - 0.1, z: d.mainBin.z + 1.85 });
    add('COMPRESSION', '부산물 · 압축', '#e5b541', { x: -d.pressHalfWidth - 2, y: d.die.y + 1.3, z: d.die.z });
    add('RECOVERY', '낙하 보너스', '#e5b541', { x: 0, y: -2.4, z: sim.scenario.tray.depth / 2 + 3.6 });
    this.live = { raw: new LiveLabel('#e5b541'), buffer: new LiveLabel('#e5b541'), feed: new LiveLabel('#e5b541'), bonus: new LiveLabel('#e5b541'), main: new LiveLabel('#86bd55') };
    const places = [d.boardAnchor, { x: -d.pressHalfWidth - 2, y: d.die.y - 0.2, z: d.die.z }, { x: 0, y: d.die.y - 2, z: d.die.z }, d.collector, d.mainBin];
    Object.values(this.live).forEach((l, i) => { l.sprite.position.copy(places[i]); l.sprite.position.y += i === 0 ? b.height / 2 + 5.3 : 1; this.root.add(l.sprite); this.ownSprite(l.sprite); });
  }
  private ownSprite(sprite: THREE.Sprite) { const m = sprite.material as THREE.SpriteMaterial; this.own(m); if (m.map) this.own(m.map); }

  updatePlacement() {
    const sim = this.sim; if (!sim) return;
    const w = sim.boardWorld;
    this.boardQuat.set(w.rotation.x, w.rotation.y, w.rotation.z, w.rotation.w);
    this.boardGroup.position.copy(w.position); this.boardGroup.quaternion.copy(this.boardQuat); this.boardGroup.scale.copy(w.scale);
    this.placementResources.dispose(); this.chuteGroup.clear();
    const paths = processorPaths(sim.scenario.board, sim.frame, sim.device);
    this.mainCurve = this.path(paths.main);
    this.channel(this.mainCurve, 1.1, 0.34, this.mats.greenChute, this.chuteGroup, true);
    // Loft the open throat between the rotated processor aperture and the fixed receiving pocket.
    const half = sim.device.passageWidth / 2;
    const corner = (end: number, across: number, depth: number) => byproductPoint(sim.scenario.board, sim.frame, sim.device, end, across, depth);
    const quad = (a: Vec3, b: Vec3, c: Vec3, d: Vec3, mat: THREE.Material) => {
      const geo = this.placementResources.own(new THREE.BufferGeometry());
      geo.setAttribute('position', new THREE.Float32BufferAttribute([a.x,a.y,a.z,b.x,b.y,b.z,c.x,c.y,c.z,a.x,a.y,a.z,c.x,c.y,c.z,d.x,d.y,d.z], 3));
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = true; mesh.receiveShadow = true; this.chuteGroup.add(mesh);
    };
    const back = this.placementResources.own(this.mats.metal.clone()); back.side = THREE.DoubleSide;
    quad(corner(0,-half,-0.5), corner(0,half,-0.5), corner(1,half,-0.5), corner(1,-half,-0.5), back);
    for (const side of [-1, 1]) quad(corner(0,side*half,-0.5), corner(0,side*half,0.5), corner(1,side*half,0.5), corner(1,side*half,-0.5), back);
    // Front stays open for inspection; two narrow braces protect the aperture corners.

    // Rear braced legs follow the transformed board, including compound placements.
    const board = sim.scenario.board;
    for (const u of [-0.5, board.width + 0.5]) {
      const top = new THREE.Vector3(u, -board.height * 0.6, -0.65).applyMatrix4(new THREE.Matrix4().compose(this.boardGroup.position, this.boardQuat, this.boardGroup.scale));
      const bottom = top.clone(); bottom.y = sim.device.floorY; bottom.z -= 1.2;
      const geo = this.placementResources.own(new THREE.BoxGeometry(0.65, top.distanceTo(bottom), 0.65));
      const mesh = new THREE.Mesh(geo, this.mats.dark); mesh.position.copy(top).add(bottom).multiplyScalar(0.5); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.sub(bottom).normalize()); mesh.castShadow = true; this.chuteGroup.add(mesh);
    }
  }
  clear() {
    this.sim = null; this.placementResources.dispose(); this.resources.dispose();
    for (const group of [this.root, this.boardGroup, this.trayGroup, this.chuteGroup, this.mainStock]) group.clear();
  }
  dispose() { this.clear(); this.root.removeFromParent(); }
  setLabels(on: boolean) { this.root.traverse(o => { if ((o as THREE.Sprite).isSprite) o.visible = on; }); }
}
