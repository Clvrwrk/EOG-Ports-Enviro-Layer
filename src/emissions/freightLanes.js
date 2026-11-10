// Port of Hueneme freight lanes: where the port's cargo comes from, where it
// goes once it leaves the gate, and the assumptions that turn tonnes into
// emissions. Data only; src/emissions/freightFootprint.js does the math.
//
// What is published (and cited) and what is modeled (and labeled) is kept
// apart. Published: cargo volumes by commodity, top trading partners, fresh
// produce origins and the off-dock facility addresses, all from the Port of
// Hueneme update to the Ventura County Transportation Commission. Modeled:
// how each commodity splits across origins, drop sites and markets, the
// vessels, speeds and truck payloads. Every modeled number lives here, in one
// place, so it can be checked and replaced.

export const FREIGHT_SOURCES = Object.freeze({
  volumes: Object.freeze({
    title:
      // i18n-ignore: source citation, kept as published
      'Port of Hueneme update to the Ventura County Transportation Commission (CY2024 cargo by commodity, trading partners, fresh produce origins, off-dock facilities)',
    url: 'https://www.goventura.org/',
  }),
  truckCo2: Object.freeze({
    // i18n-ignore: source citation, kept as published
    title: 'EPA GHG Emission Factors Hub: diesel fuel 10.21 kg CO2 per gallon',
    url: 'https://www.epa.gov/climateleadership/ghg-emission-factors-hub',
  }),
  truckCriteria: Object.freeze({
    title:
      // i18n-ignore: source citation, kept as published
      'EPA heavy-duty highway engine standards from 2010 (40 CFR 86.007-11): NOx 0.20, PM 0.01 g/bhp-hr; certification limits used as a floor',
    url: 'https://www.ecfr.gov/current/title-40/chapter-I/subchapter-C/part-86/subpart-A/section-86.007-11',
  }),
  rail: Object.freeze({
    title:
      // i18n-ignore: source citation, kept as published
      'Association of American Railroads fuel efficiency (about 470 ton-miles per gallon) and EPA locomotive Tier 3 line-haul limits (40 CFR 1033.101): NOx 5.5, PM 0.10 g/bhp-hr',
    url: 'https://www.aar.org/issue/freight-rail-climate-change/',
  }),
  ship: Object.freeze({
    title:
      // i18n-ignore: source citation, kept as published
      'EPA Port Emissions Inventory Guidance (EPA-420-B-22-011), applied to representative ships from the Hueneme ship inventory',
    url: 'https://www.epa.gov/state-and-local-transportation/port-emissions-inventory-guidance',
  }),
});

/** Port of Hueneme main cargo gate (approximate). */
export const PORT_GATE = Object.freeze({
  id: 'poh-gate',
  name: 'Port of Hueneme gate',
  lat: 34.1517,
  lon: -119.196,
});

/** Where ships arrive: the harbor entrance. */
export const PORT_BERTH = Object.freeze({ lat: 34.1465, lon: -119.2095 });

/**
 * Sea waypoints that keep great-circle legs off land. Each origin route is a
 * list of these ids plus its own start; the last point is always the port.
 */
export const SEA_WAYPOINTS = Object.freeze({
  dover: [51.0, 1.5],
  lizard: [49.7, -5.6],
  mona: [18.3, -67.9],
  colon: [9.45, -79.92],
  balboa: [8.85, -79.5],
  gulfOfPanama: [7.0, -79.8],
  caboOffshore: [22.4, -110.3],
  ensenadaOffshore: [31.5, -117.3],
  jejuSouth: [32.9, 126.9],
  japanSouth: [34.2, 139.9],
  skagen: [57.9, 10.9],
  northSea: [56.0, 6.0],
});

const EUROPE_TO_PACIFIC = Object.freeze([
  'dover',
  'lizard',
  'mona',
  'colon',
  'balboa',
  'gulfOfPanama',
  'caboOffshore',
  'ensenadaOffshore',
]);
const LATAM_TAIL = Object.freeze(['caboOffshore', 'ensenadaOffshore']);

