import {cellId,compareCells,type Vec3} from './analysis';
import {vehicleTransitions,vehicleCorridor,corridorTransition,vehicleFootprint,stateKey,type VehicleState,type VehicleGraph} from './vehicle-motion';
import type {Heading} from './environment-contract';
type WordMask=number[];
function packed(indices:number[]):WordMask {const words:number[]=[];for(const i of indices){const word=i>>>5,bit=1<<(i&31);if(words.length&&words[words.length-2]===word)words[words.length-1]|=bit;else words.push(word,bit);}return words;}
function containsWords(mask:Uint32Array,words:WordMask|undefined){if(!words?.length)return false;for(let i=0;i<words.length;i+=2)if((mask[words[i]]&words[i+1])!==words[i+1])return false;return true;}
function addedCells(mask:Uint32Array,words:WordMask){let sum=0;for(let i=0;i<words.length;i+=2){let bits=words[i+1]&~mask[words[i]];if(!bits)continue;bits-=bits>>>1&0x55555555;bits=(bits&0x33333333)+(bits>>>2&0x33333333);sum+=((bits+(bits>>>4)&0x0f0f0f0f)*0x01010101)>>>24;}return sum;}
interface Edge {next:number;sweep:number[];sweepBits:WordMask;corridor?:number[];corridorBits?:WordMask}
/** Per-execution compiled geometry. Search costs and logical charges remain unchanged. */
export class VehicleDomain {
  readonly cells:Vec3[];readonly states:VehicleState[];readonly ids:Map<string,number>;
  private allowedGraphs=new Map<string,Edge[][]>();
  private footprintBits:WordMask[];private corridorBits:(WordMask|undefined)[];
  private footprints:number[][];private corridors:(number[]|undefined)[];private edges:Edge[][];
  constructor(cells:Vec3[],width:number){
    this.cells=[...new Map(cells.map(c=>[cellId(c),c])).values()].sort(compareCells);this.ids=new Map(this.cells.map((c,i)=>[cellId(c),i]));
    const minX=Math.min(...this.cells.map(c=>c[0])),minZ=Math.min(...this.cells.map(c=>c[2])),nz=Math.max(...this.cells.map(c=>c[2]))-minZ+1,nx=Math.max(...this.cells.map(c=>c[0]))-minX+1,lookup=new Int32Array(nx*nz).fill(-1);
    this.cells.forEach((c,i)=>lookup[(c[0]-minX)*nz+c[2]-minZ]=i);
    const locate=(x:number,z:number)=>x<minX||x>=minX+nx||z<minZ||z>=minZ+nz?-1:lookup[(x-minX)*nz+z-minZ];
    const indexCells=(points:Vec3[],rear:Vec3):number[]|undefined=>{const result:number[]=[];for(const p of points){const i=locate(rear[0]+p[0],rear[2]+p[2]);if(i<0)return;result.push(i);}return result;};
    const templates=Array.from({length:4},(_,h)=>{const s={rear:[0,0,0] as Vec3,heading:h as Heading};return {foot:vehicleFootprint(s),corridor:vehicleCorridor(s,width),edges:vehicleTransitions(s).map(e=>({...e,corridor:corridorTransition(s,e,width)}))};});
    this.states=[];this.footprints=[];this.corridors=[];this.edges=[];
    for(const rear of this.cells)for(let h=0;h<4;h++){
      const template=templates[h];
      this.states.push({rear,heading:h as Heading});this.footprints.push(indexCells(template.foot,rear)??[]);this.corridors.push(indexCells(template.corridor,rear));
      const edges:Edge[]=[];
      for(const t of template.edges){const dest=locate(rear[0]+t.state.rear[0],rear[2]+t.state.rear[2]),sweep=indexCells(t.sweep,rear);if(dest<0||!sweep)continue;const corridor=indexCells(t.corridor,rear);edges.push({next:dest*4+t.state.heading,sweep,sweepBits:packed(sweep),corridor,corridorBits:corridor?packed(corridor):undefined});}this.edges.push(edges);
    }
    this.footprintBits=this.footprints.map(packed);this.corridorBits=this.corridors.map(c=>c?packed(c):undefined);
  }
  private words(mask:Uint8Array){const words=new Uint32Array(Math.ceil(mask.length/32));for(let i=0;i<mask.length;i++)if(mask[i])words[i>>>5]|=1<<(i&31);return words;}
  mask(cells:Iterable<Vec3>){const mask=new Uint8Array(this.cells.length);for(const c of cells){const i=this.ids.get(cellId(c));if(i!==undefined)mask[i]=1;}return mask;}
  extendMask(base:Uint8Array,cells:Vec3[]){const mask=base.slice();for(const c of cells){const i=this.ids.get(cellId(c));if(i===undefined)throw new Error('VEHICLE_MASK_OUTSIDE_DOMAIN');mask[i]=1;}return mask;}
  private contains(mask:Uint8Array,indices:number[]|undefined){if(!indices?.length)return false;for(const i of indices)if(!mask[i])return false;return true;}
  stateValid(s:VehicleState,mask:Uint8Array){const i=this.ids.get(cellId(s.rear));return i!==undefined&&this.contains(mask,this.footprints[i*4+s.heading]);}
  transitions(s:VehicleState,mask:Uint8Array):VehicleState[]{const i=this.ids.get(cellId(s.rear));if(i===undefined)return [];return this.edges[i*4+s.heading].filter(e=>this.contains(mask,e.sweep)&&this.contains(mask,this.footprints[e.next])).map(e=>this.states[e.next]);}
  graph(cells:Vec3[],charge:()=>void):VehicleGraph {
    const mask=this.words(this.mask(cells)),states:VehicleState[]=[],local=new Int32Array(this.states.length).fill(-1),global:number[]=[];
    for(let i=0;i<this.states.length;i++)if(containsWords(mask,this.footprintBits[i])){local[i]=states.length;global.push(i);states.push(this.states[i]);}
    const edges=states.map(()=>[] as number[]),reverseEdges=states.map(()=>[] as number[]);
    for(let i=0;i<states.length;i++){charge();for(const e of this.edges[global[i]]){const j=local[e.next];if(j>=0&&containsWords(mask,e.sweepBits)){edges[i].push(j);reverseEdges[j].push(i);}}}
    return {states,index:new Map(states.map((s,i)=>[stateKey(s),i])),edges,reverseEdges};
  }
  connect(roots:VehicleState[],target:VehicleState,allowedCells:Iterable<Vec3>|Uint8Array,existingCells:Iterable<Vec3>|Uint8Array,charge:()=>void):Vec3[]|undefined{
    const allowed=allowedCells instanceof Uint8Array?allowedCells:this.mask(allowedCells),existing=existingCells instanceof Uint8Array?existingCells:this.mask(existingCells),count=this.states.length,cost=new Float64Array(count).fill(Infinity),previous=new Int32Array(count).fill(-1),previousEdge=new Int8Array(count).fill(-1),closed=new Uint8Array(count);
    const toIndex=(s:VehicleState)=>{const id=this.ids.get(cellId(s.rear));return id===undefined?-1:id*4+s.heading;},goal=toIndex(target);
    const allowedWords=this.words(allowed),existingWords=this.words(existing);
    if(goal<0||!containsWords(allowedWords,this.corridorBits[goal]))return;
    const allowedKey=allowed.join('');let adjacency=this.allowedGraphs.get(allowedKey);
    if(!adjacency){adjacency=this.edges.map(list=>list.filter(e=>containsWords(allowedWords,e.corridorBits)));this.allowedGraphs.set(allowedKey,adjacency);}
    const heap=new DijkstraQueue(cost);
    for(const root of roots){const i=toIndex(root);if(i<0||!this.contains(allowed,this.corridors[i]))continue;cost[i]=0;heap.push(i);}
    while(heap.size){const i=heap.pop();closed[i]=1;charge();
      if(i===goal){const path=new Uint8Array(this.cells.length);for(const c of this.corridors[i]!)path[c]=1;for(let at=i;previous[at]>=0;at=previous[at])for(const c of this.edges[previous[at]][previousEdge[at]].corridor!)path[c]=1;return this.cells.filter((_,c)=>path[c]);}
      const edges=adjacency[i];for(let ei=0;ei<edges.length;ei++){const e=edges[ei];if(closed[e.next])continue;const extra=addedCells(existingWords,e.corridorBits!);
        const value=cost[i]+10+4*extra;if(value<cost[e.next]){cost[e.next]=value;previous[e.next]=i;previousEdge[e.next]=this.edges[i].indexOf(e);heap.push(e.next);}}
    }
  }
}
/** Integer-cost monotone radix queue; one linked entry per state, cost then numeric state. */
export class DijkstraQueue {
 private heads=new Int32Array(33).fill(-1);private next:Int32Array;private previous:Int32Array;private bucket:Int8Array;private priorities:Uint32Array;private last=0;private count=0;
 constructor(private costs:Float64Array){const n=costs.length;this.next=new Int32Array(n).fill(-1);this.previous=new Int32Array(n).fill(-1);this.bucket=new Int8Array(n).fill(-1);this.priorities=new Uint32Array(n);}
 get size(){return this.count;}
 private insert(state:number,bucket:number){const head=this.heads[bucket];this.heads[bucket]=state;this.next[state]=head;this.previous[state]=-1;if(head>=0)this.previous[head]=state;this.bucket[state]=bucket;}
 push(state:number){const priority=this.costs[state]*this.costs.length+state;if(!Number.isSafeInteger(priority)||priority<this.last||priority>0xffffffff)throw new Error('DIJKSTRA_PRIORITY_BOUND');
  const old=this.bucket[state];if(old>=0){const p=this.previous[state],n=this.next[state];if(p>=0)this.next[p]=n;else this.heads[old]=n;if(n>=0)this.previous[n]=p;}else this.count++;
  this.priorities[state]=priority;this.insert(state,32-Math.clz32((priority^this.last)>>>0));
 }
 pop(){if(this.heads[0]<0){let b=1;while(this.heads[b]<0)b++;let minimum=0xffffffff;for(let s=this.heads[b];s>=0;s=this.next[s])minimum=Math.min(minimum,this.priorities[s]);this.last=minimum;let s=this.heads[b];this.heads[b]=-1;while(s>=0){const next=this.next[s];this.insert(s,32-Math.clz32((this.priorities[s]^this.last)>>>0));s=next;}}
  const state=this.heads[0];this.heads[0]=this.next[state];if(this.heads[0]>=0)this.previous[this.heads[0]]=-1;this.bucket[state]=-1;this.count--;return state;
 }
}
