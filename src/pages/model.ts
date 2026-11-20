import { boot } from '../site/site.ts';
import { fuelName, load, loadModel, motivoName, MOTIVO_ORDER, segmentName, type Overview, type Province, type SubEntry } from '../data.ts';
import { int, lang, modelUrl, num, path, pct, t } from '../i18n.ts';
import { curveTable, esc, SurvivalChart, type Series } from '../charts/survival.ts';
import { renderMap } from '../charts/map.ts';
import { indexPhrase, statsHtml, verdictHtml } from '../verdict.ts';

boot();

function slugFromUrl(): string {
  const b = document.body.dataset.slug;
  if (b && !b.includes('{')) return b;
  const q = new URLSearchParams(location.search).get('m');
  if (q) return q;
  const m = /\/(?:modelo|model)\/([^/]+)\/?$/.exec(location.pathname);
  return m?.[1] ?? 'seat-ibiza';
}

const slug = slugFromUrl();
const [doc, ov] = await Promise.all([loadModel(slug), load<Overview>('overview')]);
const s = doc.summary;
const nat = ov.national;
const L = lang;

// ---------- hero ----------
document.getElementById('m-name')!.textContent = doc.name;
if (document.title.includes('{{')) document.title = t('¿Cuánto dura un {n}? · Cuánto dura', { n: doc.name });
const crumb = document.getElementById('m-crumb')!;
crumb.innerHTML = doc.segment ? `<a href="${path('/rankings/')}#seg-${doc.segment}">${esc(segmentName(doc.segment))}</a>` : esc(doc.brand);
document.getElementById('m-verdict')!.innerHTML = verdictHtml(L, doc.name, s, nat.median!);
document.getElementById('m-stats')!.innerHTML = statsHtml(L, s, doc.now);
(document.getElementById('m-compare') as HTMLAnchorElement).href = `${path('/comparar/')}?m=${slug}${doc.rivals[0] ? ',' + doc.rivals[0].slug : ''}`;
(document.getElementById('m-yourcar') as HTMLAnchorElement).href = `${path('/tu-coche/')}?m=${slug}`;

// ---------- survival curve ----------
const main: Series = {
  id: slug,
  label: doc.name,
  S: doc.curve.S,
  lo: s.enough ? doc.curve.lo : undefined,
  hi: s.enough ? doc.curve.hi : undefined,
  obs: doc.curve.obs,
  color: 'var(--s1)',
  kind: 'main',
  median: s.median,
};
const avg: Series = { id: 'all', label: t('Todos los turismos'), S: nat.curve.S, color: 'var(--avg)', kind: 'ref' };
const seg: Series | null = doc.segment_curve
  ? { id: 'seg', label: segmentName(doc.segment), S: doc.segment_curve, color: 'var(--s2)', kind: 'ref' }
  : null;
