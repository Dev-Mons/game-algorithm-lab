import { describe, expect, it } from 'vitest';
import { Simulation } from '../../src/lab/simulation';
import { createScenario } from '../../src/lab/scenario';
import { byproductPoint, cargoOffset, processorPaths, RAW_ENTRY_V } from '../../src/lab/device-layout';
import { PLACEMENTS, type PlacementId } from '../../src/core/frame';
import type { TokenSpawn } from '../../src/physics/contracts';

const advance = (sim: Simulation, seconds: number) => { for (let i = 0; i < seconds * 60; i++) sim.step(); sim.sync(); };

describe('connected material transport', () => {
  it.each(['custom', 'rapier2d'] as const)('%s: the same raw body falls from inside the hopper through the open board inlet', async plinko => {
    const s = createScenario('empty'); s.backends = { plinko, pusher: 'custom-stack' };
    const sim = await Simulation.create(s);
    try {
      sim.addRaw(1); advance(sim, 0.35);
      expect(sim.plinkoSnap.count).toBe(1);
      const id = sim.plinkoSnap.ids[0];
      expect(sim.plinkoSnap.b[0]).toBeGreaterThan(RAW_ENTRY_V);
      expect(sim.plinkoSnap.b[0]).toBeLessThan(0);
      advance(sim, 0.5);
      expect(sim.plinkoSnap.ids[0]).toBe(id);
      expect(sim.plinkoSnap.b[0]).toBeGreaterThan(0);
      expect(sim.core.stats.lostItems).toBe(0);
    } finally { sim.dispose(); }
  });

  it('loads, stamps, retracts, then releases value-one coins directly from the die pose', async () => {
    const s = createScenario('empty'); s.backends = { plinko: 'rapier2d', pusher: 'rapier3d-stacked' };
    const sim = await Simulation.create(s);
    try {
      const spawns: TokenSpawn[] = [], spawn = sim.pusher.spawn.bind(sim.pusher), phases = new Set<string>();
      sim.pusher.spawn = t => {
        expect(sim.core.pressPhase).toBe('releasing');
        expect(sim.discharge.progress).toBe(1);
        const index = spawns.filter(p => p.id < t.id && sim.core.tray.get(p.id)?.createdAt === sim.core.tray.get(t.id)?.createdAt).length;
        const displayed = sim.diePosition(index);
        expect(t.x).toBeCloseTo(displayed.x, 8); expect(t.y).toBeCloseTo(displayed.y, 8);
        expect(t.z).toBeCloseTo(displayed.z - sim.device.trayZ0, 8); expect(t.vy).toBe(0);
        spawns.push({ ...t }); spawn(t);
      };
      sim.addRaw(20);
      for (let i = 0; i < 60 * 35; i++) { sim.step(); phases.add(sim.core.pressPhase); }
      expect([...phases]).toEqual(expect.arrayContaining(['loading', 'pressing', 'retracting', 'ready', 'releasing']));
      expect(spawns.length).toBeGreaterThan(12); expect(sim.batchStats.largestDump).toBeGreaterThanOrEqual(6);
      expect(sim.core.stats.seedPlaced).toBe(0); expect(sim.core.stats.lostTokens).toBe(0);
      expect(sim.core.conservationError()).toEqual({ produced: 0, seed: 0, raw: 0 });
    } finally { sim.dispose(); }
  }, 30000);

  it('a tall real pile holds coins in the fixed die and blocks the next stamp until clear', async () => {
    const s = createScenario('empty'); s.backends = { plinko: 'custom', pusher: 'custom-stack' };
    const sim = await Simulation.create(s);
    try {
      const x = cargoOffset(sim.device, 0).x;
      for (const [i, token] of sim.core.placeSeed(26).entries()) sim.pusher.spawn({ id: token.id, x, y: 0.9 + s.tray.tokenHalfHeight + i * 2 * s.tray.tokenHalfHeight, z: sim.device.feedZ, radius: s.tray.tokenRadius, halfHeight: s.tray.tokenHalfHeight });
      const step = sim.pusher.step.bind(sim.pusher); sim.pusher.step = () => {};
      sim.addRaw(24); advance(sim, 35);
      expect(sim.discharge.blocked).toBe(true); expect(sim.core.pressPhase).toBe('ready');
      const held = sim.diePosition(0), made = sim.core.stats.tokensMade;
      advance(sim, 1); expect(sim.diePosition(0)).toEqual(held); expect(sim.core.stats.tokensMade).toBe(made);
      expect(sim.gateStats.fed).toBe(0); expect(sim.core.compressorBuffer).toBeGreaterThan(0);
      expect(sim.core.ledger.main).toBeGreaterThan(0);
      expect(sim.core.conservationError()).toEqual({ produced: 0, seed: 0, raw: 0 });
      for (const id of [...sim.core.tray.keys()]) { sim.pusher.remove(id); sim.core.onTokenLost(id); }
      sim.pusher.step = step; advance(sim, 5);
      expect(sim.gateStats.fed).toBeGreaterThan(0);
      expect(sim.core.conservationError()).toEqual({ produced: 0, seed: 0, raw: 0 });
    } finally { sim.dispose(); }
  });

  it('hidden settlement resets the discharge guide and normal pressing resumes', async () => {
    const s = createScenario('empty'); s.backends = { plinko: 'custom', pusher: 'custom-stack' };
    const sim = await Simulation.create(s);
    try {
      sim.addRaw(20);
      for (let i = 0; i < 1800 && sim.discharge.progress === 0; i++) sim.step();
      expect(sim.discharge.progress).toBeGreaterThan(0);
      const fed = sim.gateStats.fed;
      sim.settleElapsed(90); expect(sim.discharge.progress).toBe(0);
      sim.addRaw(20); advance(sim, 35);
      expect(sim.gateStats.fed).toBeGreaterThan(fed);
      expect(sim.core.stats.duplicateExits).toBe(0);
      expect(sim.core.conservationError()).toEqual({ produced: 0, seed: 0, raw: 0 });
    } finally { sim.dispose(); }
  });

  it('all board placements keep the open scrap throat descending above the parked ram', async () => {
    const s = createScenario('empty'); s.backends = { plinko: 'custom', pusher: 'custom-stack' };
    const sim = await Simulation.create(s);
    try {
      for (const id of Object.keys(PLACEMENTS) as PlacementId[]) {
        sim.setPlacement(id);
        const paths = processorPaths(s.board, sim.frame, sim.device);
        for (const points of [paths.main, paths.by]) {
          expect(points.at(-1)!.y).toBeLessThan(points[0].y);
          expect(points.every(p => Number.isFinite(p.x + p.y + p.z))).toBe(true);
        }
        for (const col of [0, sim.device.cargoColumns - 1]) {
          const offset = cargoOffset(sim.device, col).x;
          const top = byproductPoint(s.board, sim.frame, sim.device, 0, offset);
          const bottom = byproductPoint(s.board, sim.frame, sim.device, 1, offset);
          expect(top.y).toBeGreaterThan(bottom.y + 0.2);
          expect(bottom.y).toBeGreaterThan(sim.device.pressTop + 0.2);
          expect(Math.abs(offset) + s.tray.tokenRadius).toBeLessThan(sim.device.passageWidth / 2);
        }
      }
    } finally { sim.dispose(); }
  });
  it.each(['custom-stack', 'rapier3d-stacked', 'rapier3d-planar', 'custom'] as const)('%s: normal production from empty reaches a paid exit without recovery or seed tokens', async pusher => {
    const s = createScenario('basic'); s.initialTokens = 0; s.backends = { plinko: 'rapier2d', pusher };
    const sim = await Simulation.create(s);
    try {
      for (let i = 0; i < 600 * 60 && sim.core.ledger.bonusProduced === 0; i++) sim.step();
      expect(sim.core.ledger.bonusProduced).toBeGreaterThan(0);
      expect(sim.core.stats.seedPlaced).toBe(0); expect(sim.core.stats.lostTokens).toBe(0);
      expect(sim.core.stats.duplicateArrivals + sim.core.stats.duplicateExits).toBe(0);
      expect(sim.core.conservationError()).toEqual({ produced: 0, seed: 0, raw: 0 });
    } finally { sim.dispose(); }
  }, 30000);

});
