import { categoryColor, categorySymbol } from './appearance';
import { effectDefaults, validateTemplate, type EffectDefinition } from './effects';
import { effectTargets, type EffectTarget } from './effect-settings';

export interface SkillNode extends EffectDefinition {
  Name: string;
  SkillId?: string;
  DisplayName: string;
  Description: string;
  X: number;
  Y: number;
  Category: string;
  Icon: string;
  IconSymbol: string;
  NodeShape: 'Square' | 'Diamond' | 'Circle';
  NodeSize: number;
  NodeColor: string;
  Cost: number;
  MaxLevel: number;
  Prerequisites: string[];
  Tags: string[];
  CustomData: string;
  // Placement-level unlock rules. Omitted fields use unlockDefaults and are not part of the legacy single-table row.
  PrerequisiteMode?: 'All' | 'Any';
  RequiredParentRank?: number;
  RequiredTreePoints?: number;
}
export type SkillPreset = Omit<SkillNode, 'SkillId' | 'X' | 'Y' | 'Prerequisites' | UnlockKey>;
type UnlockKey = typeof unlockKeys[number];
export type UnlockRule = Required<Pick<SkillNode, UnlockKey>>;
export interface UnrealExportSettings { treeId: string; contentPath: string }

export interface Project {
  format: 'skill-tree-studio';
  version: 1;
  title: string;
  nodes: SkillNode[];
  presets?: SkillPreset[];
  effectTargets?: EffectTarget[];
  unreal?: UnrealExportSettings;
}

export const DEFAULT_SIZE = 36;
export const GRID = 24;
const MAX_NODES = 2000;
const effectKeys = ['StatId', 'ModifierOp', 'ValuePerRank', 'DescriptionTemplate', 'MaxDescriptionTemplate'] as const;
const unlockKeys = ['PrerequisiteMode', 'RequiredParentRank', 'RequiredTreePoints'] as const;
export const unlockDefaults: UnlockRule = { PrerequisiteMode: 'All', RequiredParentRank: 1, RequiredTreePoints: 0 };
export const unrealIdPattern = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
export const contentPathPattern = /^\/Game(?:\/[A-Za-z0-9_]+)*$/;
const keys = ['Name', 'SkillId', 'DisplayName', 'Description', 'X', 'Y', 'Category', 'Icon', 'IconSymbol', 'NodeShape', 'NodeSize', 'NodeColor', 'Cost', 'MaxLevel', 'Prerequisites', 'Tags', 'CustomData', ...effectKeys];
export const presetFields = ['DisplayName', 'Description', 'Category', 'Icon', 'IconSymbol', 'NodeShape', 'NodeSize', 'NodeColor', 'Cost', 'MaxLevel', 'Tags', 'CustomData', ...effectKeys] as const;

export function createNode(name: string, x: number, y: number): SkillNode {
  return { ...effectDefaults(), Name: name, DisplayName: '새 스킬', Description: '', X: x, Y: y,
    Category: '기본', Icon: '', IconSymbol: 'machine-gun', NodeShape: 'Square', NodeSize: DEFAULT_SIZE, NodeColor: '#d8c089',
    Cost: 1, MaxLevel: 1, Prerequisites: [], Tags: [], CustomData: '{}' };
}

