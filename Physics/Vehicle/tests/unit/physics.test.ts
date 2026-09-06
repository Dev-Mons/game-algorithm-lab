import { describe, expect, it } from 'vitest';
import { RigidBody } from '../../src/physics/body';
import { Quat, sampleCurve, Vec3 } from '../../src/physics/math';
import { defaultConfig, presetConfig, validateConfig } from '../../src/physics/config';
import { Terrain } from '../../src/physics/terrain';
import { FIXED_DT, neutralInput, Vehicle } from '../../src/physics/vehicle';
import { createExperiment, experimentInput, runExperiment } from '../../src/lab/experiments';
import { FixedClock } from '../../src/lab/clock';
import { measureHandling } from '../../src/lab/handling';

describe('rigid body and geometry', () => {
  it('conserves translation without forces and integrates force / mass', () => {
    const b = new RigidBody(2, new Vec3(1, 1, 1)); b.velocity.x = 3;
    b.integrate(0.5); expect(b.position.x).toBe(1.5); expect(b.velocity.x).toBe(3);
    b.addForce(new Vec3(4, 0, 0)); b.integrate(0.5); expect(b.velocity.x).toBe(4);
  });
  it('turns an off-center force into the expected angular momentum', () => {
    const b = new RigidBody(2, new Vec3(2, 2, 2)); b.position.set(0, 0, 0);
    b.addForce(new Vec3(0, 0, 10), new Vec3(1, 0, 0)); b.integrate(0.1);
    expect(b.momentum.y).toBeCloseTo(-1); expect(b.angularVelocity.y).toBeCloseTo(-0.5);
    expect(Math.hypot(b.orientation.x, b.orientation.y, b.orientation.z, b.orientation.w)).toBeCloseTo(1);
  });
  it('casts onto the actual ramp plane', () => {
    const hit = new Terrain('ramp').raycast(new Vec3(0, 5, 24), new Vec3(0, -1, 0), 10)!;
    expect(hit.point.y).toBeCloseTo(1.5); expect(hit.normal.z).toBeLessThan(0);
  });
  it('interpolates curves and rejects malformed saved configurations', () => {
    expect(sampleCurve([[0, 0], [1, 10]], 0.25)).toBe(2.5);
    expect(() => validateConfig({ mass: 0 })).toThrow();
    expect(() => validateConfig({ frontGrip: NaN })).toThrow();
  });
});
describe('video acceptance behaviors', () => {
  it('initializes resting wheel contact without advancing simulation time', () => {
    for (const preset of ['balanced', 'bounce', 'drift', 'minicar']) {
      const car = createExperiment('manual', presetConfig(preset));
      expect(car.stepIndex).toBe(0); expect(car.groundedCount).toBe(4);
      for (const wheel of car.wheels) expect(wheel.anchor.y - wheel.length).toBeCloseTo(0.32);
    }
    expect(createExperiment('drop', presetConfig('balanced')).groundedCount).toBe(0);
  });
  it('supports its weight with four damped springs after a drop', () => {
    const car = createExperiment('drop', { ...defaultConfig });
    for (let i = 0; i < 720; i++) car.step();
    const expectedHeight = defaultConfig.restLength + 0.32 - defaultConfig.mass * 9.81 / (4 * defaultConfig.spring);
    expect(car.body.position.y).toBeCloseTo(expectedHeight, 2);
    expect(car.groundedCount).toBe(4); expect(car.speed).toBeLessThan(0.01);
    expect(car.wheels.reduce((sum, w) => sum + w.load, 0)).toBeCloseTo(defaultConfig.mass * 9.81, 0);
  });
  it('applies no suspension, steering, or drive forces in the air', () => {
    const car = new Vehicle(new Terrain('flat')); car.body.position.y = 20;
    car.step({ throttle: 1, brake: 1, steer: 1, handbrake: true });
    expect(car.groundedCount).toBe(0); expect(car.body.velocity.z).toBe(0);
    for (const w of car.wheels) expect(w.load + w.lateralForce.length() + w.driveForce.length()).toBe(0);
    expect(car.body.velocity.y).toBeLessThan(0);
  });
  it('accelerates to a bounded speed and brakes without reversing', () => {
    const result = runExperiment('braking');
    expect(result.maxSpeed).toBeGreaterThan(50); expect(result.stopDistance).toBeGreaterThan(5);
    expect(result.final.speed).toBeLessThan(0.1); expect(result.final.forwardSpeed).toBeGreaterThan(-0.01);
    const accel = runExperiment('acceleration');
    expect(accel.final.forwardSpeed).toBeGreaterThan(20); expect(accel.final.forwardSpeed).toBeLessThan(defaultConfig.topSpeed + 0.1);
  });
  it('brings the minicar near its target quickly without bypassing tire physics', () => {
    const config = presetConfig('minicar'), acceleration = runExperiment('acceleration', config);
    expect(acceleration.secondsTo90).not.toBeNull(); expect(acceleration.secondsTo90!).toBeLessThan(1.5);
    expect(acceleration.secondsTo95).not.toBeNull(); expect(acceleration.secondsTo95!).toBeLessThan(1.8);
    expect(acceleration.final.forwardSpeed).toBeLessThanOrEqual(config.topSpeed);
    const ice = runExperiment('acceleration', { ...config, friction: 0.18, friction40: 0.18, friction80: 0.18, friction160: 0.18 });
    expect(ice.secondsTo90 ?? Infinity).toBeGreaterThan(acceleration.secondsTo90! * 3);
    for (const id of ['braking', 'slalom', 'jump', 'bumps'] as const) {
      const result = runExperiment(id, config);
      expect(result.finite).toBe(true); expect(result.maxPenetration).toBeLessThan(0.015);
      expect(result.maxWork).toBeLessThanOrEqual(96);
      if (id === 'braking') expect(result.final.speed).toBeLessThan(0.1);
      if (id === 'slalom') expect(result.airborne).toBe(0);
    }
  });
  it('has longer stopping distance on ice', () => {
    const stop = (preset: string) => {
      const car = new Vehicle(new Terrain('flat'), presetConfig(preset)); car.body.position.z = 100; car.body.velocity.z = 15;
      for (let i = 0; i < 1800 && car.speed > 0.1; i++) car.step({ ...neutralInput(), brake: 1 });
      return car.body.position.z - 100;
    };
    expect(stop('ice')).toBeGreaterThan(stop('balanced') * 3);
  });
  it('steers left and right symmetrically using point forces', () => {
    const cars = [-1, 1].map(sign => {
      const car = new Vehicle(new Terrain('flat'));
      for (let i = 0; i < 600; i++) car.step({ ...neutralInput(), throttle: 0.4, steer: i > 120 ? sign * 0.4 : 0 });
      return car;
    });
    // From behind a +Z-facing vehicle, right is world -X.
    expect(cars[1].body.position.x).toBeLessThan(-3);
    expect(cars[0].body.position.x).toBeCloseTo(-cars[1].body.position.x, 5);
    expect(cars[0].body.position.z).toBeCloseTo(cars[1].body.position.z, 5);
  });
  it('lets the drift preset slide, then recovers after releasing steering without a spin', () => {
    const balanced = measureHandling(), drift = measureHandling(presetConfig('drift'));
    expect(drift.peakSlip).toBeGreaterThan(balanced.peakSlip * 1.5);
    expect(drift.peakSlip).toBeLessThan(0.5);
    expect(drift.totalYaw).toBeLessThan(Math.PI / 2);
    expect(drift.peakYawRate).toBeLessThan(1.2);
    expect(drift.minForwardSpeed).toBeGreaterThan(0);
    expect(drift.finalSlip).toBeLessThan(0.02); expect(drift.finalYawRate).toBeLessThan(0.05);
    const left = measureHandling(presetConfig('drift'), -1);
    expect(left.peakSlip).toBeCloseTo(drift.peakSlip, 5);
    expect(left.totalYaw).toBeCloseTo(drift.totalYaw, 5);
  });
  it.each(['flat', 'ramp', 'bumps', 'playground'] as const)('leans outward with differential spring compression in %s', course => {
    const turn = (sign: number) => {
      const car = new Vehicle(new Terrain(course)); car.body.position.z = 100; car.body.velocity.z = 12;
      for (let i = 0; i < 120; i++) car.step({ ...neutralInput(), steer: 0.45 * sign, throttle: 0.25 });
      return car;
    };
    const right = turn(1), left = turn(-1);
    const up = right.body.orientation.rotate(new Vec3(0, 1, 0));
    const localUp = right.body.orientation.inverseRotate(new Vec3(0, 1, 0));
    // Right turn loads the left/outside springs and raises the right/inside springs.
    expect(Math.atan2(localUp.x, localUp.y)).toBeLessThan(-0.015);
    expect(right.wheels[0].compression).toBeGreaterThan(right.wheels[1].compression + 0.02);
    expect(right.wheels[0].load).toBeGreaterThan(right.wheels[1].load + 500);
    expect(right.wheels[0].suspensionForce.clone().unit().dot(up)).toBeGreaterThan(0.999);
    expect(Math.abs(right.wheels[0].suspensionForce.clone().unit().y)).toBeLessThan(0.9999);
    expect(left.wheels[1].load).toBeCloseTo(right.wheels[0].load, 4);
    expect(right.body.velocity.finite()).toBe(true); expect(right.maxPenetration).toBeLessThan(0.015);
    for (let i = 0; i < 480; i++) right.step({ ...neutralInput(), brake: 1 });
    expect(Math.abs(right.body.orientation.inverseRotate(new Vec3(0, 1, 0)).x)).toBeLessThan(0.005);
  });
  it.each([-1, 1])('recovers with full keyboard throttle after a full steering pulse (%s)', sign => {
    const result = measureHandling(presetConfig('drift'), sign, 'flat', 'keyboard');
    expect(result.peakSlip).toBeLessThan(0.3); expect(result.totalYaw).toBeLessThan(Math.PI / 2);
    expect(result.minForwardSpeed).toBeGreaterThanOrEqual(-0.01);
    expect(result.finalSlip).toBeLessThan(0.02); expect(result.finalYawRate).toBeLessThan(0.05);
  });
  it('jumps, lands, and remains finite over ramps and uneven ground', () => {
    const jump = runExperiment('jump'), bumps = runExperiment('bumps');
    expect(jump.maxHeight).toBeGreaterThan(3); expect(jump.airborne).toBeGreaterThan(0.25);
    expect(jump.final.grounded).toBe(4);
    for (const r of [jump, bumps]) { expect(r.finite).toBe(true); expect(r.maxPenetration).toBeLessThan(0.015); expect(r.maxWork).toBeLessThanOrEqual(96); }
    expect(Math.max(...bumps.rows.map(r => Math.abs(r.fl - r.fr)))).toBeGreaterThan(500);
  });
  it('supports reverse and stationary brakes', () => {
    const car = new Vehicle(new Terrain('flat')); car.body.position.z = 100;
    for (let i = 0; i < 300; i++) car.step({ ...neutralInput(), throttle: -0.5 });
    expect(car.forwardSpeed).toBeLessThan(-2);
    const parked = new Vehicle(new Terrain('flat'));
    for (let i = 0; i < 300; i++) parked.step({ ...neutralInput(), brake: 1 });
    expect(parked.body.position.z).toBe(0);
  });
  it('handles chassis wall impacts and an overturned drop with bounded work', () => {
    const car = new Vehicle(new Terrain('flat')); car.body.velocity.z = -25;
    for (let i = 0; i < 240; i++) car.step();
    expect(car.body.position.z).toBeGreaterThan(-13); expect(car.maxPenetration).toBeLessThan(0.015);
    car.body.position.set(30, 3, 0); car.body.orientation = new Quat(0, 0, 1, 0);
    for (let i = 0; i < 720; i++) car.step();
    expect(car.body.position.finite()).toBe(true); expect(car.penetration()).toBeLessThan(0.015);
  });
  it('repeats identical inputs exactly across render frame rates', () => {
    const run = (fps: number) => {
      const car = new Vehicle(new Terrain('flat')), clock = new FixedClock();
      for (let frame = 0; frame < fps * 3; frame++) clock.advance(1 / fps, () => car.step(experimentInput('slalom', car.time)));
      return car.snapshot();
    };
    expect(run(30)).toEqual(run(144)); expect(run(60)).toEqual(run(144));
    const clock = new FixedClock(); let count = 0; clock.advance(10, () => count++);
    expect(count).toBeLessThanOrEqual(12); expect(clock.droppedTime).toBeCloseTo(9.9);
    expect(FIXED_DT).toBe(1 / 120);
  });
});
