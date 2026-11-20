// Fills `{{name}}` placeholders in the static HTML with figures from public/data/overview.json,
// so search engines and visitors without JavaScript read the real numbers.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const fmt = (lang: string, x: number, d = 1) =>
  new Intl.NumberFormat(lang === 'en' ? 'en-GB' : 'es-ES', { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: 'always' } as unknown as Intl.NumberFormatOptions).format(x);
const monthYear = (lang: string, ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y!, m! - 1, 15)));
};

export function values(root: string, lang: string): Record<string, string> {
  const f = resolve(root, 'public/data/overview.json');
  if (!existsSync(f)) return {};
  const ov = JSON.parse(readFileSync(f, 'utf8'));
  const n = ov.national;
  const m = ov.meta;
  const pct = (x: number) => `${fmt(lang, x * 100, 0)} %`;
  const years = Object.keys(ov.history).map(Number).sort();
  const en = lang === 'en';
  return {
    'nat-median': fmt(lang, n.median, 1),
    'nat-s15': pct(n.s['15']),
    'nat-s20': pct(n.s['20']),
    'nat-s25': pct(n.s['25']),
    'death-median': fmt(lang, n.death_median_age, 1),
    'stock-median-age': fmt(lang, n.stock_median_age, 1),
    'stock-millions': fmt(lang, n.stock / 1e6, 1),
    'nat-deaths': fmt(lang, n.deaths, 0),
    'nat-exports': fmt(lang, n.exports, 0),
    'window-text': en ? `${monthYear(lang, m.window[0])} to ${monthYear(lang, m.window[1])}` : `${monthYear(lang, m.window[0])} a ${monthYear(lang, m.window[1])}`,
    'window-iso': `${m.window[0]}/${m.window[1]}`,
    'exposure-month': monthYear(lang, m.exposure_snapshot),
    'stock-month': monthYear(lang, m.stock_snapshot),
    'data-updated': monthYear('es', m.window[1]),
    'data-updated-en': monthYear('en', m.window[1]),
    'generated-date': m.generated.slice(0, 10),
    'hist-range': `${years[0]}–${years[years.length - 1]}`,
    'imputed-pct': `${fmt(lang, (100 * m.imputation.mid.enmascarados) / m.imputation.mid.total, 0)} %`,
    'sens-median': n.sensitivity_without_a ? fmt(lang, n.sensitivity_without_a.median, 1) : '—',
    'min-deaths': fmt(lang, m.thresholds.min_deaths, 0),
    'min-exposure': fmt(lang, m.thresholds.min_exposure, 0),
    'min-age-exposure': fmt(lang, m.thresholds.min_age_exposure, 0),
    'median-max-ci': fmt(lang, m.thresholds.median_max_ci, 0),
    'models-count': fmt(lang, 0, 0),
  };
}

export function fill(html: string, root: string, extra: Record<string, string> = {}): string {
  const lang = /<html lang="(\w+)"/.exec(html)?.[1] ?? 'es';
  const v = { ...values(root, lang), ...extra };
  return html.replace(/\{\{([\w-]+)\}\}/g, (all, k: string) => v[k] ?? all);
}
