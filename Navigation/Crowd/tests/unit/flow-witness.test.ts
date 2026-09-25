import { expect, it } from 'vitest';
import { FlowField } from '../../src/algorithms/flow-field/flow-field';
import { segmentDistanceSquaredToRect } from '../../src/core/obstacle-collision';
import type { Rect } from '../../src/core/types';

it('revalidates witnesses at exact current rays, clearance, goals and edited geometry',()=>{
  const field=new FlowField(300,200,10);
  const rays=field as unknown as {hasLineOfSight:(x:number,y:number,ex:number,ey:number)=>boolean};
  const obstacles:Rect[]=Array.from({length:20},(_,i)=>({x:80+i%4*25,y:30+Math.floor(i/4)*25,width:8,height:10}));
  for(const clearance of [0,3.2,6.4]) for(let edit=0;edit<3;edit++) {
    if(edit===1)obstacles[0]!.y+=50;
    const geometry=edit===2?[]:obstacles;
    const goal={x:290,y:edit===1?30:150};
    field.rebuildStatic(goal,geometry,clearance);
    for(let i=0;i<2000;i++) {
      const x=10+i%40*.23,y=10+(i*17%1800)*.1;
      const end=i%3?goal:{x:250,y:10+(i*13%180)};
      const exact=x>=clearance&&y>=clearance&&end.x>=clearance&&end.y>=clearance
        &&x<=300-clearance&&y<=200-clearance&&end.x<=300-clearance&&end.y<=200-clearance
        &&geometry.every(r=>{const d=segmentDistanceSquaredToRect(x,y,end.x,end.y,r);return clearance*clearance<=1e-12?d>1e-12:d>=clearance*clearance-1e-10;});
      expect(rays.hasLineOfSight(x,y,end.x,end.y)).toBe(exact);
    }
  }
});
