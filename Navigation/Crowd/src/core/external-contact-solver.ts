import type { CrowdMovementInput, CrowdMovementResult } from './crowd-movement-solver';
import { EXTERNAL_PROFILE, type ExternalInfluences, type MovingCircle } from './external-influences';
import { SweptCircleStaticIntegrator, distanceSquaredToRect, segmentDistanceSquaredToRect, type SweptCircleSlideOutput } from './obstacle-collision';
import { StaticObstacleIndex } from './static-obstacle-index';
import type { Rect } from './types';
import { SpatialHash } from '../algorithms/spatial-hash/spatial-hash';
import { angleDelta } from './math';

/** Velocity contact response + split position stabilization. Only CrowdMovementSolver invokes this pass. */
export class ExternalContactSolver {
  private candidates = new Int32Array(EXTERNAL_PROFILE.candidates + 1);
  private readonly planningCandidates = new Int32Array(EXTERNAL_PROFILE.candidates * 2 + 1);
  private staticAgents = new Int32Array(0);
  private staticCount = 0;
  private pairA = new Int32Array(0);
  private pairB = new Int32Array(0);
  private pairCount = 0;
  private contactGrid: SpatialHash | null = null;
  private readonly integrator = new SweptCircleStaticIntegrator();
  private readonly obstacles: Rect[] = [];
  private readonly sweep: SweptCircleSlideOutput = { x:0,y:0,velocityX:0,velocityY:0,normalX:0,normalY:0,contactCount:0,startedOverlapping:false,exhausted:false };
  private readonly index = new StaticObstacleIndex();
  private nx = 1; private ny = 0;
  private corrected: Uint8Array = new Uint8Array(0);
  private correctionLengths: Float64Array = new Float64Array(0);

