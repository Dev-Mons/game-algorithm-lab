import * as THREE from "three";
import { BASES, faceCenter2, faceCorners, cellId, type GenerationResult, type Vec3 } from "./core/generate";
import { surfaceRectangle, type SurfaceSelection } from "./surface-edit";
import type {ObjectInput} from './core/scene-inputs';

interface Context {
  result?: GenerationResult;
  origin: THREE.Vector3;
  surfaces: THREE.Group;
  objects: THREE.Group;
  objectInputs?: ObjectInput[];
}
interface Gesture {
  pointer: number;
  button: number;
  x: number;
  y: number;
  start?: SurfaceSelection;
  preview?: SurfaceSelection;
  dragged: boolean;
  handle?: { axis: THREE.Vector2; pixelsPerCell: number; consumed: number };
}

export class SurfaceInteraction {
  mode: "building" | "object" | "road" | "parking" | "inspect" = "building";
  private selection?: SurfaceSelection;
  private gesture?: Gesture;
  private ray = new THREE.Raycaster();
  private overlay = new THREE.Group();
  private handleAnchor?: THREE.Vector3;
  private handle = new THREE.Mesh(
    // Half-cell square base and height, in world units rather than screen pixels.
    new THREE.ConeGeometry(Math.SQRT1_2 / 2, .5, 4).rotateY(Math.PI / 4).translate(0, .25, 0),
    new THREE.MeshBasicMaterial({ color: "#ffc35b", depthTest: false, depthWrite: false }),
  );
  private handleEdges = new THREE.LineSegments(new THREE.EdgesGeometry(this.handle.geometry), new THREE.LineBasicMaterial({ color: "#704519", depthTest: false }));
  private lineMaterial = new THREE.LineBasicMaterial({ color: "#ffca69", depthTest: false });
  private fillMaterial = new THREE.MeshBasicMaterial({ color: "#ffca69", depthTest: false, depthWrite: false, transparent: true, opacity: .2, side: THREE.DoubleSide });
  private abort = new AbortController();

