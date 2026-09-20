export type PresetId = 'legacy' | 'B0' | 'B1' | 'R' | 'Q' | 'D';
export interface ExperimentOptions {
  planner: 'individual-astar' | 'shared-flow' | 'group-corridor';
  steering: 'seek' | 'boids' | 'formation';
  avoidance: 'none' | 'separation' | 'orca' | 'sampling';
  contact: 'none' | 'pbd';
  density: boolean;
  congestion: boolean;
  queue: boolean;
  destination: 'exit' | 'slots';
  maxNeighbors: number;
  contactIterations: number;
  timeHorizon: number;
  groupSize: number;
}
export interface ExperimentPreset {
  id: PresetId;
  name: string;
  description: string;
  limitations: string;
  options: ExperimentOptions;
}
const base: ExperimentOptions = {
  planner: 'individual-astar', steering: 'seek', avoidance: 'separation', contact: 'pbd',
  density: false, congestion: false, queue: false, destination: 'exit',
  maxNeighbors: 12, contactIterations: 4, timeHorizon: 1.5, groupSize: 32,
};
export const PRESETS: readonly ExperimentPreset[] = [
  { id: 'legacy', name: 'Legacy · 방향별 유체 군중', description: '기존 공유 field → 방향별 격자 수송 → 잔여 접촉 → 벽 sweep.',
    limitations: '기존 solver의 동작과 접촉 근사를 보존합니다. 모듈 교체는 B0–D에서 지원합니다.', options: { ...base, planner: 'shared-flow' } },
  { id: 'B0', name: 'B0 · 개별 Grid A*', description: '각 유닛의 8방향 A* 회랑 + Separation + PBD. 경로 공유 비용의 기준.',
    limitations: '명령마다 개별 탐색합니다. 큰 규모에서 경로 생성 비용이 큽니다.', options: { ...base } },
  { id: 'B1', name: 'B1 · 공유 Flow Field', description: '목표·반경별 역방향 Dijkstra field + B0와 같은 Separation·PBD.',
    limitations: '목표 수가 증가하면 field 메모리와 생성 비용이 증가합니다.', options: { ...base, planner: 'shared-flow' } },
  { id: 'R', name: 'R · RTS 회랑·대형', description: '소부대 공유 A* 회랑 + 가상 리더·안정 슬롯 + 원판 ORCA + PBD.',
    limitations: '격자 회랑이며 NavMesh funnel이 아닙니다. 슬롯은 공간이 있을 때만 할당됩니다.',
    options: { ...base, planner: 'group-corridor', steering: 'formation', avoidance: 'orca', destination: 'slots' } },
  { id: 'Q', name: 'Q · RTS + 통로 대기열', description: 'R에 통로 방향 배치·대기시간 우선권·실제 점유 해제 정책을 추가합니다.',
    limitations: '명시된 route gate에서 동작하는 실험 정책입니다. 전역 MAPF 보장이 아닙니다.',
    options: { ...base, planner: 'group-corridor', steering: 'formation', avoidance: 'orca', destination: 'slots', queue: true } },
  { id: 'D', name: 'D · 디펜스 밀도·유입 제어', description: '공유 field + 밀도 감속 + 저주기 혼잡 비용 + 통로 대기열 + PBD.',
    limitations: '전체 Continuum Crowds가 아닙니다. 연속체 비용과 개별 원판 접촉을 조합합니다.',
    options: { ...base, planner: 'shared-flow', density: true, congestion: true, queue: true } },
];
export interface ResolvedExperiment { preset: ExperimentPreset; options: ExperimentOptions; }
export function resolveExperiment(config: { preset?: string; experiment?: Partial<ExperimentOptions> }): ResolvedExperiment {
  const preset = PRESETS.find((candidate) => candidate.id === (config.preset ?? 'legacy'));
  if (!preset) throw new RangeError(`Unknown crowd preset: ${config.preset}`);
  if (preset.id === 'legacy' && config.experiment && Object.keys(config.experiment).length > 0) {
    throw new RangeError('Legacy preserves the original solver; select B0–D for module overrides.');
  }
  const options = { ...preset.options, ...config.experiment };
  const choices = {
    planner: ['individual-astar', 'shared-flow', 'group-corridor'], steering: ['seek', 'boids', 'formation'],
    avoidance: ['none', 'separation', 'orca', 'sampling'], contact: ['none', 'pbd'], destination: ['exit', 'slots'],
  } as const;
  for (const key of Object.keys(choices) as (keyof typeof choices)[]) {
    if (!(choices[key] as readonly string[]).includes(options[key])) throw new RangeError(`Invalid ${key}: ${options[key]}`);
  }
  for (const key of ['density', 'congestion', 'queue'] as const) {
    if (typeof options[key] !== 'boolean') throw new RangeError(`Invalid ${key}: expected a boolean.`);
  }
  if (options.congestion && options.planner !== 'shared-flow') throw new RangeError('Congestion costs require the shared-flow planner.');
  if (options.steering === 'formation' && options.planner !== 'group-corridor') throw new RangeError('Formation requires group-corridor navigation.');
  for (const key of ['maxNeighbors', 'contactIterations', 'groupSize'] as const) {
    if (!Number.isInteger(options[key]) || options[key] < 1 || options[key] > (key === 'groupSize' ? 512 : 64)) {
      throw new RangeError(`Invalid ${key}: ${options[key]}`);
    }
  }
  if (!Number.isFinite(options.timeHorizon) || options.timeHorizon < 0.05 || options.timeHorizon > 10) throw new RangeError('timeHorizon must be within 0.05–10 seconds.');
  return { preset, options };
}
