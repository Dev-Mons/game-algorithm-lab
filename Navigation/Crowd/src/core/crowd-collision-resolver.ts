import type { SpatialHash } from '../algorithms/spatial-hash/spatial-hash';
import type { AgentBuffer } from './agent-state';
import {
  distanceSquaredToRect,
  SweptCircleStaticIntegrator,
  type SweptCircleSlideOutput,
} from './obstacle-collision';
import type { Rect } from './types';

const DISTANCE_EPSILON = 1e-12;
const OVERLAP_EPSILON = 1e-9;
const POSITION_SLOP = 1e-7;
// Match the swept static integrator's contact tolerance. Exact tangency is a
// valid state; only a measurable inward endpoint is rejected.
const STATIC_SLOP = 1e-10;
const PROGRESS_EPSILON = 1e-9;
const DEFAULT_ITERATIONS = 6;
const MAX_ITERATIONS = 8;
const MAX_COMPONENT_EXPANSIONS = 16;
const STATIC_SEARCH_PASSES = 12;

export interface CrowdCollisionResolverInput {
  /** Complete state from the beginning of the fixed step. */
  current: AgentBuffer;
  /** Integrated Phase C proposal. Only x/y are corrected by this resolver. */
  next: AgentBuffer;
  /** Unit (or zero) preferred headings from the same planning snapshot. */
  preferredX: Float64Array;
  preferredY: Float64Array;
  agentRadius: number;
  /** Extra positional slop used for prevention but excluded from overlap metrics. */
  separationPadding?: number;
  wallMargin: number;
  worldWidth: number;
  worldHeight: number;
  obstacles: readonly Rect[];
  spatialHash: SpatialHash;
  /** Optional output mask. It is cleared and filled with unresolved overlaps. */
  overlapFlags?: Uint8Array;
  /** The resolver clamps this to the deterministic six-to-eight pass range. */
  maxIterations?: number;
  /** Per-agent positional repair budget for overlaps already present at frame start. */
  maxCorrectionPerFrame?: number;
}

export interface CrowdCollisionResult {
  remainingOverlapPairs: number;
  correctionCount: number;
  candidateChecks: number;
  jacobiCorrectionCount: number;
  componentFallbackAgents: number;
  rollbackAgents: number;
}

/**
 * Bounded positional circle resolver.
 *
 * A correction-skin broadphase is built once from the complete frame-start
 * snapshot. The same deterministic pair list is then reused by simultaneous
 * Jacobi passes, the rare component rollback, and final overlap accounting.
 * Only x/y are written: velocities and all planning state remain untouched.
 */
export class CrowdCollisionResolver {
  remainingOverlapPairs = 0;
  correctionCount = 0;
  candidateChecks = 0;
  jacobiCorrectionCount = 0;
  componentFallbackAgents = 0;
  rollbackAgents = 0;

  private input: CrowdCollisionResolverInput | null = null;
  private reportRadius = 0;
  private reportSquared = 0;
  private contactRadius = 0;
  private contactSquared = 0;
  private clearance = 0;
  private correctionSkin = 0;
  private existingCorrectionBudget = 0;
  private broadphaseRadius = 0;
  private broadphaseSquared = 0;
  private maximumProposalMovement = 0;
  private stableNormalX = 0;
  private stableNormalY = 0;

  private proposalX = new Float64Array(0);
  private proposalY = new Float64Array(0);
  private proposalMovement = new Float64Array(0);
  private accumulatedX = new Float64Array(0);
  private accumulatedY = new Float64Array(0);
  private constraintDegree = new Int32Array(0);
  private inheritedMember = new Uint8Array(0);

  private pairA = new Int32Array(0);
  private pairB = new Int32Array(0);
  private pairInherited = new Uint8Array(0);
  private pairCount = 0;
  private queryAgent = 0;

  private componentParent = new Int32Array(0);
  private componentSeedMember = new Uint8Array(0);
  private componentMarked = new Uint8Array(0);
  private componentInherited = new Uint8Array(0);
  private componentValid = new Uint8Array(0);
  private componentRigid = new Uint8Array(0);
  private componentAlpha = new Float64Array(0);
  private componentDeltaX = new Float64Array(0);
  private componentDeltaY = new Float64Array(0);
  private componentMemberCount = new Int32Array(0);

  private adjacencyHead = new Int32Array(0);
  private adjacencyTo = new Int32Array(0);
  private adjacencyNext = new Int32Array(0);
  private fallbackQueue = new Int32Array(0);
  private fallbackReset = new Uint8Array(0);
  private readonly staticProjectionIntegrator = new SweptCircleStaticIntegrator();
  private readonly staticProjection: SweptCircleSlideOutput = {
    x: 0,
    y: 0,
    velocityX: 0,
    velocityY: 0,
    normalX: 0,
    normalY: 0,
    contactCount: 0,
    startedOverlapping: false,
    exhausted: false,
  };

  private readonly result: CrowdCollisionResult = {
    remainingOverlapPairs: 0,
    correctionCount: 0,
    candidateChecks: 0,
    jacobiCorrectionCount: 0,
    componentFallbackAgents: 0,
    rollbackAgents: 0,
  };

