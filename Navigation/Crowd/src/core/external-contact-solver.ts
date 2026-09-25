import type { CrowdMovementInput, CrowdMovementResult } from './crowd-movement-solver';
import { EXTERNAL_PROFILE, type ExternalInfluences, type MovingCircle } from './external-influences';
import { SweptCircleStaticIntegrator, distanceSquaredToRect, segmentDistanceSquaredToRect, type SweptCircleSlideOutput } from './obstacle-collision';
import { StaticObstacleIndex } from './static-obstacle-index';
import { StaticFreeSpace } from './static-free-space';
import type { Rect } from './types';
import { SpatialHash } from '../algorithms/spatial-hash/spatial-hash';
import { angleDelta } from './math';
import { ContactKernel } from './contact-kernel';
import { WarmContactCache } from './warm-contact-cache';
import { ContactProjection } from './contact-projection';
import { ContactColoring } from './contact-coloring';
import { ContactWorkerFailure } from './contact-worker-pool';

/** Velocity contact response + split position stabilization. Only CrowdMovementSolver invokes this pass. */
export class ExternalContactSolver {
  private kernel:ContactKernel|null|undefined;
  private kernelInput:CrowdMovementInput|null=null;
  private kernelDelta=0;
  private readonly projection=new ContactProjection();
  private readonly coloring=new ContactColoring();
  private candidates = new Int32Array(EXTERNAL_PROFILE.candidates + 1);
  private readonly planningCandidates = new Int32Array(EXTERNAL_PROFILE.candidates * 2 + 1);
  private staticAgents = new Int32Array(0);
  private staticCount = 0;
  private pairA: Int32Array = new Int32Array(0);
  private pairB: Int32Array = new Int32Array(0);
  private pairCount = 0;
  private pairRadius: Float64Array = new Float64Array(0);
  private pairDX: Float64Array = new Float64Array(0);
  private pairDY: Float64Array = new Float64Array(0);
  private velocityPairs = new Int32Array(0);
  private velocityPairCount = 0;
  private velocityAnchorX = new Float64Array(0);
  private velocityAnchorY = new Float64Array(0);
  private warmCorrected = new Uint8Array(0);
  private warmAffected = new Uint8Array(0);
  private trialAffected = new Uint8Array(0);
  private trialCorrected = new Uint8Array(0);
  private trialLengths = new Float64Array(0);
  private readonly contactCache = new WarmContactCache();
  private pairContacts: Int32Array = new Int32Array(0);
  reset():void { this.contactCache.reset();this.kernelInput=null;this.kernel?.detach(); }
  dispose():void {this.reset();this.kernel?.dispose();this.kernel=null;}
  prewarm():void {if(ContactKernel.workersSupported&&this.kernel===undefined)this.initializeKernel(true);}
  hashState(mix:(value:number)=>void):void { this.contactCache.hashState(mix); }
  private overflowCandidates = new Int32Array(0);
  private anchorX = new Float64Array(0);
  private anchorY = new Float64Array(0);
  private contactGrid: SpatialHash | null = null;
  private readonly integrator = new SweptCircleStaticIntegrator();
  private readonly obstacles: Rect[] = [];
  private readonly sweep: SweptCircleSlideOutput = { x:0,y:0,velocityX:0,velocityY:0,normalX:0,normalY:0,contactCount:0,startedOverlapping:false,exhausted:false };
  private readonly index = new StaticObstacleIndex();
  private readonly freeSpace = new StaticFreeSpace(this.index);
  private nx = 1; private ny = 0;
  private corrected: Uint8Array = new Uint8Array(0);
  private correctionLengths: Float64Array = new Float64Array(0);

