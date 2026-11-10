/**
 * Port electricity meters: one record per utility service point, with where
 * it sits, what it feeds (end use), its rate schedule, its service capacity
 * and its billed history. The twin draws these as pins; scenarios put their
 * loads on the meter that would carry them.
 *
 * A registry is plain data:
 *
 *   { port, source, sample?, asOf?, meters: [ {
 *       id, label, endUse, at: [lat, lon], approximate?,
 *       address?, account?, meterNumber?, tariff?, serviceKva?, plugs?,
 *       transformer?, circuit?, carries?: [load ids],
 *       monthlyKwh?: { 'YYYY-MM': kWh }, monthlyCost?: { 'YYYY-MM': $ },
 *       peakKw?, peakAt?, notes? } ] }
 *
 * Real registries hold a port's account numbers and bills, so they are
 * loaded at run time (see load.js) and never committed. SAMPLE_REGISTRY
 * below is made up so the layer works without one.
 *
 * Pure: no Cesium, no DOM.
 */

/** What a meter feeds. Order sets the order of roll-ups and legends. */
export const END_USES = Object.freeze({
  shore_power: { label: 'Shore power', color: '#20e7f2' },
  reefer: { label: 'Reefer plugs', color: '#6aa8ff' },
  crane: { label: 'Crane power', color: '#c58bff' },
  equipment_charging: { label: 'Equipment charging', color: '#7cff8a' },
  buildings: { label: 'Buildings', color: '#ffd166' },
  lighting: { label: 'Yard and wharf lighting', color: '#f4f1de' },
  pumps: { label: 'Pumps and irrigation', color: '#4fd1a5' },
  battery: { label: 'Battery storage', color: '#ff7ab6' },
  other: { label: 'Other', color: '#8a94a6' },
});

/** Scenario loads a meter can carry (the `carries` field). */
export const SCENARIO_LOADS = Object.freeze([
  'shore_power',
  'crane',
  'equipment_charging',
]);

/** Power factor used to turn a service's kVA rating into usable kW. */
export const SERVICE_POWER_FACTOR = 0.9;

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Check and freeze a registry; throws with the first problem found. */
export function normalizeRegistry(raw) {
  if (!raw || !Array.isArray(raw.meters))
    throw new Error('Meter registry needs a meters array');
  const seen = new Set();
  const meters = raw.meters.map((meter, i) => {
    const where = `meter ${meter?.id ?? i}`;
    if (!meter?.id || typeof meter.id !== 'string')
      throw new Error(`${where}: missing id`);
    if (seen.has(meter.id)) throw new Error(`${where}: duplicate id`);
    seen.add(meter.id);
    if (!END_USES[meter.endUse])
      throw new Error(`${where}: unknown end use ${meter.endUse}`);
    const [lat, lon] = meter.at ?? [];
    if (!(Math.abs(lat) <= 90) || !(Math.abs(lon) <= 180))
      throw new Error(`${where}: needs at: [lat, lon]`);
    for (const field of ['monthlyKwh', 'monthlyCost'])
      for (const [month, value] of Object.entries(meter[field] ?? {}))
        if (!MONTH_KEY.test(month) || !(value >= 0))
          throw new Error(`${where}: bad ${field} entry ${month}`);
    for (const load of meter.carries ?? [])
      if (!SCENARIO_LOADS.includes(load))
        throw new Error(`${where}: cannot carry ${load}`);
    return Object.freeze({
      label: meter.id,
      monthlyKwh: {},
      carries: [],
      ...meter,
    });
  });
  return Object.freeze({
    port: raw.port ?? '',
    source: raw.source ?? '',
    sample: Boolean(raw.sample),
    asOf: raw.asOf ?? null,
    // Where the utility's feeder reaches the port: { label?, at: [lat, lon] }.
    feed: raw.feed ?? null,
    meters: Object.freeze(meters),
  });
}

/** The latest `count` months with data, oldest first: [[month, kWh], ...]. */
export function recentMonths(meter, count = 12) {
  return Object.entries(meter.monthlyKwh ?? {})
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .slice(-count);
}

