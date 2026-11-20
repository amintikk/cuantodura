// Plain-language summary of a model, shared by the prerenderer (Node) and the browser.
// Self-contained (no DOM, no i18n module) so it runs in both.
export type L = 'es' | 'en';

interface S {
  enough: boolean;
  median: number | null;
  median_lo: number | null;
  median_hi: number | null;
  median_hint: number | null;
  s: Record<string, number | null>;
  index: number | null;
  index_lo: number | null;
  index_hi: number | null;
  deaths: number;
  exposure: number;
  export_rate: number | null;
  observed_to: number;
}

const nf = (l: L, x: number, d = 1) => new Intl.NumberFormat(l === 'en' ? 'en-GB' : 'es-ES', { minimumFractionDigits: d, maximumFractionDigits: d }).format(x);
const pc = (l: L, x: number) => `${nf(l, x * 100, 0)} %`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** How the model compares with cars of the same age, from the standardised index. */
export function indexPhrase(l: L, s: S): string {
  if (s.index == null || s.index_lo == null || s.index_hi == null) return '';
  const diff = Math.round(Math.abs(s.index - 100));
  if (s.index_lo <= 100 && s.index_hi >= 100)
    return l === 'en' ? 'is de-registered at about the same rate as the average car of its age' : 'se da de baja al mismo ritmo que la media de coches de su edad';
  if (s.index < 100)
    return l === 'en'
      ? `is de-registered ${diff} % less often than the average car of its age`
      : `se da de baja un ${diff} % menos que la media de coches de su edad`;
  return l === 'en'
    ? `is de-registered ${diff} % more often than the average car of its age`
    : `se da de baja un ${diff} % más que la media de coches de su edad`;
}

export function verdictHtml(l: L, name: string, s: S, nationalMedian: number): string {
  const n = `<strong>${esc(name)}</strong>`;
  if (!s.enough)
    return l === 'en'
      ? `There are too few de-registrations of the ${n} in the last twelve months to estimate how long it lasts. We show what we know without inventing a figure.`
      : `Hay pocas bajas del ${n} en los últimos doce meses para estimar cuánto dura. Mostramos lo que sabemos sin inventar una cifra.`;
  const ip = indexPhrase(l, s);
  if (s.median != null) {
    const cmp = s.median - nationalMedian;
    const rel =
      Math.abs(cmp) < 0.5
        ? l === 'en' ? 'like the average car' : 'como la media'
        : l === 'en'
          ? `${nf(l, Math.abs(cmp))} years ${cmp > 0 ? 'more' : 'less'} than the average car`
          : `${nf(l, Math.abs(cmp))} años ${cmp > 0 ? 'más' : 'menos'} que la media`;
    const s20 = s.s['20'];
    return l === 'en'
      ? `Half of all ${n} cars are still registered at <strong>${nf(l, s.median)} years</strong>, ${rel}.${s20 != null ? ` At 20 years, ${pc(l, s20)} are still on the register.` : ''} It ${ip}.`
      : `La mitad de los ${n} sigue dada de alta a los <strong>${nf(l, s.median)} años</strong>, ${rel}.${s20 != null ? ` A los 20 años sigue el ${pc(l, s20)}.` : ''} En conjunto, ${ip}.`;
  }
  const age = s.observed_to + 1;
  const sa = s.s[String(Math.min(30, Math.floor(age / 5) * 5))];
  const at = Math.min(30, Math.floor(age / 5) * 5);
  return l === 'en'
    ? `The ${n} is still too young for a reliable median life: we have its own data up to ${age} years.${sa != null ? ` At ${at} years, ${pc(l, sa)} are still registered.` : ''} It ${ip}.`
    : `El ${n} aún es demasiado joven para dar una vida mediana fiable: tenemos datos propios hasta los ${age} años.${sa != null ? ` A los ${at} años sigue de alta el ${pc(l, sa)}.` : ''} Hasta ahora, ${ip}.`;
}

export function metaDescription(l: L, name: string, s: S): string {
  if (!s.enough) return l === 'en' ? `How long does the ${name} last in Spain? Official DGT data on de-registrations and cars still on the road.` : `¿Cuánto dura un ${name}? Datos oficiales de la DGT sobre sus bajas y cuántos siguen circulando en España.`;
  const parts: string[] = [];
  if (s.median != null) parts.push(l === 'en' ? `median life ${nf(l, s.median)} years` : `vida mediana de ${nf(l, s.median)} años`);
  if (s.s['15'] != null) parts.push(l === 'en' ? `${pc(l, s.s['15']!)} still registered at 15` : `el ${pc(l, s.s['15']!)} sigue de alta a los 15 años`);
  if (s.s['20'] != null) parts.push(l === 'en' ? `${pc(l, s.s['20']!)} at 20` : `el ${pc(l, s.s['20']!)} a los 20`);
  return l === 'en'
    ? `How long does the ${name} really last in Spain? ${parts.join(', ')}. Survival curve vs rivals, diesel vs petrol and map, from DGT data.`
    : `¿Cuánto dura de verdad un ${name}? ${parts.join(', ')}. Curva frente a sus rivales, diésel y gasolina, y mapa, con datos de la DGT.`;
}

/** Key-figure tiles for the model hero (static HTML, also prerendered). */
export function statsHtml(l: L, s: S, now: number): string {
  const tile = (v: string, unit: string, label: string, ci = '') =>
    `<div class="stat"><b class="tnum">${v}${unit ? `<small>${unit}</small>` : ''}</b><span>${label}</span>${ci ? `<span class="ci">${ci}</span>` : ''}</div>`;
  const yrs = l === 'en' ? 'years' : 'años';
  const nowTxt = new Intl.NumberFormat(l === 'en' ? 'en-GB' : 'es-ES', { useGrouping: 'always' } as unknown as Intl.NumberFormatOptions).format(now);
  if (!s.enough)
    return (
      tile(l === 'en' ? 'Few data' : 'Pocos datos', '', l === 'en' ? 'not enough de-registrations to estimate' : 'no hay bajas suficientes para estimar') +
      tile(nowTxt, '', l === 'en' ? 'still registered today' : 'siguen dados de alta hoy')
    );
  const med =
    s.median != null
      ? tile(nf(l, s.median), yrs, l === 'en' ? 'median life' : 'vida mediana', `${l === 'en' ? '95 % CI' : 'IC 95 %'}: ${nf(l, s.median_lo!)}–${nf(l, s.median_hi!)}`)
      : tile(s.median_hint != null ? `≈${nf(l, s.median_hint, 0)}` : '—', s.median_hint != null ? yrs : '', l === 'en' ? 'median life: projection only' : 'vida mediana: solo proyección', l === 'en' ? 'not enough own data yet' : 'aún sin datos propios suficientes');
  const s15 = s.s['15'], s20 = s.s['20'];
  return (
    med +
    tile(s15 != null ? pc(l, s15) : '—', '', l === 'en' ? 'still registered at 15 years' : 'siguen de alta a los 15 años') +
    tile(s20 != null ? pc(l, s20) : '—', '', l === 'en' ? 'still registered at 20 years' : 'siguen de alta a los 20 años') +
    tile(nowTxt, '', l === 'en' ? 'registered today' : 'dados de alta hoy')
  );
}