  private readonly collectCandidate = (candidate: number): void => {
    this.tryAppendPair(candidate);
  };

  resolve(input: CrowdCollisionResolverInput): CrowdCollisionResult {
    this.assertCompatibleInput(input);
    this.input = input;
    this.reportRadius = Math.max(0, input.agentRadius * 2);
    this.reportSquared = this.reportRadius * this.reportRadius;
    this.contactRadius = this.reportRadius + Math.max(0, input.separationPadding ?? 0);
    this.contactSquared = this.contactRadius * this.contactRadius;
    this.clearance = Math.max(0, input.agentRadius + input.wallMargin);
    // One simultaneous pair projection moves either endpoint by at most half a
    // diameter. Keeping that as the total skin both bounds correction energy and
    // prevents the broadphase from degenerating into a dense all-neighborhood scan.
    this.correctionSkin = Math.max(this.contactRadius * 0.5 + POSITION_SLOP, POSITION_SLOP);
    this.existingCorrectionBudget = Math.max(
      POSITION_SLOP,
      input.maxCorrectionPerFrame ?? Math.max(0.04, input.agentRadius * 0.1),
    );
    this.ensureAgentCapacity(input.next.count);
    this.proposalX.set(input.next.x);
    this.proposalY.set(input.next.y);
    this.correctionCount = 0;
    this.candidateChecks = 0;
    this.remainingOverlapPairs = 0;
    this.jacobiCorrectionCount = 0;
    this.componentFallbackAgents = 0;
    this.rollbackAgents = 0;

    this.buildPairList();
    const requestedIterations = Math.floor(input.maxIterations ?? DEFAULT_ITERATIONS);
    const iterations = Math.max(DEFAULT_ITERATIONS, Math.min(MAX_ITERATIONS, requestedIterations));
    this.solveJacobi(iterations);
    this.resolveNewOverlapComponents();
    // Static projection of a rigid contact component can remove one displacement
    // axis after the component's non-reverse half-planes were solved. Enforce the
    // invariant once more at the actual Phase-C endpoint. A dependency closure
    // turns the rare infeasible endpoint into a local stop without creating a
    // fresh overlap with a neighbor that kept moving.
    this.rollbackReverseClosure();
    this.countRemainingOverlaps();

    this.result.remainingOverlapPairs = this.remainingOverlapPairs;
    this.result.correctionCount = this.correctionCount;
    this.result.candidateChecks = this.candidateChecks;
    this.result.jacobiCorrectionCount = this.jacobiCorrectionCount;
    this.result.componentFallbackAgents = this.componentFallbackAgents;
    this.result.rollbackAgents = this.rollbackAgents;
    this.input = null;
    return this.result;
  }

  private assertCompatibleInput(input: CrowdCollisionResolverInput): void {
    const count = input.next.count;
    if (
      input.current.count !== count
      || input.preferredX.length < count
      || input.preferredY.length < count
      || (input.overlapFlags !== undefined && input.overlapFlags.length < count)
    ) {
      throw new RangeError('Collision resolver buffers must describe the same agent count.');
    }
    if (!(input.worldWidth > 0) || !(input.worldHeight > 0)) {
      throw new RangeError('Collision resolver world bounds must be positive.');
    }
  }

  private ensureAgentCapacity(count: number): void {
    if (this.proposalX.length >= count) return;
    this.proposalX = new Float64Array(count);
    this.proposalY = new Float64Array(count);
    this.proposalMovement = new Float64Array(count);
    this.accumulatedX = new Float64Array(count);
    this.accumulatedY = new Float64Array(count);
    this.constraintDegree = new Int32Array(count);
    this.inheritedMember = new Uint8Array(count);
    this.componentParent = new Int32Array(count);
    this.componentSeedMember = new Uint8Array(count);
    this.componentMarked = new Uint8Array(count);
    this.componentInherited = new Uint8Array(count);
    this.componentValid = new Uint8Array(count);
    this.componentRigid = new Uint8Array(count);
    this.componentAlpha = new Float64Array(count);
    this.componentDeltaX = new Float64Array(count);
    this.componentDeltaY = new Float64Array(count);
    this.componentMemberCount = new Int32Array(count);
    this.adjacencyHead = new Int32Array(count);
    this.fallbackQueue = new Int32Array(count);
    this.fallbackReset = new Uint8Array(count);
    if (this.pairA.length === 0) this.ensurePairCapacity(Math.max(64, count * 16));
  }

  private ensurePairCapacity(required: number): void {
    if (this.pairA.length >= required) return;
    let capacity = Math.max(64, this.pairA.length);
    while (capacity < required) capacity *= 2;
    const nextA = new Int32Array(capacity);
    const nextB = new Int32Array(capacity);
    const nextInherited = new Uint8Array(capacity);
    nextA.set(this.pairA.subarray(0, this.pairCount));
    nextB.set(this.pairB.subarray(0, this.pairCount));
    nextInherited.set(this.pairInherited.subarray(0, this.pairCount));
    this.pairA = nextA;
    this.pairB = nextB;
    this.pairInherited = nextInherited;
  }

