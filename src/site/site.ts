// Shared by every page: fonts, theme, mobile menu, header search, reveal-on-scroll, consent.
import '@fontsource-variable/inter';
import '../styles/site.css';
import { hydrateIcons, icon } from '../ui/icons.ts';
import { mountSearch } from '../ui/search.ts';
import { initConsent } from './consent.ts';
import { t } from '../i18n.ts';

const KEY = 'cuantodura-theme';
(window as unknown as { cdReady?: boolean }).cdReady = true;

const readTheme = () => {
  try {
    return localStorage.getItem(KEY) ?? 'auto';
  } catch {
    return 'auto';
  }
};
const isDark = (th: string) => th === 'dark' || (th !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);

const themeListeners: (() => void)[] = [];
export const onTheme = (f: () => void) => themeListeners.push(f);

function applyTheme(th: string) {
  if (th === 'dark' || th === 'light') document.documentElement.dataset.theme = th;
  else delete document.documentElement.dataset.theme;
  const b = document.getElementById('btn-theme');
  if (b) {
    b.replaceChildren(icon(isDark(th) ? 'sun' : 'moon', 18));
    b.setAttribute('aria-label', isDark(th) ? t('Usar tema claro') : t('Usar tema oscuro'));
    b.title = b.getAttribute('aria-label')!;
  }
  themeListeners.forEach((f) => f());
}

function wireTheme() {
  let th = readTheme();
  applyTheme(th);
  document.getElementById('btn-theme')?.addEventListener('click', () => {
    th = isDark(th) ? 'light' : 'dark';
    try {
      localStorage.setItem(KEY, th);
    } catch {
      /* storage blocked: switch for this page only */
    }
    applyTheme(th);
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(th));
}

function wireNav() {
  const toggle = document.getElementById('nav-toggle');
  const nav = document.getElementById('site-nav');
  if (!toggle || !nav) return;
  const set = (open: boolean) => {
    document.body.classList.toggle('nav-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.replaceChildren(icon(open ? 'x' : 'menu', 20));
  };
  toggle.addEventListener('click', () => set(!document.body.classList.contains('nav-open')));
  nav.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('a')) set(false);
  });
  document.addEventListener('keydown', (e) => e.key === 'Escape' && set(false));
  // Mark the current section.
  const here = location.pathname;
  nav.querySelectorAll<HTMLAnchorElement>('a').forEach((a) => {
    const p = new URL(a.href).pathname;
    if (p !== '/' && p !== '/en/' && here.startsWith(p)) a.setAttribute('aria-current', 'page');
  });
}

function reveal() {
  const els = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window)) return els.forEach((e) => e.classList.add('in'));
  const io = new IntersectionObserver(
    (es) =>
      es.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('in');
          io.unobserve(e.target);
        }
      }),
    { rootMargin: '0px 0px -8% 0px' },
  );
  els.forEach((e) => io.observe(e));
}

/** Web Share API with clipboard fallback. */
export function wireShare(root: ParentNode = document) {
  root.querySelectorAll<HTMLButtonElement>('[data-share]').forEach((b) =>
    b.addEventListener('click', async () => {
      const url = location.href.split('#')[0]!;
      const title = document.title;
      try {
        if (navigator.share) return await navigator.share({ title, url });
      } catch {
        return;
      }
      try {
        await navigator.clipboard.writeText(url);
        const old = b.lastChild!.textContent;
        b.lastChild!.textContent = t('Enlace copiado');
        setTimeout(() => (b.lastChild!.textContent = old), 1800);
      } catch {
        prompt(t('Copia el enlace'), url);
      }
    }),
  );
}

export function boot() {
  hydrateIcons();
  wireTheme();
  wireNav();
  const top = document.getElementById('top-search');
  if (top) mountSearch(top, { placeholder: t('Buscar modelo…') });
  addEventListener('scroll', () => document.documentElement.classList.toggle('scrolled', scrollY > 8), { passive: true });
  reveal();
  wireShare();
  initConsent();
}
