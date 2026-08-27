import { CrowdSimulation, DEFAULT_CONFIG } from '../src/core/simulation';
import { getScenario } from '../src/scenarios/scenarios';

// Finds the first deep agent-agent penetration in the minimal pipeline and
// prints the involved agents' recent kinematic history so the source of the
// event (squeeze, projection, teleport) can be identified.

const simulation = new CrowdSimulation(
  { ...DEFAULT_CONFIG, seed: 42, agentCount: 1000, pipeline: 'minimal' },
  getScenario('obstacle-field'),
);
const DEPTH_THRESHOLD = 1.5;
const HISTORY = 6;
const count = simulation.state.count;
const historyX: Float64Array[] = [];
const historyY: Float64Array[] = [];
const historyVX: Float64Array[] = [];
const historyVY: Float64Array[] = [];

for (let step = 1; step <= 3600; step += 1) {
  historyX.push(new Float64Array(simulation.state.x));
  historyY.push(new Float64Array(simulation.state.y));
  historyVX.push(new Float64Array(simulation.state.vx));
  historyVY.push(new Float64Array(simulation.state.vy));
  if (historyX.length > HISTORY) {
    historyX.shift();
    historyY.shift();
    historyVX.shift();
    historyVY.shift();
  }
  simulation.step();
  if (simulation.metrics.overlapPairs === 0) continue;
  let worstDepth = 0;
  let worstA = -1;
  let worstB = -1;
  for (let a = 0; a < count; a += 1) {
    if (simulation.overlapFlags[a] !== 1) continue;
    for (let b = a + 1; b < count; b += 1) {
      if (simulation.overlapFlags[b] !== 1) continue;
      const dx = simulation.state.x[a]! - simulation.state.x[b]!;
      const dy = simulation.state.y[a]! - simulation.state.y[b]!;
      const depth = simulation.config.agentRadius * 2 - Math.hypot(dx, dy);
      if (depth > worstDepth) {
        worstDepth = depth;
        worstA = a;
        worstB = b;
      }
    }
  }
  if (worstDepth < DEPTH_THRESHOLD) continue;
  console.log(JSON.stringify({
    step,
    worstDepth: Number(worstDepth.toFixed(4)),
    agents: [worstA, worstB].map((agent) => ({
      agent,
      x: Number(simulation.state.x[agent]!.toFixed(3)),
      y: Number(simulation.state.y[agent]!.toFixed(3)),
      vx: Number(simulation.state.vx[agent]!.toFixed(2)),
      vy: Number(simulation.state.vy[agent]!.toFixed(2)),
      history: historyX.map((_, h) => ({
        x: Number(historyX[h]![agent]!.toFixed(3)),
        y: Number(historyY[h]![agent]!.toFixed(3)),
        vx: Number(historyVX[h]![agent]!.toFixed(2)),
        vy: Number(historyVY[h]![agent]!.toFixed(2)),
      })),
    })),
  }, null, 1));
  break;
}
console.log('done at step scan end');
