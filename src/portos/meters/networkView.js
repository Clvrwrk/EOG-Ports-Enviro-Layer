/**
 * Cesium drawing of the port's electrical network (network.js) and its
 * reefer plugs (plugs.js): lines for feeders, service drops and branches,
 * dots that run along each line in the direction power flows (faster and
 * larger with more kW), blocks for transformers and racks, and one box per
 * reefer plug coloured by what it is drawing.
 */
import * as Cesium from 'cesium';
import { pathLength, pointAlong } from './network.js';
import { END_USES } from './registry.js';

export const GRID_ENTITY_PREFIX = 'port-grid:';
const REL = Cesium.HeightReference.RELATIVE_TO_GROUND;
const FEEDER = '#ffd23f';
const OVER = '#ff4d4d';
const DEAD = '#55607a';
const PLUG_COLORS = {
  empty: '#39414f',
  idle: '#3f6fb5',
  cooling: '#20e7f2',
  hot: '#ff9f43',
  defrost: '#ff7ab6',
};
const WIDTH = { feeder: 5, service: 3, branch: 2 };
/** Metres between flow dots, and the most dots on one line. */
const DOT_SPACING = 45;
const MAX_DOTS = 6;

const tint = (hex, alpha = 1) =>
  Cesium.Color.fromCssColorString(hex).withAlpha(alpha);
const flat = (points) => points.flatMap(([lat, lon]) => [lon, lat]);

/** Dot speed in metres per second for a flow. */
export function flowSpeed(kw) {
  return kw > 0.5 ? Math.min(90, 12 + 2.2 * Math.sqrt(kw)) : 0;
}

/**
 * @param {Cesium.CustomDataSource} dataSource
 * @param {object} network from buildNetwork
 * @param {{ plugs: object[] }} plugMap from plugLayout
 */
