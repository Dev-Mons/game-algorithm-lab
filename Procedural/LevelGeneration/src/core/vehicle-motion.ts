import {add,cellId,compareCells,type Vec3} from './analysis';
import {HEADING_VECTORS,type Heading} from './environment-contract';
export interface VehicleState {rear:Vec3;heading:Heading}
export interface VehicleTransition {state:VehicleState;sweep:Vec3[];move:'forward'|'reverse'|'left'|'right'|'reverse-left'|'reverse-right'}
export const stateKey=(s:VehicleState)=>`${cellId(s.rear)}|${s.heading}`;
export const compareStates=(a:VehicleState,b:VehicleState)=>compareCells(a.rear,b.rear)||a.heading-b.heading;
export function vehicleFootprint(s:VehicleState):Vec3[]{return [s.rear,add(s.rear,HEADING_VECTORS[s.heading])];}
const unique=(cells:Vec3[])=>[...new Map(cells.map(c=>[cellId(c),c])).values()].sort(compareCells);
export function turnSweep(rear:Vec3,from:Heading,to:Heading):Vec3[]{
  const a=HEADING_VECTORS[from],b=HEADING_VECTORS[to],cells:Vec3[]=[];
  for(let i=-1;i<=2;i++)for(let j=-1;j<=2;j++)cells.push([rear[0]+i*a[0]+j*b[0],rear[1],rear[2]+i*a[2]+j*b[2]]);
  return cells.sort(compareCells);
}
export function vehicleTransitions(s:VehicleState):VehicleTransition[]{
  const d=HEADING_VECTORS[s.heading],result:VehicleTransition[]=[];
  for(const sign of [1,-1]){const state={rear:add(s.rear,d.map(n=>n*sign) as Vec3),heading:s.heading};result.push({state,sweep:unique([...vehicleFootprint(s),...vehicleFootprint(state)]),move:sign===1?'forward':'reverse'});}
  for(const turn of [-1,1]){const h=((s.heading+turn+4)%4) as Heading,state={rear:add(add(s.rear,d),HEADING_VECTORS[h]),heading:h};result.push({state,sweep:turnSweep(s.rear,s.heading,h),move:turn===-1?'left':'right'});}
  for(const turn of [-1,1]){const h=((s.heading-turn+4)%4) as Heading,prev=HEADING_VECTORS[h],state={rear:[s.rear[0]-prev[0]-d[0],s.rear[1],s.rear[2]-prev[2]-d[2]] as Vec3,heading:h};result.push({state,sweep:turnSweep(state.rear,h,s.heading),move:turn===-1?'reverse-left':'reverse-right'});}
  return result;
}
export function validState(s:VehicleState,mask:ReadonlySet<string>):boolean{return s.rear[1]===0&&vehicleFootprint(s).every(c=>mask.has(cellId(c)));}
export function validTransitions(s:VehicleState,mask:ReadonlySet<string>):VehicleTransition[]{return vehicleTransitions(s).filter(t=>validState(t.state,mask)&&t.sweep.every(c=>mask.has(cellId(c))));}
export function vehicleCorridor(s:VehicleState,width:number):Vec3[]{
  const side=HEADING_VECTORS[(s.heading+1)%4],cells:Vec3[]=[],left=Math.floor((width-1)/2),right=Math.ceil((width-1)/2);
  for(const c of vehicleFootprint(s))for(let offset=-left;offset<=right;offset++)cells.push([c[0]+side[0]*offset,c[1],c[2]+side[2]*offset]);
  return unique(cells);
}
export function corridorTransition(s:VehicleState,t:VehicleTransition,width:number):Vec3[]{return unique([...vehicleCorridor(s,width),...vehicleCorridor(t.state,width),...t.sweep]);}
export interface VehicleGraph {states:VehicleState[];index:Map<string,number>;edges:number[][];reverseEdges:number[][]}
export function buildVehicleGraph(cells:Vec3[],charge:()=>void=()=>{}):VehicleGraph {
  const mask=new Set(cells.map(cellId)),states:VehicleState[]=[];
  for(const rear of unique(cells))for(let h=0;h<4;h++){const state={rear,heading:h as Heading};if(validState(state,mask))states.push(state);}
  const index=new Map(states.map((s,i)=>[stateKey(s),i])),edges=states.map(()=>[] as number[]),reverseEdges=states.map(()=>[] as number[]);
  states.forEach((s,i)=>{charge();for(const t of validTransitions(s,mask)){const j=index.get(stateKey(t.state))!;edges[i].push(j);reverseEdges[j].push(i);}});
  return {states,index,edges,reverseEdges};
}
export interface VehicleReachability {distance:Int32Array;predecessor:Int32Array;root:Int32Array}
export function vehicleBFS(graph:VehicleGraph,roots:number[],reverse=false,charge:()=>void=()=>{}):VehicleReachability {
  const distance=new Int32Array(graph.states.length).fill(-1),predecessor=new Int32Array(graph.states.length).fill(-1),root=new Int32Array(graph.states.length).fill(-1),queue:number[]=[];
  for(const i of roots)if(i>=0&&distance[i]<0){distance[i]=0;root[i]=i;queue.push(i);}
  for(let at=0;at<queue.length;at++){const i=queue[at];charge();for(const j of (reverse?graph.reverseEdges:graph.edges)[i])if(distance[j]<0){distance[j]=distance[i]+1;predecessor[j]=i;root[j]=root[i];queue.push(j);}}
  return {distance,predecessor,root};
}
export function vehiclePath(graph:VehicleGraph,search:VehicleReachability,index:number,reverse=false):VehicleState[]{
  if(search.distance[index]<0)return [];
  const path:VehicleState[]=[];for(let i=index;i>=0;i=search.predecessor[i])path.push(graph.states[i]);
  return reverse?path:path.reverse();
}
/** Decrease-key heap: a state has at most one queue entry per search. */
export class StateHeap {
  private heap:string[]=[];private positions=new Map<string,number>();
  constructor(private compare:(a:string,b:string)=>number){}
  get size(){return this.heap.length;}
  private swap(a:number,b:number){[this.heap[a],this.heap[b]]=[this.heap[b],this.heap[a]];this.positions.set(this.heap[a],a);this.positions.set(this.heap[b],b);}
  pushOrDecrease(key:string){let at=this.positions.get(key);if(at===undefined){at=this.heap.length;this.heap.push(key);this.positions.set(key,at);}while(at>0){const parent=Math.floor((at-1)/2);if(this.compare(this.heap[parent],key)<=0)break;this.swap(at,parent);at=parent;}}
  pop(){if(!this.heap.length)return undefined;const key=this.heap[0],last=this.heap.pop()!;this.positions.delete(key);if(this.heap.length){this.heap[0]=last;this.positions.set(last,0);let i=0;for(;;){let child=i*2+1;if(child>=this.heap.length)break;if(child+1<this.heap.length&&this.compare(this.heap[child+1],this.heap[child])<0)child++;if(this.compare(this.heap[i],this.heap[child])<=0)break;this.swap(i,child);i=child;}}return key;}
}
