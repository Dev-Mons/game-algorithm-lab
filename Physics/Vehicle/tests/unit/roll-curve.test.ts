import { expect, it } from 'vitest';
import { presetConfig, rollAtSpeed, validateConfig } from '../../src/physics/config';
import { Vehicle, neutralInput } from '../../src/physics/vehicle';
import { Terrain } from '../../src/physics/terrain';
import { measureRollControl } from '../../src/lab/handling';

it('interpolates the roll curve continuously with a flat low-speed segment and fixed endpoints', () => {
  const config = presetConfig('minicar');
  for (const speed of [0, 5, 10, 20]) expect(rollAtSpeed(config, speed / 3.6)).toBe(1);
  expect(rollAtSpeed(config, 30 / 3.6)).toBeCloseTo(0.8);
  expect(rollAtSpeed(config, 60 / 3.6)).toBeCloseTo(0.45);
  expect(rollAtSpeed(config, 120 / 3.6)).toBeCloseTo(0.25);
  expect(rollAtSpeed(config, 200 / 3.6)).toBe(0.2);
  expect(rollAtSpeed(config, -20)).toBe(rollAtSpeed(config, 20));
  expect(rollAtSpeed({ ...config, topSpeed: 45 }, 20)).toBe(rollAtSpeed(config, 20));
  for (const kmh of [20, 40, 80, 160]) expect(Math.abs(rollAtSpeed(config, (kmh - 0.001) / 3.6) - rollAtSpeed(config, (kmh + 0.001) / 3.6))).toBeLessThan(0.0001);
});

it('migrates legacy roll settings to a flat curve and validates every point', () => {
  const old = validateConfig({ rollInfluence: 0.25 });
  for (const speed of [0, 10, 20, 50]) expect(rollAtSpeed(old, speed)).toBe(0.25);
  for (const key of ['rollInfluence40', 'rollInfluence80', 'rollInfluence160']) {
    for (const value of [-0.1, 1.1, NaN]) expect(() => validateConfig({ [key]: value })).toThrow();
  }
  const config = presetConfig('minicar'); expect(validateConfig(JSON.parse(JSON.stringify(config)))).toEqual(config);
});

it.each(['flat', 'ramp', 'bumps', 'playground'] as const)('uses the speed-based lateral lever arm in %s', course => {
  const car = new Vehicle(new Terrain(course), presetConfig('minicar')); car.body.position.z = 100;
  for (const kmh of [10, 60, 100]) {
    car.body.velocity.z = kmh / 3.6; car.refreshContacts();
    for (const wheel of car.wheels) expect(wheel.lateralForcePoint.clone().sub(wheel.anchor).length()).toBeCloseTo(wheel.length * car.rollCoefficient, 10);
  }
});

it('preserves low-speed dynamic behavior and completes the default slalom upright', () => {
  const config = presetConfig('minicar');
  const run = (flat: boolean) => {
    const car = new Vehicle(new Terrain('flat'), flat ? { ...config, rollInfluence40: 1, rollInfluence80: 1, rollInfluence160: 1 } : config);
    car.body.position.z = 100; car.body.velocity.z = 5;
    for (let i = 0; i < 60; i++) car.step({ ...neutralInput(), steer: 0.5 });
    return car.snapshot();
  };
  expect(run(false)).toEqual(run(true));
  const slalom = measureRollControl(config);
  expect(slalom.minUp).toBeGreaterThan(0.98); expect(slalom.airborne).toBe(0); expect(slalom.maxRollDegrees).toBeGreaterThan(0.5);
});