/**
 * Origin ports. country is the trading partner as POH reports it; port is the
 * load port used to route the ship (modeled where a country has several).
 */
export const ORIGINS = Object.freeze({
  'kr-pyeongtaek': {
    country: 'South Korea',
    port: 'Pyeongtaek',
    lat: 36.97,
    lon: 126.83,
    via: ['jejuSouth', 'japanSouth'],
  },
  'jp-nagoya': {
    country: 'Japan',
    port: 'Nagoya',
    lat: 34.95,
    lon: 136.85,
    via: ['japanSouth'],
  },
  'de-bremerhaven': {
    country: 'Germany',
    port: 'Bremerhaven',
    lat: 53.55,
    lon: 8.55,
    via: ['northSea', ...EUROPE_TO_PACIFIC],
  },
  'sk-bremerhaven': {
    country: 'Slovakia',
    port: 'Bremerhaven (by rail from Slovakia)',
    lat: 53.55,
    lon: 8.55,
    via: ['northSea', ...EUROPE_TO_PACIFIC],
  },
  'gb-southampton': {
    country: 'United Kingdom',
    port: 'Southampton',
    lat: 50.9,
    lon: -1.4,
    via: EUROPE_TO_PACIFIC.slice(1),
  },
  'se-gothenburg': {
    country: 'Sweden',
    port: 'Gothenburg',
    lat: 57.69,
    lon: 11.9,
    via: ['skagen', 'northSea', ...EUROPE_TO_PACIFIC],
  },
  'be-zeebrugge': {
    country: 'Belgium',
    port: 'Zeebrugge',
    lat: 51.34,
    lon: 3.2,
    via: EUROPE_TO_PACIFIC,
  },
  'mx-lazaro-cardenas': {
    country: 'Mexico',
    port: 'Lázaro Cárdenas',
    lat: 17.93,
    lon: -102.18,
    via: LATAM_TAIL,
  },
  'mx-manzanillo': {
    country: 'Mexico',
    port: 'Manzanillo',
    lat: 19.05,
    lon: -104.32,
    via: LATAM_TAIL,
  },
  'gt-puerto-quetzal': {
    country: 'Guatemala',
    port: 'Puerto Quetzal',
    lat: 13.92,
    lon: -90.79,
    via: LATAM_TAIL,
  },
  'cr-caldera': {
    country: 'Costa Rica',
    port: 'Caldera',
    lat: 9.91,
    lon: -84.72,
    via: LATAM_TAIL,
  },
  'ec-guayaquil': {
    country: 'Ecuador',
    port: 'Guayaquil',
    lat: -2.6,
    lon: -80.3,
    via: LATAM_TAIL,
  },
  'pe-paita': {
    country: 'Peru',
    port: 'Paita',
    lat: -5.08,
    lon: -81.2,
    via: LATAM_TAIL,
  },
  'cl-san-antonio': {
    country: 'Chile',
    port: 'San Antonio',
    lat: -33.59,
    lon: -71.75,
    via: LATAM_TAIL,
  },
  'co-buenaventura': {
    country: 'Colombia',
    port: 'Buenaventura',
    lat: 3.85,
    lon: -77.3,
    via: LATAM_TAIL,
  },
});

/**
 * Off-dock facilities named by POH. Positions are hand-placed from the street
 * address (approximate, within a few hundred meters).
 */
