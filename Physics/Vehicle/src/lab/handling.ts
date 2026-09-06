import { presetConfig, type VehicleConfig } from '../physics/config';
import { Vec3 } from '../physics/math';
import { Terrain, type CourseId } from '../physics/terrain';
import { Vehicle, FIXED_DT, neutralInput } from '../physics/vehicle';
import { createExperiment, experimentInput } from './experiments';

/** A brief steering command then release; detects continued spinning, not just grip loss. */
export function measureHandling(config: VehicleConfig = presetConfig('balanced'), sign = 1, course: CourseId = 'flat', profile: 'pulse' | 'keyboard' = 'pulse') {
  const car = new Vehicle(new Terrain(course), config);
  // Flat run-out is shared by all courses; no solver or map-dependent behavior.
  car.body.position.z = 100; car.body.velocity.z = profile === 'keyboard' ? 0 : 12;
  let peakSlip = 0, totalYaw = 0, peakYawRate = 0, peakRoll = 0, peakLoadDifference = 0;
  let minForwardSpeed = car.forwardSpeed, maxPenetration = 0;
  for (let i = 0; i < 960; i++) {
    const time = car.time;
    const throttle = profile === 'keyboard' ? 1 : time < 3 ? 0.45 : 0.1;
    const steer = profile === 'keyboard' ? (time >= 3 && time < 4 ? sign : 0) : (time >= 1 && time < 2 ? sign * 0.55 : 0);
    car.step({ ...neutralInput(), throttle, steer });
    const up = car.body.orientation.inverseRotate(new Vec3(0, 1, 0));
    peakSlip = Math.max(peakSlip, car.slip);
    const yaw = Math.abs(car.body.angularVelocity.y);
    totalYaw += yaw * FIXED_DT; peakYawRate = Math.max(peakYawRate, yaw);
    peakRoll = Math.max(peakRoll, Math.abs(Math.atan2(up.x, up.y)));
    peakLoadDifference = Math.max(peakLoadDifference, Math.abs(car.wheels[0].load - car.wheels[1].load));
    minForwardSpeed = Math.min(minForwardSpeed, car.forwardSpeed);
    maxPenetration = Math.max(maxPenetration, car.maxPenetration);
  }
  return { peakSlip, totalYaw, peakYawRate, peakRoll, peakLoadDifference, minForwardSpeed, maxPenetration,
    finalSlip: car.slip, finalYawRate: Math.abs(car.body.angularVelocity.y) };
}

/** Same high-grip slalom for measuring the lateral force lever arm. */
export function measureRollControl(config: VehicleConfig) {
  const car = createExperiment('slalom', config);
  let maxRoll = 0, minUp = 1, airborne = 0, maxPenetration = 0, maxWork = 0;
  for (let i = 0; i < 1920; i++) {
    car.step(experimentInput('slalom', car.time));
    const up = car.body.orientation.inverseRotate(new Vec3(0, 1, 0));
    maxRoll = Math.max(maxRoll, Math.abs(Math.atan2(up.x, up.y)));
    minUp = Math.min(minUp, up.y);
    if (car.groundedCount === 0) airborne += FIXED_DT;
    maxPenetration = Math.max(maxPenetration, car.maxPenetration); maxWork = Math.max(maxWork, car.contactWork);
  }
  return { maxRollDegrees: maxRoll * 180 / Math.PI, minUp, airborne, maxPenetration, maxWork, finite: car.body.position.finite() && car.body.velocity.finite() && car.body.momentum.finite() };
}
