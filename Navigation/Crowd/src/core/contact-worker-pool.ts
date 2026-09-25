import { WORKER_CONTROL_OFFSET,WORKER_RESULTS_OFFSET,WORKER_CONTROL_LENGTH,WORKER_RESULTS_LENGTH,
  WORKER_PARAMETER_INDEX,WORKER_DONE_BASE,WORKER_DONE_STRIDE,WORKER_CONTROL as C,
  type ParallelContactExports } from './contact-worker-protocol';

export class ContactWorkerFailure extends Error {}

/** Owns a single memory's participants. The calling thread is participant 0. */
export class ContactWorkerPool {
  readonly participants:number;
  private readonly control:Int32Array;
  private readonly values:Float64Array;
  private readonly workers:Worker[]=[];
  private readyWorkers=0;
  private disabled=false;
  private depth=0;
  private command=0;
  phaseMs=0;
  passes=0;
  constraints=0;
  energyDamped=0;
  maximumImpulse=0;
  pairCount=0;pairCandidates=0;pairFallbacks=0;pairCells=0;pairMaximum=0;pairOwnershipSkips=0;
  constructor(module:WebAssembly.Module,memory:WebAssembly.Memory,private readonly api:ParallelContactExports) {
    this.participants=Math.max(1,Math.min(4,Math.floor((navigator.hardwareConcurrency??2)/2)));
    this.control=new Int32Array(memory.buffer,WORKER_CONTROL_OFFSET,WORKER_CONTROL_LENGTH);
    this.values=new Float64Array(memory.buffer,WORKER_RESULTS_OFFSET,WORKER_RESULTS_LENGTH);
    Atomics.store(this.control,C.participants,this.participants);
    try {
      for(let worker=1;worker<this.participants;worker++) {
        const handle=new Worker(new URL('./contact-worker.ts',import.meta.url),{type:'module'});
        this.workers.push(handle);
        handle.onmessage=({data})=>{if(data.error)this.dispose();else if(data.ready)this.readyWorkers++;};
        handle.onerror=()=>this.dispose();
        handle.postMessage({module,memory,worker});
      }
    } catch {this.dispose();}
  }
  get ready():boolean {return !this.disabled&&this.participants>1&&this.readyWorkers===this.participants-1;}
  begin():void {if(!this.disabled&&this.depth++===0)Atomics.store(this.control,C.active,1);}
  end():void {if(this.depth>0&&--this.depth===0)Atomics.store(this.control,C.active,0);}
  resetCounters():void {this.phaseMs=0;this.passes=0;}
  run(kind:1|2|3,groups:number,a:number,b:number,c=0,d=0,e=0,f=0,g=0):void {
    if(!this.ready)throw new ContactWorkerFailure('Contact workers unavailable.');
    const control=this.control,start=performance.now(),command=this.command=(this.command+1)|0,p=WORKER_PARAMETER_INDEX;
    this.values[p]=a;this.values[p+1]=b;this.values[p+2]=c;
    this.values[p+3]=d;this.values[p+4]=e;this.values[p+5]=f;this.values[p+6]=g;
    Atomics.store(control,C.kind,kind);Atomics.store(control,C.groups,groups);
    Atomics.store(control,C.command,command);Atomics.notify(control,C.command,this.workers.length);
    try {
      const success=kind===1?this.api.parallelVelocity(groups,a,b,c,0,this.participants):kind===2?this.api.parallelPosition(groups,a,b,0,this.participants):this.api.parallelBuildPairs(groups,a,b,c,d,e,f,g,0,this.participants);
      if(!success||Atomics.load(control,C.failed))throw new ContactWorkerFailure('Contact worker phase failed.');
      let polls=0;
      for(let worker=1;worker<this.participants;worker++) {
        while(Atomics.load(control,WORKER_DONE_BASE+worker*WORKER_DONE_STRIDE)!==command) {
          if(Atomics.load(control,C.failed)||((++polls&1023)===0&&performance.now()-start>1000))throw new ContactWorkerFailure('Contact worker completion timed out.');
        }
      }
      if(kind===1) {
        this.maximumImpulse=0;this.constraints=0;this.energyDamped=0;
        for(let worker=0;worker<this.participants;worker++) {
          this.maximumImpulse=Math.max(this.maximumImpulse,this.values[worker*4]!);
          this.constraints+=this.values[worker*4+1]!;this.energyDamped+=this.values[worker*4+2]!;
        }
      }
      if(kind===3) {
        this.pairCount=0;this.pairCandidates=0;this.pairFallbacks=0;this.pairCells=0;this.pairMaximum=0;this.pairOwnershipSkips=0;
        let overflow=false;
        for(let worker=0;worker<this.participants;worker++) {
          const at=worker*8,count=this.values[at]!;if(count<0)overflow=true;else this.pairCount+=count;
          this.pairCandidates+=this.values[at+1]!;this.pairFallbacks+=this.values[at+2]!;
          this.pairCells+=this.values[at+3]!;this.pairMaximum=Math.max(this.pairMaximum,this.values[at+4]!);
          this.pairOwnershipSkips+=this.values[at+5]!;
        }
        if(overflow||this.pairCount>a)this.pairCount=-1;
      }
      this.passes++;
    } catch(error) {this.dispose();throw error;}
    finally {this.phaseMs+=performance.now()-start;}
  }
  dispose():void {
    if(this.disabled)return;
    this.disabled=true;Atomics.store(this.control,C.stop,1);Atomics.store(this.control,C.active,0);Atomics.notify(this.control,C.command);
    for(const worker of this.workers)worker.terminate();this.workers.length=0;
  }
}
