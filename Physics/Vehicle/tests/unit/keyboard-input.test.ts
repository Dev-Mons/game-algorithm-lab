import { expect, it } from 'vitest';
import { keyboardDriverInput, DIRECTION_CHANGE_SPEED } from '../../src/lab/keyboard-input';
import { Vehicle, type DriverInput } from '../../src/physics/vehicle';
import { Terrain } from '../../src/physics/terrain';
import { presetConfig } from '../../src/physics/config';

it('uses Space for the independent rear handbrake and retains Shift as an alias', () => {
  expect(keyboardDriverInput(new Set(['Space']), 10)).toEqual({ throttle: 0, brake: 0, steer: 0, handbrake: true });
  expect(keyboardDriverInput(new Set(['ShiftLeft']), 10)).toEqual(keyboardDriverInput(new Set(['Space']), 10));
  expect(keyboardDriverInput(new Set(['KeyW', 'Space']), 10)).toMatchObject({ throttle: 1, brake: 0, handbrake: true });
  expect(keyboardDriverInput(new Set(['KeyS', 'Space']), 10)).toMatchObject({ throttle: 0, brake: 1, handbrake: true });
});

it('brakes against the current direction before engaging forward or reverse drive', () => {
  expect(keyboardDriverInput(new Set(['KeyS']), 10)).toMatchObject({ throttle: 0, brake: 1 });
  expect(keyboardDriverInput(new Set(['KeyS']), 0)).toMatchObject({ throttle: -1, brake: 0 });
  expect(keyboardDriverInput(new Set(['KeyS']), -10)).toMatchObject({ throttle: -1, brake: 0 });
  expect(keyboardDriverInput(new Set(['KeyW']), -10)).toMatchObject({ throttle: 0, brake: 1 });
  expect(keyboardDriverInput(new Set(['KeyW']), 0)).toMatchObject({ throttle: 1, brake: 0 });
  expect(keyboardDriverInput(new Set(['KeyW', 'KeyS']), 0)).toMatchObject({ throttle: 0, brake: 1 });
  expect(keyboardDriverInput(new Set(['ArrowDown']), 10)).toEqual(keyboardDriverInput(new Set(['KeyS']), 10));
});

it.each(['balanced', 'minicar', 'ice'])('holding S slows %s before entering reverse', preset => {
  const car = new Vehicle(new Terrain('flat'), presetConfig(preset)); car.body.position.z = 100; car.body.velocity.z = 12;
  const keys = new Set(['KeyS']); let reversed = false;
  for (let i = 0; i < 2400; i++) {
    const before = car.forwardSpeed, input = keyboardDriverInput(keys, before);
    if (before > DIRECTION_CHANGE_SPEED) expect(input).toMatchObject({ throttle: 0, brake: 1 });
    if (input.throttle < 0) expect(before).toBeLessThanOrEqual(DIRECTION_CHANGE_SPEED);
    car.step(input);
    if (car.forwardSpeed < -1) { reversed = true; break; }
  }
  expect(reversed).toBe(true); expect(car.body.velocity.finite()).toBe(true);
});

it('replays resolved brake-to-reverse and handbrake inputs deterministically', () => {
  const car = new Vehicle(new Terrain('flat'), presetConfig('minicar')); const inputs: DriverInput[] = [];
  for (let i = 0; i < 720; i++) {
    const keys = i < 240 ? ['KeyW'] : i < 600 ? ['KeyS'] : ['Space'];
    const input = keyboardDriverInput(new Set(keys), car.forwardSpeed); inputs.push(input); car.step(input);
  }
  expect(inputs.some(input => input.brake === 1)).toBe(true);
  expect(inputs.some(input => input.throttle === -1)).toBe(true);
  const replay = new Vehicle(new Terrain('flat'), presetConfig('minicar'));
  for (const input of inputs) replay.step(input);
  expect(replay.snapshot()).toEqual(car.snapshot());
});