export function createProject(title = '새 스킬 트리'): Project {
  return { format: 'skill-tree-studio', version: 1, title, nodes: [] };
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Validate both JSON imports and editor mutations at the same boundary.
export function validateProject(value: unknown): asserts value is Project {
  if (!object(value) || value.format !== 'skill-tree-studio' || value.version !== 1)
    throw new Error('지원하지 않는 프로젝트 형식 또는 버전입니다.');
  if (typeof value.title !== 'string' || !value.title.trim()) throw new Error('프로젝트 이름을 입력하세요.');
  if (!Array.isArray(value.nodes) || value.nodes.length > MAX_NODES) throw new Error(`노드는 최대 ${MAX_NODES}개까지 지원합니다.`);
  const ids = new Set<string>();
  for (const raw of value.nodes) {
    if (!object(raw)) throw new Error('노드 데이터가 객체가 아닙니다.');
    const extra = Object.keys(raw).filter(key => !keys.includes(key) && !(unlockKeys as readonly string[]).includes(key));
    if (extra.length) throw new Error(`알 수 없는 필드: ${extra.join(', ')}. 추가 정보는 CustomData를 사용하세요.`);
    for (const key of ['Name', 'DisplayName', 'Description', 'Category', 'Icon', 'IconSymbol', 'NodeShape', 'NodeColor', 'CustomData']) {
      if (typeof raw[key] !== 'string') throw new Error(`${key} 필드는 문자열이어야 합니다.`);
    }
    const id = raw.Name as string;
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(id) || id.toLowerCase() === 'none')
      throw new Error('노드 ID는 영문/밑줄로 시작하는 1~64자 영문·숫자·밑줄이어야 합니다. None은 사용할 수 없습니다.');
    if (ids.has(id.toLowerCase())) throw new Error(`중복 노드 ID: ${id} (대소문자 구분 없음)`);
    ids.add(id.toLowerCase());
    if (raw.SkillId !== undefined && (typeof raw.SkillId !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(raw.SkillId) || raw.SkillId.toLowerCase() === 'none')) throw new Error(`${id}: 잘못된 스킬 프리셋 ID입니다.`);
    if (!(raw.DisplayName as string).trim()) throw new Error(`${id}: 표시 이름을 입력하세요.`);
    if (typeof raw.StatId !== 'string' || (raw.StatId !== '' && (!/^[A-Za-z][A-Za-z0-9_.]{0,127}$/.test(raw.StatId) || raw.StatId.toLowerCase() === 'none'))) throw new Error(`${id}: 효과 대상은 MachineGun.Damage 같은 영문 ID여야 합니다.`);
    if (!['Add', 'AddPercent'].includes(raw.ModifierOp as string)) throw new Error(`${id}: 지원하지 않는 적용 방식입니다.`);
    if (typeof raw.ValuePerRank !== 'number' || !Number.isFinite(raw.ValuePerRank) || Math.abs(raw.ValuePerRank) > 1_000_000) throw new Error(`${id}: 1회 증가량은 ±1,000,000 이내의 숫자여야 합니다.`);
    for (const field of ['DescriptionTemplate', 'MaxDescriptionTemplate']) {
      if (typeof raw[field] !== 'string') throw new Error(`${id}: 설명 템플릿은 문자열이어야 합니다.`);
      validateTemplate(raw[field] as string);
    }
    if (!['Square', 'Diamond', 'Circle'].includes(raw.NodeShape as string)) throw new Error(`${id}: 지원하지 않는 노드 모양입니다.`);
    if (!Number.isInteger(raw.NodeSize) || (raw.NodeSize as number) < 24 || (raw.NodeSize as number) > 96) throw new Error(`${id}: 노드 크기는 24~96 정수여야 합니다.`);
    if (!/^#[0-9a-fA-F]{6}$/.test(raw.NodeColor as string)) throw new Error(`${id}: 노드 색상은 #RRGGBB 형식이어야 합니다.`);
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(raw.IconSymbol as string)) throw new Error(`${id}: 아이콘 심볼 ID가 올바르지 않습니다.`);
    for (const key of ['X', 'Y']) {
      if (typeof raw[key] !== 'number' || !Number.isFinite(raw[key]) || Math.abs(raw[key]) > 1_000_000)
        throw new Error(`${id}: ${key} 좌표는 ±1,000,000 이내의 유한한 숫자여야 합니다.`);
    }
    for (const key of ['Cost', 'MaxLevel']) {
      if (!Number.isInteger(raw[key]) || (raw[key] as number) < (key === 'Cost' ? 0 : 1) || (raw[key] as number) > 2147483647)
        throw new Error(`${id}: ${key}는 ${key === 'Cost' ? 0 : 1} 이상의 int32 정수여야 합니다.`);
    }
    for (const key of ['Prerequisites', 'Tags']) {
      const entries = raw[key];
      if (!Array.isArray(entries) || entries.some(entry => typeof entry !== 'string' || !entry.trim()))
        throw new Error(`${id}: ${key}는 비어 있지 않은 문자열 배열이어야 합니다.`);
      if (new Set(entries.map(entry => entry.toLowerCase())).size !== entries.length)
        throw new Error(`${id}: ${key}에 중복 값이 있습니다.`);
    }
    if (raw.PrerequisiteMode !== undefined && raw.PrerequisiteMode !== 'All' && raw.PrerequisiteMode !== 'Any') throw new Error(`${id}: 선행 조건 방식은 All 또는 Any여야 합니다.`);
    for (const [key, min] of [['RequiredParentRank', 1], ['RequiredTreePoints', 0]] as const) {
      if (raw[key] !== undefined && (!Number.isInteger(raw[key]) || (raw[key] as number) < min || (raw[key] as number) > 2147483647))
        throw new Error(`${id}: ${key}는 ${min} 이상의 int32 정수여야 합니다.`);
    }
    try {
      if (!object(JSON.parse(raw.CustomData as string))) throw new Error();
    } catch { throw new Error(`${id}: 추가 데이터는 JSON 객체여야 합니다. 예: {"Damage": 10}`); }
  }
  const nodes = value.nodes as unknown as SkillNode[];
  const exactIds = new Set(nodes.map(node => node.Name));
  const degree = new Map(nodes.map(node => [node.Name, node.Prerequisites.length]));
  const children = new Map(nodes.map(node => [node.Name, [] as string[]]));
  for (const node of nodes) {
    for (const parent of node.Prerequisites) {
      if (!exactIds.has(parent)) throw new Error(`${node.Name}: 선행 노드 ${parent}를 찾을 수 없습니다. ID의 대소문자도 확인하세요.`);
      if (parent === node.Name) throw new Error('자기 자신을 선행 노드로 연결할 수 없습니다.');
      children.get(parent)!.push(node.Name);
    }
  }
  const queue = nodes.filter(node => !node.Prerequisites.length).map(node => node.Name);
  for (let i = 0; i < queue.length; i++) {
    for (const child of children.get(queue[i])!) {
      degree.set(child, degree.get(child)! - 1);
      if (degree.get(child) === 0) queue.push(child);
    }
  }
  if (queue.length !== nodes.length) throw new Error('순환 연결은 만들 수 없습니다. 선행 스킬 경로가 다시 자신으로 돌아옵니다.');
  if (value.presets !== undefined) {
    if (!Array.isArray(value.presets) || value.presets.length > MAX_NODES) throw new Error('프리셋 목록이 올바르지 않습니다.');
    const allowed = ['Name', ...presetFields];
    for (const preset of value.presets) {
      if (!object(preset) || Object.keys(preset).some(key => !allowed.includes(key as typeof allowed[number]))) throw new Error('프리셋에 알 수 없는 필드가 있습니다.');
    }
    validateProject({ ...createProject(), nodes: value.presets.map(preset => ({ ...preset, X: 0, Y: 0, Prerequisites: [] })) });
    const presets = new Map((value.presets as SkillPreset[]).map(preset => [preset.Name, preset]));
    for (const node of nodes) {
      const preset = presets.get(node.SkillId ?? '');
      if (!preset) throw new Error(`${node.Name}: 스킬 프리셋 ${node.SkillId ?? '(없음)'}를 찾을 수 없습니다.`);
      for (const key of presetFields) if (JSON.stringify(node[key]) !== JSON.stringify(preset[key])) throw new Error(`${node.Name}: ${key}가 프리셋과 다릅니다. 공통 속성은 프리셋에서 수정하세요.`);
    }
  }
  if (value.unreal !== undefined) {
    const unreal = value.unreal;
    if (!object(unreal) || Object.keys(unreal).some(key => key !== 'treeId' && key !== 'contentPath')) throw new Error('언리얼 내보내기 설정이 올바르지 않습니다.');
    validateUnrealSettings(unreal as unknown as UnrealExportSettings);
  }
  if (value.effectTargets !== undefined) {
    if (!Array.isArray(value.effectTargets) || value.effectTargets.length > MAX_NODES) throw new Error('효과 대상은 최대 2,000개까지 등록할 수 있습니다.');
    const targetIds = new Set<string>();
    for (const target of value.effectTargets) {
      if (!object(target) || Object.keys(target).some(key => key !== 'id' && key !== 'label') || typeof target.id !== 'string'
        || !/^[A-Za-z][A-Za-z0-9_.]{0,127}$/.test(target.id) || target.id.toLowerCase() === 'none') throw new Error('효과 대상 ID가 올바르지 않습니다.');
      // Accept legacy labels only on input; withLibrary discards them without changing IDs.
      if (target.label !== undefined && typeof target.label !== 'string') throw new Error('이전 효과 대상 이름이 올바르지 않습니다.');
      if (targetIds.has(target.id.toLowerCase())) throw new Error('효과 태그 ID가 중복됩니다.');
      targetIds.add(target.id.toLowerCase());
    }
    for (const item of [...nodes, ...((value.presets ?? []) as SkillPreset[])]) {
      if (item.StatId && !targetIds.has(item.StatId.toLowerCase())) throw new Error(`${item.Name}: 등록되지 않은 효과 대상 ${item.StatId}입니다.`);
    }
  }
}

