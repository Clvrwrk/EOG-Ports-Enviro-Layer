/**
 * Yard zones and cargo moves for the Port of Hueneme.
 *
 * Every piece of cargo that crosses the terminal makes a move, and each
 * move is a chain of segments, one per machine that touches it: a reefer box
 * goes ship crane -> UTR -> reach stacker into the stack, later reach
 * stacker -> drayage truck out the gate. A new car is driven off the ramp to
 * the lot and its driver rides a van back. Each segment happens in a yard
 * zone and runs on a piece of equipment from the energy specs, so the
 * energy and emissions of the whole port can be read per move, per segment
 * and per zone, and they follow the scenario's electric/diesel fleet mix.
 *
 * Zones, move chains and move counts here are public starting points. Zone
 * outlines are drawn from surveyed points and OpenStreetMap footprints and
 * are marked approximate; segment times and moves per call are assumptions
 * until POH move logs replace them. Real logs (container numbers, times)
 * stay private and never go in this file.
 *
 * Pure: no Cesium, no DOM.
 */
import { EMISSION_FACTORS } from '../fleet/catalog.js';
import { CALL_PROFILE, FACTORS, SPECS } from '../hueneme.js';
import { OSM_GEOMETRY } from '../huenemeOsm.js';
import { SURVEYED, lonLatToOffset, offsetToLonLat } from '../twin/layout.js';

const ASSUMED =
  'Assumed for the first model; replace with POH move logs (segment times per machine) when they arrive';
const SURVEY = 'Surveyed by port staff on Google Maps, 2026-11-09';
const OSM = 'OpenStreetMap (ODbL 1.0), © OpenStreetMap contributors';
const TERMINAL_PLAN =
  'Revised Port of Hueneme Port Terminal Plan, June 2025 (berth boundaries)';

/** Kinds of yard zone, in display order. */
export const ZONE_TYPES = Object.freeze({
  berth_apron: 'Berth apron',
  reefer_yard: 'Reefer box yard',
  cold_storage: 'Cold storage',
  warehouse: 'Warehouse',
  auto_lot: 'Vehicle lot',
  laydown: 'Breakbulk laydown',
  equipment_park: 'Equipment parking and charging',
  gate: 'Truck gate',
  rail: 'Rail loading',
});

/**
 * Where a move starts and ends, as one letter each, read "from > to":
 * V>Y is ship to yard, Y>G yard to gate.
 */
export const PLACES = Object.freeze({
  V: 'Vessel',
  Y: 'Yard',
  W: 'Warehouse or cold storage',
  L: 'Vehicle lot',
  G: 'Gate',
  R: 'Rail',
});

/**
 * Energy specs for move segments that are not in the CHE fleet: drayage
 * trucks while they are on the terminal, and new vehicles driven under their
 * own power. Diesel and electric figures are per working hour.
 */
export const YARD_SPECS = Object.freeze({
  truck_on_terminal: {
    label: 'Drayage truck on terminal',
    // Queueing and creeping through the terminal is mostly idle.
    dieselGph: 1.0,
    kwhPerHour: 8,
    electricShare: 0,
    source:
      'Assumed: about 1 gal/hr for a Class 8 tractor idling and creeping on terminal; battery-electric 8 kWh/hr. Trucks are diesel until the EV Planning fleet is tied in',
  },
  cargo_vehicle: {
    label: 'New vehicle driven by a longshore driver',
    gasolineGph: 0.6,
    kwhPerHour: 4,
    electricShare: 0.1,
    source:
      'Assumed: 0.6 gal/hr for a new car driven slowly from the ramp to the lot; 10% of imports are battery-electric. Gasoline 8.89 kg CO2/gal (EPA)',
  },
});

const GASOLINE_KG_CO2_PER_GALLON = 8.89;

/**
 * Segment kinds: one letter for the chip, the machine, and the spec that
 * prices its energy. `specId` keys SPECS (the CHE fleet the scenario runs)
 * or YARD_SPECS.
 */
export const SEGMENT_KINDS = Object.freeze({
  crane: { code: 'C', label: 'Harbor crane lift', specId: 'harbor_crane' },
  utr: { code: 'U', label: 'UTR haul', specId: 'utr' },
  stack: {
    code: 'S',
    label: 'Reach stacker (stack or unstack)',
    specId: 'reach_stacker',
  },
  forklift: {
    code: 'F',
    label: 'Forklift (pallets)',
    specId: 'forklift_class_iv',
  },
  heavy_forklift: {
    code: 'H',
    label: 'Heavy forklift (high and heavy)',
    specId: 'forklift_class_v',
  },
  drive: { code: 'D', label: 'Vehicle driven', specId: 'cargo_vehicle' },
  van: { code: 'P', label: 'Driver shuttle van', specId: 'light_duty' },
  truck: {
    code: 'T',
    label: 'Drayage truck on terminal',
    specId: 'truck_on_terminal',
  },
});

