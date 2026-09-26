import { expect, it } from 'vitest';
import { StaticObstacleIndex } from '../../src/core/static-obstacle-index';
import { StaticFreeSpace } from '../../src/core/static-free-space';
import { segmentDistanceSquaredToRect } from '../../src/core/obstacle-collision';

it('certifies only clear segments and invalidates moved geometry, clearance and bounds',()=>{
  const index=new StaticObstacleIndex(),cache=new StaticFreeSpace(index);
  const obstacles=[{x:100,y:50,width:12,height:80}];
  for(let phase=0;phase<4;phase++) {
    if(phase===1)obstacles[0]!.x=45;
    index.update(obstacles);
    const width=phase===3?70:200,clearance=phase===2?12:3.55;
    cache.begin(2,width,180);cache.prepare(0,30,90,clearance);
    for(let i=0;i<1000;i++) {
      const x=i%90,y=20+(i*17%140);
      if(!cache.contains(0,x,y))continue;
      expect(x).toBeGreaterThanOrEqual(clearance);
      expect(x).toBeLessThanOrEqual(width-clearance);
      expect(y).toBeGreaterThanOrEqual(clearance);
      expect(y).toBeLessThanOrEqual(180-clearance);
      expect(segmentDistanceSquaredToRect(30,90,x,y,obstacles[0]!)).toBeGreaterThanOrEqual(clearance*clearance);
    }
    expect(cache.contains(0,obstacles[0]!.x,90)).toBe(false);
  }
});
