import { boot } from '../site/site.ts';
import { fuelName, FUEL_ORDER, load, SEGMENT_KEYS, segmentName, type GroupEntry, type IndexEntry, type Overview } from '../data.ts';
import { int, modelUrl, num, pct, t } from '../i18n.ts';
import { esc } from '../charts/survival.ts';

boot();
const [ov, idx, rk] = await Promise.all([
  load<Overview>('overview'),
  load<{ models: IndexEntry[] }>('index'),
  load<{ brands: (GroupEntry & { slug: string })[] }>('rankings'),
]);
const models = idx.models.filter((m) => m.now >= 1000 || m.enough);

// ---- sortable model table ----
type Col = { k: string; label: string; v: (m: IndexEntry) => number | string | null; f: (m: IndexEntry) => string; num?: boolean };
const cols: Col[] = [
  { k: 'name', label: t('Modelo'), v: (m) => m.name, f: (m) => `<a href="${modelUrl(m.slug)}">${esc(m.name)}</a>` },
  { k: 'seg', label: t('Segmento'), v: (m) => segmentName(m.segment), f: (m) => `<span class="muted">${esc(segmentName(m.segment))}</span>` },
  { k: 'median', label: t('Vida mediana'), num: true, v: (m) => m.median, f: (m) => (m.median != null ? `<b>${num(m.median, 1)}</b> <span class="small muted">${num(m.median_lo, 1)}–${num(m.median_hi, 1)}</span>` : m.enough ? '<span class="muted">—</span>' : `<span class="pill warn">${t('Pocos datos')}</span>`) },
  { k: 's15', label: t('A 15 años'), num: true, v: (m) => m.s15, f: (m) => pct(m.s15, 0) },
  { k: 's20', label: t('A 20 años'), num: true, v: (m) => m.s20, f: (m) => pct(m.s20, 0) },
  { k: 'index', label: t('Índice'), num: true, v: (m) => m.index, f: (m) => (m.index == null ? '—' : num(m.index, 0)) },
  { k: 'now', label: t('Hoy de alta'), num: true, v: (m) => m.now, f: (m) => int(m.now) },
];
let sortK = 'median';
let dir = -1;
let segF = '';
const tbl = document.getElementById('rk-models')!;
function drawTable() {
  const c = cols.find((x) => x.k === sortK)!;
  const rows = models
    .filter((m) => !segF || m.segment === segF)
    .sort((a, b) => {
      const va = c.v(a), vb = c.v(b);
      if (va == null) return 1;
      if (vb == null) return -1;
      return (typeof va === 'string' ? va.localeCompare(vb as string, 'es') : (va as number) - (vb as number)) * dir;
    });
  tbl.innerHTML = `<thead><tr><th>#</th>${cols
    .map((x) => `<th aria-sort="${x.k === sortK ? (dir > 0 ? 'ascending' : 'descending') : 'none'}"><button class="link-btn" data-k="${x.k}" style="font:inherit;color:inherit;letter-spacing:inherit;text-transform:inherit">${x.label}${x.k === sortK ? (dir > 0 ? ' ↑' : ' ↓') : ''}</button></th>`)
    .join('')}</tr></thead><tbody>${rows.map((m, i) => `<tr><td class="muted">${i + 1}</td>${cols.map((x) => `<td>${x.f(m)}</td>`).join('')}</tr>`).join('')}</tbody>`;
}
tbl.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-k]');
  if (!b) return;
  const k = b.dataset.k!;
  dir = k === sortK ? -dir : k === 'name' || k === 'seg' || k === 'index' ? 1 : -1;
  sortK = k;
  drawTable();
});
const segBox = document.getElementById('rk-seg')!;
segBox.innerHTML = [['', t('Todos')], ...SEGMENT_KEYS.map((k) => [k, segmentName(k)])].map(([k, l]) => `<button type="button" data-s="${k}" aria-pressed="${k === segF}">${esc(l!)}</button>`).join('');
segBox.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-s]');
  if (!b) return;
  segF = b.dataset.s!;
  segBox.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  drawTable();
});
drawTable();

