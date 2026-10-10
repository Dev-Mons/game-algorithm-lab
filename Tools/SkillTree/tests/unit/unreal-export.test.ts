import { expect, it } from 'vitest';
import { crc32 as zlibCrc32 } from 'node:zlib';
import { buildUnrealTables, crc32, csvFile, nodeDepths, packageFiles, tableToCsv, tableToJson, zip } from '../../src/unreal-export';
import { demoProject, exportRows, machineGunProject, parseProject, setUnlockRule, unlockDefaults, validateProject, withLibrary } from '../../src/model';

function tables(project = withLibrary(machineGunProject()), includeUnplaced = false) {
  return Object.fromEntries(buildUnrealTables(project, { includeUnplaced }).map(table => [table.kind, table]));
}

it('splits shared definitions from placements and keys them by SkillId and NodeId', () => {
  const project = withLibrary(machineGunProject());
  project.nodes.push({ ...structuredClone(project.nodes[0]), Name: 'MachineGunDamage_2', X: 600, Y: 0, Prerequisites: ['MachineGunPierce'] });
  const { Skills, Nodes, Tree } = tables(project);
  expect(Skills.asset).toBe('DT_MachineGun_Skills');
  expect(Skills.rows.map(row => row.Name)).toEqual(['MachineGunDamage', 'MachineGunFireRate', 'MachineGunRange', 'MachineGunPierce']);
  expect(Skills.rows[0]).toMatchObject({ MaxRank: 5, CostPerRank: 1, Shape: 'Square', Size: 48, Color: { R: 0xd3, G: 0xb5, B: 0x79, A: 255 },
    Effects: [{ StatId: 'MachineGun.Damage', ModifierOp: 'Add', ValuePerRank: 1 }], Tags: ['Weapon', 'MachineGun'] });
  expect(Skills.rows[0]).not.toHaveProperty('Position');
  expect(Nodes.rows.at(-1)).toEqual({ Name: 'MachineGunDamage_2', SkillId: 'MachineGunDamage', Position: { X: 600, Y: 0 },
    Prerequisites: ['MachineGunPierce'], PrerequisiteMode: 'All', RequiredParentRank: 1, RequiredTreePoints: 0, Depth: 3 });
  expect(Tree.rows[0]).toMatchObject({ Name: 'MachineGun', DisplayName: '머신건 스킬 트리', CanvasMin: { X: 0, Y: 0 }, CanvasSize: { X: 648, Y: 264 },
    RootNodes: ['MachineGunDamage'], SkillTable: '/Game/SkillTree/Data/DT_MachineGun_Skills.DT_MachineGun_Skills' });
});

it('exports unplaced presets only on request and an empty effect list for effectless skills', () => {
  const project = withLibrary(machineGunProject());
  project.presets!.push({ ...project.presets![0], Name: 'Unused', StatId: '', ValuePerRank: 0, DescriptionTemplate: '', MaxDescriptionTemplate: '' });
  expect(tables(project).Skills.rows.some(row => row.Name === 'Unused')).toBe(false);
  expect(tables(project, true).Skills.rows.find(row => row.Name === 'Unused')!.Effects).toEqual([]);
});

it('writes unlock rules and keeps default rules out of the editor project', () => {
  const project = withLibrary(machineGunProject());
  const pierce = project.nodes.find(node => node.Name === 'MachineGunPierce')!;
  setUnlockRule(pierce, { PrerequisiteMode: 'Any', RequiredParentRank: 3, RequiredTreePoints: 4 });
  validateProject(project);
  expect(tables(project).Nodes.rows.find(row => row.Name === 'MachineGunPierce')).toMatchObject({ PrerequisiteMode: 'Any', RequiredParentRank: 3, RequiredTreePoints: 4 });
  expect(parseProject(JSON.stringify(project)).nodes.find(node => node.Name === 'MachineGunPierce')!.PrerequisiteMode).toBe('Any');
  setUnlockRule(pierce, unlockDefaults);
  expect(Object.keys(pierce)).not.toContain('PrerequisiteMode');
  // The legacy single-table contract is unchanged.
  expect(Object.keys(JSON.parse(exportRows(project))[0])).not.toContain('RequiredTreePoints');
  pierce.RequiredParentRank = 0;
  expect(() => validateProject(project)).toThrow('RequiredParentRank');
});

