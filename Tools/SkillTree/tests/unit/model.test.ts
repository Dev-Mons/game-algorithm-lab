import { describe, expect, it } from 'vitest';
import { connect, createNode, createProject, deleteNode, demoProject, exportRows, History, nextId, parseProject, renameNode, validateProject } from '../../src/model';

describe('DataTable export contract', () => {
  it('round-trips Korean, coordinates, escaped strings, multi-parent links and custom data without editor metadata', () => {
    const project = demoProject();
    project.nodes[0].Description = '한글 "설명"\n다음 줄';
    project.nodes[0].X = -24.5;
    project.nodes[0].Icon = '/Game/UI/T_Icon.T_Icon';
    const rows = JSON.parse(exportRows(project));
    expect(rows).toHaveLength(project.nodes.length);
    expect(rows[0]).toEqual(project.nodes[0]);
    expect(rows[9].Prerequisites).toEqual(['Freeze', 'Chain']);
    expect(rows[0]).not.toHaveProperty('format');
    expect(parseProject(JSON.stringify(rows)).nodes).toEqual(project.nodes);
    expect(parseProject('\uFEFF' + JSON.stringify(project))).toEqual(project);
  });
  it('supports an empty project and deterministic output', () => {
    expect(exportRows(createProject())).toBe('[]');
    expect(exportRows(demoProject())).toBe(exportRows(demoProject()));
  });
});

describe('graph integrity', () => {
  it('renames inbound references and removes every affected edge when deleting', () => {
    const project = demoProject();
    renameNode(project, 'Freeze', 'IcePrison');
    expect(project.nodes.find(node => node.Name === 'Tempest')!.Prerequisites).toEqual(['IcePrison', 'Chain']);
    deleteNode(project, 'IcePrison');
    expect(project.nodes.find(node => node.Name === 'Tempest')!.Prerequisites).toEqual(['Chain']);
    expect(project.nodes.find(node => node.Name === 'Chill')!.Prerequisites).toEqual([]);
    validateProject(project);
  });
  it('rejects self links, duplicate links, dangling links and indirect cycles', () => {
    expect(() => connect(demoProject(), 'Flame', 'Flame')).toThrow('자기 자신');
    expect(() => connect(demoProject(), 'Mana', 'Flame')).toThrow('이미 연결');
    expect(() => connect(demoProject(), 'missing', 'Flame')).toThrow('찾을 수');
    expect(() => connect(demoProject(), 'Tempest', 'ArcaneRoot')).toThrow('순환');
  });
  it.each([
    ['case-insensitive duplicate', (p: ReturnType<typeof demoProject>) => { p.nodes[1].Name = 'arcaneroot'; }],
    ['reserved FName', (p: ReturnType<typeof demoProject>) => { p.nodes[0].Name = 'None'; }],
    ['infinite coordinate', (p: ReturnType<typeof demoProject>) => { p.nodes[0].X = Infinity; }],
    ['fractional cost', (p: ReturnType<typeof demoProject>) => { p.nodes[0].Cost = 1.5; }],
    ['overflowing int32', (p: ReturnType<typeof demoProject>) => { p.nodes[0].Cost = 2147483648; }],
    ['zero level', (p: ReturnType<typeof demoProject>) => { p.nodes[0].MaxLevel = 0; }],
    ['dangling link', (p: ReturnType<typeof demoProject>) => { p.nodes[0].Prerequisites = ['missing']; }],
    ['bad custom JSON', (p: ReturnType<typeof demoProject>) => { p.nodes[0].CustomData = '[1]'; }],
    ['duplicate tags', (p: ReturnType<typeof demoProject>) => { p.nodes[0].Tags = ['Fire', 'fire']; }],
  ])('rejects %s', (_label, breakProject) => {
    const project = demoProject(); breakProject(project);
    expect(() => validateProject(project)).toThrow();
  });
  it('does not silently discard unknown import fields or accept incomplete rows', () => {
    const project = demoProject();
    expect(() => parseProject(JSON.stringify([{ ...project.nodes[0], Damage: 50 }]))).toThrow('알 수 없는 필드');
    expect(() => parseProject('[{"Name":"OnlyId"}]')).toThrow();
    expect(() => parseProject('{"format":"skill-tree-studio","version":2}')).toThrow('버전');
    expect(() => parseProject('not json')).toThrow('올바른 JSON');
  });
});

describe('appearance compatibility', () => {
  it('migrates original project rows without losing coordinates or references', () => {
    const project = demoProject();
    const legacy = project.nodes.map(({ IconSymbol: _symbol, NodeShape: _shape, NodeSize: _size, NodeColor: _color, ...node }) => node);
    const migrated = parseProject(JSON.stringify(legacy));
    expect(migrated.nodes[1]).toMatchObject({ ...legacy[1], IconSymbol: 'machine-gun', NodeShape: 'Square', NodeSize: 36 });
    expect(JSON.parse(exportRows(migrated))[1].X).toBe(legacy[1].X);
  });
  it('round-trips custom shape, size, color and symbol and rejects unsafe style values', () => {
    const project = demoProject();
    Object.assign(project.nodes[0], { NodeShape: 'Diamond', NodeSize: 64, NodeColor: '#abcdef', IconSymbol: 'broadsword' });
    expect(parseProject(exportRows(project)).nodes).toEqual(project.nodes);
    project.nodes[0].NodeColor = 'red;display:none';
    expect(() => exportRows(project)).toThrow('색상');
    project.nodes[0].NodeColor = '#abcdef';
    project.nodes[0].NodeSize = -1;
    expect(() => exportRows(project)).toThrow('크기');
  });
});

describe('transactional editing', () => {
  it('keeps previous work after invalid changes, and supports undo/redo through project replacement', () => {
    const original = demoProject();
    const history = new History(original);
    const invalid = structuredClone(original);
    invalid.nodes[0].Prerequisites.push('Tempest');
    expect(() => history.commit(invalid)).toThrow('순환');
    expect(history.current).toEqual(original);
    expect(history.canUndo).toBe(false);
    history.commit(createProject());
    history.undo();
    expect(history.current).toEqual(original);
    history.redo();
    expect(history.current.nodes).toHaveLength(0);
    history.undo();
    const changed = structuredClone(history.current);
    changed.nodes.push(createNode(nextId(changed), 0, 0));
    history.commit(changed);
    expect(history.canRedo).toBe(false);
  });
  it('does not reuse IDs that differ only in case', () => {
    const project = createProject(); project.nodes.push(createNode('skill_001', 0, 0));
    expect(nextId(project)).toBe('Skill_002');
  });
});
