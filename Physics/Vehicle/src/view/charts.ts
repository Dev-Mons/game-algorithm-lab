import { gripCurve, powerCurve, type VehicleConfig } from '../physics/config';
import { sampleCurve } from '../physics/math';
import type { Telemetry } from '../lab/experiments';

export function drawCurve(canvas: HTMLCanvasElement, config: VehicleConfig, type: 'grip' | 'power') {
  const ctx = canvas.getContext('2d')!, w = canvas.width = 270 * 2, h = canvas.height = 76 * 2;
  ctx.scale(2, 2); ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = '#33414b'; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) { ctx.beginPath(); ctx.moveTo(10 + i * 62, 6); ctx.lineTo(10 + i * 62, 60); ctx.stroke(); }
  [0, 0.5, 1].forEach(y => { ctx.beginPath(); ctx.moveTo(10, 60 - y * 52); ctx.lineTo(258, 60 - y * 52); ctx.stroke(); });
  const lines = type === 'grip' ? [{ color: '#83d9c0', scale: config.frontGrip }, { color: '#f4ac75', scale: config.rearGrip }] : [{ color: '#f4ac75', scale: 1 }];
  for (const line of lines) {
    ctx.strokeStyle = line.color; ctx.lineWidth = 2; ctx.beginPath();
    for (let i = 0; i <= 100; i++) {
      const value = sampleCurve(type === 'grip' ? gripCurve(config) : powerCurve, i / 100) * line.scale;
      const x = 10 + i * 2.48, y = 60 - value * 52; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.fillStyle = '#a5b1b8'; ctx.font = '9px sans-serif'; ctx.fillText('0', 8, 73);
  ctx.fillText(type === 'grip' ? '횡방향 슬립 비율 →' : '속도 / 최고속도 →', 90, 73); ctx.fillText('1', 253, 73);
}
export type Metric = 'speed' | 'height' | 'slip';
export function drawTelemetry(canvas: HTMLCanvasElement, rows: Telemetry[], baseline: Telemetry[], metric: Metric) {
  const rect = canvas.getBoundingClientRect(), ratio = Math.min(devicePixelRatio, 2);
  canvas.width = Math.max(1, rect.width * ratio); canvas.height = Math.max(1, rect.height * ratio);
  const ctx = canvas.getContext('2d')!; ctx.scale(ratio, ratio);
  const width = rect.width, height = rect.height, left = 42, bottom = height - 23;
  const end = Math.max(10, rows.at(-1)?.time ?? 0, baseline.at(-1)?.time ?? 0), start = Math.max(0, end - 30);
  const values = [...rows, ...baseline].filter(r => r.time >= start).map(r => r[metric]);
  const max = Math.max(metric === 'speed' ? 40 : metric === 'height' ? 1.5 : 1, ...values) * 1.1;
  ctx.font = '10px ui-monospace, monospace';
  for (let i = 0; i <= 3; i++) {
    const y = bottom - i / 3 * (bottom - 8);
    ctx.strokeStyle = '#303c46'; ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(width - 10, y); ctx.stroke();
    ctx.fillStyle = '#899aa6'; ctx.fillText((max * i / 3).toFixed(metric === 'speed' ? 0 : 1), 5, y + 3);
    ctx.fillText(`${(start + (end - start) * i / 3).toFixed(0)}s`, left + (width - left - 20) * i / 3, height - 5);
  }
  for (const [data, color, dash] of [[baseline, '#8298a9', [5, 4]], [rows, '#efad7e', []]] as const) {
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash([...dash]); ctx.beginPath(); let first = true;
    for (const r of data) {
      if (r.time < start) continue;
      const x = left + (r.time - start) / (end - start) * (width - left - 12), y = bottom - r[metric] / max * (bottom - 8);
      if (first) ctx.moveTo(x, y); else ctx.lineTo(x, y); first = false;
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);
}
