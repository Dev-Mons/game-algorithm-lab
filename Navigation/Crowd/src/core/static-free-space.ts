import { distanceSquaredToRect } from './obstacle-collision';
import { StaticObstacleIndex } from './static-obstacle-index';

/** Exact empty-disk certificates. A segment inside the disk cannot hit a static.
 * Invalidation follows the index geometry revision, bounds and each body's clearance. */
export class StaticFreeSpace {
  private x = new Float64Array(0);
  private y = new Float64Array(0);
  private radius = new Float64Array(0);
  private clearance = new Float64Array(0);
  private revision = -1;
  private width = 0;
  private height = 0;
  constructor(private readonly index: StaticObstacleIndex) {}
  get bytes():number { return this.x.byteLength+this.y.byteLength+this.radius.byteLength+this.clearance.byteLength; }

  begin(count: number, width: number, height: number): void {
    if(this.x.length<count) {
      this.x=new Float64Array(count);this.y=new Float64Array(count);
      this.radius=new Float64Array(count);this.clearance=new Float64Array(count);
    }
    if(this.revision!==this.index.revision||this.width!==width||this.height!==height) {
      this.radius.fill(0);this.revision=this.index.revision;this.width=width;this.height=height;
    }
  }

  contains(id:number,x:number,y:number):boolean {
    const r=this.radius[id]!;
    return r>0&&(x-this.x[id]!)**2+(y-this.y[id]!)**2<r*r;
  }

  coversMotion(id:number,x:number,y:number,distance:number):boolean {
    const remaining=this.radius[id]!-distance;
    return remaining>0&&(x-this.x[id]!)**2+(y-this.y[id]!)**2<remaining*remaining;
  }

  prepare(id:number,x:number,y:number,clearance:number):void {
    if(this.clearance[id]===clearance&&this.contains(id,x,y))return;
    const reach=64;
    let distance=Math.min(reach,x,y,this.width-x,this.height-y);
    for(const i of this.index.query(x-reach,y-reach,x+reach,y+reach)) {
      distance=Math.min(distance,Math.sqrt(distanceSquaredToRect(x,y,this.index.obstacles[i]!)));
    }
    this.x[id]=x;this.y[id]=y;this.clearance[id]=clearance;
    this.radius[id]=Math.max(0,distance-clearance-1e-6);
  }
}
