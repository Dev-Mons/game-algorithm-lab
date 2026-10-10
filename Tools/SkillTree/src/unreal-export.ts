import { connectionEndpoints } from './appearance';
import { unlockRule, unrealSettings, validateProject, validateUnrealSettings, type Project, type SkillNode, type UnrealExportSettings } from './model';

// Split DataTable package: one shared definition per SkillId, one row per placement, and precomputed UMG geometry.
// Struct and field names must match src/unreal/SkillTreeTypes.h.
type Value = string | number | boolean | Value[] | { [key: string]: Value };
export type Row = { Name: string } & Record<string, Value>;
export type TableKind = 'Tree' | 'Skills' | 'Nodes' | 'Links';
export interface UnrealTable { kind: TableKind; asset: string; struct: string; rows: Row[] }
export interface ExportOptions { includeUnplaced?: boolean; settings?: UnrealExportSettings }

export const tableStructs: Record<TableKind, string> = {
  Tree: 'FSkillTreeLayoutRow', Skills: 'FSkillDefinitionRow', Nodes: 'FSkillTreeNodeRow', Links: 'FSkillTreeLinkRow',
};
const round = (value: number) => Math.round(value * 1000) / 1000 || 0;
const vector = (x: number, y: number) => ({ X: round(x), Y: round(y) });

export function assetName(settings: UnrealExportSettings, kind: TableKind) { return `DT_${settings.treeId}_${kind}`; }
export function assetPath(settings: UnrealExportSettings, kind: TableKind) {
  const name = assetName(settings, kind);
  return `${settings.contentPath}/${name}.${name}`;
}

// Longest path from a start node. Validation already guarantees a DAG.
export function nodeDepths(project: Project): Map<string, number> {
  const byId = new Map(project.nodes.map(node => [node.Name, node]));
  const depths = new Map<string, number>();
  const depth = (node: SkillNode): number => {
    const known = depths.get(node.Name);
    if (known !== undefined) return known;
    const value = node.Prerequisites.length ? Math.max(...node.Prerequisites.map(id => depth(byId.get(id)!))) + 1 : 0;
    depths.set(node.Name, value);
    return value;
  };
  project.nodes.forEach(depth);
  return depths;
}

function color(hex: string) {
  return { R: parseInt(hex.slice(1, 3), 16), G: parseInt(hex.slice(3, 5), 16), B: parseInt(hex.slice(5, 7), 16), A: 255 };
}

export function buildUnrealTables(project: Project, options: ExportOptions = {}): UnrealTable[] {
  validateProject(project);
  const settings = options.settings ?? unrealSettings(project);
  validateUnrealSettings(settings);
  const nodes = project.nodes;
  const used = new Set(nodes.map(node => node.SkillId ?? node.Name));
  const definitions = new Map<string, SkillNode>();
  for (const preset of project.presets ?? []) {
    if (options.includeUnplaced || used.has(preset.Name)) definitions.set(preset.Name, { ...preset, X: 0, Y: 0, Prerequisites: [] });
  }
  // Projects without a preset library still export the placement's own definition snapshot.
  for (const node of nodes) if (!definitions.has(node.SkillId ?? node.Name)) definitions.set(node.SkillId ?? node.Name, node);

  const skills: Row[] = [...definitions].map(([id, skill]) => ({
    Name: id, DisplayName: skill.DisplayName, Description: skill.Description, Category: skill.Category,
    Icon: skill.Icon, IconSymbol: skill.IconSymbol, Shape: skill.NodeShape, Size: skill.NodeSize, Color: color(skill.NodeColor),
    MaxRank: skill.MaxLevel, CostPerRank: skill.Cost,
    Effects: skill.StatId ? [{ StatId: skill.StatId, ModifierOp: skill.ModifierOp, ValuePerRank: skill.ValuePerRank }] : [],
    DescriptionTemplate: skill.DescriptionTemplate, MaxDescriptionTemplate: skill.MaxDescriptionTemplate,
    Tags: [...skill.Tags], CustomData: skill.CustomData,
  }));

  const depths = nodeDepths(project);
  const placements: Row[] = nodes.map(node => {
    const rule = unlockRule(node);
    return { Name: node.Name, SkillId: node.SkillId ?? node.Name, Position: vector(node.X, node.Y), Prerequisites: [...node.Prerequisites],
      PrerequisiteMode: rule.PrerequisiteMode, RequiredParentRank: rule.RequiredParentRank, RequiredTreePoints: rule.RequiredTreePoints,
      Depth: depths.get(node.Name)! };
  });

  const byId = new Map(nodes.map(node => [node.Name, node]));
  const links: Row[] = nodes.flatMap(node => node.Prerequisites.map(from => {
    const { from: start, to: end } = connectionEndpoints(byId.get(from)!, node);
    const dx = end.x - start.x, dy = end.y - start.y;
    // UMG line: Image at Start, pivot/alignment (0, 0.5), width Length, RenderTransform angle AngleDegrees (clockwise, +Y down).
    return { Name: `${from}__${node.Name}`, From: from, To: node.Name, Start: vector(start.x, start.y), End: vector(end.x, end.y),
      Length: round(Math.hypot(dx, dy)), AngleDegrees: round(Math.atan2(dy, dx) * 180 / Math.PI) };
  }));

  const minX = nodes.length ? Math.min(...nodes.map(node => node.X)) : 0, minY = nodes.length ? Math.min(...nodes.map(node => node.Y)) : 0;
  const maxX = nodes.length ? Math.max(...nodes.map(node => node.X + node.NodeSize)) : 0, maxY = nodes.length ? Math.max(...nodes.map(node => node.Y + node.NodeSize)) : 0;
  const tree: Row[] = [{ Name: settings.treeId, DisplayName: project.title, CanvasMin: vector(minX, minY), CanvasSize: vector(maxX - minX, maxY - minY),
    RootNodes: nodes.filter(node => !node.Prerequisites.length).map(node => node.Name),
    SkillTable: assetPath(settings, 'Skills'), NodeTable: assetPath(settings, 'Nodes'), LinkTable: assetPath(settings, 'Links') }];

  const table = (kind: TableKind, rows: Row[]): UnrealTable => ({ kind, asset: assetName(settings, kind), struct: tableStructs[kind], rows });
  return [table('Tree', tree), table('Skills', skills), table('Nodes', placements), table('Links', links)];
}

