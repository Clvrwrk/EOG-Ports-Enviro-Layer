/**
 * Ship inventory: the vessels that call at a port.
 *
 * Ships are visitors, not port assets, so they live in their own store
 * beside the asset registry (assetClasses.js). A record holds the ship's
 * public registry particulars (IMO, MMSI, size, age) plus, when the port
 * supplies its call history, how often it called and at which berths.
 *
 * Every record names its `source`. Any field that was estimated rather than
 * read from a registry is listed in `estimated`.
 */

/** Cargo classes, matching the port's own vessel categories. */
export const CARGO_CLASSES = Object.freeze({
  reefer: 'Refrigerated cargo (bananas, produce)',
  roro: 'Ro-Ro / vehicle carrier',
  tanker: 'Tanker',
  heavy_lift: 'Heavy lift / project cargo',
  general_cargo: 'General cargo',
  other: 'Other',
});

/** The port's "Vessel Type - Generic" label to a cargo class. */
const GENERIC_TYPE_CLASS = [
  [/refrig|reefer/i, 'reefer'],
  [/ro-?ro|vehicle/i, 'roro'],
  [/tanker/i, 'tanker'],
  [/heavy lift/i, 'heavy_lift'],
  [/general cargo/i, 'general_cargo'],
];

export function cargoClassFromType(type) {
  const text = String(type ?? '');
  for (const [pattern, cargoClass] of GENERIC_TYPE_CLASS)
    if (pattern.test(text)) return cargoClass;
  return 'other';
}

const PARTICULARS = Object.freeze([
  'grossTonnage',
  'deadweight',
  'lengthM',
  'beamM',
  'draftM',
  'yearBuilt',
]);

const num = (value) =>
  value === null || value === undefined || value === '' || value === 0
    ? null
    : Number.isFinite(Number(value))
      ? Number(value)
      : null;

const text = (value) => {
  const s = value === null || value === undefined ? '' : String(value).trim();
  return s ? s : null;
};

/** Vessel id: `imo-<IMO>` when the IMO is known, else `mmsi-<MMSI>`. */
export function vesselId({ imo, mmsi }) {
  if (text(imo)) return `imo-${text(imo)}`;
  if (text(mmsi)) return `mmsi-${text(mmsi)}`;
  return null;
}

/** Clean one record: trims text, turns blank or zero sizes into null. */
export function normalizeVessel(raw) {
  const particulars = {};
  for (const key of PARTICULARS)
    particulars[key] = num(raw.particulars?.[key] ?? raw[key]);
  const imo = text(raw.imo);
  const mmsi = text(raw.mmsi);
  const vessel = {
    id: raw.id ?? vesselId({ imo, mmsi }),
    name: text(raw.name)?.toUpperCase() ?? null,
    imo,
    mmsi,
    callsign: text(raw.callsign),
    flag: text(raw.flag),
    vesselType: text(raw.vesselType),
    cargoClass: CARGO_CLASSES[raw.cargoClass]
      ? raw.cargoClass
      : cargoClassFromType(raw.cargoClass ?? raw.vesselType),
    particulars,
    renamedTo: text(raw.renamedTo),
    shorePower: raw.shorePower ?? null,
    engines: raw.engines ?? null,
    estimated: Array.isArray(raw.estimated) ? [...raw.estimated] : [],
    note: text(raw.note),
    source: text(raw.source),
  };
  if (raw.calls) vessel.calls = normalizeCalls(raw.calls);
  return vessel;
}

function normalizeCalls(calls) {
  const berths = {};
  for (const [berthId, count] of Object.entries(calls.berths ?? {}))
    berths[berthId] = Number(count) || 0;
  const years = {};
  for (const [year, count] of Object.entries(calls.years ?? {}))
    years[year] = Number(count) || 0;
  return {
    count: Number(calls.count) || 0,
    hoursAtBerth: Number(calls.hoursAtBerth) || 0,
    berths,
    years,
  };
}

/**
 * Check an inventory: every vessel needs an id, name, cargo class and
 * source, and ids must be unique. Returns a list of problems (empty if ok).
 */
export function validateInventory(inventory) {
  const problems = [];
  const seen = new Set();
  for (const [index, vessel] of (inventory?.vessels ?? []).entries()) {
    const where = vessel.id ?? `#${index}`;
    if (!vessel.id) problems.push(`${where}: missing id`);
    else if (seen.has(vessel.id)) problems.push(`${where}: duplicate id`);
    seen.add(vessel.id);
    if (!vessel.name) problems.push(`${where}: missing name`);
    if (!CARGO_CLASSES[vessel.cargoClass])
      problems.push(`${where}: unknown cargo class ${vessel.cargoClass}`);
    if (!vessel.source) problems.push(`${where}: missing source`);
    if (vessel.imo && !/^\d{7}$/.test(vessel.imo))
      problems.push(`${where}: IMO ${vessel.imo} is not 7 digits`);
    for (const field of vessel.estimated ?? [])
      if (typeof field !== 'string')
        problems.push(`${where}: estimated must list field names`);
  }
  return problems;
}

export function normalizeInventory(raw) {
  return {
    port: raw?.port ?? null,
    generated: raw?.generated ?? null,
    sources: raw?.sources ?? [],
    vessels: (raw?.vessels ?? []).map(normalizeVessel),
  };
}

/**
 * Join call history onto particulars. `calls` maps a vessel id (or MMSI)
 * to { count, hoursAtBerth, berths, years }. Vessels without calls keep
 * their particulars only.
 */
export function mergeCallHistory(inventory, calls) {
  if (!calls) return inventory;
  const byKey = calls.vessels ?? calls;
  return {
    ...inventory,
    callsSource: calls.source ?? null,
    vessels: inventory.vessels.map((vessel) => {
      const history = byKey[vessel.id] ?? byKey[vessel.mmsi];
      return history ? { ...vessel, calls: normalizeCalls(history) } : vessel;
    }),
  };
}

/** Ships that used a berth, most calls first. Needs call history. */
export function vesselsAtBerth(inventory, berthId, { cargoClass, limit } = {}) {
  const list = (inventory?.vessels ?? [])
    .filter((v) => (v.calls?.berths?.[berthId] ?? 0) > 0)
    .filter((v) => !cargoClass || v.cargoClass === cargoClass)
    .sort((a, b) => b.calls.berths[berthId] - a.calls.berths[berthId]);
  return limit ? list.slice(0, limit) : list;
}

/** Count of ships and calls per cargo class. */
export function inventorySummary(inventory) {
  const summary = {};
  for (const vessel of inventory?.vessels ?? []) {
    const row = (summary[vessel.cargoClass] ??= { ships: 0, calls: 0 });
    row.ships += 1;
    row.calls += vessel.calls?.count ?? 0;
  }
  return summary;
}

/** Short one-line description for a data card. */
export function vesselLine(vessel) {
  const p = vessel.particulars ?? {};
  const bits = [];
  if (p.lengthM) bits.push(`${Math.round(p.lengthM)} m`);
  if (p.grossTonnage)
    bits.push(`${Math.round(p.grossTonnage).toLocaleString('en-US')} GT`);
  if (p.yearBuilt) bits.push(`built ${p.yearBuilt}`);
  return bits.length ? `${vessel.name} (${bits.join(', ')})` : vessel.name;
}