export const DROP_SITES = Object.freeze({
  glovis: {
    name: 'Glovis America (vehicle processing)',
    address: 'NBVC 32nd Ave & Track 13, Port Hueneme',
    lat: 34.1585,
    lon: -119.2045,
  },
  bmw: {
    name: 'BMW Vehicle Distribution Center',
    address: '5900 Arcturus Ave, Oxnard',
    lat: 34.1595,
    lon: -119.186,
  },
  wws: {
    name: 'Wallenius Wilhelmsen (WWS)',
    address: '5601 Edison Dr, Oxnard',
    lat: 34.164,
    lon: -119.179,
  },
  'channel-islands-logistics': {
    name: 'Channel Islands Logistics',
    address: '5655 Arcturus Ave, Oxnard',
    lat: 34.1615,
    lon: -119.183,
  },
  chiquita: {
    name: 'Chiquita',
    address: '1440 E 3rd St, Oxnard',
    lat: 34.1985,
    lon: -119.157,
  },
  'lineage-tfl': {
    name: 'Lineage Logistics TFL Oxnard',
    address: '908 E 3rd St, Oxnard',
    lat: 34.1978,
    lon: -119.1665,
  },
  'mission-produce': {
    name: 'Mission Produce',
    address: '2901 Camino Del Sol, Oxnard',
    lat: 34.2245,
    lon: -119.1435,
  },
  'challenger-pl': {
    name: 'Cold storage, 2600 Challenger Pl',
    address: '2600 Challenger Pl, Oxnard',
    lat: 34.2108,
    lon: -119.129,
  },
  'tt-ventura': {
    name: 'T&T (Ventura)',
    address: '1689 Olive St, Ventura',
    lat: 34.273,
    lon: -119.26,
  },
  'oxnard-del-norte': {
    name: 'City of Oxnard, 111 Del Norte',
    address: '111 S Del Norte Blvd, Oxnard',
    lat: 34.2,
    lon: -119.135,
  },
  'camarillo-airport-park': {
    name: 'Camarillo Airport Business Park',
    address: '555 Airport Way, Camarillo',
    lat: 34.215,
    lon: -119.09,
  },
});

/** Onward markets (modeled). POH serves 15 US states and Western Canada. */
export const MARKETS = Object.freeze({
  'la-basin': {
    name: 'Los Angeles basin / Inland Empire',
    lat: 34.06,
    lon: -117.6,
  },
  'bay-area': { name: 'San Francisco Bay Area', lat: 37.7, lon: -122.2 },
  phoenix: { name: 'Phoenix', lat: 33.45, lon: -112.07 },
  'las-vegas': { name: 'Las Vegas', lat: 36.17, lon: -115.14 },
  'salt-lake': { name: 'Salt Lake City', lat: 40.76, lon: -111.89 },
  denver: { name: 'Denver', lat: 39.74, lon: -104.99 },
  'pacific-nw': { name: 'Seattle / Portland', lat: 47.0, lon: -122.5 },
  'western-canada': { name: 'Vancouver, BC', lat: 49.28, lon: -123.12 },
});

/**
 * Representative ship per cargo class: the ship with the median main-engine
 * power in the Hueneme ship inventory (public/data/vessels/port-of-hueneme.json).
 * Speeds, utilization and hours at berth are modeled.
 *   designSpeedKn: maximum speed used as the propeller-law reference.
 *   cruiseSpeedKn: open-ocean speed.
 *   utilization: cargo tonnes carried as a share of deadweight.
 *   pohShare: share of a full load worked at Hueneme on one call.
 */
export const REPRESENTATIVE_SHIPS = Object.freeze({
  roro: {
    name: 'CRYSTAL RAY',
    imo: 9210440,
    shipType: 'Vehicle Carrier',
    subtype: 'Largest',
    keelYear: 2000,
    engineType: 'SSD',
    installedKw: 15540,
    deadweight: 21400,
    maxDraftM: 8,
    designSpeedKn: 20,
    cruiseSpeedKn: 15.5,
    utilization: 0.45,
    pohShare: 0.35,
    hotelHours: 20,
  },
  reefer: {
    name: 'SEALAND LOS ANGELES',
    imo: 9383235,
    shipType: 'Container Ship',
    subtype: '3,000 TEU',
    keelYear: 2008,
    engineType: 'SSD',
    installedKw: 20930,
    deadweight: 34330,
    maxDraftM: 9.7,
    designSpeedKn: 22,
    cruiseSpeedKn: 18,
    utilization: 0.7,
    pohShare: 0.45,
    hotelHours: 36,
  },
  general_cargo: {
    name: 'OCEAN GLADIATOR',
    imo: 9418987,
    shipType: 'General Cargo',
    subtype: 'Largest',
    keelYear: 2010,
    engineType: 'MSD',
    installedKw: 9800,
    deadweight: 19382,
    maxDraftM: 7.7,
    designSpeedKn: 16,
    cruiseSpeedKn: 13,
    utilization: 0.6,
    pohShare: 0.5,
    hotelHours: 48,
  },
});

