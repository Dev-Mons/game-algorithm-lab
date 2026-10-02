import type { BoardDims, TrayDims } from '../core/config';
import { localToWorld, type BoardFrame } from '../core/frame';
import { vec3, type Vec3 } from '../core/math';
import { trayGeometry } from '../physics/tray-geometry';

/** Fixed, inline press. All outlets and release positions share this layout. */
export interface DeviceLayout {
  trayZ0: number; trayTopY: number; floorY: number;
  boardAnchor: Vec3; compressor: Vec3; mainBin: Vec3; collector: Vec3;
  pressIn: Vec3; die: Vec3; feedZ: number; dropY: number;
  passageWidth: number; cargoColumns: number; cargoRows: number; cargoPitch: number; layerPitch: number;
  pressHalfWidth: number; pressHalfDepth: number; pressTop: number; ramParkZ: number;
}
export const ITEM_DEPTH = 0.3;
export const RAW_ENTRY_V = -1.65;
export const PROCESS_FRACTION = 0.22;
export const PROCESSOR_EXIT_V = 1.85;
export const PLANAR_LOWER_SECONDS = 0.22;

export function deviceLayout(board: BoardDims, tray: TrayDims, stacked = true): DeviceLayout {
  const g = trayGeometry(tray), trayZ0 = -tray.depth / 2, r = tray.tokenRadius;
  const feedZ = stacked ? Math.max(g.lip.zFront + r + 0.35, tray.faceMin + tray.stroke * 0.65) : tray.faceMin + r + tray.stroke * 0.5;
  const die = vec3(0, g.wallHeight + 1.2, trayZ0 + feedZ);
  const cargoColumns = Math.min(6, Math.max(1, Math.floor((Math.min(board.width, tray.width) - 3) / (r * 2 + 0.14))));
  const cargoPitch = r * 2 + 0.14, passageWidth = (cargoColumns - 1) * cargoPitch + r * 2 + 0.5;
  return {
    trayZ0, trayTopY: 0, floorY: -3.6,
    // Align the default 30-degree board's underside outlet vertically above the die.
    boardAnchor: vec3(0, 9.4 + board.height / 2, die.z - (board.height / 2 + PROCESSOR_EXIT_V) * 0.5 - ITEM_DEPTH * Math.cos(Math.PI / 6)),
    compressor: die, pressIn: vec3(0, die.y + 2.2, die.z), die,
    mainBin: vec3(-Math.max(board.width, tray.width) / 2 - 2.9, -0.7, trayZ0 + g.zBack + 2),
    collector: vec3(0, -2.8, tray.depth / 2 + 1.5),
    feedZ, dropY: stacked ? die.y : tray.tokenHalfHeight,
    passageWidth, cargoColumns, cargoRows: stacked ? Math.ceil(24 / cargoColumns) : 1, cargoPitch, layerPitch: 2 * tray.tokenHalfHeight + 0.05,
    pressHalfWidth: passageWidth / 2, pressHalfDepth: 0.7, pressTop: die.y + 1.8, ramParkZ: die.z - 1.7,
  };
}

export function processorPaths(board: BoardDims, frame: BoardFrame, dev: DeviceLayout) {
  const port = (u: number) => localToWorld(frame, u, board.height + 1.15, ITEM_DEPTH);
  const main = port(-0.16), outer = port(-1); outer.y = Math.min(outer.y, main.y - 0.2);
  return {
    main: [main, outer, vec3(dev.mainBin.x, dev.mainBin.y - 0.25, dev.mainBin.z)],
    by: [localToWorld(frame, board.width / 2, board.height + PROCESSOR_EXIT_V, ITEM_DEPTH), dev.pressIn],
  };
}

/** Lofted throat follows the board frame at its mouth and becomes world-horizontal at the press. */
export function byproductPoint(board: BoardDims, frame: BoardFrame, dev: DeviceLayout, progress: number, across = 0, depth = 0): Vec3 {
  const a = localToWorld(frame, board.width / 2 + across / frame.scale, board.height + PROCESSOR_EXIT_V, ITEM_DEPTH + depth / frame.scale);
  const b = vec3(dev.pressIn.x + across, dev.pressIn.y, dev.pressIn.z + depth);
  const t = Math.max(0, Math.min(1, progress));
  return vec3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
}

/** The same fixed die pockets are used for scrap, minted coins and the physics handoff. */
export function cargoOffset(dev: DeviceLayout, index: number): Vec3 {
  const layer = Math.floor(index / dev.cargoColumns);
  return vec3(((index % dev.cargoColumns) - (dev.cargoColumns - 1) / 2) * dev.cargoPitch + (layer % 2 ? 0.04 : -0.04), layer * dev.layerPitch, 0);
}
