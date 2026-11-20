// After `vite build`: one static HTML page per model (es + en) from the model template,
// Open Graph images, sitemap.xml and robots.txt. Reads the data from dist/data.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { metaDescription, statsHtml, verdictHtml, type L } from '../src/verdict.ts';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const SITE = 'https://cuantodura.aminox.dev';
const FONTS = ['Inter-500', 'Inter-700', 'Inter-800'].map((f) => join(ROOT, 'scripts/fonts', `${f}.ttf`));
const read = (p: string) => JSON.parse(readFileSync(join(DIST, 'data', p), 'utf8'));

const ov = read('overview.json');
const idx = read('index.json');
const natMedian: number = ov.national.median;
const generated: string = ov.meta.generated.slice(0, 10);

const SEG: Record<string, [string, string]> = {
  urbano: ['Urbanos', 'City cars'], utilitario: ['Utilitarios', 'Superminis'], compacto: ['Compactos', 'Compact cars'],
  berlina: ['Berlinas medias', 'Family cars'], ejecutivo: ['Berlinas grandes', 'Executive cars'], monovolumen: ['Monovolúmenes', 'MPVs'],
  'suv-pequeno': ['SUV pequeños', 'Small SUVs'], 'suv-compacto': ['SUV compactos', 'Compact SUVs'], 'suv-grande': ['SUV grandes', 'Large SUVs'],
  todoterreno: ['Todoterrenos', 'Off-roaders'], deportivo: ['Deportivos y descapotables', 'Sports cars & convertibles'], ludospace: ['Furgonetas mixtas', 'Leisure vans'],
};
const segName = (s: string, l: L) => SEG[s]?.[l === 'en' ? 1 : 0] ?? '';
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const strip = (s: string) => s.replace(/<[^>]+>/g, '');
const nf = (l: L, x: number, d = 1) => new Intl.NumberFormat(l === 'en' ? 'en-GB' : 'es-ES', { minimumFractionDigits: d, maximumFractionDigits: d }).format(x);

/** Which models get a page: enough data, or many cars on the road. */
const published = idx.models.filter((m: { enough: boolean; now: number }) => m.enough || m.now >= 3000);

// ---------------- model pages ----------------
const templates: Record<L, string> = {
  es: readFileSync(join(DIST, 'modelo/index.html'), 'utf8'),
  en: readFileSync(join(DIST, 'en/model/index.html'), 'utf8'),
};
for (const m of published) {
  const doc = read(`m/${m.slug}.json`);
  const s = doc.summary;
  for (const l of ['es', 'en'] as L[]) {
    const name = doc.name as string;
    const title = l === 'en' ? `How long does the ${name} last? · Cuánto dura` : `¿Cuánto dura un ${name}? · Cuánto dura`;
    const ogTitle =
      s.median != null
        ? l === 'en' ? `${name}: half are still registered at ${nf(l, s.median)} years` : `${name}: la mitad sigue de alta a los ${nf(l, s.median)} años`
        : l === 'en' ? `How long does the ${name} last?` : `¿Cuánto dura un ${name}?`;
    const desc = metaDescription(l, name, s);
    const url = l === 'en' ? `${SITE}/en/model/${m.slug}/` : `${SITE}/modelo/${m.slug}/`;
    const jsonld = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Dataset',
          name: l === 'en' ? `Survival table of the ${name} in Spain` : `Tabla de supervivencia del ${name} en España`,
          description: desc,
          url,
          inLanguage: l,
          license: 'https://opensource.org/licenses/MIT',
          creator: { '@type': 'Person', name: 'Amin Tahtah Toumi' },
          isBasedOn: 'https://www.dgt.es/menusecundario/dgt-en-cifras/',
          temporalCoverage: `${ov.meta.window[0]}/${ov.meta.window[1]}`,
          spatialCoverage: l === 'en' ? 'Spain' : 'España',
          dateModified: generated,
          distribution: { '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: `${SITE}/data/m/${m.slug}.json` },
        },
        {
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: l === 'en' ? 'Home' : 'Inicio', item: l === 'en' ? `${SITE}/en/` : `${SITE}/` },
            { '@type': 'ListItem', position: 2, name: 'Rankings', item: l === 'en' ? `${SITE}/en/rankings/` : `${SITE}/rankings/` },
            { '@type': 'ListItem', position: 3, name, item: url },
          ],
        },
      ],
    };
    const html = templates[l]
      .replaceAll('{{m-slug}}', m.slug)
      .replaceAll('{{m-title}}', esc(title))
      .replaceAll('{{m-og-title}}', esc(ogTitle))
      .replaceAll('{{m-desc}}', esc(desc))
      .replaceAll('{{m-name}}', esc(name))
      .replaceAll('{{m-segment}}', esc(segName(doc.segment, l) || doc.brand))
      .replaceAll('{{m-verdict}}', verdictHtml(l, name, s, natMedian))
      .replaceAll('{{m-stats}}', statsHtml(l, s, doc.now))
      .replaceAll('{{m-jsonld}}', `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, '\\u003c')}</script>`);
    const out = join(DIST, l === 'en' ? `en/model/${m.slug}/index.html` : `modelo/${m.slug}/index.html`);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, html);
  }
}
// The bare templates are not pages.
rmSync(join(DIST, 'modelo/index.html'));
rmSync(join(DIST, 'en/model/index.html'));

