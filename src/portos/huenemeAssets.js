/**
 * Port of Hueneme port-wide assets beyond the cargo-handling fleet:
 * berth details, buildings, tanks, yards, gates, rail and harbor craft.
 *
 * Everything here is from public sources and each record names its source.
 * Records marked `approximate` or carrying a "to confirm" note are a
 * starting point for port staff, who correct them in the admin portal.
 * Real meter links, unit numbers and anything else private go in the
 * run-time overlay (see assets/load.js), never in this file.
 *
 * Positions are [lat, lon]. Surveyed points were placed by port staff on
 * Google Maps (2026-11-09, also in twin/layout.js).
 */
import { OSM_GEOMETRY } from './huenemeOsm.js';

const TERMINAL_PLAN =
  'Oxnard Harbor District, At Berth Regulation Port & Terminal Plan, revised May 2025';
const PORT_STAFF = 'Port of Hueneme staff via Chris (2026-11-10)';
const PORT_FACTS =
  'Port of Hueneme, About the Port: Port Facts (portofhueneme.org, read 2026-11-10)';
const OSM = 'OpenStreetMap (ODbL 1.0), © OpenStreetMap contributors';
const SURVEY = 'Surveyed by port staff on Google Maps, 2026-11-09';
const TUG_2020 =
  'Port of Hueneme, "Wave of the Future: Port Welcomes New Brusco Tug" (2020-01-02)';
const VCRR_WIKI =
  'Wikipedia, Ventura County Railroad (motive power, revision of 2025-11-22)';
const VCRR_PORT = 'Port of Hueneme, Train Routes (portofhueneme.org)';

const HP_TO_KW = 0.7457;
const ACRE_M2 = 4046.86;
const FT_TO_M = 0.3048;

/** Port-wide facts for the port card. */
export const HUENEME_SITE = Object.freeze({
  terminalAcresOwned: 120,
  terminalAcresJointUse: 34,
  entranceChannelDepthM: 12,
  largestVesselLoaM: 244,
  reeferPlugsOnPort: 299,
  railMiles: 12,
  railCarloadsPerYear: 2000,
  source: `${PORT_FACTS}; carloads from ${VCRR_WIKI}`,
});

/**
 * Energy specs for harbor craft and locomotives. Fuel per working hour is
 * rated kW x load factor x gallons per kWh, so it scales with each unit's
 * own `ratedKw`. 0.0666 gal/kWh is a 213 g/kWh diesel engine at 3.2 kg/gal.
 */
export const CRAFT_SPECS = Object.freeze({
  tug_assist: {
    label: 'Ship-assist tug',
    loadFactor: 0.31,
    dieselGallonsPerKwh: 0.0666,
    source:
      'Assumed: load factor 0.31 for tug propulsion and 213 g/kWh fuel use, typical of harbor craft inventories; check against CARB commercial harbor craft data',
  },
  switcher_locomotive: {
    label: 'Switcher locomotive',
    loadFactor: 0.1,
    dieselGallonsPerKwh: 0.0666,
    source:
      'Assumed: switch duty runs mostly at idle and low notches; load factor 0.1 until measured',
  },
});

/** Diesel gallons per working hour for a unit with `ratedKw`, or null. */
export function dieselGphOf(asset, specs = CRAFT_SPECS) {
  const spec = specs[asset.specId];
  if (!spec?.loadFactor || !asset.ratedKw) return null;
  return asset.ratedKw * spec.loadFactor * spec.dieselGallonsPerKwh;
}

/** Length of a [lat, lon] path in metres. */
export function pathLengthM(path) {
  let total = 0;
  for (let i = 1; i < path.length; i += 1) {
    const [lat1, lon1] = path[i - 1];
    const [lat2, lon2] = path[i];
    const north = (lat2 - lat1) * 111_320;
    const east =
      (lon2 - lon1) * 111_320 * Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180);
    total += Math.hypot(north, east);
  }
  return Math.round(total);
}

