import * as THREE from 'three';

export const C = {
  metal: 0x6a7176, metalLight: 0x9aa2a8, dark: 0x2b3034, darker: 0x1d2124, yellow: 0xe8b22a, orange: 0xff8a2a, green: 0x39d27a,
  floor: 0x34383b, ore: 0x8a6b4e, processed: 0x52d08a, byproduct: 0xff7a1f, steel: 0xc3cbd1, bundle2: 0xd9b56a, bundle3: 0xf2c24a, seed: 0x8fa8c8,
};

export function createDeviceMaterials() {
  const m = (color: number, metalness = 0.55, roughness = 0.45, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, metalness, roughness, ...extra });
  return {
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
}

export type DeviceMaterials = ReturnType<typeof createDeviceMaterials>;
