import {canonicalJSON,cloneJSON,immutableJSON,isImmutableJSON} from './canonical';
export interface CacheStats {hits:number;misses:number;writes:number;evictions:number;entries:number;bytes:number}
interface Entry {value:unknown;clone:(value:any)=>any;bytes:number;identity?:object}
/** Shared namespaces, insertion-order FIFO, including both key and result bytes. */
export class EnvironmentCache {
  private entries=new Map<string,Entry>();private bytes=0;
  private counters={hits:0,misses:0,writes:0,evictions:0};
  constructor(readonly maxEntries=64,readonly maxBytes=16*1024*1024){}
  key(namespace:string,input:unknown){return namespace+':'+canonicalJSON(input);}
  get<T>(key:string):T|undefined{const entry=this.entries.get(key);if(!entry){this.counters.misses++;return;}this.counters.hits++;return entry.clone(entry.value) as T;}
  /** Identity shortcuts require an immutable value that completely determines this namespace's key. */
  getByIdentity<T>(namespace:string,identity:unknown):T|undefined {if(!isImmutableJSON(identity))return;for(const [key,entry] of this.entries)if(key.startsWith(namespace+':')&&entry.identity===identity){this.counters.hits++;return entry.clone(entry.value) as T;}}
  put<T>(key:string,value:T,clone:(value:T)=>T=cloneJSON,identity?:object){
    if(identity&&!isImmutableJSON(identity))throw new Error('MUTABLE_CACHE_IDENTITY');
    let bytes=(key.length+JSON.stringify(value).length)*2;if(bytes>this.maxBytes)return;
    const snapshot=clone(value);if(identity&&identity!==snapshot)bytes+=JSON.stringify(identity).length*2;if(bytes>this.maxBytes)return;
    if(this.entries.has(key)){this.bytes-=this.entries.get(key)!.bytes;this.entries.delete(key);}
    while(this.entries.size>=this.maxEntries||this.bytes+bytes>this.maxBytes){const first=this.entries.keys().next().value!;this.bytes-=this.entries.get(first)!.bytes;this.entries.delete(first);this.counters.evictions++;}
    this.entries.set(key,{value:snapshot,clone,bytes,identity});this.bytes+=bytes;this.counters.writes++;
  }
  /** Only execution-owned snapshots enter this method; no mutable external alias is retained. */
  putImmutable<T>(key:string,value:T,identity?:object){this.put(key,immutableJSON(value),v=>v,identity);}
  clear(){this.entries.clear();this.bytes=0;this.counters={hits:0,misses:0,writes:0,evictions:0};}
  stats():CacheStats{return {...this.counters,entries:this.entries.size,bytes:this.bytes};}
}
export const environmentCache=new EnvironmentCache();
export interface ExecutionTelemetry {cacheStats:CacheStats;actualExpansions:number;logicalExpansions:number;layoutTrials:number}
