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
 *
 * `engines` holds what the EPA port inventory method (src/emissions/
 * ogvMethod.js) needs that AIS does not broadcast: the main engine, the EPA
 * ship type and subtype, and auxiliary and boiler loads by operating mode.
 * `shorePower` says whether the ship is fitted to plug in at berth.
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
    shorePower: normalizeShorePower(raw.shorePower),
    engines: normalizeEngines(raw.engines),
    estimated: Array.isArray(raw.estimated) ? [...raw.estimated] : [],
    note: text(raw.note),
    source: text(raw.source),
  };
  if (raw.calls) vessel.calls = normalizeCalls(raw.calls);
  return vessel;
}

const MODES = Object.freeze([
  'transit',
  'maneuvering',
  'hotelling',
  'anchorage',
]);

/** Engine types the EPA method knows (Table 3.5). */
export const ENGINE_TYPES = Object.freeze(['SSD', 'MSD', 'HSD', 'ST', 'GT']);

function loadsByMode(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const loads = {};
  for (const mode of MODES) {
    const kw = Number(raw[mode]);
    loads[mode] = raw[mode] === null || !Number.isFinite(kw) ? null : kw;
  }
  return Object.values(loads).some((kw) => kw !== null) ? loads : null;
}

function normalizeEngines(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const main = raw.main ?? {};
  const engineType = ENGINE_TYPES.includes(main.engineType)
    ? main.engineType
    : null;
  return {
    main: {
      make: text(main.make),
      model: text(main.model),
      kw: num(main.kw),
      engineType,
      source: text(main.source),
    },
    epa: raw.epa
      ? {
          shipType: text(raw.epa.shipType),
          subtype: text(raw.epa.subtype),
          basis: text(raw.epa.basis),
        }
      : null,
    auxKw: loadsByMode(raw.auxKw),
    boilerKw: loadsByMode(raw.boilerKw),
    loadsSource: text(raw.loadsSource),
    reeferPlugs: num(raw.reeferPlugs),
    teu: num(raw.teu),
    capacitySource: text(raw.capacitySource),
  };
}

function normalizeShorePower(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'boolean')
    return { capable: raw, source: null, note: null };
  return {
    capable: typeof raw.capable === 'boolean' ? raw.capable : null,
    source: text(raw.source),
    note: text(raw.note),
  };
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
    const engines = vessel.engines;
    if (engines) {
      if (engines.main.kw && !engines.main.source)
        problems.push(`${where}: main engine has no source`);
      if ((engines.auxKw || engines.boilerKw) && !engines.loadsSource)
        problems.push(`${where}: auxiliary and boiler loads have no source`);
      if (engines.auxKw && !engines.epa?.shipType)
        problems.push(`${where}: loads without an EPA ship type`);
    }
    if (
      vessel.shorePower?.capable !== null &&
      vessel.shorePower?.capable !== undefined &&
      !vessel.shorePower.source
    )
      problems.push(`${where}: shore power has no source`);
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

/**
 * The ship as the EPA method's vessel characteristics: a row for
 * createVesselRegistry (src/emissions/vesselRegistry.js) and the `vessel`
 * argument of intervalEmissions and callEmissions. Null when the record has
 * no EPA ship type.
 *
 * The keel-laid year is not public, so the year built stands in for it (keel
 * laying is usually within a year of delivery; it only matters at the NOx tier
 * years 2000, 2011 and 2016).
 */
export function emissionsProfile(vessel) {
  const engines = vessel?.engines;
  if (!engines?.epa?.shipType || !engines.epa.subtype) return null;
  const main = engines.main ?? {};
  const profile = {
    mmsi: vessel.mmsi,
    imo: vessel.imo,
    name: vessel.name,
    shipType: engines.epa.shipType,
    subtype: engines.epa.subtype,
    keelYear: vessel.particulars?.yearBuilt ?? null,
    propulsion: {
      engineType: main.engineType ?? 'SSD',
      installedKw: main.kw ?? null,
      maxDraftM: vessel.particulars?.draftM ?? null,
    },
    auxiliary: { engineType: 'MSD' },
    shorePowerCapable: vessel.shorePower?.capable ?? null,
    estimated: [
      'keelYear',
      ...(main.engineType ? [] : ['propulsion.engineType']),
      ...(vessel.estimated ?? []).filter((f) => f.startsWith('engines.')),
    ],
    source: [main.source, engines.loadsSource, vessel.source]
      .filter(Boolean)
      .join(' | '),
  };
  if (engines.auxKw) profile.auxKw = { ...engines.auxKw };
  if (engines.boilerKw) profile.boilerKw = { ...engines.boilerKw };
  return profile;
}

/** Emissions profiles for every ship that has an EPA ship type. */
export function emissionsProfiles(inventory) {
  return (inventory?.vessels ?? []).map(emissionsProfile).filter(Boolean);
}
