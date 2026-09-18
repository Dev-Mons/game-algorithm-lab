import {box} from './fixtures';
import type {Vec3} from './core/analysis';
const shift=(cells:Vec3[],x:number,y:number,z:number):Vec3[]=>cells.map(c=>[c[0]+x,c[1]+y,c[2]+z]);
export const URBAN_FIXTURES={
  towers:[...box(14,3,7),...shift(box(4,9,4),1,3,1),...shift(box(4,5,4),9,3,1)],
  annex:[...box(7,12,4),...shift(box(4,4,4),7,0,0)],
  setback:box(12,12,8).filter(([x,y,z])=>y<4||y<8&&x>=2&&x<10&&z<6||x>=4&&x<8&&z<4),
  courtyard:box(9,8,9).filter(([x,,z])=>x<2||x>6||z<2||z>6),
  openCourt:box(9,8,9).filter(([x,,z])=>x<2||x>6||z<2),
  sealed:box(5,6,5).filter(([x,y,z])=>x!==2||z!==2||y===0||y===5),
  remerge:[...box(9,2,3),...shift(box(2,3,3),0,2,0),...shift(box(2,3,3),7,2,0),...shift(box(9,1,3),0,5,0)],
  notch:box(10,10,5).filter(([x,y,z])=>x!==5||y!==5||z!==4),
} satisfies Record<string,Vec3[]>;
