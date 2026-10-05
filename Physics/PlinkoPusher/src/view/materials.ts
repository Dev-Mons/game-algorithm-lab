import * as THREE from 'three';

export const C = {
  metal: 0x50545b, metalLight: 0xb2aea3, dark: 0x232a32, darker: 0x131a20, yellow: 0xc18a22, orange: 0xff8a2a, green: 0x39d27a,
  floor: 0x12181f, ore: 0x9c8f80, processed: 0x9cb578, byproduct: 0x8d7254, steel: 0xc3cbd1, bundle2: 0xd9b56a, bundle3: 0xf2c24a, seed: 0x8c9492,
};

/** Small deterministic stamped-metal texture, generated locally (no asset/network dependency). */
function coinStamp() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
  const c = canvas.getContext('2d')!;
  c.fillStyle = '#bbb8ad'; c.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 450; i++) {
    const x = (i * 47) % 128, y = (i * 79) % 128;
    c.fillStyle = i % 2 ? '#c7c4ba' : '#aba89e'; c.fillRect(x, y, 1 + i % 3, 1);
  }
  c.strokeStyle = '#5d5d58'; c.lineWidth = 3;
  for (const r of [54, 45]) { c.beginPath(); c.arc(64, 64, r, 0, Math.PI * 2); c.stroke(); }
  c.strokeStyle = '#e8e3d6'; c.lineWidth = 2; c.beginPath(); c.arc(65, 65, 51, 0, Math.PI * 2); c.stroke();
  for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; c.fillStyle = '#797970'; c.fillRect(62 + Math.cos(a) * 49, 62 + Math.sin(a) * 49, 3, 3); }
  c.fillStyle = '#77796e'; c.beginPath(); c.moveTo(64, 31); c.lineTo(89, 63); c.lineTo(64, 96); c.lineTo(39, 63); c.closePath(); c.fill();
  c.strokeStyle = '#e4ddc9'; c.lineWidth = 3; c.stroke();
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; return texture;
}

export function createDeviceMaterials() {
  const m = (color: number, metalness = 0.55, roughness = 0.45, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, metalness, roughness, ...extra });
  return {
    paint: m(0x3c514d, 0.42, 0.65),
    meshGuard: m(0x64726d, 0.55, 0.7, { wireframe: true, transparent: true, opacity: 0.28 }),
    board: m(0x4c4942, 0.6, 0.62),
    pegGlow: new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
    metal: m(C.metal), metalLight: m(C.metalLight, 0.6, 0.35), dark: m(C.dark, 0.5, 0.6), darker: m(C.darker, 0.4, 0.7),
    yellow: m(C.yellow, 0.3, 0.5), floor: m(C.floor, 0, 0.95, { envMapIntensity: 0.15 }),
    orangeGlow: m(0x5a2a08, 0.2, 0.5, { emissive: C.orange, emissiveIntensity: 1.6 }),
    greenGlow: m(0x0f3a20, 0.2, 0.5, { emissive: C.green, emissiveIntensity: 1.3 }),
    amberEdge: m(0x5a3a05, 0.2, 0.4, { emissive: 0xffb020, emissiveIntensity: 1.4 }),
    glass: m(0xa8d0e6, 0.1, 0.1, { transparent: true, opacity: 0.09, depthWrite: false }),
    greenChute: m(0x53694a, 0.45, 0.6),
    orangeChute: m(0xa37a2e, 0.45, 0.6),
    peg: m(0xffffff, 0.6, 0.3), item: m(0xffffff, 0.15, 0.75, { flatShading: true }),
    token: m(0xffffff, 0.88, 0.3, { map: coinStamp() }), chunk: m(0xffffff, 0.55, 0.65, { flatShading: true }),
    glint: m(0x95b886, 0.7, 0.3, { emissive: 0x2f5030, emissiveIntensity: 0.15 }),
    selected: m(0xffffff, 0, 0.3, { emissive: 0xffffff, emissiveIntensity: 1.2 }),
  };
}

export type DeviceMaterials = ReturnType<typeof createDeviceMaterials>;
