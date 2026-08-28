import type { CrowdSimulation } from './simulation';

const EPSILON = 1e-9;
const HISTOGRAM_BINS = 512;
const MAX_DENSITY_SAMPLE = 10_000;
const MAX_JERK_SAMPLE = 100_000;
const PENETRATION_QUERY_LIMIT = 16;

export interface CrowdQualitySnapshot {
  steps: number;
  maxPenetrationDepth: number;
  penetrationP95: number;
  occupiedArea: number;
  occupiedCellCount: number;
  maximumOccupiedArea: number;
  densityP95: number;
  velocityCoherence: number;
  angularVelocityP95: number;
  jerkP95: number;
  overloadedCellCount: number;
  maximumOverloadedCellLifetime: number;
  contactChecks: number;
  contactConstraints: number;
  constraintIterations: number;
  maxContacts: number;
  maximumContactCorrectedAgents: number;
  maximumCandidateChecks: number;
  maximumPositionCorrection: number;
  maximumStaticProjectionCorrections: number;
  maximumStaticProjectionDistance: number;
  averageGoalProgress: number;
  maximumWallOverlapCount: number;
  maximumBackwardCount: number;
  hash: string;
}

/**
 * Deterministic, bounded-work quality instrumentation.
 *
 * Agent quantiles use fixed histograms. Penetration checks inspect at most a
 * constant number of spatial-hash candidates per active Agent; no full pair
 * scan or per-step Agent-sized allocation is performed.
 */
export class CrowdQualityTracker {
  private readonly densityHistogram = new Uint32Array(HISTOGRAM_BINS);
  private readonly penetrationHistogram = new Uint32Array(HISTOGRAM_BINS);
  private readonly angularVelocityHistogram = new Uint32Array(HISTOGRAM_BINS);
  private readonly jerkHistogram = new Uint32Array(HISTOGRAM_BINS);
  private readonly previousAccelerationX: Float64Array;
  private readonly previousAccelerationY: Float64Array;
  private readonly candidates = new Int32Array(PENETRATION_QUERY_LIMIT);
  private readonly averageVelocity = { x: 0, y: 0 };
  private densitySamples = 0;
  private penetrationSamples = 0;
  private angularVelocitySamples = 0;
  private jerkSamples = 0;
  private coherenceSum = 0;
  private coherenceSamples = 0;
  private maximumPenetration = 0;
  private maximumOccupiedArea = 0;
  private maximumOverloadedCells = 0;
  private maximumOverloadedCellLifetime = 0;
  private maximumContactChecks = 0;
  private maximumContactConstraints = 0;
  private maximumConstraintIterations = 0;
  private maximumContacts = 0;
  private maximumContactCorrectedAgents = 0;
  private maximumCandidateChecks = 0;
  private maximumPositionCorrection = 0;
  private maximumStaticProjectionCorrections = 0;
  private maximumStaticProjectionDistance = 0;
  private maximumWallOverlapCount = 0;
  private maximumBackwardCount = 0;
  private goalProgressSum = 0;
  private goalProgressSamples = 0;
  private updates = 0;

  constructor(private readonly simulation: CrowdSimulation) {
    this.previousAccelerationX = new Float64Array(simulation.state.count);
    this.previousAccelerationY = new Float64Array(simulation.state.count);
  }

