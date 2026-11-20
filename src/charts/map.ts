// Choropleth of the 52 provinces from pre-projected paths (see scripts/geo.ts).
import geo from '../generated/spain.json';
import { t } from '../i18n.ts';
import { esc } from './survival.ts';

export interface MapOpts {
  values: Record<string, number | null>;
  names: Record<string, string>;
  format: (v: number) => string;
  label: string;
  /** Extra lines for the tooltip. */
  detail?: (code: string) => string;
  steps?: number[]; // thresholds; defaults to quantiles
  onClick?: (code: string) => void;
}

const SEQ = ['--seq-0', '--seq-1', '--seq-2', '--seq-3', '--seq-4', '--seq-5', '--seq-6'];

function quantiles(vals: number[], k: number): number[] {
  const s = [...vals].sort((a, b) => a - b);
  return Array.from({ length: k - 1 }, (_, i) => s[Math.floor(((i + 1) / k) * s.length)]!);
}

export function renderMap(root: HTMLElement, o: MapOpts): void {
  const vals = Object.values(o.values).filter((v): v is number => v != null && isFinite(v));
  const steps = o.steps ?? quantiles(vals, SEQ.length);
  const color = (v: number | null) => {
    if (v == null) return 'var(--line-2)';
    let i = 0;
    while (i < steps.length && v >= steps[i]!) i++;
    return `var(${SEQ[i]})`;
  };
  root.classList.add('map', 'chart');
  const g = geo as { w: number; h: number; paths: Record<string, string>; borders: string };
  root.innerHTML = `<svg viewBox="0 0 ${g.w} ${g.h}" role="img" aria-label="${esc(o.label)}">${Object.entries(g.paths)
    .filter(([c]) => o.names[c])
    .map(
      ([c, d]) =>
        `<path d="${d}" data-c="${c}" fill="${color(o.values[c] ?? null)}" tabindex="-1"><title>${esc(o.names[c]!)}: ${o.values[c] == null ? '—' : esc(o.format(o.values[c]!))}</title></path>`,
    )
    .join('')}<path d="${g.borders}" class="canary-box" fill="none" stroke="var(--line)" stroke-dasharray="3 3"/></svg><div class="tip"></div>
    <div class="ramp" aria-hidden="true"><span>${esc(o.format(Math.min(...vals)))}</span><span class="cells">${SEQ.map((s) => `<span style="background:var(${s})"></span>`).join('')}</span><span>${esc(o.format(Math.max(...vals)))}</span></div>`;
  const tip = root.querySelector<HTMLElement>('.tip')!;
  const svg = root.querySelector('svg')!;
  let cur: SVGPathElement | null = null;
  const show = (p: SVGPathElement | null, ev?: PointerEvent) => {
    cur?.classList.remove('active');
    cur = p;
    if (!p) return tip.classList.remove('on');
    p.classList.add('active');
    p.parentNode!.append(p); // bring stroke to front
    const c = p.dataset.c!;
    tip.innerHTML = `<div class="tip-title">${esc(o.names[c]!)}</div><div class="row"><span>${esc(o.label)}</span><b>${o.values[c] == null ? '—' : esc(o.format(o.values[c]!))}</b></div>${o.detail?.(c) ?? ''}`;
    const r = root.getBoundingClientRect();
    const x = ev ? ev.clientX - r.left : r.width / 2;
    const y = ev ? ev.clientY - r.top : 20;
    const tw = tip.offsetWidth || 200;
    tip.style.left = `${Math.min(r.width - tw - 4, Math.max(0, x + 14))}px`;
    tip.style.top = `${Math.max(0, y - 10)}px`;
    tip.classList.add('on');
  };
  svg.addEventListener('pointermove', (ev) => {
    const p = (ev.target as Element).closest<SVGPathElement>('path[data-c]');
    if (p !== cur || p) show(p, ev);
  });
  svg.addEventListener('pointerleave', () => show(null));
  svg.addEventListener('click', (ev) => {
    const p = (ev.target as Element).closest<SVGPathElement>('path[data-c]');
    if (p && o.onClick) o.onClick(p.dataset.c!);
  });
  void t;
}