export function validateUnrealSettings(settings: UnrealExportSettings) {
  if (typeof settings.treeId !== 'string' || !unrealIdPattern.test(settings.treeId) || settings.treeId.toLowerCase() === 'none')
    throw new Error('트리 ID는 영문/밑줄로 시작하는 1~64자 영문·숫자·밑줄이어야 합니다. 예: MachineGun');
  if (typeof settings.contentPath !== 'string' || !contentPathPattern.test(settings.contentPath) || settings.contentPath.length > 200)
    throw new Error('콘텐츠 폴더는 /Game으로 시작하는 영문·숫자·밑줄 경로여야 합니다. 예: /Game/SkillTree/Data');
}

export function unrealSettings(project: Project): UnrealExportSettings {
  return project.unreal ?? { treeId: 'SkillTree', contentPath: '/Game/SkillTree/Data' };
}

export function unlockRule(node: SkillNode): UnlockRule {
  return { PrerequisiteMode: node.PrerequisiteMode ?? unlockDefaults.PrerequisiteMode,
    RequiredParentRank: node.RequiredParentRank ?? unlockDefaults.RequiredParentRank,
    RequiredTreePoints: node.RequiredTreePoints ?? unlockDefaults.RequiredTreePoints };
}

// Default values are omitted so untouched placements keep their previous project JSON.
export function setUnlockRule(node: SkillNode, rule: UnlockRule) {
  for (const key of unlockKeys) {
    if (rule[key] === unlockDefaults[key]) delete node[key];
    else Object.assign(node, { [key]: rule[key] });
  }
}