/** Speed and time in the harbor for one call (each way). */
export const PORT_CALL = Object.freeze({
  maneuverHoursEachWay: 1,
  maneuverSpeedKn: 5,
  tugJobsPerCall: 2,
  tugHoursPerJob: 1.5,
  /** Distance inside the 24 nm California fuel zone and the 200 nm ECA. */
  ecaNm: 200,
});

/**
 * Commodities moved through POH in CY2024 and how each is modeled.
 *   tonnes: published (autos: 380,000 units x tonnesPerUnit).
 *   origins / dropSites / markets: modeled shares, each summing to 1.
 *     Autos and high & heavy use POH's top trading partners by value as the
 *     weights; produce uses POH's fresh produce volumes by country.
 *   onward: { mode: 'truck' | 'rail' } per market.
 */
export const COMMODITIES = Object.freeze({
  autos: {
    // i18n-ignore: data label on the English-only port pages
    label: 'Autos',
    units: 380_000,
    tonnesPerUnit: 1.9,
    shipClass: 'roro',
    color: '#4cc9f0',
    origins: {
      'kr-pyeongtaek': 4.88,
      'de-bremerhaven': 2.37,
      'gb-southampton': 1.36,
      'jp-nagoya': 1.29,
      'mx-lazaro-cardenas': 0.713,
      'se-gothenburg': 0.587,
      'sk-bremerhaven': 0.482,
      'be-zeebrugge': 0.318,
    },
    dropSites: {
      glovis: 0.45,
      bmw: 0.2,
      wws: 0.2,
      'channel-islands-logistics': 0.15,
    },
    truckPayloadT: 17.1,
    markets: {
      'la-basin': [0.35, 'truck'],
      'bay-area': [0.15, 'truck'],
      phoenix: [0.1, 'truck'],
      'las-vegas': [0.05, 'truck'],
      'pacific-nw': [0.1, 'truck'],
      denver: [0.1, 'rail'],
      'salt-lake': [0.1, 'rail'],
      'western-canada': [0.05, 'rail'],
    },
    onwardEmptyReturn: 0.8,
  },
  highHeavy: {
    // i18n-ignore: data label on the English-only port pages
    label: 'High & heavy',
    tonnes: 140_000,
    shipClass: 'roro',
    color: '#b5179e',
    origins: {
      'kr-pyeongtaek': 4.88,
      'de-bremerhaven': 2.37,
      'gb-southampton': 1.36,
      'jp-nagoya': 1.29,
      'se-gothenburg': 0.587,
      'be-zeebrugge': 0.318,
    },
    dropSites: { wws: 1 },
    truckPayloadT: 20,
    markets: {
      'la-basin': [0.5, 'truck'],
      'bay-area': [0.2, 'truck'],
      phoenix: [0.2, 'truck'],
      denver: [0.1, 'rail'],
    },
    onwardEmptyReturn: 0.8,
  },
  bananas: {
    // i18n-ignore: data label on the English-only port pages
    label: 'Bananas',
    tonnes: 550_000,
    shipClass: 'reefer',
    color: '#ffd166',
    origins: {
      'gt-puerto-quetzal': 67.4,
      'cr-caldera': 29.5,
      'ec-guayaquil': 15.8,
    },
    dropSites: { chiquita: 0.4, 'lineage-tfl': 0.3, 'tt-ventura': 0.3 },
    truckPayloadT: 20,
    markets: {
      'la-basin': [0.4, 'truck'],
      'bay-area': [0.2, 'truck'],
      phoenix: [0.1, 'truck'],
      'pacific-nw': [0.1, 'truck'],
      denver: [0.1, 'truck'],
      'salt-lake': [0.05, 'truck'],
      'las-vegas': [0.05, 'truck'],
    },
    onwardEmptyReturn: 0.5,
  },
  otherFruit: {
    // i18n-ignore: data label on the English-only port pages
    label: 'Other fresh fruit',
    tonnes: 550_000,
    shipClass: 'reefer',
    color: '#80ed99',
    origins: {
      'mx-manzanillo': 17.4,
      'pe-paita': 12.5,
      'cl-san-antonio': 5.1,
      'co-buenaventura': 2.4,
    },
    dropSites: {
      'mission-produce': 0.4,
      'lineage-tfl': 0.3,
      'challenger-pl': 0.3,
    },
    truckPayloadT: 20,
    markets: {
      'la-basin': [0.4, 'truck'],
      'bay-area': [0.2, 'truck'],
      phoenix: [0.1, 'truck'],
      'pacific-nw': [0.1, 'truck'],
      denver: [0.1, 'truck'],
      'salt-lake': [0.05, 'truck'],
      'las-vegas': [0.05, 'truck'],
    },
    onwardEmptyReturn: 0.5,
  },
  generalCargo: {
    // i18n-ignore: data label on the English-only port pages
    label: 'General cargo',
    tonnes: 400_000,
    shipClass: 'general_cargo',
    color: '#f77f00',
    origins: {
      'kr-pyeongtaek': 4.88,
      'de-bremerhaven': 2.37,
      'jp-nagoya': 1.29,
      'mx-lazaro-cardenas': 0.713,
      'pe-paita': 0.258,
    },
    dropSites: { 'camarillo-airport-park': 0.5, 'oxnard-del-norte': 0.5 },
    truckPayloadT: 18,
    markets: {
      'la-basin': [0.6, 'truck'],
      'bay-area': [0.2, 'truck'],
      phoenix: [0.2, 'truck'],
    },
    onwardEmptyReturn: 0.5,
  },
});

