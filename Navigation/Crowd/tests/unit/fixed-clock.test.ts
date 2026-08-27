import { describe, expect, it } from 'vitest';
import { FixedClock } from '../../src/core/fixed-clock';

describe('fixed clock', () => {
  it('drops overdue work after the per-frame step budget instead of spiraling', () => {
    const clock = new FixedClock(1 / 60, 0.25, 4);
    let steps = 0;
    clock.reset(1);

    const alpha = clock.consume(1.25, 1, () => { steps += 1; });

    expect(steps).toBe(1);
    expect(alpha).toBeGreaterThanOrEqual(0);
    expect(alpha).toBeLessThan(1);

    clock.consume(1.25, 1, () => { steps += 1; });
    expect(steps).toBe(1);
  });

  it('still supports four-times speed at a regular 60 Hz frame cadence', () => {
    const clock = new FixedClock(1 / 60, 0.25, 4);
    let steps = 0;
    clock.reset(1);

    clock.consume(1.02, 4, () => { steps += 1; });

    expect(steps).toBe(4);
  });
});
