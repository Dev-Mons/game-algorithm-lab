import { presetConfig, type VehicleConfig } from '../physics/config';
import { Terrain, type CourseId } from '../physics/terrain';
import { Vehicle, FIXED_DT, neutralInput, type DriverInput } from '../physics/vehicle';
import { MANUAL_CONTROLS } from './keyboard-input';
export type ExperimentId = 'manual' | 'acceleration' | 'braking' | 'circle' | 'slalom' | 'drop' | 'jump' | 'bumps';
export const experiments: Record<ExperimentId, { name: string; duration: number; course: CourseId; description: string }> = {
  manual: { name: '직접 운전', duration: 0, course: 'playground', description: MANUAL_CONTROLS },
  acceleration: { name: '직진 가속', duration: 15, course: 'flat', description: '15초 동안 전속 가속. 출력 곡선과 최고속도를 확인합니다.' },
  braking: { name: '제동 거리', duration: 12, course: 'flat', description: '정지 상태에서 6초 가속 후 제동합니다.' },
  circle: { name: '원선회', duration: 16, course: 'flat', description: '일정한 가속과 조향으로 선회 궤적을 비교합니다.' },
  slalom: { name: '슬라럼', duration: 16, course: 'flat', description: '동일한 좌우 조향 입력으로 접지 반응을 비교합니다.' },
  drop: { name: '서스펜션 낙하', duration: 6, course: 'flat', description: '차체를 1m 위에서 놓아 감쇠와 접지 회복을 관찰합니다.' },
  jump: { name: '점프와 착지', duration: 12, course: 'ramp', description: '경사로를 통과하며 이륙·공중 이동·재접지를 측정합니다.' },
  bumps: { name: '요철 통과', duration: 12, course: 'bumps', description: '엇갈린 요철을 지나며 네 바퀴 하중과 차체 기울기를 측정합니다.' },
};
export function experimentInput(id: ExperimentId, time: number): DriverInput {
  const input = neutralInput();
  if (id === 'acceleration') input.throttle = 1;
  if (id === 'braking') { input.throttle = time < 6 ? 1 : 0; input.brake = time >= 6 ? 1 : 0; }
  if (id === 'circle') { input.throttle = time < 2 ? 0.5 : 0.22; input.steer = time > 2 ? 0.42 : 0; }
  if (id === 'slalom') { input.throttle = 0.38; input.steer = time > 2 ? Math.sin((time - 2) * 1.3) * 0.55 : 0; }
  if (id === 'jump') input.throttle = time < 8 ? 0.8 : 0;
  if (id === 'bumps') input.throttle = time < 9 ? 0.32 : 0;
  return input;
}
export function createExperiment(id: ExperimentId, config: VehicleConfig, course?: CourseId) {
  const car = new Vehicle(new Terrain(course ?? experiments[id].course), config);
  if (id === 'drop') car.body.position.y += 1;
  car.refreshContacts(); car.previousPosition = car.body.position.clone();
  return car;
}
export interface Telemetry {
  time: number; speed: number; height: number; slip: number; grounded: number;
  x: number; z: number; yawRate: number; fl: number; fr: number; rl: number; rr: number;
  friction: number; rollInfluence: number;
}
export function telemetry(car: Vehicle): Telemetry {
  return { time: car.time, speed: car.speed * 3.6, height: car.body.position.y, slip: car.slip,
    grounded: car.groundedCount, x: car.body.position.x, z: car.body.position.z,
    yawRate: car.body.angularVelocity.y, fl: car.wheels[0].load, fr: car.wheels[1].load, rl: car.wheels[2].load, rr: car.wheels[3].load, friction: car.frictionCoefficient, rollInfluence: car.rollCoefficient };
}
export function csv(rows: Telemetry[]) {
  const keys: (keyof Telemetry)[] = ['time', 'speed', 'height', 'slip', 'grounded', 'x', 'z', 'yawRate', 'fl', 'fr', 'rl', 'rr', 'friction', 'rollInfluence'];
  return 'time_s,speed_kmh,height_m,slip_ratio,grounded_wheels,x_m,z_m,yaw_rad_s,FL_N,FR_N,RL_N,RR_N,friction_mu,roll_influence\n' + rows.map(r => keys.map(k => r[k].toFixed(5)).join(',')).join('\n');
}
export function runExperiment(id: Exclude<ExperimentId, 'manual'>, config = presetConfig('balanced')) {
  const car = createExperiment(id, config), rows: Telemetry[] = [];
  let maxSpeed = 0, maxHeight = 0, airborne = 0, maxPenetration = 0, maxWork = 0, finite = true;
  let brakeStart: number | null = null, stopDistance: number | null = null;
  let secondsTo90: number | null = null, secondsTo95: number | null = null;
  for (let i = 0; i < Math.round(experiments[id].duration / FIXED_DT); i++) {
    const input = experimentInput(id, car.time);
    if (input.brake && brakeStart === null) brakeStart = car.distance;
    car.step(input);
    if (id === 'acceleration' && secondsTo90 === null && car.forwardSpeed >= config.topSpeed * 0.9) secondsTo90 = car.time;
    if (id === 'acceleration' && secondsTo95 === null && car.forwardSpeed >= config.topSpeed * 0.95) secondsTo95 = car.time;
    if (brakeStart !== null && car.speed < 0.1 && stopDistance === null) stopDistance = car.distance - brakeStart;
    maxSpeed = Math.max(maxSpeed, car.speed * 3.6); maxHeight = Math.max(maxHeight, car.body.position.y);
    if (car.groundedCount === 0) airborne += FIXED_DT;
    maxPenetration = Math.max(maxPenetration, car.maxPenetration); maxWork = Math.max(maxWork, car.contactWork);
    finite &&= car.body.position.finite() && car.body.velocity.finite() && car.body.momentum.finite();
    if (i % 6 === 0) rows.push(telemetry(car));
  }
  return { id, maxSpeed, maxHeight, airborne, stopDistance, secondsTo90, secondsTo95, maxPenetration, maxWork, finite, final: car.snapshot(), rows };
}