  solve(input: CrowdMovementInput, external: ExternalInfluences, vx: Float64Array, vy: Float64Array, headings: Float64Array, result: CrowdMovementResult,
    corrected: Uint8Array, correctionLengths: Float64Array, forcedSubsteps?:number, attempt=0): void {
    const retryInput=input;
    this.corrected=corrected;this.correctionLengths=correctionLengths;
    const current=input.current, output=input.next, count=current.count, stats=external.stats;
    const attemptStarted=performance.now();
    stats.contactAttempts++;
    let next=output;
    const motorStep=external.settings.control>0?Math.max(0,input.maxAcceleration)*input.fixedDelta:0;
    // The legacy diameter-sized grid spends most query work traversing empty cells.
    // A contact-horizon-sized grid uses fewer cells without reducing the candidate cap.
    {
      if (!this.contactGrid || this.contactGrid.agentIndices.length < count) {
        this.contactGrid = new SpatialHash(input.worldWidth,input.worldHeight,12,count);
      }
      input = { ...input, index: this.contactGrid };
    }
    if (this.staticAgents.length < count) {
      this.pairA = new Int32Array(count*8); this.pairB = new Int32Array(count*8); this.staticAgents=new Int32Array(count);
      this.anchorX=new Float64Array(count);this.anchorY=new Float64Array(count);
      this.velocityAnchorX=new Float64Array(count);this.velocityAnchorY=new Float64Array(count);
      this.warmCorrected=new Uint8Array(count);
      this.warmAffected=new Uint8Array(count);
      this.trialAffected=new Uint8Array(count);this.trialCorrected=new Uint8Array(count);this.trialLengths=new Float64Array(count);
    }
    if(external.backend==='auto'&&this.kernel===undefined)this.initializeKernel(count>=5000);
    const kernel=external.backend==='auto'?this.kernel:null;
    if(kernel) {
      kernel.ensure(count,this.pairA.length,input.index.cellStart.length);
      next=kernel.attach(output);input={...input,next};
      this.corrected=kernel.arrays.corrected;this.correctionLengths=kernel.arrays.lengths;
      this.corrected.set(corrected);this.correctionLengths.set(correctionLengths);
      if(input.agentRadii)kernel.arrays.radii.set(input.agentRadii);else kernel.arrays.radii.fill(input.agentRadius);
    }
    this.index.update(input.obstacles);
    this.freeSpace.begin(count,input.worldWidth,input.worldHeight);
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
    const inputMaximumSpeed=maximumSpeed;
    // Leave room for normal pair energy redistribution; clamp only if a later
    // response exceeds this conservative travel bound or the profile ceiling.
    maximumSpeed=Math.min(speedLimit,maximumSpeed*1.5);
    const planningStarted=performance.now();
    input.index.rebuild(next.x,next.y,next.active); stats.rebuilds++;
    // CCD covers absolute travel. Temporal resolution is needed for nearby bodies
    // approaching each other, not for a coherent crowd translating at high speed.
    const absoluteSteps = Math.min(EXTERNAL_PROFILE.maximumSubsteps,Math.max(1,Math.ceil(maximumSpeed*input.fixedDelta/(minimumRadius*.5))));
    this.prepareStatics(input,maximumSpeed*input.fixedDelta+minimumRadius);
    const verifySingleStep=forcedSubsteps===undefined&&absoluteSteps===2&&inputMaximumSpeed*input.fixedDelta<=minimumRadius*.5;
    let substeps = forcedSubsteps??(verifySingleStep?1:this.planSubsteps(input,external,minimumRadius,maximumSpeed,maximumOrdinarySpeed,absoluteSteps));
    const unresolvedBefore=stats.unresolvedCompression,budgetBefore=stats.positionBudgetExhaustions,maxExhaustedBefore=stats.maxExhaustedPenetration;
    if(attempt===0) {
      this.contactCache.saveCurrent();this.trialAffected.set(external.affected);
      this.trialCorrected.set(corrected);this.trialLengths.set(correctionLengths);
    }
    stats.planningMs+=performance.now()-planningStarted;
    stats.substeps = substeps;
    let dt = input.fixedDelta/substeps;
    this.kernelInput=input;this.kernelDelta=dt;
    if(kernel)this.freeSpace.copyCertificates(kernel.arrays.freeX,kernel.arrays.freeY,kernel.arrays.freeRadius);
    result.constraintIterations = EXTERNAL_PROFILE.iterations * substeps;
    kernel?.beginFrame();
    try {for (let sub=0;sub<substeps;sub++) {
      stats.attemptedSubsteps++;
      let start = performance.now();
      if(sub>0) {
        input.index.rebuild(next.x,next.y,next.active); stats.rebuilds++;
        this.prepareStatics(input,maximumSpeed*dt+minimumRadius);
        if(kernel)this.freeSpace.copyCertificates(kernel.arrays.freeX,kernel.arrays.freeY,kernel.arrays.freeRadius);
      }
      const travel = maximumSpeed*dt;
      let pairMargin=travel+minimumRadius*.5;
      this.buildPairs(input,external,result,2*pairMargin,kernel??undefined);
      if(kernel) {
        this.pairRadius=kernel.arrays.radius;this.pairDX=kernel.arrays.dx;this.pairDY=kernel.arrays.dy;
      } else if(this.pairRadius.length<this.pairA.length) {
        this.pairRadius=new Float64Array(this.pairA.length);this.pairDX=new Float64Array(this.pairA.length);this.pairDY=new Float64Array(this.pairA.length);
      }
      if(this.velocityPairs.length<this.pairA.length)this.velocityPairs=new Int32Array(this.pairA.length);
      this.velocityPairCount=0;
      if(!kernel)for(let pair=0;pair<this.pairCount;pair++) {
        const a=this.pairA[pair]!,b=this.pairB[pair]!,dx=next.x[b]!-next.x[a]!,dy=next.y[b]!-next.y[a]!;
        const radius=this.radius(input,a)+this.radius(input,b)+input.agentGap;
        this.pairRadius[pair]=radius;this.pairDX[pair]=dx;this.pairDY[pair]=dy;
      }
      this.prepareWarmContacts(input,dt,kernel??undefined);
      if(kernel) {
        this.uploadKernelPairs(kernel,count);
        const data=kernel.arrays;
        for(let pair=0;pair<this.pairCount;pair++) {
          const c=this.pairContacts[pair]!,values=this.contactCache.values;if(c<0)continue;
          data.kind[pair]=1;data.nx[pair]=values[c+2]!;data.ny[pair]=values[c+3]!;data.normal[pair]=values[c]!;data.tangent[pair]=values[c+1]!;
        }
      }
      this.buildVelocityWorkset(input,dt,kernel??undefined);
      let velocityLimit:number=EXTERNAL_PROFILE.velocityIterations,fullVelocitySet=false;
      for (let iteration=0;iteration<velocityLimit;iteration++) {
        let maximumImpulse=0;
        if(kernel) {
          kernel.arrays.affected.set(external.affected);
          stats.workerThreads=Math.max(stats.workerThreads,kernel.workerThreads);
          maximumImpulse=kernel.solveVelocity(this.velocityPairCount,dt,input.contactFriction,motorStep*motorStep);
          if(kernel.lastParallel){stats.parallelPasses++;stats.parallelPhaseMs+=kernel.lastPhaseMs;}
          external.affected.set(kernel.arrays.affected);
          result.contactConstraints+=kernel.constraints;
          stats.energyDampedContacts+=kernel.energyDamped;
        } else for (let slot=0;slot<this.velocityPairCount;slot++) {
          const pair=this.velocityPairs[slot]!;
          const a = this.pairA[pair]!, b = this.pairB[pair]!;

          const rvx = next.vx[b]!-next.vx[a]!, rvy = next.vy[b]!-next.vy[a]!;
          const cached=this.pairContacts[pair]!,values=this.contactCache.values;
          if(cached>=0){this.nx=values[cached+2]!;this.ny=values[cached+3]!;}
          else {
            if (!this.contactNormal(this.pairDX[pair]!,this.pairDY[pair]!,rvx,rvy,this.pairRadius[pair]!,dt,a,b)) continue;
            if (!(this.freeSpace.contains(a,next.x[a]!,next.y[a]!)&&this.freeSpace.contains(a,next.x[b]!,next.y[b]!))
              && this.wallSeparates(input,next.x[a]!,next.y[a]!,next.x[b]!,next.y[b]!)) continue;
          }
          result.contactConstraints++;
          const closing = rvx*this.nx+rvy*this.ny;
          if (closing >= 0 && (cached<0||values[cached]===0)) continue;
          // Accumulated nonnegative normal impulses with a friction cone.
          // Negative deltas release a previous warm-start guess.
          const oldNormal=cached>=0?values[cached]!:0;
          let normal=Math.max(0,oldNormal-closing*.5);
          let impulse=normal-oldNormal;
          const tx = -this.ny, ty = this.nx;
          const oldTangent=cached>=0?values[cached+1]!:0;
          let newTangent=Math.max(-normal*input.contactFriction,Math.min(normal*input.contactFriction,oldTangent+(rvx*tx+rvy*ty)*.5));
          let tangent=newTangent-oldTangent;
          // A shrinking friction cone can force release of a warm tangential
          // impulse against the current slip, increasing kinetic energy. Both
          // endpoints of this update are feasible; shorten along their convex
          // segment to the energy minimum instead of injecting that energy.
          if(cached>=0&&impulse<0&&Math.abs(oldTangent)>normal*input.contactFriction) {
            const work=impulse*closing-tangent*(rvx*tx+rvy*ty),length=impulse*impulse+tangent*tangent;
            if(work+length>0&&length>0) {
              const scale=work<0?Math.min(1,-work/(2*length)):0;
              impulse*=scale;tangent*=scale;normal=oldNormal+impulse;newTangent=oldTangent+tangent;stats.energyDampedContacts++;
            }
          }
          maximumImpulse=Math.max(maximumImpulse,impulse*impulse+tangent*tangent);
          if(cached>=0){values[cached]=normal;values[cached+1]=newTangent;}
          if(impulse===0&&tangent===0)continue;
          this.corrected[a]=1;this.corrected[b]=1;
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
        stats.velocityPasses++;
        stats.velocityPairVisits+=this.velocityPairCount;
        if(!fullVelocitySet&&!this.velocityWorksetValid(input,dt,kernel??undefined)) {
          if(iteration+1===velocityLimit) {
            // Finish on the complete conservative pair set if the final update
            // invalidates the swept frontier. Never integrate a stale workset.
            fullVelocitySet=true;velocityLimit++;
            this.velocityPairCount=this.pairCount;
            for(let pair=0;pair<this.pairCount;pair++)this.velocityPairs[pair]=pair;
            stats.velocityFallbacks++;
            if(kernel){kernel.arrays.velocityPairs.set(this.velocityPairs.subarray(0,this.velocityPairCount));kernel.configureVelocityColors(this.velocityPairCount);}
          } else this.buildVelocityWorkset(input,dt,kernel??undefined);
          continue;
        }
        if(iteration>=EXTERNAL_PROFILE.iterations-1&&maximumImpulse<.0625)break;
      }
      if(kernel)for(let pair=0;pair<this.pairCount;pair++) {
        const c=this.pairContacts[pair]!;if(c>=0){this.contactCache.values[c]=kernel.arrays.normal[pair]!;this.contactCache.values[c+1]=kernel.arrays.tangent[pair]!;}
      }
      if(sub===0&&verifySingleStep) {
        const speed=minimumRadius*.5/input.fixedDelta,limit=speed*speed;
        let fits=true;
        for(let a=0;a<count;a++)if(next.active[a]&&next.vx[a]!*next.vx[a]!+next.vy[a]!*next.vy[a]!>limit){fits=false;break;}
        if(fits)stats.singleStepVerified++;
        else {substeps=absoluteSteps;dt=input.fixedDelta/substeps;this.kernelDelta=dt;stats.substeps=substeps;stats.singleStepFallbacks++;}
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
      for (let iteration=0;iteration<EXTERNAL_PROFILE.positionIterations;iteration++) {
        stats.stabilizationPasses++;
        if(kernel) {
          stats.workerThreads=Math.max(stats.workerThreads,kernel.workerThreads);
          kernel.solvePosition(this.pairCount,input.agentGap,minimumRadius);
          if(kernel.lastParallel){stats.parallelPasses++;stats.parallelPhaseMs+=kernel.lastPhaseMs;}
        }
        else for (let pair=0;pair<this.pairCount;pair++) {
          const a = this.pairA[pair]!, b = this.pairB[pair]!;
          const dx = next.x[b]!-next.x[a]!, dy = next.y[b]!-next.y[a]!;
          const radius = this.radius(input,a)+this.radius(input,b)+input.agentGap;
          const distanceSquared = dx*dx+dy*dy;
          if (distanceSquared >= (radius-.001)*(radius-.001)) continue;
          const d = Math.sqrt(distanceSquared), depth = radius-d;
          if (!this.freeSpace.contains(a,next.x[a]!,next.y[a]!) || !this.freeSpace.contains(a,next.x[b]!,next.y[b]!)) {
            if(this.wallSeparates(input,next.x[a]!,next.y[a]!,next.x[b]!,next.y[b]!))continue;
          }
          this.normal(dx,dy,d,a,b);
          const correction = Math.min(depth*.5,minimumRadius*.125), nx=this.nx, ny=this.ny;
          this.move(input,a,-nx*correction,-ny*correction,false,dt);
          this.move(input,b,nx*correction,ny*correction,false,dt);
        }
        for (const p of external.proxies) this.proxyContacts(input,external,p,(sub+1)/substeps,dt,true);
        // Keep the swept-pair superset valid after mutable position repairs.
        // Both endpoints may move by pairMargin from the query coordinates.
        const moved=this.maximumPairDisplacement(input,kernel??undefined);
        if(moved>pairMargin) {
          input.index.rebuild(next.x,next.y,next.active);stats.rebuilds++;
          pairMargin=minimumRadius*.5;
          this.buildPairs(input,external,result,2*pairMargin,kernel??undefined);
          if(kernel)this.uploadKernelPairs(kernel,count);
        }
        // Check the published positions, not a pre-correction residual. Later
        // constraints can compress an earlier pair in a sequential sweep.
        if(iteration>=EXTERNAL_PROFILE.iterations-1&&!this.hasResidualCompression(input,EXTERNAL_PROFILE.positionTolerance,kernel??undefined))break;
        if(iteration===7||iteration===15||iteration===31||iteration===63||iteration===95||iteration===127) {
          if(this.projection.solve(input,this.index,this.freeSpace,this.pairA,this.pairB,this.pairCount,
            EXTERNAL_PROFILE.positionTolerance,minimumRadius,(a,dx,dy)=>this.move(input,a,dx,dy,false,dt),(sub+1)/substeps)) {
            pairMargin=minimumRadius*.5;
            this.buildPairs(input,external,result,2*pairMargin,kernel??undefined);
            if(kernel)this.uploadKernelPairs(kernel,count);
            if(!this.hasResidualCompression(input,EXTERNAL_PROFILE.positionTolerance,kernel??undefined))break;
          }
        }
        if(iteration===EXTERNAL_PROFILE.positionIterations-1) {
          stats.positionBudgetExhaustions++;
          let maximum=0;
          for(let pair=0;pair<this.pairCount;pair++) {
            const a=this.pairA[pair]!,b=this.pairB[pair]!;
            maximum=Math.max(maximum,this.radius(input,a)+this.radius(input,b)-Math.hypot(next.x[a]!-next.x[b]!,next.y[a]!-next.y[b]!));
          }
          stats.maxExhaustedPenetration=Math.max(stats.maxExhaustedPenetration,maximum);
          if(maximum>EXTERNAL_PROFILE.compressionTolerance)stats.unresolvedCompression++;
        }

      }
      stats.contactMs += performance.now()-start;
      if(stats.positionBudgetExhaustions>budgetBefore&&substeps<EXTERNAL_PROFILE.maximumSubsteps&&attempt+1<EXTERNAL_PROFILE.maximumContactAttempts)break;
    }} catch(error) {
      if(!(error instanceof ContactWorkerFailure))throw error;
      stats.workerFailures++;stats.workerDiscardedMs+=performance.now()-attemptStarted;
      stats.parallelPhaseMs+=kernel?.lastPhaseMs??0;
      this.contactCache.restoreCurrent();external.affected.set(this.trialAffected);
      corrected.set(this.trialCorrected);correctionLengths.set(this.trialLengths);
      stats.unresolvedCompression=unresolvedBefore;stats.positionBudgetExhaustions=budgetBefore;stats.maxExhaustedPenetration=maxExhaustedBefore;
      // Termination can be asynchronous. Abandon every view of that shared
      // arena so a late worker write cannot reach the synchronous CPU retry.
      kernel?.dispose();this.kernel=null;this.kernelInput=null;
      this.pairA=new Int32Array(this.pairA.length);this.pairB=new Int32Array(this.pairB.length);
      this.pairRadius=new Float64Array(0);this.pairDX=new Float64Array(0);this.pairDY=new Float64Array(0);
      return this.solve(retryInput,external,vx,vy,headings,result,corrected,correctionLengths,forcedSubsteps,attempt);
    } finally {kernel?.endFrame();}
    if(stats.positionBudgetExhaustions>budgetBefore&&substeps<EXTERNAL_PROFILE.maximumSubsteps&&attempt+1<EXTERNAL_PROFILE.maximumContactAttempts) {
      // Reject before publication, restore warm/activation state and subdivide.
      // Attempted intervals count as work, not additional simulated time or input.
      stats.substepRetries++;stats.rejectedTrialCompressions+=stats.unresolvedCompression-unresolvedBefore;
      stats.rejectedTrialBudgetExhaustions+=stats.positionBudgetExhaustions-budgetBefore;
      stats.rejectedTrialPenetration=Math.max(stats.rejectedTrialPenetration,stats.maxExhaustedPenetration);
      stats.unresolvedCompression=unresolvedBefore;stats.positionBudgetExhaustions=budgetBefore;stats.maxExhaustedPenetration=maxExhaustedBefore;
      this.contactCache.restoreCurrent();external.affected.set(this.trialAffected);
      corrected.set(this.trialCorrected);correctionLengths.set(this.trialLengths);
      const retrySteps=verifySingleStep?absoluteSteps:Math.min(EXTERNAL_PROFILE.maximumSubsteps,Math.max(absoluteSteps,substeps*2));
      return this.solve(retryInput,external,vx,vy,headings,result,corrected,correctionLengths,retrySteps,attempt+1);
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
    result.constraintIterations=stats.velocityPasses+stats.stabilizationPasses;
    if(kernel){kernel.publish(output,corrected,correctionLengths);stats.kernelBytes=kernel.memory.buffer.byteLength;stats.wasm=1;}
    const kernelBuffer=this.kernel?.memory.buffer;
    const owned=(view:ArrayBufferView)=>view.buffer===kernelBuffer?0:view.byteLength;
    stats.retainedBytes=this.candidates.byteLength+this.planningCandidates.byteLength+this.staticAgents.byteLength
      +owned(this.pairA)+owned(this.pairB)+owned(this.pairRadius)+owned(this.pairDX)+owned(this.pairDY)
      +this.velocityPairs.byteLength+owned(this.pairContacts)+this.overflowCandidates.byteLength
      +this.anchorX.byteLength+this.anchorY.byteLength+this.velocityAnchorX.byteLength+this.velocityAnchorY.byteLength
      +this.warmCorrected.byteLength
      +this.warmAffected.byteLength
      +this.trialAffected.byteLength+this.trialCorrected.byteLength+this.trialLengths.byteLength
      +this.freeSpace.bytes+this.contactCache.bytes+this.projection.bytes+this.coloring.bytes+(this.kernel?.memory.buffer.byteLength??0);
  }
  /** Tight swept velocity workset. An excluded pair starts at least 1px from
   * contact throughout its relative segment. It remains excluded only while
   * both changed velocity trajectories together can move by less than 1px.
   * Geometry stays fixed for this entire phase; changed frontiers wake this tick. */
  private buildVelocityWorkset(input:CrowdMovementInput,dt:number,kernel?:ContactKernel):void {
    const s=input.next;
    input.external!.stats.velocityWorksets++;
    if(kernel) {
      this.velocityPairCount=kernel.exports.buildWorkset(this.pairCount,s.count,dt,EXTERNAL_PROFILE.velocityWorksetHalo);
      kernel.configureVelocityColors(this.velocityPairCount);
      return;
    }
    this.velocityAnchorX.set(s.vx);this.velocityAnchorY.set(s.vy);
    this.velocityPairCount=0;
    for(let pair=0;pair<this.pairCount;pair++) {
      const a=this.pairA[pair]!,b=this.pairB[pair]!,dx=this.pairDX[pair]!,dy=this.pairDY[pair]!;
      const vx=s.vx[b]!-s.vx[a]!,vy=s.vy[b]!-s.vy[a]!,v2=vx*vx+vy*vy;
      const t=v2>1e-12?Math.max(0,Math.min(dt,-(dx*vx+dy*vy)/v2)):0;
      const x=dx+vx*t,y=dy+vy*t,r=this.pairRadius[pair]!+EXTERNAL_PROFILE.velocityWorksetHalo+1e-6;
      if(x*x+y*y<=r*r)this.velocityPairs[this.velocityPairCount++]=pair;
    }
  }
  private velocityWorksetValid(input:CrowdMovementInput,dt:number,kernel?:ContactKernel):boolean {
    const s=input.next,limit=EXTERNAL_PROFILE.velocityWorksetHalo/(2*dt),squared=limit*limit;
    if(kernel)return kernel.exports.validWorkset(s.count,squared)!==0;
    for(let a=0;a<s.count;a++)if(s.active[a]) {
      const dx=s.vx[a]!-this.velocityAnchorX[a]!,dy=s.vy[a]!-this.velocityAnchorY[a]!;
      if(dx*dx+dy*dy>=squared)return false;
    }
    return true;
  }
  private uploadKernelPairs(kernel:ContactKernel,count:number):void {
    kernel.ensure(count,this.pairA.length);
    this.corrected=kernel.arrays.corrected;this.correctionLengths=kernel.arrays.lengths;
    kernel.arrays.a.set(this.pairA.subarray(0,this.pairCount));kernel.arrays.b.set(this.pairB.subarray(0,this.pairCount));
  }
  private hasResidualCompression(input:CrowdMovementInput,tolerance:number,kernel?:ContactKernel):boolean {
    if(kernel)return kernel.exports.hasCompression(this.pairCount,tolerance)!==0;
    const s=input.next;
    for(let pair=0;pair<this.pairCount;pair++) {
      const a=this.pairA[pair]!,b=this.pairB[pair]!;
      const r=this.radius(input,a)+this.radius(input,b)-tolerance;
      const dx=s.x[a]!-s.x[b]!,dy=s.y[a]!-s.y[b]!;
      if(dx*dx+dy*dy<r*r)return true;
    }
    return false;
  }
  private prepareWarmContacts(input:CrowdMovementInput,dt:number,kernel?:ContactKernel):void {
    const s=input.next;
    this.velocityAnchorX.set(s.vx);this.velocityAnchorY.set(s.vy);this.warmCorrected.set(this.corrected);
    this.warmAffected.set(input.external!.affected);
    let before=0;
    for(let a=0;a<s.count;a++)before+=s.vx[a]!*s.vx[a]!+s.vy[a]!*s.vy[a]!;
    if(this.pairContacts.length<this.pairA.length)this.pairContacts=new Int32Array(this.pairA.length);
    this.pairContacts.fill(-1,0,this.pairCount);
    let touching=kernel?kernel.exports.classifyGeometry(this.pairCount,input.agentGap):0;
    if(!kernel)for(let pair=0;pair<this.pairCount;pair++) {
      const a=this.pairA[pair]!,b=this.pairB[pair]!,dx=s.x[b]!-s.x[a]!,dy=s.y[b]!-s.y[a]!;
      const radius=this.radius(input,a)+this.radius(input,b)+input.agentGap,d2=dx*dx+dy*dy;
      if(d2>radius*radius+1e-6)continue;
      if(!(this.freeSpace.contains(a,s.x[a]!,s.y[a]!)&&this.freeSpace.contains(a,s.x[b]!,s.y[b]!))
        &&this.wallSeparates(input,s.x[a]!,s.y[a]!,s.x[b]!,s.y[b]!))continue;
      this.pairContacts[pair]=-2;touching++;
    }
    this.contactCache.begin(touching);
    for(let pair=0;pair<this.pairCount;pair++) {
      if(kernel?kernel.arrays.kind[pair]!==1&&kernel.arrays.kind[pair]!==3:this.pairContacts[pair]!==-2)continue;
      const a=this.pairA[pair]!,b=this.pairB[pair]!,dx=s.x[b]!-s.x[a]!,dy=s.y[b]!-s.y[a]!;
      if(kernel&&kernel.arrays.kind[pair]===1){this.nx=kernel.arrays.nx[pair]!;this.ny=kernel.arrays.ny[pair]!;}
      else this.normal(dx,dy,Math.sqrt(dx*dx+dy*dy),a,b);
      const key=a*s.count+b;
      const base=this.contactCache.add(key,this.nx,this.ny,dt,input.contactFriction),values=this.contactCache.values;
      this.pairContacts[pair]=base;
      const normal=values[base]!,tangent=values[base+1]!;
      if(normal===0&&tangent===0)continue;
      this.corrected[a]=1;this.corrected[b]=1;
      const ix=-normal*this.nx-tangent*this.ny,iy=-normal*this.ny+tangent*this.nx;
      s.vx[a]=s.vx[a]!+ix;s.vy[a]=s.vy[a]!+iy;s.vx[b]=s.vx[b]!-ix;s.vy[b]=s.vy[b]!-iy;
    }
    // Warm guesses are not stored mechanical energy. In a frame without a
    // prescribed moving body, shorten an energy-increasing trial to the minimum
    // energy point on its segment after wall projection. A non-descent trial is
    // discarded. This prevents an unforced contact chain from rebounding.
    if(!input.external!.proxies.some(p=>p.x!==p.toX||p.y!==p.toY)) {
      for(const p of input.external!.proxies)this.proxyContacts(input,input.external!,p,0,dt,false);
      for(let k=0;k<this.staticCount;k++)this.constrainStaticVelocity(input,this.staticAgents[k]!,dt);
      let after=0;
      for(let a=0;a<s.count;a++)after+=s.vx[a]!*s.vx[a]!+s.vy[a]!*s.vy[a]!;
      if(after>before+Math.max(1,before)*1e-12) {
        let dot=0,squared=0;
        for(let a=0;a<s.count;a++) {
          const dx=s.vx[a]!-this.velocityAnchorX[a]!,dy=s.vy[a]!-this.velocityAnchorY[a]!;
          dot+=this.velocityAnchorX[a]!*dx+this.velocityAnchorY[a]!*dy;squared+=dx*dx+dy*dy;
        }
        const scale=dot<0?Math.min(1,-dot/Math.max(1e-30,squared)):0;
        if(scale===0)input.external!.stats.warmRejections++;else input.external!.stats.warmDamping++;
        for(let a=0;a<s.count;a++) {
          s.vx[a]=this.velocityAnchorX[a]!+(s.vx[a]!-this.velocityAnchorX[a]!)*scale;
          s.vy[a]=this.velocityAnchorY[a]!+(s.vy[a]!-this.velocityAnchorY[a]!)*scale;
        }
        if(scale===0)this.corrected.set(this.warmCorrected);
        input.external!.affected.set(this.warmAffected);
        for(let pair=0;pair<this.pairCount;pair++) {
          const base=this.pairContacts[pair]!;
          if(base>=0){this.contactCache.values[base]=this.contactCache.values[base]!*scale;this.contactCache.values[base+1]=this.contactCache.values[base+1]!*scale;}
        }
        for(const p of input.external!.proxies)this.proxyContacts(input,input.external!,p,0,dt,false);
        for(let k=0;k<this.staticCount;k++)this.constrainStaticVelocity(input,this.staticAgents[k]!,dt);
      }
    }
  }
  private buildPairs(input:CrowdMovementInput,external:ExternalInfluences,result:CrowdMovementResult,padding:number,kernel?:ContactKernel):void {
    const next=input.next,count=next.count,stats=external.stats;
    this.pairCount=0;
    this.anchorX.set(next.x);this.anchorY.set(next.y);
    if(kernel) {
      for(;;) {
        const data=kernel.arrays;
        this.corrected=data.corrected;this.correctionLengths=data.lengths;
        this.pairA=data.a;this.pairB=data.b;
        data.active.set(next.active);data.cellStart.set(input.index.cellStart);data.cellIndices.set(input.index.agentIndices);
        const pairs=kernel.exports.buildPairs(count,data.a.length,input.index.columns,input.index.rows,input.index.cellSize,
          input.maxAgentRadius??input.agentRadius,input.agentGap,padding);
        if(pairs>=0) {
          this.pairCount=pairs;
          result.candidateChecks+=kernel.exports.pairCandidates();
          stats.candidateFallbacks+=kernel.exports.pairFallbacks();
          stats.contactCellUpperBound+=kernel.exports.pairCells();
          stats.pairOwnershipSkips+=kernel.exports.pairOwnershipSkips();
          result.totalNeighbors+=pairs;
          result.maxNeighbors=Math.max(result.maxNeighbors,kernel.exports.pairMaximum());
          result.maxContacts=Math.max(result.maxContacts,kernel.exports.pairMaximum());
          stats.pairs+=pairs;result.contactChecks+=pairs;
          this.orderPairs(count,external,kernel);
          return;
        }
        if(data.a.length>=count*EXTERNAL_PROFILE.maximumPairFactor){stats.saturatedQueries++;throw new RangeError('External contact pair budget exceeded; overlapping/overpacked initial state.');}
        stats.pairCapacityRetries++;
        kernel.ensure(count,Math.min(count*EXTERNAL_PROFILE.maximumPairFactor,Math.max(32,data.a.length*2)));
      }
    }
      for (let a=0;a<count;a++) {
        if (!next.active[a]) continue;
        const range = this.radius(input,a)+(input.maxAgentRadius ?? input.agentRadius)+input.agentGap+padding;
        stats.contactCellUpperBound += this.queryCells(input,next.x[a]!,next.y[a]!,range);
        let candidates=this.candidates;
        let n = input.index.queryCandidates(next.x[a]!,next.y[a]!,range,candidates);
        if(n===candidates.length) {
          if(this.overflowCandidates.length<count)this.overflowCandidates=new Int32Array(count);
          candidates=this.overflowCandidates;
          n=input.index.queryCandidates(next.x[a]!,next.y[a]!,range,candidates);
          stats.candidateFallbacks++;
        }
        result.candidateChecks += n;
        let owned = 0;
        for (let k=0;k<n;k++) {
          const b = candidates[k]!;
          if (b <= a) continue;
          const r = this.radius(input,a)+this.radius(input,b)+input.agentGap+padding;
          if ((next.x[b]!-next.x[a]!)**2+(next.y[b]!-next.y[a]!)**2 > r*r) continue;
          if(this.pairCount===this.pairA.length) {
            if(this.pairCount>=count*EXTERNAL_PROFILE.maximumPairFactor){stats.saturatedQueries++;throw new RangeError('External contact pair budget exceeded; overlapping/overpacked initial state.');}
            const aBuffer=new Int32Array(Math.min(count*EXTERNAL_PROFILE.maximumPairFactor,Math.max(32,this.pairCount*2))),bBuffer=new Int32Array(aBuffer.length);
            aBuffer.set(this.pairA);bBuffer.set(this.pairB);this.pairA=aBuffer;this.pairB=bBuffer;
          }
          this.pairA[this.pairCount] = a; this.pairB[this.pairCount++] = b; owned++;
        }
        result.totalNeighbors += owned; result.maxNeighbors = Math.max(result.maxNeighbors,owned);
        result.maxContacts=Math.max(result.maxContacts,owned);
      }
      stats.pairs += this.pairCount; result.contactChecks += this.pairCount;
      this.orderPairs(count,external);
  }
  private orderPairs(count:number,external:ExternalInfluences,kernel?:ContactKernel):void {
    const start=performance.now(),groups=this.coloring.order(this.pairA,this.pairB,this.pairCount,count);
    kernel?.configureColors(this.coloring.starts,groups);
    external.stats.colorBuilds++;external.stats.colorBuildMs+=performance.now()-start;
    external.stats.maximumColors=Math.max(external.stats.maximumColors,groups);
    if(this.pairCount>0&&!groups)external.stats.colorFallbacks++;
  }
  private initializeKernel(parallel:boolean):void {
    this.kernel=ContactKernel.create((a,b)=>{
      const i=this.kernelInput!,n=i.next;
      return this.freeSpace.contains(a,n.x[a]!,n.y[a]!)&&this.freeSpace.contains(a,n.x[b]!,n.y[b]!)?0:
        Number(this.wallSeparates(i,n.x[a]!,n.y[a]!,n.x[b]!,n.y[b]!));
    },(a,b,dx,dy,d,correction)=>{
      const i=this.kernelInput!,n=i.next;
      if(!(this.freeSpace.contains(a,n.x[a]!,n.y[a]!)&&this.freeSpace.contains(a,n.x[b]!,n.y[b]!))
        &&this.wallSeparates(i,n.x[a]!,n.y[a]!,n.x[b]!,n.y[b]!))return;
      this.normal(dx,dy,d,a,b);const nx=this.nx,ny=this.ny;
      this.move(i,a,-nx*correction,-ny*correction,false,this.kernelDelta);
      this.move(i,b,nx*correction,ny*correction,false,this.kernelDelta);
    },parallel);
  }
  private maximumPairDisplacement(input:CrowdMovementInput,kernel?:ContactKernel):number {
    if(kernel)return kernel.exports.maximumDisplacement(input.next.count);
    let squared=0;
    for(let a=0;a<input.next.count;a++) if(input.next.active[a]) {
      squared=Math.max(squared,(input.next.x[a]!-this.anchorX[a]!)**2+(input.next.y[a]!-this.anchorY[a]!)**2);
    }
    return Math.sqrt(squared);
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
      this.freeSpace.prepare(a,x,y,this.radius(input,a)+input.wallClearance-input.agentRadius);
      if(this.freeSpace.coversMotion(a,x,y,travel))continue;
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
      if(distanceSquaredToRect(x,y,rect)>travel*travel)continue;
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
    // Preserve the sweep path's arithmetic even when its empty-space query is skipped.
    if(physical){s.vx[a]=dx/dt;s.vy[a]=dy/dt;}
    if ((this.freeSpace.contains(a,x,y)&&this.freeSpace.contains(a,x+dx,y+dy)) || (input.obstacles.length === 0 && x+dx >= r && y+dy >= r && x+dx <= input.worldWidth-r && y+dy <= input.worldHeight-r)) {
      s.x[a]=x+dx;s.y[a]=y+dy;
      if(!physical) {this.corrected[a]=1;this.correctionLengths[a]=this.correctionLengths[a]!+Math.sqrt(dx*dx+dy*dy);}
      return;
    }
    const travel=Math.hypot(dx,dy)+r+1e-6;
    this.obstacles.length=0;
    for (const i of this.index.query(x-travel,y-travel,x+travel,y+travel)) {
      const rect=input.obstacles[i]!;
      // Sliding cannot leave the total-travel disk. This filter includes turns,
      // unlike the original start/end chord AABB, and removes BVH tile padding.
      if(distanceSquaredToRect(x,y,rect)>travel*travel)continue;
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