export function tableToJson(table: UnrealTable): string {
  return JSON.stringify(table.rows, null, 2);
}

// Unreal CSV cells use ImportText syntax for structs and arrays: (X=1,Y=2), ("A","B"), ((StatId="A",ValuePerRank=1)).
function quoted(text: string) { return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`; }
function importText(value: Value, nested: boolean): string {
  if (Array.isArray(value)) return `(${value.map(item => importText(item, true)).join(',')})`;
  if (typeof value === 'object') return `(${Object.entries(value).map(([key, item]) => `${key}=${importText(item, true)}`).join(',')})`;
  if (typeof value === 'string') return nested ? quoted(value) : value;
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  return String(value);
}
function csvCell(text: string) { return `"${text.replace(/"/g, '""')}"`; }

export function tableToCsv(table: UnrealTable): string {
  const columns = table.rows.length ? Object.keys(table.rows[0]) : ['Name'];
  const lines = [columns.map(csvCell).join(',')];
  for (const row of table.rows) lines.push(columns.map(column => csvCell(importText(row[column], false))).join(','));
  return lines.join('\r\n') + '\r\n';
}

// The BOM lets Excel and Unreal's CSV importer detect UTF-8 for Korean text.
export function csvFile(table: UnrealTable) { return String.fromCharCode(0xfeff) + tableToCsv(table); }

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// Minimal stored (uncompressed) ZIP so the browser can hand over every table in one download.
export function zip(files: { name: string; content: string }[]): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const local: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name), data = encoder.encode(file.content), crc = crc32(data);
    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, 0x04034b50, true); header.setUint16(4, 20, true); header.setUint16(6, 0x0800, true);
    header.setUint32(14, crc, true); header.setUint32(18, data.length, true); header.setUint32(22, data.length, true);
    header.setUint16(26, name.length, true);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true); entry.setUint16(4, 20, true); entry.setUint16(6, 20, true); entry.setUint16(8, 0x0800, true);
    entry.setUint32(16, crc, true); entry.setUint32(20, data.length, true); entry.setUint32(24, data.length, true);
    entry.setUint16(28, name.length, true); entry.setUint32(42, offset, true);
    local.push(new Uint8Array(header.buffer), name, data);
    central.push(new Uint8Array(entry.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const size = central.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, size, true); end.setUint32(16, offset, true);
  const parts = [...local, ...central, new Uint8Array(end.buffer)];
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let position = 0;
  for (const part of parts) { result.set(part, position); position += part.length; }
  return result;
}

export function packageFiles(tables: UnrealTable[], headers: Record<string, string>) {
  const guide = ['Skill Tree Studio - Unreal DataTable package', '',
    '1. Add SkillTreeTypes.h / SkillTreeRules.h to Source/<Module>/ and compile.',
    '2. Import each file as a DataTable with the row struct below (JSON or CSV, same columns).',
    '3. Keep asset names: the Tree row references the other tables by path.', '',
    ...tables.map(table => `${table.asset}  ->  ${table.struct}  (${table.rows.length} rows)`), ''].join('\r\n');
  return [
    ...tables.map(table => ({ name: `Json/${table.asset}.json`, content: tableToJson(table) })),
    ...tables.map(table => ({ name: `Csv/${table.asset}.csv`, content: csvFile(table) })),
    ...Object.entries(headers).map(([name, content]) => ({ name: `Source/${name}`, content })),
    { name: 'README.txt', content: guide },
  ];
}
