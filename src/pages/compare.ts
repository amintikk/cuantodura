import { boot } from '../site/site.ts';
import { load, loadModel, segmentName, type IndexEntry, type ModelDoc, type Overview } from '../data.ts';
import { int, modelUrl, num, pct, t } from '../i18n.ts';
import { curveTable, esc, SurvivalChart, type Series } from '../charts/survival.ts';
import { mountSearch } from '../ui/search.ts';
import { icon } from '../ui/icons.ts';

boot();
const COLORS = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)'];
const params = new URLSearchParams(location.search);
let slugs = (params.get('m') ?? '').split(',').filter(Boolean).slice(0, 4);
const [ov, idx] = await Promise.all([load<Overview>('overview'), load<{ models: IndexEntry[] }>('index')]);
const known = new Set(idx.models.map((m) => m.slug));
slugs = slugs.filter((s) => known.has(s));
if (!slugs.length) slugs = ['seat-ibiza', 'volkswagen-golf', 'toyota-corolla'].filter((s) => known.has(s));
const q = params.get('q');

const chart = new SurvivalChart(document.getElementById('cmp-chart')!, { ariaLabel: t('Curvas de supervivencia comparadas'), height: 460 });
const picker = document.getElementById('picker')!;
const legend = document.getElementById('cmp-legend')!;
const table = document.getElementById('cmp-table')!;
let tbl: HTMLElement | null = null;
// Colour follows the model, not its position: keep a stable assignment.
const colorOf = new Map<string, string>();
const assign = () => {
  for (const s of [...colorOf.keys()]) if (!slugs.includes(s)) colorOf.delete(s);
  for (const s of slugs) if (!colorOf.has(s)) colorOf.set(s, COLORS.find((c) => ![...colorOf.values()].includes(c))!);
};

const input = mountSearch(document.getElementById('cmp-search')!, {
  placeholder: t('Añadir un modelo…'),
  exclude: () => slugs,
  onPick: (e) => {
    if (slugs.length >= 4) return;
    slugs.push(e.slug);
    void render();
  },
});
if (q) {
  input.value = q;
  input.dispatchEvent(new Event('input'));
}

async function render() {
  assign();
  history.replaceState(null, '', `?m=${slugs.join(',')}`);
  const docs: ModelDoc[] = await Promise.all(slugs.map(loadModel));
  picker.replaceChildren(
    ...docs.map((d) => {
      const c = document.createElement('span');
      c.className = 'chip';
      c.innerHTML = `<span class="swatch" style="background:${colorOf.get(d.slug)}"></span><a href="${modelUrl(d.slug)}">${esc(d.name)}</a>`;
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-label', t('Quitar {n}', { n: d.name }));
      b.append(icon('x', 14));
      b.onclick = () => {
        slugs = slugs.filter((s) => s !== d.slug);
        void render();
      };
      c.append(b);
      return c;
    }),
  );
  (document.getElementById('cmp-search') as HTMLElement).hidden = slugs.length >= 4;
  const series: Series[] = [
    { id: 'all', label: t('Todos los turismos'), S: ov.national.curve.S, color: 'var(--faint)', kind: 'ref' },
    ...docs.map((d) => ({ id: d.slug, label: d.name, S: d.curve.S, obs: d.curve.obs, color: colorOf.get(d.slug)!, kind: 'rival' as const, median: d.summary.median })),
  ];
  chart.setSeries(series);
  legend.innerHTML = series.map((s) => `<li><span class="swatch line" style="background:${s.color}"></span>${esc(s.label)}</li>`).join('');
  const rows: [string, (d: ModelDoc) => string][] = [
    [t('Segmento'), (d) => esc(segmentName(d.segment))],
    [t('Vida mediana'), (d) => (d.summary.median != null ? `<b>${t('{n} años', { n: num(d.summary.median, 1) })}</b><br><span class="small muted">${num(d.summary.median_lo, 1)}–${num(d.summary.median_hi, 1)}</span>` : d.summary.enough ? `<span class="muted">${t('aún sin datos')}</span>` : `<span class="pill warn">${t('Pocos datos')}</span>`)],
    [t('Siguen a los 10 años'), (d) => pct(d.summary.s['10'], 0)],
    [t('Siguen a los 15 años'), (d) => pct(d.summary.s['15'], 0)],
    [t('Siguen a los 20 años'), (d) => pct(d.summary.s['20'], 0)],
    [t('Siguen a los 25 años'), (d) => pct(d.summary.s['25'], 0)],
    [t('Índice de bajas (100 = media)'), (d) => (d.summary.index == null ? '—' : num(d.summary.index, 0))],
    [t('Bajas en 12 meses'), (d) => int(d.summary.deaths)],
    [t('Exportados en 12 meses'), (d) => int(d.summary.exports)],
    [t('Dados de alta hoy'), (d) => int(d.now)],
    [t('Edad media hoy'), (d) => t('{n} años', { n: num(d.now_mean_age, 1) })],
  ];
  table.innerHTML = `<thead><tr><th></th>${docs.map((d) => `<th style="text-align:right"><span class="swatch" style="background:${colorOf.get(d.slug)};margin-right:6px"></span>${esc(d.name)}</th>`).join('')}</tr></thead><tbody>${rows
    .map(([h, f]) => `<tr><td>${h}</td>${docs.map((d) => `<td>${f(d)}</td>`).join('')}</tr>`)
    .join('')}</tbody>`;
  const nt = curveTable(series);
  if (tbl) tbl.replaceWith(nt);
  else document.getElementById('cmp-chart')!.parentElement!.append(nt);
  tbl = nt;
  document.title = docs.length ? `${docs.map((d) => d.name).join(' vs ')} · ${t('Cuánto dura')}` : document.title;
}
await render();
