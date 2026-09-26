/** Engine-independent CPU reference entry point. No lab, browser, Node or seed runtime. */
export { CrowdKernel } from './crowd-kernel';
export { DEFAULT_CROWD_CONFIG } from './config';
export { parseCrowdRun, runCrowdReplay, applyCrowdCommand, snapshotCrowd } from './port-contract';
export type { CrowdRunInput, CrowdRunOutput, CrowdCommand, CrowdFrame } from './port-contract';
export type { CrowdInitialState, CrowdAgentInput } from './kernel-input';
export type { CrowdConfig, Vec2, Rect } from './types';
export type { ExternalInput } from './external-influences';
