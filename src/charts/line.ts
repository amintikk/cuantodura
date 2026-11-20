// Small single-measure time chart (one or two series) with point tooltips.
import { esc } from './survival.ts';

export interface Pt {
  x: number;
  y: number;
  label?: string;
}
export interface LineSeries {
  name: string;
  color: string;
  points: Pt[];
}

export function renderLine(root: HTMLElement, series: LineSeries[], o: { yFormat: (v: number) => string; labelFormat?: (v: number) => string; ariaLabel: string; yMin?: number; yMax?: number; xFormat?: (x: number) => string }) {
  root.classList.add('chart');
  const draw = () => {
    const W = root.clientWidth || 600;
    const H = Math.max(240, Math.min(340, W * 0.6));
    const m = { t: 24, r: 46, b: 34, l: 44 };
    const xs = series.flatMap((s) => s.points.map((p) => p.x));
    const ys = series.flatMap((s) => s.points.map((p) => p.y));
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const y0 = o.yMin ?? Math.floor(Math.min(...ys) - 1), y1 = o.yMax ?? Math.ceil(Math.max(...ys) + 1);
    const X = (x: number) => m.l + ((x - x0) / (x1 - x0 || 1)) * (W - m.l - m.r);
    const Y = (y: number) => m.t + (1 - (y - y0) / (y1 - y0 || 1)) * (H - m.t - m.b);
    const step = Math.max(1, Math.ceil((y1 - y0) / 5));
    let s = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${esc(o.ariaLabel)}"><g class="axis">`;
    for (let v = Math.ceil(y0); v <= y1; v += step) s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--grid)"/><text x="${m.l - 8}" y="${Y(v) + 4}" text-anchor="end">${esc(o.yFormat(v))}</text>`;
    const every = W < 520 ? 3 : 1;
    for (let x = x0; x <= x1; x++) if ((x - x0) % every === 0 || x === x1) s += `<text x="${X(x)}" y="${H - 10}" text-anchor="middle">${esc(o.xFormat ? o.xFormat(x) : String(x))}</text>`;
    s += `</g>`;
    for (const se of series) {
      const d = se.points.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
      s += `<path d="${d}" class="line" stroke="${se.color}"/>`;
      for (const p of se.points) s += `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="4" fill="${se.color}" class="dot"><title>${esc(p.label ?? `${p.x}: ${o.yFormat(p.y)}`)}</title></circle>`;
      const a = se.points[0]!, b = se.points[se.points.length - 1]!;
      s += `<text class="anno" x="${X(a.x)}" y="${Y(a.y) - 12}" text-anchor="start">${esc((o.labelFormat ?? o.yFormat)(a.y))}</text>`;
      s += `<text class="anno-big" x="${X(b.x)}" y="${Y(b.y) - 14}" text-anchor="end" style="font-size:22px">${esc((o.labelFormat ?? o.yFormat)(b.y))}</text>`;
    }
    root.innerHTML = s + '</svg>';
  };
  draw();
  new ResizeObserver(draw).observe(root);
}
