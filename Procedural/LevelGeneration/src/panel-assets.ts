import * as THREE from "three";
import {facadeFinish,facadeColors,type FacadeFinish} from './facade-finishes';
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
  if (asset === "crafted.roof") {
    // Flat commercial roofs use standing seams, not painted pitched-roof tiles.
    rect(0,0,256,256,palette==='sage'?'#697c80':palette==='sand'?'#89887d':'#827d73');
    for(let x=0;x<256;x+=128){rect(x,0,2,256,'#00000028');rect(x+2,0,2,256,'#ffffff20');}
    rect(0,254,256,2,'#00000018');
  } else if (asset === "crafted.paving") {
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
  } else if (asset === "crafted.soffit") {
    rect(0, 0, 256, 256, "#827b6c");
    for (let x = 0; x < 256; x += 32) {
      rect(x, 0, 2, 256, "#635e56");
      rect(x + 3, 0, 2, 256, "#aaa18a");
    }
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
  get size(){return this.materials.size+this.extraMaterials.size;}
  private painted(asset:Tile['assetKey'],palette:Palette){const key=`${asset}|${palette}`;if(!this.materials.has(key)){const texture=new THREE.CanvasTexture(paint(asset,palette));texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;this.materials.set(key,new THREE.MeshStandardMaterial({map:texture,roughness:.9,side:THREE.DoubleSide}));}return this.materials.get(key)!;}
  get(tile: Tile): THREE.MeshStandardMaterial {
    if (tile.assetKey === "unit-panel") {
      const key = `unit|${tile.tileId}`;
      if (!this.extraMaterials.has(key)) this.extraMaterials.set(key, new THREE.MeshStandardMaterial({color:LEGACY_COLORS[tile.tileId]??'#ff36b6',roughness:.88,side:THREE.DoubleSide}));
      return this.extraMaterials.get(key)!;
    }
    if (tile.assetKey.startsWith("facade.")) {
      return this.facadeMaterial(tile.palette!,facadeFinish(tile.assetKey),'wall');
    }
    const material=this.painted(tile.assetKey,tile.palette!);
    return material;
  }
  facadeMaterials(tile:Tile):THREE.Material[]{
    const palette=tile.palette??'clay',finish=facadeFinish(tile.assetKey);
    return [this.get(tile),this.facadeMaterial(palette,finish,'frame'),
      this.facadeMaterial(palette,finish,'glass'),this.facadeMaterial(palette,finish,'metal')];
  }
  private facadeMaterial(palette:Palette,finish:FacadeFinish,part:'wall'|'frame'|'glass'|'metal'){
    const key=`architecture|${finish}|${palette}|${part}`;
    if(!this.extraMaterials.has(key)){
      const colors=facadeColors(finish,palette),glass=part==='glass',metal=part==='metal';
      const material=new THREE.MeshStandardMaterial({color:colors[part],roughness:glass?.19:metal?.34:part==='frame'?.64:.88,metalness:glass?.08:metal?.72:0,side:THREE.DoubleSide});
      if(part==='wall'||glass){
        const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
        const ctx=canvas.getContext('2d')!;
        ctx.fillStyle='#ffffff';ctx.fillRect(0,0,256,256);
        if(glass){
          const gradient=ctx.createLinearGradient(0,0,0,256);
          if(finish==='curtain-b'){
            gradient.addColorStop(0,'#c6c0b1');gradient.addColorStop(.55,'#aea393');gradient.addColorStop(1,'#928779');
          }else if(finish==='streamline-c'){
            gradient.addColorStop(0,'#c0c1b5');gradient.addColorStop(1,'#96998e');
          }else if(finish==='ribbon-a'){
            gradient.addColorStop(0,'#bcb5a6');gradient.addColorStop(1,'#7b786e');
          }else{
            gradient.addColorStop(0,'#dcebf0');gradient.addColorStop(.42,'#a3b7bf');
            gradient.addColorStop(.46,'#91a7af');gradient.addColorStop(1,'#64808d');
          }
          ctx.fillStyle=gradient;ctx.fillRect(0,0,256,256);
          if(finish==='curtain-b'){
            ctx.fillStyle='#ffffff13';ctx.fillRect(0,0,128,256);
            ctx.fillStyle='#00000018';ctx.fillRect(128,145,128,111);
          }else if(finish!=='ribbon-a'&&finish!=='streamline-c'){ctx.fillStyle='#ffffff17';ctx.beginPath();ctx.moveTo(22,0);ctx.lineTo(52,0);ctx.lineTo(162,256);ctx.lineTo(132,256);ctx.fill();}
        }else{
          // Fixed courses/panel joints; no image dependency or per-face textures.
          const rows=finish.startsWith('streamline-c')?1:colors.masonry?8:2,step=256/rows;
          for(let row=0;row<rows;row++){
            ctx.fillStyle='#00000018';ctx.fillRect(0,row*step,256,1.5);
            const stride=colors.masonry?64:128;
            for(let u=(row%2)*stride/2;u<256;u+=stride){
              ctx.fillStyle='#00000012';ctx.fillRect(u,row*step,1.5,step);
              ctx.fillStyle=(row+u/stride)%3<1?'#00000007':'#ffffff08';ctx.fillRect(u+2,row*step+2,stride-3,step-3);
            }
          }
        }
        const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;map.anisotropy=4;material.map=map;
      }
      this.extraMaterials.set(key,material);
    }
    return this.extraMaterials.get(key)!;
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
      const map = this.painted("crafted.roof",palette).map!.clone();
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