  solve(input: CrowdMovementInput, external: ExternalInfluences, vx: Float64Array, vy: Float64Array, headings: Float64Array, result: CrowdMovementResult,
    corrected: Uint8Array, correctionLengths: Float64Array): void {
    this.corrected=corrected;this.correctionLengths=correctionLengths;
    const { current, next } = input, count = current.count, stats = external.stats;
    const motorStep=external.settings.control>0?Math.max(0,input.maxAcceleration)*input.fixedDelta:0;
    // The legacy diameter-sized grid spends most query work traversing empty cells.
    // A contact-horizon-sized grid uses fewer cells without reducing the candidate cap.
    if(input.obstacles.length===0) {
      if (!this.contactGrid || this.contactGrid.agentIndices.length < count) {
        this.contactGrid = new SpatialHash(input.worldWidth,input.worldHeight,12,count);
      }
      input = { ...input, index: this.contactGrid };
    }
    if (this.pairA.length < count*32) { this.pairA = new Int32Array(count*32); this.pairB = new Int32Array(count*32); this.staticAgents=new Int32Array(count); }
    this.index.update(input.obstacles);
    next.copyFrom(current); next.vx.set(vx.subarray(0,count)); next.vy.set(vy.subarray(0,count)); next.heading.set(headings.subarray(0,count));
    let minimumRadius = input.agentRadius, maximumSpeed = 0, maximumOrdinarySpeed = 0;
    for (let a=0;a<count;a++) if (current.active[a]) minimumRadius = Math.min(minimumRadius,this.radius(input,a));
    const speedLimit = Math.min(EXTERNAL_PROFILE.maximumSpeed,minimumRadius*.5*EXTERNAL_PROFILE.maximumSubsteps/input.fixedDelta);
    for (let a=0;a<count;a++) {
      const speed = Math.hypot(next.vx[a]!,next.vy[a]!);
      if (speed > speedLimit) { next.vx[a] = next.vx[a]!*speedLimit/speed; next.vy[a] = next.vy[a]!*speedLimit/speed; stats.speedClamps++; }
      maximumSpeed = Math.max(maximumSpeed,Math.min(speed,speedLimit));
      if(!external.affected[a])maximumOrdinarySpeed=Math.max(maximumOrdinarySpeed,Math.min(speed,speedLimit));
    }
    // Zero-restitution projection retains the tangent and replaces the normal
    // component with proxy motion. The shared 1.5x reserve already covers sqrt(2).
    for (const p of external.proxies) maximumSpeed = Math.max(maximumSpeed,Math.min(speedLimit,Math.hypot(p.toX-p.x,p.toY-p.y)/input.fixedDelta));
    // Leave room for normal pair energy redistribution; clamp only if a later
    // response exceeds this conservative travel bound or the profile ceiling.
    maximumSpeed=Math.min(speedLimit,maximumSpeed*1.5);
    const planningStarted=performance.now();
    input.index.rebuild(next.x,next.y,next.active); stats.rebuilds++;
    // CCD covers absolute travel. Temporal resolution is needed for nearby bodies
    // approaching each other, not for a coherent crowd translating at high speed.
    const absoluteSteps = Math.min(EXTERNAL_PROFILE.maximumSubsteps,Math.max(1,Math.ceil(maximumSpeed*input.fixedDelta/(minimumRadius*.5))));
    this.prepareStatics(input,maximumSpeed*input.fixedDelta+minimumRadius);
    const substeps = this.planSubsteps(input,external,minimumRadius,maximumSpeed,maximumOrdinarySpeed,absoluteSteps);
    stats.planningMs=performance.now()-planningStarted;
    stats.substeps = substeps;
    const dt = input.fixedDelta/substeps;
    result.constraintIterations = EXTERNAL_PROFILE.iterations * substeps; result.maxContacts = 32;
    for (let sub=0;sub<substeps;sub++) {
      let start = performance.now();
      if(sub>0) {input.index.rebuild(next.x,next.y,next.active); stats.rebuilds++;}
      this.pairCount = 0;
      const travel = maximumSpeed*dt;
      for (let a=0;a<count;a++) {
        if (!next.active[a]) continue;
        const range = this.radius(input,a)+(input.maxAgentRadius ?? input.agentRadius)+input.agentGap+2*travel+minimumRadius;
        stats.contactCellUpperBound += this.queryCells(input,next.x[a]!,next.y[a]!,range);
        const n = input.index.queryCandidates(next.x[a]!,next.y[a]!,range,this.candidates);
        result.candidateChecks += n;
        // Saturation is visible, and never falsely reported as collision-free.
        if (n === this.candidates.length) stats.saturatedQueries++;
        let owned = 0;
        for (let k=0;k<Math.min(n,EXTERNAL_PROFILE.candidates);k++) {
          const b = this.candidates[k]!;
          if (b <= a) continue;
          const r = this.radius(input,a)+this.radius(input,b)+input.agentGap+2*travel+minimumRadius;
          if ((next.x[b]!-next.x[a]!)**2+(next.y[b]!-next.y[a]!)**2 > r*r) continue;
          if (owned === 32) { stats.saturatedQueries++; break; }
          this.pairA[this.pairCount] = a; this.pairB[this.pairCount++] = b; owned++;
        }
        result.totalNeighbors += owned; result.maxNeighbors = Math.max(result.maxNeighbors,owned);
      }
      stats.pairs += this.pairCount; result.contactChecks += this.pairCount;
      for (let iteration=0;iteration<EXTERNAL_PROFILE.iterations;iteration++) {
        for (let pair=0;pair<this.pairCount;pair++) {
          const a = this.pairA[pair]!, b = this.pairB[pair]!;
          const dx = next.x[b]!-next.x[a]!, dy = next.y[b]!-next.y[a]!;
          const rvx = next.vx[b]!-next.vx[a]!, rvy = next.vy[b]!-next.vy[a]!;
          const radius = this.radius(input,a)+this.radius(input,b)+input.agentGap;
          if (!this.contactNormal(dx,dy,rvx,rvy,radius,dt,a,b)) continue;
          if (this.wallSeparates(input,next.x[a]!,next.y[a]!,next.x[b]!,next.y[b]!)) continue;
          result.contactConstraints++;
          const closing = rvx*this.nx+rvy*this.ny;
          if (closing >= 0) continue;
          // Unit inertial mass; zero restitution. Sequential pair impulses cannot increase pair energy.
          const impulse = -closing*.5;
          this.corrected[a]=1;this.corrected[b]=1;
          const tx = -this.ny, ty = this.nx;
          const tangent = Math.max(-impulse*input.contactFriction,Math.min(impulse*input.contactFriction,(rvx*tx+rvy*ty)*.5));
          next.vx[a] = next.vx[a]!-impulse*this.nx+tangent*tx; next.vy[a] = next.vy[a]!-impulse*this.ny+tangent*ty;
          next.vx[b] = next.vx[b]!+impulse*this.nx-tangent*tx; next.vy[b] = next.vy[b]!+impulse*this.ny-tangent*ty;
          // Ordinary contact jitter must not perpetually infect the whole crowd
          // with reduced locomotion control. The velocity impulse is always applied;
          // only disturbances beyond the normal motor budget propagate external mode.
          if ((external.affected[a] || external.affected[b]) && impulse*impulse+tangent*tangent>motorStep*motorStep) {
            external.affected[a] = 1; external.affected[b] = 1;
          }
        }
        for (const p of external.proxies) this.proxyContacts(input,external,p,sub/substeps,dt,false);
        for(let k=0;k<this.staticCount;k++)this.constrainStaticVelocity(input,this.staticAgents[k]!,dt);
      }
      stats.contactMs += performance.now()-start;
      start = performance.now();
      for (let a=0;a<count;a++) if (next.active[a]) {
        // Constraints can concentrate pair energy into one body. Keep the broad-phase
        // travel assumption true even after sequential pair/proxy responses.
        const speed=Math.sqrt(next.vx[a]!*next.vx[a]!+next.vy[a]!*next.vy[a]!);
        if (speed>maximumSpeed+1e-8) {next.vx[a]=next.vx[a]!*maximumSpeed/speed;next.vy[a]=next.vy[a]!*maximumSpeed/speed;stats.speedClamps++;}
        this.move(input,a,next.vx[a]!*dt,next.vy[a]!*dt,true,dt);
      }
      stats.staticMs += performance.now()-start;
      start = performance.now();
      // Split corrections never become stored momentum. Each correction is swept against statics.
      for (let iteration=0;iteration<EXTERNAL_PROFILE.iterations;iteration++) {
        for (let pair=0;pair<this.pairCount;pair++) {
          const a = this.pairA[pair]!, b = this.pairB[pair]!;
          const dx = next.x[b]!-next.x[a]!, dy = next.y[b]!-next.y[a]!;
          const radius = this.radius(input,a)+this.radius(input,b)+input.agentGap;
          const distanceSquared = dx*dx+dy*dy;
          if (distanceSquared >= (radius-.001)*(radius-.001)) continue;
          const d = Math.sqrt(distanceSquared), depth = radius-d;
          if (this.wallSeparates(input,next.x[a]!,next.y[a]!,next.x[b]!,next.y[b]!)) continue;
          this.normal(dx,dy,d,a,b);
          const correction = Math.min(depth*.5,minimumRadius*.125), nx=this.nx, ny=this.ny;
          this.move(input,a,-nx*correction,-ny*correction,false,dt);
          this.move(input,b,nx*correction,ny*correction,false,dt);
        }
        for (const p of external.proxies) this.proxyContacts(input,external,p,(sub+1)/substeps,dt,true);
      }
      stats.contactMs += performance.now()-start;
    }
    for (let a=0;a<count;a++) {
      input.solvedVelocityX[a] = next.vx[a]!; input.solvedVelocityY[a] = next.vy[a]!;
      if(this.corrected[a]) result.contactCorrectedAgents++;
      result.maxContactCorrection=Math.max(result.maxContactCorrection,this.correctionLengths[a]!);
      if (external.affected[a]) {
        const speed=Math.hypot(next.vx[a]!,next.vy[a]!);
        const error=Math.hypot(next.vx[a]!-input.desiredVelocityX[a]!,next.vy[a]!-input.desiredVelocityY[a]!);
        const turn=Math.max(0,input.turnSpeed)*Math.PI/180*input.fixedDelta;
        const angle=Math.abs(angleDelta(next.heading[a]!,Math.atan2(next.vy[a]!,next.vx[a]!)));
        const headingCorrection=speed*Math.sin(Math.min(Math.PI/2,Math.max(0,angle-turn)));
        // Returning to navigation means the motor can handle the actual velocity,
        // not that collision-constrained velocity must equal its desired target.
        const motorCanResume=motorStep>0&&headingCorrection+Math.max(0,speed-input.maxSpeed)<=motorStep+1e-9;
        const settled=error<=1e-9&&headingCorrection<=1e-9&&speed<=input.maxSpeed+.001;
        if(speed<=motorStep||motorCanResume||settled)external.affected[a]=0;
      }
    }
    external.stats.contactAffected=result.contactCorrectedAgents;
    for (let pair=0;pair<this.pairCount;pair++) {
      const a=this.pairA[pair]!,b=this.pairB[pair]!;
      if (Math.hypot(next.x[a]!-next.x[b]!,next.y[a]!-next.y[b]!) < this.radius(input,a)+this.radius(input,b)-.01) {
        result.overlapPairs++; input.overlapFlags[a]=1;input.overlapFlags[b]=1;
      }
    }
  }
  private radius(input: CrowdMovementInput,a: number): number { return input.agentRadii?.[a] ?? input.agentRadius; }
  private planSubsteps(input:CrowdMovementInput,external:ExternalInfluences,minimumRadius:number,maximumSpeed:number,ordinarySpeed:number,absoluteSteps:number): number {
    if(absoluteSteps===1) return 1;
    if(this.staticCount>0) {external.stats.planningFallbacks++;return absoluteSteps;}
    const s=input.next, fullTravel=maximumSpeed*input.fixedDelta;
    // Two ordinary bodies can approach at twice their maximum speed. That cheap
    // bound leaves neighborhood queries only for externally driven bodies/proxies.
    let maximumRelativeSquared=4*ordinarySpeed*ordinarySpeed, minimumSteps=1;
    for(let a=0;a<s.count;a++) {
      if(!s.active[a]||!external.affected[a])continue;
      const x=s.x[a]!,y=s.y[a]!;
      const range=this.radius(input,a)+(input.maxAgentRadius??input.agentRadius)+input.agentGap+2*fullTravel+minimumRadius;
      const n=input.index.queryCandidates(x,y,range,this.planningCandidates);
      external.stats.planningCandidates+=n;
      if(n===this.planningCandidates.length) {external.stats.planningFallbacks++;return absoluteSteps;}
      if(n>EXTERNAL_PROFILE.candidates) minimumSteps=2;
      for(let k=0;k<n;k++) {
        const b=this.planningCandidates[k]!;if(b===a)continue;
        const dx=s.x[b]!-x,dy=s.y[b]!-y,r=this.radius(input,a)+this.radius(input,b)+input.agentGap;
        const distanceSquared=dx*dx+dy*dy;
        if(distanceSquared>(r+2*fullTravel+minimumRadius)**2)continue;
        const vx=s.vx[b]!-s.vx[a]!,vy=s.vy[b]!-s.vy[a]!;
        if(dx*vx+dy*vy<0||distanceSquared<r*r)maximumRelativeSquared=Math.max(maximumRelativeSquared,vx*vx+vy*vy);
      }
    }
    for(const p of external.proxies) {
      const vx=(p.toX-p.x)/input.fixedDelta,vy=(p.toY-p.y)/input.fixedDelta;
      const range=p.radius+(input.maxAgentRadius??input.agentRadius)+fullTravel+Math.hypot(p.toX-p.x,p.toY-p.y)+minimumRadius;
      input.index.forEachCandidate(p.x,p.y,range,a=>{
        const dx=s.x[a]!-p.x,dy=s.y[a]!-p.y,rvx=s.vx[a]!-vx,rvy=s.vy[a]!-vy;
        const r=p.radius+this.radius(input,a);
        if(dx*rvx+dy*rvy<0||dx*dx+dy*dy<r*r)maximumRelativeSquared=Math.max(maximumRelativeSquared,rvx*rvx+rvy*rvy);
      });
    }
    return Math.min(absoluteSteps,Math.max(minimumSteps,Math.ceil(1.5*Math.sqrt(maximumRelativeSquared)*input.fixedDelta/minimumRadius)));
  }
  private prepareStatics(input:CrowdMovementInput,travel:number): void {
    this.staticCount=0;
    const s=input.next;
    for(let a=0;a<s.count;a++) {
      if(!s.active[a])continue;
      const x=s.x[a]!,y=s.y[a]!,reach=this.radius(input,a)+input.wallClearance-input.agentRadius+travel;
      let near=x<reach||y<reach||x>input.worldWidth-reach||y>input.worldHeight-reach;
      if(!near&&input.obstacles.length>0) for(const i of this.index.query(x-reach,y-reach,x+reach,y+reach)) {
        if(distanceSquaredToRect(x,y,input.obstacles[i]!)<=reach*reach){near=true;break;}
      }
      if(near)this.staticAgents[this.staticCount++]=a;
    }
  }
  /** Feed a predicted wall stop into the same velocity iterations as agent contacts.
   * Waiting until integration would let following bodies compress into the stopped front. */
  private constrainStaticVelocity(input:CrowdMovementInput,a:number,dt:number): void {
    const s=input.next,x=s.x[a]!,y=s.y[a]!,vx=s.vx[a]!,vy=s.vy[a]!;
    if(vx===0&&vy===0)return;
    const r=this.radius(input,a)+input.wallClearance-input.agentRadius,travel=Math.sqrt(vx*vx+vy*vy)*dt+r+1e-6;
    const endX=x+vx*dt,endY=y+vy*dt;
    this.obstacles.length=0;
    for(const i of this.index.query(x-travel,y-travel,x+travel,y+travel)) {
      const rect=input.obstacles[i]!;
      if(Math.max(x,endX)<rect.x-r||Math.min(x,endX)>rect.x+rect.width+r
        ||Math.max(y,endY)<rect.y-r||Math.min(y,endY)>rect.y+rect.height+r)continue;
      this.obstacles.push(rect);
    }
    if(!this.obstacles.length&&endX>=r&&endY>=r&&endX<=input.worldWidth-r&&endY<=input.worldHeight-r)return;
    input.external!.stats.staticSweeps++;
    this.integrator.integrate(x,y,vx,vy,dt,r,input.worldWidth,input.worldHeight,this.obstacles,4,this.sweep);
    if(this.sweep.contactCount>0) {
      // Allowed displacement reaches the wall instead of freezing before impact.
      s.vx[a]=(this.sweep.x-x)/dt;s.vy[a]=(this.sweep.y-y)/dt;
    }
  }
  private queryCells(input:CrowdMovementInput,x:number,y:number,r:number): number {
    const grid=input.index,size=grid.cellSize;
    return Math.max(0,Math.min(grid.columns-1,Math.floor((x+r)/size))-Math.max(0,Math.floor((x-r)/size))+1)
      * Math.max(0,Math.min(grid.rows-1,Math.floor((y+r)/size))-Math.max(0,Math.floor((y-r)/size))+1);
  }
  private wallSeparates(input:CrowdMovementInput,x:number,y:number,bx:number,by:number): boolean {
    if (!input.obstacles.length) return false;
    for(const i of this.index.query(Math.min(x,bx),Math.min(y,by),Math.max(x,bx),Math.max(y,by))) {
      if(segmentDistanceSquaredToRect(x,y,bx,by,input.obstacles[i]!) <= 1e-12) return true;
    }
    return false;
  }
  private normal(dx:number,dy:number,d:number,a:number,b:number): void {
    if (d > 1e-9) { this.nx=dx/d; this.ny=dy/d; }
    else { const angle=((Math.imul(a+1,73856093)^Math.imul(b+1,19349663))>>>0)/4294967296*Math.PI*2; this.nx=Math.cos(angle);this.ny=Math.sin(angle); }
  }
  private contactNormal(dx:number,dy:number,vx:number,vy:number,r:number,dt:number,a:number,b:number): boolean {
    const c=dx*dx+dy*dy-r*r;
    if (c <= 1e-6) { this.normal(dx,dy,Math.sqrt(dx*dx+dy*dy),a,b); return true; }
    const dot=dx*vx+dy*vy;
    if (dot >= 0 || c + 2*dot*dt > 0) return false;
    const v2=vx*vx+vy*vy, discriminant=dot*dot-v2*c;
    if (v2 < 1e-12 || discriminant < 0) return false;
    const time=(-dot-Math.sqrt(discriminant))/v2;
    if (time < 0 || time > dt) return false;
    const x=dx+vx*time,y=dy+vy*time; this.normal(x,y,Math.sqrt(x*x+y*y),a,b); return true;
  }
  private proxyContacts(input:CrowdMovementInput,external:ExternalInfluences,p:MovingCircle,fraction:number,dt:number,stabilize:boolean): void {
    const state=input.next, px=p.x+(p.toX-p.x)*fraction, py=p.y+(p.toY-p.y)*fraction;
    const pvx=(p.toX-p.x)/input.fixedDelta,pvy=(p.toY-p.y)/input.fixedDelta;
    const range=p.radius+(input.maxAgentRadius ?? input.agentRadius)+EXTERNAL_PROFILE.maximumSpeed*dt*2;
    external.stats.proxyCells += this.queryCells(input,px,py,range);
    // No agent contact candidate cap on proxy support: a wide body must visit its whole footprint.
    input.index.forEachCandidate(px,py,range,a => {
      external.stats.proxyCandidates++;
      const dx=state.x[a]!-px,dy=state.y[a]!-py,d=Math.hypot(dx,dy),r=p.radius+this.radius(input,a);
      if (stabilize) {
        if (d >= r-.001) return;
        this.normal(dx,dy,d,a,0);
        this.move(input,a,this.nx*(r-d),this.ny*(r-d),false,dt);
        const remaining=r-Math.hypot(state.x[a]!-px,state.y[a]!-py);
        if (remaining > EXTERNAL_PROFILE.compressionTolerance) external.stats.crushed++;
        external.affected[a]=1;
      } else {
        if (!this.contactNormal(dx,dy,state.vx[a]!-pvx,state.vy[a]!-pvy,r,dt,a,0)) return;
        const closing=(state.vx[a]!-pvx)*this.nx+(state.vy[a]!-pvy)*this.ny;
        if (closing < 0) { state.vx[a]=state.vx[a]!-closing*this.nx;state.vy[a]=state.vy[a]!-closing*this.ny;external.affected[a]=1;this.corrected[a]=1; }
      }
    });
  }
  private move(input:CrowdMovementInput,a:number,dx:number,dy:number,physical:boolean,dt:number): void {
    const s=input.next,x=s.x[a]!,y=s.y[a]!,r=this.radius(input,a)+input.wallClearance-input.agentRadius;
    if (input.obstacles.length === 0 && x+dx >= r && y+dy >= r && x+dx <= input.worldWidth-r && y+dy <= input.worldHeight-r) {
      s.x[a]=x+dx;s.y[a]=y+dy;
      if(!physical) {this.corrected[a]=1;this.correctionLengths[a]=this.correctionLengths[a]!+Math.sqrt(dx*dx+dy*dy);}
      return;
    }
    const travel=Math.hypot(dx,dy)+r+1e-6;
    this.obstacles.length=0;
    for (const i of this.index.query(x-travel,y-travel,x+travel,y+travel)) {
      const rect=input.obstacles[i]!;
      if(Math.max(x,x+dx)<rect.x-r||Math.min(x,x+dx)>rect.x+rect.width+r
        ||Math.max(y,y+dy)<rect.y-r||Math.min(y,y+dy)>rect.y+rect.height+r)continue;
      this.obstacles.push(rect);
    }
    if (this.obstacles.length === 0 && x+dx >= r && y+dy >= r && x+dx <= input.worldWidth-r && y+dy <= input.worldHeight-r) {
      s.x[a]=x+dx;s.y[a]=y+dy;
      if(!physical) {this.corrected[a]=1;this.correctionLengths[a]=this.correctionLengths[a]!+Math.hypot(dx,dy);}
      return;
    }
    input.external!.stats.staticSweeps++;
    this.integrator.integrate(x,y,dx/dt,dy/dt,dt,r,input.worldWidth,input.worldHeight,this.obstacles,4,this.sweep);
    if(this.sweep.exhausted) input.external!.stats.staticExhaustions++;
    s.x[a]=this.sweep.x;s.y[a]=this.sweep.y;
    if(!physical) {
      const length=Math.hypot(s.x[a]!-x,s.y[a]!-y);
      if(length>1e-9){this.corrected[a]=1;this.correctionLengths[a]=this.correctionLengths[a]!+length;}
    }
    if (physical) { s.vx[a]=this.sweep.velocityX;s.vy[a]=this.sweep.velocityY; }
    // A blocked correction must not restore a velocity pointing through that wall.
    else if (this.sweep.contactCount) {
      const inward=s.vx[a]!*this.sweep.normalX+s.vy[a]!*this.sweep.normalY;
      if (inward<0) { s.vx[a]=s.vx[a]!-inward*this.sweep.normalX;s.vy[a]=s.vy[a]!-inward*this.sweep.normalY; }
    }
    if (this.sweep.startedOverlapping) input.recovery[a]=1;
  }
}
