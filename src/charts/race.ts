// "Race" of models: as the age advances, the bars show the share of each model still registered
// and the rows reorder. Plays once when scrolled into view; play/pause, slider and keyboard control.
import { load, segmentName } from '../data.ts';
import { modelUrl, num, pct, t } from '../i18n.ts';
import { esc } from './survival.ts';
import { icon } from '../ui/icons.ts';

interface RaceModel {
  slug: string;
  name: string;
  segment: string;
  S: number[];
  median: number;
}
const ROW = 44;
const N = 10;

export async function mountRace(root: HTMLElement): Promise<void> {
  const data = await load<{ ages: number[]; models: RaceModel[] }>('race');
  const pool = data.models.filter((m) => m.S[25] != null);
  const sets = {
    long: [...pool].sort((a, b) => b.S[25]! - a.S[25]!).slice(0, N),
    short: [...pool].sort((a, b) => a.S[25]! - b.S[25]!).slice(0, N),
  };
  let which: 'long' | 'short' = 'long';
  let age = 0;
  let timer = 0;
  const maxAge = 30;

  root.classList.add('race');
  root.innerHTML = `
    <div class="race-controls">
      <div class="seg" role="group" aria-label="${t('Qué modelos mostrar')}">
        <button type="button" data-set="long" aria-pressed="true">${t('Los más longevos')}</button>
        <button type="button" data-set="short" aria-pressed="false">${t('Los que menos duran')}</button>
      </div>
      <button type="button" class="btn small" data-play></button>
      <label class="small muted" style="display:flex;align-items:center;gap:10px;flex:1;min-width:220px">
        <span>${t('Edad')}</span><input type="range" min="0" max="${maxAge}" step="1" value="0" aria-label="${t('Edad en años')}" />
      </label>
    </div>
    <div class="race-age" aria-hidden="true"><span data-age>0</span><small>${t('años desde la primera matriculación')}</small></div>
    <p class="sr-only" aria-live="polite" data-live></p>
    <div class="race-board" style="height:${N * ROW}px"></div>
    <p class="caption">${t('Porcentaje de coches de cada modelo que sigue dado de alta a cada edad, según las bajas de los últimos 12 meses. Solo modelos con datos propios hasta los 25 años como mínimo.')}</p>`;
  const board = root.querySelector<HTMLElement>('.race-board')!;
  const slider = root.querySelector<HTMLInputElement>('input[type=range]')!;
  const playBtn = root.querySelector<HTMLButtonElement>('[data-play]')!;
  const ageEl = root.querySelector<HTMLElement>('[data-age]')!;
  const live = root.querySelector<HTMLElement>('[data-live]')!;
  const rows = new Map<string, HTMLElement>();

  const build = () => {
    board.replaceChildren();
    rows.clear();
    root.classList.toggle('short', which === 'short');
    for (const m of sets[which]) {
      const r = document.createElement('div');
      r.className = 'race-row';
      r.innerHTML = `<span class="rank"></span><a class="name" href="${modelUrl(m.slug)}" title="${esc(segmentName(m.segment))}">${esc(m.name)}</a><div class="bar-wrap"><div class="bar"></div><span class="val"></span></div>`;
      board.append(r);
      rows.set(m.slug, r);
    }
  };
  const draw = (announce = false) => {
    const list = [...sets[which]].sort((a, b) => b.S[age]! - a.S[age]! || a.name.localeCompare(b.name));
    list.forEach((m, i) => {
      const r = rows.get(m.slug)!;
      r.style.transform = `translateY(${i * ROW}px)`;
      r.querySelector<HTMLElement>('.rank')!.textContent = String(i + 1);
      const w = (m.S[age] ?? 0) * 100;
      r.querySelector<HTMLElement>('.bar')!.style.width = `calc(${w}% - ${w * 0.6}px)`;
      const v = r.querySelector<HTMLElement>('.val')!;
      v.style.left = `calc(${w}% - ${w * 0.6}px)`;
      v.textContent = pct(m.S[age], age < 15 ? 1 : 0);
    });
    ageEl.textContent = String(age);
    slider.value = String(age);
    if (announce) {
      live.textContent = t('A los {n} años', { n: age }) + ': ' + list.slice(0, 3).map((m) => `${m.name} ${pct(m.S[age], 0)}`).join(', ');
    }
  };
  const setPlay = (on: boolean) => {
    playBtn.replaceChildren(icon(on ? 'pause' : age >= maxAge ? 'replay' : 'play', 16), document.createTextNode(on ? t('Pausa') : age >= maxAge ? t('Repetir') : t('Reproducir')));
    playBtn.setAttribute('aria-pressed', String(on));
  };
  const stop = () => {
    clearInterval(timer);
    timer = 0;
    setPlay(false);
  };
  const play = () => {
    if (age >= maxAge) age = 0;
    clearInterval(timer);
    timer = window.setInterval(() => {
      age++;
      draw();
      if (age >= maxAge) {
        stop();
        draw(true);
      }
    }, 420);
    setPlay(true);
  };
  playBtn.addEventListener('click', () => (timer ? stop() : play()));
  slider.addEventListener('input', () => {
    stop();
    age = Number(slider.value);
    draw(true);
  });
  root.querySelectorAll<HTMLButtonElement>('[data-set]').forEach((b) =>
    b.addEventListener('click', () => {
      which = b.dataset.set as 'long' | 'short';
      root.querySelectorAll('[data-set]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      build();
      draw(true);
    }),
  );
  build();
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    age = 25;
    draw();
    setPlay(false);
    return;
  }
  draw();
  setPlay(false);
  new IntersectionObserver(
    (es, io) => {
      if (es.some((e) => e.isIntersecting)) {
        io.disconnect();
        setTimeout(play, 400);
      }
    },
    { threshold: 0.4 },
  ).observe(board);
  void num;
}