  /** Build a swept, correction-inflated pair list using one spatial-hash index. */
  private buildPairList(): void {
    const input = this.input!;
    const count = input.next.count;
    this.pairCount = 0;
    this.maximumProposalMovement = 0;
    this.inheritedMember.fill(0, 0, count);
    for (let agent = 0; agent < count; agent += 1) {
      if (input.next.active[agent] !== 1) {
        this.proposalMovement[agent] = 0;
        continue;
      }
      const movement = Math.hypot(
        this.proposalX[agent]! - input.current.x[agent]!,
        this.proposalY[agent]! - input.current.y[agent]!,
      );
      this.proposalMovement[agent] = movement;
      this.maximumProposalMovement = Math.max(this.maximumProposalMovement, movement);
    }
    this.broadphaseRadius = this.contactRadius + this.correctionSkin * 2 + POSITION_SLOP;
    this.broadphaseSquared = this.broadphaseRadius * this.broadphaseRadius;
    input.spatialHash.rebuild(input.current.x, input.current.y, input.current.active);
    for (let agent = 0; agent < count; agent += 1) {
      if (input.next.active[agent] !== 1) continue;
      this.queryAgent = agent;
      const queryRadius = this.broadphaseRadius
        + this.proposalMovement[agent]!
        + this.maximumProposalMovement;
      input.spatialHash.forEachCandidate(
        input.current.x[agent]!,
        input.current.y[agent]!,
        queryRadius,
        this.collectCandidate,
      );
    }
  }

  private tryAppendPair(candidate: number): void {
    const input = this.input!;
    const agent = this.queryAgent;
    if (candidate <= agent || input.next.active[candidate] !== 1) return;
    this.candidateChecks += 1;

    const currentDx = input.current.x[agent]! - input.current.x[candidate]!;
    const currentDy = input.current.y[agent]! - input.current.y[candidate]!;
    const relativeMovementX = (
      this.proposalX[agent]! - input.current.x[agent]!
    ) - (
      this.proposalX[candidate]! - input.current.x[candidate]!
    );
    const relativeMovementY = (
      this.proposalY[agent]! - input.current.y[agent]!
    ) - (
      this.proposalY[candidate]! - input.current.y[candidate]!
    );
    const movementSquared = relativeMovementX * relativeMovementX
      + relativeMovementY * relativeMovementY;
    let closestTime = 0;
    if (movementSquared > DISTANCE_EPSILON) {
      closestTime = Math.max(0, Math.min(1, -(
        currentDx * relativeMovementX + currentDy * relativeMovementY
      ) / movementSquared));
    }
    const closestX = currentDx + relativeMovementX * closestTime;
    const closestY = currentDy + relativeMovementY * closestTime;
    if (closestX * closestX + closestY * closestY > this.broadphaseSquared) return;

    this.ensurePairCapacity(this.pairCount + 1);
    this.pairA[this.pairCount] = agent;
    this.pairB[this.pairCount] = candidate;
    const inherited = currentDx * currentDx + currentDy * currentDy
      < this.reportSquared - OVERLAP_EPSILON;
    this.pairInherited[this.pairCount] = inherited ? 1 : 0;
    if (inherited) {
      this.inheritedMember[agent] = 1;
      this.inheritedMember[candidate] = 1;
    }
    this.pairCount += 1;
  }

  private solveJacobi(iterations: number): void {
    const input = this.input!;
    const count = input.next.count;
    for (let pass = 0; pass < iterations; pass += 1) {
      this.accumulatedX.fill(0, 0, count);
      this.accumulatedY.fill(0, 0, count);
      this.constraintDegree.fill(0, 0, count);
      let violationCount = 0;

      for (let pair = 0; pair < this.pairCount; pair += 1) {
        this.candidateChecks += 1;
        const agent = this.pairA[pair]!;
        const other = this.pairB[pair]!;
        let dx = input.next.x[agent]! - input.next.x[other]!;
        let dy = input.next.y[agent]! - input.next.y[other]!;
        const squaredDistance = dx * dx + dy * dy;
        if (squaredDistance >= this.contactSquared - OVERLAP_EPSILON) continue;
        violationCount += 1;

        let distance = 0;
        if (squaredDistance > DISTANCE_EPSILON) {
          distance = Math.sqrt(squaredDistance);
          dx /= distance;
          dy /= distance;
        } else {
          this.setStablePairNormal(agent, other);
          dx = this.stableNormalX;
          dy = this.stableNormalY;
        }
        const halfCorrection = (
          this.contactRadius + POSITION_SLOP - distance
        ) * 0.5;
        this.accumulatedX[agent] = this.accumulatedX[agent]! + dx * halfCorrection;
        this.accumulatedY[agent] = this.accumulatedY[agent]! + dy * halfCorrection;
        this.accumulatedX[other] = this.accumulatedX[other]! - dx * halfCorrection;
        this.accumulatedY[other] = this.accumulatedY[other]! - dy * halfCorrection;
        this.constraintDegree[agent] = this.constraintDegree[agent]! + 1;
        this.constraintDegree[other] = this.constraintDegree[other]! + 1;
      }
      if (violationCount === 0) break;

      let changed = false;
      for (let agent = 0; agent < count; agent += 1) {
        const degree = this.constraintDegree[agent]!;
        if (degree === 0 || input.next.active[agent] !== 1) continue;
        const relaxation = Math.min(1, 2 / degree);
        if (this.applyCorrection(
          agent,
          this.accumulatedX[agent]! * relaxation,
          this.accumulatedY[agent]! * relaxation,
        )) changed = true;
      }
      if (!changed) break;
    }
  }

