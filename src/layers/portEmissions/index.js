// Port emissions layer: draws one port's inventory geofences and, from the
// live AIS layer's vessel records, models at-berth load and emissions with
// the EPA method (src/emissions). Every figure on the map is labeled modeled.
//
// Shapes are Cesium entities; all text goes through the world-overlay host
// as cards, like every other layer.

import * as Cesium from 'cesium';
import { createPortActivity } from '../../emissions/portActivity.js';
import {
  geofenceShapes,
  portHeadline,
  portStats,
  vesselLabel,
} from './model.js';

export const PORT_EMISSIONS_LAYER_ID = 'port-emissions';
export const PORT_EMISSIONS_OVERLAY_SOURCE_ID = 'port-emissions-cards';
const SAMPLE_MS = 30_000;
const NM_TO_M = 1852;
const COLORS = Object.freeze({
  harbor: '#20e7f2',
  berth: '#7cff8a',
  anchorage: '#ffd166',
  approach: '#20e7f2',
});
const CARD_MAX_DISTANCE_M = 120_000;

const NO_OVERLAY = Object.freeze({
  setEntries() {},
  clearSource() {},
});

/** World-overlay card entry for one piece of port text. */
export function portCard({ id, position, title, details, accent, priority }) {
  return {
    id,
    source: PORT_EMISSIONS_OVERLAY_SOURCE_ID,
    position,
    variant: 'card',
    title,
    details,
    accent,
    priority,
    collisionGroup: 'ambient-card',
    zIndex: 32,
    interactive: false,
    minDistance: 0,
    maxDistance: CARD_MAX_DISTANCE_M,
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
    gapPx: 15,
    placement: 'above',
  };
}

/**
 * @param {object} options
 * @param {object} options.profile Port profile (src/emissions/ports.js).
 * @param {() => object[]} options.readVessels Live vessel analyst records.
 * @param {{setEntries: Function, clearSource: Function}} [options.overlayHost]
 * @param {(reason: string) => void} [options.requestRender]
 * @param {object} [options.registry] Vessel characteristics registry.
 * @param {() => number} [options.now]
 * @param {number} [options.sampleMs]
 */
