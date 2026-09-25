import { CONTACT_KERNEL_BASE64 } from './contact-kernel.generated';
import { AgentBuffer } from './agent-state';

interface Exports {
  configure: (table: number) => void;
  velocity: (count:number,dt:number,friction:number,motorSquared:number) => number;
  position: (count:number,gap:number,minimumRadius:number) => void;
  constraintCount: () => number;
  buildWorkset: (pairs:number,agents:number,dt:number,halo:number) => number;
  validWorkset: (agents:number,limitSquared:number) => number;
  buildPairs: (agents:number,capacity:number,columns:number,rows:number,cellSize:number,maximumRadius:number,gap:number,padding:number) => number;
  pairCandidates: () => number;
  pairFallbacks: () => number;
  pairCells: () => number;
  pairMaximum: () => number;
  classifyGeometry: (pairs:number,gap:number) => number;
  maximumDisplacement: (agents:number) => number;
  hasCompression: (pairs:number,tolerance:number) => number;
}

let compiled: WebAssembly.Module | null | undefined;

/** Owns reusable linear memory. No allocator or garbage collector runs in the
 * kernel. Static geometry callbacks operate directly on these same state views. */
export class ContactKernel {
  readonly memory = new WebAssembly.Memory({initial:1});
  readonly exports: Exports;
  count = 0;
  capacity = 0;
  private cells = 0;
  arrays!: {
    x:Float64Array; y:Float64Array; vx:Float64Array; vy:Float64Array;
    radii:Float64Array; freeX:Float64Array; freeY:Float64Array; freeRadius:Float64Array;
    corrected:Uint8Array; lengths:Float64Array; affected:Uint8Array;
    a:Int32Array; b:Int32Array; dx:Float64Array; dy:Float64Array; radius:Float64Array;
    nx:Float64Array; ny:Float64Array; normal:Float64Array; tangent:Float64Array;
    kind:Int8Array; velocityPairs:Int32Array;
    anchorVX:Float64Array; anchorVY:Float64Array;
    active:Uint8Array; cellStart:Int32Array; cellIndices:Int32Array;
    anchorX:Float64Array; anchorY:Float64Array;
  };
  private shadow: AgentBuffer | null = null;

  static create(separated:(a:number,b:number)=>number,correctPair:(a:number,b:number,dx:number,dy:number,d:number,correction:number)=>void):ContactKernel|null {
    try {
      if(compiled===undefined)compiled=new WebAssembly.Module(Uint8Array.from(atob(CONTACT_KERNEL_BASE64),c=>c.charCodeAt(0)));
      return compiled?new ContactKernel(compiled,separated,correctPair):null;
    } catch { compiled=null;return null; }
  }

  private constructor(module:WebAssembly.Module,separated:Function,correctPair:Function) {
    this.exports=new WebAssembly.Instance(module,{env:{memory:this.memory,separated,correctPair}}).exports as unknown as Exports;
  }

  ensure(count:number,capacity:number,cells=this.cells):void {
    if(count===this.count&&capacity<=this.capacity&&cells<=this.cells)return;
    const saved=this.arrays?Object.fromEntries(Object.entries(this.arrays).slice(0,11).map(([k,v])=>[k,v.slice()])):null;
    this.count=count;this.capacity=Math.max(capacity,this.capacity);this.cells=Math.max(cells,this.cells);
    const bytes=8192+count*128+this.capacity*96+this.cells*4;
    const pages=Math.ceil(bytes/65536);
    if(this.memory.buffer.byteLength<pages*65536)this.memory.grow(pages-this.memory.buffer.byteLength/65536);
    let offset=8192;
    const f=(n:number)=>{offset=(offset+7)&~7;const a=new Float64Array(this.memory.buffer,offset,n);offset+=n*8;return a;};
    const i=(n:number)=>{offset=(offset+7)&~7;const a=new Int32Array(this.memory.buffer,offset,n);offset+=n*4;return a;};
    const u=(n:number)=>{const a=new Uint8Array(this.memory.buffer,offset,n);offset+=n;return a;};
    const m=this.capacity;
    this.arrays={x:f(count),y:f(count),vx:f(count),vy:f(count),radii:f(count),freeX:f(count),freeY:f(count),freeRadius:f(count),
      corrected:u(count),lengths:f(count),affected:u(count),a:i(m),b:i(m),dx:f(m),dy:f(m),radius:f(m),nx:f(m),ny:f(m),normal:f(m),tangent:f(m),
      kind:new Int8Array(u(m).buffer,offset-m,m),velocityPairs:i(m),anchorVX:f(count),anchorVY:f(count),
      active:u(count),cellStart:i(this.cells),cellIndices:i(count),anchorX:f(count),anchorY:f(count)};
    const table=new Uint32Array(this.memory.buffer,4096,29);
    Object.values(this.arrays).forEach((a,j)=>{table[j]=a.byteOffset;});
    if(saved)for(const [key,value] of Object.entries(saved)) {
      const target=this.arrays[key as keyof typeof this.arrays];
      target.set(value.subarray(0,target.length));
    }
    if(this.shadow)this.bind(this.shadow);
    this.exports.configure(table.byteOffset);
  }

  attach(next:AgentBuffer):AgentBuffer {
    // A per-step Object.create(next) gives every shadow a different prototype
    // and makes all hot state accesses megamorphic. Keep a real, stable buffer
    // object and only rebind its views; no agent data is duplicated here.
    this.shadow??=new AgentBuffer(0);
    Object.assign(this.shadow,{count:next.count,active:next.active,stalledFor:next.stalledFor,
      intentX:next.intentX,intentY:next.intentY,heading:next.heading});
    this.bind(this.shadow);
    return this.shadow;
  }

  detach():void { this.shadow=null; }

  private bind(shadow:AgentBuffer):void {
    const {x,y,vx,vy}=this.arrays;
    Object.assign(shadow,{x,y,vx,vy});
  }

  publish(next:AgentBuffer,corrected:Uint8Array,lengths:Float64Array):void {
    const a=this.arrays;
    next.x.set(a.x);next.y.set(a.y);next.vx.set(a.vx);next.vy.set(a.vy);
    corrected.set(a.corrected);lengths.set(a.lengths);
  }
}
