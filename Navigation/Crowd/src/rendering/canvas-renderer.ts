import type { Renderer } from '../core/types';
import type { CrowdSimulation } from '../core/simulation';
import { drawDebug, type DebugOptions } from './debug-drawing';

export class CanvasRenderer implements Renderer {
  private readonly context: CanvasRenderingContext2D;
  private headingX = new Float64Array(0);
  private headingY = new Float64Array(0);
  private headingSimulation: CrowdSimulation | null = null;
  private headingStep = -1;
  private readonly sampledHeading = { x: 1, y: 0 };

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
    this.updateVisualHeadings(simulation);
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
    for (const goal of simulation.goals) {
      context.beginPath();
      context.arc(goal.x, goal.y, simulation.config.goalRadius + pulse, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      context.fillStyle = '#5eead4';
      context.beginPath();
      context.arc(goal.x, goal.y, 4, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = 'rgba(45, 212, 191, 0.08)';
    }

    context.fillStyle = '#60a5fa';
    const radius = simulation.config.agentRadius;
    const previous = simulation.previousState;
    for (let i = 0; i < simulation.state.count; i += 1) {
      if (simulation.state.active[i] !== 1) continue;
      const x = previous.x[i]! + (simulation.state.x[i]! - previous.x[i]!) * interpolation;
      const y = previous.y[i]! + (simulation.state.y[i]! - previous.y[i]!) * interpolation;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
    }

    context.strokeStyle = 'rgba(219, 234, 254, 0.72)';
    context.lineWidth = Math.max(1, radius * 0.32);
    context.beginPath();
    for (let i = 0; i < simulation.state.count; i += 1) {
      if (simulation.state.active[i] !== 1) continue;
      const x = previous.x[i]! + (simulation.state.x[i]! - previous.x[i]!) * interpolation;
      const y = previous.y[i]! + (simulation.state.y[i]! - previous.y[i]!) * interpolation;
      context.moveTo(x, y);
      context.lineTo(x + this.headingX[i]! * radius * 1.45, y + this.headingY[i]! * radius * 1.45);
    }
    context.stroke();

    drawDebug(context, simulation, this.debug, interpolation);
  }

  private updateVisualHeadings(simulation: CrowdSimulation): void {
    if (
      this.headingSimulation !== simulation
      || this.headingX.length !== simulation.state.count
      || simulation.stepCount < this.headingStep
    ) {
      this.headingSimulation = simulation;
      this.headingX = new Float64Array(simulation.state.count);
      this.headingY = new Float64Array(simulation.state.count);
      this.headingStep = simulation.stepCount;
      for (let i = 0; i < simulation.state.count; i += 1) this.initializeHeading(simulation, i);
      return;
    }
    if (simulation.stepCount === this.headingStep) return;
    const elapsedSteps = simulation.stepCount - this.headingStep;
    const maximumTurn = Math.max(0, simulation.config.maxTurnRate)
      * simulation.config.fixedDelta * elapsedSteps;
    for (let i = 0; i < simulation.state.count; i += 1) {
      if (simulation.state.active[i] !== 1) continue;
      const speed = Math.hypot(simulation.state.vx[i]!, simulation.state.vy[i]!);
      if (speed <= 1e-6) continue;
      const targetX = simulation.state.vx[i]! / speed;
      const targetY = simulation.state.vy[i]! / speed;
      const currentX = this.headingX[i]!;
      const currentY = this.headingY[i]!;
      const delta = Math.atan2(
        currentX * targetY - currentY * targetX,
        currentX * targetX + currentY * targetY,
      );
      const turn = Math.max(-maximumTurn, Math.min(maximumTurn, delta));
      const cosine = Math.cos(turn);
      const sine = Math.sin(turn);
      this.headingX[i] = currentX * cosine - currentY * sine;
      this.headingY[i] = currentX * sine + currentY * cosine;
    }
    this.headingStep = simulation.stepCount;
  }

  private initializeHeading(simulation: CrowdSimulation, agent: number): void {
    let x = simulation.state.intentX[agent]!;
    let y = simulation.state.intentY[agent]!;
    let length = Math.hypot(x, y);
    if (length <= 1e-6) {
      x = simulation.state.vx[agent]!;
      y = simulation.state.vy[agent]!;
      length = Math.hypot(x, y);
    }
    if (length <= 1e-6 && simulation.state.active[agent] === 1) {
      simulation.sampleNavigationDirection(
        agent,
        simulation.state.x[agent]!,
        simulation.state.y[agent]!,
        this.sampledHeading,
      );
      x = this.sampledHeading.x;
      y = this.sampledHeading.y;
      length = Math.hypot(x, y);
    }
    this.headingX[agent] = length > 1e-6 ? x / length : 1;
    this.headingY[agent] = length > 1e-6 ? y / length : 0;
  }
}
