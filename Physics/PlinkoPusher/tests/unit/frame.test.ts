import { describe, expect, it } from 'vitest';
import { defaultBoard } from '../../src/core/config';
import {
  boardTransformFor, composeTransforms, frameFromTransform, localToWorld, orthonormalError, PLACEMENTS, projectedGravity, rayToLocal, uniformScale, worldToLocal, type PlacementId,
} from '../../src/core/frame';
import { buildBoardLayout, pickPeg } from '../../src/core/layout';
import { add, quatFromEulerDeg, scale, sub, vec3 } from '../../src/core/math';

const dims = defaultBoard();
const anchor = vec3(0, 13, -12);
const ids = Object.keys(PLACEMENTS) as PlacementId[];

describe('보드 로컬 ↔ 월드 좌표 계약', () => {
  it.each(ids)('%s 배치의 기저는 직교 단위이며 왕복 변환이 일치한다', id => {
    const f = frameFromTransform(boardTransformFor(PLACEMENTS[id], anchor, dims.width, dims.height).world);
    expect(orthonormalError(f)).toBeLessThan(1e-9);
    for (const [u, v, d] of [[0, 0, 0], [3.2, 7.5, 0.3], [12, 16, -1]]) {
      const back = worldToLocal(f, localToWorld(f, u, v, d));
      expect(back.u).toBeCloseTo(u, 9); expect(back.v).toBeCloseTo(v, 9); expect(back.depth).toBeCloseTo(d, 9);
    }
    // 보드 중심은 배치와 무관하게 anchor(+부모 이동)에 놓인다
    const c = localToWorld(f, dims.width / 2, dims.height / 2);
    const expected = add(anchor, PLACEMENTS[id].parent.position);
    expect(c.x).toBeCloseTo(expected.x, 9); expect(c.y).toBeCloseTo(expected.y, 9); expect(c.z).toBeCloseTo(expected.z, 9);
  });

  it('부모 Transform 합성은 단계별 변환과 같다', () => {
    const parent = { position: vec3(2, 3, -1), rotation: quatFromEulerDeg(-30, 10, 0), scale: vec3(2, 2, 2) };
    const child = { position: vec3(1, -2, 0.5), rotation: quatFromEulerDeg(0, -15, 8), scale: vec3(0.5, 0.5, 0.5) };
    const world = frameFromTransform(composeTransforms(parent, child));
    const childFrame = frameFromTransform(child), parentFrame = frameFromTransform(parent);
    // 자식 로컬 → 부모 로컬(Transform 축으로 표현) → 월드
    const viaChild = localToWorld(childFrame, 1.5, 4, 0.2);
    const viaParent = localToWorld(parentFrame, viaChild.x, -viaChild.y, viaChild.z);
    const direct = localToWorld(world, 1.5, 4, 0.2);
    expect(direct.x).toBeCloseTo(viaParent.x, 9); expect(direct.y).toBeCloseTo(viaParent.y, 9); expect(direct.z).toBeCloseTo(viaParent.z, 9);
    expect(world.scale).toBeCloseTo(1, 12);
  });

  it('비균일 스케일은 명시적으로 차단한다', () => {
    expect(() => uniformScale({ position: vec3(), rotation: quatFromEulerDeg(0, 0, 0), scale: vec3(1, 2, 1) })).toThrow(/비균일/);
    expect(() => frameFromTransform({ position: vec3(), rotation: quatFromEulerDeg(0, 0, 0), scale: vec3(1, 1, 1.5) })).toThrow();
  });

  it.each(ids)('%s 배치에서 화면 광선으로 고른 페그가 로컬 판정과 일치한다', id => {
    const layout = buildBoardLayout(dims, { level: 1, pattern: 'mixed' });
    const f = frameFromTransform(boardTransformFor(PLACEMENTS[id], anchor, dims.width, dims.height).world);
    const camera = vec3(25, 30, 40);
    for (const peg of [layout.pegs[0], layout.pegs[40], layout.pegs[layout.pegs.length - 1]]) {
      const target = localToWorld(f, peg.u + 0.05, peg.v - 0.04, 0.3);
      const hit = rayToLocal(f, camera, sub(target, camera), 0.3)!;
      expect(hit.u).toBeCloseTo(peg.u + 0.05, 6); expect(hit.v).toBeCloseTo(peg.v - 0.04, 6);
      expect(pickPeg(layout, hit.u, hit.v)?.index).toBe(peg.index);
    }
    // 보드와 평행한 광선은 교차하지 않는다
    expect(rayToLocal(f, camera, scale(f.uAxis, 1))).toBeNull();
  });

  it('월드 중력 투영은 별도 옵션이며 기본(장치 중력)과 다르다', () => {
    const g = vec3(0, -30, 0);
    const up = frameFromTransform(boardTransformFor(PLACEMENTS.default, anchor, dims.width, dims.height).world);
    const rolled = frameFromTransform(boardTransformFor(PLACEMENTS.roll, anchor, dims.width, dims.height).world);
    expect(projectedGravity(up, g).u).toBeCloseTo(0, 9); expect(projectedGravity(up, g).v).toBeCloseTo(30 * Math.cos(40 * Math.PI / 180), 9);
    const r = projectedGravity(rolled, g);
    expect(Math.abs(r.u)).toBeGreaterThan(5); // 법선축 회전 시 투영 중력은 u 성분을 가진다
  });
});
