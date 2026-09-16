import * as THREE from "three";
import {
  PANEL_ASSETS,
  PALETTES,
  type Palette,
  type Tile,
} from "./core/selection";

// Fixed, authored panel designs. All use the same unmodified unit-face mesh.
// Colors/materials are looked up from the selected catalog metadata, never inferred from a role.
const schemes: Record<
  Palette,
  {
    wall: string;
    shadow: string;
    trim: string;
    shutter: string;
    roof: string;
    roofShade: string;
  }
> = {
  clay: {
    wall: "#d9a38c",
    shadow: "#b97565",
    trim: "#f4dfb6",
    shutter: "#5d6c65",
    roof: "#9b5848",
    roofShade: "#77443e",
  },
  sage: {
    wall: "#a4b8ac",
    shadow: "#718f87",
    trim: "#f3e7c9",
    shutter: "#536a71",
    roof: "#586e78",
    roofShade: "#40545f",
  },
  sand: {
    wall: "#e3ca9d",
    shadow: "#b39a76",
    trim: "#f8edd5",
    shutter: "#647b77",
    roof: "#b87550",
    roofShade: "#905537",
  },
};
export const LEGACY_COLORS: Record<string, string> = {
  "panel.wall": "#ded3ba",
  "panel.wall.alt": "#bfbbab",
  "panel.roof": "#cb795f",
  "panel.terrace": "#80bbb0",
  "panel.underside": "#a79ac6",
  "debug.missing": "#ff36b6",
};
function paint(asset: Tile["assetKey"], palette: Palette): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context is required for panel assets.");
  const c = schemes[palette];
  const rect = (x: number, y: number, w: number, h: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  };
  rect(0, 0, 256, 256, c.wall);
  // Tones are fixed, subtle plaster detail; never random per regeneration.
  for (let y = 16; y < 256; y += 32)
    for (let x = 12; x < 256; x += 40)
      rect(x + (y % 64 === 16 ? 5 : 0), y, 16, 2, "#ffffff0a");
  rect(0, 248, 256, 8, c.shadow);
  rect(0, 246, 256, 2, c.trim);
  if (asset === "village.roof") {
    rect(0, 0, 256, 256, c.roof);
    for (let row = 0; row < 8; row++) {
      const y = row * 32;
      rect(0, y + 27, 256, 5, c.roofShade);
      rect(0, y, 256, 3, "#ffffff20");
      for (let x = (row % 2) * 32 - 64; x < 256; x += 64) {
        rect(x, y, 3, 27, c.roofShade);
        rect(x + 4, y + 3, 3, 21, "#ffffff17");
      }
    }
  } else if (asset === "village.paving") {
    rect(0, 0, 256, 256, "#aaa58f");
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 4; x++) {
        rect(
          x * 64 + 2,
          y * 64 + 2,
          60,
          60,
          (x + y) % 2 ? "#c3bda4" : "#b9b39c",
        );
        rect(x * 64 + 2, y * 64 + 2, 60, 2, "#e0d8bd");
      }
  } else if (asset === "village.soffit") {
    rect(0, 0, 256, 256, "#827b6c");
    for (let x = 0; x < 256; x += 32) {
      rect(x, 0, 2, 256, "#635e56");
      rect(x + 3, 0, 2, 256, "#aaa18a");
    }
  } else if (asset === "village.window" || asset === "village.window-top") {
    // Recess shading, shutters, cream frame and dark four-pane glass.
    rect(63, 55, 136, 156, c.shadow);
    rect(33, 60, 25, 142, c.shutter);
    rect(198, 60, 25, 142, c.shutter);
    for (let y = 70; y < 196; y += 13) {
      rect(36, y, 19, 3, "#ffffff28");
      rect(201, y, 19, 3, "#ffffff28");
    }
    rect(60, 50, 136, 155, c.trim);
    rect(70, 61, 116, 132, "#384e55");
    rect(77, 67, 45, 48, "#708c91");
    rect(134, 67, 45, 48, "#556f78");
    rect(77, 129, 45, 56, "#536e73");
    rect(134, 129, 45, 56, "#465f68");
    rect(125, 59, 7, 138, c.trim);
    rect(68, 119, 119, 7, c.trim);
    rect(57, 204, 148, 7, c.shadow);
    rect(51, 197, 154, 8, c.trim);
    rect(59, 43, 137, 8, c.trim);
    if (asset === "village.window-top") {
      rect(0, 0, 256, 12, c.trim);
      rect(0, 12, 256, 5, c.shadow);
      rect(0, 19, 256, 3, c.trim);
    }
  } else if (asset === "village.entry") {
    rect(64, 51, 135, 205, c.shadow);
    ctx.fillStyle = c.trim;
    ctx.beginPath();
    ctx.roundRect(58, 41, 140, 215, [62, 62, 0, 0]);
    ctx.fill();
    ctx.fillStyle = c.shutter;
    ctx.beginPath();
    ctx.roundRect(70, 53, 116, 203, [51, 51, 0, 0]);
    ctx.fill();
    ctx.fillStyle = "#52696a";
    ctx.beginPath();
    ctx.arc(128, 104, 45, Math.PI, 0);
    ctx.fill();
    rect(75, 105, 106, 6, c.trim);
    rect(125, 65, 6, 43, c.trim);
    rect(84, 128, 38, 89, "#ffffff0d");
    rect(136, 128, 36, 89, "#ffffff0d");
    rect(126, 111, 3, 134, "#243a3c");
    rect(115, 175, 5, 7, "#dfbf78");
    rect(139, 175, 5, 7, "#dfbf78");
    rect(60, 246, 140, 10, "#d1c1a3");
    rect(51, 250, 158, 6, "#eee2c7");
    rect(34, 127, 14, 26, "#45575b");
    rect(37, 131, 8, 15, "#efc780");
  }
  return canvas;
}
export class PanelAssets {
  private plain = new THREE.MeshStandardMaterial({
    roughness: 0.88,
    side: THREE.DoubleSide,
  });
  private materials = new Map<string, THREE.MeshStandardMaterial>();
  private extraMaterials = new Map<string, THREE.MeshStandardMaterial>();
  constructor() {
    for (const asset of PANEL_ASSETS)
      if (asset.startsWith("village."))
        for (const palette of PALETTES) {
          const texture = new THREE.CanvasTexture(paint(asset, palette));
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.anisotropy = 4;
          this.materials.set(
            `${asset}|${palette}`,
            new THREE.MeshStandardMaterial({
              map: texture,
              roughness: 0.9,
              side: THREE.DoubleSide,
            }),
          );
        }
  }
  get(tile: Tile): THREE.MeshStandardMaterial {
    if (tile.assetKey === "unit-panel") return this.plain;
    if (tile.assetKey.startsWith("facade.")) {
      const key = `facade-wall|${tile.palette}`;
      if (!this.extraMaterials.has(key))
        this.extraMaterials.set(
          key,
          new THREE.MeshStandardMaterial({
            color: schemes[tile.palette!].wall,
            roughness: 0.82,
            side: THREE.DoubleSide,
          }),
        );
      return this.extraMaterials.get(key)!;
    }
    const material = this.materials.get(
      `${tile.assetKey.replace("crafted.", "village.")}|${tile.palette}`,
    );
    if (!material)
      throw new Error(
        `Missing shared panel asset: ${tile.assetKey}/${tile.palette}`,
      );
    return material;
  }
  dispose() {
    this.plain.dispose();
    for (const material of this.materials.values()) {
      material.map!.dispose();
      material.dispose();
    }
    for (const material of this.extraMaterials.values()) {
      material.map?.dispose();
      material.dispose();
    }
  }
  frame(palette: Palette) {
    const key = `frame|${palette}`;
    if (!this.extraMaterials.has(key))
      this.extraMaterials.set(
        key,
        new THREE.MeshStandardMaterial({
          color: schemes[palette].trim,
          roughness: 0.85,
          side: THREE.DoubleSide,
        }),
      );
    return this.extraMaterials.get(key)!;
  }
  glass(palette: Palette) {
    const key = `glass|${palette}`;
    if (!this.extraMaterials.has(key))
      this.extraMaterials.set(
        key,
        new THREE.MeshStandardMaterial({
          color: "#426b81",
          roughness: 0.24,
          metalness: 0.35,
          side: THREE.DoubleSide,
        }),
      );
    return this.extraMaterials.get(key)!;
  }
  roof(palette: Palette, width: number, depth: number) {
    const key = `roof|${palette}|${width}|${depth}`;
    if (!this.extraMaterials.has(key)) {
      const map = this.materials.get(`village.roof|${palette}`)!.map!.clone();
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
      map.repeat.set(width, depth);
      map.needsUpdate = true;
      this.extraMaterials.set(
        key,
        new THREE.MeshStandardMaterial({
          map,
          roughness: 0.95,
          side: THREE.DoubleSide,
        }),
      );
    }
    return this.extraMaterials.get(key)!;
  }
}
