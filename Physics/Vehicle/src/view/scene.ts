import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Vehicle, WHEEL_RADIUS } from '../physics/vehicle';
import { Terrain } from '../physics/terrain';

export class VehicleView {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(43, 1, 0.1, 800);
  private controls: OrbitControls;
  private world = new THREE.Group();
  private car = new THREE.Group();
  private wheelGroups: THREE.Group[] = [];
  private spins: THREE.Group[] = [];
  private struts: THREE.Mesh[] = [];
  private arrows: THREE.ArrowHelper[][] = [];
  private springs: THREE.Line[] = [];
  private trail: THREE.Line;
  private trailPoints: THREE.Vector3[] = [];
  private lastStep = -1;
  private shadowLight: THREE.DirectionalLight;
  private resizeObserver: ResizeObserver;
  private lastTarget = new THREE.Vector3();
  cameraMode: 'orbit' | 'chase' | 'top' = 'orbit';
  forces = true;
  showTrail = true;
  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.append(this.renderer.domElement);
    this.renderer.domElement.setAttribute('aria-label', '차량 3D 주행 화면');
    this.renderer.domElement.tabIndex = 0;
    this.scene.background = new THREE.Color('#7c9297'); this.scene.fog = new THREE.Fog('#7c9297', 90, 260);
    this.scene.add(new THREE.HemisphereLight('#e1f6ff', '#687066', 2.8));
    this.shadowLight = new THREE.DirectionalLight('#fff0d4', 3.2);
    this.shadowLight.position.set(-12, 24, -8); this.shadowLight.castShadow = true;
    this.shadowLight.shadow.mapSize.set(2048, 2048);
    Object.assign(this.shadowLight.shadow.camera, { left: -25, right: 25, top: 25, bottom: -25, near: 0.1, far: 80 });
    this.shadowLight.shadow.bias = -0.0005;
    this.scene.add(this.shadowLight, this.shadowLight.target);
    this.scene.add(this.world, this.car);
    this.camera.position.set(10, 8, -13);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; this.controls.maxPolarAngle = Math.PI * 0.48;
    this.controls.minDistance = 5; this.controls.maxDistance = 55; this.controls.enablePan = false;
    this.buildCar();
    this.trail = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#f5d49b', transparent: true, opacity: 0.8 }));
    this.trail.frustumCulled = false; this.scene.add(this.trail);
    this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(host); this.resize();
  }
  private mesh(geometry: THREE.BufferGeometry, color: string, parent: THREE.Object3D = this.car) {
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, roughness: 0.65 }));
    mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  private buildCar() {
    const base = this.mesh(new THREE.BoxGeometry(1.62, 0.48, 3.4), '#f78f4b'); base.position.y = 0.26;
    const hood = this.mesh(new THREE.BoxGeometry(1.57, 0.1, 0.95), '#ffa364'); hood.position.set(0, 0.52, 1.13);
    const cabin = this.mesh(new THREE.BoxGeometry(1.34, 0.53, 1.52), '#203944'); cabin.position.set(0, 0.72, -0.24);
    const roof = this.mesh(new THREE.BoxGeometry(1.38, 0.08, 1.56), '#ffad72'); roof.position.set(0, 1.01, -0.24);
    for (const x of [-0.68, 0.68]) {
      const pillar = this.mesh(new THREE.BoxGeometry(0.06, 0.54, 0.09), '#f78f4b'); pillar.position.set(x, 0.73, -0.22);
      const mirror = this.mesh(new THREE.BoxGeometry(0.18, 0.12, 0.22), '#f78f4b'); mirror.position.set(x * 1.34, 0.65, 0.45);
    }
    for (const x of [-0.56, 0.56]) {
      const light = this.mesh(new THREE.BoxGeometry(0.36, 0.13, 0.04), '#fff1bd'); light.position.set(x, 0.31, 1.72);
      const rear = this.mesh(new THREE.BoxGeometry(0.32, 0.12, 0.04), '#b42b30'); rear.position.set(x, 0.31, -1.72);
    }
    for (const z of [-1.73, 1.73]) {
      const bumper = this.mesh(new THREE.BoxGeometry(1.55, 0.13, 0.14), '#26353b'); bumper.position.set(0, 0.08, z);
    }
    for (let i = 0; i < 4; i++) {
      const group = new THREE.Group(), spin = new THREE.Group(); this.car.add(group); group.add(spin);
      const tire = this.mesh(new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.25, 20), '#1c262d', spin); tire.rotation.z = Math.PI / 2;
      const rim = this.mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.265, 12), '#c6d4d4', spin); rim.rotation.z = Math.PI / 2;
      const hub = this.mesh(new THREE.BoxGeometry(0.28, 0.055, 0.3), '#536a75', spin);
      hub.rotation.x = Math.PI / 4;
      this.wheelGroups.push(group); this.spins.push(spin);
      const strut = this.mesh(new THREE.CylinderGeometry(0.045, 0.045, 1, 8), '#a7bbc0');
      this.struts.push(strut);
      const arrows = ['#68f0ae', '#ff6b6b', '#69baff'].map(color => {
        const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 1, color, 0.16, 0.09);
        this.scene.add(arrow); return arrow;
      });
      this.arrows.push(arrows);
      const spring = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: '#c1ffdc' }));
      this.scene.add(spring); this.springs.push(spring);
    }
  }
  setTerrain(terrain: Terrain) {
    this.world.traverse(object => {
      if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) { object.geometry.dispose(); const materials = Array.isArray(object.material) ? object.material : [object.material]; materials.forEach(m => m.dispose()); }
    });
    this.world.clear();
    const floor = this.mesh(new THREE.PlaneGeometry(10000, 10000), '#6b8388', this.world); floor.rotation.x = -Math.PI / 2; floor.castShadow = false;
    const grid = new THREE.GridHelper(500, 250, '#b0c2c5', '#8ea4a9'); grid.position.y = 0.008;
    (grid.material as THREE.Material).transparent = true; (grid.material as THREE.Material).opacity = 0.24; this.world.add(grid);
    const vertices: number[] = [];
    for (const triangle of terrain.triangles.slice(2)) for (const p of [triangle.a, triangle.b, triangle.c]) vertices.push(p.x, p.y + 0.012, p.z);
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); geometry.computeVertexNormals();
    this.mesh(geometry, '#bac3b8', this.world);
    for (const b of terrain.boxes) {
      const mesh = this.mesh(new THREE.BoxGeometry(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z), '#c9b995', this.world);
      mesh.position.set((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2);
    }
    for (let i = 0; i < 20; i++) for (const x of [-4.8, 4.8]) {
      const marker = this.mesh(new THREE.BoxGeometry(0.12, 0.014, 2), '#bacccd', this.world); marker.position.set(x, 0.013, i * 7);
    }
    for (const x of [-4.8, 4.8]) for (const z of [-2, 10, 40, 70]) {
      const cone = this.mesh(new THREE.ConeGeometry(0.22, 0.62, 12), '#f2ab6d', this.world); cone.position.set(x, 0.31, z);
      const foot = this.mesh(new THREE.BoxGeometry(0.48, 0.06, 0.48), '#324951', this.world); foot.position.set(x, 0.03, z);
    }
    // Painted circle: geometry is visual guidance only.
    const ring = this.mesh(new THREE.RingGeometry(11.96, 12.04, 96), '#b2c4c4', this.world);
    ring.rotation.x = -Math.PI / 2; ring.position.set(18, 0.018, 12); ring.castShadow = false;
    this.resetCamera(); this.trailPoints = []; this.lastStep = -1;
  }
  resetCamera() { this.lastTarget.set(0, 0, 0); this.controls.target.set(0, 0.7, 0); this.camera.position.set(10, 8, -13); this.controls.update(); }
  private resize() {
    const width = this.host.clientWidth, height = this.host.clientHeight;
    this.renderer.setSize(width, height); this.camera.aspect = width / Math.max(1, height); this.camera.updateProjectionMatrix();
  }
  inspectWheels() {
    // Read the actual rendered transforms so browser regressions can catch a
    // visual sign error even when the simulation's own steering data is correct.
    const bodyForward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.car.quaternion);
    return this.wheelGroups.map(group => {
      const position = group.getWorldPosition(new THREE.Vector3());
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(group.getWorldQuaternion(new THREE.Quaternion()));
      const straightTip = position.clone().add(bodyForward).project(this.camera);
      const steeredTip = position.clone().add(forward).project(this.camera);
      return { angle: group.rotation.y, screenSteer: steeredTip.x - straightTip.x };
    });
  }
  render(vehicle: Vehicle, alpha: number, frameDt: number, paused: boolean) {
    const body = vehicle.body, a = paused ? 1 : alpha;
    const target = new THREE.Vector3(body.position.x, body.position.y, body.position.z);
    const previous = vehicle.previousPosition;
    this.car.position.set(previous.x, previous.y, previous.z).lerp(target, a);
    const q = body.orientation, pq = vehicle.previousOrientation;
    this.car.quaternion.set(pq.x, pq.y, pq.z, pq.w).slerp(new THREE.Quaternion(q.x, q.y, q.z, q.w), a);
    vehicle.wheels.forEach((w, i) => {
      this.wheelGroups[i].position.set(w.local.x, -w.length, w.local.z); this.wheelGroups[i].rotation.y = w.steer;
      this.struts[i].position.set(w.local.x, -w.length / 2, w.local.z); this.struts[i].scale.y = Math.max(0.01, w.length);
      this.spins[i].rotation.x = w.spin;
      [w.suspensionForce, w.lateralForce, w.driveForce].forEach((f, j) => {
        const arrow = this.arrows[i][j], length = f.length(); arrow.visible = this.forces && length > 2;
        if (length > 2) {
          const origin = j === 0 ? w.anchor : j === 1 ? w.lateralForcePoint : w.forcePoint;
          arrow.position.set(origin.x, origin.y, origin.z);
          arrow.setDirection(new THREE.Vector3(f.x / length, f.y / length, f.z / length));
          arrow.setLength(Math.min(3.6, length * 0.0005), 0.15, 0.08);
        }
      });
      const spring = this.springs[i]; spring.visible = this.forces;
      const pos = spring.geometry.getAttribute('position') as THREE.BufferAttribute;
      pos.setXYZ(0, w.anchor.x, w.anchor.y, w.anchor.z); pos.setXYZ(1, w.forcePoint.x, w.forcePoint.y, w.forcePoint.z); pos.needsUpdate = true;
      spring.geometry.computeBoundingSphere();
    });
    if (vehicle.stepIndex !== this.lastStep && vehicle.stepIndex % 3 === 0) {
      this.lastStep = vehicle.stepIndex;
      this.trailPoints.push(new THREE.Vector3(body.position.x, vehicle.terrain.surface(body.position.x, body.position.z)!.point.y + 0.035, body.position.z));
      if (this.trailPoints.length > 1600) this.trailPoints.shift();
      this.trail.geometry.dispose(); this.trail.geometry = new THREE.BufferGeometry().setFromPoints(this.trailPoints);
    }
    this.trail.visible = this.showTrail;
    const delta = target.clone().sub(this.lastTarget); this.lastTarget.copy(target);
    const smoothing = 1 - Math.exp(-Math.min(frameDt, 0.1) * 5);
    this.controls.enabled = this.cameraMode === 'orbit';
    if (this.cameraMode === 'orbit') { this.camera.position.add(delta); this.controls.target.copy(target); this.controls.update(); }
    else {
      const offset = this.cameraMode === 'top' ? new THREE.Vector3(0.01, 28, -0.01) : new THREE.Vector3(-vehicle.forward.x * 11, 5, -vehicle.forward.z * 11);
      this.camera.position.lerp(target.clone().add(offset), smoothing); this.camera.lookAt(target);
      this.controls.target.copy(target);
    }
    this.shadowLight.position.copy(target).add(new THREE.Vector3(-12, 24, -8)); this.shadowLight.target.position.copy(target);
    this.renderer.render(this.scene, this.camera);
  }
  dispose() { this.resizeObserver.disconnect(); this.controls.dispose(); this.renderer.dispose(); }
}
