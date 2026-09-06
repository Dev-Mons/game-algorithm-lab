import { sampleCurve, type Curve } from './math';
export interface VehicleConfig {
  mass: number; spring: number; damping: number; restLength: number; rollInfluence: number;
  rollInfluence40: number; rollInfluence80: number; rollInfluence160: number;
  frontGrip: number; rearGrip: number; slidingGrip: number; friction: number;
  friction40: number; friction80: number; friction160: number;
  engineForce: number; topSpeed: number; brakeForce: number; steerAngle: number;
  drive: 'fwd' | 'rwd' | 'awd'; drag: number; rolling: number;
}
export const defaultConfig: VehicleConfig = {
  mass: 900, spring: 28000, damping: 2800, restLength: 0.55, rollInfluence: 1,
  rollInfluence40: 1, rollInfluence80: 1, rollInfluence160: 1,
  frontGrip: 0.65, rearGrip: 0.62, slidingGrip: 0.3, friction: 1.15,
  friction40: 1.15, friction80: 1.15, friction160: 1.15,
  engineForce: 10000, topSpeed: 30, brakeForce: 16000, steerAngle: 30,
  drive: 'fwd', drag: 0.42, rolling: 170,
};
export const presets: Record<string, { name: string; description: string; values: Partial<VehicleConfig> }> = {
  minicar: { name: '미니카', description: '빠른 가속 · 속도별 기울기 · 목표 72 km/h', values: { mass: 600, drive: 'awd', engineForce: 20000, topSpeed: 20, friction: 1.8, friction40: 2, friction80: 2.2, friction160: 2.2, frontGrip: 0.85, rearGrip: 0.85, slidingGrip: 0.75, spring: 24000, damping: 2400, restLength: 0.45, rollInfluence: 1, rollInfluence40: 0.6, rollInfluence80: 0.3, rollInfluence160: 0.2, steerAngle: 24 } },
  balanced: { name: '밸런스', description: '안정적인 전륜구동 · 선명한 조향', values: {} },
  drift: { name: '드리프트', description: '후륜구동 · 완만한 슬립과 접지 회복', values: { drive: 'rwd', frontGrip: 0.55, rearGrip: 0.25, slidingGrip: 0.55, engineForce: 5500 } },
  ice: { name: '아이스', description: '낮은 노면 마찰 · 긴 제동거리', values: { friction: 0.18, frontGrip: 0.08, rearGrip: 0.08 } },
  bounce: { name: '바운시', description: '부드러운 스프링 · 낮은 감쇠', values: { spring: 18000, damping: 850, restLength: 0.68 } },
};
export function presetConfig(id: string): VehicleConfig { return validateConfig(presets[id]?.values ?? {}); }
export const FRICTION_POINTS = [
  { speed: 0, key: 'friction', max: 2 }, { speed: 20, key: 'friction', max: 2 },
  { speed: 40, key: 'friction40', max: 8 }, { speed: 80, key: 'friction80', max: 8 },
  { speed: 160, key: 'friction160', max: 8 },
] as const;
export function frictionCurve(config: VehicleConfig): Curve { return FRICTION_POINTS.map(p => [p.speed, config[p.key]]); }
/** Horizontal ground speed in m/s; curve knots are absolute km/h, independent of top speed. */
export function frictionAtSpeed(config: VehicleConfig, speed: number) { return sampleCurve(frictionCurve(config), Math.abs(speed) * 3.6); }
export const ROLL_POINTS = [
  { speed: 0, key: 'rollInfluence', max: 1 }, { speed: 20, key: 'rollInfluence', max: 1 },
  { speed: 40, key: 'rollInfluence40', max: 1 }, { speed: 80, key: 'rollInfluence80', max: 1 },
  { speed: 160, key: 'rollInfluence160', max: 1 },
] as const;
export function rollCurve(config: VehicleConfig): Curve { return ROLL_POINTS.map(p => [p.speed, config[p.key]]); }
export function rollAtSpeed(config: VehicleConfig, speed: number) { return sampleCurve(rollCurve(config), Math.abs(speed) * 3.6); }
export function gripCurve(config: VehicleConfig): Curve { return [[0, 1], [0.12, 1], [0.55, config.slidingGrip], [1, config.slidingGrip]]; }
export const powerCurve: Curve = [[0, 0.5], [0.35, 1], [0.65, 0.9], [1, 0]];
export const configBounds: Record<Exclude<keyof VehicleConfig, 'drive'>, readonly [number, number, number]> = {
  mass: [500, 1800, 50], spring: [12000, 60000, 1000], damping: [400, 6500, 50],
  restLength: [0.4, 0.8, 0.01], frontGrip: [0, 1, 0.01], rearGrip: [0, 1, 0.01],
  rollInfluence: [0, 1, 0.05],
  rollInfluence40: [0, 1, 0.05], rollInfluence80: [0, 1, 0.05], rollInfluence160: [0, 1, 0.05],
  slidingGrip: [0.05, 1, 0.01], friction: [0.1, 2, 0.05], engineForce: [2000, 20000, 500],
  friction40: [0.1, 8, 0.05], friction80: [0.1, 8, 0.05], friction160: [0.1, 8, 0.05],
  topSpeed: [10, 45, 1], brakeForce: [3000, 25000, 500], steerAngle: [10, 45, 1],
  drag: [0, 2, 0.01], rolling: [0, 500, 10],
};
export function validateConfig(value: unknown): VehicleConfig {
  if (!value || typeof value !== 'object') throw new Error('설정은 JSON 객체여야 합니다.');
  const config = { ...defaultConfig, ...value } as VehicleConfig;
  // Legacy JSON had a single coefficient. Preserve it as a flat curve rather
  // than silently adding grip at speed. Explicit knots override only their point.
  const provided = value as Partial<VehicleConfig>;
  for (const key of ['friction40', 'friction80', 'friction160'] as const) {
    if (!(key in provided)) config[key] = config.friction;
  }
  for (const key of ['rollInfluence40', 'rollInfluence80', 'rollInfluence160'] as const) {
    if (!(key in provided)) config[key] = config.rollInfluence;
  }
  for (const [key, [min, max]] of Object.entries(configBounds)) {
    const n = config[key as keyof VehicleConfig];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) throw new Error(`${key}: ${min}~${max} 범위를 확인하세요.`);
  }
  if (!['fwd', 'rwd', 'awd'].includes(config.drive)) throw new Error('구동 방식이 올바르지 않습니다.');
  return Object.fromEntries(Object.keys(defaultConfig).map(k => [k, config[k as keyof VehicleConfig]])) as unknown as VehicleConfig;
}
