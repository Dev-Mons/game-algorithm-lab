import { SeededRandom } from '../../../src/core/random';
import type { ParticleScene, SceneName } from './types';

/** Generated once by the runner and serialized before either candidate runs. */
export function createScene(name: SceneName, seed = 42): ParticleScene {
  const random = new SeededRandom(seed);
  const support = {minX: 8, minY: 8, maxX: 32, maxY: 32};
  const scene: ParticleScene = {
    version: 1, name, seed, diameter: 1, speed: 5, duration: 12,
    support, world: {minX: 0, minY: 0, maxX: 120, maxY: 40},
    repairRegion: name === 'crack'
      ? {minX: 12, maxX: 28, minY: 16, maxY: 32}
      : {x: 20, y: 20, radius: 8},
    disks: [], removedCount: 0,
  };
  // Hexagonal lattice at area occupancy 0.72; jitter stays below the legal gap.
  const spacing = Math.sqrt(Math.PI / (2*Math.sqrt(3)*.72));
  const dy = spacing*Math.sqrt(3)/2;
  let row = 0;
  for (let y = support.minY+.55; y <= support.maxY-.55; y += dy, row++) {
    for (let x = support.minX+.55+(row%2)*spacing/2; x <= support.maxX-.55; x += spacing) {
      const px = x+random.range(-.015,.015), py = y+random.range(-.015,.015);
      // Remove intersecting disks, so the requested defect is physically empty.
      const hole = Math.hypot(px-20,py-20) < 2.5;
      const crack = Math.hypot(Math.max(0,Math.abs(px-20)-.75), Math.max(0,22-py)) < .5;
      if ((name === 'hole' && hole) || (name === 'crack' && crack)) {
        scene.removedCount++; continue;
      }
      scene.disks.push({id: scene.disks.length, x: px, y: py, radius: .5});
    }
  }
  validateScene(scene);
  return scene;
}

export function validateScene(scene: ParticleScene): void {
  if (scene.version !== 1 || !scene.disks.length || !Number.isFinite(scene.speed)
    || scene.speed < 0 || scene.duration <= 0) throw new Error('Invalid particle fixture');
  const ids = new Set<number>();
  for (let i = 0; i < scene.disks.length; i++) {
    const a = scene.disks[i]!;
    if (![a.x,a.y,a.radius,a.id].every(Number.isFinite) || a.radius <= 0 || ids.has(a.id)) {
      throw new Error(`Invalid disk ${i}`);
    }
    ids.add(a.id);
    const w = scene.world;
    if (a.x-a.radius < w.minX || a.x+a.radius > w.maxX
      || a.y-a.radius < w.minY || a.y+a.radius > w.maxY) throw new Error(`Disk ${i} outside world`);
    for (let j = 0; j < i; j++) {
      const b = scene.disks[j]!;
      if (Math.hypot(a.x-b.x,a.y-b.y) < a.radius+b.radius-1e-10) {
        throw new Error(`Overlapping spawn: ${i}, ${j}`);
      }
    }
  }
}
