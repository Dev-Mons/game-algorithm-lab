import { expect, it } from 'vitest';
import { presetConfig, validateConfig } from '../../src/physics/config';
import { Vehicle, neutralInput } from '../../src/physics/vehicle';
import { Terrain } from '../../src/physics/terrain';
import { Vec3, Quat } from '../../src/physics/math';
import { measureRollControl } from '../../src/lab/handling';
import { runExperiment } from '../../src/lab/experiments';
const flatRoll = (value: number) => ({ rollInfluence: value, rollInfluence40: value, rollInfluence80: value, rollInfluence160: value });

it.each([3, 4, 8])('reduces high-grip rollover while retaining visible lean at friction %s', friction80 => {
  const values = { ...presetConfig('minicar'), friction40: 2, friction80, friction160: friction80 };
  const original = measureRollControl({ ...values, ...flatRoll(1) });
  const tuned = measureRollControl({ ...values, ...flatRoll(0.25) });
  expect(original.minUp).toBeLessThan(0);
  expect(tuned.minUp).toBeGreaterThan(0.98); expect(tuned.airborne).toBe(0);
  expect(tuned.maxRollDegrees).toBeGreaterThan(0.5); expect(tuned.maxRollDegrees).toBeLessThan(3);
  expect(tuned.finite).toBe(true); expect(tuned.maxPenetration).toBeLessThan(0.015); expect(tuned.maxWork).toBeLessThanOrEqual(96);
});

it('preserves straight-line acceleration, braking and pitch when changing roll influence', () => {
  for (const id of ['acceleration', 'braking'] as const) {
    const full = runExperiment(id, { ...presetConfig('minicar'), ...flatRoll(1) });
    const low = runExperiment(id, { ...presetConfig('minicar'), ...flatRoll(0) });
    const errors = low.rows.flatMap((row, i) => (Object.keys(row) as (keyof typeof row)[]).filter(key => key !== 'rollInfluence').map(key => Math.abs(row[key] - full.rows[i][key])));
    expect(Math.max(...errors)).toBeLessThan(1e-8);
    expect(low.final.position.y).toBeCloseTo(full.final.position.y, 10);
    expect(low.final.orientation.x).toBeCloseTo(full.final.orientation.x, 10);
  }
});

it.each(['flat', 'ramp', 'bumps', 'playground'] as const)('keeps lateral friction dissipative and applies roll control through forces in %s', course => {
  const car = new Vehicle(new Terrain(course), { ...presetConfig('minicar'), ...flatRoll(0.25) });
  car.body.position.z = 100; car.body.velocity.set(2, 0, 12);
  car.step({ ...neutralInput(), steer: 0.2 });
  for (const wheel of car.wheels) {
    const arm = wheel.lateralForcePoint.clone().sub(wheel.anchor);
    expect(arm.length()).toBeCloseTo(wheel.length * 0.25, 8);
    // Small integration error is possible when inspecting the final pose; the force opposes lateral motion.
    expect(wheel.lateralForce.dot(car.body.pointVelocity(wheel.lateralForcePoint))).toBeLessThanOrEqual(0.01);
  }
});

it('does not freeze airborne orientation or add an upright constraint', () => {
  const car = new Vehicle(new Terrain('flat'), { ...presetConfig('minicar'), ...flatRoll(0) });
  car.body.position.y = 30; car.body.orientation = new Quat(0, 0, Math.sin(0.3), Math.cos(0.3));
  const before = car.body.orientation.clone();
  for (let i = 0; i < 30; i++) car.step({ ...neutralInput(), throttle: 1, steer: 1 });
  expect(car.groundedCount).toBe(0);
  for (const key of ['x', 'y', 'z', 'w'] as const) expect(car.body.orientation[key]).toBeCloseTo(before[key], 12);
  car.body.momentum.z = 100; car.step();
  expect(car.body.orientation.rotate(new Vec3(0, 1, 0)).x).not.toBe(before.rotate(new Vec3(0, 1, 0)).x);
});

it('loads old settings with the original roll behavior and rejects out-of-range values', () => {
  expect(validateConfig({ mass: 600 }).rollInfluence).toBe(1);
  expect(() => validateConfig({ rollInfluence: -0.1 })).toThrow();
  expect(() => validateConfig({ rollInfluence: 1.1 })).toThrow();
});
