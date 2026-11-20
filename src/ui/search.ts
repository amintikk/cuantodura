// Model search with autocomplete (ARIA 1.2 combobox + listbox pattern).
import { fold, load, segmentName, type IndexEntry } from '../data.ts';
import { int, modelUrl, t, years } from '../i18n.ts';
import { esc } from '../charts/survival.ts';

let seq = 0;

export function score(q: string, e: IndexEntry & { _f?: string; _m?: string }): number {
  const f = (e._f ??= fold(e.name));
  const m = (e._m ??= fold(e.model));
  if (!q) return 0;
  let s = 0;
  if (m.startsWith(q) || f.startsWith(q)) s = 3;
  else if (f.split(' ').some((w) => w.startsWith(q))) s = 2;
  else if (q.split(' ').every((w) => f.includes(w))) s = 1;
  else return 0;
  return s + Math.log10(1 + e.now) / 10;
}

export interface SearchOpts {
  placeholder?: string;
  onPick?: (e: IndexEntry) => void;
  exclude?: () => string[];
  big?: boolean;
}

export function mountSearch(root: HTMLElement, opts: SearchOpts = {}): HTMLInputElement {
  const id = `s${++seq}`;
  root.classList.add('search');
  if (opts.big) root.classList.add('search-big');
  root.innerHTML = `<label class="sr-only" for="${id}-in">${t('Busca un modelo')}</label>
    <svg class="search-ico" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M21 21l-4.34-4.34M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16z"/></svg>
    <input id="${id}-in" type="search" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${id}-list"
      autocomplete="off" spellcheck="false" placeholder="${esc(opts.placeholder ?? t('Busca tu coche: Ibiza, Golf, Corolla…'))}" />
    <ul id="${id}-list" role="listbox" hidden aria-label="${t('Modelos')}"></ul>`;
  const input = root.querySelector('input')!;
  const list = root.querySelector('ul')!;
  let items: IndexEntry[] = [];
  let active = -1;
  let all: IndexEntry[] | null = null;
  const ensure = async () => (all ??= (await load<{ models: IndexEntry[] }>('index')).models);

  const close = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  };
  const pick = (e: IndexEntry) => {
    close();
    if (opts.onPick) {
      input.value = '';
      opts.onPick(e);
    } else location.href = modelUrl(e.slug);
  };
  const highlight = (name: string, q: string) => {
    const i = fold(name).indexOf(q);
    if (i < 0 || !q) return esc(name);
    return esc(name.slice(0, i)) + '<b>' + esc(name.slice(i, i + q.length)) + '</b>' + esc(name.slice(i + q.length));
  };
  const renderList = (q: string) => {
    list.innerHTML = items.length
      ? items
          .map(
            (e, i) =>
              `<li role="option" id="${id}-o${i}" aria-selected="${i === active}" data-i="${i}"><span class="opt-name">${highlight(e.name, q)}</span><span class="opt-meta">${
                e.median != null ? years(e.median) : e.segment ? segmentName(e.segment) : ''
              } · ${int(e.now)}</span></li>`,
          )
          .join('')
      : `<li class="empty">${t('Sin resultados. Prueba con el nombre comercial: «León», «Clase C», «Serie 3».')}</li>`;
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    if (active >= 0) input.setAttribute('aria-activedescendant', `${id}-o${active}`);
    else input.removeAttribute('aria-activedescendant');
  };
  const update = async () => {
    const q = fold(input.value);
    if (!q) return close();
    const data = await ensure();
    const ex = new Set(opts.exclude?.() ?? []);
    items = data
      .filter((e) => !ex.has(e.slug))
      .map((e) => [score(q, e), e] as const)
      .filter(([s]) => s > 0)
      .sort((a, b) => b[0] - a[0])
      .slice(0, 8)
      .map(([, e]) => e);
    active = items.length ? 0 : -1;
    renderList(q);
  };
  input.addEventListener('input', update);
  input.addEventListener('focus', () => void ensure());
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      if (list.hidden) return void update();
      active = (active + (ev.key === 'ArrowDown' ? 1 : -1) + items.length) % Math.max(1, items.length);
      renderList(fold(input.value));
      list.querySelector(`#${id}-o${active}`)?.scrollIntoView({ block: 'nearest' });
      ev.preventDefault();
    } else if (ev.key === 'Enter') {
      if (items[active]) {
        pick(items[active]!);
        ev.preventDefault();
      }
    } else if (ev.key === 'Escape') close();
  });
  list.addEventListener('mousedown', (ev) => ev.preventDefault());
  list.addEventListener('click', (ev) => {
    const li = (ev.target as HTMLElement).closest<HTMLElement>('[data-i]');
    if (li) pick(items[Number(li.dataset.i)]!);
  });
  input.addEventListener('blur', () => setTimeout(close, 120));
  return input;
}