  private setStablePairNormal(agent: number, other: number): void {
    const input = this.input!;
    let dx = input.current.x[agent]! - input.current.x[other]!;
    let dy = input.current.y[agent]! - input.current.y[other]!;
    let length = Math.hypot(dx, dy);
    if (length > DISTANCE_EPSILON) {
      this.stableNormalX = dx / length;
      this.stableNormalY = dy / length;
      return;
    }

    let headingX = input.preferredX[agent]! + input.preferredX[other]!;
    let headingY = input.preferredY[agent]! + input.preferredY[other]!;
    length = Math.hypot(headingX, headingY);
    if (length <= DISTANCE_EPSILON) {
      headingX = 1;
      headingY = 0;
    } else {
      headingX /= length;
      headingY /= length;
    }
    const side = this.pairSide(agent, other);
    this.stableNormalX = -headingY * side;
    this.stableNormalY = headingX * side;
  }

  private applyCorrection(agent: number, deltaX: number, deltaY: number): boolean {
    const input = this.input!;
    const oldX = input.next.x[agent]!;
    const oldY = input.next.y[agent]!;
    let targetX = oldX + deltaX;
    let targetY = oldY + deltaY;

    const budget = this.inheritedMember[agent] === 1
      ? this.existingCorrectionBudget
      : this.correctionSkin;
    const totalX = targetX - this.proposalX[agent]!;
    const totalY = targetY - this.proposalY[agent]!;
    const totalLength = Math.hypot(totalX, totalY);
    if (totalLength > budget) {
      const scale = budget / totalLength;
      targetX = this.proposalX[agent]! + totalX * scale;
      targetY = this.proposalY[agent]! + totalY * scale;
    }

    const oldProgress = this.progressAt(agent, oldX, oldY);
    const targetProgress = this.progressAt(agent, targetX, targetY);
    if (targetProgress < -PROGRESS_EPSILON) {
      if (oldProgress < -PROGRESS_EPSILON) return false;
      const denominator = oldProgress - targetProgress;
      const scale = denominator > DISTANCE_EPSILON
        ? Math.max(0, Math.min(1, oldProgress / denominator))
        : 0;
      targetX = oldX + (targetX - oldX) * scale;
      targetY = oldY + (targetY - oldY) * scale;
    }

    if (!this.isStrictlyStaticSafe(targetX, targetY)) {
      if (!this.isStrictlyStaticSafe(oldX, oldY)) return false;
      let low = 0;
      let high = 1;
      for (let pass = 0; pass < STATIC_SEARCH_PASSES; pass += 1) {
        const scale = (low + high) * 0.5;
        const x = oldX + (targetX - oldX) * scale;
        const y = oldY + (targetY - oldY) * scale;
        if (this.isStrictlyStaticSafe(x, y)) low = scale;
        else high = scale;
      }
      targetX = oldX + (targetX - oldX) * low;
      targetY = oldY + (targetY - oldY) * low;
    }

    if (Math.hypot(targetX - oldX, targetY - oldY) <= DISTANCE_EPSILON) return false;
    input.next.x[agent] = targetX;
    input.next.y[agent] = targetY;
    this.correctionCount += 1;
    this.jacobiCorrectionCount += 1;
    return true;
  }

