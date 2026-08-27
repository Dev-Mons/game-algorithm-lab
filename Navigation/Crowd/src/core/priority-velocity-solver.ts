import type { AgentBuffer } from './agent-state';

const DISTANCE_EPSILON = 1e-12;
const CONTACT_EPSILON = 1e-4;
const SAFETY_EPSILON = 1e-9;
const BINARY_SEARCH_PASSES = 12;
const SOLVER_PASSES = 8;

export interface PriorityVelocitySolverInput {
  /** Complete state at the beginning of the fixed step. */
  current: AgentBuffer;
  /** Static-safe proposal. Each accepted displacement is a scaled proposal. */
  next: AgentBuffer;
  active: Uint8Array;
  /** Unit route headings sampled before local avoidance. */
  preferredDirectionX: Float64Array;
  preferredDirectionY: Float64Array;
  /** Smaller values are closer to the goal and receive right of way. */
  routeCost: Float64Array;
  /** Deterministic neighbor cache built from current positions. */
  neighborOffsets: Int32Array;
  neighborIndices: Int32Array;
  agentRadius: number;
  fixedDelta: number;
  overlapFlags?: Uint8Array;
}

export interface PriorityVelocityResult {
  limitedAgents: number;
  stoppedAgents: number;
  candidateChecks: number;
  remainingOverlapPairs: number;
  minimumScale: number;
  maximumVelocityChange: number;
}

/**
 * Monotone, front-to-back velocity solver for RTS-style crowds.
 *
 * Every agent starts with its independently planned, static-safe displacement.
 * Conflicting pairs are visited in route order, but right of way is decided
 * from each pair's local stream direction. The unit that is geometrically
 * behind shortens only its own displacement while the unit ahead stays
 * unchanged. A speed reduction can propagate to agents farther behind, but no
 * position correction is ever transferred through a contact component.
 *
 * Scales only decrease during a step. This makes the fixed number of passes
 * deterministic and prevents an already-yielding follower from accelerating
 * again because another pair was visited later.
 */
export class PriorityVelocitySolver {
  private proposalX = new Float64Array(0);
  private proposalY = new Float64Array(0);
  private scale = new Float64Array(0);
  private rank = new Int32Array(0);
  private readonly order: number[] = [];
  private input: PriorityVelocitySolverInput | null = null;
  private contactRadius = 0;
  private contactSquared = 0;

  private readonly result: PriorityVelocityResult = {
    limitedAgents: 0,
    stoppedAgents: 0,
    candidateChecks: 0,
    remainingOverlapPairs: 0,
    minimumScale: 1,
    maximumVelocityChange: 0,
  };

  solve(input: PriorityVelocitySolverInput): PriorityVelocityResult {
    this.assertCompatibleInput(input);
    this.ensureCapacity(input.current.count);
    this.input = input;
    this.contactRadius = Math.max(0, input.agentRadius * 2 + CONTACT_EPSILON);
    this.contactSquared = this.contactRadius * this.contactRadius;
    this.proposalX.set(input.next.x);
    this.proposalY.set(input.next.y);
    this.scale.fill(1, 0, input.current.count);
    this.rank.fill(-1, 0, input.current.count);
    input.overlapFlags?.fill(0);
    this.order.length = 0;
    this.resetResult();

    for (let agent = 0; agent < input.current.count; agent += 1) {
      if (input.active[agent] === 1) this.order.push(agent);
      else this.scale[agent] = 0;
    }
    this.order.sort((first, second) => this.comparePriority(first, second));
    for (let offset = 0; offset < this.order.length; offset += 1) {
      this.rank[this.order[offset]!] = offset;
    }

    for (let pass = 0; pass < SOLVER_PASSES; pass += 1) {
      let changed = false;
      let violations = 0;
      for (let orderOffset = 0; orderOffset < this.order.length; orderOffset += 1) {
        const leader = this.order[orderOffset]!;
        const start = input.neighborOffsets[leader]!;
        const end = input.neighborOffsets[leader + 1]!;
        for (let neighborOffset = start; neighborOffset < end; neighborOffset += 1) {
          const other = input.neighborIndices[neighborOffset]!;
          if (input.active[other] !== 1 || this.rank[other]! <= orderOffset) continue;
          this.result.candidateChecks += 1;
          const firstHasPriority = this.firstHasLocalPriority(leader, other);
          const pairLeader = firstHasPriority ? leader : other;
          const follower = firstHasPriority ? other : leader;
          if (this.pairIsSafe(pairLeader, this.scale[pairLeader]!, follower, this.scale[follower]!)) continue;
          violations += 1;

          const oldFollowerScale = this.scale[follower]!;
          const followerScale = this.maximumSafeScale(follower, pairLeader, oldFollowerScale);
          if (followerScale >= 0) {
            if (followerScale < oldFollowerScale - 1e-6) {
              this.scale[follower] = followerScale;
              changed = true;
            }
            continue;
          }

          // The leader's retained motion would hit even a stationary follower.
          // Stop the follower, then shorten the leader's own velocity as well.
          // Both changes remain local velocity choices; neither endpoint pushes
          // a third agent and the next pass propagates braking farther forward.
          if (oldFollowerScale > 1e-6) {
            this.scale[follower] = 0;
            changed = true;
          }
          const oldLeaderScale = this.scale[pairLeader]!;
          const leaderScale = this.maximumSafeScale(pairLeader, follower, oldLeaderScale);
          if (leaderScale >= 0 && leaderScale < oldLeaderScale - 1e-6) {
            this.scale[pairLeader] = leaderScale;
            changed = true;
          } else if (leaderScale < 0 && oldLeaderScale > 1e-6) {
            this.scale[pairLeader] = 0;
            changed = true;
          }
        }
      }
      if (violations === 0 || !changed) break;
    }

    this.commitScaledVelocities();
    this.countRemainingOverlaps();
    this.input = null;
    return this.result;
  }