export function createPortEmissionsLayer({
  profile,
  readVessels,
  overlayHost = NO_OVERLAY,
  requestRender = () => {},
  registry = null,
  now = () => Date.now(),
  sampleMs = SAMPLE_MS,
  setTimer = globalThis.setInterval,
  clearTimer = globalThis.clearInterval,
}) {
  if (!profile?.geofences) throw new TypeError('A port profile is required');
  if (typeof readVessels !== 'function')
    throw new TypeError('A vessel reader is required');
  const activity = createPortActivity(profile, { registry });
  let viewer = null;
  let dataSource = null;
  let timer = null;
  let enabled = false;
  let summary = null;
  const vesselEntities = new Map();

  const color = (hex, alpha = 1) =>
    Cesium.Color.fromCssColorString(hex).withAlpha(alpha);

  function drawGeofences() {
    for (const shape of geofenceShapes(profile)) {
      const positions = Cesium.Cartesian3.fromDegreesArray(shape.ring.flat());
      dataSource.entities.add({
        id: `${PORT_EMISSIONS_LAYER_ID}:${shape.id}`,
        polygon: {
          hierarchy: positions,
          material: color(
            COLORS[shape.role],
            shape.role === 'harbor' ? 0.08 : 0.18,
          ),
          classificationType: Cesium.ClassificationType.BOTH,
        },
        polyline: {
          positions,
          width: shape.role === 'harbor' ? 2 : 3,
          material: color(COLORS[shape.role], 0.9),
          clampToGround: true,
        },
      });
    }
    const g = profile.geofences;
    dataSource.entities.add({
      id: `${PORT_EMISSIONS_LAYER_ID}:approach`,
      position: Cesium.Cartesian3.fromDegrees(g.entrance.lon, g.entrance.lat),
      ellipse: {
        semiMajorAxis: g.approachRadiusNm * NM_TO_M,
        semiMinorAxis: g.approachRadiusNm * NM_TO_M,
        fill: false,
        outline: true,
        outlineColor: color(COLORS.approach, 0.5),
        height: 0,
      },
    });
  }

  function drawVessels() {
    const seen = new Set();
    for (const vessel of summary?.vessels ?? []) {
      if (vessel.mode !== 'hotelling') continue;
      seen.add(vessel.mmsi);
      const position = Cesium.Cartesian3.fromDegrees(
        vessel.lon,
        vessel.lat,
        20,
      );
      let entity = vesselEntities.get(vessel.mmsi);
      if (!entity) {
        entity = dataSource.entities.add({
          id: `${PORT_EMISSIONS_LAYER_ID}:vessel:${vessel.mmsi}`,
          position,
          point: {
            pixelSize: 9,
            color: color(COLORS.berth),
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 1,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
        vesselEntities.set(vessel.mmsi, entity);
      } else {
        entity.position = position;
      }
    }
    for (const [mmsi, entity] of vesselEntities) {
      if (seen.has(mmsi)) continue;
      dataSource.entities.remove(entity);
      vesselEntities.delete(mmsi);
    }
  }

  function publishCards() {
    const [title, ...details] = portHeadline(profile, summary);
    const cards = [
      portCard({
        id: 'headline',
        position: Cesium.Cartesian3.fromDegrees(
          profile.center.lon,
          profile.center.lat,
          60,
        ),
        title,
        details,
        accent: COLORS.harbor,
        priority: 1000,
      }),
    ];
    for (const vessel of summary?.vessels ?? []) {
      const text = vesselLabel(vessel);
      if (!text) continue;
      const [name, load] = text.split(' · ');
      cards.push(
        portCard({
          id: `vessel:${vessel.mmsi}`,
          position: Cesium.Cartesian3.fromDegrees(vessel.lon, vessel.lat, 20),
          title: name,
          details: [load, 'at berth · modeled'],
          accent: COLORS.berth,
          priority: 500,
        }),
      );
    }
    overlayHost.setEntries(PORT_EMISSIONS_OVERLAY_SOURCE_ID, cards);
  }

  function sample() {
    if (!enabled || !dataSource) return;
    const records = readVessels() ?? [];
    if (records.length) {
      activity.observe(records, now());
      summary = activity.summary();
    }
    drawVessels();
    publishCards();
    requestRender('port-emissions-sample');
  }

  function removeDataSource() {
    if (timer !== null) clearTimer(timer);
    timer = null;
    vesselEntities.clear();
    overlayHost.clearSource(PORT_EMISSIONS_OVERLAY_SOURCE_ID);
    if (dataSource && viewer?.dataSources?.contains?.(dataSource))
      viewer.dataSources.remove(dataSource, true);
    dataSource = null;
  }

  return {
    id: PORT_EMISSIONS_LAYER_ID,
    name: 'Port Emissions',
    icon: '⚓',
    source: 'EPA method + live AIS',
    updateInterval: 0,
    profile,
    async init(nextViewer) {
      viewer = nextViewer;
      return true;
    },
    async enable(nextViewer) {
      viewer = nextViewer ?? viewer;
      removeDataSource();
      enabled = true;
      dataSource = new Cesium.CustomDataSource(PORT_EMISSIONS_LAYER_ID);
      drawGeofences();
      viewer.dataSources.add(dataSource);
      sample();
      timer = setTimer(sample, sampleMs);
      requestRender('port-emissions-enable');
      return true;
    },
    async disable() {
      enabled = false;
      removeDataSource();
      requestRender('port-emissions-disable');
      return true;
    },
    update: async () => true,
    async destroy() {
      enabled = false;
      removeDataSource();
      activity.reset();
      summary = null;
      viewer = null;
    },
    /** The latest modeled summary, or null before any vessels arrive. */
    getSummary: () => summary,
    getStats: () => portStats(profile, summary, enabled),
    getAnalystRecords: (maxCount = 200) =>
      (summary?.vessels ?? []).slice(0, maxCount),
  };
}