  /**
   * Reconstruct residual new-contact components as translated current shapes.
   * A component expands only when its actual rigid candidate overlaps an
   * outsider endpoint. The common displacement is recomputed after every
   * deterministic union pass, so the committed closure is self-consistent.
   */
  private resolveNewOverlapComponents(): void {
    const input = this.input!;
    const count = input.next.count;
    this.componentSeedMember.fill(0, 0, count);
    for (let agent = 0; agent < count; agent += 1) this.componentParent[agent] = agent;

    // Keep inherited penetration components independent from the new-contact
    // reconstruction. Their bounded Jacobi separation must not be replaced by
    // a rigid translation that preserves the inherited overlap.
    for (let pair = 0; pair < this.pairCount; pair += 1) {
      if (this.pairInherited[pair] !== 1) continue;
      this.unionComponents(this.pairA[pair]!, this.pairB[pair]!);
    }
    this.refreshInheritedRoots(count);

    let seedCount = 0;
    for (let pair = 0; pair < this.pairCount; pair += 1) {
      if (this.pairInherited[pair] === 1 || !this.pairOverlapsAtNext(pair)) continue;
      const agent = this.pairA[pair]!;
      const other = this.pairB[pair]!;
      const agentRoot = this.findComponent(agent);
      const otherRoot = this.findComponent(other);
      if (this.componentInherited[agentRoot] === 1 || this.componentInherited[otherRoot] === 1) {
        continue;
      }
      this.unionComponents(agentRoot, otherRoot);
      if (this.componentSeedMember[agent] === 0) {
        this.componentSeedMember[agent] = 1;
        seedCount += 1;
      }
      if (this.componentSeedMember[other] === 0) {
        this.componentSeedMember[other] = 1;
        seedCount += 1;
      }
    }
    if (seedCount === 0) return;

    for (let pass = 0; pass < MAX_COMPONENT_EXPANSIONS; pass += 1) {
      this.prepareRigidComponents(count);
      let expanded = false;
      for (let pair = 0; pair < this.pairCount; pair += 1) {
        this.candidateChecks += 1;
        if (this.pairInherited[pair] === 1) continue;
        const agent = this.pairA[pair]!;
        const other = this.pairB[pair]!;
        const agentRoot = this.findComponent(agent);
        const otherRoot = this.findComponent(other);
        if (agentRoot === otherRoot) continue;
        const agentRigid = this.componentRigid[agentRoot] === 1;
        const otherRigid = this.componentRigid[otherRoot] === 1;
        if (!agentRigid && !otherRigid) continue;
        if (!this.rigidCandidatesOverlap(agent, agentRoot, other, otherRoot)) continue;
        // An inherited root retains its bounded separation path. Any remaining
        // mixed conflict is handled by the local rollback closure below.
        if (this.componentInherited[agentRoot] === 1
          || this.componentInherited[otherRoot] === 1) continue;
        this.unionComponents(agentRoot, otherRoot);
        expanded = true;
      }
      if (!expanded) break;
    }

    // A last expansion changes component means; always prepare once more before
    // commit. If the fixed bound was exhausted, the dependency rollback remains
    // a safe local backstop rather than a whole-crowd reset.
    this.prepareRigidComponents(count);

    for (let agent = 0; agent < count; agent += 1) {
      if (input.next.active[agent] !== 1) continue;
      const root = this.findComponent(agent);
      if (this.componentRigid[root] !== 1) continue;
      const alpha = this.componentAlpha[root]!;
      const x = input.current.x[agent]! + this.componentDeltaX[root]! * alpha;
      const y = input.current.y[agent]! + this.componentDeltaY[root]! * alpha;
      if (Math.hypot(x - input.next.x[agent]!, y - input.next.y[agent]!) > DISTANCE_EPSILON) {
        this.correctionCount += 1;
        this.componentFallbackAgents += 1;
      }
      input.next.x[agent] = x;
      input.next.y[agent] = y;
    }

    this.rollbackNewOverlapClosure();
  }

  private refreshInheritedRoots(count: number): void {
    this.componentInherited.fill(0, 0, count);
    for (let agent = 0; agent < count; agent += 1) {
      if (this.inheritedMember[agent] === 1) {
        this.componentInherited[this.findComponent(agent)] = 1;
      }
    }
  }

