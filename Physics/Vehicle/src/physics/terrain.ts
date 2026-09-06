import { Vec3 } from './math';
export interface Triangle { a: Vec3; b: Vec3; c: Vec3; normal: Vec3 }
export interface Box { min: Vec3; max: Vec3 }
export interface RayHit { point: Vec3; normal: Vec3; distance: number }
export type CourseId = 'playground' | 'flat' | 'bumps' | 'ramp';
export const courses: Record<CourseId, { name: string; description: string }> = {
  playground: { name: '자유 시험장', description: '넓은 패드, 경사로, 요철을 자유롭게 주행하세요.' },
  flat: { name: '평지 · 핸들링', description: '가속과 제동, 원선회, 슬라럼을 비교하세요.' },
  bumps: { name: '요철 · 서스펜션', description: '좌우로 엇갈린 요철에서 네 바퀴의 하중을 관찰하세요.' },
  ramp: { name: '점프 · 착지', description: '앞쪽 경사로를 향해 가속해 이륙과 재접지를 확인하세요.' },
};
export class Terrain {
  triangles: Triangle[] = [];
  boxes: Box[] = [];
  constructor(public id: CourseId = 'playground') {
    this.quad(-5000, 5000, -5000, 5000, 0, 0, 0, 0);
    if (id === 'ramp') this.ramp(-5, 5, 18, 30, 3);
    if (id === 'bumps') this.bumps(-4, 4, 12);
    if (id === 'playground') { this.ramp(-18, -8, 15, 29, 3); this.bumps(6, 14, 10); }
    // A visible test wall, away from the normal acceleration strip.
    this.boxes.push({ min: new Vec3(-12, 0, -14), max: new Vec3(12, 1.5, -13) });
  }
  private triangle(a: Vec3, b: Vec3, c: Vec3) {
    let normal = b.clone().sub(a).cross(c.clone().sub(a)).unit();
    if (normal.y < 0) { [b, c] = [c, b]; normal = normal.scale(-1); }
    this.triangles.push({ a, b, c, normal });
  }
  private quad(x0: number, x1: number, z0: number, z1: number, h00: number, h10: number, h01: number, h11: number) {
    const a = new Vec3(x0, h00, z0), b = new Vec3(x1, h10, z0), c = new Vec3(x0, h01, z1), d = new Vec3(x1, h11, z1);
    this.triangle(a, c, b); this.triangle(b, c, d);
  }
  private ramp(x0: number, x1: number, z0: number, z1: number, height: number) {
    this.quad(x0, x1, z0, z1, 0, 0, height, height);
    this.quad(x0, x1, z1, z1 + 3, height, height, height, height);
  }
  private bumps(x0: number, x1: number, z: number) {
    const mid = (x0 + x1) / 2;
    for (let i = 0; i < 8; i++) {
      const start = z + i * 3, h = 0.16 + (i % 3) * 0.04;
      this.quad(x0, mid, start, start + 0.8, 0, 0, h, h);
      this.quad(x0, mid, start + 0.8, start + 1.6, h, h, 0, 0);
      this.quad(mid, x1, start + 0.8, start + 1.6, 0, 0, h, h);
      this.quad(mid, x1, start + 1.6, start + 2.4, h, h, 0, 0);
    }
  }
  raycast(origin: Vec3, direction: Vec3, maxDistance: number): RayHit | null {
    let nearest: RayHit | null = null;
    for (const t of this.triangles) {
      const edge1 = t.b.clone().sub(t.a), edge2 = t.c.clone().sub(t.a);
      const p = direction.cross(edge2), det = edge1.dot(p);
      if (Math.abs(det) < 1e-9) continue;
      const s = origin.clone().sub(t.a), u = s.dot(p) / det;
      if (u < -1e-8 || u > 1 + 1e-8) continue;
      const q = s.cross(edge1), v = direction.dot(q) / det;
      if (v < -1e-8 || u + v > 1 + 1e-8) continue;
      const distance = edge2.dot(q) / det;
      if (distance < 0 || distance > maxDistance || (nearest && nearest.distance <= distance)) continue;
      nearest = { distance, point: origin.clone().add(direction.clone().scale(distance)), normal: t.normal.clone() };
    }
    return nearest;
  }
  surface(x: number, z: number) { return this.raycast(new Vec3(x, 100, z), new Vec3(0, -1, 0), 200); }
}
