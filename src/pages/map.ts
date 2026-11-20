import { boot } from '../site/site.ts';
import { load, type Province } from '../data.ts';
import { int, num, pct, t } from '../i18n.ts';
import { renderMap } from '../charts/map.ts';
import { esc } from '../charts/survival.ts';

boot();
const pv = await load<{ provinces: Record<string, Province> }>('provinces');
const P = pv.provinces;
type K = 'mean_age' | 'share_20' | 'index' | 'old_export';
const METRICS: Record<K, { label: string; get: (p: Province) => number | null; fmt: (v: number) => string; cap: string }> = {
  mean_age: { label: t('Edad media'), get: (p) => p.mean_age, fmt: (v) => t('{n} años', { n: num(v, 1) }), cap: t('Edad media de los turismos dados de alta, en años.') },
  share_20: { label: t('Más de 20 años'), get: (p) => p.share_20, fmt: (v) => pct(v, 1), cap: t('Porcentaje del parque con 20 años o más.') },
  index: { label: t('Índice de bajas'), get: (p) => p.index, fmt: (v) => num(v, 0), cap: t('Bajas definitivas del último año frente a las esperadas por la edad de su parque (100 = media de España). Por encima de 100, sus coches se dan de baja antes.') },
  old_export: { label: t('Exportación'), get: (p) => p.export_rate, fmt: (v) => `${num(v * 10, 1)} ‰`, cap: t('Turismos exportados en el último año por cada 1.000 dados de alta, todas las edades.') },
};
const names = Object.fromEntries(Object.entries(P).map(([c, p]) => [c, p.name]));
let key: K = (new URLSearchParams(location.search).get('k') as K) || 'mean_age';
function show() {
  const m = METRICS[key];
  renderMap(document.getElementById('map-main')!, {
    values: Object.fromEntries(Object.entries(P).map(([c, p]) => [c, m.get(p)])),
    names,
    format: m.fmt,
    label: m.label,
    detail: (c) => `<div class="row"><span>${t('Turismos')}</span><b>${int(P[c]!.stock)}</b></div><div class="row"><span>${t('Edad mediana')}</span><b>${num(P[c]!.median_age, 1)}</b></div>`,
  });
  document.getElementById('map-cap')!.textContent = m.cap;
  const rows = Object.entries(P).sort((a, b) => (m.get(b[1]) ?? -1) - (m.get(a[1]) ?? -1));
  document.getElementById('map-table')!.innerHTML = `<thead><tr><th>${t('Provincia')}</th><th>${esc(m.label)}</th><th>${t('Turismos')}</th>${key === 'mean_age' ? '' : `<th>${t('Edad media')}</th>`}</tr></thead><tbody>${rows
    .map(([, p], i) => `<tr><td><span class="muted tnum" style="display:inline-block;width:26px">${i + 1}</span>${esc(p.name)}</td><td><b>${m.get(p) == null ? '—' : m.fmt(m.get(p)!)}</b></td><td>${int(p.stock)}</td>${key === 'mean_age' ? '' : `<td>${num(p.mean_age, 1)}</td>`}</tr>`)
    .join('')}</tbody>`;
  document.querySelectorAll('#map-metric button').forEach((b) => b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.k === key)));
  history.replaceState(null, '', key === 'mean_age' ? location.pathname : `?k=${key}`);
}
document.querySelectorAll<HTMLButtonElement>('#map-metric button').forEach((b) => b.addEventListener('click', () => ((key = b.dataset.k as K), show())));
const r = Object.values(P).sort((a, b) => b.mean_age - a.mean_age);
document.getElementById('map-lead')!.textContent = t(
  'Edad media del parque de turismos de cada provincia. El más viejo está en {a} ({aa} años) y el más joven en {b} ({bb}). En {a}, el {s} de los coches tiene 20 años o más.',
  { a: r[0]!.name, aa: num(r[0]!.mean_age, 1), b: r[r.length - 1]!.name, bb: num(r[r.length - 1]!.mean_age, 1), s: pct(r[0]!.share_20, 0) },
);
show();
