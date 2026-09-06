import { describe, expect, it } from 'vitest';
import { CrowdContinuityTracker } from '../../src/core/crowd-continuity-metrics';
import { CrowdSimulation, DEFAULT_CONFIG } from '../../src/core/simulation';
import { getScenario } from '../../src/scenarios/scenarios';

function patch(hole: boolean) {
  const simulation = new CrowdSimulation({...DEFAULT_CONFIG,agentRadius:1,agentGap:0,
    agentCount:25},getScenario('open-field'));
  for(let i=0;i<25;i++) {
    simulation.state.x[i]=100+(i%5+.5)*4;
    simulation.state.y[i]=100+(Math.floor(i/5)+.5)*4;
    simulation.state.vx[i]=40; simulation.state.vy[i]=0;
  }
  if(hole) simulation.state.active[12]=0;
  const tracker = new CrowdContinuityTracker(simulation);
  tracker.update();
  return tracker.snapshot();
}

describe('continuity diagnostics',()=>{
  it('excludes exterior empty space and measures uniform same-flow spacing',()=>{
    const result=patch(false);
    expect(result.interiorVoidFraction).toBe(0);
    expect(result.densityVariance).toBe(0);
    expect(result.sameFlowVelocityRms).toBe(0);
    expect(result.spacingP50).toBeCloseTo(4,1);
    expect(result.spacingCoverage).toBe(1);
  });
  it('detects an interior gap without treating all exterior cells as gaps',()=>{
    const result=patch(true);
    expect(result.interiorVoidFraction).toBeGreaterThan(0);
    expect(result.interiorVoidFraction).toBeLessThan(.2);
    expect(result.densityVariance).toBeGreaterThan(0);
  });
});