/** Extra fields for the berths already in the registry, by berth id. */
export const BERTH_DETAILS = Object.freeze({
  'berth-1': {
    label: 'Berth 1',
    zone: 'South Terminal',
    wharf: 'Wharf 1',
    operator: 'Port of Hueneme',
    cargo: 'Reefer containers and tankers',
    lengthM: Math.round(900 * FT_TO_M),
    at: [34.147893, -119.206976],
    source: `${TERMINAL_PLAN}; length: ${PORT_FACTS}; position: ${SURVEY}`,
    notes:
      'Ship shore power for reefer vessels. The South Terminal system was destroyed in the Dec 21, 2023 storm and is being rebuilt for two ships at once, due late 2027 to early 2028; a STAX ECCS barge serves reefer calls until then. Plan boundary: 119°12\'31"W to 119°12\'21"W at 34°08\'51"N.',
  },
  'berth-2': {
    label: 'Berth 2',
    zone: 'South Terminal',
    wharf: 'Wharf 1',
    operator: 'Port of Hueneme',
    cargo: 'Reefer containers and tankers',
    lengthM: Math.round(900 * FT_TO_M),
    at: [34.14785, -119.204461],
    source: `${TERMINAL_PLAN}; length: ${PORT_FACTS}; position: ${SURVEY}`,
    notes:
      'Ship shore power for reefer vessels, out of service since the Dec 21, 2023 storm and due back late 2027 to early 2028. Plan boundary: 119°12\'21"W to 119°12\'10"W at 34°08\'51"N.',
  },
  'berth-3': {
    label: 'Berth 3',
    source: `${PORT_FACTS}; use: ${PORT_STAFF}`,
    notes:
      'Not in the 2025 terminal plan, which names only Berths 1, 2, 4, 5 and the Navy Terminal. Port staff say it is rarely used; the port fact sheet lists it for fishing vessels. No ship shore power.',
  },
  'berth-4': {
    label: 'Berth 4 (RoRo)',
    zone: 'North Terminal',
    wharf: 'Wharf 2',
    operator: 'Port of Hueneme',
    cargo: 'RoRo vehicles; reefer containers occasionally',
    lengthM: Math.round(700 * FT_TO_M),
    at: [34.148611, -119.204583],
    source: `${TERMINAL_PLAN}; length: ${PORT_FACTS}`,
    notes:
      'Wharf 2 takes one RoRo ship at a time. Dual-voltage shore power with a mobile connection is planned for Berths 4 and 5, due Q1 2028; a STAX ECCS barge serves RoRo calls until then. Position is the middle of the plan boundary, 119°12\'21"W to 119°12\'12"W at 34°08\'55"N.',
  },
  'berth-5': {
    label: 'Berth 5',
    zone: 'North Terminal',
    wharf: 'Wharf 2',
    operator: 'Port of Hueneme',
    cargo: 'RoRo vehicles; reefer containers occasionally',
    lengthM: Math.round(700 * FT_TO_M),
    at: [34.148611, -119.202639],
    source: `${TERMINAL_PLAN}; length: ${PORT_FACTS}`,
    notes:
      'Shares Wharf 2 with Berth 4 (one RoRo ship at a time); shore power planned for Q1 2028. Position is the middle of the plan boundary, 119°12\'12"W to 119°12\'07"W at 34°08\'55"N.',
  },
  'berth-6': {
    label: 'Berth 6 (Navy Terminal, joint use)',
    zone: 'Navy Terminal',
    operator: 'US Navy (Naval Base Ventura County), joint use with the port',
    cargo: 'Low use: heavy lift and general cargo',
    lengthM: Math.round(1000 * FT_TO_M),
    source: `${TERMINAL_PLAN}; length and joint use: ${PORT_FACTS}`,
    notes:
      'The plan treats the Navy Terminal as one low-use terminal on Naval Base Ventura County, outside port property and jurisdiction; the port needs Navy Port Operations approval for each call. Plan line: 34°08\'55"N to 34°09\'05"N at 119°12\'22"W.',
  },
  'berth-7': {
    label: 'Berth 7 (Navy Terminal)',
    zone: 'Navy Terminal',
    operator: 'US Navy (Naval Base Ventura County)',
    source: `${TERMINAL_PLAN}; ${PORT_FACTS}`,
    notes:
      'Navy wharf 4 in the port fact sheet (used under license). Low use; the port needs Navy approval for each call.',
  },
  'berth-8': {
    label: 'Berth 8 (Navy Terminal)',
    zone: 'Navy Terminal',
    operator: 'US Navy (Naval Base Ventura County)',
    source: `${TERMINAL_PLAN}; ${PORT_FACTS}`,
    notes: 'Navy wharf 5 in the port fact sheet (used under license).',
  },
  'berth-9': {
    label: 'Berth 9 (Navy Terminal)',
    zone: 'Navy Terminal',
    operator: 'US Navy (Naval Base Ventura County)',
    source: `${TERMINAL_PLAN}; ${PORT_FACTS}`,
    notes: 'Navy wharf 6 in the port fact sheet (used under license).',
  },
});

const footprint = (osmId) => OSM_GEOMETRY[osmId];

const tank = (id, label, osmId, extra) => ({
  id,
  class: 'building',
  use: 'tank',
  label,
  outline: footprint(osmId),
  osmId,
  status: 'active',
  ...extra,
});

