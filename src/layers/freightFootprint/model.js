// Pure presentation model for the freight footprint layer: which lines,
// markers and cards to draw from a freightFootprint() result. No Cesium.

import {
  DROP_SITES,
  MARKETS,
  ORIGINS,
  PORT_GATE,
} from '../../emissions/freightLanes.js';
import { seaRouteLine } from '../../emissions/freightFootprint.js';

const LEG_LABELS = Object.freeze({
  ocean: 'Ocean',
  port: 'At port',
  drayage: 'Drayage',
  onward: 'Onward',
});

/** "12,345" style whole numbers, or one decimal under 10. */
export function fmt(value) {
  if (!Number.isFinite(value)) return '-';
  const abs = Math.abs(value);
  if (abs > 0 && abs < 10) return value.toFixed(1);
  return Math.round(value).toLocaleString('en-US');
}

/** Line width in pixels for a flow carrying `tonnes` a year. */
export function flowWidth(tonnes, maxTonnes) {
  if (!(maxTonnes > 0) || !(tonnes > 0)) return 1;
  return 1.5 + 6.5 * Math.sqrt(tonnes / maxTonnes);
}

/**
 * Ocean lanes merged by origin port: one line per origin, with the cargo and
 * CO2e of every commodity on it, densified along great circles.
 */
export function oceanLanes(footprint) {
  const byOrigin = new Map();
  for (const f of footprint.flows) {
    if (f.leg !== 'ocean') continue;
    const lane = byOrigin.get(f.from) ?? {
      id: f.from,
      origin: ORIGINS[f.from],
      nm: f.nm,
      days: f.days,
      tonnes: 0,
      co2e: 0,
      commodities: [],
      color: f.color,
      topTonnes: 0,
    };
    lane.tonnes += f.tonnes;
    lane.co2e += f.emissions.co2e;
    lane.commodities.push(f.commodity);
    if (f.tonnes > lane.topTonnes) {
      lane.topTonnes = f.tonnes;
      lane.color = f.color;
    }
    byOrigin.set(f.from, lane);
  }
  return [...byOrigin.values()].map((lane) => ({
    ...lane,
    points: seaRouteLine(lane.id),
  }));
}

/** Land flows merged by (from, to): drayage and onward legs. */
export function landLinks(footprint) {
  const links = new Map();
  for (const f of footprint.flows) {
    if (f.leg === 'ocean') continue;
    const key = `${f.leg}:${f.from}:${f.to}`;
    const link = links.get(key) ?? {
      id: key,
      leg: f.leg,
      mode: f.mode ?? 'truck',
      from: f.from,
      to: f.to,
      miles: f.miles,
      tonnes: 0,
      co2e: 0,
      color: f.color,
      topTonnes: 0,
    };
    link.tonnes += f.tonnes;
    link.co2e += f.emissions.co2e;
    if (f.tonnes > link.topTonnes) {
      link.topTonnes = f.tonnes;
      link.color = f.color;
    }
    links.set(key, link);
  }
  const place = (id) =>
    id === 'gate' ? PORT_GATE : (DROP_SITES[id] ?? MARKETS[id]);
  return [...links.values()].map((link) => {
    const a = place(link.from);
    const b = place(link.to);
    return {
      ...link,
      points: [
        [a.lat, a.lon],
        [b.lat, b.lon],
      ],
    };
  });
}

/** Drop-site markers with the cargo and drayage emissions at each. */
export function dropSiteMarkers(footprint) {
  const sites = new Map();
  for (const f of footprint.flows) {
    if (f.leg !== 'drayage') continue;
    const s = sites.get(f.to) ?? {
      id: f.to,
      ...DROP_SITES[f.to],
      tonnes: 0,
      trips: 0,
      co2e: 0,
      commodities: [],
    };
    s.tonnes += f.tonnes;
    s.trips += f.trips;
    s.co2e += f.emissions.co2e;
    s.commodities.push(
      footprint.byCommodity[f.commodity]?.label ?? f.commodity,
    );
    sites.set(f.to, s);
  }
  return [...sites.values()].map((s) => ({
    ...s,
    title: s.name,
    details: [
      s.address,
      `${s.commodities.join(', ')} · ${fmt(s.tonnes)} t/yr`,
      `${fmt(s.trips)} truck loads/yr · drayage ${fmt(s.co2e)} t CO2e (modeled)`,
    ],
  }));
}

