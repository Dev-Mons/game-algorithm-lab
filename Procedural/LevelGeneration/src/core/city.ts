import { normalizeGrid, type Vec3 } from "./analysis";
import { hash33 } from "./selection";
export interface CitySettings {
  seed: number;
  blocks: number;
  lotSize: number;
  streetWidth: number;
  maxHeight: number;
  density: number;
  layout: "grid" | "courtyard";
}
export interface CityLot {
  id: string;
  origin: Vec3;
  width: number;
  depth: number;
  height: number;
  shape: "block" | "setback" | "annex";
}
function sample(seed: number, key: string) {
  let h = hash33(seed, key);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
export function generateCity(settings: CitySettings) {
  const limits: Record<string, [number, number]> = {
    seed: [0, 0xffffffff],
    blocks: [1, 4],
    lotSize: [3, 6],
    streetWidth: [1, 4],
    maxHeight: [1, 8],
    density: [0, 100],
  };
  for (const [key, [min, max]] of Object.entries(limits)) {
    const n = settings[key as keyof CitySettings];
    if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max)
      throw new Error(`도시 설정 ${key}: ${min}~${max} 정수가 필요합니다.`);
  }
  if (!["grid", "courtyard"].includes(settings.layout))
    throw new Error("알 수 없는 도시 배치입니다.");
  if (
    settings.blocks * settings.lotSize +
      (settings.blocks - 1) * settings.streetWidth >
    32
  )
    throw new Error(
      "도시 가로·세로 범위는 32셀 이하여야 합니다. 블록이나 도로 폭을 줄이세요.",
    );
  const cells: Vec3[] = [],
    lots: CityLot[] = [];
  for (let row = 0; row < settings.blocks; row++)
    for (let column = 0; column < settings.blocks; column++) {
      if (
        settings.layout === "courtyard" &&
        row > 0 &&
        column > 0 &&
        row < settings.blocks - 1 &&
        column < settings.blocks - 1
      )
        continue;
      const id = `lot:${column},${row}`,
        random = (key: string) => sample(settings.seed, `${id}|${key}`);
      if (random("density") % 100 >= settings.density) continue;
      const width = settings.lotSize - (random("width") % 2),
        depth = settings.lotSize - (random("depth") % 2),
        height = 1 + (random("height") % settings.maxHeight);
      const origin: Vec3 = [
        column * (settings.lotSize + settings.streetWidth),
        0,
        row * (settings.lotSize + settings.streetWidth),
      ];
      const shape: CityLot["shape"] =
        height >= 3 && width >= 3 && depth >= 3 && random("shape") % 3 === 0
          ? "setback"
          : height >= 3 && width >= 4 && random("shape") % 3 === 1
            ? "annex"
            : "block";
      lots.push({ id, origin, width, depth, height, shape });
      for (let x = 0; x < width; x++)
        for (let z = 0; z < depth; z++)
          for (let y = 0; y < height; y++) {
            if (
              shape === "setback" &&
              y >= Math.ceil(height / 2) &&
              (x === 0 || z === 0 || x === width - 1 || z === depth - 1)
            )
              continue;
            if (shape === "annex" && x >= 2 && y >= Math.ceil(height / 2))
              continue;
            cells.push([origin[0] + x, y, origin[2] + z]);
          }
    }
  return {
    generatorVersion: "city-grid-v1",
    settings: { ...settings },
    cells: normalizeGrid(cells),
    lots,
  };
}
