import type { CrowdSimulation } from '../core/simulation';
import type { Renderer } from '../core/types';
import { drawDebug, type DebugOptions } from './debug-drawing';

const CIRCLE_SPRITE_THRESHOLD = 2_000;
const PIXEL_LAYER_THRESHOLD = 5_000;
const MAX_HEADING_MARKERS = 1_000;
const AGENT_RED = 0x60;
const AGENT_GREEN = 0xa5;
const AGENT_BLUE = 0xfa;

export class CanvasRenderer implements Renderer {
  private readonly context: CanvasRenderingContext2D;
  private backgroundGradient: CanvasGradient | null = null;
  private backgroundWidth = -1;
  private backgroundHeight = -1;
  private agentSprite: HTMLCanvasElement | null = null;
  private agentSpriteRadius = -1;
  private agentPixelCanvas: HTMLCanvasElement | null = null;
  private agentPixelContext: CanvasRenderingContext2D | null = null;
  private agentPixelImage: ImageData | null = null;
  private agentPixelRadius = -1;
  private agentStampX = new Int16Array(0);
  private agentStampY = new Int16Array(0);
  private agentStampAlpha = new Uint8ClampedArray(0);

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

    context.fillStyle = this.getBackgroundGradient(simulation.config.width, simulation.config.height);
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
    const wantsPixelLayer = simulation.state.count >= PIXEL_LAYER_THRESHOLD;
    const usePixelLayer = wantsPixelLayer
      && this.drawAgentPixelLayer(simulation, interpolation, radius);
    const sprite = !wantsPixelLayer && simulation.state.count > CIRCLE_SPRITE_THRESHOLD
      ? this.getAgentSprite(radius)
      : null;
    if (usePixelLayer) {
      // The whole crowd has already been composited in one draw call.
    } else if (wantsPixelLayer) {
      // Non-DOM test surfaces may not provide an offscreen canvas.
      const diameter = radius * 2;
      for (let agent = 0; agent < simulation.state.count; agent += 1) {
        if (simulation.state.active[agent] !== 1) continue;
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

    // Heading is presentation-only and follows the latest command intent
    // immediately. Physical velocity remains acceleration-limited by the solver.
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

  private getAgentSprite(radius: number): HTMLCanvasElement | null {
    if (this.agentSprite && this.agentSpriteRadius === radius) return this.agentSprite;
    const document = this.canvas.ownerDocument;
    if (!document) return null;
    const size = Math.max(3, Math.ceil(radius * 2 + 2));
    const sprite = document.createElement('canvas');
    sprite.width = size;
    sprite.height = size;
    const context = sprite.getContext('2d');
    if (!context) return null;
    const center = size * 0.5;
    context.fillStyle = '#60a5fa';
    context.beginPath();
    context.arc(center, center, radius, 0, Math.PI * 2);
    context.fill();
    this.agentSprite = sprite;
    this.agentSpriteRadius = radius;
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
    if (this.agentPixelRadius !== radius) this.rebuildAgentStamp(radius);

    const image = this.agentPixelImage;
    const pixels = image.data;
    pixels.fill(0);
    const previous = simulation.previousState;
    for (let agent = 0; agent < simulation.state.count; agent += 1) {
      if (simulation.state.active[agent] !== 1) continue;
      const centerX = Math.round(
        previous.x[agent]!
          + (simulation.state.x[agent]! - previous.x[agent]!) * interpolation,
      );
      const centerY = Math.round(
        previous.y[agent]!
          + (simulation.state.y[agent]! - previous.y[agent]!) * interpolation,
      );
      for (let stamp = 0; stamp < this.agentStampX.length; stamp += 1) {
        const x = centerX + this.agentStampX[stamp]!;
        const y = centerY + this.agentStampY[stamp]!;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const pixel = (y * width + x) * 4;
        const alpha = this.agentStampAlpha[stamp]!;
        const existingAlpha = pixels[pixel + 3]!;
        if (existingAlpha === 255) continue;
        pixels[pixel] = AGENT_RED;
        pixels[pixel + 1] = AGENT_GREEN;
        pixels[pixel + 2] = AGENT_BLUE;
        pixels[pixel + 3] = existingAlpha
          + Math.round((255 - existingAlpha) * alpha / 255);
      }
    }
    this.agentPixelContext.putImageData(image, 0, 0);
    this.context.drawImage(this.agentPixelCanvas, 0, 0);
    return true;
  }

  private rebuildAgentStamp(radius: number): void {
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
    this.agentStampX = Int16Array.from(x);
    this.agentStampY = Int16Array.from(y);
    this.agentStampAlpha = Uint8ClampedArray.from(alpha);
    this.agentPixelRadius = radius;
  }
}
