#!/usr/bin/env node
/**
 * Build a port's site map (structures, roads, rail, piers) from an
 * OpenStreetMap Overpass export, for the twin's site layers.
 *
 *   node scripts/build-port-site.mjs overpass.json public/data/port/hueneme-site.json
 *
 * The export is the JSON answer to an Overpass query with `out geom;` over
 * ways tagged building, highway, railway or man_made. The output keeps only
 * what the twin draws, with coordinates rounded to about 0.1 m.
 *
 * OpenStreetMap data is (c) OpenStreetMap contributors, ODbL 1.0.
 */
import { readFileSync, writeFileSync } from 'node:fs';

/** Port of Hueneme and the blocks around it: [south, west, north, east]. */
const BOUNDS = [34.1405, -119.2135, 34.1535, -119.1955];
const ROADS = new Set([
  'secondary',
  'secondary_link',
  'tertiary',
  'tertiary_link',
  'unclassified',
  'residential',
  'service',
]);

const [, , source, target] = process.argv;
if (!source || !target) {
  console.error('usage: build-port-site.mjs <overpass.json> <site.json>');
  process.exit(1);
}

const round = (value) => Math.round(value * 1e6) / 1e6;
const path = (way) => way.geometry.map((p) => [round(p.lat), round(p.lon)]);
function inside(way) {
  let lat = 0;
  let lon = 0;
  for (const p of way.geometry) {
    lat += p.lat;
    lon += p.lon;
  }
  lat /= way.geometry.length;
  lon /= way.geometry.length;
  return (
    lat >= BOUNDS[0] && lat <= BOUNDS[2] && lon >= BOUNDS[1] && lon <= BOUNDS[3]
  );
}
/** Footprint area in square metres (shoelace on a local flat grid). */
function area(points) {
  const k = Math.cos((points[0][0] * Math.PI) / 180) * 111_320;
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [lat1, lon1] = points[i];
    const [lat2, lon2] = points[(i + 1) % points.length];
    sum += lon1 * k * (lat2 * 111_320) - lon2 * k * (lat1 * 111_320);
  }
  return Math.abs(sum) / 2;
}

const { elements } = JSON.parse(readFileSync(source, 'utf8'));
const site = {
  source: 'OpenStreetMap contributors, ODbL 1.0',
  bounds: BOUNDS,
  structures: [],
  roads: [],
  rail: [],
  piers: [],
};
for (const way of elements) {
  if (way.type !== 'way' || !way.geometry?.length || !inside(way)) continue;
  const tags = way.tags ?? {};
  const points = path(way);
  if (tags.building || tags.man_made === 'storage_tank') {
    const tank = tags.man_made === 'storage_tank';
    const metres = Number.parseFloat(tags.height);
    const levels = Number.parseFloat(tags['building:levels']);
    const footprint = area(points);
    site.structures.push({
      id: way.id,
      ...(tags.name ? { name: tags.name } : {}),
      kind: tank ? 'tank' : tags.building === 'roof' ? 'roof' : 'building',
      // OSM rarely has heights here: sheds and warehouses are taken as
      // 10 m, tanks 12 m, everything smaller one storey and a half.
      height: Number.isFinite(metres)
        ? metres
        : Number.isFinite(levels)
          ? levels * 3.5
          : tank
            ? 12
            : footprint > 2000
              ? 10
              : 5,
      area: Math.round(footprint),
      outline: points,
    });
  } else if (tags.man_made === 'pier') {
    site.piers.push({ id: way.id, outline: points });
  } else if (tags.railway === 'rail') {
    site.rail.push({ id: way.id, path: points });
  } else if (ROADS.has(tags.highway)) {
    site.roads.push({
      id: way.id,
      ...(tags.name ? { name: tags.name } : {}),
      kind: tags.highway.replace('_link', ''),
      path: points,
    });
  }
}
writeFileSync(target, `${JSON.stringify(site)}\n`);
console.log(
  `${site.structures.length} structures, ${site.roads.length} roads, ${site.rail.length} rail, ${site.piers.length} piers`,
);
