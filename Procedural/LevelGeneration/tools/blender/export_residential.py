"""Run in the connected Blender: export live module meshes and observed assemblies.

Does not change the scene, selection, mesh datablocks, or saved .blend.
"""
import bpy
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / 'src' / 'assets' / 'residential'
DATA.mkdir(parents=True, exist_ok=True)
TEXTURES = ROOT / 'public' / 'assets' / 'residential'
TEXTURES.mkdir(parents=True, exist_ok=True)
masters = {o.data.name: o for o in bpy.data.scenes['Residential_Kit_Assets'].objects
           if o.type == 'MESH' and o.name.startswith('SM_')}
names = ['House01_CreamVeranda', 'House02_RedHip', 'House03_CreamGarden', 'House04_BrickGarage',
         'House01_OpenGarage', 'House04_ClosedGarage']
used = {o.data.name for name in names for o in bpy.data.collections[name].objects if o.type == 'MESH'}
used.update(m for m, o in masters.items() if o.name.startswith(('SM_House_', 'SM_Roof_')))
meshes, assets = {}, {}
def vec(v):
    return [round(v[0] / 3, 7), round(v[2] / 3, 7), round(-v[1] / 3, 7)]
for mesh_name in sorted(used):
    if mesh_name not in masters:
        continue
    o = masters[mesh_name]
    key = 'house-kit:' + o.name
    mesh = o.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh()
    try:
        mesh.calc_loop_triangles()
        uv = mesh.uv_layers.active
        positions, normals, uvs = [], [], []
        for triangle in mesh.loop_triangles:
            for loop_id in triangle.loops:
                loop = mesh.loops[loop_id]
                positions.extend(vec(mesh.vertices[loop.vertex_index].co))
                n = mesh.corner_normals[loop_id].vector
                normals.extend([round(n.x, 7), round(n.z, 7), round(-n.y, 7)])
                uvs.extend([round(x, 7) for x in uv.data[loop_id].uv] if uv else [0, 0])
        bounds = {'min': [math.floor(min(positions[a::3]) * 16) for a in range(3)],
                  'max': [math.ceil(max(positions[a::3]) * 16) for a in range(3)]}
        for a in range(3):
            if bounds['min'][a] == bounds['max'][a]:
                bounds['max'][a] += 1
        meshes[key] = {'position': positions, 'normal': normals, 'uv': uvs}
        assets[key] = {'bounds16': bounds, 'triangles': len(mesh.loop_triangles),
                       'description': o.get('description', ''), 'pivot': o.get('pivot_rule', ''),
                       'sourceMesh': mesh_name}
    finally:
        o.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh_clear()

examples = []
for index, name in enumerate(names):
    objects = [o for o in bpy.data.collections[name].objects if o.type == 'MESH' and o.data.name in masters]
    walls = [o for o in objects if any(part in o.data.name for part in ['Window', 'Door', 'Plain', 'GaragePortal'])
             and '_3m_QuarterMesh' in o.data.name and 'Slab' not in o.data.name]
    min_x = min(o.location.x for o in walls)
    min_y = min(o.location.y for o in walls)
    max_x = max(o.location.x for o in walls)
    max_y = max(o.location.y for o in walls)
    origin = [min_x, 0, -max_y]
    cells = []
    for floor in range(1 + round(max(o.location.z for o in walls) / 3)):
        for x in range(round((max_x - min_x) / 3)):
            for z in range(round((max_y - min_y) / 3)):
                px, py = min_x + (x + .5) * 3, max_y - (z + .5) * 3
                crossings = sum(1 for o in walls if round(o.location.z / 3) == floor
                                and abs(math.sin(o.rotation_euler.z)) > .9
                                and o.location.x > px
                                and abs(o.location.y - py) < 1.49)
                if crossings % 2:
                    cells.append([x, floor, z])
    instances = []
    for o in sorted(objects, key=lambda o: o.name):
        key = 'house-kit:' + masters[o.data.name].name
        if key not in assets:
            continue
        p = vec(o.location)
        p = [round(p[a] - origin[a] / 3, 6) for a in range(3)]
        instances.append({'asset': key, 'center': p,
                          'size': [round(o.scale.x, 6), round(o.scale.z, 6), round(o.scale.y, 6)],
                          'yawQuarterTurns': round(o.rotation_euler.z / (math.pi / 2)) % 4})
    examples.append({'id': name, 'variant': ['cream', 'red', 'cream', 'brick', 'garage', 'garage'][index],
                     'cells': sorted(cells), 'instances': instances})

for suffix in ['BaseColor', 'Normal', 'ORM']:
    image = bpy.data.images['Quarter_Atlas_512_' + suffix]
    # Packed PNG bytes preserve the original atlas without rebaking or image edits.
    if image.packed_file:
        (TEXTURES / (suffix + '.png')).write_bytes(image.packed_file.data)
    else:
        (TEXTURES / (suffix + '.png')).write_bytes(Path(bpy.path.abspath(image.filepath)).read_bytes())
metadata = {'version': 1, 'sourceFile': Path(bpy.data.filepath).name,
            'sourceScene': 'House_Expansion_Examples', 'metersPerCell': 3,
            'coordinateTransform': '(x,z,-y)/3; Blender Z-up to LevelGeneration Y-up',
            'assets': assets, 'examples': examples}
(DATA / 'kit.json').write_text(json.dumps(metadata, ensure_ascii=False, separators=(',', ':')), encoding='utf8')
(DATA / 'meshes.json').write_text(json.dumps(meshes, separators=(',', ':')), encoding='utf8')
result = {'assets': len(assets), 'triangles': sum(a['triangles'] for a in assets.values()),
          'examples': [{'id': e['id'], 'cells': len(e['cells']), 'instances': len(e['instances'])} for e in examples],
          'output': str(DATA)}