const RIV = ['var(--s2)', 'var(--s3)', 'var(--s4)'];
const rivals: Series[] = doc.rivals.slice(0, 3).map((r, i) => ({ id: r.slug, label: r.name, S: r.S, obs: r.obs, color: RIV[i]!, kind: 'rival' }));
const chart = new SurvivalChart(document.getElementById('m-chart')!, {
  ariaLabel: t('Curva de supervivencia del {n}', { n: doc.name }),
  annotateMedian: true,
  height: 440,
});
const legend = document.getElementById('curve-legend')!;
const capEl = document.getElementById('curve-cap')!;
let tableEl: HTMLElement | null = null;
function showMode(mode: 'avg' | 'rivals') {
  const set = mode === 'avg' ? [avg, ...(seg ? [seg] : []), main] : [...rivals, main];
  chart.setSeries(set);
  legend.innerHTML = set
    .map((x) => `<li><span class="swatch line" style="background:${x.color}"></span>${esc(x.label)}${x.id === slug && s.enough ? ` <span class="muted">(${t('banda: IC 95 %')})</span>` : ''}</li>`)
    .join('') + (set.some((x) => x.obs?.some((o) => !o)) ? `<li><span class="dash-sw"></span>${t('estimado con su segmento')}</li>` : '');
  const tbl = curveTable(set);
  if (tableEl) tableEl.replaceWith(tbl);
  else capEl.after(tbl);
  tableEl = tbl;
  document.querySelectorAll('#curve-mode button').forEach((b) => b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.mode === mode)));
}
document.querySelectorAll<HTMLButtonElement>('#curve-mode button').forEach((b) => b.addEventListener('click', () => showMode(b.dataset.mode as 'avg' | 'rivals')));
if (!rivals.length) (document.querySelector('#curve-mode [data-mode=rivals]') as HTMLElement).hidden = true;
showMode('avg');
const borrowed = doc.curve.obs.findIndex((o) => !o);
capEl.innerHTML =
  t('Tabla de vida de periodo con las bajas definitivas de {a} a {b} ({d} bajas) sobre el parque de mitad de periodo.', {
    a: doc.meta.window[0],
    b: doc.meta.window[1],
    d: int(s.deaths),
  }) +
  ' ' +
  (borrowed >= 0
    ? t('Desde los {n} años no hay suficientes coches de este modelo y la curva sigue el riesgo de su segmento (tramo punteado).', { n: borrowed })
    : '') +
  (rivals.length ? ' ' + t('Rivales: los modelos con más unidades de su segmento.') : '');

// ---------- index ----------
const idxText = document.getElementById('idx-text')!;
const idxBox = document.getElementById('idx-box')!;
if (s.index != null) {
  idxText.innerHTML = t('Teniendo en cuenta la edad de cada coche, el {n} {p}.', { n: `<strong>${esc(doc.name)}</strong>`, p: indexPhrase(L, s) }) +
    ' ' + t('Este índice compara las bajas observadas con las que tendría si cada coche se diera de baja al ritmo medio de su edad: 100 es la media; 80, un 20 % menos.');
  const X = (v: number) => Math.max(0, Math.min(100, 50 + (Math.log2(v / 100) / 2) * 50)); // 25..400 on a log scale
  idxBox.innerHTML = `<div class="card"><div class="serif" style="font-size:3.2rem;line-height:1">${num(s.index, 0)}</div>
    <div class="small muted">${t('IC 95 %: {a}–{b}', { a: num(s.index_lo, 0), b: num(s.index_hi, 0) })}</div>
    <div class="index-scale" role="img" aria-label="${t('Índice {v} en una escala donde 100 es la media', { v: num(s.index, 0) })}">
      <div class="axisline"></div><div class="mid"></div>
      <div class="ci" style="left:${X(s.index_lo!)}%;width:${Math.max(1, X(s.index_hi!) - X(s.index_lo!))}%"></div>
      <div class="mark" style="left:calc(${X(s.index)}% - 1px)"></div>
    </div>
    <div class="index-labels"><span>${t('25 · dura mucho más')}</span><span>100</span><span>${t('dura mucho menos · 400')}</span></div></div>`;
} else {
  document.getElementById('indice')!.hidden = true;
}

