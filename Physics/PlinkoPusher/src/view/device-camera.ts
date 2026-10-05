import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { localToWorld } from '../core/frame';
import type { Simulation } from '../lab/simulation';

export type CameraPreset = 'all' | 'plinko' | 'pusher' | 'transfer' | 'side' | 'rear';

/** 카메라 프리셋·보간·입력 수명. 장치 메시 생성과 독립적이다. */
export class DeviceCamera {
  readonly controls: OrbitControls;
  private sim: Simulation | null = null;
  private size = 1;
  private tween: { from: [THREE.Vector3, THREE.Vector3]; to: [THREE.Vector3, THREE.Vector3]; t: number } | null = null;

  constructor(readonly camera: THREE.PerspectiveCamera, element: HTMLElement) {
    this.controls = new OrbitControls(this.camera, element);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = 1.42; this.controls.minPolarAngle = 0.12;
    this.controls.minAzimuthAngle = -Infinity; this.controls.maxAzimuthAngle = Infinity;
    this.controls.addEventListener('start', () => { this.tween = null; });
  }

  bind(sim: Simulation | null, size = 1) { this.sim = sim; this.size = size; this.tween = null; }

  cameraPose(preset: CameraPreset): [THREE.Vector3, THREE.Vector3] {
    const sim = this.sim!, k = this.size, b = sim.scenario.board, t = sim.scenario.tray;
    if (preset === 'plinko') {
      const f = sim.frame, c = localToWorld(f, b.width / 2, b.height / 2, 0), n = f.normal, dist = Math.max(b.height * 1.85, b.width / this.camera.aspect * 1.65) * f.scale;
      const target = new THREE.Vector3(c.x, c.y, c.z);
      return [target.clone().add(new THREE.Vector3(n.x, n.y, n.z).multiplyScalar(dist)).add(new THREE.Vector3(0, 1.5, 0)), target.add(new THREE.Vector3(0, 0.8, 0))];
    }
    // 낮은 앞-옆 각도: 더미 높이와 가장자리 무너짐이 보이게
    if (preset === 'pusher') return [new THREE.Vector3(t.width * 0.62, t.depth * 0.42 + 2.2, t.depth * 0.5 + 7.5), new THREE.Vector3(0, 0.4, 0.3)];
    const d = sim.device;
    if (preset === 'transfer') return [new THREE.Vector3(d.scrap.x+4, d.die.y + 2.4, d.die.z + 17), new THREE.Vector3(d.scrap.x+1.3, d.die.y + .7, d.die.z)];
    if (preset === 'side') return [new THREE.Vector3(35 * k, 12 * k, 0), new THREE.Vector3(0, 7 * k, -5 * k)];
    if (preset === 'rear') return [new THREE.Vector3(23 * k, 16 * k, -36 * k), new THREE.Vector3(0, 7 * k, -5 * k)];
    const points: THREE.Vector3[] = [];
    for (const u of [-1.2,b.width+1.2]) for (const v of [-4.5,b.height+2]) {
      const p=localToWorld(sim.frame,u,v,1.3);points.push(new THREE.Vector3(p.x,p.y,p.z));
    }
    const silo=d.silo;
    for(const x of [d.scrap.x-d.pressHalfWidth-.2,d.scrap.x+d.pressHalfWidth])for(const y of [d.floorY,Math.max(d.scrap.top+1,d.silo.top)])for(const z of [d.housingBackZ,d.housingFrontZ+.3])points.push(new THREE.Vector3(x,y,z));
    for(const x of [silo.x-silo.width/2-.4,silo.x+silo.width/2+.4])for(const y of [d.floorY,silo.top+.5])for(const z of [silo.z-silo.depth/2,silo.z+silo.depth/2+.6])points.push(new THREE.Vector3(x,y,z));
    for(const x of [-t.width/2-1.5,t.width/2+1.5]) {
      points.push(new THREE.Vector3(x,3.5,t.depth/2));
      for(const y of [-3.4,-1.1])points.push(new THREE.Vector3(x,y,t.depth/2+3.8));
    }
    const bounds=new THREE.Box3().setFromPoints(points), target=bounds.getCenter(new THREE.Vector3());
    const direction=new THREE.Vector3(.025,.20,1).normalize();
    const right=new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0),direction).normalize();
    const up=new THREE.Vector3().crossVectors(direction,right).normalize();
    const tan=Math.tan(THREE.MathUtils.degToRad(this.camera.fov/2));
    const vertical=tan*.90,horizontal=tan*this.camera.aspect*.93;
    let upper=-Infinity,lower=Infinity,east=-Infinity,west=Infinity;
    for(const p of points) {
      const q=p.clone().sub(target),depth=q.dot(direction),y=q.dot(up),x=q.dot(right);
      upper=Math.max(upper,y+depth*vertical);lower=Math.min(lower,y-depth*vertical);
      east=Math.max(east,x+depth*horizontal);west=Math.min(west,x-depth*horizontal);
    }
    // Fit the projected silhouette, including the forward collection bin, instead of centering its world AABB.
    const distance=Math.max((upper-lower)/(2*vertical),(east-west)/(2*horizontal));
    target.addScaledVector(up,(upper+lower)/2).addScaledVector(right,(east+west)/2);
    return [target.clone().addScaledVector(direction,distance),target];
  }

  setCamera(preset: CameraPreset, animate = true) {
    if (!this.sim) return;
    this.camera.fov=preset==='all'?25:40;this.camera.updateProjectionMatrix();
    const to = this.cameraPose(preset);
    this.controls.minDistance = 6; this.controls.maxDistance = 130 * this.size;
    if (!animate) { this.camera.position.copy(to[0]); this.controls.target.copy(to[1]); this.controls.update(); this.tween = null; return; }
    this.tween = { from: [this.camera.position.clone(), this.controls.target.clone()], to, t: 0 };
  }

  update(dt: number) {
    if (this.tween) {
      this.tween.t = Math.min(1, this.tween.t + dt / 0.7);
      const e = 1 - Math.pow(1 - this.tween.t, 3);
      this.camera.position.lerpVectors(this.tween.from[0], this.tween.to[0], e);
      this.controls.target.lerpVectors(this.tween.from[1], this.tween.to[1], e);
      if (this.tween.t >= 1) this.tween = null;
    }
    this.controls.update();
  }

  dispose() { this.controls.dispose(); }
}
