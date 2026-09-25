interface Table { keys:Float64Array; values:Float64Array; used:Int32Array; count:number; }
const empty=():Table=>({keys:new Float64Array(0),values:new Float64Array(0),used:new Int32Array(0),count:0});

/** Two reusable open-addressed tables, rebuilt in pair order at each substep.
 * Values are normal impulse, tangent impulse, nx, ny and dt. No per-contact objects. */
export class WarmContactCache {
  private current=empty();
  private previous=empty();
  get values():Float64Array { return this.current.values; }
  get bytes():number { return [this.current,this.previous].reduce((n,t)=>n+t.keys.byteLength+t.values.byteLength+t.used.byteLength,0); }

  begin(maximumEntries:number):void {
    const swap=this.previous;this.previous=this.current;this.current=swap;
    let capacity=16;
    while(capacity<maximumEntries*2)capacity*=2;
    if(this.current.keys.length<capacity)this.current={keys:new Float64Array(capacity),values:new Float64Array(capacity*5),used:new Int32Array(capacity),count:0};
    this.current.keys.fill(0);this.current.count=0;
  }

  add(key:number,nx:number,ny:number,dt:number,friction:number):number {
    const encoded=key+1,table=this.current;
    let old=-1;
    if(this.previous.keys.length) {
      const mask=this.previous.keys.length-1;
      let slot=Math.imul(encoded,2654435761)&mask;
      while(this.previous.keys[slot]) {
        if(this.previous.keys[slot]===encoded){old=slot*5;break;}
        slot=(slot+1)&mask;
      }
    }
    const mask=table.keys.length-1;
    let slot=Math.imul(encoded,2654435761)&mask;
    while(table.keys[slot])slot=(slot+1)&mask;
    table.keys[slot]=encoded;table.used[table.count++]=slot;
    const base=slot*5,prior=this.previous.values;
    const cosine=old>=0?prior[old+2]!*nx+prior[old+3]!*ny:0;
    const sine=old>=0?prior[old+2]!*ny-prior[old+3]!*nx:0;
    const scale=old>=0&&cosine>.95?dt/prior[old+4]!:0;
    // Preserve the prior world-space impulse when the contact basis rotates,
    // then project it onto the current friction cone. Rotating a large stored
    // normal impulse blindly can inject substantial tangential kinetic energy.
    const normal=old>=0?Math.max(0,(prior[old]!*cosine-prior[old+1]!*sine)*scale):0;
    const tangent=old>=0?(prior[old]!*sine+prior[old+1]!*cosine)*scale:0;
    table.values[base]=normal;
    table.values[base+1]=Math.max(-friction*normal,Math.min(friction*normal,tangent));
    table.values[base+2]=nx;table.values[base+3]=ny;table.values[base+4]=dt;
    return base;
  }

  reset():void {
    for(const t of [this.current,this.previous])if(t.count){t.count=0;t.keys.fill(0);}
  }

  hashState(mix:(value:number)=>void):void {
    const t=this.current;
    for(let i=0;i<t.count;i++) {
      const slot=t.used[i]!,base=slot*5;
      mix(t.keys[slot]!-1);
      for(let j=0;j<4;j++)mix(Math.round(t.values[base+j]!*1e6));
      mix(Math.round(t.values[base+4]!*1e9));
    }
  }
}
