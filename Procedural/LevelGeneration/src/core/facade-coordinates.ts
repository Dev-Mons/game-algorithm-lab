import type { Surface } from './analysis';
export const wallU = (s: Surface) =>
  s.direction === 'PX'
    ? -s.cell[2]
    : s.direction === 'NX'
      ? s.cell[2]
      : s.direction === 'NZ'
        ? -s.cell[0]
        : s.cell[0];
export const wallPlane = (s: Surface) =>
  s.direction === 'PX'
    ? s.cell[0] + 1
    : s.direction === 'NX'
      ? s.cell[0]
      : s.direction === 'PZ'
        ? s.cell[2] + 1
        : s.cell[2];

export const wallRowId = (s: Surface) => `${s.componentId}:${s.direction}:${wallPlane(s)}:${s.cell[1]}`;
