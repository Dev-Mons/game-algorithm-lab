import { CONTACT_KERNEL_BASE64, CONTACT_SHARED_KERNEL_BASE64 } from './contact-kernel.generated';
import { AgentBuffer } from './agent-state';
import { ContactWorkerPool } from './contact-worker-pool';
import { MAX_CONTACT_PARTICIPANTS,CONTACT_TABLE_OFFSET,CONTACT_ARENA_OFFSET,WORKER_CONTROL_OFFSET,WORKER_RESULTS_OFFSET,
  POSITION_COLORS_OFFSET,VELOCITY_COLORS_OFFSET,WORKER_CONTROL_LENGTH,WORKER_RESULTS_LENGTH,
  type ParallelContactExports } from './contact-worker-protocol';

interface Exports {
  configure: (table: number) => void;
  velocity: (count:number,dt:number,friction:number,motorSquared:number) => number;
  position: (count:number,gap:number,minimumRadius:number) => void;
  constraintCount: () => number;
  energyDampedContacts: () => number;
  buildWorkset: (pairs:number,agents:number,dt:number,halo:number) => number;
  validWorkset: (agents:number,limitSquared:number) => number;
  buildPairs: (agents:number,capacity:number,columns:number,rows:number,cellSize:number,maximumRadius:number,gap:number,padding:number) => number;
  pairCandidates: () => number;
  pairFallbacks: () => number;
  pairCells: () => number;
  pairMaximum: () => number;
  pairOwnershipSkips: () => number;
  classifyGeometry: (pairs:number,gap:number) => number;
  classifyVelocityWorkset: (count:number) => void;
  maximumDisplacement: (agents:number) => number;
  hasCompression: (pairs:number,tolerance:number) => number;
}

let compiled: WebAssembly.Module | null | undefined;
let compiledShared:WebAssembly.Module|null|undefined;

/** Owns reusable linear memory. No allocator or garbage collector runs in the
 * kernel. Static geometry callbacks operate directly on these same state views. */
