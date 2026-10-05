import * as THREE from 'three';
import { byproductPoint, POCKET_COUNT, POCKET_LEAD, POCKET_WALL_HALF, PROCESSOR_EXIT_V, RECEIVER_TRAVEL, outletCenter } from '../lab/device-layout';
import type { Simulation } from '../lab/simulation';
import { trayGeometry } from '../physics/tray-geometry';
import { LiveLabel, makeLabel } from './labels';
import type { DeviceMaterials } from './materials';
import { RawSupplyScene } from './raw-supply-scene';
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
  receiverItems!: THREE.InstancedMesh; chunks!: THREE.InstancedMesh; supply!: RawSupplyScene; glints!: THREE.InstancedMesh;
  pegRings!: THREE.InstancedMesh;
  pusherMesh!: THREE.Mesh; pressGlow!: THREE.Mesh; collectorGlow!: THREE.Mesh;
  inletGate!: THREE.Mesh;
  piston!: THREE.Group; pressCradle!: THREE.Group; scrapInletGate!: THREE.Mesh;
  readonly dieGates: THREE.Mesh[] = [];
  readonly outletGates: THREE.Mesh[] = [];
  readonly pistonRods: THREE.Mesh[] = []; scrapPieces!: THREE.InstancedMesh; pressBlank!: THREE.InstancedMesh;
  selected!: THREE.Mesh;
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
    this.size = Math.max(1, t.width / 28, b.height / 16);
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
    this.buildBoard(sim); this.buildTray(sim); this.buildStations(sim);
    this.supply = new RawSupplyScene(sim, this.mats, this.boardGroup); this.root.add(this.supply.root);
    this.buildLabels(sim); this.updatePlacement();
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
    // Eight open receiving lanes continue the local board surface.
    const length=PROCESSOR_EXIT_V, lane=W/POCKET_COUNT;
    this.box(W,length,.18,m.metal,W/2,-H-length/2,-.10,G);
    for(let i=0;i<=POCKET_COUNT;i++) {
      this.box(POCKET_WALL_HALF*2,length-POCKET_LEAD,.78,m.metalLight,i*lane,-H-(length+POCKET_LEAD)/2,.32,G);
      this.bolt(i*lane,-H-length+.2,.75,G);
    }
    this.box(W,.24,.22,m.metal,W/2,-H-length,.77,G);
    this.stripes(W,.2,W/2,-H-length,.90,G);
    this.receiverItems=this.instances(new THREE.IcosahedronGeometry(b.itemRadius,0),m.item,sim.scenario.flow.plinkoMaxActive+32,this.root);
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
    const s=sim.scenario,t=s.tray,d=sim.device,m=this.mats,bin=d.scrap;
    const width=d.pressHalfWidth*2,front=d.housingFrontZ,back=d.housingBackZ;
    const bottom=d.coinRail.y-.55,top=bin.top+.65,windowBottom=d.scrapCoverY;
    const P=new THREE.Group();P.position.x=bin.x;this.root.add(P);
    // Left sidecar: open chamber above an opaque conversion cabinet, supported to the base.
    this.box(width,.25,front-back,m.metal,0,d.floorY+.15,(front+back)/2,P);
    this.box(width,top-d.floorY,.18,m.dark,0,(top+d.floorY)/2,back,P);
    for(const side of [-1,1]) {
      const x=side*(width/2-.12);
      for(const z of [front,back]) {
        this.box(.30,top-d.floorY,.34,m.paint,x,(top+d.floorY)/2,z,P);
        for(let y=d.floorY+.4;y<top;y+=1.15)this.bolt(x,y,z+.2,P);
      }
      // The right lower side is open across the four conveyor lanes.
      const sideBottom=side>0?d.scrapBelt.y+.62:d.coinRail.y+1.15;
      this.box(.16,top-sideBottom,front-back,m.paint,x,(top+sideBottom)/2,(front+back)/2,P);
      this.box(.18,d.coinRail.y-.35-d.floorY,front-back,m.paint,x,(d.floorY+d.coinRail.y-.35)/2,(front+back)/2,P);
    }
    this.box(width,.35,front-back,m.paint,0,top,(front+back)/2,P);
    this.plate(width-.3,.72,0,top-.6,front+.04,P);
    const headTop=Math.max(top+.4,d.silo.top-.25);
    this.box(width,headTop-top,front-back,m.paint,0,(headTop+top)/2,(front+back)/2,P);
    for(let i=0;i<3;i++) {
      const h=(headTop-top)/3,y=top+(i+.5)*h;
      this.plate(width-.25,Math.max(.2,h-.12),0,y,front+.05,P);
      for(let row=0;row<3;row++)this.box(width*.55,.045,.03,m.darker,0,y-.16+row*.15,front+.16,P);
    }
    this.box(width,.20,.25,m.metal,0,windowBottom,front,P);
    const glass=this.box(width-.45,bin.top-windowBottom+.05,.04,m.glass,0,(bin.top+windowBottom)/2,front+.05,P,false);glass.renderOrder=4;
    this.box(width,.35,.3,m.metal,0,bin.top+.28,front,P);
    const coverBottom=d.coinRail.y-.7;
    this.box(width,windowBottom-coverBottom,.20,m.paint,0,(windowBottom+coverBottom)/2,front,P);
    this.plate(width-.3,.63,0,windowBottom-.45,front+.12,P);
    for(let row=0;row<3;row++)this.box(width*.52,.055,.03,m.darker,0,windowBottom-.55+row*.14,front+.22,P);
    this.stripes(width-.2,.14,0,windowBottom-.12,front+.25,P);
    this.box(width,.32,.35,m.paint,0,bottom,front,P);
    this.box(width-.35,1.0,.10,m.meshGuard,0,d.floorY+1.0,front-.08,P);
    const motor=this.cylinder(.44,.22,m.metalLight,0,d.floorY+1,front+.03,P);motor.rotation.x=Math.PI/2;
    this.pressCradle=new THREE.Group();P.add(this.pressCradle);
    for(const side of [-1,1]) {
      this.box(.14,bin.top-windowBottom,.7,m.metal,side*(bin.width/2-.11),(bin.top+windowBottom)/2,bin.z,P);
      const run=bin.width/2-bin.outletHalfWidth,rise=bin.bottom-bin.throatY;
      const plate=this.box(Math.hypot(run,rise),.1,.65,m.metal,side*(bin.width/2+bin.outletHalfWidth)/2,(bin.bottom+bin.throatY)/2-.055,bin.z,this.pressCradle);
      plate.rotation.z=side*Math.atan2(rise,run);
    }
    this.inletGate=this.box(bin.outletHalfWidth*2,.1,.65,m.metalLight,0,bin.throatY-.05,bin.z,this.pressCradle);
    this.scrapInletGate=this.box(bin.inletWidth!,.1,.68,m.metal,0,bin.top+.42,bin.z,P);
    this.piston=new THREE.Group();P.add(this.piston);
    this.box(bin.width-.24,.24,.66,m.metalLight,0,.12,0,this.piston);
    this.stripes(bin.width-.38,.14,0,.12,.35,this.piston);
    this.pistonRods.length=0;
    for(const x of [-bin.width*.36,bin.width*.36]) {
      this.pistonRods.push(this.cylinder(.11,1,m.metalLight,x,bin.top,bin.z,P));
      this.box(.4,.48,.5,m.paint,x,bin.top+.35,bin.z,P);
      this.cylinder(.07,bin.top-windowBottom,m.metal,x,(bin.top+windowBottom)/2,bin.z+.43,P);
    }
    this.pressGlow=this.box(.32,.16,.12,m.orangeGlow,width/2-.4,windowBottom-.4,front+.26,P);
    const lamp=new THREE.PointLight(0xffc482,22,6,2);lamp.position.set(0,bin.top-.2,front-.2);P.add(lamp);

    // Scrap collector runs left underneath the receiving pockets, into an enclosed service lift.
    const belt=d.scrapBelt;
    // Opaque scrap duct: no passing material or moving belt is exposed.
    this.box(belt.right-belt.left,.55,belt.depth+.14,m.paint,(belt.left+belt.right)/2,belt.y+.12,belt.z);
    // Housing surrounds the hidden upward route; its small shaft window exposes the chain drive.
    const liftX=belt.left-.1,liftZ=back+.4,liftTop=bin.top+1.15;
    this.box(.85,liftTop-belt.y,.85,m.paint,liftX,(liftTop+belt.y)/2,liftZ);
    this.box(.48,liftTop-belt.y-.2,.035,m.meshGuard,liftX,(liftTop+belt.y)/2,liftZ+.44);
    this.box(.85,.60,belt.z-liftZ+.6,m.paint,liftX,belt.y+.2,(belt.z+liftZ)/2);
    this.channel(this.path([{x:belt.left,y:bin.top+1.05,z:liftZ},{x:bin.x,y:bin.top+.9,z:bin.z}]),.7,.26,m.paint,this.root);
    // Upper side entry is visibly connected; material passes through this open mouth.
    this.box(.18,.65,belt.depth+.16,m.metal,belt.left-.35,belt.y+.15,belt.z);

    // Closed distributor. Its bottom is segmented around four real vertical outlets.
    const deckLeft=d.die.x-d.cargoPitch,deckRight=t.width/2-.4;
    const floor=d.coinRail.y-t.tokenHalfHeight-.12,ceiling=d.coinRail.y+.78;
    const backZ=Math.min(d.coinRail.backZ-.65,d.outletZ-.7),frontZ=Math.max(d.coinRail.frontZ+.65,d.outletZ+.7);
    const holeBack=d.outletZ-.62,holeFront=d.outletZ+.62;
    this.box(deckRight-deckLeft,.14,frontZ-backZ,m.paint,(deckRight+deckLeft)/2,ceiling,(backZ+frontZ)/2);
    for(const z of [backZ,frontZ])this.box(deckRight-deckLeft,ceiling-floor,.12,m.paint,(deckRight+deckLeft)/2,(ceiling+floor)/2,z);
    for(const x of [deckLeft,deckRight])this.box(.12,ceiling-floor,frontZ-backZ,m.metal,x,(ceiling+floor)/2,(frontZ+backZ)/2);
    for(const [z0,z1] of [[backZ,holeBack],[holeFront,frontZ]]) {
      if(z1>z0)this.box(deckRight-deckLeft,.10,z1-z0,m.metal,(deckRight+deckLeft)/2,floor-.05,(z0+z1)/2);
    }
    this.outletGates.length=0;this.dieGates.length=0;
    let edge=deckLeft;
    for(let i=0;i<d.outletCount;i++) {
      const x=outletCenter(d,i),half=d.outletWidth/2;
      if(x-half>edge)this.box(x-half-edge,.1,holeFront-holeBack,m.metal,(edge+x-half)/2,floor-.05,d.outletZ);
      edge=x+half;
      this.dieGates.push(this.box(.10,1.12,d.cargoPitch-.07,m.metalLight,d.die.x+width/2-.2,d.coinRail.y+.43,d.coinRail.frontZ-i*d.cargoPitch));
      const bottom=d.outletY-.18;
      for(const side of [-1,1])this.box(.10,floor-bottom,1.24,m.metal,x+side*(half+.05),(floor+bottom)/2,d.outletZ);
      // Leave a real rear slot for the sliding shutter's complete travel.
      const gateY=d.outletY+.08;
      for(const [low,high] of [[bottom,gateY-.075],[gateY+.075,floor]]) {
        if(high>low)this.box(d.outletWidth,high-low,.10,m.dark,x,(low+high)/2,holeBack-.05);
      }
      const lip=d.outletY+.12;
      this.box(d.outletWidth,Math.max(.06,floor-lip),.10,m.paint,x,(floor+lip)/2,holeFront+.05);
      this.outletGates.push(this.box(d.outletWidth,.10,1.15,m.metalLight,x,d.outletY+.08,d.outletZ));
      this.stripes(d.outletWidth,.09,x,lip+.04,holeFront+.12,this.root);
      this.box(.2,.12,.10,m.orangeGlow,x,floor+.24,frontZ+.08);
    }
    if(edge<deckRight)this.box(deckRight-edge,.1,holeFront-holeBack,m.metal,(edge+deckRight)/2,floor-.05,d.outletZ);
    for(const x of [-t.width/2-.35,t.width/2+.35]) {
      this.box(.42,belt.y-d.floorY,.5,m.paint,x,(belt.y+d.floorY)/2,belt.z-.55);
      this.box(.9,.2,1.0,m.metal,x,d.floorY+.12,belt.z-.55);
    }
    const shard=new THREE.Shape().moveTo(.92,0).lineTo(.38,.78).lineTo(-.65,.47).lineTo(-.9,-.18).lineTo(-.2,-.72).lineTo(.5,-.42).closePath();
    const geo=new THREE.ExtrudeGeometry(shard,{depth:.24,bevelEnabled:true,bevelSize:.025,bevelThickness:.02,bevelSegments:1,steps:1});geo.translate(0,0,-.12);
    this.scrapPieces=this.instances(geo,m.chunk,bin.displayCapacity,this.root);
    this.pressBlank=this.instances(new THREE.CylinderGeometry(t.tokenRadius,t.tokenRadius,t.tokenHalfHeight*2,16),m.token,24,this.root);
    this.bufferChunks=this.instances(new THREE.DodecahedronGeometry(.23,0),m.chunk,24,this.root);
    this.chunks=this.instances(geo.clone().scale(.18,.18,.18),m.chunk,Math.max(512,s.flow.plinkoMaxActive*s.economy.byproductCap),this.root);
    this.glints=this.instances(new THREE.BoxGeometry(.1,.1,.1),m.glint,1,this.root);
    const light=new THREE.PointLight(0xffb431,12,7,2);light.position.set(0,1.1,t.depth/2+.5);this.root.add(light);
  }

  private buildLabels(sim: Simulation) {
    const d = sim.device, b = sim.scenario.board;
    const add = (text: string, sub: string, color: string, p: Vec3, parent: THREE.Object3D = this.root) => {
      const sprite = makeLabel(text, sub, color); sprite.position.copy(p); sprite.scale.multiplyScalar(this.size * 0.85); parent.add(sprite); this.ownSprite(sprite);
    };
    add('RAW MATERIALS', '호퍼 · 원재료', '#e5b541', { x: b.width / 2, y: 4.1, z: 0.6 }, this.boardGroup);
    add('COMPRESSION', '부산물 · 압축', '#e5b541', { x: d.scrap.x-d.pressHalfWidth-.8, y: d.die.y + 1.3, z: d.die.z });
    add('RECOVERY', '낙하 보너스', '#e5b541', { x: 0, y: -2.4, z: sim.scenario.tray.depth / 2 + 3.6 });
    this.live = { raw: new LiveLabel('#e5b541'), buffer: new LiveLabel('#e5b541'), feed: new LiveLabel('#e5b541'), bonus: new LiveLabel('#e5b541'), main: new LiveLabel('#86bd55') };
    const places = [{ x: d.silo.x, y: d.silo.top - sim.scenario.board.height / 2 - 5.6, z: d.silo.z + d.silo.depth / 2 + .4 }, { x: d.scrap.x-d.pressHalfWidth-.8, y: d.die.y - 0.2, z: d.die.z }, { x: 0, y: d.die.y - 2, z: d.die.z }, d.collector, {x:0,y:d.pressIn.y+.6,z:d.housingFrontZ}];
    Object.values(this.live).forEach((l, i) => { l.sprite.position.copy(places[i]); l.sprite.position.y += i === 0 ? b.height / 2 + 5.3 : 1; this.root.add(l.sprite); this.ownSprite(l.sprite); });
  }
  private ownSprite(sprite: THREE.Sprite) { const m = sprite.material as THREE.SpriteMaterial; this.own(m); if (m.map) this.own(m.map); }

  updatePlacement() {
    const sim = this.sim; if (!sim) return;
    const w = sim.boardWorld;
    this.boardQuat.set(w.rotation.x, w.rotation.y, w.rotation.z, w.rotation.w);
    this.boardGroup.position.copy(w.position); this.boardGroup.quaternion.copy(this.boardQuat); this.boardGroup.scale.copy(w.scale);
    this.placementResources.dispose(); this.chuteGroup.clear();
    this.supply?.updatePlacement();
    // Loft the open throat between the rotated processor aperture and the fixed receiving pocket.
    const half = sim.scenario.board.width * sim.frame.scale / 2;
    const frontDepth=(sim.scenario.board.itemRadius+RECEIVER_TRAVEL)*sim.frame.scale+.2;
    const corner = (end: number, across: number, depth: number) => byproductPoint(sim.scenario.board, sim.frame, sim.device, end, across*(end?sim.device.passageWidth/(half*2):1), depth);
    const quad = (a: Vec3, b: Vec3, c: Vec3, d: Vec3, mat: THREE.Material) => {
      const geo = this.placementResources.own(new THREE.BufferGeometry());
      geo.setAttribute('position', new THREE.Float32BufferAttribute([a.x,a.y,a.z,b.x,b.y,b.z,c.x,c.y,c.z,a.x,a.y,a.z,c.x,c.y,c.z,d.x,d.y,d.z], 3));
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = true; mesh.receiveShadow = true; this.chuteGroup.add(mesh);
    };
    const back = this.placementResources.own(this.mats.metal.clone()); back.side = THREE.DoubleSide;
    quad(corner(0,-half,-0.5), corner(0,half,-0.5), corner(1,half,-0.5), corner(1,-half,-0.5), back);
    for (const side of [-1, 1]) quad(corner(0,side*half,-0.5), corner(0,side*half,frontDepth), corner(1,side*half,frontDepth), corner(1,side*half,-0.5), back);
    // Sealed manifold below the pocket throats.
    const cover=this.placementResources.own(this.mats.paint.clone());cover.side=THREE.DoubleSide;
    quad(corner(0,-half,frontDepth),corner(0,half,frontDepth),corner(1,half,frontDepth),corner(1,-half,frontDepth),cover);

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
    this.sim = null; this.supply?.dispose(); this.placementResources.dispose(); this.resources.dispose();
    for (const group of [this.root, this.boardGroup, this.trayGroup, this.chuteGroup]) group.clear();
  }
  dispose() { this.clear(); this.root.removeFromParent(); }
  setLabels(on: boolean) { this.root.traverse(o => { if ((o as THREE.Sprite).isSprite) o.visible = on; }); }
}
