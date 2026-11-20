// Pre-projects the Spanish provinces (IGN data via es-atlas, CC BY 4.0) to SVG paths once,
// so the browser gets 52 path strings instead of a GIS library. Output: src/generated/spain.json
// The Canary Islands (35, 38) go in an inset at the bottom left, as in most maps of Spain.
import { readFileSync, writeFileSync } from 'node:fs';
import { geoConicConformal, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';

const topo = JSON.parse(readFileSync('node_modules/es-atlas/es/provinces.json', 'utf8'));
const fc = feature(topo, topo.objects.provinces) as unknown as GeoJSON.FeatureCollection;
const W = 800, H = 640;
const canary = (f: GeoJSON.Feature) => ['35', '38'].includes(String(f.id).padStart(2, '0'));
const main = { type: 'FeatureCollection', features: fc.features.filter((f) => !canary(f)) } as GeoJSON.FeatureCollection;
const isl = { type: 'FeatureCollection', features: fc.features.filter(canary) } as GeoJSON.FeatureCollection;
const pMain = geoConicConformal().rotate([3.5, 0]).parallels([37, 43]).fitExtent([[20, 10], [W - 10, H - 10]], main);
const inset = { x: 10, y: H - 150, w: 250, h: 140 };
const pIsl = geoConicConformal().rotate([15.5, 0]).parallels([27, 29]).fitExtent([[inset.x + 8, inset.y + 8], [inset.x + inset.w - 8, inset.y + inset.h - 8]], isl);
const paths: Record<string, string> = {};
for (const f of fc.features) {
  const id = String(f.id).padStart(2, '0');
  const d = geoPath(canary(f) ? pIsl : pMain)(f);
  if (d) paths[id] = d.replace(/(\d+)\.\d+/g, '$1');
}
const borders = `M${inset.x + inset.w},${inset.y}V${inset.y + inset.h}`;
writeFileSync('src/generated/spain.json', JSON.stringify({ w: W, h: H, paths, borders, inset }));
console.log('provincias', Object.keys(paths).length, 'bytes', JSON.stringify(paths).length);
