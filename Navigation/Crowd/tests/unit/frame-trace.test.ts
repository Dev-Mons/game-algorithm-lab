import { expect, it } from 'vitest';
import { FrameTrace, FRAME_COLUMNS, NumericRing } from '../../src/core/frame-trace';

it('retains a bounded ordered window across wrap, pause of tracing and reset',()=>{
  const trace=new FrameTrace(3),sample=new Array<number>(FRAME_COLUMNS.length).fill(0);
  const ring=new NumericRing(3);
  for(let i=0;i<100;i++){sample[0]=i;trace.record(sample);ring.push(i);}
  expect(trace.export().frames.map(f=>f[0])).toEqual([97,98,99]);
  expect(ring.slice()).toEqual([97,98,99]);expect(ring.slice(-2)).toEqual([98,99]);
  trace.enabled=false;sample[0]=100;trace.record(sample);
  expect(trace.export().frames.at(-1)![0]).toBe(99);
  trace.clear();expect(trace.export().frames).toEqual([]);
});
