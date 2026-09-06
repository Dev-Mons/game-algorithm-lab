import { describe, expect, it } from 'vitest';
import { frictionAtSpeed, presetConfig, validateConfig } from '../../src/physics/config';
import { Terrain } from '../../src/physics/terrain';
import { Vehicle, neutralInput } from '../../src/physics/vehicle';
import { Vec3 } from '../../src/physics/math';

describe('speed-dependent road friction', () => {
  const config = { ...presetConfig('balanced'), friction: 1.8, friction40: 4, friction80: 6, friction160: 8 };
  it('keeps all low speeds below two and interpolates high speeds continuously', () => {
    for (let kmh = 0; kmh <= 20; kmh += 0.25) expect(frictionAtSpeed(config, kmh / 3.6)).toBe(1.8);
    expect(frictionAtSpeed(config, 30 / 3.6)).toBeCloseTo(2.9);
    expect(frictionAtSpeed(config, 60 / 3.6)).toBeCloseTo(5);
    expect(frictionAtSpeed(config, 120 / 3.6)).toBeCloseTo(7);
    expect(frictionAtSpeed(config, 100)).toBe(8);
    expect(frictionAtSpeed(config, -20)).toBe(frictionAtSpeed(config, 20));
    expect(frictionAtSpeed({ ...config, topSpeed: 10 }, 20)).toBe(frictionAtSpeed({ ...config, topSpeed: 45 }, 20));
    for (const kmh of [20, 40, 80, 160]) expect(Math.abs(frictionAtSpeed(config, (kmh - 0.0001) / 3.6) - frictionAtSpeed(config, (kmh + 0.0001) / 3.6))).toBeLessThan(0.0001);
  });
  it('migrates a legacy constant into a flat curve and rejects invalid knots', () => {
    const old = validateConfig({ friction: 0.18 });
    for (const speed of [0, 5, 20, 50]) expect(frictionAtSpeed(old, speed)).toBe(0.18);
    for (const values of [{ friction: 2.1 }, { friction40: 8.1 }, { friction80: NaN }, { friction160: -1 }]) expect(() => validateConfig(values)).toThrow();
    expect(validateConfig(config)).toEqual(config);
  });
  it.each(['flat', 'ramp', 'bumps', 'playground'] as const)('uses the same speed curve and grounded force budget in %s', course => {
    const car = new Vehicle(new Terrain(course), config); car.body.position.z = 100; car.body.velocity.set(8, 0, 18);
    car.step({ ...neutralInput(), steer: 0.5 });
    expect(car.frictionCoefficient).toBeGreaterThan(2);
    for (const wheel of car.wheels) expect(Math.hypot(wheel.lateralForce.length(), wheel.driveForce.length())).toBeLessThanOrEqual(8 * wheel.load + 1e-6);
    car.body.position.y = 20; car.step({ ...neutralInput(), throttle: 1, steer: 1 });
    expect(car.groundedCount).toBe(0);
    for (const wheel of car.wheels) expect(wheel.load + wheel.lateralForce.length() + wheel.driveForce.length()).toBe(0);
  });
  it('strengthens high-speed direction changes without altering low-speed behavior', () => {
    const minicar = presetConfig('minicar');
    const flat = { ...minicar, friction40: minicar.friction, friction80: minicar.friction, friction160: minicar.friction };
    const run = (values: typeof minicar, speed: number) => {
      const car = new Vehicle(new Terrain('flat'), values); car.body.position.z = 100; car.body.velocity.z = speed;
      for (let i = 0; i < 60; i++) car.step({ ...neutralInput(), steer: 1 });
      return car;
    };
    expect(run(minicar, 5).snapshot()).toEqual(run(flat, 5).snapshot());
    const enhanced = run(minicar, 20), baseline = run(flat, 20);
    expect(Math.abs(enhanced.body.angularVelocity.y)).toBeGreaterThan(Math.abs(baseline.body.angularVelocity.y) * 1.05);
    expect(enhanced.body.orientation.rotate(new Vec3(0, 1, 0)).y).toBeGreaterThan(0.9);
  });
  it('keeps extreme high-speed friction finite and contact work bounded', () => {
    const car = new Vehicle(new Terrain('flat'), { ...presetConfig('minicar'), friction40: 8, friction80: 8, friction160: 8 });
    car.body.position.z = 100; car.body.velocity.z = 20;
    for (let i = 0; i < 960; i++) {
      car.step({ ...neutralInput(), throttle: 1, steer: Math.sin(car.time * 2) });
      expect(car.body.velocity.finite()).toBe(true); expect(car.body.momentum.finite()).toBe(true);
      expect(car.contactWork).toBeLessThanOrEqual(96); expect(car.maxPenetration).toBeLessThan(0.015);
    }
  });
});
