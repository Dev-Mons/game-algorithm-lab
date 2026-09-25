import { CONTACT_TABLE_OFFSET,WORKER_CONTROL_OFFSET,WORKER_RESULTS_OFFSET,WORKER_CONTROL_LENGTH,WORKER_RESULTS_LENGTH,
  WORKER_PARAMETER_INDEX,WORKER_DONE_BASE,WORKER_DONE_STRIDE,WORKER_CONTROL as C,
  type ParallelContactExports,type ContactWorkerSetup } from './contact-worker-protocol';

self.onmessage=({data}:{data:ContactWorkerSetup})=>{
  const {memory,module,worker}=data;
  const control=new Int32Array(memory.buffer,WORKER_CONTROL_OFFSET,WORKER_CONTROL_LENGTH);
  const values=new Float64Array(memory.buffer,WORKER_RESULTS_OFFSET,WORKER_RESULTS_LENGTH);
  const fail=()=>{Atomics.store(control,C.failed,1);Atomics.store(control,C.stop,1);};
  try {
    const instance=new WebAssembly.Instance(module,{env:{memory,clockNow:()=>performance.now(),
      separated:()=>{throw new Error('Parallel velocity geometry was not classified.');},
      correctPair:()=>{throw new Error('Worker attempted a host geometry callback.');}}});
    const api=instance.exports as unknown as ParallelContactExports;
    api.configure(CONTACT_TABLE_OFFSET);api.setDeferredPositions(1);self.postMessage({ready:true});
    let seen=0;
    while(!Atomics.load(control,C.stop)) {
      const command=Atomics.load(control,C.command);
      if(command===seen) {
        // Sleep between frames; short color/iteration gaps stay in the native
        // shared-memory protocol rather than paying an OS wakeup per group.
        if(!Atomics.load(control,C.active))Atomics.wait(control,C.command,seen);
        continue;
      }
      seen=command;
      const groups=Atomics.load(control,C.groups),participants=Atomics.load(control,C.participants);
      const p=WORKER_PARAMETER_INDEX;
      const success=Atomics.load(control,C.kind)===1
        ? api.parallelVelocity(groups,values[p]!,values[p+1]!,values[p+2]!,worker,participants)
        : api.parallelPosition(groups,values[p]!,values[p+1]!,worker,participants);
      if(!success)fail();
      Atomics.store(control,WORKER_DONE_BASE+worker*WORKER_DONE_STRIDE,command);
    }
  } catch(error) {fail();self.postMessage({error:String(error)});}
};
