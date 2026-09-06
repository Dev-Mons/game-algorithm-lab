import { FRICTION_POINTS, ROLL_POINTS, frictionAtSpeed, rollAtSpeed, type VehicleConfig } from '../physics/config';
import { clamp } from '../physics/math';

type CurveKey = typeof FRICTION_POINTS[number]['key'] | typeof ROLL_POINTS[number]['key'];
interface CurveSpec<K extends CurveKey> {
  label: string; axis: string; unit: string; min: number; max: number; ticks: readonly number[];
  points: readonly { speed: number; key: K; max: number }[];
  sample: (config: VehicleConfig, speed: number) => number;
}
const LEFT = 28, RIGHT = 264, TOP = 26, BOTTOM = 136;
const xAt = (speed: number) => LEFT + speed / 160 * (RIGHT - LEFT);

/** Shared fixed-speed curve editor. Pointer release commits one vehicle reset. */
class SpeedCurveEditor<K extends CurveKey> {
  private svg: SVGSVGElement;
  private line: SVGPolylineElement;
  private handles: SVGCircleElement[];
  private live: SVGCircleElement;
  private guide: SVGLineElement;
  private active: number | null = null;
  private oldValue = 0;
  private yAt(value: number) { return BOTTOM - value / this.spec.max * (BOTTOM - TOP); }
  constructor(host: HTMLElement, private getConfig: () => VehicleConfig, private change: (key: K, value: number, commit: boolean) => void, private spec: CurveSpec<K>) {
    host.innerHTML = `<svg viewBox="0 0 280 166" aria-label="속도별 ${spec.label} 곡선" class="friction-graph">
      <rect x="${LEFT}" y="${TOP}" width="${xAt(20) - LEFT}" height="${BOTTOM - TOP}" fill="#425d5833"/>
      ${spec.ticks.map(v => `<line x1="${LEFT}" x2="${RIGHT}" y1="${this.yAt(v)}" y2="${this.yAt(v)}" stroke="#354650"/><text x="2" y="${this.yAt(v) + 3}">${v}</text>`).join('')}
      ${spec.points.map(p => `<line x1="${xAt(p.speed)}" x2="${xAt(p.speed)}" y1="${TOP}" y2="${BOTTOM}" stroke="#354650"/><text x="${xAt(p.speed)}" y="150" text-anchor="middle">${p.speed}</text>`).join('')}
      <text x="${LEFT + 15}" y="9">${spec.axis}</text><text x="${RIGHT}" y="163" text-anchor="end">속도 km/h →</text>
      <polyline class="friction-path" fill="none" stroke="#efad7e" stroke-width="2.5"/>
      <line class="friction-guide" y1="${TOP}" y2="${BOTTOM}" stroke="#83d9c0" stroke-dasharray="3 3"/>
      <circle class="friction-live" r="3" fill="#83d9c0" pointer-events="none"/>
      ${spec.points.map((p, i) => `<circle class="friction-handle" data-point="${i}" cx="${xAt(p.speed)}" r="6" role="slider" tabindex="0" aria-label="${p.speed} km/h ${spec.label}" aria-valuemin="${spec.min}" aria-valuemax="${p.max}" aria-orientation="vertical"><title>${p.speed} km/h ${spec.label}: 최대 ${p.max}</title></circle>`).join('')}
    </svg>`;
    this.svg = host.querySelector('svg')!; this.line = host.querySelector('.friction-path')!;
    this.handles = [...host.querySelectorAll<SVGCircleElement>('.friction-handle')];
    this.live = host.querySelector('.friction-live')!; this.guide = host.querySelector('.friction-guide')!;
    this.handles.forEach((handle, index) => {
      handle.addEventListener('pointerdown', event => {
        event.preventDefault(); handle.focus(); handle.setPointerCapture(event.pointerId);
        this.active = index; this.oldValue = this.getConfig()[spec.points[index].key];
      });
      handle.addEventListener('pointermove', event => {
        if (this.active !== index) return;
        const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(this.svg.getScreenCTM()!.inverse());
        const knot = spec.points[index];
        this.change(knot.key, clamp(Math.round((BOTTOM - point.y) / (BOTTOM - TOP) * spec.max * 20) / 20, spec.min, knot.max), false);
      });
      handle.addEventListener('pointerup', event => {
        if (this.active !== index) return;
        this.active = null; handle.releasePointerCapture(event.pointerId);
        const key = spec.points[index].key; this.change(key, this.getConfig()[key], true);
      });
      handle.addEventListener('pointercancel', () => {
        if (this.active !== index) return;
        this.active = null; this.change(spec.points[index].key, this.oldValue, false);
      });
      handle.addEventListener('keydown', event => {
        const knot = spec.points[index], current = this.getConfig()[knot.key];
        const delta = ({ ArrowUp: 0.05, ArrowRight: 0.05, ArrowDown: -0.05, ArrowLeft: -0.05 } as Record<string, number>)[event.key];
        if (delta === undefined && !['Home', 'End'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        const value = event.key === 'Home' ? spec.min : event.key === 'End' ? knot.max : Math.round((current + delta) * 100) / 100;
        this.change(knot.key, clamp(value, spec.min, knot.max), true);
      });
    });
    this.update();
  }
  update() {
    const config = this.getConfig();
    this.line.setAttribute('points', this.spec.points.map(p => `${xAt(p.speed)},${this.yAt(config[p.key])}`).join(' '));
    this.handles.forEach((handle, i) => {
      const value = config[this.spec.points[i].key];
      handle.setAttribute('cy', String(this.yAt(value))); handle.setAttribute('aria-valuenow', String(value));
      handle.setAttribute('aria-valuetext', `${value.toFixed(2)} ${this.spec.unit}`.trim());
    });
  }
  updateLive(speedMps: number, applied: VehicleConfig) {
    const x = xAt(clamp(Math.abs(speedMps) * 3.6, 0, 160));
    this.live.setAttribute('cx', String(x)); this.live.setAttribute('cy', String(this.yAt(this.spec.sample(applied, speedMps))));
    this.guide.setAttribute('x1', String(x)); this.guide.setAttribute('x2', String(x));
  }
}

export class FrictionEditor extends SpeedCurveEditor<typeof FRICTION_POINTS[number]['key']> {
  constructor(host: HTMLElement, get: () => VehicleConfig, change: (key: typeof FRICTION_POINTS[number]['key'], value: number, commit: boolean) => void) {
    super(host, get, change, { label: '노면 마찰', axis: '마찰 μ', unit: 'μ', min: 0.1, max: 8, ticks: [0, 2, 4, 6, 8], points: FRICTION_POINTS, sample: frictionAtSpeed });
  }
}
export class RollEditor extends SpeedCurveEditor<typeof ROLL_POINTS[number]['key']> {
  constructor(host: HTMLElement, get: () => VehicleConfig, change: (key: typeof ROLL_POINTS[number]['key'], value: number, commit: boolean) => void) {
    super(host, get, change, { label: '코너링 기울기', axis: '기울임 강도', unit: '', min: 0, max: 1, ticks: [0, 0.25, 0.5, 0.75, 1], points: ROLL_POINTS, sample: rollAtSpeed });
  }
}