  constructor(
    private canvas: HTMLCanvasElement,
    private camera: THREE.Camera,
    scene: THREE.Scene,
    private context: () => Context,
    private commit: (selection: SurfaceSelection, mode: "add" | "remove") => SurfaceSelection | undefined,
    private inspect: (event: PointerEvent) => void,
    private notify: (message: string, active: boolean) => void,
  ) {
    scene.add(this.overlay, this.handle);
    this.handle.add(this.handleEdges);
    this.handle.renderOrder = 22;
    this.handleEdges.renderOrder = 23;
    this.handle.visible = false;
    canvas.tabIndex = 0;
    const opts = { signal: this.abort.signal };
    canvas.addEventListener("contextmenu", e => e.preventDefault(), opts);
    canvas.addEventListener("pointerdown", e => {
      if (e.button !== 0 || this.gesture || !e.isPrimary) return;
      e.preventDefault();
      canvas.focus({ preventScroll: true });
      canvas.setPointerCapture(e.pointerId);
      const metrics = this.hitHandle(e) ? this.handleMetrics() : undefined;
      this.gesture = { pointer: e.pointerId, button: e.button, x: e.clientX, y: e.clientY, start: metrics ? this.selection : this.pick(e), dragged: false,
        ...(metrics ? {handle: {axis: new THREE.Vector2(metrics.axisX, metrics.axisY), pixelsPerCell: metrics.pixelsPerCell, consumed: 0}} : {}) };
      if (metrics) canvas.style.cursor = "grabbing";
    }, opts);
    canvas.addEventListener("pointermove", e => {
      const g = this.gesture;
      if (!g) {
        canvas.style.cursor = this.hitHandle(e) ? "grab" : "";
        if (!this.selection && e.buttons === 0 && this.mode !== 'inspect') this.draw(this.pick(e));
        return;
      }
      if (e.pointerId !== g.pointer) return;
      if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > 4) g.dragged = true;
      if (!g.dragged || !g.start) return;
      if (g.handle) this.dragHandle(e, g);
      else this.preview(e, g);
    }, opts);
    canvas.addEventListener("pointerup", e => {
      const g = this.gesture;
      if (!g || e.pointerId !== g.pointer || e.button !== g.button) return;
      const rect = canvas.getBoundingClientRect();
      const inside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
      if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > 4) g.dragged = true;
      if (g.dragged && g.start && inside) {
        if (g.handle) this.dragHandle(e, g);
        else this.preview(e, g);
      }
      this.cancelGesture();
      if (!inside) { this.draw(this.selection); return; }
      if (g.handle) { this.draw(this.selection); this.announce(); return; }
      if(this.mode==='inspect'){if(!g.dragged&&g.button===0)this.inspect(e);return;}
      const chosen = g.dragged ? g.preview : g.start;
      if (chosen) {
        this.selection = chosen;
        const released = this.pointOnSelection(e, chosen);
        const centers = chosen.cells.map(cell => new THREE.Vector3(...faceCenter2(cell, chosen.direction).map(v => v / 2) as Vec3));
        this.handleAnchor = released ? centers.reduce((nearest, center) => center.distanceToSquared(released) < nearest.distanceToSquared(released) ? center : nearest) : centers[0];
        this.draw(this.selection);
        this.announce();
      } else this.draw(this.selection);
      if (!g.dragged) this.inspect(e);
    }, opts);
    canvas.addEventListener("pointercancel", () => this.cancel(), opts);
    canvas.addEventListener("lostpointercapture", () => { if (this.gesture) this.cancel(); }, opts);
    canvas.addEventListener("pointerleave", () => { if (!this.gesture) this.draw(this.selection); }, opts);
    window.addEventListener("blur", () => this.cancel(), opts);
    document.addEventListener("keydown", e => {
      if (e.key === "Escape") { e.preventDefault(); this.clear(); }
      const target = e.target as HTMLElement;
      if (this.mode === 'inspect' || !this.selection || this.gesture || e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.isComposing || target.closest('input,textarea,select') || target.isContentEditable) return;
      if (e.code === 'KeyE' || e.code === 'KeyQ') {
        e.preventDefault();
        this.apply(e.code === 'KeyE' ? 'add' : 'remove');
      }
    }, opts);
  }

  private pointOnSelection(e: PointerEvent, selection: SurfaceSelection) {
    const { origin } = this.context();
    const normal = new THREE.Vector3(...BASES[selection.direction].n);
    const center = new THREE.Vector3(...faceCenter2(selection.cells[0], selection.direction).map(v => v / 2) as Vec3).add(origin);
    this.setRay(e);
    return this.ray.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(normal, center), new THREE.Vector3())?.sub(origin);
  }
  private screenPoint(point: THREE.Vector3) {
    const rect = this.canvas.getBoundingClientRect(), projected = point.clone().project(this.camera);
    return new THREE.Vector2((projected.x + 1) * rect.width / 2, (1 - projected.y) * rect.height / 2);
  }
  private handleMetrics() {
    if (!this.selection || !this.handleAnchor) return;
    const base = this.handleAnchor.clone().add(this.context().origin), normal = new THREE.Vector3(...BASES[this.selection.direction].n);
    const from = this.screenPoint(base), axis = this.screenPoint(base.clone().add(normal)).sub(from);
    const view = this.camera.getWorldDirection(new THREE.Vector3());
    // Looking along the normal has no useful projected axis: screen-up still adds a layer.
    const endOn = Math.abs(view.dot(normal)) > .95 || axis.length() < .001;
    const pixelsPerCell = endOn ? 48 : Math.max(24, Math.min(120, axis.length()));
    if (endOn) axis.set(0, -1); else axis.normalize();
    const center = this.screenPoint(base.clone().addScaledVector(normal, .25));
    return { x: center.x, y: center.y, axisX: axis.x, axisY: axis.y, pixelsPerCell };
  }
  updateHandle() {
    this.handle.visible = !!this.selection && !!this.handleAnchor && this.mode !== 'inspect';
    if (!this.handle.visible) { delete this.canvas.dataset.editHandle; return; }
    this.camera.updateMatrixWorld();
    const base = this.handleAnchor!.clone().add(this.context().origin);
    this.handle.position.copy(base);
    this.handle.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...BASES[this.selection!.direction].n));
    this.handle.updateMatrixWorld(true);
    this.canvas.dataset.editHandle = JSON.stringify(this.handleMetrics());
  }
  private hitHandle(e: PointerEvent) {
    this.updateHandle();
    if (!this.handle.visible) return false;
    this.setRay(e);
    return this.ray.intersectObject(this.handle, false).length > 0;
  }
  private apply(mode: 'add' | 'remove') {
    if (!this.selection) return false;
    const previous = this.selection, next = this.commit(previous, mode);
    if (!next) return false;
    this.selection = next;
    if (this.handleAnchor) this.handleAnchor.add(new THREE.Vector3(...next.cells[0]).sub(new THREE.Vector3(...previous.cells[0])));
    this.draw(next);
    this.announce();
    return true;
  }
  private dragHandle(e: PointerEvent, gesture: Gesture) {
    const drag = gesture.handle!;
    const distance = new THREE.Vector2(e.clientX - gesture.x, e.clientY - gesture.y).dot(drag.axis);
    const steps = Math.trunc((distance - drag.consumed) / drag.pixelsPerCell);
    // Each step uses the same validated edit path as E/Q, including collision and span limits.
    for (let i = 0; i < Math.min(32, Math.abs(steps)); i++) {
      if (!this.apply(steps > 0 ? 'add' : 'remove')) { drag.consumed = distance; break; }
      drag.consumed += Math.sign(steps) * drag.pixelsPerCell;
    }
  }

  private setRay(e: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    this.camera.updateMatrixWorld();
    this.ray.setFromCamera(new THREE.Vector2((e.clientX - rect.left) / rect.width * 2 - 1, 1 - (e.clientY - rect.top) / rect.height * 2), this.camera);
  }
  private pick(e: PointerEvent): SurfaceSelection | undefined {
    const { result, origin, surfaces, objects } = this.context();
    if (!result) return;
    this.setRay(e);
    if(this.mode==='road'||this.mode==='parking'){
      const point=this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,1,0),-origin.y),new THREE.Vector3());
      if(!point||this.ray.ray.direction.y>=0)return;point.sub(origin);
      return {direction:'PY',cells:[[Math.floor(point.x),-1,Math.floor(point.z)]]};
    }
    surfaces.updateMatrixWorld(true);
    objects.updateMatrixWorld(true);
    const hit = this.ray.intersectObjects(surfaces.children, false)[0];
    let objectSelection: SurfaceSelection | undefined;
    let nearest = hit?.distance ?? Infinity;
    // Pick the editable input volume, including empty-looking space between
    // procedural modules, so its face and edit plane agree like building voxels.
    if (this.mode === "object" && objects.visible) {
      const inputs = new Map((this.context().objectInputs??[]).map(input=>[input.id,input]));
      for (const input of inputs.values()) {
        const cells=input.cells as Vec3[];
        const min=[0,1,2].map(a=>Math.min(...cells.map(c=>c[a]))) as Vec3;
        const max=[0,1,2].map(a=>Math.max(...cells.map(c=>c[a]))+1) as Vec3;
        const box=new THREE.Box3(new THREE.Vector3(...min).add(origin),new THREE.Vector3(...max).add(origin));
        const point=this.ray.ray.intersectBox(box,new THREE.Vector3());
        if(!point) continue;
        const distance=point.distanceTo(this.ray.ray.origin);
        if(distance>=nearest) continue;
        const local=point.sub(origin).toArray();
        const boundaries=Object.entries(BASES).map(([direction,basis])=>{
          const axis=basis.n.findIndex(n=>n!==0);
          return {direction:direction as SurfaceSelection["direction"],distance:Math.abs(local[axis]-(basis.n[axis]>0?max[axis]:min[axis]))};
        }).sort((a,b)=>a.distance-b.distance);
        const cell=local.map((v,a)=>Math.max(min[a],Math.min(max[a]-1,Math.floor(v)))) as Vec3;
        objectSelection={direction:boundaries[0].direction,cells:[cell]};nearest=distance;
      }
    }
    if (objectSelection) return objectSelection;
    if (hit?.instanceId !== undefined) {
      const face = result.surfaces[hit.instanceId];
      return { direction: face.direction, cells: [face.cell] };
    }
    // The construction plane stays at document Y=0; the display ground is cosmetic.
    const point = this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -origin.y), new THREE.Vector3());
    if (!point || this.ray.ray.direction.y >= 0) return;
    point.sub(origin);
    const cell: Vec3 = [Math.floor(point.x), -1, Math.floor(point.z)];
    if (result.cells.some(c => c[0] === cell[0] && c[2] === cell[2] && c[1] >= 0)) return;
    return { direction: "PY", cells: [cell] };
  }
  private preview(e: PointerEvent, g: Gesture) {
    if(this.mode==='inspect')return;
    const start = g.start!;
    const { origin, result } = this.context();
    const n = new THREE.Vector3(...BASES[start.direction].n);
    const center = new THREE.Vector3(...faceCenter2(start.cells[0], start.direction).map(v => v / 2) as Vec3).add(origin);
    this.setRay(e);
    const point = this.ray.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(n, center), new THREE.Vector3());
    g.preview = undefined;
    if (!point) { this.draw(this.selection); return; }
    point.sub(origin);
    const axis = BASES[start.direction].n.findIndex(v => v !== 0);
    const end = point.toArray().map((v, a) => a === axis ? start.cells[0][a] : Math.floor(v)) as Vec3;
    try {
      const selection = surfaceRectangle(start.cells[0], end, start.direction);
      const faces = new Set(result?.surfaces.filter(f => f.direction === start.direction).map(f => cellId(f.cell)));
      if (this.mode === "object") {
        const occupied = new Map<string,Vec3>();
        for (const input of this.context().objectInputs??[]) for (const cell of input.cells) occupied.set(cellId(cell),cell);
        const normal = BASES[start.direction].n;
        for (const cell of occupied.values()) {
          const next=cell.map((v,a)=>v+normal[a]) as Vec3;
          if(!occupied.has(cellId(next))) faces.add(cellId(cell));
        }
      }
      const ground = start.direction === "PY" && start.cells[0][1] === -1 && !faces.has(cellId(start.cells[0]));
      // Dragging on a facade/roof selects only its exposed, coplanar cells.
      if (!ground&&this.mode!=='road'&&this.mode!=='parking') selection.cells = selection.cells.filter(c => faces.has(cellId(c)));
      if (!selection.cells.length) return;
      g.preview = selection;
      this.draw(selection);
      this.notify(`${selection.cells.length}칸 선택 · 버튼을 놓아 영역 확정`, !!this.selection);
    } catch {
      this.draw(this.selection);
      this.notify("선택 범위는 각 축 32칸 이내입니다.", !!this.selection);
    }
  }
  private draw(selection?: SurfaceSelection) {
    for (const child of [...this.overlay.children]) {
      (child as THREE.Mesh).geometry.dispose();
      this.overlay.remove(child);
    }
    this.canvas.dataset.selectionCells = String(this.selection?.cells.length ?? 0);
    this.canvas.dataset.selectionDirection = this.selection?.direction ?? "";
    this.updateHandle();
    if (!selection) return;
    const { origin } = this.context();
    const n = new THREE.Vector3(...BASES[selection.direction].n).multiplyScalar(.015);
    const boundary = new Map<string, Vec3[]>();
    const fill: number[] = [];
    for (const cell of selection.cells) {
      const corners = faceCorners(cell, selection.direction);
      const points = corners.map(c => new THREE.Vector3(...c).add(origin).add(n).toArray());
      for (const i of [0, 1, 2, 0, 2, 3]) fill.push(...points[i]);
      for (let i = 0; i < 4; i++) {
        const edge = [corners[i], corners[(i + 1) % 4]];
        const key = edge.map(cellId).sort().join("|");
        if (boundary.has(key)) boundary.delete(key); else boundary.set(key, edge);
      }
    }
    const points = [...boundary.values()].flat().flatMap(c => new THREE.Vector3(...c).add(origin).add(n).toArray());
    const lines = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(points, 3)), this.lineMaterial);
    const mesh = new THREE.Mesh(new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(fill, 3)), this.fillMaterial);
    mesh.renderOrder = 20;
    lines.renderOrder = 21;
    this.overlay.add(mesh, lines);
  }
  private announce() {
    this.notify(this.selection ? `${this.selection.cells.length}칸 선택 중 · 정사각뿔 드래그 또는 E 추가 / Q 제거 · Esc 해제` : "왼쪽 드래그로 영역을 선택하세요. E 추가 · Q 제거", !!this.selection);
  }
  private cancelGesture() {
    const g = this.gesture;
    this.gesture = undefined;
    this.canvas.style.cursor = "";
    if (g && this.canvas.hasPointerCapture(g.pointer)) this.canvas.releasePointerCapture(g.pointer);
  }
  private cancel() { this.cancelGesture(); this.draw(this.selection); this.announce(); }
  clear() { this.selection = undefined; this.handleAnchor = undefined; this.cancel(); }
  refresh() { this.draw(this.selection); }
  dispose() {
    this.abort.abort();
    this.cancelGesture();
    this.selection = undefined;
    this.draw();
    this.overlay.removeFromParent();
    this.lineMaterial.dispose();
    this.fillMaterial.dispose();
    this.handle.removeFromParent();
    this.handle.geometry.dispose();
    this.handle.material.dispose();
    this.handleEdges.geometry.dispose();
    this.handleEdges.material.dispose();
  }
}
