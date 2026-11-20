#!/usr/bin/env bash
# Build and publish to the "cuantodura" container (~/docker/cuantodura), served at https://cuantodura.aminox.dev.
# Expects fresh data in public/data (pipeline/update.sh runs the pipeline first, then this script).
set -euo pipefail
cd "$(dirname "$0")"
TARGET="${CUANTODURA_DEPLOY_DIR:-$HOME/docker/cuantodura}"  # override for your own server

[ -f public/data/overview.json ] || { echo "falta public/data: ejecuta pipeline/update.sh" >&2; exit 1; }
npm run build
# Sanity checks on the build before touching production.
test -f dist/index.html -a -f dist/en/index.html -a -f dist/sitemap.xml -a -f dist/modelo/seat-ibiza/index.html
n=$(find dist/modelo -name index.html | wc -l)
[ "$n" -ge 100 ] || { echo "solo $n páginas de modelo: no publico" >&2; exit 1; }
if grep -rl --include=index.html '{{' dist >/dev/null; then echo "quedan marcadores {{…}} sin rellenar" >&2; grep -rl --include=index.html '{{' dist | head; exit 1; fi

mkdir -p "$TARGET/data"
rsync -a --delete dist/ "$TARGET/data/html.new/"
# Swap atomically so visitors never see a half-copied site.
if [ -d "$TARGET/data/html" ]; then
  rsync -a --delete "$TARGET/data/html.new/" "$TARGET/data/html/"
  rm -rf "$TARGET/data/html.new"
else
  mv "$TARGET/data/html.new" "$TARGET/data/html"
fi
if ! cmp -s deploy/nginx.conf "$TARGET/nginx.conf"; then
  cp deploy/nginx.conf "$TARGET/nginx.conf"
  if docker ps --format '{{.Names}}' | grep -qx cuantodura; then
    docker exec cuantodura nginx -t && docker exec cuantodura nginx -s reload
    echo "nginx recargado"
  fi
fi
echo "Web publicada en $TARGET/data/html ($n modelos)"
