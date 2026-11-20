import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { fill } from './scripts/placeholders.ts';

export const SITE = 'https://cuantodura.aminox.dev';

/** `<!--#name-->` is replaced by src/site/partials/name.html (name-en.html on English pages). */
function partials(): Plugin {
  const dir = resolve(__dirname, 'src/site/partials');
  return {
    name: 'partials',
    transformIndexHtml(html) {
      const lang = /<html lang="(\w+)"/.exec(html)?.[1] ?? 'es';
      const other = lang === 'en' ? 'es' : 'en';
      const href = new RegExp(`<link rel="alternate" hreflang="${other}" href="https://cuantodura\\.aminox\\.dev([^"]*)"`).exec(html)?.[1];
      const out = html.replace(/<!--#([\w-]+)-->/g, (_, name: string) => {
        let file = join(dir, `${name}-${lang}.html`);
        try {
          readFileSync(file);
        } catch {
          file = join(dir, `${name}.html`);
        }
        return readFileSync(file, 'utf8')
          .replaceAll('{{alt-href}}', href ?? (other === 'en' ? '/en/' : '/'))
          .replaceAll('{{alt-lang}}', other)
          .replaceAll('{{alt-label}}', other === 'en' ? 'EN' : 'ES')
          .replaceAll('{{alt-title}}', other === 'en' ? 'Read in English' : 'Leer en español');
      });
      return fill(out, __dirname);
    },
  };
}

/** Dev only: /modelo/<slug>/ is served by the template (production pages are prerendered). */
function modelRoutes(): Plugin {
  return {
    name: 'model-routes',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const m = /^\/(modelo|en\/model)\/([a-z0-9-]+)\/?(\?.*)?$/.exec(req.url ?? '');
        if (m) req.url = `/${m[1]}/index.html`;
        next();
      });
    },
  };
}

export const PAGES = [
  'index.html', 'modelo/index.html', 'comparar/index.html', 'tu-coche/index.html', 'mapa/index.html', 'rankings/index.html',
  'metodologia/index.html', 'fuentes/index.html', 'aviso-legal/index.html', 'privacidad/index.html', 'terminos/index.html', '404.html',
  'en/index.html', 'en/model/index.html', 'en/compare/index.html', 'en/your-car/index.html', 'en/map/index.html', 'en/rankings/index.html',
  'en/methodology/index.html', 'en/sources/index.html', 'en/legal-notice/index.html', 'en/privacy/index.html', 'en/terms/index.html',
];

export default defineConfig({
  plugins: [modelRoutes(), partials()],
  build: { target: 'es2022', rollupOptions: { input: PAGES.map((p) => resolve(__dirname, p)) } },
});