const M_PER_DEG_LAT = 111_320;
const ORIGIN = Object.freeze({
  lat: SURVEYED.berth1[0],
  lon: SURVEYED.berth1[1],
});

/** A rectangle in metres around the layout origin, as a [lat, lon] ring. */
function box(west, east, south, north) {
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
  ].map(([e, n]) => {
    const [lon, lat] = offsetToLonLat(ORIGIN, { east: e, north: n });
    return [round6(lat), round6(lon)];
  });
}

const round6 = (v) => Math.round(v * 1e6) / 1e6;
const near = (key) => lonLatToOffset(ORIGIN, SURVEYED[key]);
const CRANE_APRON = near('crane2').north;
const BERTH2 = near('berth2');
const CHARGERS = near('eutrChargers');
const QUEUE1 = near('dieselQueueBerth1');
// Wharf 2 (berths 4 and 5): plan boundary 119°12'21"W to 119°12'12"W at
// 34°08'55"N, read to decimal degrees.
const WHARF2 = {
  lat: 34 + 8 / 60 + 55 / 3600,
  west: -(119 + 12 / 60 + 21 / 3600),
  east: -(119 + 12 / 60 + 12 / 3600),
};

/**
 * Yard zones. `outline` is a [lat, lon] ring when the zone's place is known
 * well enough to draw; zones without one are listed but not drawn until
 * their position is surveyed. `equipment` lists SEGMENT_KINDS that work
 * there, `places` the move ends it handles.
 */
export const YARD_ZONES = Object.freeze([
  {
    id: 'zone-apron-south',
    label: 'South Terminal apron (berths 1-2)',
    type: 'berth_apron',
    places: ['V>Y', 'Y>V', 'V>W'],
    outline: box(-90, BERTH2.east + 90, CRANE_APRON - 18, CRANE_APRON + 14),
    approximate: true,
    source: `${SURVEY} (berth and crane working points); apron width assumed`,
  },
  {
    id: 'zone-reefer-yard',
    label: 'Reefer box yard behind berths 1-2',
    type: 'reefer_yard',
    places: ['Y>Y', 'Y>G', 'G>Y'],
    outline: box(
      QUEUE1.east + 20,
      BERTH2.east + 40,
      QUEUE1.north - 70,
      CRANE_APRON - 22,
    ),
    approximate: true,
    source: `${SURVEY} (UTR queues and reach stacker parking); extent assumed`,
  },
  {
    id: 'zone-del-monte',
    label: 'Del Monte on-dock cold storage',
    type: 'cold_storage',
    places: ['V>W', 'W>G'],
    outline: OSM_GEOMETRY[170149085],
    approximate: false,
    source: OSM,
  },
  {
    id: 'zone-wharf1-warehouses',
    label: 'Wharf 1 warehouses',
    type: 'warehouse',
    places: ['V>W', 'W>G'],
    outline: OSM_GEOMETRY[170149087],
    approximate: false,
    source: `${OSM}; west building drawn, east building is part of the zone`,
  },
  {
    id: 'zone-eutr-lot',
    label: 'UTR charging and parking lot',
    type: 'equipment_park',
    places: [],
    outline: box(
      CHARGERS.east - 25,
      CHARGERS.east + 25,
      CHARGERS.north - 18,
      CHARGERS.north + 18,
    ),
    approximate: true,
    source: `${SURVEY} (eUTR charge ports); extent assumed`,
  },
  {
    id: 'zone-apron-north',
    label: 'North Terminal RoRo apron (berths 4-5)',
    type: 'berth_apron',
    places: ['V>L', 'L>V'],
    outline: [
      [WHARF2.lat, WHARF2.west],
      [WHARF2.lat, WHARF2.east],
      [WHARF2.lat - 40 / M_PER_DEG_LAT, WHARF2.east],
      [WHARF2.lat - 40 / M_PER_DEG_LAT, WHARF2.west],
    ].map(([lat, lon]) => [round6(lat), round6(lon)]),
    approximate: true,
    source: `${TERMINAL_PLAN}; apron drawn 40 m inland of the plan line, to confirm`,
  },
  {
    id: 'zone-auto-lot',
    label: 'Vehicle storage lots',
    type: 'auto_lot',
    places: ['V>L', 'L>R', 'L>G'],
    outline: null,
    approximate: true,
    source:
      'CEQA, Port of Hueneme Temporary Outdoor Vehicle Storage Facility (SCH 2020069039); position to survey',
  },
  {
    id: 'zone-laydown',
    label: 'Breakbulk and project cargo laydown (berth 6)',
    type: 'laydown',
    places: ['V>Y', 'Y>G'],
    outline: null,
    approximate: true,
    source: `${TERMINAL_PLAN}; position to survey`,
  },
  {
    id: 'zone-gate',
    label: 'Main terminal truck gate',
    type: 'gate',
    places: ['Y>G', 'G>Y', 'W>G', 'L>G'],
    outline: null,
    approximate: true,
    source: 'Placeholder until the gate is surveyed (see gate-main asset)',
  },
  {
    id: 'zone-rail',
    label: 'Rail switchyard and auto rack loading',
    type: 'rail',
    places: ['L>R'],
    outline: null,
    approximate: true,
    source:
      'Port of Hueneme Port Facts: 8 acre switchyard, 99 boxcars or 80 auto racks; position to survey',
  },
]);

