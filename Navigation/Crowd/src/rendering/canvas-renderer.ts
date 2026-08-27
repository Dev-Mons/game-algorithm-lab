import type { CrowdSimulation } from '../core/simulation';
import type { Renderer } from '../core/types';
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
    const simulation = this.getSimulation();
    const interpolation = Math.min(1, Math.max(0, alpha));
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
    for (const goal of simulation.goals) {
      context.fillStyle = 'rgba(45, 212, 191, 0.08)';
      context.strokeStyle = '#2dd4bf';
      context.lineWidth = 2;
      context.beginPath();
      context.arc(goal.x, goal.y, simulation.config.goalRadius + pulse, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      context.fillStyle = '#5eead4';
      context.beginPath();
      context.arc(goal.x, goal.y, 4, 0, Math.PI * 2);
      context.fill();
    }

    const radius = simulation.config.agentRadius;
    const previous = simulation.previousState;
    context.fillStyle = '#60a5fa';
    for (let agent = 0; agent < simulation.state.count; agent += 1) {
      if (simulation.state.active[agent] !== 1) continue;
      const x = previous.x[agent]!
        + (simulation.state.x[agent]! - previous.x[agent]!) * interpolation;
      const y = previous.y[agent]!
        + (simulation.state.y[agent]! - previous.y[agent]!) * interpolation;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
    }

    // Heading is presentation-only and follows the latest command intent
    // immediately. Physical velocity remains acceleration-limited by the solver.
    context.strokeStyle = 'rgba(219, 234, 254, 0.72)';
    context.lineWidth = Math.max(1, radius * 0.32);
    context.beginPath();
    for (let agent = 0; agent < simulation.state.count; agent += 1) {
      if (simulation.state.active[agent] !== 1) continue;
      const x = previous.x[agent]!
        + (simulation.state.x[agent]! - previous.x[agent]!) * interpolation;
      const y = previous.y[agent]!
        + (simulation.state.y[agent]! - previous.y[agent]!) * interpolation;
      let headingX = simulation.state.intentX[agent]!;
      let headingY = simulation.state.intentY[agent]!;
      let length = Math.hypot(headingX, headingY);
      if (length <= 1e-6) {
        headingX = simulation.state.vx[agent]!;
        headingY = simulation.state.vy[agent]!;
        length = Math.hypot(headingX, headingY);
      }
      if (length <= 1e-6) continue;
      context.moveTo(x, y);
      context.lineTo(
        x + headingX / length * radius * 1.45,
        y + headingY / length * radius * 1.45,
      );
    }
    context.stroke();

    drawDebug(context, simulation, this.debug, interpolation);
  }
}