  private prepareRigidComponents(count: number): void {
    const input = this.input!;
    this.componentMarked.fill(0, 0, count);
    this.componentInherited.fill(0, 0, count);
    this.componentRigid.fill(0, 0, count);
    this.componentDeltaX.fill(0, 0, count);
    this.componentDeltaY.fill(0, 0, count);
    this.componentMemberCount.fill(0, 0, count);
    this.componentAlpha.fill(1, 0, count);

    for (let agent = 0; agent < count; agent += 1) {
      const root = this.findComponent(agent);
      if (this.componentSeedMember[agent] === 1) this.componentMarked[root] = 1;
      if (this.inheritedMember[agent] === 1) this.componentInherited[root] = 1;
    }
    for (let agent = 0; agent < count; agent += 1) {
      if (input.next.active[agent] !== 1) continue;
      const root = this.findComponent(agent);
      if (this.componentMarked[root] !== 1 || this.componentInherited[root] === 1) continue;
      this.componentDeltaX[root] = this.componentDeltaX[root]!
        + input.next.x[agent]! - input.current.x[agent]!;
      this.componentDeltaY[root] = this.componentDeltaY[root]!
        + input.next.y[agent]! - input.current.y[agent]!;
      this.componentMemberCount[root] = this.componentMemberCount[root]! + 1;
    }
    for (let root = 0; root < count; root += 1) {
      const members = this.componentMemberCount[root]!;
      if (this.componentMarked[root] !== 1
        || this.componentInherited[root] === 1
        || members === 0) continue;
      this.componentDeltaX[root] = this.componentDeltaX[root]! / members;
      this.componentDeltaY[root] = this.componentDeltaY[root]! / members;
      this.componentRigid[root] = 1;
    }

    // Project every common displacement into the intersection of member
    // non-reverse half-planes. Conflicting headings deterministically converge
    // to a smaller (possibly zero) shared displacement.
    for (let pass = 0; pass < MAX_ITERATIONS; pass += 1) {
      for (let agent = 0; agent < count; agent += 1) {
        if (input.next.active[agent] !== 1) continue;
        const root = this.findComponent(agent);
        if (this.componentRigid[root] !== 1) continue;
        const preferredX = input.preferredX[agent]!;
        const preferredY = input.preferredY[agent]!;
        const preferredSquared = preferredX * preferredX + preferredY * preferredY;
        if (preferredSquared <= DISTANCE_EPSILON) continue;
        const progress = this.componentDeltaX[root]! * preferredX
          + this.componentDeltaY[root]! * preferredY;
        if (progress >= -PROGRESS_EPSILON) continue;
        this.componentDeltaX[root] = this.componentDeltaX[root]!
          - preferredX * progress / preferredSquared;
        this.componentDeltaY[root] = this.componentDeltaY[root]!
          - preferredY * progress / preferredSquared;
      }
    }

    // A contact component may contain hundreds of agents. Scaling its common
    // displacement to zero because one leading member touches a wall turns a
    // local static constraint into a crowd-wide stop wave. Project only the
    // inward normal component from the shared displacement instead. Repeating
    // this deterministic sweep computes the intersection of all member wall
    // half-planes while preserving every available tangent component.
    this.projectRigidComponentsAgainstStatic(count);

    // Scale only roots whose translated endpoints would violate a static
    // constraint. Changed endpoints are accepted only with outward slop.
    for (let pass = 0; pass < STATIC_SEARCH_PASSES; pass += 1) {
      this.componentValid.fill(1, 0, count);
      let invalidCount = 0;
      for (let agent = 0; agent < count; agent += 1) {
        if (input.next.active[agent] !== 1) continue;
        const root = this.findComponent(agent);
        if (this.componentRigid[root] !== 1 || this.componentAlpha[root] === 0) continue;
        const alpha = this.componentAlpha[root]!;
        const x = input.current.x[agent]! + this.componentDeltaX[root]! * alpha;
        const y = input.current.y[agent]! + this.componentDeltaY[root]! * alpha;
        if (!this.isStrictlyStaticSafe(x, y)) this.componentValid[root] = 0;
      }
      for (let root = 0; root < count; root += 1) {
        if (this.componentRigid[root] !== 1 || this.componentValid[root] === 1) continue;
        this.componentAlpha[root] = this.componentAlpha[root]! * 0.5;
        invalidCount += 1;
      }
      if (invalidCount === 0) break;
    }
    for (let root = 0; root < count; root += 1) {
      if (this.componentRigid[root] !== 1 || this.componentValid[root] === 1) continue;
      this.componentAlpha[root] = 0;
    }
  }

  /** Preserve common tangent movement instead of stopping a wall-contact island. */
  private projectRigidComponentsAgainstStatic(count: number): void {
    const input = this.input!;
    for (let pass = 0; pass < MAX_ITERATIONS; pass += 1) {
      let changed = false;
      for (let agent = 0; agent < count; agent += 1) {
        if (input.next.active[agent] !== 1) continue;
        const root = this.findComponent(agent);
        if (this.componentRigid[root] !== 1) continue;
        const deltaX = this.componentDeltaX[root]!;
        const deltaY = this.componentDeltaY[root]!;
        if (Math.hypot(deltaX, deltaY) <= DISTANCE_EPSILON) continue;
        this.staticProjectionIntegrator.integrate(
          input.current.x[agent]!,
          input.current.y[agent]!,
          deltaX,
          deltaY,
          1,
          this.clearance,
          input.worldWidth,
          input.worldHeight,
          input.obstacles,
          4,
          this.staticProjection,
        );
        if (this.staticProjection.startedOverlapping) continue;
        if (this.staticProjection.contactCount === 0 && !this.staticProjection.exhausted) continue;
        const normalX = this.staticProjection.normalX;
        const normalY = this.staticProjection.normalY;
        const inward = deltaX * normalX + deltaY * normalY;
        if (inward >= -DISTANCE_EPSILON) continue;
        this.componentDeltaX[root] = deltaX - normalX * inward;
        this.componentDeltaY[root] = deltaY - normalY * inward;
        changed = true;
      }
      if (!changed) break;
    }
  }

  private rigidCandidatesOverlap(
    agent: number,
    agentRoot: number,
    other: number,
    otherRoot: number,
  ): boolean {
    const input = this.input!;
    const agentRigid = this.componentRigid[agentRoot] === 1;
    const otherRigid = this.componentRigid[otherRoot] === 1;
    const agentX = agentRigid
      ? input.current.x[agent]!
        + this.componentDeltaX[agentRoot]! * this.componentAlpha[agentRoot]!
      : input.next.x[agent]!;
    const agentY = agentRigid
      ? input.current.y[agent]!
        + this.componentDeltaY[agentRoot]! * this.componentAlpha[agentRoot]!
      : input.next.y[agent]!;
    const otherX = otherRigid
      ? input.current.x[other]!
        + this.componentDeltaX[otherRoot]! * this.componentAlpha[otherRoot]!
      : input.next.x[other]!;
    const otherY = otherRigid
      ? input.current.y[other]!
        + this.componentDeltaY[otherRoot]! * this.componentAlpha[otherRoot]!
      : input.next.y[other]!;
    const dx = agentX - otherX;
    const dy = agentY - otherY;
    return dx * dx + dy * dy < this.reportSquared - OVERLAP_EPSILON;
  }