export class ContactKernel {
  readonly memory:WebAssembly.Memory;
  readonly exports: Exports;
  private pool:ContactWorkerPool|null=null;
  private groups=0;
  constraints=0;
  energyDamped=0;
  lastParallel=false;
  lastPhaseMs=0;
  pairCandidates=0;pairFallbacks=0;pairCells=0;pairMaximum=0;pairOwnershipSkips=0;
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
    colorStarts:Int32Array;control:Int32Array;parallelResults:Float64Array;deferred:Int8Array;velocityStarts:Int32Array;
    pairScratchA:Int32Array;pairScratchB:Int32Array;
  };
  private shadow: AgentBuffer | null = null;

  static get workersSupported():boolean {return typeof Worker!=='undefined'&&globalThis.crossOriginIsolated===true&&typeof SharedArrayBuffer!=='undefined';}
  static create(separated:(a:number,b:number)=>number,correctPair:(a:number,b:number,dx:number,dy:number,d:number,correction:number)=>void,parallel=true):ContactKernel|null {
    if(parallel&&this.workersSupported)try {
      if(compiledShared===undefined)compiledShared=new WebAssembly.Module(Uint8Array.from(atob(CONTACT_SHARED_KERNEL_BASE64),c=>c.charCodeAt(0)));
      if(compiledShared)return new ContactKernel(compiledShared,separated,correctPair,true);
    } catch {compiledShared=null;}
    try {
      if(compiled===undefined)compiled=new WebAssembly.Module(Uint8Array.from(atob(CONTACT_KERNEL_BASE64),c=>c.charCodeAt(0)));
      return compiled?new ContactKernel(compiled,separated,correctPair,false):null;
    } catch { compiled=null;return null; }
  }

  private constructor(module:WebAssembly.Module,separated:Function,correctPair:Function,readonly shared:boolean) {
    this.memory=new WebAssembly.Memory(shared?{initial:1,maximum:65536,shared:true}:{initial:1});
    this.exports=new WebAssembly.Instance(module,{env:{memory:this.memory,separated,correctPair,clockNow:()=>performance.now()}}).exports as unknown as Exports;
    if(shared) {
      this.ensure(0,0);
      this.pool=new ContactWorkerPool(module,this.memory,this.exports as unknown as ParallelContactExports);
    }
  }

  ensure(count:number,capacity:number,cells=this.cells):void {
    if(this.arrays&&count===this.count&&capacity<=this.capacity&&cells<=this.cells)return;
    // Body-column offsets depend only on count. Memory growth preserves their
    // bytes, so pair/cell capacity growth needs no transient body snapshots.
    const saved=this.arrays&&count!==this.count?Object.fromEntries(Object.entries(this.arrays).slice(0,11).map(([k,v])=>[k,v.slice()])):null;
    this.count=count;this.capacity=Math.max(capacity,this.capacity);this.cells=Math.max(cells,this.cells);
    const bytes=CONTACT_ARENA_OFFSET+count*128+this.capacity*(104+(this.shared?MAX_CONTACT_PARTICIPANTS*8:0))+this.cells*4;
    const pages=Math.ceil(bytes/65536);
    if(this.memory.buffer.byteLength<pages*65536)this.memory.grow(pages-this.memory.buffer.byteLength/65536);
    let offset=CONTACT_ARENA_OFFSET;
    const f=(n:number)=>{offset=(offset+7)&~7;const a=new Float64Array(this.memory.buffer,offset,n);offset+=n*8;return a;};
    const i=(n:number)=>{offset=(offset+7)&~7;const a=new Int32Array(this.memory.buffer,offset,n);offset+=n*4;return a;};
    const u=(n:number)=>{const a=new Uint8Array(this.memory.buffer,offset,n);offset+=n;return a;};
    const m=this.capacity;
    this.arrays={x:f(count),y:f(count),vx:f(count),vy:f(count),radii:f(count),freeX:f(count),freeY:f(count),freeRadius:f(count),
      corrected:u(count),lengths:f(count),affected:u(count),a:i(m),b:i(m),dx:f(m),dy:f(m),radius:f(m),nx:f(m),ny:f(m),normal:f(m),tangent:f(m),
      kind:new Int8Array(u(m).buffer,offset-m,m),velocityPairs:i(m),anchorVX:f(count),anchorVY:f(count),
      active:u(count),cellStart:i(this.cells),cellIndices:i(count),anchorX:f(count),anchorY:f(count),
      colorStarts:new Int32Array(this.memory.buffer,POSITION_COLORS_OFFSET,65),
      control:new Int32Array(this.memory.buffer,WORKER_CONTROL_OFFSET,WORKER_CONTROL_LENGTH),
      parallelResults:new Float64Array(this.memory.buffer,WORKER_RESULTS_OFFSET,WORKER_RESULTS_LENGTH),
      deferred:new Int8Array(u(m).buffer,offset-m,m),
      velocityStarts:new Int32Array(this.memory.buffer,VELOCITY_COLORS_OFFSET,65),
      pairScratchA:i(this.shared?m*MAX_CONTACT_PARTICIPANTS:0),pairScratchB:i(this.shared?m*MAX_CONTACT_PARTICIPANTS:0)};
    const table=new Uint32Array(this.memory.buffer,CONTACT_TABLE_OFFSET,36);
    Object.values(this.arrays).forEach((a,j)=>{table[j]=a.byteOffset;});
    this.arrays.deferred.fill(0);
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
  dispose():void {this.pool?.dispose();this.pool=null;this.detach();}
  beginFrame():void {this.pool?.begin();}
  endFrame():void {this.pool?.end();}
  get workerThreads():number {return this.pool?.ready?this.pool.participants-1:0;}
  configureColors(starts:Int32Array,groups:number):void {this.groups=groups;this.arrays.colorStarts.set(starts);}
  configureVelocityColors(count:number):void {
    if(this.shared&&this.groups>0)this.exports.classifyVelocityWorkset(count);
    const data=this.arrays;let at=0;data.velocityStarts[0]=0;
    for(let group=0;group<this.groups;group++) {
      const end=data.colorStarts[group+1]!;
      while(at<count&&data.velocityPairs[at]!<end)at++;
      data.velocityStarts[group+1]=at;
    }
  }
  solveVelocity(count:number,dt:number,friction:number,motorSquared:number):number {
    const pool=this.pool;this.lastParallel=!!pool?.ready&&this.groups>0&&count>=8192;this.lastPhaseMs=0;
    if(this.lastParallel&&pool) {
      const before=pool.phaseMs;
      try {pool.run(1,this.groups,dt,friction,motorSquared);}
      finally {this.lastPhaseMs=pool.phaseMs-before;}
      this.constraints=pool.constraints;this.energyDamped=pool.energyDamped;return pool.maximumImpulse;
    }
    const maximum=this.exports.velocity(count,dt,friction,motorSquared);
    this.constraints=this.exports.constraintCount();this.energyDamped=this.exports.energyDampedContacts();return maximum;
  }
  solvePosition(count:number,gap:number,minimumRadius:number):void {
    const pool=this.pool;this.lastParallel=!!pool?.ready&&this.groups>0&&count>=20000;this.lastPhaseMs=0;
    if(this.lastParallel&&pool) {
      const before=pool.phaseMs;
      try {pool.run(2,this.groups,gap,minimumRadius);}
      finally {this.lastPhaseMs=pool.phaseMs-before;}
    } else this.exports.position(count,gap,minimumRadius);
  }

  buildPairs(agents:number,capacity:number,columns:number,rows:number,cellSize:number,maximumRadius:number,gap:number,padding:number):number {
    const pool=this.pool,data=this.arrays;
    this.lastParallel=!!pool?.ready&&agents>=5000;this.lastPhaseMs=0;
    if(this.lastParallel&&pool) {
      data.anchorX.set(data.x);data.anchorY.set(data.y);
      const before=pool.phaseMs;
      try {pool.run(3,agents,capacity,columns,rows,cellSize,maximumRadius,gap,padding);}
      finally {this.lastPhaseMs=pool.phaseMs-before;}
      this.pairCandidates=pool.pairCandidates;this.pairFallbacks=pool.pairFallbacks;this.pairCells=pool.pairCells;
      this.pairMaximum=pool.pairMaximum;this.pairOwnershipSkips=pool.pairOwnershipSkips;
      if(pool.pairCount<0)return -1;
      let offset=0;
      for(let worker=0;worker<pool.participants;worker++) {
        const count=data.parallelResults[worker*8]!,start=worker*capacity;
        data.a.set(data.pairScratchA.subarray(start,start+count),offset);
        data.b.set(data.pairScratchB.subarray(start,start+count),offset);offset+=count;
      }
      return offset;
    }
    const result=this.exports.buildPairs(agents,capacity,columns,rows,cellSize,maximumRadius,gap,padding);
    this.pairCandidates=this.exports.pairCandidates();this.pairFallbacks=this.exports.pairFallbacks();this.pairCells=this.exports.pairCells();
    this.pairMaximum=this.exports.pairMaximum();this.pairOwnershipSkips=this.exports.pairOwnershipSkips();return result;
  }

  buildWorkset(pairs:number,agents:number,dt:number,halo:number):number {
    const pool=this.pool,data=this.arrays;
    this.lastParallel=!!pool?.ready&&pairs>=8192;this.lastPhaseMs=0;
    if(this.lastParallel&&pool) {
      data.anchorVX.set(data.vx);data.anchorVY.set(data.vy);
      const before=pool.phaseMs;
      try {pool.run(4,pairs,this.capacity,dt,halo);}
      finally {this.lastPhaseMs=pool.phaseMs-before;}
      let offset=0;
      for(let worker=0;worker<pool.participants;worker++) {
        const count=data.parallelResults[worker*8]!,start=worker*this.capacity;
        data.velocityPairs.set(data.pairScratchA.subarray(start,start+count),offset);offset+=count;
      }
      return offset;
    }
    return this.exports.buildWorkset(pairs,agents,dt,halo);
  }

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