/** kWh over the latest 12 months on record (fewer if that is all there is). */
export function annualKwh(meter) {
  return recentMonths(meter, 12).reduce((acc, [, kwh]) => acc + kwh, 0);
}

/** Usable kW of the service, or null when its rating is not known. */
export function serviceKw(meter) {
  return meter.serviceKva ? meter.serviceKva * SERVICE_POWER_FACTOR : null;
}

/**
 * Room left on a service: usable kW minus the larger of the billed peak and
 * any extra peak a scenario puts on it. Null when the rating is unknown.
 */
export function headroomKw(meter, scenarioPeakKw = 0) {
  const limit = serviceKw(meter);
  if (limit == null) return null;
  return limit - Math.max(meter.peakKw ?? 0, scenarioPeakKw);
}

/** Port-wide kWh by end use, largest first, with each one's share. */
export function rollupByEndUse(registry) {
  const totals = new Map();
  for (const meter of registry.meters) {
    const row = totals.get(meter.endUse) ?? { kwh: 0, meters: 0 };
    row.kwh += annualKwh(meter);
    row.meters += 1;
    totals.set(meter.endUse, row);
  }
  const total = [...totals.values()].reduce((acc, row) => acc + row.kwh, 0);
  return Object.keys(END_USES)
    .filter((id) => totals.has(id))
    .map((id) => ({
      endUse: id,
      label: END_USES[id].label,
      ...totals.get(id),
      share: total ? totals.get(id).kwh / total : 0,
    }))
    .sort((a, b) => b.kwh - a.kwh);
}

/** Total kWh across the registry over each meter's latest 12 months. */
export function portKwh(registry) {
  return registry.meters.reduce((acc, meter) => acc + annualKwh(meter), 0);
}

const SHORT_MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(
  ' ',
);
const n0 = (value) => Math.round(value).toLocaleString('en-US');
const monthLabel = (key) =>
  `${SHORT_MONTHS[Number(key.slice(5)) - 1]} ${key.slice(0, 4)}`;

/**
 * Data card for one meter: { title, rows, bars }. `scenario` is that
 * meter's entry from allocateScenario (allocate.js), when one is playing.
 */
export function meterCard(meter, { scenario = null, sample = false } = {}) {
  const rows = [['End use', END_USES[meter.endUse].label]];
  if (meter.address) rows.push(['Service address', meter.address]);
  if (meter.tariff) rows.push(['Rate schedule', meter.tariff]);
  const months = recentMonths(meter, 12);
  if (months.length) {
    rows.push([
      months.length === 12 ? 'Last 12 months' : `Last ${months.length} months`,
      `${n0(annualKwh(meter))} kWh (to ${monthLabel(months.at(-1)[0])})`,
    ]);
  } else rows.push(['Billed use', 'No bills loaded']);
  if (meter.peakKw != null)
    rows.push([
      'Billed peak',
      `${n0(meter.peakKw)} kW${meter.peakAt ? ` (${meter.peakAt})` : ''}`,
    ]);
  if (meter.serviceKva)
    rows.push([
      'Service size',
      `${n0(meter.serviceKva)} kVA${meter.transformer ? ` (${meter.transformer})` : ''}`,
    ]);
  if (meter.circuit) rows.push(['SCE circuit', meter.circuit]);
  if (scenario) {
    rows.push(['Scenario load now', `${n0(scenario.nowKw)} kW`]);
    rows.push([
      'Scenario adds',
      `${n0(scenario.kwh)} kWh/yr, ${n0(scenario.peakKw)} kW peak`,
    ]);
    if (scenario.bill != null)
      rows.push([
        'Scenario bill',
        `$${n0(scenario.bill)}/yr on ${scenario.tariffName}`,
      ]);
  }
  const room = headroomKw(meter, scenario?.peakKw ?? 0);
  if (room != null)
    rows.push([
      'Headroom',
      room >= 0 ? `${n0(room)} kW spare` : `${n0(-room)} kW over the service`,
    ]);
  if (meter.approximate) rows.push(['Position', 'Approximate, needs a survey']);
  if (meter.notes) rows.push(['Note', meter.notes]);
  if (sample) rows.push(['Data', 'Sample numbers, not real bills']);
  return {
    title: meter.label,
    rows,
    bars: months.map(([month, kwh]) => ({ label: monthLabel(month), kwh })),
    over: room != null && room < 0,
  };
}

