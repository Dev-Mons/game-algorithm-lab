import { CROWD_TRANSFER_BASE64 } from './crowd-transfer.generated';
import type { AgentBuffer } from './agent-state';
import type { CrowdField } from './crowd-field';

interface API {
  configure:(table:number)=>void;
  scatter:(agents:number,cells:number,columns:number,rows:number,h:number,weighted:number,external:number)=>void;
  gather:(agents:number,cells:number,target:number,speed:number)=>void;
}
let compiled:WebAssembly.Module|null|undefined;
/** Reusable scalar f64 transfers with the host's exact atan2/hypot functions.
 * Copies keep the public grid arrays and simulation state independently owned. */
export class CrowdTransferKernel {
  readonly memory=new WebAssembly.Memory({initial:1});
  private readonly api:API;
  private capacity=0;
  private cells=0;
  arrays!: {
    mass:Float64Array;momentumX:Float64Array;momentumY:Float64Array;desiredX:Float64Array;desiredY:Float64Array;
    velocityX:Float64Array;velocityY:Float64Array;unprojectedX:Float64Array;unprojectedY:Float64Array;
    density:Float64Array;blocked:Uint8Array;openRight:Uint8Array;openDown:Uint8Array;
    x:Float64Array;y:Float64Array;vx:Float64Array;vy:Float64Array;intentX:Float64Array;intentY:Float64Array;
    outputX:Float64Array;outputY:Float64Array;active:Uint8Array;area:Float64Array;external:Uint8Array;
    transferCells:Int32Array;transferWeights:Float64Array;channels:Uint8Array;fractions:Float64Array;
  };
  static create():CrowdTransferKernel|null {
    try {
      if(compiled===undefined)compiled=new WebAssembly.Module(Uint8Array.from(atob(CROWD_TRANSFER_BASE64),c=>c.charCodeAt(0)));
      return compiled?new CrowdTransferKernel(compiled):null;
    } catch {compiled=null;return null;}
  }
  private constructor(module:WebAssembly.Module) {
    this.api=new WebAssembly.Instance(module,{env:{memory:this.memory,atan2:Math.atan2,hypot:Math.hypot}}).exports as unknown as API;
  }
  private ensure(count:number,cells:number):void {
    if(this.arrays&&count<=this.capacity&&cells===this.cells)return;
    this.capacity=Math.max(count,this.capacity*2);this.cells=cells;
    const pages=Math.ceil((8192+256+cells*600+this.capacity*144)/65536);
    if(pages*65536>this.memory.buffer.byteLength)this.memory.grow(pages-this.memory.buffer.byteLength/65536);
    let offset=8192;
    const f=(n:number)=>{offset=(offset+7)&~7;const a=new Float64Array(this.memory.buffer,offset,n);offset+=n*8;return a;};
    const i=(n:number)=>{offset=(offset+7)&~7;const a=new Int32Array(this.memory.buffer,offset,n);offset+=n*4;return a;};
    const u=(n:number)=>{const a=new Uint8Array(this.memory.buffer,offset,n);offset+=n;return a;};
    const grid=cells*8,n=this.capacity;
    this.arrays={mass:f(grid),momentumX:f(grid),momentumY:f(grid),desiredX:f(grid),desiredY:f(grid),
      velocityX:f(grid),velocityY:f(grid),unprojectedX:f(grid),unprojectedY:f(grid),density:f(cells),blocked:u(cells),openRight:u(cells),openDown:u(cells),
      x:f(n),y:f(n),vx:f(n),vy:f(n),intentX:f(n),intentY:f(n),outputX:f(n),outputY:f(n),active:u(n),area:f(n),external:u(n),
      transferCells:i(n*4),transferWeights:f(n*4),channels:u(n),fractions:f(n)};
    const table=new Uint32Array(this.memory.buffer,4096,28);
    Object.values(this.arrays).forEach((a,j)=>{table[j]=a.byteOffset;});this.api.configure(table.byteOffset);
  }
  scatter(state:AgentBuffer,x:Float64Array,y:Float64Array,field:CrowdField,right:Uint8Array,down:Uint8Array,area?:Float64Array,external?:Uint8Array):void {
    this.ensure(state.count,field.cellCount);const d=this.arrays;
    d.x.set(state.x);d.y.set(state.y);d.vx.set(state.vx);d.vy.set(state.vy);d.intentX.set(state.intentX);d.intentY.set(state.intentY);d.active.set(state.active);
    d.outputX.set(x.subarray(0,state.count));d.outputY.set(y.subarray(0,state.count));d.density.set(field.density);d.blocked.set(field.blocked);d.openRight.set(right);d.openDown.set(down);
    if(area){if(area.length<state.count)d.area.fill(1,0,state.count);d.area.set(area.subarray(0,state.count));}
    if(external){if(external.length<state.count)d.external.fill(0,0,state.count);d.external.set(external.subarray(0,state.count));}
    this.api.scatter(state.count,field.cellCount,field.columns,field.rows,field.cellSize,area?1:0,external?1:0);
  }
  gather(count:number,x:Float64Array,y:Float64Array,vx:Float64Array,vy:Float64Array,ux:Float64Array,uy:Float64Array,target:number,speed:number):void {
    const d=this.arrays;d.velocityX.set(vx);d.velocityY.set(vy);d.unprojectedX.set(ux);d.unprojectedY.set(uy);
    this.api.gather(count,this.cells,target,speed);x.set(d.outputX.subarray(0,count));y.set(d.outputY.subarray(0,count));
  }
}
