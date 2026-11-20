import { boot } from '../site/site.ts';
import { fuelName, load, FUEL_ORDER, type Overview, type Province } from '../data.ts';
import { num, path, pct, t } from '../i18n.ts';
import { curveTable, SurvivalChart, type Series } from '../charts/survival.ts';
import { mountRace } from '../charts/race.ts';
import { renderLine } from '../charts/line.ts';
import { renderMap } from '../charts/map.ts';
import { mountSearch } from '../ui/search.ts';

boot();
mountSearch(document.getElementById('hero-search')!, { big: true });

const ov = await load<Overview>('overview');
const nat = ov.national;

// Hero: the national curve with its confidence band.
const hero = new SurvivalChart(document.getElementById('hero-chart')!, {
  ariaLabel: t('Curva de supervivencia de todos los turismos de España'),
  big: true,
  annotateMedian: true,
  endLabels: false,
  height: 460,
});
const natSeries: Series = { id: 'all', label: t('Todos los turismos'), S: nat.curve.S, lo: nat.curve.lo, hi: nat.curve.hi, color: 'var(--accent)', kind: 'main', median: nat.median };
hero.setSeries([natSeries]);
document.getElementById('hero-cap')!.after(curveTable([natSeries]));

// Race.
void mountRace(document.getElementById('race')!);

// Fuels.
const COLORS = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)'];
const fuels = FUEL_ORDER.filter((f) => ov.fuels[f]?.enough && ['gasolina', 'diesel', 'hibrido', 'electrico'].includes(f));
const fuelSeries: Series[] = [
  { id: 'all', label: t('Media'), S: nat.curve.S, color: 'var(--faint)', kind: 'ref' },
  ...fuels.map((f, i) => ({ id: f, label: fuelName(f), S: ov.fuels[f]!.curve.S, obs: ov.fuels[f]!.curve.obs, color: COLORS[i]!, kind: 'rival' as const })),
];
const fc = new SurvivalChart(document.getElementById('fuel-chart')!, { ariaLabel: t('Supervivencia por combustible'), height: 400 });
fc.setSeries(fuelSeries);
document.getElementById('fuel-chart')!.parentElement!.append(curveTable(fuelSeries));
const g = ov.fuels.gasolina, d = ov.fuels.diesel;
if (g?.median && d?.median) {
  document.getElementById('fuel-lead')!.textContent = t(
    'Un diésel tiene una vida mediana de {d} años y un gasolina, de {g}. A los 20 años sigue de alta el {d20} de los diésel y el {g20} de los gasolina. Los híbridos y eléctricos aún son jóvenes: su tramo largo se estima con la media y aparece punteado.',
    { d: num(d.median, 1), g: num(g.median, 1), d20: pct(d.s['20'], 0), g20: pct(g.s['20'], 0) },
  );
}

// History of the age at voluntary de-registration.
const hist = Object.entries(ov.history)
  .map(([y, v]) => ({ y: Number(y), v: v.motivos?.voluntaria?.median_age, n: v.motivos?.voluntaria?.n, months: v.months }))
  .filter((h) => h.v != null && h.months >= 6);
if (hist.length > 1) {
const first = hist[0]!, last = hist[hist.length - 1]!;
document.getElementById('hist-lead')!.textContent = t(
  'En {y0}, la mitad de los coches que sus dueños daban de baja tenía menos de {a0} años. En {y1}, menos de {a1}: {d} años más en algo más de una década.',
  { y0: first.y, a0: num(first.v!, 1), y1: last.y, a1: num(last.v!, 1), d: num(last.v! - first.v!, 1) },
);
renderLine(document.getElementById('hist-chart')!, [{ name: t('Edad mediana'), color: 'var(--accent)', points: hist.map((h) => ({ x: h.y, y: h.v!, label: `${h.y}: ${t('{n} años', { n: num(h.v!, 1) })} · ${num(h.n!)} ${t('bajas')}` })) }], {
  ariaLabel: t('Edad mediana de los turismos dados de baja voluntariamente, por año'),
  yFormat: (v) => num(v, 0),
  labelFormat: (v) => t('{n} años', { n: num(v, 1) }),
});
}

// Map teaser.
const pv = await load<{ provinces: Record<string, Province> }>('provinces');
const P = pv.provinces;
const ranked = Object.entries(P).sort((a, b) => b[1].mean_age - a[1].mean_age);
document.getElementById('map-lead')!.textContent = t(
  'El parque más viejo está en {a} ({aa} años de media) y el más joven, en {b} ({bb}).',
  { a: ranked[0]![1].name, aa: num(ranked[0]![1].mean_age, 1), b: ranked[ranked.length - 1]![1].name, bb: num(ranked[ranked.length - 1]![1].mean_age, 1) },
);
renderMap(document.getElementById('map-teaser')!, {
  values: Object.fromEntries(Object.entries(P).map(([c, p]) => [c, p.mean_age])),
  names: Object.fromEntries(Object.entries(P).map(([c, p]) => [c, p.name])),
  format: (v) => t('{n} años', { n: num(v, 1) }),
  label: t('Edad media del parque'),
  onClick: () => (location.href = path('/mapa/')),
});