/** Card for the whole port: kWh by end use. */
export function portCard(registry) {
  const total = portKwh(registry);
  return {
    title: `${registry.port || 'Port'} electricity by end use`,
    rows: [
      ['All meters', `${n0(total)} kWh/yr on ${registry.meters.length} meters`],
      ...rollupByEndUse(registry)
        .filter((row) => row.kwh > 0)
        .map((row) => [
          row.label,
          `${n0(row.kwh)} kWh (${Math.round(row.share * 100)}%)`,
        ]),
      ...(registry.sample
        ? [['Data', 'Sample numbers, not real bills']]
        : registry.asOf
          ? [['Bills to', registry.asOf]]
          : []),
    ],
    bars: [],
  };
}

const months = (start, values) =>
  Object.fromEntries(
    values.map((kwh, i) => {
      const date = new Date(Date.UTC(start[0], start[1] - 1 + i, 1));
      return [
        `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`,
        kwh,
      ];
    }),
  );
const flat = (kwh) => months([2025, 1], new Array(12).fill(kwh));

/**
 * Made-up registry for a port laid out like Hueneme's South Terminal.
 * Positions are the public building locations; every number is invented.
 */
export const SAMPLE_REGISTRY = normalizeRegistry({
  port: 'Port of Hueneme',
  source: 'Sample data shipped with the app',
  sample: true,
  meters: [
    {
      id: 'sample-shore-power',
      label: 'Shore power service (sample)',
      endUse: 'shore_power',
      at: [34.14611, -119.20215],
      approximate: true,
      tariff: 'TOU-EV-9',
      serviceKva: 10500,
      carries: ['shore_power'],
      peakKw: 2400,
      monthlyKwh: months(
        [2025, 1],
        [210, 180, 240, 260, 200, 250, 280, 300, 270, 290, 310, 260].map(
          (v) => v * 1000,
        ),
      ),
    },
    {
      id: 'sample-reefers',
      label: 'Reefer rows service (sample)',
      endUse: 'reefer',
      at: [34.14685, -119.20491],
      approximate: true,
      tariff: 'TOU-GS-3',
      serviceKva: 2000,
      plugs: 120,
      peakKw: 600,
      monthlyKwh: months(
        [2025, 1],
        [180, 150, 170, 120, 100, 100, 150, 140, 160, 180, 220, 240].map(
          (v) => v * 1000,
        ),
      ),
    },
    {
      id: 'sample-crane-power',
      label: 'Crane power service (sample)',
      endUse: 'crane',
      at: [34.14752, -119.20585],
      approximate: true,
      tariff: 'TOU-8-D',
      serviceKva: 3700,
      carries: ['crane'],
      peakKw: 70,
      monthlyKwh: flat(1500),
    },
    {
      id: 'sample-utr-chargers',
      label: 'UTR charger service (sample)',
      endUse: 'equipment_charging',
      at: [34.146535, -119.20739],
      approximate: true,
      tariff: 'TOU-EV-9',
      serviceKva: 800,
      carries: ['equipment_charging'],
      peakKw: 90,
      monthlyKwh: flat(9000),
    },
    {
      id: 'sample-warehouse',
      label: 'Wharf warehouse (sample)',
      endUse: 'buildings',
      at: [34.1475, -119.20687],
      approximate: true,
      tariff: 'TOU-GS-2',
      serviceKva: 1500,
      peakKw: 40,
      monthlyKwh: flat(21000),
    },
    {
      id: 'sample-high-mast',
      label: 'High-mast lighting (sample)',
      endUse: 'lighting',
      at: [34.14608, -119.2002],
      approximate: true,
      tariff: 'TOU-GS-2',
      peakKw: 21,
      monthlyKwh: flat(4500),
    },
  ],
});