export function presetFromNode(node: SkillNode, id = node.SkillId ?? node.Name): SkillPreset {
  return { Name: id, ...Object.fromEntries(presetFields.map(key => [key, structuredClone(node[key])])) } as SkillPreset;
}

// Legacy rows gain one definition per ID; exported shared IDs restore their grouping.
export function withLibrary(source: Project): Project {
  validateProject(source);
  const project = structuredClone(source);
  if (!project.effectTargets) {
    project.effectTargets = effectTargets.map(target => ({ ...target }));
    const ids = new Set(project.effectTargets.map(target => target.id.toLowerCase()));
    for (const item of [...project.nodes, ...(project.presets ?? [])]) {
      if (item.StatId && !ids.has(item.StatId.toLowerCase())) {
        project.effectTargets.push({ id: item.StatId });
        ids.add(item.StatId.toLowerCase());
      }
    }
  }
  project.effectTargets = project.effectTargets.map(target => ({ id: target.id }));
  if (project.presets) { validateProject(project); return project; }
  project.presets = [];
  for (const node of project.nodes) {
    node.SkillId ??= node.Name;
    const preset = presetFromNode(node);
    const existing = project.presets.find(item => item.Name === preset.Name);
    if (existing && JSON.stringify(existing) !== JSON.stringify(preset)) throw new Error(`${preset.Name}: 같은 스킬 ID에 서로 다른 속성이 있습니다.`);
    if (!existing) project.presets.push(preset);
  }
  validateProject(project);
  return project;
}

