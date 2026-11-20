// Two languages: Spanish (source text, served at /) and English (under /en/).
// t() takes the Spanish text as the key, so the code stays readable and a missing
// translation falls back to Spanish. tests/i18n.test.ts fails if a t('…') has no English entry.
import { EN } from './i18n.en.ts';

export type Lang = 'es' | 'en';

export const lang: Lang =
  typeof document !== 'undefined' && document.documentElement.lang.startsWith('en') ? 'en' : 'es';
export const locale = lang === 'en' ? 'en-GB' : 'es-ES';

export function t(es: string, vars?: Record<string, string | number>): string {
  let s = lang === 'en' ? (EN[es] ?? es) : es;
  if (vars) s = s.replace(/\{(\w+)\}/g, (_: string, k: string) => String(vars[k] ?? ''));
  return s;
}

/** Localised URL paths: Spanish slugs at /, English under /en/. */
const ROUTES: Record<string, string> = {
  '/': '/en/',
  '/modelo/': '/en/model/',
  '/comparar/': '/en/compare/',
  '/tu-coche/': '/en/your-car/',
  '/mapa/': '/en/map/',
  '/rankings/': '/en/rankings/',
  '/metodologia/': '/en/methodology/',
  '/fuentes/': '/en/sources/',
  '/aviso-legal/': '/en/legal-notice/',
  '/privacidad/': '/en/privacy/',
  '/terminos/': '/en/terms/',
};
export function path(es: string): string {
  if (lang === 'es') return es;
  if (ROUTES[es]) return ROUTES[es]!;
  if (es.startsWith('/modelo/')) return '/en/model/' + es.slice('/modelo/'.length);
  return '/en' + es;
}
export const modelUrl = (slug: string) => path(`/modelo/${slug}/`);

const nf = (d: number) => new Intl.NumberFormat(locale, { minimumFractionDigits: d, maximumFractionDigits: d });
const cache = new Map<number, Intl.NumberFormat>();
export function num(x: number | null | undefined, d = 0): string {
  if (x == null || !isFinite(x)) return '—';
  let f = cache.get(d);
  if (!f) cache.set(d, (f = nf(d)));
  return f.format(x);
}
/** Integers with thousands separators also for 4-digit numbers (es-ES omits them by default). */
export function int(x: number | null | undefined): string {
  if (x == null || !isFinite(x)) return '—';
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0, useGrouping: 'always' } as unknown as Intl.NumberFormatOptions).format(Math.round(x));
}
export const pct = (x: number | null | undefined, d = 0) => (x == null ? '—' : `${num(x * 100, d)} %`);
export const years = (x: number | null | undefined, d = 1) => (x == null ? '—' : t('{n} años', { n: num(x, d) }));
export function compact(x: number): string {
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(x);
}
export function monthName(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(new Date(Date.UTC(y!, m! - 1, 15)));
}