/** Market markers with tonnes received and onward emissions. */
export function marketMarkers(footprint) {
  const markets = new Map();
  for (const f of footprint.flows) {
    if (f.leg !== 'onward') continue;
    const m = markets.get(f.to) ?? {
      id: f.to,
      ...MARKETS[f.to],
      tonnes: 0,
      co2e: 0,
      modes: new Set(),
    };
    m.tonnes += f.tonnes;
    m.co2e += f.emissions.co2e;
    m.modes.add(f.mode);
    markets.set(f.to, m);
  }
  return [...markets.values()].map((m) => ({
    ...m,
    title: m.name,
    details: [
      `${fmt(m.tonnes)} t/yr from Hueneme by ${[...m.modes].join(' + ')}`,
      `Onward ${fmt(m.co2e)} t CO2e/yr (modeled)`,
    ],
  }));
}

/** Origin markers, one per load port. */
export function originMarkers(lanes) {
  return lanes.map((lane) => ({
    id: lane.id,
    lat: lane.origin.lat,
    lon: lane.origin.lon,
    color: lane.color,
    title: `${lane.origin.port}, ${lane.origin.country}`,
    details: [
      `${fmt(lane.tonnes)} t/yr to Hueneme · ${fmt(lane.nm)} nm, ${lane.days.toFixed(1)} days`,
      `Ocean leg ${fmt(lane.co2e)} t CO2e/yr (modeled)`,
    ],
  }));
}

/** Headline card at the port: the whole footprint, by leg, with what-ifs. */
export function footprintHeadline(footprint, { bevDrayage = null } = {}) {
  const t = footprint.totals;
  const lines = [
    `${fmt(footprint.cargoTonnes)} t of imports/yr · ${fmt(t.co2e)} t CO2e end to end (modeled)`,
    Object.entries(footprint.byLeg)
      .map(([leg, v]) => `${LEG_LABELS[leg]} ${fmt(v.co2e)}`)
      .join(' · ') + ' t CO2e',
    `NOx ${fmt(t.nox)} t · PM2.5 ${fmt(t.pm25)} t`,
    `${fmt(footprint.activity.calls)} ship calls · ${fmt(footprint.activity.drayageTrips)} drayage loads/yr`,
  ];
  if (bevDrayage) {
    const saved = footprint.byLeg.drayage.co2e - bevDrayage.byLeg.drayage.co2e;
    lines.push(
      `Battery-electric drayage: -${fmt(saved)} t CO2e/yr, ${fmt(bevDrayage.energy.gridKwh / 1000)} MWh/yr`,
    );
  }
  // i18n-ignore: data label on the English-only port pages
  return { title: 'POH FREIGHT FOOTPRINT', details: lines };
}

/** Per-commodity rows for the headline's detail card. */
export function commodityLines(footprint) {
  return Object.values(footprint.byCommodity).map(
    (c) =>
      `${c.label}: ${fmt(c.total.co2e)} t CO2e · ${fmt(c.co2ePerTonne * 1000)} kg per t`,
  );
}

/** Layer stats in the shape the layer panel reads. */
export function footprintStats(footprint, enabled) {
  const source = 'POH cargo + EPA/AAR factors (modeled)';
  if (!enabled || !footprint) return { count: 0, status: 'idle', source };
  return {
    count: footprint.flows.length,
    status: 'nominal',
    source,
    coverage: `Port of Hueneme · ${fmt(footprint.totals.co2e)} t CO2e/yr`,
  };
}