// ---- segments ----
const withMedian = models.filter((m) => m.median != null);
document.getElementById('rk-segments')!.innerHTML = SEGMENT_KEYS.map((k) => {
  const list = withMedian.filter((m) => m.segment === k).sort((a, b) => b.median! - a.median!);
  const seg = ov.segments[k];
  if (list.length < 2) return '';
  const li = (m: IndexEntry) => `<li style="display:flex;justify-content:space-between;gap:10px"><a href="${modelUrl(m.slug)}">${esc(m.name)}</a><b class="tnum">${num(m.median, 1)}</b></li>`;
  const best = list.slice(0, 3), worst = list.slice(-3).reverse().filter((m) => !best.includes(m));
  return `<div class="card" id="seg-${k}"><h3>${esc(segmentName(k))}</h3><p class="small muted">${seg?.median != null ? t('Vida mediana del segmento: {n} años', { n: num(seg.median, 1) }) : ''}</p>
    <p class="small" style="margin:10px 0 4px;font-weight:650">${t('Más longevos')}</p><ul style="list-style:none;padding:0;margin:0;display:grid;gap:4px">${best.map(li).join('')}</ul>
    ${worst.length ? `<p class="small" style="margin:12px 0 4px;font-weight:650">${t('Menos longevos')}</p><ul style="list-style:none;padding:0;margin:0;display:grid;gap:4px">${worst.map(li).join('')}</ul>` : ''}</div>`;
}).join('');

// ---- fuels ----
const fu = FUEL_ORDER.filter((f) => ov.fuels[f]?.enough);
document.getElementById('rk-fuels')!.innerHTML = `<div class="table-scroll"><table><thead><tr><th>${t('Combustible')}</th><th>${t('Vida mediana')}</th><th>${t('A 15 años')}</th><th>${t('A 20 años')}</th><th>${t('Índice')}</th></tr></thead><tbody>${fu
  .map((f) => {
    const g = ov.fuels[f]!;
    return `<tr><td>${fuelName(f)}</td><td>${g.median != null ? `<b>${num(g.median, 1)}</b>` : '<span class="muted">' + t('aún joven') + '</span>'}</td><td>${pct(g.s['15'], 0)}</td><td>${pct(g.s['20'], 0)}</td><td>${num(g.index, 0)}</td></tr>`;
  })
  .join('')}</tbody></table></div><p class="caption">${t('Híbridos y eléctricos llevan pocos años en el mercado: sus valores a 15 y 20 años no existen todavía.')}</p>`;

// ---- brands ----
document.getElementById('rk-brands')!.innerHTML = `<thead><tr><th>#</th><th>${t('Marca')}</th><th>${t('Vida mediana')}</th><th>${t('A 20 años')}</th><th>${t('Índice')}</th><th>${t('Bajas en 12 meses')}</th></tr></thead><tbody>${rk.brands
  .filter((b) => b.index != null)
  .sort((a, b) => (b.median ?? 0) - (a.median ?? 0) || (a.index ?? 0) - (b.index ?? 0))
  .map((b, i) => `<tr><td class="muted">${i + 1}</td><td>${esc(b.label)}</td><td>${b.median != null ? `<b>${num(b.median, 1)}</b>` : '—'}</td><td>${pct(b.s['20'], 0)}</td><td>${num(b.index, 0)}</td><td>${int(b.deaths)}</td></tr>`)
  .join('')}</tbody>`;

// ---- exports ----
const ex = models.filter((m) => m.old_export_rate != null && (m.old_exports ?? 0) >= 30).sort((a, b) => b.old_export_rate! - a.old_export_rate!).slice(0, 15);
const max = Math.max(...ex.map((m) => m.old_export_rate!));
document.getElementById('rk-exports')!.innerHTML = `<div class="bars">${ex
  .map((m) => `<div class="hbar"><a href="${modelUrl(m.slug)}" style="font-weight:600;text-decoration:none">${esc(m.name)}</a><div class="track"><div class="fill" style="width:${(100 * m.old_export_rate!) / max}%"></div></div><span class="val">${num(m.old_export_rate, 1)} ‰</span></div>`)
  .join('')}</div><p class="caption">${t('Solo modelos con al menos 30 unidades de 15 años o más exportadas en el año. La DGT no publica el país de destino.')}</p>`;
