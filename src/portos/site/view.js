/**
 * Cesium drawing of a port's site map: structures as extruded blocks,
 * roads and rail as ground lines, piers as ground slabs. Each group is a
 * layer the twin can show or hide. The geometry comes from the site file
 * built by scripts/build-port-site.mjs (OpenStreetMap data).
 */
import * as Cesium from 'cesium';

export const SITE_ENTITY_PREFIX = 'port-site:';
export const SITE_URL = '/data/port/hueneme-site.json';
const REL = Cesium.HeightReference.RELATIVE_TO_GROUND;
const ROAD_WIDTH = { secondary: 6, tertiary: 5, unclassified: 4 };
const COLORS = {
  building: '#7f8ea8',
  roof: '#5d6b84',
  tank: '#b9a27a',
  road: '#c9d2e3',
  rail: '#ff9f6b',
  pier: '#4a5670',
};

/** Fetch the site file; null when it is missing or not JSON. */
export async function loadSite({
  url = SITE_URL,
  fetchImpl = globalThis.fetch,
} = {}) {
  try {
    const response = await fetchImpl(url);
    const type = response.headers?.get?.('content-type') ?? 'json';
    if (!response.ok || !type.includes('json')) return null;
    return await response.json();
  } catch {
    return null;
  }
}

const flat = (points) => points.flatMap(([lat, lon]) => [lon, lat]);
const tint = (hex, alpha) =>
  Cesium.Color.fromCssColorString(hex).withAlpha(alpha);

/**
 * @param {Cesium.CustomDataSource} dataSource
 * @param {object} site from loadSite
 */
export function createSiteView(dataSource, site) {
  const entities = dataSource.entities;
  const groups = { structures: [], roads: [] };
  const names = new Map();
  const add = (group, id, graphics) => {
    const entity = entities.add({
      id: `${SITE_ENTITY_PREFIX}${id}`,
      ...graphics,
    });
    groups[group].push(entity);
    return entity;
  };
  for (const item of site.structures ?? []) {
    names.set(`s${item.id}`, item);
    add('structures', `s${item.id}`, {
      polygon: {
        hierarchy: Cesium.Cartesian3.fromDegreesArray(flat(item.outline)),
        height: 0,
        heightReference: REL,
        extrudedHeight: item.height,
        extrudedHeightReference: REL,
        material: tint(COLORS[item.kind] ?? COLORS.building, 0.82),
        outline: true,
        outlineColor: tint('#0b0f17', 0.8),
      },
    });
  }
  for (const item of site.piers ?? [])
    add('structures', `p${item.id}`, {
      polygon: {
        hierarchy: Cesium.Cartesian3.fromDegreesArray(flat(item.outline)),
        material: tint(COLORS.pier, 0.7),
      },
    });
  for (const item of site.roads ?? [])
    add('roads', `r${item.id}`, {
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray(flat(item.path)),
        width: ROAD_WIDTH[item.kind] ?? 3,
        clampToGround: true,
        material: tint(COLORS.road, item.kind === 'service' ? 0.45 : 0.75),
      },
    });
  for (const item of site.rail ?? [])
    add('roads', `t${item.id}`, {
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray(flat(item.path)),
        width: 3,
        clampToGround: true,
        material: new Cesium.PolylineDashMaterialProperty({
          color: tint(COLORS.rail, 0.9),
          dashLength: 12,
        }),
      },
    });
  return {
    /** Show or hide a group: 'structures' or 'roads'. */
    setVisible(group, visible) {
      for (const entity of groups[group] ?? []) entity.show = visible;
    },
    /** The structure behind a picked entity id, or null. */
    identify(entityId) {
      if (
        typeof entityId !== 'string' ||
        !entityId.startsWith(SITE_ENTITY_PREFIX)
      )
        return null;
      return names.get(entityId.slice(SITE_ENTITY_PREFIX.length)) ?? null;
    },
    destroy() {
      for (const list of Object.values(groups))
        for (const entity of list) entities.remove(entity);
    },
  };
}

/** Title and rows for a clicked structure. */
export function structureCard(item) {
  return {
    title:
      item.name ?? (item.kind === 'tank' ? 'Storage tank' : 'Building or shed'),
    rows: [
      ['Footprint', `${item.area.toLocaleString('en-US')} m²`],
      ['Height drawn', `${item.height} m (assumed)`],
      ['Source', 'OpenStreetMap'],
    ],
  };
}