/**
 * Move chains. Each segment names its kind, the zone it happens in and its
 * working minutes per move (machine time, including the empty return).
 */
export const MOVE_TYPES = Object.freeze([
  {
    id: 'reefer-box-in',
    label: 'Reefer box, ship to truck',
    places: 'V>Y>G',
    cargo: 'Reefer container (import)',
    segments: [
      { kind: 'crane', zone: 'zone-apron-south', minutes: 60 / 38 },
      { kind: 'utr', zone: 'zone-reefer-yard', minutes: 8 },
      { kind: 'stack', zone: 'zone-reefer-yard', minutes: 2.5 },
      { kind: 'stack', zone: 'zone-reefer-yard', minutes: 2.5 },
      { kind: 'truck', zone: 'zone-gate', minutes: 15 },
    ],
  },
  {
    id: 'reefer-box-out',
    label: 'Box, truck to ship',
    places: 'G>Y>V',
    cargo: 'Container (export or empty)',
    segments: [
      { kind: 'truck', zone: 'zone-gate', minutes: 15 },
      { kind: 'stack', zone: 'zone-reefer-yard', minutes: 2.5 },
      { kind: 'stack', zone: 'zone-reefer-yard', minutes: 2.5 },
      { kind: 'utr', zone: 'zone-reefer-yard', minutes: 8 },
      { kind: 'crane', zone: 'zone-apron-south', minutes: 60 / 38 },
    ],
  },
  {
    id: 'reefer-pallets-in',
    label: 'Fruit pallets, ship to cold storage',
    places: 'V>W',
    cargo: 'Break-bulk reefer pallets (one sling)',
    segments: [
      { kind: 'crane', zone: 'zone-apron-south', minutes: 2 },
      { kind: 'forklift', zone: 'zone-del-monte', minutes: 6 },
    ],
  },
  {
    id: 'vehicle-in',
    label: 'New vehicle, ship to lot',
    places: 'V>L',
    cargo: 'Vehicle (import)',
    segments: [
      { kind: 'drive', zone: 'zone-apron-north', minutes: 4 },
      // A van of about 8 drivers runs back every 10 minutes.
      { kind: 'van', zone: 'zone-auto-lot', minutes: 10 / 8 },
    ],
  },
  {
    id: 'vehicle-rail',
    label: 'Vehicle, lot to rail',
    places: 'L>R',
    cargo: 'Vehicle on auto rack',
    segments: [
      { kind: 'drive', zone: 'zone-rail', minutes: 5 },
      { kind: 'van', zone: 'zone-rail', minutes: 10 / 8 },
    ],
  },
  {
    id: 'vehicle-truck',
    label: 'Vehicle, lot to car carrier truck',
    places: 'L>G',
    cargo: 'Vehicle on car carrier',
    segments: [
      { kind: 'drive', zone: 'zone-auto-lot', minutes: 3 },
      // A car carrier spends about 30 minutes on terminal for 9 cars.
      { kind: 'truck', zone: 'zone-gate', minutes: 30 / 9 },
    ],
  },
  {
    id: 'project-lift',
    label: 'Heavy lift, ship to laydown',
    places: 'V>Y',
    cargo: 'Project or general cargo piece',
    segments: [
      { kind: 'crane', zone: 'zone-laydown', minutes: 6 },
      { kind: 'heavy_forklift', zone: 'zone-laydown', minutes: 15 },
    ],
  },
]);

/**
 * Moves per ship call by vessel type (CALL_PROFILE types). Assumptions until
 * POH move logs or annual cargo counts replace them.
 */