it('precomputes border-to-border link geometry for UMG lines', () => {
  const { Links } = tables();
  const fireRate = Links.rows.find(row => row.Name === 'MachineGunDamage__MachineGunFireRate')!;
  expect(fireRate).toMatchObject({ From: 'MachineGunDamage', To: 'MachineGunFireRate', Start: { X: 48, Y: 132 }, End: { X: 192, Y: 60 } });
  expect(fireRate.Length).toBeCloseTo(Math.hypot(144, 72), 3);
  expect(fireRate.AngleDegrees).toBeCloseTo(-26.565, 3);
  expect(Links.rows).toHaveLength(4);
});

it('computes depth as the longest prerequisite chain', () => {
  const depths = nodeDepths(demoProject());
  expect(depths.get('ArcaneRoot')).toBe(0);
  expect(depths.get('Mana')).toBe(1);
  expect(depths.get('Flame')).toBe(2);
});

it('rejects invalid tree IDs and content paths', () => {
  const project = withLibrary(machineGunProject());
  expect(() => buildUnrealTables(project, { settings: { treeId: '1Tree', contentPath: '/Game/Data' } })).toThrow('트리 ID');
  expect(() => buildUnrealTables(project, { settings: { treeId: 'Tree', contentPath: 'Game/Data' } })).toThrow('콘텐츠 폴더');
  project.unreal = { treeId: 'Bad Id', contentPath: '/Game' };
  expect(() => validateProject(project)).toThrow('트리 ID');
});

it('writes CSV cells in Unreal ImportText form and JSON with nested structs', () => {
  const project = withLibrary(machineGunProject());
  project.presets![0].Description = project.nodes[0].Description = '한글 "설명"\n다음 줄';
  const { Skills, Nodes } = tables(project);
  const csv = tableToCsv(Skills).split('\r\n');
  expect(csv[0]).toBe('"Name","DisplayName","Description","Category","Icon","IconSymbol","Shape","Size","Color","MaxRank","CostPerRank","Effects","DescriptionTemplate","MaxDescriptionTemplate","Tags","CustomData"');
  expect(csv[1]).toContain('"한글 ""설명""\n다음 줄"');
  expect(csv[1]).toContain('"(R=211,G=181,B=121,A=255)"');
  expect(csv[1]).toContain('"((StatId=""MachineGun.Damage"",ModifierOp=""Add"",ValuePerRank=1))"');
  expect(csv[1]).toContain('"(""Weapon"",""MachineGun"")"');
  expect(csv[1].endsWith('"{}"')).toBe(true);
  expect(tableToCsv(Nodes).split('\r\n')[2]).toContain('"(X=192,Y=24)","(""MachineGunDamage"")","All","1","0","1"');
  expect(JSON.parse(tableToJson(Nodes))[0].Position).toEqual({ X: 0, Y: 120 });
});

it('packages every table, both encodings and headers in a valid stored ZIP', () => {
  const files = packageFiles(buildUnrealTables(withLibrary(demoProject())), { 'SkillTreeTypes.h': '// types' });
  expect(files.map(file => file.name)).toEqual(expect.arrayContaining(['Json/DT_ArcaneAtlas_Nodes.json', 'Csv/DT_ArcaneAtlas_Links.csv', 'Source/SkillTreeTypes.h', 'README.txt']));
  const bytes = zip(files);
  const view = new DataView(bytes.buffer);
  expect(view.getUint32(0, true)).toBe(0x04034b50);
  const end = bytes.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  expect(view.getUint16(end + 10, true)).toBe(files.length);
  const data = new TextEncoder().encode(files[0].content);
  expect(view.getUint32(14, true)).toBe(zlibCrc32(data));
  expect(crc32(new TextEncoder().encode('한글'))).toBe(zlibCrc32(Buffer.from('한글')));
});

it('marks CSV files as UTF-8 with a BOM', () => {
  const skills = tables().Skills;
  expect(csvFile(skills).charCodeAt(0)).toBe(0xfeff);
  expect(csvFile(skills).slice(1)).toBe(tableToCsv(skills));
});
