/**
 * The port's electrical network as a drawing: the utility feed, a feeder
 * backbone, a service drop (and transformer) to every meter, and branches
 * from the meters that feed something the twin shows: shore power vaults at
 * the berths, crane power outlets, equipment chargers and reefer racks.
 *
 * There is no as-built conduit drawing in the app, so the automatic routes
 * are an approximation: one east-west backbone at the middle latitude of
 * the meters, with straight north-south drops off it and right-angle branch
 * runs. It shows what feeds what and how much is flowing, not where to dig.
 *
 * Staff correct it with a grid plan (gridPlan.js): incoming transformers
 * placed on the map, which transformer feeds which meter, and the bends of
 * any line. A meter given a transformer leaves the automatic backbone.
 *
 * Pure: no Cesium, no DOM.
 */
import { berthPoint, offsetToLonLat, rowSlot } from '../twin/layout.js';
import { sourceLabel } from './gridPlan.js';
import { serviceKw } from './registry.js';

const latLon = (layout, offset) => {
  const [lon, lat] = offsetToLonLat(layout.origin, offset);
  return [lat, lon];
};
/** A right-angle run: along the latitude first, then the longitude. */
const elbow = (from, to) => [from, [from[0], to[1]], to];

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * @param {object} registry meter registry
 * @param {object} layout twin layout (berths, cranes, chargers)
 * @param {{ gangs: object[] }} [plugMap] from plugLayout
 * @param {object} [plan] grid plan (normalizeGridPlan) with staff's corrections
 * @returns {{ nodes: object[], edges: object[], approximate: true }}
 */
export function buildNetwork(
  registry,
  layout,
  plugMap = { gangs: [] },
  plan = null,
) {
  const meters = registry.meters;
  const nodes = [];
  const edges = [];
  if (!meters.length) return { nodes, edges, approximate: true };
  const sources = new Map((plan?.sources ?? []).map((s) => [s.id, s]));
  const sourceOf = (meter) => sources.get(plan?.fedFrom?.[meter.id]) ?? null;
  const onBackbone = meters.filter((m) => !sourceOf(m));
  const backbone = median(
    (onBackbone.length ? onBackbone : meters).map((m) => m.at[0]),
  );
  const lons = onBackbone.map((m) => m.at[1]);
  const feedAt = plan?.feedAt ??
    registry.feed?.at ?? [
      Math.max(...meters.map((m) => m.at[0])) + 0.0005,
      Math.max(...meters.map((m) => m.at[1])) + 0.0005,
    ];
  nodes.push({
    id: 'feed',
    kind: 'feed',
    label: registry.feed?.label ?? 'Utility feed (approximate)',
    at: feedAt,
  });
  for (const source of sources.values()) {
    const fed = meters.filter((m) => sourceOf(m) === source);
    nodes.push({
      id: `source:${source.id}`,
      kind: 'source',
      label: sourceLabel(source),
      at: source.at,
      sourceId: source.id,
      kva: source.kva,
    });
    edges.push({
      id: `feeder:source:${source.id}`,
      kind: 'feeder',
      from: 'feed',
      to: `source:${source.id}`,
      sourceId: source.id,
      capacityKw: source.kva,
      path: elbow(feedAt, source.at),
      meterIds: fed.map((m) => m.id),
    });
  }
  const entry = [backbone, feedAt[1]];
  if (onBackbone.length)
    edges.push({
      id: 'feeder:riser',
      kind: 'feeder',
      from: 'feed',
      path: [feedAt, entry],
      meterIds: onBackbone.map((m) => m.id),
    });
  // Backbone pieces between neighbouring taps, each carrying every meter
  // on its far side from where the feed comes in.
  const stops = onBackbone.length
    ? [...new Set([...lons, entry[1]])].sort((a, b) => a - b)
    : [];
  for (let i = 0; i + 1 < stops.length; i += 1) {
    const west = stops[i];
    const east = stops[i + 1];
    const outward = east <= entry[1];
    const served = onBackbone.filter((m) =>
      outward ? m.at[1] <= west : m.at[1] >= east,
    );
    if (!served.length) continue;
    edges.push({
      id: `feeder:${i}`,
      kind: 'feeder',
      // Pieces of the automatic backbone come and go as meters are given
      // transformers, so they are not drawn by hand.
      fixed: true,
      path: outward
        ? [
            [backbone, east],
            [backbone, west],
          ]
        : [
            [backbone, west],
            [backbone, east],
          ],
      meterIds: served.map((m) => m.id),
    });
  }
  const branch = (meter, key, label, kind, at) => {
    const id = `${kind}:${meter.id}:${key}`;
    nodes.push({ id, kind, label, at, meterId: meter.id, key });
    edges.push({
      id: `branch:${meter.id}:${key}`,
      kind: 'branch',
      from: `meter:${meter.id}`,
      to: id,
      meterId: meter.id,
      endUse: meter.endUse,
      load: kind,
      key,
      path: elbow(meter.at, at),
    });
  };
  for (const meter of meters) {
    nodes.push({
      id: `meter:${meter.id}`,
      kind: meter.serviceKva ? 'transformer' : 'meter',
      label: meter.serviceKva
        ? `${meter.serviceKva.toLocaleString('en-US')} kVA service, ${meter.label}`
        : meter.label,
      at: meter.at,
      meterId: meter.id,
    });
    edges.push({
      id: `service:${meter.id}`,
      kind: 'service',
      to: `meter:${meter.id}`,
      meterId: meter.id,
      endUse: meter.endUse,
      capacityKw: serviceKw(meter),
      ...(sourceOf(meter)
        ? {
            from: `source:${sourceOf(meter).id}`,
            path: elbow(sourceOf(meter).at, meter.at),
          }
        : { path: [[backbone, meter.at[1]], meter.at] }),
    });
    if (meter.carries.includes('shore_power'))
      for (const berthId of Object.keys(layout.berths))
        branch(
          meter,
          berthId,
          `Shore power vault, ${berthId.replace('-', ' ')}`,
          'vault',
          latLon(layout, berthPoint(layout, berthId)),
        );
    if (meter.carries.includes('crane'))
      layout.cranes.forEach((crane, i) =>
        branch(
          meter,
          String(i),
          `${crane.label} shore power outlet`,
          'outlet',
          latLon(layout, crane.park),
        ),
      );
    if (meter.carries.includes('equipment_charging'))
      for (let i = 0; i < layout.chargers.installed; i += 1)
        branch(
          meter,
          String(i),
          `Charge port ${i + 1}`,
          'charger',
          latLon(
            layout,
            rowSlot(layout.chargers.at, i, {
              spacing: layout.chargers.spacing,
            }),
          ),
        );
    for (const gang of plugMap.gangs)
      if (gang.meterId === meter.id)
        branch(
          meter,
          gang.id,
          `Reefer ${gang.label.toLowerCase()}`,
          'rack',
          gang.at,
        );
  }
  // Lines staff drew keep their two ends and take the drawn bends between.
  for (const edge of edges) {
    const bends = edge.fixed ? null : plan?.routes?.[edge.id];
    if (!bends) continue;
    edge.path = [edge.path[0], ...bends, edge.path.at(-1)];
    edge.drawn = true;
  }
  return { nodes, edges, approximate: true };
}