export const MOVES_PER_CALL = Object.freeze({
  Refrigerated: {
    'reefer-box-in': 450,
    'reefer-box-out': 300,
    'reefer-pallets-in': 350,
  },
  'Ro-Ro/Vehicles Carrier': {
    'vehicle-in': 1500,
    'vehicle-rail': 150,
    'vehicle-truck': 900,
  },
  'Heavy Lift': { 'project-lift': 60 },
  'General Cargo': { 'project-lift': 200 },
  Tanker: {},
  source: ASSUMED,
});

/** Share of a spec's working hours on electric power, 0-1. */
export function electricShare(specId, result = null) {
  const fleet = result?.fleets?.[specId];
  if (fleet) {
    const hours = fleet.electricHours + fleet.dieselHours;
    if (hours > 0) return fleet.electricHours / hours;
    const units = fleet.electric + fleet.diesel;
    return units > 0 ? fleet.electric / units : 0;
  }
  return YARD_SPECS[specId]?.electricShare ?? 0;
}

const specOf = (specs, specId) => specs[specId] ?? YARD_SPECS[specId] ?? null;

/**
 * Energy and emissions for `hours` of a segment kind at an electric share.
 * Diesel CHE is counted at its working fuel burn; grid kWh carry the
 * planning grid factor; NOx is the Tier 4 final floor on diesel engine work.
 */
export function segmentEnergy(
  kind,
  hours,
  share,
  { specs = SPECS, factors = EMISSION_FACTORS } = {},
) {
  const spec = specOf(specs, SEGMENT_KINDS[kind]?.specId);
  if (!spec)
    return { kwh: 0, dieselGallons: 0, gasolineGallons: 0, co2Kg: 0, noxKg: 0 };
  const kwh = hours * share * (spec.kwhPerHour ?? 0);
  const fuelHours = hours * (1 - share);
  const dieselGallons = fuelHours * (spec.dieselGph ?? 0);
  const gasolineGallons = fuelHours * (spec.gasolineGph ?? 0);
  const co2Kg =
    dieselGallons * factors.dieselKgCo2PerGallon +
    gasolineGallons * GASOLINE_KG_CO2_PER_GALLON +
    kwh * factors.gridKgCo2ePerKwh;
  const noxKg =
    (dieselGallons *
      factors.dieselKwhPerGallon *
      factors.cheTier4f.noxGPerKwh) /
    1000;
  return { kwh, dieselGallons, gasolineGallons, co2Kg, noxKg };
}

const add = (into, from) => {
  for (const key of Object.keys(from)) into[key] = (into[key] ?? 0) + from[key];
  return into;
};
const zero = () => ({
  kwh: 0,
  dieselGallons: 0,
  gasolineGallons: 0,
  co2Kg: 0,
  noxKg: 0,
});

/** Ship calls per year by vessel type: from a scenario run, else the profile. */
export function callsByType(result = null) {
  const counts = {};
  if (result?.calls?.length) {
    for (const call of result.calls)
      counts[call.type] = (counts[call.type] ?? 0) + 1;
    return counts;
  }
  for (const row of CALL_PROFILE) counts[row.type] = row.callsPerYear;
  return counts;
}

/** Moves per year by move type id. */
export function movesPerYear(
  result = null,
  { movesPerCall = MOVES_PER_CALL } = {},
) {
  const calls = callsByType(result);
  const moves = {};
  for (const [type, count] of Object.entries(calls))
    for (const [moveId, perCall] of Object.entries(movesPerCall[type] ?? {}))
      moves[moveId] = (moves[moveId] ?? 0) + count * perCall;
  return moves;
}

/**
 * The yard model for one scenario run: every move type with its yearly
 * count and per-move and per-segment energy, and every zone with its moves,
 * equipment and totals. Electric shares follow the run's fleet mix (the
 * scenario year and the twin's UTR and crane decisions).
 *
 * @param {object|null} result a runScenario result, or null for the profile
 * @param {{ specs?: object, movesPerCall?: object, factors?: object }} [options]
 */
