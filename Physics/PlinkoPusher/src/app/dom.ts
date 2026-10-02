export const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
export const row = (k: string, v: string, cls = '') => `<div class="${cls}"><span>${k}</span><b>${v}</b></div>`;
export const n0 = (v: number) => Math.round(v).toLocaleString('ko-KR');
export const ms = (v: number | null | undefined, d = 3) => (v === null || v === undefined || !Number.isFinite(v) ? '측정 불가' : v.toFixed(d));

