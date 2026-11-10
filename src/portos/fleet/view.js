/**
 * Cesium drawing of an EV Planning round trip: the route out and back,
 * coloured segment by segment by battery charge, the drop site, and any
 * charging stops.
 */
import * as Cesium from 'cesium';
import { cumulativeDistances } from './physics.js';

export const EV_ENTITY_PREFIX = 'ev-plan:';

/** Charge bands, high to low: [min SoC %, colour, label]. */
export const SOC_BANDS = Object.freeze([
  [50, '#7cff8a', 'Over 50%'],
  [20, '#ffd166', '20 to 50%'],
  [10, '#ff9f6b', '10 to 20%'],
  [-Infinity, '#ff4d6d', 'Under 10%'],
]);

export function socColor(soc) {
  return SOC_BANDS.find(([min]) => soc >= min)[1];
}

/** The [lon, lat] points of a route between two distances along it. */
export function sliceRoute(coordinates, cum, startM, endM) {
  const out = [];
  const lerp = (i, d) => {
    const span = cum[i] - cum[i - 1];
    const t = span > 0 ? (d - cum[i - 1]) / span : 0;
    const [a, b] = [coordinates[i - 1], coordinates[i]];
    return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
  };
  for (let i = 1; i < coordinates.length; i += 1) {
    if (cum[i] < startM) continue;
    if (out.length === 0) out.push(lerp(i, startM));
    if (cum[i] >= endM) {
      out.push(lerp(i, endM));
      break;
    }
    out.push(coordinates[i]);
  }
  return out;
}

/**
 * @param {Cesium.CustomDataSource} dataSource
 */
export function createEvView(dataSource) {
  const entities = dataSource.entities;
  let drawn = [];
  const add = (graphics) => {
    const entity = entities.add(graphics);
    drawn.push(entity);
    return entity;
  };
  const clear = () => {
    for (const entity of drawn) entities.remove(entity);
    drawn = [];
  };
  const drawLeg = (name, coordinates, result, offset) => {
    const cum = cumulativeDistances(coordinates);
    result.segments.forEach((seg, i) => {
      const points = sliceRoute(coordinates, cum, seg.start_m, seg.end_m);
      if (points.length < 2) return;
      add({
        id: `${EV_ENTITY_PREFIX}${name}:${i}`,
        name: `${name}: ${seg.soc_pct.toFixed(0)}% charge`,
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArray(points.flat()),
          width: 6,
          clampToGround: true,
          material: Cesium.Color.fromCssColorString(
            socColor(seg.soc_pct),
          ).withAlpha(offset ? 0.6 : 0.95),
        },
      });
    });
    for (const stop of result.charging_stops)
      add({
        id: `${EV_ENTITY_PREFIX}${name}:stop:${stop.station_id}`,
        name: `Charge: ${stop.name ?? stop.station_id}`,
        position: Cesium.Cartesian3.fromDegrees(stop.lon, stop.lat, 5),
        point: {
          pixelSize: 12,
          color: Cesium.Color.fromCssColorString('#20e7f2'),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
  };
  return {
    /** Draw a round trip from planner.planRoundTrip with its routes. */
    show({ trip, out, back, site }) {
      clear();
      drawLeg('Outbound', out.coordinates, trip.outbound, false);
      drawLeg('Return', back.coordinates, trip.inbound, true);
      add({
        id: `${EV_ENTITY_PREFIX}site`,
        name: site.label,
        position: Cesium.Cartesian3.fromDegrees(site.lon, site.lat, 5),
        point: {
          pixelSize: 14,
          color: Cesium.Color.fromCssColorString('#c39bff'),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: site.label,
          font: '13px system-ui, sans-serif',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -18),
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    },
    /** Camera view that fits the route. */
    rectangle(coordinates) {
      const lons = coordinates.map((c) => c[0]);
      const lats = coordinates.map((c) => c[1]);
      const pad = 0.05;
      return Cesium.Rectangle.fromDegrees(
        Math.min(...lons) - pad,
        Math.min(...lats) - pad,
        Math.max(...lons) + pad,
        Math.max(...lats) + pad,
      );
    },
    setVisible(visible) {
      for (const entity of drawn) entity.show = visible;
    },
    clear,
    destroy: clear,
  };
}
