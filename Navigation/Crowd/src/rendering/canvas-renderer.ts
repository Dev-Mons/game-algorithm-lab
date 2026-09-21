import type { CrowdSimulation } from '../core/simulation';
import { angleDelta } from '../core/math';
import type { Renderer } from '../core/types';
import { drawDebug, type DebugOptions } from './debug-drawing';

const CIRCLE_SPRITE_THRESHOLD = 2_000;
const PIXEL_LAYER_THRESHOLD = 5_000;
const MAX_HEADING_MARKERS = 1_000;
const AGENT_RED = 0x60;
const AGENT_GREEN = 0xa5;
const AGENT_BLUE = 0xfa;
const LARGE_AGENT_COLOR = '#fbbf24';

interface AgentStamp {
  x: Int16Array;
  y: Int16Array;
  alpha: Uint8ClampedArray;
}

export class CanvasRenderer implements Renderer {
  private readonly context: CanvasRenderingContext2D;
  private backgroundGradient: CanvasGradient | null = null;
  private backgroundWidth = -1;
  private backgroundHeight = -1;
  private readonly agentSprites = new Map<number, HTMLCanvasElement>();
  private readonly agentStamps = new Map<number, AgentStamp>();
  private sizeKey = '';
  private agentPixelCanvas: HTMLCanvasElement | null = null;
  private agentPixelContext: CanvasRenderingContext2D | null = null;
  private agentPixelImage: ImageData | null = null;

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
    const scaled = simulation.config.width !== this.canvas.width || simulation.config.height !== this.canvas.height;
    if (scaled) {
      context.save();
      context.scale(this.canvas.width / simulation.config.width, this.canvas.height / simulation.config.height);
    }

    context.fillStyle = this.getBackgroundGradient(simulation.config.width, simulation.config.height);
    context.fillRect(0, 0, simulation.config.width, simulation.config.height);

