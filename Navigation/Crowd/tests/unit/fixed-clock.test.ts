import { describe, expect, it } from 'vitest';
import { FixedClock } from '../../src/core/fixed-clock';

describe('fixed clock', () => {
  it.each([30,60,120,144])('preserves time at %i Hz with jitter and spare CPU budget', hz => {
    let cpu=0, steps=0;
    const clock=new FixedClock(1/60,.25,4,()=>cpu);
    clock.reset(0);
    for(let frame=1;frame<=hz*2;frame++) clock.consume(frame/hz+(frame%2?.0001:0),1,()=>{steps++;cpu+=2;});
    expect(steps).toBe(120);
    expect(clock.timing.dropped).toBe(0);
    expect(clock.timing.clamped).toBe(0);
    expect(clock.timing.simulated+clock.timing.debt).toBeCloseTo(clock.timing.elapsed,10);
  });
  it('limits expensive work, bounds debt and accounts for every dropped or clamped second',()=>{
    let cpu=0, steps=0;
    const clock=new FixedClock(1/60,.25,4,()=>cpu);
    clock.reset(0);
    for(const time of [.1,.2,.3,2,2.1]) {
      const before=steps;
      expect(clock.consume(time,1,()=>{steps++;cpu+=35;})).toBeLessThanOrEqual(1);
      expect(steps-before).toBe(1);
      const t=clock.timing;
      expect(t.debt).toBeLessThanOrEqual(.25);
      expect(t.simulated+t.debt+t.dropped+t.clamped).toBeCloseTo(t.elapsed,10);
    }
    expect(clock.timing.dropped).toBeGreaterThan(0);
    expect(clock.timing.clamped).toBeGreaterThan(1);
  });
  it.each([.25,1,4])('supports %fx speed without changing fixed ticks',speed=>{
    let cpu=0, steps=0;
    const clock=new FixedClock(1/60,.25,4,()=>cpu);
    clock.reset(1);
    for(let frame=1;frame<=120;frame++) clock.consume(1+frame/60,speed,()=>{steps++;cpu+=.1;});
    expect(steps).toBe(120*speed);
  });
  it('resets pause debt, accepts timestamp zero and does not count a failed tick',()=>{
    const clock=new FixedClock(1/60);
    clock.reset(0);
    clock.consume(.1,1,()=>false);
    expect(clock.timing.simulated).toBe(0);
    expect(clock.timing.debt).toBeCloseTo(.1);
    clock.reset(20);
    clock.consume(20,1,()=>{throw new Error('paused time must not run');});
    expect(clock.timing.elapsed).toBe(0);
    expect(clock.timing.debt).toBe(0);
  });

  it('still supports four-times speed at a regular 60 Hz frame cadence', () => {
    const clock = new FixedClock(1 / 60, 0.25, 4);
    let steps = 0;
    clock.reset(1);

    clock.consume(1.02, 4, () => { steps += 1; });

    expect(steps).toBe(4);
  });

  it('excludes paused wall time without erasing recorded losses or pending fractions',()=>{
    let cpu=0;
    const clock=new FixedClock(1/60,.25,4,()=>cpu);
    clock.reset(0);clock.consume(1,1,()=>{cpu+=30;});
    const before={...clock.timing};clock.suspend(20);
    clock.consume(20,0,()=>{throw new Error('zero speed');});
    expect(clock.timing.clamped).toBe(before.clamped);
    expect(clock.timing.wallElapsed).toBe(before.wallElapsed);
    expect(clock.timing.debt).toBe(before.debt);
  });
});
