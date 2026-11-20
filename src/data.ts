import { lang, t } from './i18n.ts';

export interface Curve {
  S: (number | null)[];
  lo: (number | null)[];
  hi: (number | null)[];
  obs: number[];
  q: (number | null)[];
}
export interface Summary {
  deaths: number;
  exports: number;
  exposure: number;
  enough: boolean;
  median: number | null;
  median_lo: number | null;
  median_hi: number | null;
  median_hint: number | null;
  s: Record<string, number | null>;
  index: number | null;
  index_lo: number | null;
  index_hi: number | null;
  export_rate: number | null;
  observed_to: number;
}
export interface Meta {
  window: [string, string];
  exposure_snapshot: string;
  stock_snapshot: string;
  generated: string;
  max_age: number;
  imputation: { mid: Record<string, number>; now: Record<string, number> };
  thresholds: Record<string, number>;
}
export interface IndexEntry {
  slug: string;
  name: string;
  brand: string;
  model: string;
  segment: string;
  now: number;
  enough: boolean;
  median: number | null;
  median_lo: number | null;
  median_hi: number | null;
  median_hint: number | null;
  s10: number | null;
  s15: number | null;
  s20: number | null;
  s25: number | null;
  index: number | null;
  index_lo: number | null;
  index_hi: number | null;
  export_rate: number | null;
  old_export_rate?: number | null;
  old_exports?: number;
  deaths: number;
  exports: number;
  observed_to: number;
  fuel_mix: Record<string, number>;
}
export interface SubEntry {
  key: string | string[];
  label: string;
  deaths: number;
  exposure: number;
  index: number | null;
  index_lo: number | null;
  index_hi: number | null;
  s15: number | null;
  s20: number | null;
  median: number | null;
  curve?: { S: number[]; obs: number[] };
}
export interface ModelDoc {
  slug: string;
  name: string;
  brand: string;
  brand_key: string;
  model: string;
  segment: string;
  summary: Summary;
  curve: Curve;
  now: number;
  now_mean_age: number | null;
  imputed_share: number;
  death_median_age: number | null;
  export_median_age: number | null;
  motivos: Record<string, number>;
  exports_by_age?: Record<'young' | 'mid' | 'old', { n: number; stock: number }>;
  fuels: SubEntry[];
  engines: SubEntry[];
  power: SubEntry[];
  generations: SubEntry[];
  provinces: Record<string, number>;
  years: Record<string, number>;
  history: Record<string, [number, number]>;
  rivals: { slug: string; name: string; S: number[]; obs: number[]; median: number | null; index: number | null }[];
  segment_curve: number[] | null;
  meta: { window: [string, string]; stock_snapshot: string };
}
export interface GroupEntry extends Summary {
  label: string;
  curve: Curve;
  slug?: string;
}
export interface Overview {
  meta: Meta;
  national: Summary & {
    curve: Curve;
    m: number[];
    stock: number;
    stock_median_age: number;
    death_median_age: number;
    motivos: Record<string, number>;
    exports_by_age?: Record<'young' | 'mid' | 'old', { n: number; stock: number }>;
    stock_ages: [number, number][];
    sensitivity_without_a: { median: number; s20: number; s25: number };
  };
  fuels: Record<string, GroupEntry>;
  segments: Record<string, GroupEntry>;
  history: Record<
    string,
    {
      bajas: { n: number; median_age: number; mean_age: number };
      export?: { n: number; median_age: number; mean_age: number };
      months: number;
      motivos?: Record<string, { n: number; median_age: number }>;
      fuels: Record<string, { n: number; median_age: number }>;
    }
  >;
}
export interface Province {
  name: string;
  deaths: number;
  exports: number;
  median: number | null;
  index: number | null;
  index_lo: number | null;
  index_hi: number | null;
  export_rate: number | null;
  stock: number;
  mean_age: number;
  median_age: number;
  share_20: number;
  share_30: number;
}

const memo = new Map<string, Promise<unknown>>();
export function load<T>(name: string): Promise<T> {
  if (!memo.has(name)) {
    memo.set(
      name,
      fetch(`/data/${name}.json`).then((r) => {
        if (!r.ok) throw new Error(`${name}: ${r.status}`);
        return r.json();
      }),
    );
  }
  return memo.get(name) as Promise<T>;
}
export const loadModel = (slug: string) => load<ModelDoc>(`m/${slug}`);

const SEGMENTS: Record<string, [string, string]> = {
  urbano: ['Urbanos', 'City cars'],
  utilitario: ['Utilitarios', 'Superminis'],
  compacto: ['Compactos', 'Compact cars'],
  berlina: ['Berlinas medias', 'Family cars'],
  ejecutivo: ['Berlinas grandes', 'Executive cars'],
  monovolumen: ['Monovolúmenes', 'MPVs'],
  'suv-pequeno': ['SUV pequeños', 'Small SUVs'],
  'suv-compacto': ['SUV compactos', 'Compact SUVs'],
  'suv-grande': ['SUV grandes', 'Large SUVs'],
  todoterreno: ['Todoterrenos', 'Off-roaders'],
  deportivo: ['Deportivos y descapotables', 'Sports cars & convertibles'],
  ludospace: ['Furgonetas mixtas', 'Leisure vans'],
};
export const segmentName = (s: string, singular = false) => {
  const v = SEGMENTS[s];
  if (!v) return s || t('Sin segmento');
  const name = v[lang === 'en' ? 1 : 0];
  return singular ? name : name;
};
export const SEGMENT_KEYS = Object.keys(SEGMENTS);

const FUELS: Record<string, [string, string]> = {
  gasolina: ['Gasolina', 'Petrol'],
  diesel: ['Diésel', 'Diesel'],
  hibrido: ['Híbrido', 'Hybrid'],
  enchufable: ['Híbrido enchufable', 'Plug-in hybrid'],
  electrico: ['Eléctrico', 'Electric'],
  gas: ['Gas (GLP/GNC)', 'Gas (LPG/CNG)'],
  otros: ['Otros', 'Other'],
};
export const fuelName = (f: string) => FUELS[f]?.[lang === 'en' ? 1 : 0] ?? f;
export const FUEL_ORDER = ['gasolina', 'diesel', 'hibrido', 'enchufable', 'electrico', 'gas'];

const MOTIVOS: Record<string, [string, string]> = {
  voluntaria: ['Baja voluntaria', 'Voluntary de-registration'],
  desguace: ['Desguace', 'Scrapping'],
  codigo_a: ['Código A (sin documentar)', 'Code A (undocumented)'],
  codigo_c: ['Código C (sin documentar)', 'Code C (undocumented)'],
  otros_motivos: ['Otros motivos', 'Other reasons'],
  renove: ['Plan Renove', 'Scrappage scheme (Plan Renove)'],
  otros: ['Otros códigos', 'Other codes'],
  exportacion: ['Exportación o tránsito UE', 'Export or EU transfer'],
};
export const motivoName = (k: string) => MOTIVOS[k]?.[lang === 'en' ? 1 : 0] ?? k;
export const MOTIVO_ORDER = ['voluntaria', 'codigo_a', 'desguace', 'codigo_c', 'otros_motivos', 'renove', 'otros'];

/** Normalise for search: lower case, no accents, alphanumerics only. */
export const fold = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