  private resetResult(): void {
    this.result.limitedAgents = 0;
    this.result.stoppedAgents = 0;
    this.result.candidateChecks = 0;
    this.result.remainingOverlapPairs = 0;
    this.result.minimumScale = 1;
    this.result.maximumVelocityChange = 0;
  }

  private assertCompatibleInput(input: PriorityVelocitySolverInput): void {
    const count = input.current.count;
    if (
      input.next.count !== count
      || input.active.length < count
      || input.preferredDirectionX.length < count
      || input.preferredDirectionY.length < count
      || input.routeCost.length < count
      || input.neighborOffsets.length < count + 1
      || (input.overlapFlags !== undefined && input.overlapFlags.length < count)
    ) {
      throw new RangeError('Priority velocity solver buffers must describe the same agent count.');
    }
    if (!(input.fixedDelta > 0)) throw new RangeError('fixedDelta must be positive.');
  }

  private ensureCapacity(count: number): void {
    if (this.proposalX.length >= count) return;
    this.proposalX = new Float64Array(count);
    this.proposalY = new Float64Array(count);
    this.scale = new Float64Array(count);
    this.rank = new Int32Array(count);
  }

  private comparePriority(first: number, second: number): number {
    const input = this.input!;
    const firstCost = input.routeCost[first]!;
    const secondCost = input.routeCost[second]!;
    if (Number.isFinite(firstCost) && Number.isFinite(secondCost)) {
      const difference = firstCost - secondCost;
      if (Math.abs(difference) > DISTANCE_EPSILON) return difference;
    } else if (Number.isFinite(firstCost)) return -1;
    else if (Number.isFinite(secondCost)) return 1;
    return first - second;
  }

  /**
   * Same-stream pairs use physical front/back order instead of a global field
   * cost. This matters around bends and split corridors, where two neighboring
   * cells can have route costs that do not represent their actual lane order.
   */
  private firstHasLocalPriority(first: number, second: number): boolean {
    const input = this.input!;
    let firstHeadingX = input.preferredDirectionX[first]!;
    let firstHeadingY = input.preferredDirectionY[first]!;
    let secondHeadingX = input.preferredDirectionX[second]!;
    let secondHeadingY = input.preferredDirectionY[second]!;
    let firstLength = Math.hypot(firstHeadingX, firstHeadingY);
    let secondLength = Math.hypot(secondHeadingX, secondHeadingY);

    if (firstLength <= DISTANCE_EPSILON) {
      firstHeadingX = this.proposalX[first]! - input.current.x[first]!;
      firstHeadingY = this.proposalY[first]! - input.current.y[first]!;
      firstLength = Math.hypot(firstHeadingX, firstHeadingY);
    }
    if (secondLength <= DISTANCE_EPSILON) {
      secondHeadingX = this.proposalX[second]! - input.current.x[second]!;
      secondHeadingY = this.proposalY[second]! - input.current.y[second]!;
      secondLength = Math.hypot(secondHeadingX, secondHeadingY);
    }

    if (firstLength > DISTANCE_EPSILON && secondLength > DISTANCE_EPSILON) {
      firstHeadingX /= firstLength;
      firstHeadingY /= firstLength;
      secondHeadingX /= secondLength;
      secondHeadingY /= secondLength;
      const alignment = firstHeadingX * secondHeadingX + firstHeadingY * secondHeadingY;
      if (alignment > 0.5) {
        let streamX = firstHeadingX + secondHeadingX;
        let streamY = firstHeadingY + secondHeadingY;
        const streamLength = Math.hypot(streamX, streamY);
        if (streamLength > DISTANCE_EPSILON) {
          streamX /= streamLength;
          streamY /= streamLength;
          const secondProgress = (input.current.x[second]! - input.current.x[first]!) * streamX
            + (input.current.y[second]! - input.current.y[first]!) * streamY;
          const deadZone = input.agentRadius * 0.25;
          if (secondProgress > deadZone) return false;
          if (secondProgress < -deadZone) return true;
        }
      }
    }
    return this.comparePriority(first, second) <= 0;
  }

