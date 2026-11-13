// Freight footprint layer: Port of Hueneme imports from the origin port to
// the drop site and on to market, with modeled emissions for every leg.
// Ocean lanes, drayage and onward links are Cesium polylines; all text goes
// through the world-overlay host as cards, like every other layer.

import * as Cesium from 'cesium';
import { freightFootprint } from '../../emissions/freightFootprint.js';
import { PORT_GATE } from '../../emissions/freightLanes.js';
import {
  commodityLines,
  dropSiteMarkers,
  flowWidth,
  footprintHeadline,
  footprintStats,
  landLinks,
  marketMarkers,
  oceanLanes,
  originMarkers,
} from './model.js';

export const FREIGHT_FOOTPRINT_LAYER_ID = 'freight-footprint';
export const FREIGHT_FOOTPRINT_OVERLAY_SOURCE_ID = 'freight-footprint-cards';
const ACCENT = '#20e7f2';
const DRAYAGE_COLOR = '#ff9f1c';

const NO_OVERLAY = Object.freeze({
  setEntries() {},
  clearSource() {},
});

/** World-overlay card entry for one piece of footprint text. */
export function footprintCard({
  id,
  position,
  title,
  details,
  accent,
  priority,
  maxDistance,
}) {
  return {
    id,
    source: FREIGHT_FOOTPRINT_OVERLAY_SOURCE_ID,
    position,
    variant: 'card',
    title,
    details,
    accent,
    priority,
    collisionGroup: 'ambient-card',
    zIndex: 31,
    interactive: false,
    minDistance: 0,
    maxDistance,
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
    gapPx: 15,
    placement: 'above',
  };
}

/**
 * @param {object} [options]
 * @param {{setEntries: Function, clearSource: Function}} [options.overlayHost]
 * @param {(reason: string) => void} [options.requestRender]
 * @param {(options: object) => object} [options.compute] freightFootprint.
 * @param {object} [options.truckFactors] Replaces the default truck factors.
 * @param {object} [options.railFactors] Replaces the default rail factors.
 */
