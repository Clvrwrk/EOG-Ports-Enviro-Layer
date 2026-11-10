/**
 * Cesium drawing of the yard zones: each zone with an outline is a tinted
 * slab on the ground, shaded from pale to strong by the chosen metric
 * (moves, CO2, grid energy, diesel or NOx per year). A zone picked in the
 * panel is outlined brighter. `identify` maps a clicked entity to its zone.
 */
import * as Cesium from 'cesium';
import { ZONE_METRICS } from './model.js';

export const YARD_ENTITY_PREFIX = 'port-yard:';
const REL = Cesium.HeightReference.RELATIVE_TO_GROUND;
const LOW = Cesium.Color.fromCssColorString('#3a86ff');
const HIGH = Cesium.Color.fromCssColorString('#ff5d3a');
const PICKED = Cesium.Color.fromCssColorString('#ffffff');

const flat = (ring) => ring.flatMap(([lat, lon]) => [lon, lat]);

/** 0-1 position of each zone's value between the smallest and largest. */
export function shadeOf(zones, metric) {
  const of = ZONE_METRICS[metric]?.of ?? ZONE_METRICS.moves.of;
  const values = zones.map((zone) => of(zone));
  const top = Math.max(0, ...values);
  return new Map(zones.map((zone, i) => [zone.id, top ? values[i] / top : 0]));
}

/**
 * @param {Cesium.CustomDataSource} dataSource
 * @param {{ zones: object[] }} model from yardModel
 */
export function createYardView(dataSource, model) {
  const entities = dataSource.entities;
  const byEntity = new Map();
  const drawn = new Map();
  let zones = model.zones;
  let metric = 'moves';
  let picked = null;
  let visible = true;

  for (const zone of zones) {
    if (!zone.outline) continue;
    const key = `${YARD_ENTITY_PREFIX}${zone.id}`;
    const entity = entities.add({
      id: key,
      name: zone.label,
      polygon: {
        hierarchy: Cesium.Cartesian3.fromDegreesArray(flat(zone.outline)),
        height: 0,
        heightReference: REL,
        extrudedHeight: 1.2,
        extrudedHeightReference: REL,
        material: LOW.withAlpha(0.3),
        outline: true,
        outlineColor: LOW.withAlpha(0.9),
      },
    });
    byEntity.set(key, zone.id);
    drawn.set(zone.id, entity);
  }

  function paint() {
    const shade = shadeOf(zones, metric);
    for (const [id, entity] of drawn) {
      const t = shade.get(id) ?? 0;
      const color = Cesium.Color.lerp(LOW, HIGH, t, new Cesium.Color());
      entity.polygon.material = color.withAlpha(0.25 + 0.4 * t);
      entity.polygon.outlineColor =
        id === picked ? PICKED : color.withAlpha(0.95);
      entity.show = visible;
    }
  }
  paint();

  /** Labels for the world overlay: { id, text, lat, lon }. */
  const labels = () =>
    zones
      .filter((zone) => zone.outline)
      .map((zone) => {
        const lat =
          zone.outline.reduce((acc, [la]) => acc + la, 0) / zone.outline.length;
        const lon =
          zone.outline.reduce((acc, [, lo]) => acc + lo, 0) /
          zone.outline.length;
        return { id: zone.id, text: zone.label, lat, lon, height: 4 };
      });

  return {
    /** New numbers (a scenario change) for the same zones. */
    update(next) {
      zones = next.zones;
      paint();
    },
    setMetric(next) {
      metric = ZONE_METRICS[next] ? next : 'moves';
      paint();
    },
    /** Outline one zone brighter, or none with null. */
    pick(id) {
      picked = id;
      paint();
    },
    setVisible(on) {
      visible = on;
      paint();
    },
    /** The zone id behind a clicked entity, or null. */
    identify(entityId) {
      return typeof entityId === 'string'
        ? (byEntity.get(entityId) ?? null)
        : null;
    },
    labels,
    /** Centre of a drawn zone, [lat, lon], or null. */
    centre(id) {
      const item = labels().find((label) => label.id === id);
      return item ? [item.lat, item.lon] : null;
    },
    destroy() {
      for (const entity of drawn.values()) entities.remove(entity);
      drawn.clear();
      byEntity.clear();
    },
  };
}
