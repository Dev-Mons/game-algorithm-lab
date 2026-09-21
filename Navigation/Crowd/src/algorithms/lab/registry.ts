import type { PipelineFactory } from './pipeline';

export type PresetId = string;
/** Shared result metadata; algorithm-specific settings belong to its descriptor. */
export interface ExperimentOptions {
  destination: 'exit' | 'slots';
  [key: string]: string | number | boolean;
}
export interface ExperimentPreset {
  id: PresetId;
  name: string;
  description: string;
  limitations: string;
  options: ExperimentOptions;
  /** Omitted only for the built-in Legacy solver. */
  createPipeline?: PipelineFactory;
  supportsIndividualGoals?: boolean;
  validateOptions?: (options: ExperimentOptions) => void;
}
/** Selection, sequential comparisons and CLI measurements share this registry. */
export const PRESETS: readonly ExperimentPreset[] = [
  {
    id: 'legacy', name: 'Legacy · 방향별 유체 군중',
    description: '공유 Flow Field → 방향별 격자 수송·압력 → 잔여 접촉 → 벽 sweep.',
    limitations: '유한 반복의 접촉 근사를 사용합니다. 개별 목표 명령과 모듈 교체는 지원하지 않습니다.',
    options: { destination: 'exit' },
  },
];
export interface ResolvedExperiment { preset: ExperimentPreset; options: ExperimentOptions; }
export function resolveExperiment(config: { preset?: string; experiment?: Partial<ExperimentOptions> }): ResolvedExperiment {
  const preset = PRESETS.find(candidate => candidate.id === (config.preset ?? 'legacy'));
  if (!preset) throw new RangeError(`Unknown crowd preset: ${config.preset}`);
  if (!preset.createPipeline && preset.id !== 'legacy') throw new RangeError('A crowd preset must provide a pipeline factory.');
  if (config.experiment && Object.keys(config.experiment).length > 0 && !preset.validateOptions) {
    throw new RangeError(`${preset.name} does not support module overrides.`);
  }
  const options = { ...preset.options, ...config.experiment } as ExperimentOptions;
  if (options.destination !== 'exit' && options.destination !== 'slots') throw new RangeError('Invalid destination model.');
  preset.validateOptions?.(options);
  return { preset, options };
}