// ---------------- Open Graph images ----------------
function curvePath(S: (number | null)[], x0: number, y0: number, w: number, h: number) {
  return S.map((v, a) => (v == null ? '' : `${a ? 'L' : 'M'}${(x0 + (a / 40) * w).toFixed(1)},${(y0 + (1 - v) * h).toFixed(1)}`)).join('');
}
function ogSvg(l: L, title: string, big: string, bigLabel: string, sub: string, S: (number | null)[] | null): string {
  const lines: string[] = [];
  let cur = '';
  for (const w of title.split(' ')) {
    if ((cur + ' ' + w).trim().length > 22) {
      lines.push(cur.trim());
      cur = w;
    } else cur += ' ' + w;
  }
  lines.push(cur.trim());
  const fs = lines.length > 2 ? 60 : 74;
  const natS = ov.national.curve.S as number[];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#f5f1e8"/>
  <rect x="0" y="0" width="1200" height="10" fill="#c2410c"/>
  <g transform="translate(64,60)">
    <rect width="44" height="44" rx="11" fill="#17161a"/>
    <path d="M8.3 12.4C16.5 12.4 19.3 13.1 22.7 17.9S28.2 29.6 35.8 30.6" fill="none" stroke="#f07a3e" stroke-width="3.6" stroke-linecap="round"/>
    <circle cx="23.1" cy="17.6" r="3.2" fill="#fbf9f4"/>
    <text x="60" y="31" font-family="Inter" font-weight="800" font-size="28" fill="#17161a">Cuánto dura</text>
  </g>
  ${lines.map((ln, i) => `<text x="64" y="${190 + i * (fs + 6)}" font-family="Inter" font-weight="800" font-size="${fs}" fill="#17161a" letter-spacing="-2">${esc(ln)}</text>`).join('')}
  <text x="64" y="470" font-family="Inter" font-weight="800" font-size="96" fill="#9a3412" letter-spacing="-3">${esc(big)}</text>
  <text x="64" y="512" font-family="Inter" font-weight="500" font-size="26" fill="#3d3a36">${esc(bigLabel)}</text>
  <text x="64" y="580" font-family="Inter" font-weight="500" font-size="20" fill="#6b665d">${esc(sub)}</text>
  <g transform="translate(660,150)">
    <rect width="480" height="330" rx="18" fill="#fbf9f4" stroke="#ddd5c4"/>
    <line x1="30" x2="450" y1="165" y2="165" stroke="#ddd5c4" stroke-dasharray="4 5"/>
    <path d="${curvePath(natS, 30, 30, 420, 270)}" fill="none" stroke="#9a9488" stroke-width="3"/>
    ${S ? `<path d="${curvePath(S, 30, 30, 420, 270)}" fill="none" stroke="#c2410c" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
    <text x="30" y="318" font-family="Inter" font-weight="500" font-size="16" fill="#6b665d">0</text>
    <text x="450" y="318" font-family="Inter" font-weight="500" font-size="16" fill="#6b665d" text-anchor="end">40 ${l === 'en' ? 'years' : 'años'}</text>
    ${S ? `<text x="450" y="58" font-family="Inter" font-weight="700" font-size="17" fill="#c2410c" text-anchor="end">${esc(title.length > 26 ? title.slice(0, 25) + '…' : title)}</text>` : ''}
    <text x="450" y="${S ? 82 : 58}" font-family="Inter" font-weight="500" font-size="16" fill="#6b665d" text-anchor="end">${l === 'en' ? 'all cars' : 'todos los turismos'}</text>
  </g>
</svg>`;
}
const png = (svg: string) => new Resvg(svg, { font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: 'Inter' }, fitTo: { mode: 'width', value: 1200 } }).render().asPng();
mkdirSync(join(DIST, 'og/en'), { recursive: true });
const win = (l: L) => (l === 'en' ? `DGT data · ${ov.meta.window[0]} to ${ov.meta.window[1]} · cuantodura.aminox.dev` : `Datos de la DGT · ${ov.meta.window[0]} a ${ov.meta.window[1]} · cuantodura.aminox.dev`);
for (const l of ['es', 'en'] as L[]) {
  const svg = ogSvg(l, l === 'en' ? 'How long does a car really last in Spain?' : '¿Cuánto dura de verdad un coche en España?', `${nf(l, natMedian)} ${l === 'en' ? 'years' : 'años'}`, l === 'en' ? 'median life of a passenger car' : 'vida mediana de un turismo', win(l), null);
  writeFileSync(join(DIST, `og/home${l === 'en' ? '-en' : ''}.png`), png(svg));
}
for (const m of published) {
  const doc = read(`m/${m.slug}.json`);
  const s = doc.summary;
  for (const l of ['es', 'en'] as L[]) {
    const yrs = l === 'en' ? 'years' : 'años';
    let big: string, label: string;
    if (s.median != null) [big, label] = [`${nf(l, s.median)} ${yrs}`, l === 'en' ? 'median life (half still registered)' : 'vida mediana (la mitad sigue de alta)'];
    else if (s.s['15'] != null) [big, label] = [`${nf(l, s.s['15'] * 100, 0)} %`, l === 'en' ? 'still registered at 15 years' : 'sigue de alta a los 15 años'];
    else if (s.index != null) [big, label] = [nf(l, s.index, 0), l === 'en' ? 'de-registration index (100 = average)' : 'índice de bajas (100 = media)'];
    else [big, label] = [new Intl.NumberFormat(l === 'en' ? 'en-GB' : 'es-ES').format(doc.now), l === 'en' ? 'registered today' : 'dados de alta hoy'];
    const svg = ogSvg(l, doc.name, big, label, win(l), s.enough ? (doc.curve.S as (number | null)[]).map((v, a) => (a <= s.observed_to + 1 ? v : null)) : null);
    writeFileSync(join(DIST, l === 'en' ? `og/en/${m.slug}.png` : `og/${m.slug}.png`), png(svg));
  }
}

