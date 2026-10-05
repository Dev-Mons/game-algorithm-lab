import { Silo2D, type SiloSpec } from './silo-2d';

/** A batch settles physically on a lowering cradle. Pressing translates intact pieces;
 * no radius, angle, relative position or visual scale is changed to simulate crushing. */
export class ScrapPress extends Silo2D {
  floorDrop=0;
  contactY=0;
  travel=0;
  private readonly seats=new Map<number,number>();
  constructor(spec:SiloSpec,readonly coverY:number) { super(spec); }
  beginStroke() {
    this.seats.clear();this.floorDrop=0;
    this.contactY=Math.max(this.spec.throatY,...this.bodies.map(b=>b.y+b.radius))+.025;
    this.travel=Math.max(0,this.contactY-(this.coverY-.18));
    for(const body of this.bodies)this.seats.set(body.id,body.y);
  }
  lower(progress:number) {
    this.floorDrop=this.travel*Math.max(0,Math.min(1,progress));
    for(const body of this.bodies)body.y=this.seats.get(body.id)!-this.floorDrop;
  }
  takeCovered():boolean {
    const index=this.bodies.findIndex(b=>b.y+b.radius<this.coverY-.06);
    return index>=0 && this.releaseBody(index);
  }
  resetStroke() {this.seats.clear();this.floorDrop=0;this.travel=0;}
}
