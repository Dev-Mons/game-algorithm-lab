import * as THREE from "three";
import { BASES, faceCenter2, faceCorners, cellId, type GenerationResult, type Vec3 } from "./core/generate";
import { surfaceRectangle, type SurfaceSelection } from "./surface-edit";

interface Context {
  result?: GenerationResult;
  origin: THREE.Vector3;
  surfaces: THREE.Group;
  objects: THREE.Group;
}
interface Gesture {
  pointer: number;
  button: number;
  x: number;
  y: number;
  start?: SurfaceSelection;
  preview?: SurfaceSelection;
  dragged: boolean;
}

export class SurfaceInteraction {
  mode: "building" | "object" | "road" = "building";
  private selection?: SurfaceSelection;
  private gesture?: Gesture;
  private ray = new THREE.Raycaster();
  private overlay = new THREE.Group();
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
    scene.add(this.overlay);
    canvas.tabIndex = 0;
    const opts = { signal: this.abort.signal };
    canvas.addEventListener("contextmenu", e => e.preventDefault(), opts);
    canvas.addEventListener("pointerdown", e => {
      if ((e.button !== 0 && e.button !== 2) || this.gesture || !e.isPrimary) return;
      e.preventDefault();
      canvas.focus({ preventScroll: true });
      canvas.setPointerCapture(e.pointerId);
      this.gesture = { pointer: e.pointerId, button: e.button, x: e.clientX, y: e.clientY, start: this.pick(e), dragged: false };
    }, opts);
    canvas.addEventListener("pointermove", e => {
      const g = this.gesture;
      if (!g) {
        if (!this.selection && e.buttons === 0) this.draw(this.pick(e));
        return;
      }
      if (e.pointerId !== g.pointer) return;
      if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > 4) g.dragged = true;
      if (!g.dragged || !g.start) return;
      this.preview(e, g);
    }, opts);
    canvas.addEventListener("pointerup", e => {
      const g = this.gesture;
      if (!g || e.pointerId !== g.pointer || e.button !== g.button) return;
      const rect = canvas.getBoundingClientRect();
      const inside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
      if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > 4) g.dragged = true;
      if (g.dragged && g.start && inside) this.preview(e, g);
      this.cancelGesture();
      if (!inside) { this.draw(this.selection); return; }
      const chosen = g.dragged ? g.preview : this.mode !== "building" ? g.start : this.selection;
      if (chosen) {
        this.selection = this.commit(chosen, g.button === 2 ? "remove" : "add") ?? this.selection;
        this.draw(this.selection);
        this.announce();
      } else if (!g.dragged && g.button === 0) this.inspect(e);
    }, opts);
    canvas.addEventListener("pointercancel", () => this.cancel(), opts);
    canvas.addEventListener("lostpointercapture", () => { if (this.gesture) this.cancel(); }, opts);
    canvas.addEventListener("pointerleave", () => { if (!this.gesture) this.draw(this.selection); }, opts);
    window.addEventListener("blur", () => this.cancel(), opts);
    document.addEventListener("keydown", e => {
      if (e.key === "Escape") { e.preventDefault(); this.clear(); }
    }, opts);
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
    surfaces.updateMatrixWorld(true);
    objects.updateMatrixWorld(true);
    const hit = this.ray.intersectObjects([...surfaces.children, ...(this.mode === "object" ? objects.children.filter(o => o.userData.scenePlacement?.kind === "object") : [])], false)[0];
    const input = hit?.object.userData.scenePlacement?.input;
    if (input) {
      const normal = BASES[input.direction as keyof typeof BASES].n;
      const own = new Set(input.cells.map(cellId));
      const cells = (input.cells as Vec3[]).map(c => c.map((v,a) => v-normal[a]) as Vec3).filter(c => !own.has(cellId(c)));
      return { direction: input.direction, cells };
    }
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
      const ground = start.direction === "PY" && start.cells[0][1] === -1 && !faces.has(cellId(start.cells[0]));
      // Dragging on a facade/roof selects only its exposed, coplanar cells.
      if (!ground) selection.cells = selection.cells.filter(c => faces.has(cellId(c)));
      if (!selection.cells.length) return;
      g.preview = selection;
      this.draw(selection);
      this.notify(`${selection.cells.length}칸 선택 · 버튼을 놓으면 ${g.button === 2 ? "제거" : "추가"}`, !!this.selection);
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
    this.notify(this.selection ? `${this.selection.cells.length}칸 선택 중 · 좌클릭 추가 · 우클릭 제거 · Esc 해제` : "좌·우 드래그로 영역을 선택하세요.", !!this.selection);
  }
  private cancelGesture() {
    const g = this.gesture;
    this.gesture = undefined;
    if (g && this.canvas.hasPointerCapture(g.pointer)) this.canvas.releasePointerCapture(g.pointer);
  }
  private cancel() { this.cancelGesture(); this.draw(this.selection); this.announce(); }
  clear() { this.selection = undefined; this.cancel(); }
  refresh() { this.draw(this.selection); }
  dispose() {
    this.abort.abort();
    this.cancelGesture();
    this.selection = undefined;
    this.draw();
    this.overlay.removeFromParent();
    this.lineMaterial.dispose();
    this.fillMaterial.dispose();
  }
}