// ---------------- sitemap & robots ----------------
const STATIC: [string, string][] = [
  ['/', '/en/'], ['/rankings/', '/en/rankings/'], ['/comparar/', '/en/compare/'], ['/tu-coche/', '/en/your-car/'], ['/mapa/', '/en/map/'],
  ['/metodologia/', '/en/methodology/'], ['/fuentes/', '/en/sources/'], ['/aviso-legal/', '/en/legal-notice/'], ['/privacidad/', '/en/privacy/'], ['/terminos/', '/en/terms/'],
];
const pairs: [string, string][] = [...STATIC, ...published.map((m: { slug: string }) => [`/modelo/${m.slug}/`, `/en/model/${m.slug}/`] as [string, string])];
const urls = pairs.flatMap(([es, en]) =>
  [es, en].map(
    (u) => `  <url><loc>${SITE}${u}</loc><lastmod>${generated}</lastmod><xhtml:link rel="alternate" hreflang="es" href="${SITE}${es}"/><xhtml:link rel="alternate" hreflang="en" href="${SITE}${en}"/><xhtml:link rel="alternate" hreflang="x-default" href="${SITE}${es}"/></url>`,
  ),
);
writeFileSync(join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`);
writeFileSync(join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /data/\n\nSitemap: ${SITE}/sitemap.xml\n`);
if (!existsSync(join(DIST, '404.html'))) throw new Error('falta 404.html');
console.log(`prerender: ${published.length} modelos × 2 idiomas, ${urls.length} URLs en el sitemap`);
void strip;