export function updatePreset(project: Project, previousId: string, preset: SkillPreset) {
  const index = project.presets?.findIndex(item => item.Name === previousId) ?? -1;
  if (index < 0) throw new Error('프리셋을 찾을 수 없습니다.');
  project.presets![index] = structuredClone(preset);
  for (const node of project.nodes) if (node.SkillId === previousId) {
    Object.assign(node, structuredClone(preset), { Name: node.Name, SkillId: preset.Name });
  }
}

export function setNodePreset(project: Project, node: SkillNode, presetId: string) {
  const preset = project.presets?.find(item => item.Name === presetId);
  if (!preset) throw new Error('배치할 스킬 프리셋을 선택하세요.');
  Object.assign(node, structuredClone(preset), { Name: node.Name, SkillId: preset.Name });
}

export function placePreset(project: Project, presetId: string, x: number, y: number): string {
  const ids = new Set(project.nodes.map(node => node.Name.toLowerCase()));
  let id = presetId;
  let suffix = 2;
  while (ids.has(id.toLowerCase())) id = `${presetId.slice(0, 54)}_${suffix++}`;
  const node = createNode(id, x, y);
  setNodePreset(project, node, presetId);
  project.nodes.push(node);
  return id;
}

export function deletePreset(project: Project, id: string) {
  if (project.nodes.some(node => node.SkillId === id)) throw new Error('배치 중인 프리셋입니다. 배치 노드를 삭제하거나 다른 프리셋으로 바꾼 뒤 삭제하세요.');
  project.presets = project.presets?.filter(preset => preset.Name !== id);
}

