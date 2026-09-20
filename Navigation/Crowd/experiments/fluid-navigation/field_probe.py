"""Reproduce protocol.md. Requires numpy, matplotlib, pillow; no product imports."""
import json
import platform
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from PIL import Image

OUT = Path(__file__).resolve().parents[2] / 'docs/research/fluid-navigation'
OUT.mkdir(parents=True, exist_ok=True)
DT, K, END = 1 / 60, 0.6, 8
NAMES = ['A: capacity only (exact p=0)', 'B: unmasked diffusion', 'C: known-interior diffusion']


def run(h):
    yy, xx = np.mgrid[h / 2:24:h, h / 2:40:h]
    mask = (xx >= 8) & (xx < 32) & (yy >= 6) & (yy < 18)
    hole = (xx - 20) ** 2 + (yy - 12) ** 2 < 4
    initial = np.where(mask & ~hole, 0.72, 0.0)
    fields = [initial.copy() for _ in NAMES]
    mass = initial.sum()
    assert DT * K / h**2 <= 0.25
    snapshots, history = {}, []
    worst_mass, lo, hi = 0.0, 0.0, 0.72
    for step in range(round(END / DT) + 1):
        if step % 30 == 0:
            snapshots[step] = [a.copy() for a in fields]
            history.append({'t': step * DT, 'recovery': [float(a[hole].mean() / .72) for a in fields],
                            'outside_mass_fraction': [float(a[~mask].sum() / mass) for a in fields]})
        for a in fields:
            worst_mass = max(worst_mass, abs(a.sum() / mass - 1))
            lo, hi = min(lo, float(a.min())), max(hi, float(a.max()))
        if step == round(END / DT):
            break
        for variant in (1, 2):
            a = fields[variant]
            fx, fy = (a[:, :-1] - a[:, 1:]) * (K * DT / h**2), (a[:-1, :] - a[1:, :]) * (K * DT / h**2)
            if variant == 2:
                fx *= mask[:, :-1] & mask[:, 1:]
                fy *= mask[:-1, :] & mask[1:, :]
            b = a.copy()
            b[:, :-1] -= fx
            b[:, 1:] += fx
            b[:-1, :] -= fy
            b[1:, :] += fy
            fields[variant] = b
    result = {'h': h, 'grid': list(initial.shape), 'initial_mass_d2': float(mass * h*h),
              'initial_hole_area_d2': float(hole.sum() * h*h), 'max_relative_mass_error': worst_mass,
              'min_phi': lo, 'max_phi': hi, 'history': history,
              'checks': {'conservation': bool(worst_mass <= 1e-10), 'bounds': bool(lo >= -1e-12 and hi <= .72 + 1e-12),
                         'pressure_counterexample': history[-1]['recovery'][0] == 0,
                         'interior_recovery': history[-1]['recovery'][2] >= .5,
                         'interior_no_leak': history[-1]['outside_mass_fraction'][2] <= 1e-10,
                         'unmasked_spreading': history[-1]['outside_mass_fraction'][1] > .05}}
    return result, snapshots


results, snaps = [], None
for h in (1.0, .5, .25):
    result, frames = run(h)
    results.append(result)
    if h == .5:
        snaps = frames
resolution_delta = abs(results[1]['history'][-1]['recovery'][2] - results[2]['history'][-1]['recovery'][2])
payload = {'scope': 'scalar field mechanism probe, no agents, no navigation, known fixed mask',
           'python': platform.python_version(), 'numpy': np.__version__, 'dt': DT, 'k': K,
           'duration': END, 'results': results, 'resolution_delta': resolution_delta,
           'resolution_pass': resolution_delta <= .05}
(OUT / 'field-probe.json').write_text(json.dumps(payload, indent=2) + '\n', encoding='utf-8')

fig, axes = plt.subplots(3, 5, figsize=(15, 7), sharex=True, sharey=True, constrained_layout=True)
for col, t in enumerate((0, 1, 2, 4, 8)):
    for row, field in enumerate(snaps[round(t / DT)]):
        ax = axes[row, col]
        im = ax.imshow(field, extent=(0, 40, 0, 24), origin='lower', vmin=0, vmax=.72, cmap='viridis', interpolation='nearest')
        ax.plot([8, 32, 32, 8, 8], [6, 6, 18, 18, 6], color='white', lw=.6, ls='--')
        if row == 0:
            ax.set_title(f't = {t}s')
        if col == 0:
            ax.set_ylabel(NAMES[row] + '\ny / d', fontsize=8)
        if row == 2:
            ax.set_xlabel('x / d')
fig.colorbar(im, ax=axes, label='area occupancy phi', shrink=.8)
fig.suptitle('Mechanism probe in translating coordinates | scalar density, not a particle-crowd simulation')
fig.savefig(OUT / 'field-probe.png', dpi=150)
plt.close(fig)

images = []
for step, fields in snaps.items():
    fig, axes = plt.subplots(1, 3, figsize=(12, 3.3), constrained_layout=True)
    for ax, name, field in zip(axes, NAMES, fields):
        ax.imshow(field, extent=(0, 40, 0, 24), origin='lower', vmin=0, vmax=.72, cmap='viridis', interpolation='nearest')
        ax.set_title(name, fontsize=9)
        ax.set_xlabel('x / d')
    fig.suptitle(f'Scalar-field probe, known mask | t={step * DT:.1f}s | not agents')
    fig.canvas.draw()
    images.append(Image.fromarray(np.asarray(fig.canvas.buffer_rgba())[:, :, :3].copy()))
    plt.close(fig)
images[0].save(OUT / 'field-probe.gif', save_all=True, append_images=images[1:], duration=250, loop=0)
print(json.dumps({'results': [{'h': r['h'], **r['history'][-1], 'checks': r['checks']} for r in results],
                  'resolution_delta': resolution_delta, 'resolution_pass': resolution_delta <= .05}, indent=2))
if not all(all(r['checks'].values()) for r in results) or resolution_delta > .05:
    raise SystemExit('A preregistered check failed; report it, do not relax the protocol.')