/** What a line is called in a list: where it runs from and to. */
export function edgeLabel(network, registry, edge) {
  const meter = registry.meters.find((m) => m.id === edge.meterId);
  if (edge.kind === 'service')
    return `${meter?.label ?? edge.meterId}: service drop`;
  if (edge.kind === 'branch') {
    const end = network.nodes.find((n) => n.id === edge.to);
    return `${meter?.label ?? edge.meterId}: to ${end?.label ?? edge.key}`;
  }
  if (edge.sourceId) {
    const node = network.nodes.find((n) => n.id === edge.to);
    return `Utility feed to ${node?.label ?? edge.sourceId}`;
  }
  return edge.id === 'feeder:riser'
    ? 'Utility feed to the feeder backbone'
    : 'Feeder backbone';
}

/**
 * kW on every edge at one moment.
 * @param {object} network from buildNetwork
 * @param {object} now
 * @param {Map<string, number>} now.meterKw kW per meter id
 * @param {object} [now.frame] twin frame (ship at berth, crane states)
 * @param {Map<string, number>} [now.rackKw] kW per reefer rack id
 * @returns {Map<string, { kw: number, over: boolean }>} by edge id
 */
export function networkFlows(
  network,
  { meterKw, frame = null, rackKw = new Map() },
) {
  const flows = new Map();
  const kwOf = (id) => meterKw.get(id) ?? 0;
  const branches = new Map();
  for (const edge of network.edges)
    if (edge.kind === 'branch') {
      const list = branches.get(edge.meterId) ?? [];
      list.push(edge);
      branches.set(edge.meterId, list);
    }
  for (const edge of network.edges) {
    if (edge.kind === 'feeder') {
      const kw = edge.meterIds.reduce((acc, id) => acc + kwOf(id), 0);
      flows.set(edge.id, {
        kw,
        // kVA taken as kW: close enough to flag an undersized transformer.
        over: edge.capacityKw != null && kw > edge.capacityKw,
      });
    } else if (edge.kind === 'service') {
      const kw = kwOf(edge.meterId);
      flows.set(edge.id, {
        kw,
        over: edge.capacityKw != null && kw > edge.capacityKw,
      });
    }
  }
  for (const [meterId, list] of branches) {
    const total = kwOf(meterId);
    const byLoad = new Map();
    for (const edge of list) {
      const group = byLoad.get(edge.load) ?? [];
      group.push(edge);
      byLoad.set(edge.load, group);
    }
    // A meter with several kinds of branch splits its load between them
    // by how many kinds are drawing; in practice each has one kind.
    const kinds = byLoad.size;
    for (const [load, group] of byLoad) {
      const share = total / kinds;
      let live = group;
      if (load === 'rack') {
        for (const edge of group)
          flows.set(edge.id, { kw: rackKw.get(edge.key) ?? 0, over: false });
        continue;
      }
      if (load === 'vault')
        live = group.filter((edge) => edge.key === frame?.ship?.berthId);
      if (load === 'outlet') {
        const working = group.filter((edge) => {
          const unit = frame?.cranes?.[Number(edge.key)];
          return unit?.state === 'working' && unit.powertrain !== 'diesel';
        });
        if (working.length) live = working;
      }
      if (!live.length) live = group;
      for (const edge of group)
        flows.set(edge.id, {
          kw: live.includes(edge) ? share / live.length : 0,
          over: false,
        });
    }
  }
  return flows;
}

