import type { Rect, ScenarioDefinition, SimulationConfig, Vec2 } from '../core/types';
import {
  CUSTOM_MAP_PREFIX, MapHistory, MAX_OBSTACLES, MAX_SPAWNS, mapFromScenario, parseMap,
  saveMap, scenarioFromMap, validateMap, type MapDocument,
} from './map-document';

type Tool = 'select' | 'obstacle' | 'spawn' | 'goal';
type Selection = { kind: 'obstacle' | 'spawn'; index: number } | { kind: 'goal' };
interface Drag { start: Vec2; before: MapDocument; resize: boolean; preview: MapDocument }

export class MapEditor {
  active = false;
  private history!: MapHistory;
  private id = '';
  private selection: Selection | null = null;
  private tool: Tool = 'select';
  private drag: Drag | null = null;
  private readonly canvas = element<HTMLCanvasElement>('editor-canvas');
  private readonly context = this.canvas.getContext('2d')!;

  constructor(callbacks: {
    config: () => SimulationConfig;
    apply: (scenario: ScenarioDefinition, message: string) => void;
    saved: (scenario: ScenarioDefinition) => void;
    close: () => void;
  }) {
    document.querySelectorAll<HTMLButtonElement>('[data-editor-tool]').forEach((button) => {
      button.addEventListener('click', () => {
        this.tool = button.dataset.editorTool as Tool;
        this.refresh();
      });
    });
    this.canvas.addEventListener('pointerdown', (event) => this.pointerDown(event));
    this.canvas.addEventListener('pointermove', (event) => this.pointerMove(event));
    this.canvas.addEventListener('pointerup', () => this.pointerUp());
    this.canvas.addEventListener('pointercancel', () => { this.drag = null; this.refresh(); });
    element('editor-undo').addEventListener('click', () => this.travel(false));
    element('editor-redo').addEventListener('click', () => this.travel(true));
    element('editor-delete').addEventListener('click', () => this.deleteSelection());
    element('editor-cancel').addEventListener('click', () => { this.hide(); callbacks.close(); });
    element('editor-apply').addEventListener('click', () => this.tryAction(() => {
      const message = validateMap(this.history.current, callbacks.config());
      const scenario = scenarioFromMap(parseMap(this.history.current), this.id);
      callbacks.apply(scenario, message);
      this.hide();
      this.status(message);
    }));
    element('editor-save').addEventListener('click', () => this.tryAction(() => {
      const message = validateMap(this.history.current, callbacks.config());
      saveMap(localStorage, { id: this.id, map: this.history.current });
      callbacks.saved(scenarioFromMap(parseMap(this.history.current), this.id));
      this.status(`브라우저에 저장했습니다. ${message}`);
    }));
    element('editor-export').addEventListener('click', () => this.tryAction(() => {
      const map = parseMap(this.history.current);
      const blob = new Blob([JSON.stringify(map, null, 2) + '\n'], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${map.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      this.status('맵 JSON을 내보냈습니다.');
    }));
    element('editor-import').addEventListener('click', () => element<HTMLInputElement>('editor-file').click());
    element<HTMLInputElement>('editor-file').addEventListener('change', async (event) => {
      const input = event.currentTarget as HTMLInputElement;
      const file = input.files?.[0];
      input.value = '';
      if (!file) return;
      if (file.size > 256_000) { this.status('256KB 이하의 맵 JSON을 선택하세요.', true); return; }
      try {
        const map = parseMap(JSON.parse(await file.text()));
        if (!this.active) return;
        this.history.commit(map);
        this.id = this.newId();
        this.selection = null;
        this.refresh();
        this.status('JSON을 불러왔습니다. 적용할 때 통로 연결을 검사합니다.');
      } catch (error) { this.status(errorMessage(error), true); }
    });
    element('editor-blank').addEventListener('click', () => {
      this.history.commit({ version: 1, name: '새 맵', width: 1200, height: 720,
        obstacles: [], spawns: [{ x: 48, y: 120, width: 288, height: 360 }], goal: { x: 1104, y: 360 } });
      this.id = this.newId();
      this.selection = null;
      this.refresh();
    });
    element<HTMLInputElement>('editor-name').addEventListener('change', (event) => {
      const next = structuredClone(this.history.current);
      next.name = (event.currentTarget as HTMLInputElement).value;
      this.history.commit(next);
      this.refresh();
    });
    element<HTMLSelectElement>('editor-objects').addEventListener('change', (event) => {
      const [kind, index] = (event.currentTarget as HTMLSelectElement).value.split(':');
      this.selection = kind === 'goal' ? { kind } : { kind: kind as 'spawn' | 'obstacle', index: Number(index) };
      this.tool = 'select';
      this.refresh();
    });
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      element<HTMLInputElement>(`editor-${key}`).addEventListener('change', (event) => this.tryAction(() => {
        if (!this.selection) return;
        const value = Number((event.currentTarget as HTMLInputElement).value);
        if (!Number.isFinite(value)) throw new Error('유효한 숫자를 입력하세요.');
        const next = structuredClone(this.history.current);
        const shape = this.selectedShape(next)!;
        if (key === 'x' || key === 'y') shape[key] = value;
        else if ('width' in shape) shape[key] = value;
        // Geometric edits may temporarily block routes; basic bounds still apply.
        this.history.commit(parseMap(next));
        this.refresh();
      }));
    }
    element<HTMLInputElement>('editor-snap').addEventListener('change', () => this.draw());
    document.addEventListener('keydown', (event) => {
      if (!this.active || (event.target as HTMLElement).closest('input,select,textarea,button')) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault(); this.travel(event.shiftKey);
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault(); this.deleteSelection();
      } else if (event.key === 'Escape') {
        this.drag = null; this.selection = null; this.refresh();
      } else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) && this.selection) {
        event.preventDefault();
        const delta = event.shiftKey ? 1 : this.snapSize;
        const next = structuredClone(this.history.current);
        const shape = this.selectedShape(next)!;
        const x = event.key === 'ArrowLeft' ? -delta : event.key === 'ArrowRight' ? delta : 0;
        const y = event.key === 'ArrowUp' ? -delta : event.key === 'ArrowDown' ? delta : 0;
        this.moveShape(shape, x, y);
        this.history.commit(next); this.refresh();
      }
    });
  }

  open(scenario: ScenarioDefinition): void {
    this.id = scenario.id.startsWith(CUSTOM_MAP_PREFIX) ? scenario.id : this.newId();
    const map = mapFromScenario(scenario);
    if (!scenario.id.startsWith(CUSTOM_MAP_PREFIX)) map.name += ' 복사본';
    this.history = new MapHistory(map);
    this.selection = null;
    this.tool = 'select';
    this.active = true;
    for (const id of ['editor-toolbar', 'editor-panel', 'editor-canvas']) element(id).hidden = false;
    document.body.classList.add('editing-map');
    this.status('장애물·생성 영역은 드래그, 목적지는 클릭해서 배치하세요.');
    this.refresh();
    this.canvas.focus();
  }

  private hide(): void {
    this.active = false;
    this.drag = null;
    for (const id of ['editor-toolbar', 'editor-panel', 'editor-canvas']) element(id).hidden = true;
    document.body.classList.remove('editing-map');
    element('map-edit').focus();
  }

  private get snapSize(): number { return element<HTMLInputElement>('editor-snap').checked ? 12 : 1; }
  private snap(value: number): number { return Math.round(value / this.snapSize) * this.snapSize; }
  private newId(): string { return CUSTOM_MAP_PREFIX + crypto.randomUUID(); }
  private point(event: PointerEvent): Vec2 {
    const bounds = this.canvas.getBoundingClientRect();
    return { x: clamp((event.clientX - bounds.left) / bounds.width * 1200, 0, 1200),
      y: clamp((event.clientY - bounds.top) / bounds.height * 720, 0, 720) };
  }

  private pointerDown(event: PointerEvent): void {
    if (!this.active || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    this.canvas.focus();
    this.canvas.setPointerCapture(event.pointerId);
    const point = this.point(event);
    if (this.tool === 'goal') {
      const next = structuredClone(this.history.current);
      next.goal = { x: clamp(this.snap(point.x), 12, 1188), y: clamp(this.snap(point.y), 12, 708) };
      this.history.commit(next);
      this.selection = { kind: 'goal' };
      this.refresh();
      return;
    }
    let resize = false;
    if (this.tool === 'select') {
      const shape = this.selectedShape(this.history.current);
      const tolerance = 12 * 1200 / this.canvas.getBoundingClientRect().width;
      resize = !!shape && 'width' in shape && Math.abs(point.x - shape.x - shape.width) < tolerance
        && Math.abs(point.y - shape.y - shape.height) < tolerance;
      if (!resize) this.selection = this.hitTest(point);
      if (!this.selection) { this.refresh(); return; }
    }
    const before = structuredClone(this.history.current);
    this.drag = { start: point, before, preview: structuredClone(before), resize };
    this.refresh();
  }

  private pointerMove(event: PointerEvent): void {
    if (!this.drag) return;
    const { start, before, resize } = this.drag;
    const point = this.point(event);
    const next = structuredClone(before);
    if (this.tool === 'select') {
      const shape = this.selectedShape(next)!;
      if (resize && 'width' in shape) {
        shape.width = clamp(this.snap(point.x - shape.x), 4, 1200 - shape.x);
        shape.height = clamp(this.snap(point.y - shape.y), 4, 720 - shape.y);
      } else this.moveShape(shape, this.snap(point.x - start.x), this.snap(point.y - start.y));
    } else {
      const shapes = this.tool === 'spawn' ? next.spawns : next.obstacles;
      const x1 = this.snap(start.x), y1 = this.snap(start.y);
      const x2 = this.snap(point.x), y2 = this.snap(point.y);
      shapes.push({ x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x1 - x2), height: Math.abs(y1 - y2) });
    }
    this.drag.preview = next;
    this.draw();
  }

  private pointerUp(): void {
    if (!this.drag) return;
    const next = this.drag.preview;
    this.drag = null;
    const drawing = this.tool === 'obstacle' || this.tool === 'spawn';
    if (drawing) {
      const shapes = this.tool === 'spawn' ? next.spawns : next.obstacles;
      const previousCount = this.tool === 'spawn' ? this.history.current.spawns.length : this.history.current.obstacles.length;
      const shape = shapes.at(-1);
      if (shapes.length === previousCount || !shape || shape.width < 4 || shape.height < 4) { this.refresh(); return; }
      const limit = this.tool === 'spawn' ? MAX_SPAWNS : MAX_OBSTACLES;
      if (shapes.length > limit) { this.status(`최대 ${limit}개까지 배치할 수 있습니다.`, true); this.refresh(); return; }
      this.selection = { kind: this.tool as 'obstacle' | 'spawn', index: shapes.length - 1 };
    }
    this.history.commit(next);
    this.refresh();
  }

  private moveShape(shape: Vec2 | Rect, x: number, y: number): void {
    shape.x = clamp(shape.x + x, 0, 1200 - ('width' in shape ? shape.width : 12));
    shape.y = clamp(shape.y + y, 0, 720 - ('height' in shape ? shape.height : 12));
  }
  private hitTest(point: Vec2): Selection | null {
    const map = this.history.current;
    if (Math.hypot(map.goal.x - point.x, map.goal.y - point.y) <= 24) return { kind: 'goal' };
    for (const kind of ['spawn', 'obstacle'] as const) {
      const shapes = kind === 'spawn' ? map.spawns : map.obstacles;
      for (let index = shapes.length - 1; index >= 0; index -= 1) {
        const r = shapes[index]!;
        if (point.x >= r.x && point.x <= r.x + r.width && point.y >= r.y && point.y <= r.y + r.height) return { kind, index };
      }
    }
    return null;
  }
  private selectedShape(map: MapDocument): Rect | Vec2 | null {
    const selection = this.selection;
    if (!selection) return null;
    return selection.kind === 'goal' ? map.goal
      : (selection.kind === 'spawn' ? map.spawns : map.obstacles)[selection.index] ?? null;
  }
  private deleteSelection(): void {
    if (!this.selection || this.selection.kind === 'goal') return;
    if (this.selection.kind === 'spawn' && this.history.current.spawns.length === 1) {
      this.status('생성 영역은 하나 이상 필요합니다.', true); return;
    }
    const next = structuredClone(this.history.current);
    (this.selection.kind === 'spawn' ? next.spawns : next.obstacles).splice(this.selection.index, 1);
    this.history.commit(next);
    this.selection = null;
    this.refresh();
  }
  private travel(redo: boolean): void {
    this.drag = null;
    if (redo) this.history.redo(); else this.history.undo();
    this.selection = null;
    this.refresh();
  }

  private refresh(): void {
    const map = this.history.current;
    element<HTMLInputElement>('editor-name').value = map.name;
    const select = element<HTMLSelectElement>('editor-objects');
    select.replaceChildren();
    map.spawns.forEach((_, index) => select.add(new Option(`생성 영역 ${index + 1}`, `spawn:${index}`)));
    select.add(new Option('공통 목적지', 'goal'));
    map.obstacles.forEach((_, index) => select.add(new Option(`장애물 ${index + 1}`, `obstacle:${index}`)));
    select.value = this.selection ? this.selection.kind === 'goal' ? 'goal' : `${this.selection.kind}:${this.selection.index}` : '';
    const shape = this.selectedShape(map);
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      const input = element<HTMLInputElement>(`editor-${key}`);
      input.disabled = !shape || !(key in shape);
      input.value = shape && key in shape ? String((shape as Rect)[key]) : '';
    }
    element<HTMLButtonElement>('editor-delete').disabled = !this.selection || this.selection.kind === 'goal'
      || (this.selection.kind === 'spawn' && map.spawns.length <= 1);
    element<HTMLButtonElement>('editor-undo').disabled = !this.history.canUndo;
    element<HTMLButtonElement>('editor-redo').disabled = !this.history.canRedo;
    document.querySelectorAll<HTMLButtonElement>('[data-editor-tool]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.editorTool === this.tool));
    });
    this.canvas.style.cursor = this.tool === 'select' ? 'default' : 'crosshair';
    this.draw();
  }

  private draw(): void {
    if (!this.active) return;
    const map = this.drag?.preview ?? this.history.current;
    const c = this.context;
    c.fillStyle = '#0b1424'; c.fillRect(0, 0, 1200, 720);
    c.strokeStyle = '#17283e'; c.lineWidth = 1; c.beginPath();
    for (let x = 0; x <= 1200; x += 24) { c.moveTo(x, 0); c.lineTo(x, 720); }
    for (let y = 0; y <= 720; y += 24) { c.moveTo(0, y); c.lineTo(1200, y); }
    c.stroke();
    for (const kind of ['obstacle', 'spawn'] as const) {
      const shapes = kind === 'spawn' ? map.spawns : map.obstacles;
      shapes.forEach((rect, index) => {
        c.fillStyle = kind === 'spawn' ? '#482135' : '#263447';
        c.strokeStyle = kind === 'spawn' ? '#ef4444' : '#94a3b8'; c.lineWidth = 2;
        c.fillRect(rect.x, rect.y, rect.width, rect.height);
        c.strokeRect(rect.x, rect.y, rect.width, rect.height);
        if (kind === 'spawn') {
          c.fillStyle = '#fecaca'; c.font = '14px system-ui';
          c.fillText(`생성 ${index + 1}`, rect.x + 8, rect.y + 21);
        }
      });
    }
    c.fillStyle = '#0c4a6e'; c.strokeStyle = '#38bdf8'; c.beginPath();
    c.arc(map.goal.x, map.goal.y, 22, 0, Math.PI * 2); c.fill(); c.stroke();
    c.fillStyle = '#bae6fd'; c.font = '14px system-ui'; c.fillText('목적지', map.goal.x - 21, map.goal.y - 32);
    const selected = this.selectedShape(map);
    if (selected) {
      c.strokeStyle = '#fbbf24'; c.lineWidth = 3;
      if ('width' in selected) {
        c.strokeRect(selected.x, selected.y, selected.width, selected.height);
        c.fillStyle = '#fbbf24';
        c.fillRect(selected.x + selected.width - 6, selected.y + selected.height - 6, 12, 12);
      } else { c.beginPath(); c.arc(selected.x, selected.y, 27, 0, Math.PI * 2); c.stroke(); }
    }
  }
  private tryAction(action: () => void): void {
    try { action(); } catch (error) { this.status(errorMessage(error), true); }
  }
  private status(message: string, error = false): void {
    const status = element('editor-status');
    status.textContent = message;
    status.classList.toggle('error', error);
  }
}

function element<T extends HTMLElement>(id: string): T { return document.getElementById(id)! as T; }
function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : '맵을 처리할 수 없습니다.'; }