export function createFreightFootprintLayer({
  overlayHost = NO_OVERLAY,
  requestRender = () => {},
  compute = freightFootprint,
  truckFactors,
  railFactors,
} = {}) {
  let viewer = null;
  let dataSource = null;
  let enabled = false;
  let footprint = null;
  let bevDrayage = null;

  const color = (hex, alpha = 1) =>
    Cesium.Color.fromCssColorString(hex).withAlpha(alpha);
  const positions = (points, height = 0) =>
    Cesium.Cartesian3.fromDegreesArrayHeights(
      points.flatMap(([lat, lon]) => [lon, lat, height]),
    );

  function model() {
    const opts = {
      ...(truckFactors ? { truckFactors } : {}),
      ...(railFactors ? { railFactors } : {}),
    };
    footprint = compute(opts);
    bevDrayage = compute({ ...opts, scenario: { drayage: 'electric' } });
  }

  function draw() {
    const lanes = oceanLanes(footprint);
    const links = landLinks(footprint);
    const maxOcean = Math.max(...lanes.map((l) => l.tonnes));
    const maxLand = Math.max(...links.map((l) => l.tonnes));
    const add = (entity) => dataSource.entities.add(entity);

    for (const lane of lanes) {
      add({
        id: `${FREIGHT_FOOTPRINT_LAYER_ID}:ocean:${lane.id}`,
        polyline: {
          positions: positions(lane.points, 0),
          width: flowWidth(lane.tonnes, maxOcean),
          material: new Cesium.PolylineGlowMaterialProperty({
            glowPower: 0.15,
            color: color(lane.color, 0.85),
          }),
          arcType: Cesium.ArcType.NONE,
        },
      });
    }
    for (const link of links) {
      const drayage = link.leg === 'drayage';
      add({
        id: `${FREIGHT_FOOTPRINT_LAYER_ID}:${link.id}`,
        polyline: {
          positions: positions(link.points, 0),
          width: flowWidth(link.tonnes, maxLand),
          material:
            link.mode === 'rail'
              ? new Cesium.PolylineDashMaterialProperty({
                  color: color(link.color, 0.9),
                  dashLength: 16,
                })
              : color(drayage ? DRAYAGE_COLOR : link.color, 0.85),
          arcType: Cesium.ArcType.GEODESIC,
          clampToGround: drayage,
        },
      });
    }
    const point = (id, lat, lon, hex, size) =>
      add({
        id: `${FREIGHT_FOOTPRINT_LAYER_ID}:${id}`,
        position: Cesium.Cartesian3.fromDegrees(lon, lat, 10),
        point: {
          pixelSize: size,
          color: color(hex),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 1,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    point('gate', PORT_GATE.lat, PORT_GATE.lon, ACCENT, 11);
    for (const s of dropSiteMarkers(footprint))
      point(`site:${s.id}`, s.lat, s.lon, DRAYAGE_COLOR, 9);
    for (const m of marketMarkers(footprint))
      point(`market:${m.id}`, m.lat, m.lon, '#ffffff', 8);
    for (const o of originMarkers(lanes))
      point(`origin:${o.id}`, o.lat, o.lon, o.color, 9);
    return lanes;
  }

  function publishCards(lanes) {
    const at = (lat, lon, h = 50) => Cesium.Cartesian3.fromDegrees(lon, lat, h);
    const head = footprintHeadline(footprint, { bevDrayage });
    const cards = [
      footprintCard({
        id: 'headline',
        position: at(PORT_GATE.lat, PORT_GATE.lon, 400),
        title: head.title,
        details: [...head.details, ...commodityLines(footprint)],
        accent: ACCENT,
        priority: 900,
        maxDistance: 25_000_000,
      }),
    ];
    for (const s of dropSiteMarkers(footprint))
      cards.push(
        footprintCard({
          id: `site:${s.id}`,
          position: at(s.lat, s.lon),
          title: s.title,
          details: s.details,
          accent: DRAYAGE_COLOR,
          priority: 400,
          maxDistance: 60_000,
        }),
      );
    for (const m of marketMarkers(footprint))
      cards.push(
        footprintCard({
          id: `market:${m.id}`,
          position: at(m.lat, m.lon),
          title: m.title,
          details: m.details,
          accent: '#ffffff',
          priority: 300,
          maxDistance: 3_000_000,
        }),
      );
    for (const o of originMarkers(lanes))
      cards.push(
        footprintCard({
          id: `origin:${o.id}`,
          position: at(o.lat, o.lon),
          title: o.title,
          details: o.details,
          accent: o.color,
          priority: 350,
          maxDistance: 25_000_000,
        }),
      );
    overlayHost.setEntries(FREIGHT_FOOTPRINT_OVERLAY_SOURCE_ID, cards);
  }

  function removeDataSource() {
    overlayHost.clearSource(FREIGHT_FOOTPRINT_OVERLAY_SOURCE_ID);
    if (dataSource && viewer?.dataSources?.contains?.(dataSource))
      viewer.dataSources.remove(dataSource, true);
    dataSource = null;
  }

  return {
    id: FREIGHT_FOOTPRINT_LAYER_ID,
    name: 'Freight Footprint',
    icon: '🚚',
    source: 'POH cargo + EPA/AAR factors (modeled)',
    updateInterval: 0,
    async init(nextViewer) {
      viewer = nextViewer;
      return true;
    },
    async enable(nextViewer) {
      viewer = nextViewer ?? viewer;
      removeDataSource();
      enabled = true;
      if (!footprint) model();
      dataSource = new Cesium.CustomDataSource(FREIGHT_FOOTPRINT_LAYER_ID);
      const lanes = draw();
      viewer.dataSources.add(dataSource);
      publishCards(lanes);
      requestRender('freight-footprint-enable');
      return true;
    },
    async disable() {
      enabled = false;
      removeDataSource();
      requestRender('freight-footprint-disable');
      return true;
    },
    update: async () => true,
    async destroy() {
      enabled = false;
      removeDataSource();
      footprint = null;
      bevDrayage = null;
      viewer = null;
    },
    /** The modeled footprint, or null before the layer is first enabled. */
    getFootprint: () => footprint,
    getStats: () => footprintStats(footprint, enabled),
    getAnalystRecords: (maxCount = 200) =>
      (footprint?.flows ?? []).slice(0, maxCount).map((f) => ({
        id: f.id,
        leg: f.leg,
        commodity: f.commodity,
        from: f.from,
        to: f.to,
        tonnes: f.tonnes,
        co2eTonnes: f.emissions.co2e,
      })),
  };
}