/** Length of a [lat, lon] path in metres. */
export function pathLength(path) {
  let metres = 0;
  for (let i = 1; i < path.length; i += 1) {
    const [lat1, lon1] = path[i - 1];
    const [lat2, lon2] = path[i];
    const k = Math.cos((lat1 * Math.PI) / 180) * 111_320;
    metres += Math.hypot((lat2 - lat1) * 111_320, (lon2 - lon1) * k);
  }
  return metres;
}

/** The [lat, lon] a fraction (0-1) of the way along a path. */
export function pointAlong(path, fraction) {
  const total = pathLength(path);
  if (!(total > 0)) return path[0];
  let left = Math.max(0, Math.min(1, fraction)) * total;
  for (let i = 1; i < path.length; i += 1) {
    const piece = pathLength([path[i - 1], path[i]]);
    if (left <= piece || i === path.length - 1) {
      const t = piece ? Math.min(1, left / piece) : 0;
      return [
        path[i - 1][0] + (path[i][0] - path[i - 1][0]) * t,
        path[i - 1][1] + (path[i][1] - path[i - 1][1]) * t,
      ];
    }
    left -= piece;
  }
  return path.at(-1);
}

const kwText = (kw) => `${Math.round(kw).toLocaleString('en-US')} kW`;

/** Title and rows for a clicked line or node of the network. */
export function networkCard(network, flows, registry, target) {
  if (target.kind === 'edge') {
    const edge = network.edges.find((e) => e.id === target.id);
    if (!edge) return null;
    const flow = flows?.get(edge.id) ?? { kw: 0 };
    const rows = [['Flowing now', kwText(flow.kw)]];
    if (edge.kind === 'feeder')
      rows.push(['Feeds', `${edge.meterIds.length} meters downstream`]);
    else {
      const meter = registry.meters.find((m) => m.id === edge.meterId);
      rows.push(['Meter', meter?.label ?? edge.meterId]);
      if (edge.capacityKw != null)
        rows.push([
          'Service size',
          `${kwText(edge.capacityKw)}${flow.over ? ' (over)' : ''}`,
        ]);
    }
    rows.push([
      'Length',
      `about ${Math.round(pathLength(edge.path)).toLocaleString('en-US')} m`,
    ]);
    rows.push([
      'Route',
      edge.drawn
        ? 'Drawn by port staff'
        : 'Approximate: not drawn by staff yet',
    ]);
    return {
      title: edge.sourceId
        ? 'Feeder to an incoming transformer'
        : edge.kind === 'feeder'
          ? 'Feeder backbone'
          : edge.kind === 'service'
            ? 'Service drop'
            : 'Branch circuit',
      rows,
      over: flow.over,
    };
  }
  const node = network.nodes.find((n) => n.id === target.id);
  if (!node) return null;
  const edge = network.edges.find((e) => e.to === node.id);
  const rows = [];
  if (node.kind === 'feed') {
    const kw = network.edges
      .filter((e) => e.from === 'feed')
      .reduce((acc, e) => acc + (flows?.get(e.id)?.kw ?? 0), 0);
    rows.push(['Port load now', kwText(kw)]);
    rows.push(['Feeds', `${registry.meters.length} meters`]);
  } else if (edge)
    rows.push(['Drawing now', kwText(flows?.get(edge.id)?.kw ?? 0)]);
  if (node.kind === 'source') {
    rows.push([
      'Size',
      node.kva ? `${node.kva.toLocaleString('en-US')} kVA` : 'Not chosen yet',
    ]);
    rows.push(['Feeds', `${edge?.meterIds.length ?? 0} meters`]);
    rows.push(['Position', 'Placed by port staff']);
    return { title: node.label, rows, over: flows?.get(edge?.id)?.over };
  }
  if (node.meterId) {
    const meter = registry.meters.find((m) => m.id === node.meterId);
    if (meter && node.kind !== 'transformer' && node.kind !== 'meter')
      rows.push(['Fed from', meter.label]);
  }
  rows.push(['Position', 'Approximate']);
  return { title: node.label, rows };
}