// ---------- fuels, engines, power ----------
const FUEL_COL: Record<string, string> = { gasolina: 'var(--s1)', diesel: 'var(--s2)', hibrido: 'var(--s3)', electrico: 'var(--s4)', enchufable: 'var(--s4)', gas: 'var(--faint)' };
const fuels = doc.fuels.filter((f) => f.curve).sort((a, b) => b.exposure - a.exposure);
const fuelText = document.getElementById('fuel-text')!;
if (fuels.length >= 2) {
  const div = document.createElement('div');
  document.getElementById('fuel-block')!.append(div);
  const fs: Series[] = [{ id: 'all', label: t('Todos los turismos'), S: nat.curve.S, color: 'var(--faint)', kind: 'ref' }, ...fuels.slice(0, 3).map((f) => ({ id: String(f.key), label: `${doc.model} ${fuelName(String(f.key)).toLowerCase()}`, S: f.curve!.S, obs: f.curve!.obs, color: FUEL_COL[String(f.key)] ?? 'var(--s3)', kind: 'rival' as const }))];
  new SurvivalChart(div, { ariaLabel: t('Supervivencia del {n} por combustible', { n: doc.name }), height: 380 }).setSeries(fs);
  div.after(curveTable(fs));
  const g = fuels.find((f) => f.key === 'gasolina'), d = fuels.find((f) => f.key === 'diesel');
  if (g && d && g.index != null && d.index != null) {
    const better = g.index < d.index ? g : d;
    const worse = better === g ? d : g;
    const overlap = !(better.index_hi! < worse.index_lo!);
    fuelText.textContent = overlap
      ? t('Entre las versiones diésel (índice {d}) y gasolina (índice {g}) no hay una diferencia clara una vez se descuenta la edad.', { d: num(d.index, 0), g: num(g.index, 0) })
      : t('Las versiones {b} aguantan más: índice {bi} frente a {wi} de las {w}, a igualdad de edad.', { b: fuelName(String(better.key)).toLowerCase(), bi: num(better.index, 0), wi: num(worse.index, 0), w: fuelName(String(worse.key)).toLowerCase() });
  } else fuelText.textContent = t('Curvas por combustible con datos suficientes.');
} else {
  fuelText.textContent = fuels.length === 1 ? t('Casi todos los {n} que se dan de baja son de {f}: no hay datos para comparar combustibles.', { n: doc.name, f: fuelName(String(fuels[0]!.key)).toLowerCase() }) : t('No hay datos suficientes para comparar combustibles.');
}

function subTable(title: string, rows: SubEntry[], label: (e: SubEntry) => string, note: string): string {
  if (!rows.length) return '';
  return `<h3 style="margin-bottom:10px">${title}</h3><div class="table-scroll"><table><thead><tr><th>${t('Versión')}</th><th>${t('Bajas')}</th><th>${t('Índice')}</th><th>${t('A 20 años')}</th><th>${t('Vida mediana')}</th></tr></thead><tbody>${rows
    .map(
      (e) =>
        `<tr><td>${esc(label(e))}</td><td>${int(e.deaths)}</td><td title="${t('IC 95 %: {a}–{b}', { a: num(e.index_lo, 0), b: num(e.index_hi, 0) })}">${num(e.index, 0)}</td><td>${e.s20 == null ? '—' : pct(e.s20, 0)}</td><td>${e.median == null ? '—' : t('{n} años', { n: num(e.median, 1) })}</td></tr>`,
    )
    .join('')}</tbody></table></div><p class="caption">${note}</p>`;
}
const engLabel = (e: SubEntry) => {
  const [f, cc] = String(e.key).includes('|') ? String(e.key).split('|') : (e.key as string[]);
  return `${fuelName(f!)} ${num(Number(cc) / 1000, 1)}`;
};
document.getElementById('engine-block')!.innerHTML = subTable(t('Por motor'), doc.engines, engLabel, t('Motor: combustible y cilindrada en litros. Índice 100 = media de coches de la misma edad.'));
document.getElementById('power-block')!.innerHTML = subTable(t('Por potencia'), [...doc.power].sort((a, b) => String(a.key).localeCompare(String(b.key), 'es', { numeric: true })), (e) => String(e.label).replace('≤ 55', '≤ 55'), t('Solo coches con la potencia en kW anotada; falta en muchos coches de antes de 2005.'));

