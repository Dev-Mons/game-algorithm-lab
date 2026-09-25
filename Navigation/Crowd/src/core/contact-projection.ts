import type { CrowdMovementInput } from './crowd-movement-solver';
import { segmentDistanceSquaredToRect } from './obstacle-collision';
import { StaticFreeSpace } from './static-free-space';
import { StaticObstacleIndex } from './static-obstacle-index';
const DIRECTIONS=[[-1,0],[1,0],[0,-1],[0,1]] as const;

/** A bounded collective split projection for residual dense contact chains.
 * A group translates rigidly, so internal distances stay unchanged. Its swept
 * frontier includes every neighbor whose compression would worsen. Both the
 * static path and the frontier are validated before any position is published.
 * This repairs geometry only; it never manufactures velocity from displacement. */
export class ContactProjection {
  private first=new Int32Array(0);
  private second=new Int32Array(0);
  private marks=new Uint32Array(0);
  private candidates=new Int32Array(65);
  private overflow=new Int32Array(0);
  private anchorX=new Float64Array(0);
  private anchorY=new Float64Array(0);
  private indexDisplacement=0;
  private epoch=0;
  get bytes():number { return this.first.byteLength+this.second.byteLength+this.marks.byteLength+this.candidates.byteLength+this.overflow.byteLength+this.anchorX.byteLength+this.anchorY.byteLength; }

  solve(input:CrowdMovementInput,index:StaticObstacleIndex,free:StaticFreeSpace,
    pairA:Int32Array,pairB:Int32Array,pairs:number,tolerance:number,minimumRadius:number,
    move:(agent:number,dx:number,dy:number)=>void,proxyFraction=1):number {
    const s=input.next,stats=input.external!.stats;
    if(this.first.length<s.count) {
      this.first=new Int32Array(s.count);this.second=new Int32Array(s.count);this.marks=new Uint32Array(s.count);
      this.anchorX=new Float64Array(s.count);this.anchorY=new Float64Array(s.count);
    }
    input.index.rebuild(s.x,s.y,s.active);stats.rebuilds++;
    this.anchorX.set(s.x);this.anchorY.set(s.y);this.indexDisplacement=0;
    let accepted=0,attempts=0;
    for(let pair=0;pair<pairs&&attempts<16;pair++) {
      const a=pairA[pair]!,b=pairB[pair]!,dx=s.x[b]!-s.x[a]!,dy=s.y[b]!-s.y[a]!;
      const d=Math.hypot(dx,dy),target=this.radius(input,a)+this.radius(input,b)-tolerance;
      if(d>=target||d<1e-9)continue;
      attempts++;stats.projectionAttempts++;
      const amount=Math.min(target-d+1e-5,minimumRadius*.5),mx=dx/d*amount,my=dy/d*amount;
      const first=this.group(input,index,free,a,b,-mx,-my,tolerance,this.first,proxyFraction);
      const second=this.group(input,index,free,b,a,mx,my,tolerance,this.second,proxyFraction);
      if(first<0&&second<0) {
        // A radial correction may point through a wall although tangential
        // separation is possible. Try bounded, non-approaching axis translations.
        let repaired=false;
        for(let side=0;side<2&&!repaired;side++)for(const [ux,uy] of DIRECTIONS) {
          const dot=(side===0?1:-1)*(dx*ux+dy*uy);
          if(dot>1e-10)continue;
          const distance=Math.min(minimumRadius*.5,dot+Math.sqrt(dot*dot+target*target-d*d)+1e-5);
          const tx=ux*distance,ty=uy*distance;
          const members=this.group(input,index,free,side===0?a:b,side===0?b:a,tx,ty,tolerance,this.first,proxyFraction);
          if(members<0)continue;
          this.translate(input,this.first,members,tx,ty,move);
          stats.projectedBodies+=members;stats.projectionGroups++;accepted++;
          repaired=true;break;
        }
        continue;
      }
      let disjoint=first>=0&&second>=0;
      if(disjoint)for(let i=0;i<first;i++)if(this.marks[this.first[i]!]===this.epoch){disjoint=false;break;}
      if(disjoint) {
        // Unit mass per body: opposite translations preserve the group's center
        // of mass. Each is shorter than its already validated full translation.
        const firstWeight=second/(first+second),secondWeight=first/(first+second);
        this.translate(input,this.first,first,-mx*firstWeight,-my*firstWeight,move);
        this.translate(input,this.second,second,mx*secondWeight,my*secondWeight,move);
        stats.projectedBodies+=first+second;
      } else if(first>=0&&(second<0||first<=second)) {
        this.translate(input,this.first,first,-mx,-my,move);
        stats.projectedBodies+=first;
      } else {
        this.translate(input,this.second,second,mx,my,move);
        stats.projectedBodies+=second;
      }
      accepted++;stats.projectionGroups++;
    }
    // Queries above include every body's displacement from the frozen index.
    // Publish one fresh index for the caller's next pair-list construction.
    if(accepted){input.index.rebuild(s.x,s.y,s.active);stats.rebuilds++;}
    return accepted;
  }