  /**
   * Reset only the dependency closure of unresolved new contacts. If an agent
   * returns to its current center, a neighbor is added exactly when that current
   * center would overlap the neighbor's retained endpoint. Each agent enters the
   * typed queue once, so arbitrarily long chains stay O(pair count), not repeated
   * hash scans. Current-current pairs are safe by the normal-frame precondition.
   */
  private rollbackNewOverlapClosure(): void {
    const input = this.input!;
    const count = input.next.count;
    this.fallbackReset.fill(0, 0, count);
    let queueCount = 0;
    for (let pair = 0; pair < this.pairCount; pair += 1) {
      this.candidateChecks += 1;
      if (this.pairInherited[pair] === 1 || !this.pairOverlapsAtNext(pair)) continue;
      const agent = this.pairA[pair]!;
      const other = this.pairB[pair]!;
      if (this.fallbackReset[agent] === 0) {
        this.fallbackReset[agent] = 1;
        this.fallbackQueue[queueCount] = agent;
        queueCount += 1;
      }
      if (this.fallbackReset[other] === 0) {
        this.fallbackReset[other] = 1;
        this.fallbackQueue[queueCount] = other;
        queueCount += 1;
      }
    }
    if (queueCount === 0) return;

    this.ensureAdjacencyCapacity(this.pairCount * 2);
    this.adjacencyHead.fill(-1, 0, count);
    let edgeCount = 0;
    for (let pair = 0; pair < this.pairCount; pair += 1) {
      const agent = this.pairA[pair]!;
      const other = this.pairB[pair]!;
      this.adjacencyTo[edgeCount] = other;
      this.adjacencyNext[edgeCount] = this.adjacencyHead[agent]!;
      this.adjacencyHead[agent] = edgeCount;
      edgeCount += 1;
      this.adjacencyTo[edgeCount] = agent;
      this.adjacencyNext[edgeCount] = this.adjacencyHead[other]!;
      this.adjacencyHead[other] = edgeCount;
      edgeCount += 1;
    }

    let queueOffset = 0;
    while (queueOffset < queueCount) {
      const agent = this.fallbackQueue[queueOffset]!;
      queueOffset += 1;
      let edge = this.adjacencyHead[agent]!;
      while (edge !== -1) {
        const other = this.adjacencyTo[edge]!;
        if (this.fallbackReset[other] === 0) {
          this.candidateChecks += 1;
          const dx = input.current.x[agent]! - input.next.x[other]!;
          const dy = input.current.y[agent]! - input.next.y[other]!;
          if (dx * dx + dy * dy < this.reportSquared - OVERLAP_EPSILON) {
            this.fallbackReset[other] = 1;
            this.fallbackQueue[queueCount] = other;
            queueCount += 1;
          }
        }
        edge = this.adjacencyNext[edge]!;
      }
    }

    for (let offset = 0; offset < queueCount; offset += 1) {
      const agent = this.fallbackQueue[offset]!;
      if (Math.hypot(
        input.next.x[agent]! - input.current.x[agent]!,
        input.next.y[agent]! - input.current.y[agent]!,
      ) > DISTANCE_EPSILON) this.correctionCount += 1;
      this.rollbackAgents += 1;
      input.next.x[agent] = input.current.x[agent]!;
      input.next.y[agent] = input.current.y[agent]!;
    }
  }

  /**
   * Convert any collision-generated reverse endpoint into a safe local stop.
   *
   * The invariant is deliberately checked after every positional correction.
   * If a dependency reaches a frame-start overlap, that inherited component may
   * pause for this frame: preserving an existing penetration is safer than
   * allowing a new overlap or reverse motion, and its persistent escape bias
   * resumes bounded separation on the following frame.
   */
  private rollbackReverseClosure(): void {
    const input = this.input!;
    const count = input.next.count;
    this.fallbackReset.fill(0, 0, count);
    let queueCount = 0;
    for (let agent = 0; agent < count; agent += 1) {
      if (
        input.next.active[agent] !== 1
        || this.progressAt(agent, input.next.x[agent]!, input.next.y[agent]!) >= -PROGRESS_EPSILON
      ) continue;
      this.fallbackReset[agent] = 1;
      this.fallbackQueue[queueCount] = agent;
      queueCount += 1;
    }
    if (queueCount === 0) return;

    this.ensureAdjacencyCapacity(this.pairCount * 2);
    this.adjacencyHead.fill(-1, 0, count);
    let edgeCount = 0;
    for (let pair = 0; pair < this.pairCount; pair += 1) {
      const agent = this.pairA[pair]!;
      const other = this.pairB[pair]!;
      this.adjacencyTo[edgeCount] = other;
      this.adjacencyNext[edgeCount] = this.adjacencyHead[agent]!;
      this.adjacencyHead[agent] = edgeCount;
      edgeCount += 1;
      this.adjacencyTo[edgeCount] = agent;
      this.adjacencyNext[edgeCount] = this.adjacencyHead[other]!;
      this.adjacencyHead[other] = edgeCount;
      edgeCount += 1;
    }

    let queueOffset = 0;
    while (queueOffset < queueCount) {
      const agent = this.fallbackQueue[queueOffset]!;
      queueOffset += 1;
      let edge = this.adjacencyHead[agent]!;
      while (edge !== -1) {
        const other = this.adjacencyTo[edge]!;
        if (this.fallbackReset[other] === 0) {
          this.candidateChecks += 1;
          const dx = input.current.x[agent]! - input.next.x[other]!;
          const dy = input.current.y[agent]! - input.next.y[other]!;
          if (dx * dx + dy * dy < this.reportSquared - OVERLAP_EPSILON) {
            this.fallbackReset[other] = 1;
            this.fallbackQueue[queueCount] = other;
            queueCount += 1;
          }
        }
        edge = this.adjacencyNext[edge]!;
      }
    }

    for (let offset = 0; offset < queueCount; offset += 1) {
      const agent = this.fallbackQueue[offset]!;
      if (Math.hypot(
        input.next.x[agent]! - input.current.x[agent]!,
        input.next.y[agent]! - input.current.y[agent]!,
      ) > DISTANCE_EPSILON) this.correctionCount += 1;
      this.rollbackAgents += 1;
      input.next.x[agent] = input.current.x[agent]!;
      input.next.y[agent] = input.current.y[agent]!;
    }
  }

