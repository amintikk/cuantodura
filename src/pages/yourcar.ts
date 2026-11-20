import { boot } from '../site/site.ts';
import { fuelName, load, loadModel, type IndexEntry, type ModelDoc, type Overview } from '../data.ts';
import { modelUrl, num, pct, t } from '../i18n.ts';
import { esc, SurvivalChart, type Series } from '../charts/survival.ts';

boot();
const [ov, idx] = await Promise.all([load<Overview>('overview'), load<{ models: IndexEntry[] }>('index')]);
const models = idx.models.filter((m) => m.now >= 500);
const brandSel = document.getElementById('yc-brand') as HTMLSelectElement;
const modelSel = document.getElementById('yc-model') as HTMLSelectElement;
const yearSel = document.getElementById('yc-year') as HTMLSelectElement;
const fuelSel = document.getElementById('yc-fuel') as HTMLSelectElement;
const ans = document.getElementById('yc-answer')!;
const NOW = Number(ov.meta.stock_snapshot.slice(0, 4));
const brands = [...new Set(models.map((m) => m.brand))].sort((a, b) => a.localeCompare(b, 'es'));
brandSel.innerHTML = brands.map((b) => `<option>${esc(b)}</option>`).join('');
const chart = new SurvivalChart(document.getElementById('yc-chart')!, { ariaLabel: t('Probabilidad de seguir de alta en los próximos años'), height: 380, xFrom: 0 });

const params = new URLSearchParams(location.search);
const initial = models.find((m) => m.slug === params.get('m'));
brandSel.value = initial?.brand ?? 'SEAT';

function fillModels() {
  const list = models.filter((m) => m.brand === brandSel.value).sort((a, b) => b.now - a.now);
  modelSel.innerHTML = list.map((m) => `<option value="${m.slug}">${esc(m.model)}</option>`).join('');
}
fillModels();
if (initial) modelSel.value = initial.slug;
let doc: ModelDoc | null = null;

async function fillYears() {
  doc = await loadModel(modelSel.value);
  const ys = Object.entries(doc.years).filter(([, n]) => n >= 50).map(([y]) => Number(y)).filter((y) => y >= NOW - 39 && y <= NOW).sort((a, b) => b - a);
  const prev = Number(params.get('y') ?? yearSel.value) || ys[Math.min(ys.length - 1, 10)];
  yearSel.innerHTML = ys.map((y) => `<option>${y}</option>`).join('');
  yearSel.value = String(ys.includes(prev!) ? prev : ys[Math.min(ys.length - 1, 10)]);
  fuelSel.innerHTML = `<option value="">${t('Cualquiera')}</option>` + doc.fuels.filter((f) => f.curve).map((f) => `<option value="${f.key}">${fuelName(String(f.key))}</option>`).join('');
  compute();
}

function cond(S: (number | null)[], a: number, k: number): number | null {
  const s0 = S[a], s1 = S[Math.min(40, a + k)];
  return s0 && s1 != null ? s1 / s0 : null;
}

function compute() {
  if (!doc) return;
  const y = Number(yearSel.value);
  const age = Math.max(0, Math.min(35, NOW - y));
  const fuel = fuelSel.value;
  const f = fuel ? doc.fuels.find((x) => x.key === fuel) : null;
  const S = f?.curve?.S ?? doc.curve.S;
  const obs = f?.curve?.obs ?? doc.curve.obs;
  const p = cond(S, age, 5);
  const pAll = cond(ov.national.curve.S, age, 5);
  const borrowed = obs.slice(age, age + 5).some((o) => !o);
  history.replaceState(null, '', `?m=${doc.slug}&y=${y}${fuel ? `&f=${fuel}` : ''}`);
  const name = `${doc.name}${f ? ' ' + fuelName(fuel).toLowerCase() : ''}`;
  if (!doc.summary.enough || p == null) {
    ans.innerHTML = `<p class="pill warn">${t('Pocos datos')}</p><p class="lead">${t('No hay bajas suficientes del {n} para dar una probabilidad fiable.', { n: esc(doc.name) })}</p>`;
    document.getElementById('yc-more')!.hidden = true;
    return;
  }
  const diff = pAll != null ? (p - pAll) * 100 : 0;
  const cmp =
    pAll == null
      ? ''
      : Math.abs(diff) < 1
        ? t('Igual que la media de los coches de su quinta ({a}).', { a: pct(pAll, 0) })
        : diff > 0
          ? t('{d} puntos más que la media de los coches de su quinta ({a}).', { d: num(diff, 0), a: pct(pAll, 0) })
          : t('{d} puntos menos que la media de los coches de su quinta ({a}).', { d: num(-diff, 0), a: pct(pAll, 0) });
  ans.innerHTML = `<p class="muted" style="margin:0 0 6px">${t('Un {n} de {y} ({a} años) tiene una probabilidad de seguir dado de alta en {y5} del', { n: esc(name), y, a: age, y5: NOW + 5 })}</p>
    <div class="big">${pct(p, 0)}</div>
    <p class="lead" style="margin-top:12px">${cmp}${borrowed ? ' ' + t('Parte de esos años se estima con la tabla de su segmento.') : ''}</p>
    <p class="small muted">${t('Es una probabilidad media para los coches de ese modelo y edad, no un diagnóstico de tu coche: el mantenimiento, los kilómetros y el dinero que estés dispuesto a gastar pesan más.')} <a href="${modelUrl(doc.slug)}">${t('Ver la ficha del {n}', { n: esc(doc.name) })}</a></p>`;
  // Curve conditional on surviving to the current age.
  const rel = (A: (number | null)[]) => A.map((v, i) => (i < age || v == null || !A[age] ? null : v / A[age]!));
  const series: Series[] = [
    { id: 'all', label: t('Coches de su quinta'), S: rel(ov.national.curve.S), color: 'var(--avg)', kind: 'ref' },
    { id: 'me', label: name, S: rel(S), obs, color: 'var(--s1)', kind: 'main' },
  ];
  document.getElementById('yc-more')!.hidden = false;
  chart.setSeries(series);
  document.getElementById('yc-legend')!.innerHTML = series.map((s) => `<li><span class="swatch line" style="background:${s.color}"></span>${esc(s.label)}</li>`).join('');
  document.getElementById('yc-cap')!.textContent = t('Probabilidad de seguir de alta a cada edad, sabiendo que hoy tiene {a} años.', { a: age });
}
brandSel.addEventListener('change', () => {
  fillModels();
  void fillYears();
});
modelSel.addEventListener('change', () => void fillYears());
yearSel.addEventListener('change', compute);
fuelSel.addEventListener('change', compute);
await fillYears();
if (params.get('f')) {
  fuelSel.value = params.get('f')!;
  compute();
}