  private translate(input:CrowdMovementInput,ids:Int32Array,count:number,dx:number,dy:number,move:(a:number,dx:number,dy:number)=>void):void {
    const s=input.next;
    for(let i=0;i<count;i++) {
      const a=ids[i]!;move(a,dx,dy);
      const x=s.x[a]!-this.anchorX[a]!,y=s.y[a]!-this.anchorY[a]!;
      this.indexDisplacement=Math.max(this.indexDisplacement,Math.sqrt(x*x+y*y));
    }
  }

  private group(input:CrowdMovementInput,index:StaticObstacleIndex,free:StaticFreeSpace,
    seed:number,excluded:number,dx:number,dy:number,tolerance:number,queue:Int32Array,proxyFraction:number):number {
    this.epoch=(this.epoch+1)>>>0;
    if(!this.epoch){this.marks.fill(0);this.epoch=1;}
    const s=input.next,travel=Math.hypot(dx,dy),travelSquared=dx*dx+dy*dy;
    let count=1;queue[0]=seed;this.marks[seed]=this.epoch;
    for(let cursor=0;cursor<count;cursor++) {
      const a=queue[cursor]!,x=s.x[a]!,y=s.y[a]!,radius=this.radius(input,a);
      const clearance=radius+input.wallClearance-input.agentRadius,ex=x+dx,ey=y+dy;
      if(ex<clearance-1e-8||ey<clearance-1e-8||ex>input.worldWidth-clearance+1e-8||ey>input.worldHeight-clearance+1e-8)return -1;
      for(const proxy of input.external!.proxies) {
        const px=proxy.x+(proxy.toX-proxy.x)*proxyFraction,py=proxy.y+(proxy.toY-proxy.y)*proxyFraction;
        const rx=px-x,ry=py-y,old=rx*rx+ry*ry;
        const t=Math.max(0,Math.min(1,(rx*dx+ry*dy)/travelSquared));
        const sx=rx-dx*t,sy=ry-dy*t,minimum=sx*sx+sy*sy,target=radius+proxy.radius-tolerance;
        if(minimum<target*target-1e-10&&minimum<old-1e-10)return -1;
      }
      if(!(free.contains(a,x,y)&&free.contains(a,ex,ey))) {
        for(const obstacle of index.querySegment(x,y,ex,ey,clearance)) {
          if(segmentDistanceSquaredToRect(x,y,ex,ey,input.obstacles[obstacle]!)<Math.max(0,clearance-1e-8)**2)return -1;
        }
      }
      // The query center is current, while indexed neighbors are at anchors.
      // One neighbor-displacement bound (not an external-force radius) covers
      // all moved frontiers. Exact current-position tests below decide inclusion.
      const range=radius+(input.maxAgentRadius??input.agentRadius)+travel+this.indexDisplacement+1e-6;
      let candidates=this.candidates,n=input.index.queryCandidates(x,y,range,candidates);
      if(n===candidates.length) {
        if(this.overflow.length<s.count)this.overflow=new Int32Array(s.count);
        candidates=this.overflow;n=input.index.queryCandidates(x,y,range,candidates);
      }
      input.external!.stats.projectionCandidates+=n;
      for(let k=0;k<n;k++) {
        const b=candidates[k]!;
        if(this.marks[b]===this.epoch)continue;
        const rx=s.x[b]!-x,ry=s.y[b]!-y,oldSquared=rx*rx+ry*ry;
        const t=Math.max(0,Math.min(1,(rx*dx+ry*dy)/travelSquared));
        const nx=rx-dx*t,ny=ry-dy*t,minimum=nx*nx+ny*ny;
        const target=radius+this.radius(input,b)-tolerance;
        // Existing compression may improve or stay unchanged, never worsen.
        if(minimum>=target*target-1e-10||minimum>=oldSquared-1e-10)continue;
        if(b===excluded)return -1;
        this.marks[b]=this.epoch;queue[count++]=b;
      }
    }
    return count;
  }
  private radius(input:CrowdMovementInput,a:number):number { return input.agentRadii?.[a]??input.agentRadius; }
}