  private ensureAdjacencyCapacity(required: number): void {
    if (this.adjacencyTo.length >= required) return;
    let capacity = Math.max(128, this.adjacencyTo.length);
    while (capacity < required) capacity *= 2;
    this.adjacencyTo = new Int32Array(capacity);
    this.adjacencyNext = new Int32Array(capacity);
  }

  private pairOverlapsAtNext(pair: number): boolean {
    const input = this.input!;
    const agent = this.pairA[pair]!;
    const other = this.pairB[pair]!;
    const dx = input.next.x[agent]! - input.next.x[other]!;
    const dy = input.next.y[agent]! - input.next.y[other]!;
    return dx * dx + dy * dy < this.reportSquared - OVERLAP_EPSILON;
  }

  private findComponent(agent: number): number {
    let root = agent;
    while (this.componentParent[root] !== root) root = this.componentParent[root]!;
    let current = agent;
    while (this.componentParent[current] !== current) {
      const next = this.componentParent[current]!;
      this.componentParent[current] = root;
      current = next;
    }
    return root;
  }

  private unionComponents(agent: number, other: number): void {
    const agentRoot = this.findComponent(agent);
    const otherRoot = this.findComponent(other);
    if (agentRoot === otherRoot) return;
    if (agentRoot < otherRoot) this.componentParent[otherRoot] = agentRoot;
    else this.componentParent[agentRoot] = otherRoot;
  }

  private progressAt(agent: number, x: number, y: number): number {
    const input = this.input!;
    return (x - input.current.x[agent]!) * input.preferredX[agent]!
      + (y - input.current.y[agent]!) * input.preferredY[agent]!;
  }

  private isStrictlyStaticSafe(x: number, y: number): boolean {
    const input = this.input!;
    const strictClearance = this.clearance;
    if (
      !Number.isFinite(x)
      || !Number.isFinite(y)
      || x < strictClearance - STATIC_SLOP
      || y < strictClearance - STATIC_SLOP
      || x > input.worldWidth - strictClearance + STATIC_SLOP
      || y > input.worldHeight - strictClearance + STATIC_SLOP
    ) return false;
    const clearanceSquared = strictClearance * strictClearance;
    for (const obstacle of input.obstacles) {
      if (distanceSquaredToRect(x, y, obstacle) < clearanceSquared - STATIC_SLOP) return false;
    }
    return true;
  }

  private pairSide(agent: number, other: number): number {
    const input = this.input!;
    const agentSide = input.next.avoidanceSide[agent] !== 0
      ? input.next.avoidanceSide[agent]!
      : input.current.avoidanceSide[agent]!;
    if (agentSide !== 0) return agentSide > 0 ? 1 : -1;
    const otherSide = input.next.avoidanceSide[other] !== 0
      ? input.next.avoidanceSide[other]!
      : input.current.avoidanceSide[other]!;
    if (otherSide !== 0) return otherSide > 0 ? -1 : 1;
    return agent < other ? 1 : -1;
  }

  private countRemainingOverlaps(): void {
    const input = this.input!;
    input.overlapFlags?.fill(0);
    this.remainingOverlapPairs = 0;
    for (let pair = 0; pair < this.pairCount; pair += 1) {
      this.candidateChecks += 1;
      if (!this.pairOverlapsAtNext(pair)) continue;
      const agent = this.pairA[pair]!;
      const other = this.pairB[pair]!;
      this.remainingOverlapPairs += 1;
      if (input.overlapFlags) {
        input.overlapFlags[agent] = 1;
        input.overlapFlags[other] = 1;
      }
    }
  }
}