  update(): void {
    const simulation = this.simulation;
    const state = simulation.state;
    const previous = simulation.previousState;
    const field = simulation.crowdField;
    const inverseDelta = 1 / Math.max(EPSILON, simulation.config.fixedDelta);
    const diameter = simulation.config.agentRadius * 2;
    this.densityHistogram.fill(0);
    this.penetrationHistogram.fill(0);
    this.densitySamples = 0;
    this.penetrationSamples = 0;
    this.maximumPenetration = 0;
    this.updates += 1;

    this.maximumOccupiedArea = Math.max(
      this.maximumOccupiedArea,
      field.occupiedCellCount * field.cellSize * field.cellSize,
    );
    this.maximumOverloadedCells = Math.max(this.maximumOverloadedCells, field.overloadedCellCount);
    this.maximumOverloadedCellLifetime = Math.max(
      this.maximumOverloadedCellLifetime,
      field.maximumOverloadAge,
    );
    this.maximumContactChecks = Math.max(
      this.maximumContactChecks,
      simulation.metrics.contactChecks,
    );
    this.maximumContactConstraints = Math.max(
      this.maximumContactConstraints,
      simulation.metrics.contactConstraints,
    );
    this.maximumConstraintIterations = Math.max(
      this.maximumConstraintIterations,
      simulation.metrics.constraintIterations,
    );
    this.maximumContacts = Math.max(
      this.maximumContacts,
      simulation.metrics.maxContacts,
    );
    this.maximumContactCorrectedAgents = Math.max(
      this.maximumContactCorrectedAgents,
      simulation.metrics.contactCorrectedAgents,
    );
    this.maximumCandidateChecks = Math.max(
      this.maximumCandidateChecks,
      simulation.metrics.candidateChecks,
    );
    this.maximumPositionCorrection = Math.max(
      this.maximumPositionCorrection,
      simulation.metrics.maxContactCorrection,
    );
    this.maximumStaticProjectionCorrections = Math.max(
      this.maximumStaticProjectionCorrections,
      simulation.metrics.staticProjectionCorrections,
    );
    this.maximumStaticProjectionDistance = Math.max(
      this.maximumStaticProjectionDistance,
      simulation.metrics.maxRecoveryDistance,
    );
    this.maximumWallOverlapCount = Math.max(
      this.maximumWallOverlapCount,
      simulation.metrics.wallOverlapCount,
    );
    this.maximumBackwardCount = Math.max(
      this.maximumBackwardCount,
      simulation.metrics.backwardCount,
    );

    simulation.neighbors.rebuild(state.x, state.y, state.active);
    for (let agent = 0; agent < state.count; agent += 1) {
      if (state.active[agent] !== 1) continue;
      const density = field.sampleDensity(state.x[agent]!, state.y[agent]!);
      this.addLogSample(this.densityHistogram, density, MAX_DENSITY_SAMPLE);
      this.densitySamples += 1;

      const velocityX = state.vx[agent]!;
      const velocityY = state.vy[agent]!;
      const speed = Math.hypot(velocityX, velocityY);
      field.sampleAverageVelocity(state.x[agent]!, state.y[agent]!, this.averageVelocity);
      const averageSpeed = Math.hypot(this.averageVelocity.x, this.averageVelocity.y);
      if (speed > EPSILON && averageSpeed > EPSILON) {
        this.coherenceSum += (
          velocityX * this.averageVelocity.x + velocityY * this.averageVelocity.y
        ) / (speed * averageSpeed);
        this.coherenceSamples += 1;
      }

      const previousVelocityX = previous.vx[agent]!;
      const previousVelocityY = previous.vy[agent]!;
      const previousSpeed = Math.hypot(previousVelocityX, previousVelocityY);
      if (speed > EPSILON && previousSpeed > EPSILON) {
        const cosine = Math.max(-1, Math.min(1, (
          velocityX * previousVelocityX + velocityY * previousVelocityY
        ) / (speed * previousSpeed)));
        const angularVelocity = Math.acos(cosine) * inverseDelta;
        this.addLinearSample(
          this.angularVelocityHistogram,
          angularVelocity,
          Math.PI * inverseDelta,
        );
        this.angularVelocitySamples += 1;
      }

      const accelerationX = (velocityX - previousVelocityX) * inverseDelta;
      const accelerationY = (velocityY - previousVelocityY) * inverseDelta;
      const jerk = Math.hypot(
        accelerationX - this.previousAccelerationX[agent]!,
        accelerationY - this.previousAccelerationY[agent]!,
      ) * inverseDelta;
      this.addLogSample(this.jerkHistogram, jerk, MAX_JERK_SAMPLE);
      this.jerkSamples += 1;
      this.previousAccelerationX[agent] = accelerationX;
      this.previousAccelerationY[agent] = accelerationY;

      this.goalProgressSum += velocityX * state.intentX[agent]! + velocityY * state.intentY[agent]!;
      this.goalProgressSamples += 1;

      const candidateCount = simulation.neighbors.queryCandidates(
        state.x[agent]!,
        state.y[agent]!,
        diameter + 0.001,
        this.candidates,
        PENETRATION_QUERY_LIMIT,
      );
      for (let candidateIndex = 0; candidateIndex < candidateCount; candidateIndex += 1) {
        const other = this.candidates[candidateIndex]!;
        if (other <= agent || state.active[other] !== 1) continue;
        const dx = state.x[other]! - state.x[agent]!;
        const dy = state.y[other]! - state.y[agent]!;
        const penetration = diameter - Math.hypot(dx, dy);
        if (penetration <= 0) continue;
        this.maximumPenetration = Math.max(this.maximumPenetration, penetration);
        this.addLinearSample(this.penetrationHistogram, penetration, diameter);
        this.penetrationSamples += 1;
      }
    }
  }

