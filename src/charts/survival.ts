// Survival curves: share of cars still registered (y) against age in years (x).
// Own SVG, no library. Interactive by default: crosshair + tooltip on hover/touch, arrow keys
// move the crosshair when the chart has focus, and a polite live region reads the values.
import { num, pct, t } from '../i18n.ts';

export interface Series {
  id: string;
  label: string;
  S: (number | null)[];
  lo?: (number | null)[];
  hi?: (number | null)[];
  /** 1 where the value comes from the group's own data; 0 where it is borrowed (drawn dashed). */
  obs?: number[];
  color: string;
  kind?: 'main' | 'ref' | 'rival';
  median?: number | null;
}

export interface Options {
  maxAge?: number;
  height?: number; // px at desktop width; scales down on small screens
  medianGuide?: boolean;
  annotateMedian?: boolean;
  endLabels?: boolean;
  big?: boolean;
  ariaLabel: string;
  xFrom?: number;
  yMin?: number;
}

const NS = 'http://www.w3.org/2000/svg';
const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, parent?: Element) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.append(e);
  return e;
};

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export class SurvivalChart {
  private svg: SVGSVGElement;
  private tip: HTMLDivElement;
  private live: HTMLDivElement;
  private shown: Series[] = []; // what is drawn (tweened)
  private w = 800;
  private h = 420;
  private m = { t: 16, r: 120, b: 44, l: 52 };
  private age: number | null = null;
  private drawn = false;
  private visible = false;
  private raf = 0;

  constructor(
    private root: HTMLElement,
    private opt: Options,
  ) {
    root.classList.add('chart');
    root.tabIndex = 0;
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', opt.ariaLabel + '. ' + t('Usa las flechas para recorrer las edades.'));
    this.svg = el('svg', { role: 'presentation' });
    this.tip = document.createElement('div');
    this.tip.className = 'tip';
    this.tip.setAttribute('aria-hidden', 'true');
    this.live = document.createElement('div');
    this.live.className = 'sr-only';
    this.live.setAttribute('aria-live', 'polite');
    root.replaceChildren(this.svg, this.tip, this.live);
    new ResizeObserver(() => this.render()).observe(root);
    new IntersectionObserver(
      (es, io) => {
        if (es.some((e) => e.isIntersecting)) {
          io.disconnect();
          this.visible = true;
          this.render();
        }
      },
      { threshold: 0.25 },
    ).observe(root);
    this.wire();
  }

  setSeries(series: Series[]): void {
    const from = this.shown;
    if (!this.drawn || reduced() || !from.length) {
      this.shown = series;
      this.render();
      return;
    }
    // Tween values of series that persist (same id); new ones fade in, removed ones disappear.
    cancelAnimationFrame(this.raf);
    const start = performance.now();
    const dur = 650;
    const prev = new Map(from.map((s) => [s.id, s]));
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      this.shown = series.map((s) => {
        const p = prev.get(s.id);
        if (!p) return s;
        const mix = (a?: (number | null)[], b?: (number | null)[]) =>
          b?.map((v, i) => (v == null || a?.[i] == null ? v : a[i]! + (v - a[i]!) * e));
        return { ...s, S: mix(p.S, s.S)!, lo: mix(p.lo, s.lo), hi: mix(p.hi, s.hi) };
      });
      this.render(true);
      if (k < 1) this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  private get maxAge() {
    return this.opt.maxAge ?? 40;
  }
  private x = (a: number) => this.m.l + ((a - (this.opt.xFrom ?? 0)) / (this.maxAge - (this.opt.xFrom ?? 0))) * (this.w - this.m.l - this.m.r);
  private y = (v: number) => {
    const y0 = this.opt.yMin ?? 0;
    return this.m.t + (1 - (v - y0) / (1 - y0)) * (this.h - this.m.t - this.m.b);
  };

  /** Polyline through the intervals (a-1 → a) whose status matches `wantObs` (all if undefined). */
  private path(S: (number | null)[], from: number, to: number, obs?: number[], wantObs?: boolean): string {
    let d = '';
    let pen = false;
    for (let a = from + 1; a <= to && a < S.length; a++) {
      const v0 = S[a - 1];
      const v1 = S[a];
      const st = obs ? obs[a - 1] === 1 : true;
      if (v0 == null || v1 == null || (wantObs != null && st !== wantObs)) {
        pen = false;
        continue;
      }
      if (!pen) d += `M${this.x(a - 1).toFixed(1)},${this.y(v0).toFixed(1)}`;
      d += `L${this.x(a).toFixed(1)},${this.y(v1).toFixed(1)}`;
      pen = true;
    }
    return d;
  }

  render(tweening = false): void {
    const W = this.root.clientWidth || 800;
    if (!W) return;
    const small = W < 560;
    this.w = W;
    this.h = Math.round(Math.min(this.opt.height ?? 420, Math.max(260, W * (small ? 0.78 : 0.52))));
    this.m = {
      t: 18,
      r: this.opt.endLabels === false ? 18 : small ? 18 : 132,
      b: 46,
      l: small ? 40 : 52,
    };
    const svg = this.svg;
    svg.setAttribute('viewBox', `0 0 ${this.w} ${this.h}`);
    svg.setAttribute('height', String(this.h));
    svg.replaceChildren();
    if (!this.visible && !tweening) {
      // Reserve the space until it scrolls into view.
      return;
    }
    this.root.style.minHeight = '0';
    const x0 = this.opt.xFrom ?? 0;
    const y0 = this.opt.yMin ?? 0;
    // grid + axes
    const g = el('g', { class: 'axis' }, svg);
    for (let v = y0; v <= 1.0001; v += 0.25) {
      const yy = this.y(v);
      el('line', { x1: this.m.l, x2: this.w - this.m.r + (small ? 0 : 8), y1: yy, y2: yy, class: 'tick-line', stroke: 'var(--grid)' }, g);
      const tx = el('text', { x: this.m.l - 8, y: yy + 4, 'text-anchor': 'end' }, g);
      tx.textContent = `${num(v * 100)} %`;
    }
    const stepX = small ? 10 : 5;
    for (let a = x0; a <= this.maxAge; a += stepX) {
      const xx = this.x(a);
      el('line', { x1: xx, x2: xx, y1: this.h - this.m.b, y2: this.h - this.m.b + 5, stroke: 'var(--line)' }, g);
      const tx = el('text', { x: xx, y: this.h - this.m.b + 20, 'text-anchor': 'middle' }, g);
      tx.textContent = String(a);
    }
    el('line', { x1: this.m.l, x2: this.w - this.m.r, y1: this.h - this.m.b, y2: this.h - this.m.b, stroke: 'var(--line)' }, g);
    const xt = el('text', { x: this.w - this.m.r, y: this.h - 6, 'text-anchor': 'end', class: 'axis-title' }, svg);
    xt.textContent = t('Edad del coche (años)');
    const yt = el('text', { x: this.m.l - 8, y: 10, 'text-anchor': 'start', class: 'axis-title', dx: -this.m.l + 8 }, svg);
    yt.textContent = small ? '' : '';
    if (this.opt.medianGuide !== false && y0 < 0.5) {
      el('line', { x1: this.m.l, x2: this.w - this.m.r, y1: this.y(0.5), y2: this.y(0.5), class: 'guide' }, svg);
    }

    const animate = !this.drawn && !reduced() && !tweening;
    const series = this.shown;
    // bands first
    for (const s of series) {
      if (!s.lo || !s.hi) continue;
      let d = '';
      const top: string[] = [];
      const bot: string[] = [];
      for (let a = x0; a <= this.maxAge && a < s.S.length; a++) {
        if (s.lo[a] == null || s.hi[a] == null) continue;
        top.push(`${this.x(a).toFixed(1)},${this.y(s.hi[a]!).toFixed(1)}`);
        bot.unshift(`${this.x(a).toFixed(1)},${this.y(s.lo[a]!).toFixed(1)}`);
      }
      if (top.length < 2) continue;
      d = `M${top.join('L')}L${bot.join('L')}Z`;
      const band = el('path', { d, class: 'band', fill: s.color, 'fill-opacity': 0.16 }, svg);
      if (animate) {
        band.style.opacity = '0';
        band.style.transition = 'opacity .8s ease 1.1s';
        requestAnimationFrame(() => (band.style.opacity = '1'));
      }
    }
    // lines: reference/rivals under the main one
    const order = [...series].sort((a, b) => (a.kind === 'main' ? 1 : 0) - (b.kind === 'main' ? 1 : 0));
    for (const s of order) {
      const cls = `line ${s.kind === 'main' && this.opt.big ? 'hero-line' : ''} ${s.kind === 'ref' ? 'ref' : ''}`;
      const solid = el('path', { d: this.path(s.S, x0, this.maxAge, s.obs, s.obs ? true : undefined), class: cls, stroke: s.color }, svg);
      if (s.obs) {
        const dashed = this.path(s.S, x0, this.maxAge, s.obs, false);
        if (dashed) el('path', { d: dashed, class: `${cls} dash`, stroke: s.color }, svg);
      }
      if (animate) {
        const len = (solid as SVGPathElement).getTotalLength?.() || 2000;
        solid.style.strokeDasharray = `${len}`;
        solid.style.strokeDashoffset = `${len}`;
        solid.style.transition = `stroke-dashoffset ${s.kind === 'main' ? 1.6 : 1.2}s cubic-bezier(.35,.1,.25,1)`;
        requestAnimationFrame(() => requestAnimationFrame(() => (solid.style.strokeDashoffset = '0')));
      }
    }
    // median annotation for the main series
    const main = series.find((s) => s.kind === 'main');
    if (main && this.opt.annotateMedian && main.median != null && main.median <= this.maxAge) {
      const mx = this.x(main.median);
      const my = this.y(0.5);
      const ga = el('g', {}, svg);
      el('line', { x1: mx, x2: mx, y1: my, y2: this.h - this.m.b, class: 'guide' }, ga);
      el('circle', { cx: mx, cy: my, r: this.opt.big ? 6 : 5, fill: main.color, class: 'dot' }, ga);
      const lab = el('text', { x: mx + (small ? -10 : 12), y: my - (this.opt.big ? 36 : 14), class: this.opt.big ? 'anno-big' : 'anno', 'text-anchor': small ? 'end' : 'start' }, ga);
      lab.textContent = this.opt.big ? t('{n} años', { n: num(main.median, 1) }) : t('Vida mediana: {n} años', { n: num(main.median, 1) });
      if (this.opt.big) {
        const sub = el('text', { x: mx + (small ? -10 : 12), y: my - 14, class: 'anno', 'text-anchor': small ? 'end' : 'start' }, ga);
        sub.textContent = t('la mitad ya se ha dado de baja');
      }
      if (animate) {
        ga.style.opacity = '0';
        ga.style.transition = 'opacity .6s ease 1.4s';
        requestAnimationFrame(() => requestAnimationFrame(() => (ga.style.opacity = '1')));
      }
    }
    // end labels (direct labelling, nudged apart)
    if (this.opt.endLabels !== false && !small && series.length <= 5) {
      const items = series
        .map((s) => {
          let a = Math.min(this.maxAge, s.S.length - 1);
          while (a > 0 && s.S[a] == null) a--;
          return { s, y: this.y(s.S[a] ?? 0), x: this.x(a) };
        })
        .sort((p, q) => p.y - q.y);
      for (let i = 1; i < items.length; i++) if (items[i]!.y - items[i - 1]!.y < 16) items[i]!.y = items[i - 1]!.y + 16;
      for (const it of items) {
        const tx = el('text', { x: it.x + 10, y: it.y + 4, class: 'end-label' }, svg);
        tx.textContent = it.s.label.length > 18 ? it.s.label.slice(0, 17) + '…' : it.s.label;
        if (animate) {
          tx.style.opacity = '0';
          tx.style.transition = 'opacity .5s ease 1.3s';
          requestAnimationFrame(() => requestAnimationFrame(() => (tx.style.opacity = '1')));
        }
      }
    }
    // crosshair layer
    const xh = el('g', { class: 'xh', 'pointer-events': 'none' }, svg);
    if (this.age != null) this.drawCrosshair(xh, this.age);
    this.drawn = true;
  }

  private drawCrosshair(g: SVGGElement, age: number): void {
    const xx = this.x(age);
    el('line', { x1: xx, x2: xx, y1: this.m.t, y2: this.h - this.m.b, class: 'xhair' }, g);
    for (const s of this.shown) {
      const v = s.S[age];
      if (v == null) continue;
      el('circle', { cx: xx, cy: this.y(v), r: s.kind === 'main' ? 5 : 4, fill: s.color, class: 'dot' }, g);
    }
  }

  private setAge(age: number | null, fromKeyboard = false): void {
    const lo = this.opt.xFrom ?? 0;
    if (age != null) age = Math.max(lo, Math.min(this.maxAge, age));
    if (age === this.age) return;
    this.age = age;
    const g = this.svg.querySelector('.xh');
    if (g) {
      g.replaceChildren();
      if (age != null) this.drawCrosshair(g as SVGGElement, age);
    }
    if (age == null) {
      this.tip.classList.remove('on');
      return;
    }
    const rows = this.shown
      .filter((s) => s.S[age] != null)
      .sort((a, b) => (b.S[age] ?? 0) - (a.S[age] ?? 0))
      .map((s) => {
        const borrowed = s.obs && age > 0 && s.obs[age - 1] !== 1;
        return `<div class="row"><span><i class="swatch line" style="background:${s.color}"></i>${esc(s.label)}</span><b>${pct(s.S[age], 1)}${borrowed ? '*' : ''}</b></div>`;
      })
      .join('');
    const anyBorrowed = this.shown.some((s) => s.obs && age > 0 && s.obs[age - 1] !== 1 && s.S[age] != null);
    this.tip.innerHTML = `<div class="tip-title">${t('A los {n} años', { n: age })}</div>${rows}<div class="small muted" style="margin-top:6px">${t('siguen dados de alta')}${anyBorrowed ? ' · ' + t('* estimado con su segmento') : ''}</div>`;
    const xx = (this.x(age) / this.w) * this.root.clientWidth;
    const tw = this.tip.offsetWidth || 200;
    const left = xx + 16 + tw > this.root.clientWidth ? xx - tw - 16 : xx + 16;
    this.tip.style.left = `${Math.max(0, left)}px`;
    this.tip.style.top = `${this.m.t + 6}px`;
    this.tip.classList.add('on');
    if (fromKeyboard) {
      this.live.textContent =
        t('A los {n} años', { n: age }) +
        ': ' +
        this.shown
          .filter((s) => s.S[age] != null)
          .map((s) => `${s.label} ${pct(s.S[age], 1)}`)
          .join(', ');
    }
  }

  private wire(): void {
    const ageAt = (clientX: number) => {
      const r = this.root.getBoundingClientRect();
      const px = ((clientX - r.left) / r.width) * this.w;
      const x0 = this.opt.xFrom ?? 0;
      return Math.round(x0 + ((px - this.m.l) / (this.w - this.m.l - this.m.r)) * (this.maxAge - x0));
    };
    this.root.addEventListener('pointermove', (e) => this.setAge(ageAt(e.clientX)));
    this.root.addEventListener('pointerdown', (e) => this.setAge(ageAt(e.clientX)));
    this.root.addEventListener('pointerleave', () => {
      if (document.activeElement !== this.root) this.setAge(null);
    });
    this.root.addEventListener('keydown', (e) => {
      const cur = this.age ?? (this.opt.xFrom ?? 0) + 10;
      const step = e.shiftKey ? 5 : 1;
      if (e.key === 'ArrowRight') this.setAge(cur + step, true);
      else if (e.key === 'ArrowLeft') this.setAge(cur - step, true);
      else if (e.key === 'Home') this.setAge(this.opt.xFrom ?? 0, true);
      else if (e.key === 'End') this.setAge(this.maxAge, true);
      else if (e.key === 'Escape') this.setAge(null);
      else return;
      e.preventDefault();
    });
    this.root.addEventListener('focus', () => this.setAge(this.age ?? (this.opt.xFrom ?? 0) + 15, true));
    this.root.addEventListener('blur', () => this.setAge(null));
  }
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Accessible table alternative for a set of curves. */
export function curveTable(series: Series[], ages = [0, 5, 10, 15, 20, 25, 30, 35, 40]): HTMLElement {
  const d = document.createElement('details');
  d.className = 'data-table';
  d.innerHTML = `<summary>${t('Ver los datos en una tabla')}</summary><div class="table-scroll"><table><thead><tr><th>${t('Edad')}</th>${series
    .map((s) => `<th>${esc(s.label)}</th>`)
    .join('')}</tr></thead><tbody>${ages
    .map(
      (a) =>
        `<tr><td>${t('{n} años', { n: a })}</td>${series
          .map((s) => `<td>${s.S[a] == null ? '—' : pct(s.S[a], 1)}${s.obs && a > 0 && s.obs[a - 1] !== 1 && s.S[a] != null ? '*' : ''}</td>`)
          .join('')}</tr>`,
    )
    .join('')}</tbody></table></div><p class="caption">${t('Porcentaje de coches que siguen dados de alta a cada edad. * Edades estimadas con la tabla de su segmento por falta de datos propios.')}</p>`;
  return d;
}