export function parseProject(text: string): Project {
  let value: unknown;
  try { value = JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch { throw new Error('올바른 JSON 파일이 아닙니다.'); }
  if (Array.isArray(value)) value = { ...createProject('가져온 스킬 트리'), nodes: value };
  // Additive migration: old projects keep coordinates, IDs and every existing field.
  if (object(value) && Array.isArray(value.nodes)) {
    const migrateEffect = (raw: Record<string, unknown>) => ({ ...effectDefaults(String(raw.SkillId ?? raw.Name ?? '')), ...raw });
    value.nodes = value.nodes.map(raw => {
      if (!object(raw)) return raw;
      const category = typeof raw.Category === 'string' ? raw.Category : '';
      return { IconSymbol: categorySymbol(category), NodeShape: 'Square', NodeSize: DEFAULT_SIZE, NodeColor: categoryColor(category), ...migrateEffect(raw) };
    });
    if (Array.isArray(value.presets)) value.presets = value.presets.map(preset => object(preset) ? migrateEffect(preset) : preset);
  }
  validateProject(value);
  return structuredClone(value);
}

export function exportRows(project: Project): string {
  validateProject(project);
  // Deliberately emit only the DataTable row fields, without editor metadata.
  return JSON.stringify(project.nodes.map(node => Object.fromEntries(keys.map(key => [key, node[key as keyof SkillNode]]))), null, 2);
}

export function renameNode(project: Project, oldName: string, name: string): void {
  const node = project.nodes.find(item => item.Name === oldName);
  if (!node) throw new Error('선택한 노드를 찾을 수 없습니다.');
  node.Name = name;
  for (const item of project.nodes) item.Prerequisites = item.Prerequisites.map(id => id === oldName ? name : id);
}

export function deleteNode(project: Project, name: string): void {
  project.nodes = project.nodes.filter(node => node.Name !== name);
  for (const node of project.nodes) node.Prerequisites = node.Prerequisites.filter(id => id !== name);
}

export function connect(project: Project, from: string, to: string): void {
  const node = project.nodes.find(item => item.Name === to);
  if (!node || !project.nodes.some(item => item.Name === from)) throw new Error('연결할 노드를 찾을 수 없습니다.');
  if (node.Prerequisites.includes(from)) throw new Error('이미 연결된 노드입니다.');
  node.Prerequisites.push(from);
  validateProject(project);
}

export function nextId(project: Project): string {
  const ids = new Set(project.nodes.map(node => node.Name.toLowerCase()));
  let index = 1;
  while (ids.has(`skill_${String(index).padStart(3, '0')}`)) index++;
  return `Skill_${String(index).padStart(3, '0')}`;
}

export class History {
  private past: Project[] = [];
  private future: Project[] = [];
  constructor(public current: Project) { validateProject(current); }
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  commit(next: Project): boolean {
    validateProject(next);
    if (JSON.stringify(next) === JSON.stringify(this.current)) return false;
    this.past.push(structuredClone(this.current));
    if (this.past.length > 100) this.past.shift();
    this.current = structuredClone(next);
    this.future = [];
    return true;
  }
  undo() {
    if (!this.canUndo) return;
    this.future.push(this.current);
    this.current = this.past.pop()!;
  }
  redo() {
    if (!this.canRedo) return;
    this.past.push(this.current);
    this.current = this.future.pop()!;
  }
}

export function machineGunProject(): Project {
  const project = createProject('머신건 스킬 트리');
  project.unreal = { treeId: 'MachineGun', contentPath: '/Game/SkillTree/Data' };
  const definitions: [string, string, string, number, number, number, string[]][] = [
    ['MachineGunDamage', '머신건 공격력 증가', 'machine-gun', 0, 120, 5, []],
    ['MachineGunFireRate', '머신건 발사 속도 증가', 'machine-gun-magazine', 192, 24, 5, ['MachineGunDamage']],
    ['MachineGunRange', '머신건 사거리 증가', 'crosshair', 192, 216, 3, ['MachineGunDamage']],
    ['MachineGunPierce', '머신건 관통', 'supersonic-bullet', 384, 120, 1, ['MachineGunFireRate', 'MachineGunRange']],
  ];
  const descriptions: Record<string, string> = {
    MachineGunDamage: '머신건 탄환이 적에게 주는 피해를 증가시킵니다.',
    MachineGunFireRate: '머신건의 초당 발사 횟수를 증가시킵니다.',
    MachineGunRange: '머신건 탄환이 도달하는 최대 거리를 증가시킵니다.',
    MachineGunPierce: '머신건 탄환이 적을 관통하도록 강화합니다.',
  };
  project.nodes = definitions.map(([id, name, symbol, x, y, limit, parents]) => ({
    ...createNode(id, x, y), ...effectDefaults(id), DisplayName: name, Description: descriptions[id],
    Category: '머신건', IconSymbol: symbol, NodeSize: 48, NodeColor: '#d3b579',
    NodeShape: id === 'MachineGunPierce' ? 'Diamond' : 'Square',
    MaxLevel: limit, Prerequisites: parents, Tags: ['Weapon', 'MachineGun'],
  }));
  return project;
}

export function demoProject(): Project {
  const project = createProject('아케인 아틀라스');
  project.unreal = { treeId: 'ArcaneAtlas', contentPath: '/Game/SkillTree/Data' };
  const definitions: [string, string, string, number, number, string[], number][] = [
    ['ArcaneRoot', '마력의 근원', '기본', 0, 0, [], 1],
    ['Flame', '화염구', '화염', 144, -144, ['Mana'], 3],
    ['Frost', '얼음 화살', '냉기', -144, 144, ['Renew'], 3],
    ['Spark', '번개 줄기', '번개', 144, 144, ['ArcaneRoot'], 3],
    ['Burn', '타오르는 잔재', '화염', 288, -144, ['Flame'], 5],
    ['Freeze', '서리 감옥', '냉기', -288, 144, ['Frost'], 5],
    ['Chain', '연쇄 번개', '번개', 288, 144, ['Spark'], 5],
    ['Meteor', '유성 낙하', '화염', 432, -288, ['Blaze'], 1],
    ['Blizzard', '영원의 겨울', '냉기', -432, 288, ['Chill'], 1],
    ['Tempest', '원소의 폭풍', '번개', 0, 288, ['Freeze', 'Chain'], 1],
  ];
  project.nodes = definitions.map(([id, label, category, x, y, parents, level], index) => ({
    ...createNode(id, x, y), DisplayName: label, Category: category, MaxLevel: level,
    Description: index === 0 ? '모든 원소 마법의 시작점입니다. 마력의 흐름을 이해하고 새로운 능력을 해금합니다.' : `${label} 능력을 해금합니다. 선행 스킬을 습득한 뒤 포인트를 사용해 강화할 수 있습니다.`,
    Prerequisites: parents, Cost: index > 6 ? 3 : 1, Tags: ['Magic', category],
    CustomData: index === 0 ? '{"ManaBonus": 10}' : '{"Damage": 20, "Cooldown": 3}',
  }));
  // Center-based authoring here; exported coordinates always remain top-left.
  const extra: [string, string, string, number, number, string, string][] = [
    ['Ember', '불씨', '화염', 216, -216, 'Flame', 'burning-embers'],
    ['Ignite', '점화', '화염', 288, -288, 'Ember', 'flame'],
    ['Inferno', '지옥불', '화염', 360, -288, 'Ignite', 'fireball'],
    ['Blaze', '폭발', '화염', 360, -216, 'Burn', 'meteor-impact'],
    ['Ash', '잿빛 장막', '화염', 432, -144, 'Blaze', 'burning-embers'],
    ['FireWard', '화염 보호', '화염', 360, -72, 'Burn', 'shield'],
    ['Phoenix', '불사조', '화염', 432, 0, 'FireWard', 'crown'],
    ['Focus', '원소 집중', '화염', 216, -72, 'Flame', 'spell-book'],
    ['Mana', '마력 증폭', '기본', 72, -72, 'ArcaneRoot', 'sparkles'],
    ['Study', '마법 연구', '기본', 0, -144, 'Mana', 'book-aura'],
    ['Rune', '고대의 룬', '기본', 72, -216, 'Study', 'rune-stone'],
    ['Wizard', '대마법사', '기본', 144, -288, 'Rune', 'wizard-staff'],
    ['Sword', '검술', '전투', -144, -144, 'ArcaneRoot', 'broadsword'],
    ['Strike', '강타', '전투', -216, -216, 'Sword', 'sword-wound'],
    ['Duel', '쌍검술', '전투', -288, -288, 'Strike', 'crossed-swords'],
    ['Cleave', '휩쓸기', '전투', -360, -288, 'Duel', 'broadsword'],
    ['Champion', '무기 달인', '전투', -432, -288, 'Cleave', 'crown'],
    ['Guard', '방어술', '전투', -288, -144, 'Sword', 'shield'],
    ['Armor', '중갑 숙련', '전투', -360, -216, 'Guard', 'heavy-helm'],
    ['Fortress', '불굴의 수호자', '전투', -432, -144, 'Armor', 'shield'],
    ['Bow', '궁술', '전투', -216, -72, 'Sword', 'bow-arrow'],
    ['Aim', '정밀 조준', '전투', -288, 0, 'Bow', 'archer'],
    ['Pierce', '관통 사격', '전투', -360, 0, 'Aim', 'sword-wound'],
    ['Hunt', '사냥의 달인', '전투', -432, 0, 'Pierce', 'bow-arrow'],
    ['IceShard', '얼음 파편', '냉기', -216, 216, 'Frost', 'ice-bolt'],
    ['Permafrost', '영구 동토', '냉기', -288, 288, 'IceShard', 'snowflake-1'],
    ['Avalanche', '눈사태', '냉기', -360, 288, 'Permafrost', 'snowflake-2'],
    ['IceWard', '얼음 방벽', '냉기', -360, 144, 'Freeze', 'shield'],
    ['Glacier', '빙하의 심장', '냉기', -432, 144, 'IceWard', 'crystal-growth'],
    ['Chill', '냉기 확산', '냉기', -360, 216, 'Freeze', 'snowflake-1'],
    ['Charge', '전하', '번개', 216, 216, 'Spark', 'lightning-bow'],
    ['Storm', '폭풍의 눈', '번개', 288, 288, 'Charge', 'whirlwind'],
    ['Thunder', '천둥', '번개', 360, 288, 'Storm', 'lightning-branches'],
    ['Overload', '과부하', '번개', 432, 288, 'Thunder', 'sparkles'],
    ['Haste', '가속', '번개', 360, 144, 'Chain', 'sprint'],
    ['Flash', '섬광', '번개', 432, 144, 'Haste', 'lightning-bow'],
    ['Renew', '재생', '생명', -72, 72, 'ArcaneRoot', 'heart-plus'],
    ['Alchemy', '연금술', '생명', 0, 144, 'Renew', 'potion-ball'],
    ['Craft', '제작 숙련', '제작', 72, 216, 'Alchemy', 'anvil'],
    ['Amulet', '마력 주입', '제작', 144, 288, 'Craft', 'gem-pendant'],
    ['Vitality', '생명력', '생명', -72, 216, 'Alchemy', 'heart-plus'],
    ['Restoration', '생명의 축복', '생명', -144, 288, 'Vitality', 'potion-ball'],
  ];
  for (const [id, label, category, x, y, parent, symbol] of extra) {
    project.nodes.push({ ...createNode(id, x, y), DisplayName: label, Category: category, IconSymbol: symbol,
      Description: `${label} 능력을 강화합니다.`, Prerequisites: [parent], MaxLevel: 3 });
  }
  const firstSymbols = ['crystal-ball', 'fireball', 'ice-bolt', 'lightning-branches', 'burning-embers', 'snowflake-2', 'lightning-bow', 'meteor-impact', 'snowflake-1', 'whirlwind'];
  const keystones = ['ArcaneRoot', 'Sword', 'Flame', 'Frost', 'Spark', 'Meteor', 'Blizzard', 'Tempest', 'Champion', 'Phoenix', 'Overload'];
  project.nodes.forEach((node, index) => {
    if (index < firstSymbols.length) node.IconSymbol = firstSymbols[index];
    node.NodeColor = categoryColor(node.Category);
    if (keystones.includes(node.Name)) { node.NodeSize = node.Name === 'ArcaneRoot' ? 56 : 48; node.NodeShape = node.Name === 'ArcaneRoot' ? 'Circle' : 'Diamond'; }
    node.X -= node.NodeSize / 2; node.Y -= node.NodeSize / 2;
  });
  return project;
}
