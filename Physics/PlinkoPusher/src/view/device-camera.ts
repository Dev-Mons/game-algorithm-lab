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
      const f = sim.frame, c = localToWorld(f, b.width / 2, b.height / 2, 0), n = f.normal, dist = b.height * 1.95 * f.scale;
      const target = new THREE.Vector3(c.x, c.y, c.z);
      return [target.clone().add(new THREE.Vector3(n.x, n.y, n.z).multiplyScalar(dist)).add(new THREE.Vector3(0, 1.5, 0)), target.add(new THREE.Vector3(0, 0.8, 0))];
    }
    // 낮은 앞-옆 각도: 더미 높이와 가장자리 무너짐이 보이게
    if (preset === 'pusher') return [new THREE.Vector3(t.width * 0.62, t.depth * 0.42 + 2.2, t.depth * 0.5 + 7.5), new THREE.Vector3(0, 0.4, 0.3)];
    const d = sim.device;
    if (preset === 'transfer') return [new THREE.Vector3(11, 10, d.die.z + 14), new THREE.Vector3(0, 5.4, d.die.z)];
    if (preset === 'side') return [new THREE.Vector3(35 * k, 12 * k, 0), new THREE.Vector3(0, 7 * k, -5 * k)];
    if (preset === 'rear') return [new THREE.Vector3(23 * k, 16 * k, -36 * k), new THREE.Vector3(0, 7 * k, -5 * k)];
    const distance = this.camera.aspect < 1.2 ? 56 : 47;
    return [new THREE.Vector3(18 * k, 28 * k, distance * k), new THREE.Vector3(0, 11 * k, -3 * k)];
  }

  setCamera(preset: CameraPreset, animate = true) {
    if (!this.sim) return;
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
