import {box} from '../../src/fixtures';
import type {Vec3} from '../../src/core/analysis';

// The user's 86-cell edited volume: a diagonal upper contact at (2,3,1).
export const LOCAL_CORNER_CELLS:Vec3[]=box(8,4,3).map(([x,y,z])=>[x-3,y,z-1] as Vec3)
  .filter(([x,y,z])=>!(x>=0&&x<2&&y>=2&&z===1)&&!(x>=2&&y===3&&z<1));