    context.fillStyle = 'rgba(15, 23, 42, 0.9)';
    context.strokeStyle = 'rgba(148, 163, 184, 0.45)';
    context.lineWidth = 2;
    for (const obstacle of simulation.scenario.obstacles) {
      context.fillRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height);
      context.strokeRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height);
    }

    context.fillStyle = 'rgba(239, 68, 68, 0.10)';
    context.strokeStyle = '#ef4444';
    context.lineWidth = 2;
    const spawns = simulation.scenario.flows?.map((flow) => flow.spawn)
      ?? [simulation.scenario.spawn];
    for (const spawn of spawns) {
      context.fillRect(spawn.x, spawn.y, spawn.width, spawn.height);
      context.strokeRect(spawn.x, spawn.y, spawn.width, spawn.height);
    }

    const pulse = 3 + Math.sin(simulation.stepCount * 0.05) * 2;
    for (const goal of simulation.goals) {
      context.fillStyle = 'rgba(14, 165, 233, 0.12)';
      context.strokeStyle = '#0ea5e9';
      context.lineWidth = 2;
      context.beginPath();
      context.arc(goal.x, goal.y, simulation.config.goalRadius + pulse, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      context.fillStyle = '#38bdf8';
      context.beginPath();
      context.arc(goal.x, goal.y, 4, 0, Math.PI * 2);
      context.fill();
    }

    const radius = simulation.config.agentRadius;
    if (simulation.resolvedExperiment.options.destination === 'slots') {
      context.strokeStyle = 'rgba(110, 231, 183, 0.5)';
      context.lineWidth = 0.8;
      context.beginPath();
      const stride = Math.max(1, Math.ceil(simulation.state.count / 2000));
      for (let agent = 0; agent < simulation.state.count; agent += stride) {
        const slot = simulation.arrivalSlotForAgent(agent);
        if (!slot) continue;
        const r = simulation.agentRadii[agent]!;
        context.moveTo(slot.x + r, slot.y);
        context.arc(slot.x, slot.y, r, 0, Math.PI * 2);
      }
      context.stroke();
    }
    const previous = simulation.previousState;
    const sizeKey = `${radius}/${simulation.maxAgentRadius}`;
    if (this.sizeKey !== sizeKey) {
      this.agentSprites.clear();
      this.agentStamps.clear();
      this.sizeKey = sizeKey;
    }
    const wantsPixelLayer = simulation.state.count >= PIXEL_LAYER_THRESHOLD && !scaled;
    const usePixelLayer = wantsPixelLayer
      && this.drawAgentPixelLayer(simulation, interpolation, radius);
    if (!usePixelLayer) {
      this.drawAgentGroup(simulation, interpolation, radius, '#60a5fa', false);
      if (simulation.largeAgentCount > 0) {
        this.drawAgentGroup(simulation, interpolation, simulation.maxAgentRadius, LARGE_AGENT_COLOR, true);
      }
    }
    if (simulation.resolvedExperiment.options.destination === 'slots') {
      context.fillStyle = '#6ee7b7';
      context.beginPath();
      for (let agent = 0; agent < simulation.state.count; agent++) {
        if (simulation.state.active[agent] === 1) continue;
        const x = simulation.state.x[agent]!, y = simulation.state.y[agent]!, r = simulation.agentRadii[agent]!;
        context.moveTo(x + r, y); context.arc(x, y, r, 0, Math.PI * 2);
      }
      context.fill();
    }

    // Interpolate the fixed-step, rate-limited body heading along the short arc.
    context.strokeStyle = 'rgba(219, 234, 254, 0.72)';
    context.lineWidth = Math.max(1, radius * 0.32);
    context.beginPath();
    const headingStride = Math.max(
      1,
      Math.ceil(simulation.state.count / MAX_HEADING_MARKERS),
    );
    for (let agent = 0; agent < simulation.state.count; agent += headingStride) {
      if (simulation.state.active[agent] !== 1) continue;
      const x = previous.x[agent]!
        + (simulation.state.x[agent]! - previous.x[agent]!) * interpolation;
      const y = previous.y[agent]!
        + (simulation.state.y[agent]! - previous.y[agent]!) * interpolation;
      const heading = previous.heading[agent]!
        + angleDelta(previous.heading[agent]!, simulation.state.heading[agent]!) * interpolation;
      const agentRadius = simulation.agentRadii[agent]!;
      context.moveTo(x, y);
      context.lineTo(
        x + Math.cos(heading) * agentRadius * 1.45,
        y + Math.sin(heading) * agentRadius * 1.45,
      );
    }
    context.stroke();

    drawDebug(context, simulation, this.debug, interpolation);
    if (scaled) context.restore();
  }

  private drawAgentGroup(
    simulation: CrowdSimulation, interpolation: number, radius: number, color: string, large: boolean,
  ): void {
    const context = this.context;
    const previous = simulation.previousState;
    context.fillStyle = color;
    const wantsPixelLayer = simulation.state.count >= PIXEL_LAYER_THRESHOLD;
    const sprite = !wantsPixelLayer && simulation.state.count > CIRCLE_SPRITE_THRESHOLD
      ? this.getAgentSprite(radius, color) : null;
    if (wantsPixelLayer) {
      // Non-DOM test surfaces may not provide an offscreen canvas.
      const diameter = radius * 2;
      for (let agent = 0; agent < simulation.state.count; agent += 1) {
        if (simulation.state.active[agent] !== 1) continue;
        if ((simulation.agentRadii[agent]! > simulation.config.agentRadius) !== large) continue;
        const x = previous.x[agent]!
          + (simulation.state.x[agent]! - previous.x[agent]!) * interpolation;
        const y = previous.y[agent]!
          + (simulation.state.y[agent]! - previous.y[agent]!) * interpolation;
        context.fillRect(x - radius, y - radius, diameter, diameter);
      }
    } else if (sprite) {
      const offset = sprite.width * 0.5;
      for (let agent = 0; agent < simulation.state.count; agent += 1) {
        if (simulation.state.active[agent] !== 1) continue;
        if ((simulation.agentRadii[agent]! > simulation.config.agentRadius) !== large) continue;
        const x = previous.x[agent]!
          + (simulation.state.x[agent]! - previous.x[agent]!) * interpolation;
        const y = previous.y[agent]!
          + (simulation.state.y[agent]! - previous.y[agent]!) * interpolation;
        context.drawImage(sprite, x - offset, y - offset);
      }
    } else {
      context.beginPath();
      for (let agent = 0; agent < simulation.state.count; agent += 1) {
        if (simulation.state.active[agent] !== 1) continue;
        if ((simulation.agentRadii[agent]! > simulation.config.agentRadius) !== large) continue;
        const x = previous.x[agent]!
          + (simulation.state.x[agent]! - previous.x[agent]!) * interpolation;
        const y = previous.y[agent]!
          + (simulation.state.y[agent]! - previous.y[agent]!) * interpolation;
        // arc() otherwise connects the previous circle's current point to the
        // next one. Filling that shared path produces the long blue triangles
        // seen when agents are far apart.
        context.moveTo(x + radius, y);
        context.arc(x, y, radius, 0, Math.PI * 2);
      }
      context.fill();
    }

  }

  private getBackgroundGradient(width: number, height: number): CanvasGradient {
    if (
      this.backgroundGradient
      && this.backgroundWidth === width
      && this.backgroundHeight === height
    ) return this.backgroundGradient;
    const gradient = this.context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#0b1424');
    gradient.addColorStop(1, '#101d31');
    this.backgroundGradient = gradient;
    this.backgroundWidth = width;
    this.backgroundHeight = height;
    return gradient;
  }

  private getAgentSprite(radius: number, color: string): HTMLCanvasElement | null {
    const cached = this.agentSprites.get(radius);
    if (cached) return cached;
    const document = this.canvas.ownerDocument;
    if (!document) return null;
    const size = Math.max(3, Math.ceil(radius * 2 + 2));
    const sprite = document.createElement('canvas');
    sprite.width = size;
    sprite.height = size;
    const context = sprite.getContext('2d');
    if (!context) return null;
    const center = size * 0.5;
    context.fillStyle = color;
    context.beginPath();
    context.arc(center, center, radius, 0, Math.PI * 2);
    context.fill();
    this.agentSprites.set(radius, sprite);
    return sprite;
  }

  /**
   * Renders RTS-scale crowds into one transparent, pixel-aligned layer.
   * A tiny antialiased circle stamp avoids sub-pixel fillRect tearing while a
   * single final composite avoids thousands of drawImage calls.
   */
  private drawAgentPixelLayer(
    simulation: CrowdSimulation,
    interpolation: number,
    radius: number,
  ): boolean {
    const document = this.canvas.ownerDocument;
    if (!document) return false;
    const width = this.canvas.width;
    const height = this.canvas.height;
    if (
      !this.agentPixelCanvas
      || !this.agentPixelContext
      || !this.agentPixelImage
      || this.agentPixelCanvas.width !== width
      || this.agentPixelCanvas.height !== height
    ) {
      const layer = document.createElement('canvas');
      layer.width = width;
      layer.height = height;
      const layerContext = layer.getContext('2d');
      if (!layerContext) return false;
      this.agentPixelCanvas = layer;
      this.agentPixelContext = layerContext;
      this.agentPixelImage = layerContext.createImageData(width, height);
    }
    const normalStamp = this.getAgentStamp(radius);
    const largeStamp = this.getAgentStamp(simulation.maxAgentRadius);

    const image = this.agentPixelImage;
    const pixels = image.data;
    pixels.fill(0);
    const previous = simulation.previousState;
    for (let agent = 0; agent < simulation.state.count; agent += 1) {
      if (simulation.state.active[agent] !== 1) continue;
      const large = simulation.agentRadii[agent]! > radius;
      const stampData = large ? largeStamp : normalStamp;
      const centerX = Math.round(
        previous.x[agent]!
          + (simulation.state.x[agent]! - previous.x[agent]!) * interpolation,
      );
      const centerY = Math.round(
        previous.y[agent]!
          + (simulation.state.y[agent]! - previous.y[agent]!) * interpolation,
      );
      for (let stamp = 0; stamp < stampData.x.length; stamp += 1) {
        const x = centerX + stampData.x[stamp]!;
        const y = centerY + stampData.y[stamp]!;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const pixel = (y * width + x) * 4;
        const alpha = stampData.alpha[stamp]!;
        const existingAlpha = pixels[pixel + 3]!;
        if (existingAlpha === 255) continue;
        pixels[pixel] = large ? 0xfb : AGENT_RED;
        pixels[pixel + 1] = large ? 0xbf : AGENT_GREEN;
        pixels[pixel + 2] = large ? 0x24 : AGENT_BLUE;
        pixels[pixel + 3] = existingAlpha
          + Math.round((255 - existingAlpha) * alpha / 255);
      }
    }
    this.agentPixelContext.putImageData(image, 0, 0);
    this.context.drawImage(this.agentPixelCanvas, 0, 0);
    return true;
  }

  private getAgentStamp(radius: number): AgentStamp {
    const cached = this.agentStamps.get(radius);
    if (cached) return cached;
    // A 1.5px physical circle is downscaled below two screen pixels in the
    // responsive layout and aliases into apparent holes. Keep physics exact,
    // but give large-crowd presentation a stable minimum footprint.
    const stampRadius = Math.max(2, radius);
    const extent = Math.ceil(stampRadius + 0.5);
    const x: number[] = [];
    const y: number[] = [];
    const alpha: number[] = [];
    for (let offsetY = -extent; offsetY <= extent; offsetY += 1) {
      for (let offsetX = -extent; offsetX <= extent; offsetX += 1) {
        const coverage = Math.min(
          1,
          Math.max(0, stampRadius + 0.5 - Math.hypot(offsetX, offsetY)),
        );
        if (coverage <= 0) continue;
        x.push(offsetX);
        y.push(offsetY);
        alpha.push(Math.round(coverage * 255));
      }
    }
    const stamp = { x: Int16Array.from(x), y: Int16Array.from(y), alpha: Uint8ClampedArray.from(alpha) };
    this.agentStamps.set(radius, stamp);
    return stamp;
  }
}