/** Cargo POH reports that this model leaves out, and why. */
export const NOT_MODELED = Object.freeze([
  'Liquid fertilizer (130,000 t): origins not published',
  'Fish (20,000 t): landed locally, no ocean leg',
  'Offshore oil support (30,000 t): offshore service, not an import lane',
]);

/** Road and rail distance as a multiple of the great-circle distance. */
export const CIRCUITY = Object.freeze({ drayage: 1.4, road: 1.25, rail: 1.3 });

/**
 * Truck and rail factors. Diesel truck NOx/PM are the 2010 certification
 * limits converted per mile, so they read as a floor. The battery-electric
 * truck uses 2.0 kWh per mile on the California grid at 0.24 kg CO2e/kWh.
 * The EV Planning fleet catalog replaces these once it lands.
 */
export const TRUCK_FACTORS = Object.freeze({
  diesel: Object.freeze({
    id: 'diesel-class8-default',
    // i18n-ignore: data label on the English-only port pages
    label: 'Diesel Class 8 (2010+ engine)',
    mpg: 6.5,
    kgCo2PerGallon: 10.21,
    bhpHrPerGallon: 20.8,
    noxGPerBhpHr: 0.2,
    pmGPerBhpHr: 0.01,
  }),
  electric: Object.freeze({
    id: 'bev-class8-default',
    // i18n-ignore: data label on the English-only port pages
    label: 'Battery-electric Class 8',
    kwhPerMile: 2.0,
    gridKgCo2ePerKwh: 0.24,
  }),
});

export const RAIL_FACTORS = Object.freeze({
  tonMilesPerGallon: 470,
  kgCo2PerGallon: 10.21,
  bhpHrPerGallon: 20.8,
  noxGPerBhpHr: 5.5,
  pmGPerBhpHr: 0.1,
});
