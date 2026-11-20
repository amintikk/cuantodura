#!/usr/bin/env bash
# Monthly refresh, run daily by cuantodura-update.timer (it exits early when the DGT has
# published nothing new). Steps: download new 'bajas' months and the stock snapshots needed,
# recompute, validate against what is live, build and deploy. On any anomaly it does not
# publish, opens (or comments on) an issue in the GitHub repository and exits non-zero.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD
PY="$ROOT/.venv/bin/python"
DATA="${CUANTODURA_DATA:-$ROOT/data}"
LOG="$DATA/update.log"
REPO="amintikk/cuantodura"
mkdir -p "$DATA"
exec 9>"$DATA/update.lock"
flock -n 9 || { echo "otra actualización en marcha"; exit 0; }
exec > >(tee -a "$LOG") 2>&1
echo "== $(date -u +%FT%TZ) actualización"

alert() {
  local title="Actualización mensual detenida: $1"
  local body
  body=$(printf 'La actualización automática de %s no ha publicado datos nuevos.\n\nMotivo: %s\n\nÚltimas líneas del registro:\n\n```\n%s\n```\n\nLa web sigue mostrando la versión anterior. Revisa y ejecuta `pipeline/update.sh` a mano cuando esté resuelto (o `--force` si el cambio es legítimo).' "$(date -u +%F)" "$1" "$(tail -n 40 "$LOG")")
  if command -v gh >/dev/null; then
    num=$(gh issue list -R "$REPO" --state open --search "Actualización mensual detenida in:title" --json number -q '.[0].number' 2>/dev/null || true)
    if [ -n "$num" ]; then gh issue comment "$num" -R "$REPO" --body "$body" >/dev/null || true
    else gh issue create -R "$REPO" --title "$title" --body "$body" >/dev/null || true; fi
  fi
  echo "AVISO: $1"
  exit 1
}
trap 'alert "error inesperado en la línea $LINENO"' ERR

FORCE=0; [ "${1:-}" = "--force" ] && FORCE=1
cd pipeline
"$PY" ingest_bajas.py --from 2015-01 | grep -v ": ya$" || true
END=$(ls "$DATA/bajas" | sort | tail -1 | cut -c1-6)        # latest month of 'bajas'
MID=$("$PY" -c "from config import add_months; y,m=add_months(($END//100,$END%100),-6); print(f'{y}-{m:02d}')")
# Stock snapshots: the one at mid-window and the latest published one.
for ym in "$MID" $("$PY" -c "
import datetime as dt; from config import add_months
t=dt.date.today(); print(' '.join(f'{y}-{m:02d}' for y,m in (add_months((t.year,t.month),-1), add_months((t.year,t.month),-2))))"); do
  f="$DATA/parque/${ym/-/}.parquet"
  [ -f "$f" ] || "$PY" ingest_parque.py "$ym" || echo "parque $ym: aún no disponible"
done
[ -f "$DATA/parque/${MID/-/}.parquet" ] || alert "falta el parque de mitad de periodo $MID"
NOW=$(ls "$DATA/parque" | grep -E '^[0-9]{6}\.parquet$' | sort | tail -1 | cut -c1-6)
STAMP="$END-$NOW-$(sha1sum "$ROOT"/pipeline/*.py "$ROOT"/pipeline/catalog/*.csv | sha1sum | cut -c1-12)"
if [ "$FORCE" = 0 ] && [ -f "$DATA/published.stamp" ] && [ "$(cat "$DATA/published.stamp")" = "$STAMP" ]; then
  echo "sin novedades (bajas $END, parque $NOW)"; trap - ERR; exit 0
fi

NEW="$DATA/out.new"
rm -rf "$NEW"
"$PY" build.py --out "$NEW"
if [ "$FORCE" = 1 ]; then "$PY" validate.py "$NEW" "$ROOT/public/data" || echo "validación ignorada por --force"
else "$PY" validate.py "$NEW" "$ROOT/public/data" || alert "cifras anómalas al comparar con la versión publicada (ver ANOMALÍA en el registro)"; fi

# Publish: swap the data in, build and deploy; restore the previous data if the build fails.
rm -rf "$DATA/out.prev"
[ -d "$ROOT/public/data" ] && mv "$ROOT/public/data" "$DATA/out.prev"
mv "$NEW" "$ROOT/public/data"
cd "$ROOT"
if ! ./deploy.sh; then
  rm -rf "$ROOT/public/data"; [ -d "$DATA/out.prev" ] && mv "$DATA/out.prev" "$ROOT/public/data"
  alert "falló la compilación o el despliegue"
fi
# Check what is live.
sleep 3
live=$(curl -fsS "https://cuantodura.aminox.dev/data/overview.json?t=$(date +%s)" | "$PY" -c "import json,sys; print(json.load(sys.stdin)['meta']['window'][1])") || alert "la web no responde tras desplegar"
[ "$live" = "${END:0:4}-${END:4:2}" ] || alert "la web publicada muestra la ventana $live, no ${END:0:4}-${END:4:2}"
echo "$STAMP" > "$DATA/published.stamp"
# Keep only the stock snapshots that can still be needed (the last 8 months).
ls "$DATA/parque" | grep -E '^[0-9]{6}\.parquet$' | sort | head -n -8 | while read -r f; do rm -f "$DATA/parque/$f"; done
trap - ERR
echo "== publicado: bajas hasta $END, parque $NOW"