  private maximumSafeScale(agent: number, other: number, maximum: number): number {
    const otherScale = this.scale[other]!;
    if (this.pairIsSafe(agent, maximum, other, otherScale)) return maximum;
    if (!this.pairIsSafe(agent, 0, other, otherScale)) return -1;
    let safe = 0;
    let unsafe = maximum;
    for (let pass = 0; pass < BINARY_SEARCH_PASSES; pass += 1) {
      const candidate = (safe + unsafe) * 0.5;
      if (this.pairIsSafe(agent, candidate, other, otherScale)) safe = candidate;
      else unsafe = candidate;
    }
    return safe;
  }

  private pairIsSafe(agent: number, agentScale: number, other: number, otherScale: number): boolean {
    const input = this.input!;
    const relativeX = input.current.x[agent]! - input.current.x[other]!;
    const relativeY = input.current.y[agent]! - input.current.y[other]!;
    const relativeMovementX = (
      this.proposalX[agent]! - input.current.x[agent]!
    ) * agentScale - (
      this.proposalX[other]! - input.current.x[other]!
    ) * otherScale;
    const relativeMovementY = (
      this.proposalY[agent]! - input.current.y[agent]!
    ) * agentScale - (
      this.proposalY[other]! - input.current.y[other]!
    ) * otherScale;
    const currentSquared = relativeX * relativeX + relativeY * relativeY;
    const endX = relativeX + relativeMovementX;
    const endY = relativeY + relativeMovementY;
    const endSquared = endX * endX + endY * endY;

    if (currentSquared < this.contactSquared - SAFETY_EPSILON) {
      return endSquared > currentSquared + SAFETY_EPSILON;
    }
    // At 60 Hz an agent travels far less than one diameter. Endpoint
    // non-penetration is therefore the useful gameplay constraint; treating a
    // shallow sub-frame tangent as a full stop needlessly freezes dense lanes.
    return endSquared >= this.contactSquared - SAFETY_EPSILON;
  }

  private commitScaledVelocities(): void {
    const input = this.input!;
    for (let offset = 0; offset < this.order.length; offset += 1) {
      const agent = this.order[offset]!;
      const scale = this.scale[agent]!;
      const currentX = input.current.x[agent]!;
      const currentY = input.current.y[agent]!;
      const proposedDeltaX = this.proposalX[agent]! - currentX;
      const proposedDeltaY = this.proposalY[agent]! - currentY;
      input.next.x[agent] = currentX + proposedDeltaX * scale;
      input.next.y[agent] = currentY + proposedDeltaY * scale;
      if (scale >= 1 - 1e-6) continue;
      this.result.limitedAgents += 1;
      this.result.minimumScale = Math.min(this.result.minimumScale, scale);
      if (scale <= 1e-3) this.result.stoppedAgents += 1;
      this.result.maximumVelocityChange = Math.max(
        this.result.maximumVelocityChange,
        Math.hypot(proposedDeltaX, proposedDeltaY) * (1 - scale) / input.fixedDelta,
      );
    }
  }

  private countRemainingOverlaps(): void {
    const input = this.input!;
    for (let agent = 0; agent < input.current.count; agent += 1) {
      if (input.active[agent] !== 1) continue;
      const start = input.neighborOffsets[agent]!;
      const end = input.neighborOffsets[agent + 1]!;
      for (let offset = start; offset < end; offset += 1) {
        const other = input.neighborIndices[offset]!;
        if (other <= agent || input.active[other] !== 1) continue;
        this.result.candidateChecks += 1;
        const dx = input.next.x[agent]! - input.next.x[other]!;
        const dy = input.next.y[agent]! - input.next.y[other]!;
        if (dx * dx + dy * dy >= (input.agentRadius * 2) ** 2 - SAFETY_EPSILON) continue;
        this.result.remainingOverlapPairs += 1;
        if (input.overlapFlags) {
          input.overlapFlags[agent] = 1;
          input.overlapFlags[other] = 1;
        }
      }
    }
  }
}
