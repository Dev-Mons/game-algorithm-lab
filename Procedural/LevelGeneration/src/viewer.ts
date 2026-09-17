import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  BASES,
  faceCenter2,
  faceCorners,
  type GenerationResult,
  type Vec3,
  type Tile,
} from "./core/generate";
import { PanelAssets, LEGACY_COLORS } from "./panel-assets";
import { CraftedGeometryLibrary } from "./crafted-geometry";
import { setPlacementMatrix } from "./display-transform";
import { SurfaceInteraction } from "./surface-interaction";
import type { SurfaceSelection } from "./surface-edit";

export const ROLE_COLORS = {
  wall: "#ded3ba",
  roof: "#cb795f",
  terrace: "#80bbb0",
  underside: "#a79ac6",
};
export type Layer =
  | "voxels"
  | "surfaces"
  | "placements"
  | "edges"
  | "normals"
  | "regions";
export class Viewer {
  private renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(38, 1, 0.05, 4000);
  private controls: OrbitControls;
  private model = new THREE.Group();
  private groups: Record<Layer, THREE.Group> = {
    voxels: new THREE.Group(),
    surfaces: new THREE.Group(),
    placements: new THREE.Group(),
    edges: new THREE.Group(),
    normals: new THREE.Group(),
    regions: new THREE.Group(),
  };
  private plane = new THREE.PlaneGeometry(1, 1);
  private cube = new THREE.BoxGeometry(1, 1, 1);
  private assets = new PanelAssets();
  private crafted = new CraftedGeometryLibrary();
  private groundPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(48, 48),
    new THREE.MeshStandardMaterial({ color: "#354d47", roughness: 1 }),
  );
  private regionMaterial = new THREE.LineBasicMaterial({
    color: "#71f0cf",
    depthTest: false,
    transparent: true,
    opacity: 0.95,
  });
  private surfaceMaterial = new THREE.MeshBasicMaterial({
    wireframe: true,
    depthTest: false,
    transparent: true,
    opacity: 0.6,
  });
  private voxelMaterial = new THREE.MeshBasicMaterial({
    color: "#95afc4",
    wireframe: true,
    transparent: true,
    opacity: 0.32,
  });
  private lineMaterials = {
    convex: new THREE.LineBasicMaterial({
      color: "#303e47",
      transparent: true,
      opacity: 0.7,
    }),
    concave: new THREE.LineBasicMaterial({ color: "#f0b85e" }),
    flat: new THREE.LineBasicMaterial({
      color: "#506068",
      transparent: true,
      opacity: 0.3,
    }),
    unsupported: new THREE.LineBasicMaterial({ color: "#ff36b6" }),
    normal: new THREE.LineBasicMaterial({ color: "#97cbfc" }),
  };
  private selectedMaterial = new THREE.LineBasicMaterial({
    color: "#f7dd83",
    depthTest: false,
  });
  private scenePlacements = new THREE.Group();
  private sceneMaterials = new Map<string, THREE.MeshStandardMaterial>();
  private buildingSelection = new THREE.Group();
  private selection = new THREE.LineLoop(
    new THREE.BufferGeometry(),
    this.selectedMaterial,
  );
  private grid = new THREE.GridHelper(48, 48, "#354750", "#26363e");
  private result?: GenerationResult;
  private displayOrigin = new THREE.Vector3();
  private radius = 5;
  private ground = 0;
  private raycaster = new THREE.Raycaster();
  private observer: ResizeObserver;
  private interaction: SurfaceInteraction;
  constructor(
    private host: HTMLElement,
    private onSelect: (faceId: string, attachmentId?: string) => void,
    onEdit: (
      selection: SurfaceSelection,
      mode: "add" | "remove",
    ) => SurfaceSelection | undefined,
    onSelection: (message: string, active: boolean) => void,
  ) {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor("#1e2b32");
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.setAttribute("aria-label", "도시 부피 3D 뷰어");
    this.host.append(this.renderer.domElement);
    this.scene.add(new THREE.HemisphereLight("#ecf4ff", "#53576b", 2.5));
    const light = new THREE.DirectionalLight("#fff0d4", 3.1);
    light.position.set(7, 13, 9);
    light.castShadow = true;
    light.shadow.mapSize.set(2048, 2048);
    light.shadow.camera.left = -28;
    light.shadow.camera.right = 28;
    light.shadow.camera.top = 28;
    light.shadow.camera.bottom = -28;
    light.shadow.camera.far = 100;
    light.shadow.normalBias = 0.015;
    this.scene.add(light);
    this.groundPlane.rotation.x = -Math.PI / 2;
    this.groundPlane.receiveShadow = true;
    this.groundPlane.visible = false;
    this.scene.add(this.model, this.grid, this.groundPlane);
    Object.values(this.groups).forEach((g) => this.model.add(g));
    this.model.add(this.selection, this.buildingSelection, this.scenePlacements);
    this.selection.visible = false;
    this.selection.renderOrder = 10;
    this.groups.voxels.visible = false;
    this.groups.surfaces.visible = false;
    this.groups.normals.visible = false;
    this.groups.regions.visible = false;
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI;
    this.controls.minDistance = 1;
    this.controls.maxDistance = 400;
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.controls.mouseButtons = {
      LEFT: null,
      MIDDLE: THREE.MOUSE.ROTATE,
      RIGHT: null,
    };
    this.controls.touches = {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_PAN,
    };
    this.interaction = new SurfaceInteraction(
      this.renderer.domElement,
      this.camera,
      this.scene,
      () => ({
        result: this.result,
        origin: this.displayOrigin,
        surfaces: this.groups.surfaces,
        objects: this.scenePlacements,
      }),
      onEdit,
      (e) => this.inspect(e),
      onSelection,
    );
    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }
  private inspect(e: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.raycaster.setFromCamera(
      new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        1 - ((e.clientY - rect.top) / rect.height) * 2,
      ),
      this.camera,
    );
    const targets = [
      ...(this.groups.placements.visible
        ? this.groups.placements.children
        : []),
      ...(this.groups.surfaces.visible ? this.groups.surfaces.children : []),
    ];
    this.scene.updateMatrixWorld(true);
    const hit = this.raycaster.intersectObjects(targets, false)[0];
    if (hit?.instanceId !== undefined && this.result) {
      const module = hit.object.userData.module;
      let faceId = hit.object.userData.faceIds[hit.instanceId];
      if (module?.kind === "structure") {
        const point = hit.point.clone().sub(this.displayOrigin);
        if (module.assetKey.startsWith("roof."))
          faceId =
            module.faceIds.find((id: string) => {
              const cell = id.split("|")[0].split(",").map(Number);
              return (
                point.x >= cell[0] - 1e-6 &&
                point.x <= cell[0] + 1 + 1e-6 &&
                point.z >= cell[2] - 1e-6 &&
                point.z <= cell[2] + 1 + 1e-6
              );
            }) ?? faceId;
        else if (module.assetKey.startsWith("corner.")) {
          const relative = point.sub(
              new THREE.Vector3(
                ...(module.position2.map((n: number) => n / 2) as Vec3),
              ),
            ),
            basis = BASES[module.orientationId as keyof typeof BASES];
          const u = relative.dot(new THREE.Vector3(...basis.u)),
            n = relative.dot(new THREE.Vector3(...basis.n));
          if (Math.abs(u - 0.5) < Math.abs(n))
            faceId =
              module.faceIds.find((id: string) => id !== module.hostFaceId) ??
              faceId;
        }
      }
      this.onSelect(
        faceId,
        module?.kind === "attachment" ? module.moduleId : undefined,
      );
    } else this.onSelect("");
  }
  setEditMode(mode: "building" | "object" | "road") {
    this.interaction.clear();
    this.interaction.mode = mode;
  }
  clearEditSelection() {
    this.interaction.clear();
  }
  private resize() {
    const { clientWidth: w, clientHeight: h } = this.host;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
  }
  private clearGroup(group: THREE.Group) {
    for (const child of [...group.children]) {
      group.remove(child);
      if (child instanceof THREE.InstancedMesh) child.dispose();
      else if (child instanceof THREE.LineSegments) child.geometry.dispose();
    }
  }
  clear() {
    Object.values(this.groups).forEach((g) => this.clearGroup(g));
    this.selection.visible = false;
    this.clearGroup(this.buildingSelection);
    this.clearGroup(this.scenePlacements);
    this.result = undefined;
  }
  sync(result: GenerationResult, catalog: Tile[]) {
    this.clear();
    this.result = result;
    const bounds = new THREE.Box3();
    for (const c of result.cells) {
      bounds.expandByPoint(new THREE.Vector3(...c));
      bounds.expandByPoint(new THREE.Vector3(c[0] + 1, c[1] + 1, c[2] + 1));
    }
    for (const p of result.scenePlacements ?? []) {
      bounds.expandByPoint(new THREE.Vector3(...p.center.map((v,a) => v-p.size[a]/2) as Vec3));
      bounds.expandByPoint(new THREE.Vector3(...p.center.map((v,a) => v+p.size[a]/2) as Vec3));
    }
    const center = bounds.isEmpty()
      ? new THREE.Vector3()
      : bounds.getCenter(new THREE.Vector3());
    const previousOrigin = this.displayOrigin.clone();
    this.displayOrigin.copy(center).negate();
    const shift = this.displayOrigin.clone().sub(previousOrigin);
    this.camera.position.add(shift);
    this.controls.target.add(shift);
    this.interaction.refresh();
    this.model.position.set(0, 0, 0);
    this.grid.position.set(0, this.displayOrigin.y + this.ground, 0);
    this.groundPlane.position.copy(this.grid.position);
    this.radius = Math.max(
      2,
      bounds.isEmpty() ? 2 : bounds.getSize(new THREE.Vector3()).length() / 2,
    );
    for (const p of result.scenePlacements ?? []) {
      let material = this.sceneMaterials.get(p.color);
      if (!material) { material = new THREE.MeshStandardMaterial({color:p.color, roughness:.8}); this.sceneMaterials.set(p.color,material); }
      const mesh = new THREE.InstancedMesh(this.cube, material, 1);
      const matrix = new THREE.Matrix4().compose(new THREE.Vector3(...p.center).add(this.displayOrigin), new THREE.Quaternion(), new THREE.Vector3(...p.size));
      mesh.setMatrixAt(0,matrix); mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.userData.scenePlacement = p;
      this.scenePlacements.add(mesh);
    }
    this.renderer.domElement.dataset.sceneAssets = (result.scenePlacements ?? []).map(p => p.asset).join(",");
    const count = result.surfaces.length;
    if (!count) return;
    const surfaces = new THREE.InstancedMesh(
      this.plane,
      this.surfaceMaterial,
      count,
    );
    const matrix = new THREE.Matrix4();
    const tiles = new Map(catalog.map((t) => [t.tileId, t]));
    const batches = new Map<string, { tile: Tile; indices: number[] }>();
    result.placements.forEach((p, i) => {
      const tile = tiles.get(p.tileId);
      if (!tile) throw new Error(`Unknown catalog tile: ${p.tileId}`);
      if (!batches.has(tile.tileId))
        batches.set(tile.tileId, { tile, indices: [] });
      batches.get(tile.tileId)!.indices.push(i);
    });
    for (const { tile, indices } of batches.values()) {
      const parts =
        tile.assetKey.startsWith("crafted.") ||
        tile.assetKey.startsWith("facade.")
          ? this.crafted.get(tile.assetKey)
          : undefined;
      const mesh = new THREE.InstancedMesh(
        parts?.panel ?? this.plane,
        this.assets.get(tile),
        indices.length,
      );
      mesh.userData.faceIds = indices.map((i) => result.placements[i].faceId);
      indices.forEach((index, instance) => {
        const p = result.placements[index];
        setPlacementMatrix(
          matrix,
          p.position2,
          p.orientationId,
          this.displayOrigin,
        );
        mesh.setMatrixAt(instance, matrix);
        mesh.setColorAt(
          instance,
          new THREE.Color(
            tile.assetKey === "unit-panel"
              ? (LEGACY_COLORS[tile.tileId] ?? "#ff36b6")
              : "#ffffff",
          ),
        );
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      this.groups.placements.add(mesh);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (parts?.relief) {
        const relief = new THREE.InstancedMesh(
          parts.relief,
          this.assets.frame(tile.palette!),
          indices.length,
        );
        relief.instanceMatrix.copy(mesh.instanceMatrix);
        relief.userData.faceIds = [...mesh.userData.faceIds];
        relief.computeBoundingSphere();
        relief.castShadow = true;
        relief.receiveShadow = true;
        this.groups.placements.add(relief);
      }
      if (parts?.glass) {
        const glass = new THREE.InstancedMesh(
          parts.glass,
          this.assets.glass(tile.palette!),
          indices.length,
        );
        glass.instanceMatrix.copy(mesh.instanceMatrix);
        glass.userData.faceIds = [...mesh.userData.faceIds];
        glass.computeBoundingSphere();
        this.groups.placements.add(glass);
      }
    }
    for (const m of result.modules ?? []) {
      const parts = this.crafted.get(m.assetKey);
      setPlacementMatrix(
        matrix,
        m.position2,
        m.orientationId,
        this.displayOrigin,
        m.scale16,
      );
      const material = m.assetKey.startsWith("roof.")
        ? this.assets.roof(m.palette, m.scale16[0] / 16, m.scale16[1] / 16)
        : m.assetKey.startsWith("corner.")
          ? this.assets.get({
              tileId: m.assetKey,
              assetKey: m.assetKey.endsWith("top")
                ? "village.window-top"
                : "village.window",
              palette: m.palette,
              roles: ["wall"],
              orientationIds: [m.orientationId],
              footprint: "unit-face",
              pivot: "face-center",
            })
          : this.assets.frame(m.palette);
      for (const [geometry, mat] of [
        [parts.panel, material],
        [parts.relief, this.assets.frame(m.palette)],
      ] as const) {
        if (!geometry) continue;
        const mesh = new THREE.InstancedMesh(geometry, mat, 1);
        mesh.setMatrixAt(0, matrix);
        mesh.userData.faceIds = [m.hostFaceId];
        mesh.userData.module = m;
        mesh.computeBoundingSphere();
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.groups.placements.add(mesh);
      }
    }
    surfaces.userData.faceIds = result.surfaces.map((s) => s.faceId);
    for (let i = 0; i < count; i++) {
      // Build the analysis view from surfaces independently of placement transforms.
      const surface = result.surfaces[i];
      setPlacementMatrix(
        matrix,
        faceCenter2(surface.cell, surface.direction),
        surface.direction,
        this.displayOrigin,
      );
      surfaces.setMatrixAt(i, matrix);
      surfaces.setColorAt(i, new THREE.Color(ROLE_COLORS[surface.role]));
    }
    for (const mesh of [surfaces]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
    this.groups.surfaces.add(surfaces);
    for (const region of result.regions ?? []) {
      const lines = this.lines(
        region.boundaryEdges.flatMap((e) => [...e.start, ...e.end]),
        this.regionMaterial,
      );
      lines.userData.regionId = region.regionId;
      lines.renderOrder = 8;
      this.groups.regions.add(lines);
    }
    const voxels = new THREE.InstancedMesh(
      this.cube,
      this.voxelMaterial,
      result.cells.length,
    );
    result.cells.forEach((c, i) =>
      voxels.setMatrixAt(
        i,
        new THREE.Matrix4().makeTranslation(
          c[0] + 0.5 + this.displayOrigin.x,
          c[1] + 0.5 + this.displayOrigin.y,
          c[2] + 0.5 + this.displayOrigin.z,
        ),
      ),
    );
    voxels.instanceMatrix.needsUpdate = true;
    voxels.computeBoundingSphere();
    this.groups.voxels.add(voxels);
    for (const kind of ["convex", "concave", "flat", "unsupported"] as const) {
      const points = result.features
        .filter((e) => e.kind === kind)
        .flatMap((e) => [...e.start, ...e.end]);
      this.groups.edges.add(this.lines(points, this.lineMaterials[kind]));
    }
    const normalPoints = result.surfaces.flatMap((s) => {
      const c = faceCenter2(s.cell, s.direction).map((n) => n / 2);
      return [...c, ...c.map((n, a) => n + BASES[s.direction].n[a] * 0.3)];
    });
    this.groups.normals.add(
      this.lines(normalPoints, this.lineMaterials.normal),
    );
  }
  private lines(points: number[], material: THREE.LineBasicMaterial) {
    return new THREE.LineSegments(
      new THREE.BufferGeometry().setAttribute(
        "position",
        new THREE.Float32BufferAttribute(
          points.map((n, i) => n + this.displayOrigin.getComponent(i % 3)),
          3,
        ),
      ),
      material,
    );
  }
  selectBuilding(componentId?: string) {
    this.clearGroup(this.buildingSelection);
    this.renderer.domElement.dataset.buildingId = componentId ?? "";
    if (!componentId) return;
    const points = this.result?.surfaces.filter(s => s.componentId === componentId).flatMap(s => {
      const corners = faceCorners(s.cell, s.direction);
      return corners.flatMap((c,i) => [...c, ...corners[(i+1)%4]]);
    }) ?? [];
    const lines = this.lines(points, this.selectedMaterial);
    lines.renderOrder = 15;
    this.buildingSelection.add(lines);
  }
  select(faceId: string) {
    const face = this.result?.surfaces.find((s) => s.faceId === faceId);
    this.selection.visible = false;
    if (!face) return;
    this.groups.regions.children.forEach(
      (child) =>
        (child.visible =
          child.userData.regionId === face.architecture?.regionId),
    );
    this.selection.geometry.dispose();
    this.selection.geometry = new THREE.BufferGeometry().setFromPoints(
      faceCorners(face.cell, face.direction).map((c) =>
        new THREE.Vector3(...c).add(this.displayOrigin),
      ),
    );
  }
  setLayer(layer: Layer, visible: boolean) {
    this.groups[layer].visible = visible;
  }
  setGround(y: number) {
    this.ground = y;
    this.grid.position.y = this.displayOrigin.y + y;
    this.groundPlane.position.y = this.grid.position.y;
  }
  setGroundVisible(visible: boolean) {
    this.groundPlane.visible = visible;
    this.grid.visible = !visible;
  }
  setCamera(preset: "iso" | "below" | "top") {
    const vector =
      preset === "below"
        ? new THREE.Vector3(1, -0.9, 1)
        : preset === "top"
          ? new THREE.Vector3(0, 1, 0.001)
          : new THREE.Vector3(1, 0.85, 1);
    this.controls.target.set(0, 0, 0);
    this.camera.position.copy(
      vector.normalize().multiplyScalar(this.radius * 3.7),
    );
    this.controls.update();
  }
  dispose() {
    this.renderer.setAnimationLoop(null);
    this.observer.disconnect();
    this.interaction.dispose();
    this.controls.dispose();
    this.clear();
    this.plane.dispose();
    this.cube.dispose();
    this.selection.geometry.dispose();
    this.selectedMaterial.dispose();
    this.grid.dispose();
    [
      this.surfaceMaterial,
      this.voxelMaterial,
      ...Object.values(this.lineMaterials),
    ].forEach((m) => m.dispose());
    this.regionMaterial.dispose();
    this.assets.dispose();
    this.crafted.dispose();
    this.sceneMaterials.forEach(m => m.dispose());
    this.groundPlane.geometry.dispose();
    this.groundPlane.material.dispose();
    this.renderer.dispose();
  }
}
