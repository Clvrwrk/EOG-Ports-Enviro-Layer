/**
 * Cesium pins for the port's electricity meters: a column per service
 * point, coloured by end use and as tall as its yearly kWh, with a label.
 * A meter whose scenario load exceeds its service turns red.
 */
import * as Cesium from 'cesium';
import { END_USES, annualKwh } from './registry.js';

export const METER_ENTITY_PREFIX = 'port-meter:';
const OVER_COLOR = '#ff4d4d';
const REL = Cesium.HeightReference.RELATIVE_TO_GROUND;
const MIN_HEIGHT = 4;
const MAX_HEIGHT = 60;

/** Column height in metres: square-root scale so small meters stay visible. */
export function pinHeight(kwh, maxKwh) {
  if (!(maxKwh > 0)) return MIN_HEIGHT;
  return MIN_HEIGHT + (MAX_HEIGHT - MIN_HEIGHT) * Math.sqrt(kwh / maxKwh);
}

export function createMeterView(dataSource, registry) {
  const entities = dataSource.entities;
  const maxKwh = Math.max(0, ...registry.meters.map(annualKwh));
  const color = (hex, alpha = 0.85) =>
    Cesium.Color.fromCssColorString(hex).withAlpha(alpha);
  const pins = new Map();
  for (const meter of registry.meters) {
    const [lat, lon] = meter.at;
    const height = pinHeight(annualKwh(meter), maxKwh);
    const base = color(END_USES[meter.endUse].color);
    const entity = entities.add({
      id: `${METER_ENTITY_PREFIX}${meter.id}`,
      position: Cesium.Cartesian3.fromDegrees(lon, lat, height / 2),
      cylinder: {
        length: height,
        topRadius: 2.2,
        bottomRadius: 2.2,
        material: base,
        heightReference: REL,
        outline: true,
        outlineColor: color('#0b0f17', 0.7),
      },
      label: {
        text: meter.label,
        font: '11px system-ui, sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        heightReference: REL,
        pixelOffset: new Cesium.Cartesian2(0, -8),
        eyeOffset: new Cesium.Cartesian3(0, height / 2 + 2, 0),
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 1800),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    pins.set(meter.id, { entity, base });
  }
  return {
    /** Mark the meters whose scenario load is over their service size. */
    showOver(overIds) {
      for (const [id, pin] of pins)
        pin.entity.cylinder.material = overIds.has(id)
          ? color(OVER_COLOR, 0.95)
          : pin.base;
    },
    setVisible(visible) {
      for (const pin of pins.values()) pin.entity.show = visible;
    },
    /** Meter id for a picked entity id, or null. */
    identify(entityId) {
      if (
        typeof entityId !== 'string' ||
        !entityId.startsWith(METER_ENTITY_PREFIX)
      )
        return null;
      const id = entityId.slice(METER_ENTITY_PREFIX.length);
      return pins.has(id) ? id : null;
    },
    destroy() {
      for (const pin of pins.values()) entities.remove(pin.entity);
      pins.clear();
    },
  };
}