export function yardModel(result = null, options = {}) {
  const specs = options.specs ?? SPECS;
  const factors = options.factors ?? EMISSION_FACTORS;
  const yearly = movesPerYear(result, options);
  const shares = {};
  for (const kind of Object.values(SEGMENT_KINDS))
    shares[kind.specId] = electricShare(kind.specId, result);

  const zones = new Map(
    YARD_ZONES.map((zone) => [
      zone.id,
      {
        zone,
        moves: 0,
        segments: 0,
        hours: 0,
        equipment: new Set(),
        moveTypes: new Set(),
        totals: zero(),
      },
    ]),
  );

  const moves = MOVE_TYPES.map((type) => {
    const count = yearly[type.id] ?? 0;
    const perMove = zero();
    const touched = new Set();
    const segments = type.segments.map((segment) => {
      const kind = SEGMENT_KINDS[segment.kind];
      const share = shares[kind.specId];
      const one = segmentEnergy(segment.kind, segment.minutes / 60, share, {
        specs,
        factors,
      });
      add(perMove, one);
      const year = segmentEnergy(
        segment.kind,
        (segment.minutes / 60) * count,
        share,
        { specs, factors },
      );
      const zone = zones.get(segment.zone);
      if (zone) {
        add(zone.totals, year);
        zone.segments += count;
        zone.hours += (segment.minutes / 60) * count;
        zone.equipment.add(segment.kind);
        zone.moveTypes.add(type.id);
        touched.add(segment.zone);
      }
      return {
        ...segment,
        code: kind.code,
        label: kind.label,
        specId: kind.specId,
        electricShare: share,
        perMove: one,
        perYear: year,
      };
    });
    for (const id of touched) zones.get(id).moves += count;
    const perYear = zero();
    for (const segment of segments) add(perYear, segment.perYear);
    return { ...type, count, segments, perMove, perYear };
  });

  const zoneRows = [...zones.values()].map((row) => ({
    ...row.zone,
    typeLabel: ZONE_TYPES[row.zone.type],
    moves: row.moves,
    segments: row.segments,
    hours: row.hours,
    equipment: [...row.equipment],
    moveTypes: [...row.moveTypes],
    totals: row.totals,
  }));
  const totals = zero();
  for (const move of moves) add(totals, move.perYear);
  return {
    year: result?.scenario?.year ?? null,
    moves,
    zones: zoneRows,
    shares,
    totals: {
      ...totals,
      moves: moves.reduce((acc, m) => acc + m.count, 0),
      dieselCost: totals.dieselGallons * FACTORS.dieselDollarsPerGallon,
    },
    sources: {
      movesPerCall: MOVES_PER_CALL.source,
      segments: ASSUMED,
      trucks: YARD_SPECS.truck_on_terminal.source,
      vehicles: YARD_SPECS.cargo_vehicle.source,
    },
  };
}

/** Metrics a zone can be coloured by. */
export const ZONE_METRICS = Object.freeze({
  moves: { label: 'Moves per year', unit: 'moves', of: (z) => z.moves },
  co2: {
    label: 'CO2 (t per year)',
    unit: 't CO2',
    of: (z) => z.totals.co2Kg / 1000,
  },
  kwh: {
    label: 'Grid energy (MWh per year)',
    unit: 'MWh',
    of: (z) => z.totals.kwh / 1000,
  },
  diesel: {
    label: 'Diesel (gal per year)',
    unit: 'gal',
    of: (z) => z.totals.dieselGallons,
  },
  nox: {
    label: 'NOx (kg per year)',
    unit: 'kg NOx',
    of: (z) => z.totals.noxKg,
  },
});

/** Data card rows for a zone. */
export function zoneCard(zoneRow, model) {
  if (!zoneRow) return null;
  const n = (v, digits = 0) =>
    Number(v).toLocaleString('en-US', { maximumFractionDigits: digits });
  const moveNames = zoneRow.moveTypes
    .map((id) => model.moves.find((m) => m.id === id)?.label)
    .filter(Boolean);
  return {
    title: zoneRow.label,
    rows: [
      ['Type', zoneRow.typeLabel],
      ['Handles', zoneRow.places.join(', ') || 'Parking and charging'],
      ['Moves per year', n(zoneRow.moves)],
      ['Machine hours per year', n(zoneRow.hours)],
      [
        'Equipment',
        zoneRow.equipment.map((k) => SEGMENT_KINDS[k].label).join(', ') ||
          'None modeled yet',
      ],
      ['Grid energy', `${n(zoneRow.totals.kwh / 1000, 1)} MWh`],
      ['Diesel', `${n(zoneRow.totals.dieselGallons)} gal`],
      ['CO2', `${n(zoneRow.totals.co2Kg / 1000, 1)} t`],
      ['NOx (Tier 4f floor)', `${n(zoneRow.totals.noxKg, 1)} kg`],
      ['Move types', moveNames.join('; ') || 'None'],
      [
        'Outline',
        zoneRow.outline
          ? zoneRow.approximate
            ? 'Approximate'
            : 'Mapped'
          : 'Not drawn, position to survey',
      ],
      ['Source', zoneRow.source],
    ],
  };
}
