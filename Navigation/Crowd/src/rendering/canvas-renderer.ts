import type { Renderer } from '../core/types';
import type { CrowdSimulation } from '../core/simulation';
import { drawDebug, type DebugOptions } from './debug-drawing';

export class CanvasRenderer implements Renderer {
  private readonly context: CanvasRenderingContext2D;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly getSimulation: () => CrowdSimulation,
    private readonly debug: DebugOptions,
  ) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D context is unavailable.');
    this.context = context;
  }

  render(alpha: number): void {
    void alpha;
    const simulation = this.getSimulation();
    const context = this.context;
    context.clearRect(0, 0, this.canvas.width, this.canvas.height);

    const gradient = context.createLinearGradient(0, 0, simulation.config.width, simulation.config.height);
    gradient.addColorStop(0, '#0b1424');
    gradient.addColorStop(1, '#101d31');
    context.fillStyle = gradient;
    context.fillRect(0, 0, simulation.config.width, simulation.config.height);

    context.fillStyle = 'rgba(15, 23, 42, 0.9)';
    context.strokeStyle = 'rgba(148, 163, 184, 0.45)';
    context.lineWidth = 2;
    for (const obstacle of simulation.scenario.obstacles) {
      context.fillRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height);
      context.strokeRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height);
    }

    const pulse = 3 + Math.sin(simulation.stepCount * 0.05) * 2;
    context.fillStyle = 'rgba(45, 212, 191, 0.08)';
    context.strokeStyle = '#2dd4bf';
    context.lineWidth = 2;
    context.beginPath();
    context.arc(simulation.goal.x, simulation.goal.y, simulation.config.goalRadius + pulse, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.fillStyle = '#5eead4';
    context.beginPath();
    context.arc(simulation.goal.x, simulation.goal.y, 4, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = '#60a5fa';
    const radius = simulation.config.agentRadius;
    for (let i = 0; i < simulation.state.count; i += 1) {
      if (simulation.state.active[i] !== 1) continue;
      context.beginPath();
      context.arc(simulation.state.x[i]!, simulation.state.y[i]!, radius, 0, Math.PI * 2);
      context.fill();
    }

    drawDebug(context, simulation, this.debug);
  }
}