  snapshot(): CrowdQualitySnapshot {
    const field = this.simulation.crowdField;
    return {
      steps: this.updates,
      maxPenetrationDepth: this.maximumPenetration,
      penetrationP95: this.linearPercentile(
        this.penetrationHistogram,
        this.penetrationSamples,
        this.simulation.config.agentRadius * 2,
      ),
      occupiedArea: field.occupiedCellCount * field.cellSize * field.cellSize,
      occupiedCellCount: field.occupiedCellCount,
      maximumOccupiedArea: this.maximumOccupiedArea,
      densityP95: this.logPercentile(
        this.densityHistogram,
        this.densitySamples,
        MAX_DENSITY_SAMPLE,
      ),
      velocityCoherence: this.coherenceSum / Math.max(1, this.coherenceSamples),
      angularVelocityP95: this.linearPercentile(
        this.angularVelocityHistogram,
        this.angularVelocitySamples,
        Math.PI / Math.max(EPSILON, this.simulation.config.fixedDelta),
      ),
      jerkP95: this.logPercentile(this.jerkHistogram, this.jerkSamples, MAX_JERK_SAMPLE),
      overloadedCellCount: this.maximumOverloadedCells,
      maximumOverloadedCellLifetime: this.maximumOverloadedCellLifetime,
      contactChecks: this.maximumContactChecks,
      contactConstraints: this.maximumContactConstraints,
      constraintIterations: this.maximumConstraintIterations,
      maxContacts: this.maximumContacts,
      maximumContactCorrectedAgents: this.maximumContactCorrectedAgents,
      maximumCandidateChecks: this.maximumCandidateChecks,
      maximumPositionCorrection: this.maximumPositionCorrection,
      maximumStaticProjectionCorrections: this.maximumStaticProjectionCorrections,
      maximumStaticProjectionDistance: this.maximumStaticProjectionDistance,
      averageGoalProgress: this.goalProgressSum / Math.max(1, this.goalProgressSamples),
      maximumWallOverlapCount: this.maximumWallOverlapCount,
      maximumBackwardCount: this.maximumBackwardCount,
      hash: this.simulation.stateHash(),
    };
  }

  private addLinearSample(histogram: Uint32Array, value: number, maximum: number): void {
    const normalized = Math.max(0, Math.min(1, value / Math.max(EPSILON, maximum)));
    const bin = Math.min(HISTOGRAM_BINS - 1, Math.floor(normalized * HISTOGRAM_BINS));
    histogram[bin] = histogram[bin]! + 1;
  }

  private addLogSample(histogram: Uint32Array, value: number, maximum: number): void {
    const normalized = Math.log1p(Math.max(0, Math.min(maximum, value))) / Math.log1p(maximum);
    const bin = Math.min(HISTOGRAM_BINS - 1, Math.floor(normalized * HISTOGRAM_BINS));
    histogram[bin] = histogram[bin]! + 1;
  }

  private linearPercentile(histogram: Uint32Array, samples: number, maximum: number): number {
    if (samples <= 0) return 0;
    const bin = this.percentileBin(histogram, samples, 0.95);
    return ((bin + 0.5) / HISTOGRAM_BINS) * maximum;
  }

  private logPercentile(histogram: Uint32Array, samples: number, maximum: number): number {
    if (samples <= 0) return 0;
    const bin = this.percentileBin(histogram, samples, 0.95);
    return Math.expm1(((bin + 0.5) / HISTOGRAM_BINS) * Math.log1p(maximum));
  }

  private percentileBin(histogram: Uint32Array, samples: number, fraction: number): number {
    if (samples <= 0) return 0;
    const target = Math.max(1, Math.ceil(samples * fraction));
    let cumulative = 0;
    for (let bin = 0; bin < histogram.length; bin += 1) {
      cumulative += histogram[bin]!;
      if (cumulative >= target) return bin;
    }
    return histogram.length - 1;
  }
}
