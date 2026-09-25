// Stable offsets survive linear-memory growth. Keep barrier offsets in
// native/contact-parallel.ts synchronized with this control layout.
export const CONTACT_TABLE_OFFSET=4096;
export const WORKER_CONTROL_OFFSET=8192;
export const WORKER_RESULTS_OFFSET=9216;
export const POSITION_COLORS_OFFSET=9728;
export const VELOCITY_COLORS_OFFSET=10000;
export const CONTACT_ARENA_OFFSET=16384;
export const WORKER_CONTROL_LENGTH=256;
export const WORKER_RESULTS_LENGTH=64;
export const WORKER_PARAMETER_INDEX=32;
export const WORKER_DONE_BASE=32;
export const WORKER_DONE_STRIDE=16;
export const WORKER_CONTROL={command:0,active:1,stop:2,kind:3,groups:4,participants:5,failed:6} as const;
export interface ParallelContactExports {
  configure:(table:number)=>void;
  parallelBuildPairs:(agents:number,capacity:number,columns:number,rows:number,cellSize:number,maximumRadius:number,gap:number,padding:number,worker:number,participants:number)=>number;
  setDeferredPositions:(value:number)=>void;
  parallelVelocity:(groups:number,dt:number,friction:number,motor:number,worker:number,participants:number)=>number;
  parallelPosition:(groups:number,gap:number,minimumRadius:number,worker:number,participants:number)=>number;
}
export interface ContactWorkerSetup {module:WebAssembly.Module;memory:WebAssembly.Memory;worker:number;}
