import type { ScenarioDefinition } from '../../src/core/types';

/** User-exported 깔때기V2: regression geometry, not an app preset. */
export const FUNNEL_V2: ScenarioDefinition = {
  id: 'funnel-v2-regression', name: '깔때기V2', description: 'Displaced mixed-size crowd regression',
  spawn: { x: 0, y: 0, width: 240, height: 636 },
  goal: { x: 1151.4084507042253, y: 670.1408450704225 },
  obstacles: [
    { x: 240, y: 48, width: 60, height: 144 },
    { x: 384, y: 432, width: 144, height: 288 },
    { x: 384, y: 120, width: 336, height: 240 },
    { x: 528, y: 408, width: 192, height: 60 },
    { x: 792, y: 0, width: 72, height: 672 },
    { x: 936, y: 120, width: 48, height: 600 },
    { x: 240, y: 300, width: 60, height: 252 },
  ],
};
