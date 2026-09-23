import type { Surface } from './analysis';
import type { VerticalBand, FacadeKind } from './building-style';
export interface FacadeTrace {
  styleId: string;
  styleVersion: number;
  level: VerticalBand;
  topBoundary: boolean;
  wallKind?: Surface['wallKind'];
  facade: FacadeKind;
  runId: string;
  patternId: string;
  moduleId: string;
  entranceSpan?: number;
  portalId?: string;
  portalRole?: string;
  portalAccess?: 'road' | 'local';
  rowRole?: string;
  phase?: number;
  groupId?: string;
  part?: 'single' | 'left' | 'middle' | 'right';
  alignment?: string;
  framePanelId?: string;
  reason: string;
  candidates: { id: string; reason: string; filler?: number }[];
}
export interface PatternRunBand {
  role: VerticalBand;
  patterns: string[];
  moduleSet: string[];
  align?: string;
}