export function createNetworkView(dataSource, network, plugMap) {
  const entities = dataSource.entities;
  const lines = new Map();
  const nodes = [];
  const plugs = new Map();
  let linesShown = true;
  let plugsShown = true;
  let clock = 0;

  for (const edge of network.edges) {
    const base = edge.kind === 'feeder' ? FEEDER : END_USES[edge.endUse].color;
    const line = entities.add({
      id: `${GRID_ENTITY_PREFIX}edge:${edge.id}`,
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray(flat(edge.path)),
        width: WIDTH[edge.kind],
        clampToGround: true,
        material: tint(base, 0.9),
      },
    });
    const length = pathLength(edge.path);
    const count = Math.max(
      1,
      Math.min(MAX_DOTS, Math.round(length / DOT_SPACING)),
    );
    const dots = [];
    for (let i = 0; i < count; i += 1)
      dots.push(
        entities.add({
          id: `${GRID_ENTITY_PREFIX}dot:${edge.id}:${i}`,
          show: false,
          point: {
            pixelSize: 6,
            color: Cesium.Color.WHITE,
            outlineColor: tint(base),
            outlineWidth: 2,
            heightReference: REL,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        }),
      );
    lines.set(edge.id, { edge, line, dots, base, length, kw: 0, state: '' });
  }
  for (const node of network.nodes) {
    if (node.kind === 'meter') continue; // the meter layer draws its own pin
    const big = node.kind === 'feed';
    const size = big
      ? [9, 9, 7]
      : node.kind === 'rack'
        ? [3, 1.2, 2.2]
        : [3, 3, 2.4];
    const [lat, lon] = node.at;
    nodes.push(
      entities.add({
        id: `${GRID_ENTITY_PREFIX}node:${node.id}`,
        // Service transformers sit beside their meter's pin, not inside it.
        position: Cesium.Cartesian3.fromDegrees(
          lon + (node.kind === 'transformer' ? 0.00005 : 0),
          lat,
          size[2] / 2,
        ),
        box: {
          dimensions: new Cesium.Cartesian3(...size),
          material: tint(
            big ? FEEDER : node.kind === 'transformer' ? '#9be37a' : '#d9e2f2',
            0.95,
          ),
          heightReference: REL,
          outline: true,
          outlineColor: tint('#0b0f17', 0.8),
        },
      }),
    );
  }
  for (const plug of plugMap.plugs) {
    const [lat, lon] = plug.at;
    plugs.set(plug.id, {
      state: '',
      entity: entities.add({
        id: `${GRID_ENTITY_PREFIX}plug:${plug.id}`,
        position: Cesium.Cartesian3.fromDegrees(lon, lat, 1.3),
        box: {
          // A 40-foot reefer, long side north-south.
          dimensions: new Cesium.Cartesian3(2.44, 12.2, 2.6),
          material: tint(PLUG_COLORS.empty, 0.5),
          heightReference: REL,
        },
      }),
    });
  }

  function placeDots(entry) {
    const speed = flowSpeed(entry.kw);
    const live = linesShown && speed > 0;
    entry.dots.forEach((dot, i) => {
      dot.show = live;
      if (!live) return;
      const offset =
        ((clock * speed) / entry.length + i / entry.dots.length) % 1;
      const [lat, lon] = pointAlong(entry.edge.path, offset);
      dot.position = Cesium.Cartesian3.fromDegrees(lon, lat, 1.5);
    });
  }

  return {
    /** Recolour lines and resize dots for the flows at this moment. */
    showFlows(flows) {
      for (const [id, entry] of lines) {
        const flow = flows.get(id) ?? { kw: 0, over: false };
        entry.kw = flow.kw;
        const state = flow.over ? 'over' : flow.kw > 0.5 ? 'live' : 'dead';
        if (state !== entry.state) {
          entry.state = state;
          entry.line.polyline.material = tint(
            state === 'over' ? OVER : state === 'dead' ? DEAD : entry.base,
            state === 'dead' ? 0.5 : 0.9,
          );
        }
        const size = Math.min(12, 5 + Math.sqrt(flow.kw) / 6);
        for (const dot of entry.dots) dot.point.pixelSize = size;
        placeDots(entry);
      }
    },
    /** Recolour the plugs from plugTelemetry readings (Map by plug id). */
    showPlugs(readings) {
      for (const [id, entry] of plugs) {
        const reading = readings.get(id);
        const state = !reading
          ? 'empty'
          : reading.state === 'cooling' && reading.kw > 6.5
            ? 'hot'
            : reading.state;
        if (state === entry.state) continue;
        entry.state = state;
        entry.entity.box.material = tint(
          PLUG_COLORS[state],
          state === 'empty' ? 0.45 : 0.92,
        );
      }
    },
    /** Move the flow dots on; returns true while anything is flowing. */
    tick(seconds) {
      if (!linesShown) return false;
      clock += seconds;
      let moving = false;
      for (const entry of lines.values()) {
        if (flowSpeed(entry.kw) <= 0) continue;
        moving = true;
        placeDots(entry);
      }
      return moving;
    },
    setLinesVisible(visible) {
      linesShown = visible;
      for (const entry of lines.values()) {
        entry.line.show = visible;
        placeDots(entry);
      }
      for (const node of nodes) node.show = visible;
    },
    setPlugsVisible(visible) {
      plugsShown = visible;
      for (const entry of plugs.values()) entry.entity.show = visible;
    },
    plugsVisible: () => plugsShown,
    /** What a picked entity id is: { kind: 'plug'|'edge'|'node', id }. */
    identify(entityId) {
      if (
        typeof entityId !== 'string' ||
        !entityId.startsWith(GRID_ENTITY_PREFIX)
      )
        return null;
      const [kind, ...rest] = entityId
        .slice(GRID_ENTITY_PREFIX.length)
        .split(':');
      if (kind === 'dot')
        return { kind: 'edge', id: rest.slice(0, -1).join(':') };
      return { kind, id: rest.join(':') };
    },
    destroy() {
      for (const entry of lines.values()) {
        entities.remove(entry.line);
        for (const dot of entry.dots) entities.remove(dot);
      }
      for (const node of nodes) entities.remove(node);
      for (const entry of plugs.values()) entities.remove(entry.entity);
    },
  };
}