/** Port-wide assets that are not in the cargo-handling fleet. */
export const PORT_ASSETS = Object.freeze([
  // Buildings
  {
    id: 'bldg-del-monte',
    class: 'building',
    use: 'cold_storage',
    label: 'Del Monte on-dock cold storage',
    operator: 'Fresh Del Monte Produce',
    status: 'active',
    refrigerated: true,
    floorAreaSqft: 93_000,
    areaM2: 7810,
    yearBuilt: 1995,
    at: [34.1473125, -119.2034375],
    outline: footprint(170149085),
    osmId: 170149085,
    source: `${PORT_FACTS}; footprint: ${OSM}; position: ${SURVEY}`,
    notes:
      'Built 1995 at 30,000 sq ft and expanded since; the port now lists 93,000 sq ft on-dock.',
  },
  {
    id: 'bldg-wharf1-west',
    class: 'building',
    use: 'warehouse',
    label: 'Wharf 1 warehouse (west)',
    status: 'active',
    areaM2: 7299,
    outline: footprint(170149087),
    osmId: 170149087,
    source: OSM,
    notes:
      'With the east building, about 145,000 sq ft: likely the 140,000 sq ft refrigerated facility the port built in 1994 for Cool Carriers and Sunkist. Use and tenant to confirm.',
  },
  {
    id: 'bldg-wharf1-east',
    class: 'building',
    use: 'warehouse',
    label: 'Wharf 1 warehouse (east)',
    status: 'active',
    areaM2: 6192,
    outline: footprint(170149086),
    osmId: 170149086,
    source: OSM,
    notes: 'See the west building. Use and tenant to confirm.',
  },
  {
    id: 'bldg-port-hq',
    class: 'building',
    use: 'office',
    label: 'Port headquarters, 333 Ponoma St',
    operator: 'Oxnard Harbor District',
    status: 'active',
    source:
      'Port of Hueneme contact page; solar: "Port of Hueneme and ForeFront Power Energize Solar Carport" (2026-10-30)',
    notes:
      'A 913 kW solar carport at the headquarters was energized in October 2026. Position to survey.',
  },
  tank('tank-yara-1', 'Yara terminal tank 1', 1098969490, {
    operator: 'Yara',
    areaM2: 859,
    source: `${OSM}; terminal position: ${SURVEY}`,
    notes:
      'Liquid bulk tank at the surveyed Yara terminal. Product to confirm.',
  }),
  tank('tank-yara-2', 'Yara terminal tank 2', 1098969491, {
    operator: 'Yara',
    areaM2: 859,
    source: `${OSM}; terminal position: ${SURVEY}`,
  }),
  tank('tank-yara-3', 'Yara terminal tank 3', 1098969492, {
    operator: 'Yara',
    areaM2: 859,
    source: `${OSM}; terminal position: ${SURVEY}`,
  }),
  tank('tank-wharf1-1', 'Tank by Del Monte (1)', 406256942, {
    areaM2: 70,
    source: OSM,
    notes: 'Owner and contents unknown.',
  }),
  tank('tank-wharf1-2', 'Tank by Del Monte (2)', 406256944, {
    areaM2: 198,
    source: OSM,
    notes: 'Owner and contents unknown.',
  }),
  tank('tank-wharf1-3', 'Tank by Del Monte (3)', 406256949, {
    areaM2: 197,
    source: OSM,
    notes: 'Owner and contents unknown.',
  }),

  // Yards and lots
  {
    id: 'yard-eutr-chargers',
    class: 'yard',
    use: 'equipment_parking',
    label: 'Electric UTR charging lot',
    status: 'active',
    at: [34.146535, -119.20739],
    capacityUnit: 'units',
    source: SURVEY,
  },
  {
    id: 'yard-diesel-queue-berth1',
    class: 'yard',
    use: 'equipment_parking',
    label: 'Diesel UTR queue, berth 1',
    status: 'active',
    at: [34.146904, -119.207153],
    source: SURVEY,
  },
  {
    id: 'yard-diesel-queue-shared',
    class: 'yard',
    use: 'equipment_parking',
    label: 'Diesel UTR queue, shared',
    status: 'active',
    at: [34.146893, -119.205775],
    source: SURVEY,
  },
  {
    id: 'yard-reach-stackers',
    class: 'yard',
    use: 'equipment_parking',
    label: 'Reach stacker parking',
    status: 'active',
    at: [34.146913, -119.206134],
    source: SURVEY,
  },
  {
    id: 'yard-auto-temporary',
    class: 'yard',
    use: 'auto_storage',
    label: 'Temporary outdoor vehicle storage',
    operator: 'Oxnard Harbor District',
    areaM2: Math.round(27.5 * ACRE_M2),
    capacityUnit: 'vehicles',
    source:
      'CEQA, Port of Hueneme Temporary Outdoor Vehicle Storage Facility (SCH 2020069039)',
    notes:
      'About 27.5 parkable acres. Position, capacity and status to confirm.',
  },
  {
    id: 'yard-rail-switchyard',
    class: 'yard',
    use: 'rail_yard',
    label: 'Rail switchyard',
    operator: 'Ventura County Railroad',
    areaM2: Math.round(8 * ACRE_M2),
    capacity: 99,
    capacityUnit: 'railcars',
    source: PORT_FACTS,
    notes: '8 acres; holds 99 boxcars or 80 auto racks. Position to survey.',
  },

  // Gates
  {
    id: 'gate-main',
    class: 'gate',
    label: 'Main terminal truck gate',
    lanes: 2,
    direction: 'both',
    status: 'active',
    source: 'Placeholder',
    notes:
      'Placeholder so the gate can be filled in: lanes, position, hours and truck counts per day, month and year are to confirm from port gate records.',
  },

  // Rail
  {
    id: 'rail-south-spur',
    class: 'rail_spur',
    label: 'South Spur',
    railroad: 'Ventura County Railroad (Genesee & Wyoming)',
    status: 'active',
    path: footprint(763496376),
    lengthM: pathLengthM(footprint(763496376)),
    source: `${VCRR_PORT}; track: ${OSM}`,
    notes:
      'The railroad reaches the port here: an industrial spur with rail platforms for domestically built vehicles bound for the vehicle distribution centers.',
  },
  {
    id: 'rail-north-spur',
    class: 'rail_spur',
    label: 'North Spur (Navy joint use)',
    railroad: 'Ventura County Railroad (Genesee & Wyoming)',
    status: 'active',
    path: footprint(28270106),
    lengthM: pathLengthM(footprint(28270106)),
    source: `${VCRR_PORT}; track: ${OSM}`,
    notes:
      'Ends inside Naval Base Ventura County; the port uses it under a joint use agreement.',
  },
  {
    id: 'loco-vcrr-gp15-1',
    class: 'locomotive',
    label: 'VCRR EMD GP15-1',
    operator: 'Ventura County Railroad',
    railroad: 'VCRR',
    service: 'switcher',
    powertrain: 'diesel',
    specId: 'switcher_locomotive',
    make: 'EMD',
    model: 'GP15-1',
    ratedKw: Math.round(1500 * HP_TO_KW),
    status: 'active',
    source: VCRR_WIKI,
    notes: 'Unit number, engine tier and hours to confirm with the railroad.',
  },
  {
    id: 'loco-vcrr-gp7de',
    class: 'locomotive',
    label: 'VCRR EMD GP7DE',
    operator: 'Ventura County Railroad',
    railroad: 'VCRR',
    service: 'switcher',
    powertrain: 'diesel',
    specId: 'switcher_locomotive',
    make: 'EMD',
    model: 'GP7DE (rebuilt GP7U)',
    status: 'active',
    source: VCRR_WIKI,
    notes: 'Rebuild details and rating to confirm.',
  },
  {
    id: 'loco-vcrr-gp38-2',
    class: 'locomotive',
    label: 'VCRR EMD GP38-2',
    operator: 'Ventura County Railroad',
    railroad: 'VCRR',
    service: 'switcher',
    powertrain: 'diesel',
    specId: 'switcher_locomotive',
    make: 'EMD',
    model: 'GP38-2',
    ratedKw: Math.round(2000 * HP_TO_KW),
    status: 'active',
    source: VCRR_WIKI,
    notes:
      'A 2025 trackside video shows two locomotives working the line; which units are on the roster now is to confirm.',
  },

  // Harbor craft
  {
    id: 'tug-teresa-brusco',
    class: 'tug',
    label: 'Teresa Brusco',
    operator: 'Brusco Tug & Barge',
    powertrain: 'diesel',
    specId: 'tug_assist',
    engineTier: 'tier3',
    ratedKw: Math.round(4750 * HP_TO_KW),
    bollardPullT: 61,
    at: [34.147757, -119.203017],
    status: 'active',
    source: `${TUG_2020}; tug berth: ${SURVEY}`,
    notes:
      'Arrived January 2020, replacing the Lulapin. Still at Hueneme in 2026 to confirm. Drawn at the surveyed tug berth.',
  },
  {
    id: 'tug-simone-brusco',
    class: 'tug',
    label: 'Simone Brusco',
    operator: 'Brusco Tug & Barge',
    powertrain: 'diesel',
    specId: 'tug_assist',
    status: 'active',
    source: TUG_2020,
    notes:
      'Named in the 2020 article. Rating and current assignment to confirm.',
  },
  {
    id: 'tug-wynema-spirit',
    class: 'tug',
    label: 'Wynema Spirit',
    operator: 'Brusco Tug & Barge',
    powertrain: 'diesel',
    specId: 'tug_assist',
    status: 'active',
    source: 'American Navigation (AmNav) news item on Brusco tugs',
    notes:
      "Brusco's first ASD tug, built for Port Hueneme. Rating and current assignment to confirm.",
  },
]);