// ---------- generations ----------
function hbars(rows: { label: string; v: number | null; lo?: number | null; hi?: number | null; extra?: string }[], max: number, fmt: (v: number) => string, ref?: number) {
  return `<div class="bars">${rows
    .map(
      (r) => `<div class="hbar"><span>${esc(r.label)}</span><div class="track">${ref ? `<span style="position:absolute;top:-4px;bottom:-4px;left:${(ref / max) * 100}%;border-left:1px dashed var(--faint)"></span>` : ''}<div class="fill" style="width:${r.v == null ? 0 : Math.min(100, (r.v / max) * 100)}%"></div></div><span class="val">${r.v == null ? '—' : fmt(r.v)}</span></div>`,
    )
    .join('')}</div>`;
}
const gens = doc.generations.filter((g) => g.index != null).sort((a, b) => (parseInt(String(a.key)) || 0) - (parseInt(String(b.key)) || 0));
document.getElementById('gen-block')!.innerHTML = gens.length
  ? hbars(
      gens.map((g) => ({ label: String(g.key).replace(/^–/, t('hasta ')).replace(/–$/, t(' en adelante')), v: g.index })),
      Math.max(200, ...gens.map((g) => g.index!)),
      (v) => num(v, 0),
      100,
    ) + `<p class="caption">${t('La línea discontinua marca 100, la media. Solo tandas con al menos 40 bajas.')}</p>`
  : `<p class="muted">${t('No hay bajas suficientes por generación.')}</p>`;

// ---------- motives & exports ----------
const mot = doc.motivos;
const totalDef = MOTIVO_ORDER.reduce((a, k) => a + (mot[k] ?? 0), 0);
const MC = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--faint)', 'var(--ink-2)', 'var(--line)'];
const present = MOTIVO_ORDER.filter((k) => (mot[k] ?? 0) > 0);
document.getElementById('motivo-block')!.innerHTML = totalDef
  ? `<div class="stack" role="img" aria-label="${t('Reparto de las bajas definitivas por motivo')}">${present.map((k) => `<span style="width:${(100 * mot[k]!) / totalDef}%;background:${MC[MOTIVO_ORDER.indexOf(k)]}" title="${esc(motivoName(k))}: ${pct(mot[k]! / totalDef, 1)}"></span>`).join('')}</div>
     <ul class="legend" style="display:grid;gap:6px">${present.map((k) => `<li><span class="swatch" style="background:${MC[MOTIVO_ORDER.indexOf(k)]}"></span>${esc(motivoName(k))}: <b class="tnum">${pct(mot[k]! / totalDef, 1)}</b> <span class="muted">(${int(mot[k]!)})</span></li>`).join('')}</ul>
     <p class="caption">${t('Bajas definitivas de los últimos 12 meses. «Voluntaria» es el motivo que anota casi siempre el desguace o el titular; el registro no distingue avería, accidente o reparación que no compensa. Los códigos A y C no están documentados por la DGT.')}</p>`
  : `<p class="muted">${t('Sin bajas en el periodo.')}</p>`;
const eb = doc.exports_by_age;
const nb = nat.exports_by_age;
const perMil = (x?: { n: number; stock: number }) => (x && x.stock ? (1000 * x.n) / x.stock : null);
const oldRate = perMil(eb?.old), natOld = perMil(nb?.old);
const ratio = oldRate != null && natOld ? oldRate / natOld : null;
document.getElementById('export-block')!.innerHTML =
  s.exports > 0 && eb
    ? `<p class="lead">${t('En los últimos 12 meses salieron de España {n} unidades. {y} tenían menos de 5 años: casi siempre coches recientes que se revenden en otro país de la UE.', { n: int(s.exports), y: int(eb.young.n) })}</p>
       ${eb.old.stock >= 2000 ? `<p>${t('De los que tienen 15 años o más se exportaron {o}: {r} de cada 1.000, frente a {nr} de media en los turismos de esa edad.', { o: int(eb.old.n), r: num(oldRate, 1), nr: num(natOld, 1) })}</p>` : ''}
       ${ratio != null && ratio >= 1.8 && eb.old.n >= 30 ? `<p class="note">${t('Sus unidades veteranas se exportan {x} veces más que la media. Las exportaciones no cuentan como bajas: el coche sigue vivo en otro país. La DGT no publica el destino; según el sector, buena parte de los usados viejos que salen de España acaban en el norte y el oeste de África.', { x: num(ratio, 1) })}</p>` : ''}`
    : `<p class="muted">${t('No se ha exportado ninguno en el periodo.')}</p>`;

