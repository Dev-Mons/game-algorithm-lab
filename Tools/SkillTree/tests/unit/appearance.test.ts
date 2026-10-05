import { expect, it } from 'vitest';
import { connectionEndpoints } from '../../src/appearance';
import { createNode, type SkillNode } from '../../src/model';

it.each(['Square', 'Circle', 'Diamond'] as const)('clips horizontal and vertical lines to %s boundaries', shape => {
  const a = { ...createNode('A', 0, 0), NodeShape: shape, NodeSize: 40 };
  const b = { ...createNode('B', 120, 0), NodeShape: shape, NodeSize: 40 };
  expect(connectionEndpoints(a, b)).toEqual({ from: { x: 40, y: 20 }, to: { x: 120, y: 20 } });
  b.X = 0; b.Y = -120;
  expect(connectionEndpoints(a, b)).toEqual({ from: { x: 20, y: 0 }, to: { x: 20, y: -80 } });
});
it('uses actual diamond bounds on diagonal links and does not invert overlapping edges', () => {
  const a: SkillNode = { ...createNode('A', 0, 0), NodeShape: 'Diamond', NodeSize: 40 };
  const b = { ...createNode('B', 100, 100), NodeSize: 40 };
  const line = connectionEndpoints(a, b);
  expect(line.from.x).toBeCloseTo(30); expect(line.from.y).toBeCloseTo(30);
  expect(line.to.x).toBeCloseTo(100); expect(line.to.y).toBeCloseTo(100);
  b.X = b.Y = 0;
  expect(connectionEndpoints(a, b)).toEqual({ from: { x: 20, y: 20 }, to: { x: 20, y: 20 } });
});
