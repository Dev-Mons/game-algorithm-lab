import type { DriverInput } from '../physics/vehicle';

// Treat less than 0.36 km/h as stopped so numerical residuals do not block reversing.
export const DIRECTION_CHANGE_SPEED = 0.1;
export const MANUAL_CONTROLS = 'W 전진 · S 제동 후 후진 · A / D 조향 · Space 사이드 브레이크 (Shift도 가능)';

/** Resolve driving intent on each physics step. Record the resolved input for replay. */
export function keyboardDriverInput(keys: ReadonlySet<string>, forwardSpeed: number): DriverInput {
  const held = (...codes: string[]) => codes.some(code => keys.has(code));
  const forward = held('KeyW', 'ArrowUp'), reverse = held('KeyS', 'ArrowDown');
  const direction = Number(forward) - Number(reverse);
  const braking = (forward && reverse) || direction * forwardSpeed < -DIRECTION_CHANGE_SPEED;
  return {
    throttle: braking ? 0 : direction,
    brake: Number(braking),
    steer: Number(held('KeyD', 'ArrowRight')) - Number(held('KeyA', 'ArrowLeft')),
    handbrake: held('Space', 'ShiftLeft', 'ShiftRight'),
  };
}