// ---------- today ----------
const pv = await load<{ provinces: Record<string, Province> }>('provinces');
const P = pv.provinces;
const per1000: Record<string, number | null> = {};
for (const [c, p] of Object.entries(P)) per1000[c] = p.stock ? (1000 * (doc.provinces[c] ?? 0)) / p.stock : null;
const top = Object.entries(per1000).filter(([, v]) => v != null).sort((a, b) => b[1]! - a[1]!);
document.getElementById('now-text')!.textContent = t(
  'Hoy siguen dados de alta {n} {m}, con una edad media de {a} años. Donde más abunda, en proporción al parque, es en {p1} y {p2}.',
  { n: int(doc.now), m: doc.name, a: num(doc.now_mean_age, 1), p1: P[top[0]![0]]!.name, p2: P[top[1]![0]]!.name },
);
renderMap(document.getElementById('prov-map')!, {
  values: per1000,
  names: Object.fromEntries(Object.entries(P).map(([c, p]) => [c, p.name])),
  format: (v) => num(v, 1),
  label: t('{n} por cada 1.000 turismos', { n: doc.name }),
  detail: (c) => `<div class="row"><span>${t('Unidades')}</span><b>${int(doc.provinces[c] ?? 0)}</b></div>`,
});
// registration-year histogram
const yrs = Object.entries(doc.years).map(([y, n]) => [Number(y), n] as const).filter(([y]) => y >= 1975);
const yc = document.getElementById('years-chart')!;
const drawYears = () => {
  const W = yc.clientWidth || 500, H = 260, m = { l: 44, r: 8, t: 10, b: 28 };
  const y0 = Math.min(...yrs.map(([y]) => y)), y1 = Math.max(...yrs.map(([y]) => y));
  const max = Math.max(...yrs.map(([, n]) => n));
  const bw = (W - m.l - m.r) / (y1 - y0 + 1);
  const Y = (n: number) => m.t + (1 - n / max) * (H - m.t - m.b);
  let svg = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${t('Unidades dadas de alta por año de primera matriculación')}"><g class="axis">`;
  for (let k = 0; k <= 4; k++) {
    const v = (max * k) / 4;
    svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--grid)"/><text x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end">${v >= 1000 ? num(v / 1000, 0) + 'k' : num(v, 0)}</text>`;
  }
  for (let y = Math.ceil(y0 / 5) * 5; y <= y1; y += 5) svg += `<text x="${m.l + (y - y0 + 0.5) * bw}" y="${H - 8}" text-anchor="middle">${y}</text>`;
  svg += '</g>';
  for (const [y, n] of yrs) svg += `<rect x="${m.l + (y - y0) * bw + 1}" y="${Y(n)}" width="${Math.max(1, bw - 2)}" height="${H - m.b - Y(n)}" rx="2" fill="var(--accent)"><title>${y}: ${int(n)}</title></rect>`;
  yc.innerHTML = svg + '</svg>';
};
yc.classList.add('chart');
drawYears();
new ResizeObserver(drawYears).observe(yc);

// ---------- notes ----------
document.getElementById('m-notes')!.innerHTML = `<ul class="muted">
  <li>${t('«Seguir de alta» no es lo mismo que circular: algunos coches viejos siguen en el registro sin moverse. Por eso hablamos de longevidad, no de fiabilidad.')}</li>
  <li>${t('El {p} de los coches de este modelo en el parque de referencia tenía el nombre del modelo enmascarado por la DGT y se ha asignado por marca, año, motor y peso.', { p: pct(doc.imputed_share, 0) })}</li>
  <li>${t('Sin kilómetros: un modelo muy usado como taxi o VTC se da de baja antes aunque esté bien hecho.')}</li>
  <li><a href="${path('/metodologia/')}">${t('Metodología completa')}</a> · <a href="${modelUrl(slug)}">${t('Enlace permanente')}</a></li>
</ul>`;
