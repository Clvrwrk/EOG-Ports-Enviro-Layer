// Ocean-going vessel (OGV) emission factors and default loads.
//
// Every number in this file is transcribed from the U.S. EPA "Port Emissions
// Inventory Guidance: Methodologies for Estimating Port-Related and Goods
// Movement Mobile Source Emissions" (EPA-420-B-22-011, April 2022), Section 3
// and Appendix E. Table and equation numbers are kept beside each value so a
// reviewer can check them against the guidance:
// https://www.epa.gov/state-and-local-transportation/port-emissions-inventory-guidance
//
// Nothing here is estimated by this project. If a value needs to change, change
// it to match a newer edition of a published source and update SOURCE below.

export const OGV_FACTOR_SOURCE = Object.freeze({
  id: 'epa-420-b-22-011',
  title:
    // i18n-ignore: source citation, kept as published
    'EPA Port Emissions Inventory Guidance: Methodologies for Estimating Port-Related and Goods Movement Mobile Source Emissions',
  publisher: 'U.S. Environmental Protection Agency',
  edition: 'April 2022 (EPA-420-B-22-011)',
  url: 'https://www.epa.gov/state-and-local-transportation/port-emissions-inventory-guidance',
  licence: 'U.S. Government work (public domain)',
});

export const FUELS = Object.freeze(['MGO/MDO', 'RM/HFO', 'LNG']);
export const ENGINE_GROUPS = Object.freeze([
  'propulsion',
  'auxiliary',
  'boiler',
]);
export const OPERATING_MODES = Object.freeze([
  'transit',
  'maneuvering',
  'hotelling',
  'anchorage',
]);

/** NOx tier from keel-laid year (Table 3.5 row labels). */
export function noxTierForKeelYear(keelYear) {
  const year = Number(keelYear);
  if (!Number.isFinite(year)) return null;
  if (year <= 1999) return 'pre-tier';
  if (year <= 2010) return 'tier1';
  if (year <= 2015) return 'tier2';
  return 'tier3';
}

/**
 * Table 3.5. Category 3 vessel NOx emission factors (g/kWh).
 * Keyed group -> fuel -> engine type -> tier (or 'any').
 */
export const NOX_G_PER_KWH = Object.freeze({
  propulsion: {
    'MGO/MDO': {
      ST: { any: 2.0 },
      GT: { any: 5.7 },
      SSD: { 'pre-tier': 17.0, tier1: 16.0, tier2: 14.4, tier3: 3.4 },
      MSD: { 'pre-tier': 13.2, tier1: 12.2, tier2: 10.5, tier3: 2.6 },
    },
    'RM/HFO': {
      ST: { any: 2.1 },
      GT: { any: 6.1 },
      SSD: { 'pre-tier': 18.1, tier1: 17.0, tier2: 15.3, tier3: 3.6 },
      MSD: { 'pre-tier': 14.0, tier1: 13.0, tier2: 11.2, tier3: 2.8 },
    },
    LNG: { LNG: { any: 1.3 } },
  },
  auxiliary: {
    'MGO/MDO': {
      MSD: { 'pre-tier': 13.8, tier1: 12.2, tier2: 10.5, tier3: 2.6 },
      HSD: { 'pre-tier': 10.9, tier1: 9.8, tier2: 7.7, tier3: 2.0 },
    },
    'RM/HFO': {
      MSD: { 'pre-tier': 14.7, tier1: 13.0, tier2: 11.2, tier3: 2.8 },
      HSD: { 'pre-tier': 11.6, tier1: 10.4, tier2: 8.2, tier3: 2.1 },
    },
    LNG: { LNG: { any: 1.3 } },
  },
  boiler: {
    'MGO/MDO': { Boiler: { any: 2.0 } },
    'RM/HFO': { Boiler: { any: 2.1 } },
  },
});

/** Table 3.6. Category 3 vessel brake-specific fuel consumption (g/kWh). */
export const BSFC_G_PER_KWH = Object.freeze({
  propulsion: {
    'MGO/MDO': { SSD: 185, MSD: 205, ST: 300, GT: 300 },
    'RM/HFO': { SSD: 195, MSD: 215, ST: 305, GT: 305 },
    LNG: { LNG: 166 },
  },
  auxiliary: {
    'MGO/MDO': { MSD: 217, HSD: 217 },
    'RM/HFO': { MSD: 227, HSD: 227 },
    LNG: { LNG: 166 },
  },
  boiler: {
    'MGO/MDO': { Boiler: 300 },
    'RM/HFO': { Boiler: 305 },
  },
});

/** Equation 3.3 constants (PM10 for SSD/MSD engines and boilers). */
export const PM_EQUATION = Object.freeze({
  baseGPerKwh: { 'MGO/MDO': 0.1545, 'RM/HFO': 0.5761 },
  fractionToSulfatePm: 0.02247,
  sulfatePmToSulfurWeightRatio: 7, // 224 / 32
});

/** Table 3.7. PM10 factors (g/kWh) for ST, GT and LNG engines. */
export const PM10_FIXED_G_PER_KWH = Object.freeze({
  'MGO/MDO': { ST: 0.16, GT: 0.01 },
  'RM/HFO': { ST: 0.93, GT: 0.06 },
  LNG: { LNG: 0.03 },
});

/** Section 3.5.3: PM2.5 = 92% of PM10 and BC = 3% of PM10 for C3 engines. */
export const PM25_SHARE_OF_PM10 = 0.92;
export const BC_SHARE_OF_PM10 = 0.03;

/** Table 3.8. HC and CO factors (g/kWh). */
export const HC_CO_G_PER_KWH = Object.freeze({
  propulsion: {
    SSD: { hc: 0.6, co: 1.4 },
    MSD: { hc: 0.5, co: 1.1 },
    ST: { hc: 0.1, co: 0.2 },
    GT: { hc: 0.1, co: 0.2 },
    LNG: { hc: 0.0, co: 1.3 },
  },
  auxiliary: {
    MSD: { hc: 0.4, co: 1.1 },
    HSD: { hc: 0.4, co: 0.9 },
    LNG: { hc: 0.0, co: 1.3 },
  },
  boiler: { Boiler: { hc: 0.1, co: 0.2 } },
});

/** Section 3.5.4: VOC = 1.053 x HC, CH4 = 2% of HC. */
export const VOC_PER_HC = 1.053;
export const CH4_SHARE_OF_HC = 0.02;

/** Table 3.9. N2O factors (g/kWh). LNG uses the SSD/MDO value per Section 3.5.5. */
export const N2O_G_PER_KWH = Object.freeze({
  propulsion: {
    'MGO/MDO': { SSD: 0.029, MSD: 0.029, ST: 0.075, GT: 0.075 },
    'RM/HFO': { SSD: 0.031, MSD: 0.031, ST: 0.08, GT: 0.08 },
    LNG: { LNG: 0.029 },
  },
  auxiliary: {
    'MGO/MDO': { MSD: 0.029, HSD: 0.029 },
    'RM/HFO': { MSD: 0.031, HSD: 0.031 },
    LNG: { LNG: 0.029 },
  },
  boiler: {
    'MGO/MDO': { Boiler: 0.075 },
    'RM/HFO': { Boiler: 0.08 },
  },
});

/** Equation 3.4 carbon content factors (g CO2 / g fuel). */
export const CARBON_CONTENT_FACTOR = Object.freeze({
  'MGO/MDO': 3.206,
  'RM/HFO': 3.114,
  LNG: 2.75,
});

/** Equation 3.5 constants. */
export const SO2_EQUATION = Object.freeze({
  fractionToSo2: 0.97753,
  so2ToSulfurWeightRatio: 2,
});

/** Equations 3.3 and 3.5 default fuel sulfur (weight ratio). */
export const DEFAULT_FUEL_SULFUR = Object.freeze({
  insideEcaFrom2015: 0.001,
  outsideEcaBefore2020: 0.027,
  outsideEcaFrom2020: 0.005,
});

/** Equation 3.6: sea margin. */
export const SEA_MARGIN = Object.freeze({ coastal: 1.1, atSea: 1.15 });

/** Section 3.3.4: maximum speed = service speed / 0.94 when only service speed is known. */
export const SERVICE_TO_MAX_SPEED = 0.94;

/**
 * Table 3.10. C3 propulsion engine low load adjustment factors, for whole
 * percent loads 2..20. Index = load percent. Values at <= 2% use the 2% row and
 * values at >= 20% are 1. The SO2 column is for 0.1% fuel sulfur.
 */
const LLAF_ROWS = [
  // pct, NOx, HC, CO, PM, CO2, SO2
  [2, 4.63, 21.18, 9.68, 7.29, 3.28, 9.54],
  [3, 2.92, 11.68, 6.46, 4.33, 2.44, 6.38],
  [4, 2.21, 7.71, 4.86, 3.09, 2.01, 4.79],
  [5, 1.83, 5.61, 3.89, 2.44, 1.76, 3.85],
  [6, 1.6, 4.35, 3.25, 2.04, 1.59, 3.21],
  [7, 1.45, 3.52, 2.79, 1.79, 1.47, 2.76],
  [8, 1.35, 2.95, 2.45, 1.61, 1.38, 2.42],
  [9, 1.27, 2.52, 2.18, 1.48, 1.31, 2.16],
  [10, 1.22, 2.2, 1.96, 1.38, 1.25, 1.95],
  [11, 1.17, 1.96, 1.79, 1.3, 1.21, 1.78],
  [12, 1.14, 1.76, 1.64, 1.24, 1.17, 1.63],
  [13, 1.11, 1.6, 1.52, 1.19, 1.14, 1.51],
  [14, 1.08, 1.47, 1.41, 1.15, 1.11, 1.41],
  [15, 1.06, 1.36, 1.32, 1.11, 1.08, 1.32],
  [16, 1.05, 1.26, 1.24, 1.08, 1.06, 1.24],
  [17, 1.03, 1.18, 1.17, 1.06, 1.04, 1.17],
  [18, 1.02, 1.11, 1.11, 1.04, 1.03, 1.11],
  [19, 1.01, 1.05, 1.05, 1.02, 1.01, 1.05],
];
export const LOW_LOAD_ADJUSTMENT = Object.freeze(
  Object.fromEntries(
    LLAF_ROWS.map(([pct, nox, hc, co, pm, co2, so2]) => [
      pct,
      Object.freeze({ nox, hc, co, pm, co2, so2 }),
    ]),
  ),
);

/** Table 3.4. Ship subtype by ship type and size. */
export const SUBTYPE_BREAKS = Object.freeze({
  'Bulk Carrier': {
    unit: 'dwt',
    bands: [
      [10_000, 'Small'],
      [35_000, 'Handysize'],
      [60_000, 'Handymax'],
      [100_000, 'Panamax'],
      [200_000, 'Capesize'],
      [Infinity, 'Capesize Largest'],
    ],
  },
  'Chemical Tanker': {
    unit: 'dwt',
    bands: [
      [5_000, 'Smallest'],
      [10_000, 'Small'],
      [20_000, 'Handysize'],
      [Infinity, 'Handymax'],
    ],
  },
  'Container Ship': {
    unit: 'teu',
    bands: [
      [1_000, '1,000 TEU'],
      [2_000, '2,000 TEU'],
      [3_000, '3,000 TEU'],
      [5_000, '5,000 TEU'],
      [8_000, '8,000 TEU'],
      [12_000, '12,000 TEU'],
      [14_500, '14,500 TEU'],
      [Infinity, 'Largest'],
    ],
  },
  Cruise: {
    unit: 'grossTonnage',
    bands: [
      [2_000, '2,000 Ton'],
      [10_000, '10,000 Ton'],
      [60_000, '60,000 Ton'],
      [100_000, '100,000 Ton'],
      [Infinity, 'Largest'],
    ],
  },
  'Ferry/Passenger (C3)': {
    unit: 'grossTonnage',
    bands: [
      [2_000, '2,000 Ton'],
      [Infinity, 'Largest'],
    ],
  },
  'Ferry/Roll-on/Passenger (C3)': {
    unit: 'grossTonnage',
    bands: [
      [2_000, '2,000 Ton'],
      [Infinity, 'Largest'],
    ],
  },
  'General Cargo': {
    unit: 'dwt',
    bands: [
      [5_000, '5,000 DWT'],
      [10_000, '10,000 DWT'],
      [Infinity, 'Largest'],
    ],
  },
  'Liquified Gas Tanker': {
    unit: 'dwt',
    bands: [
      [50_000, '50,000 DWT'],
      [100_000, '100,000 DWT'],
      [200_000, '200,000 DWT'],
      [Infinity, 'Largest'],
    ],
  },
  'Oil Tanker': {
    unit: 'dwt',
    bands: [
      [5_000, 'Smallest'],
      [10_000, 'Small'],
      [20_000, 'Handysize'],
      [60_000, 'Handymax'],
      [80_000, 'Panamax'],
      [120_000, 'Aframax'],
      [200_000, 'Suezmax'],
      [Infinity, 'VLCC'],
    ],
  },
  RORO: {
    unit: 'grossTonnage',
    bands: [
      [5_000, '5,000 Ton'],
      [Infinity, 'Largest'],
    ],
  },
  'Vehicle Carrier': {
    unit: 'vehicles',
    bands: [
      [4_000, '4,000 Vehicles'],
      [Infinity, 'Largest'],
    ],
  },
});

/** Single-subtype ship types from Table 3.4. */
export const SINGLE_SUBTYPE = Object.freeze({
  'Fishing (C3)': 'All C3 Fishing',
  'Miscellaneous (C3)': 'All C3 Misc.',
  'Offshore Support/Drillship': 'All Offshore Support/Drillship',
  'Other Service': 'All Other Service',
  'Other Tanker': 'All Other Tanker',
  Reefer: 'All Reefer',
  'Yacht (C2/C3)': 'C2/C3 Yacht',
});

// Appendix E rows: [ship type, subtype, transit, maneuvering, hotelling, anchorage] (kW)
const AUX_ROWS = [
  ['Bulk Carrier', 'Small', 190, 310, 280, 190],
  ['Bulk Carrier', 'Handysize', 190, 310, 280, 190],
  ['Bulk Carrier', 'Handymax', 260, 420, 370, 260],
  ['Bulk Carrier', 'Panamax', 420, 680, 600, 420],
  ['Bulk Carrier', 'Capesize', 420, 680, 600, 420],
  ['Bulk Carrier', 'Capesize Largest', 420, 680, 600, 420],
  ['Chemical Tanker', 'Smallest', 80, 110, 160, 80],
  ['Chemical Tanker', 'Small', 230, 330, 490, 230],
  ['Chemical Tanker', 'Handysize', 230, 330, 490, 230],
  ['Chemical Tanker', 'Handymax', 550, 780, 1170, 550],
  ['Container Ship', '1,000 TEU', 300, 550, 340, 300],
  ['Container Ship', '2,000 TEU', 820, 1320, 600, 820],
  ['Container Ship', '3,000 TEU', 1230, 1800, 700, 1230],
  ['Container Ship', '5,000 TEU', 1390, 2470, 940, 1390],
  ['Container Ship', '8,000 TEU', 1420, 2600, 970, 1420],
  ['Container Ship', '12,000 TEU', 1630, 2780, 1000, 1630],
  ['Container Ship', '14,500 TEU', 1960, 3330, 1200, 1960],
  ['Container Ship', 'Largest', 2160, 3670, 1320, 2160],
  ['Cruise', '2,000 Ton', 450, 580, 450, 450],
  ['Cruise', '10,000 Ton', 450, 580, 450, 450],
  ['Cruise', '60,000 Ton', 3500, 5460, 3500, 3500],
  ['Cruise', '100,000 Ton', 11480, 14900, 11480, 11480],
  ['Cruise', 'Largest', 11480, 14900, 11480, 11480],
  ['Ferry/Passenger (C3)', '2,000 Ton', 186, 186, 186, 186],
  ['Ferry/Passenger (C3)', 'Largest', 524, 524, 524, 524],
  ['Ferry/Roll-on/Passenger (C3)', '2,000 Ton', 105, 105, 105, 105],
  ['Ferry/Roll-on/Passenger (C3)', 'Largest', 710, 710, 710, 710],
  ['Fishing (C3)', 'All C3 Fishing', 200, 200, 200, 200],
  ['General Cargo', '5,000 DWT', 60, 90, 120, 60],
  ['General Cargo', '10,000 DWT', 170, 250, 330, 170],
  ['General Cargo', 'Largest', 490, 730, 970, 490],
  ['Liquified Gas Tanker', '50,000 DWT', 240, 360, 240, 240],
  ['Liquified Gas Tanker', '100,000 DWT', 240, 360, 240, 240],
  ['Liquified Gas Tanker', '200,000 DWT', 1710, 2565, 1710, 1710],
  ['Liquified Gas Tanker', 'Largest', 1710, 2565, 1710, 1710],
  ['Miscellaneous (C3)', 'All C3 Misc.', 190, 190, 190, 190],
  [
    'Offshore Support/Drillship',
    'All Offshore Support/Drillship',
    320,
    320,
    320,
    320,
  ],
  ['Oil Tanker', 'Smallest', 250, 375, 250, 250],
  ['Oil Tanker', 'Small', 375, 563, 375, 375],
  ['Oil Tanker', 'Handysize', 625, 938, 625, 625],
  ['Oil Tanker', 'Handymax', 750, 1125, 750, 750],
  ['Oil Tanker', 'Panamax', 750, 1125, 750, 750],
  ['Oil Tanker', 'Aframax', 1000, 1500, 1000, 1000],
  ['Oil Tanker', 'Suezmax', 1250, 1875, 1250, 1250],
  ['Oil Tanker', 'VLCC', 1500, 2250, 1500, 1500],
  ['Other Service', 'All Other Service', 220, 220, 220, 220],
  ['Other Tanker', 'All Other Tanker', 500, 750, 500, 500],
  ['Reefer', 'All Reefer', 1170, 1150, 1080, 1170],
  ['RORO', '5,000 Ton', 600, 1700, 800, 600],
  ['RORO', 'Largest', 950, 2720, 1200, 950],
  ['Vehicle Carrier', '4,000 Vehicles', 500, 1125, 800, 500],
  ['Vehicle Carrier', 'Largest', 500, 1125, 800, 500],
  ['Yacht (C2/C3)', 'C2/C3 Yacht', 130, 130, 130, 130],
];

// Appendix E Table E.2 boiler rows, same layout (kW).
const BOILER_ROWS = [
  ['Bulk Carrier', 'Small', 0, 50, 50, 50],
  ['Bulk Carrier', 'Handysize', 0, 50, 50, 50],
  ['Bulk Carrier', 'Handymax', 0, 100, 100, 100],
  ['Bulk Carrier', 'Panamax', 0, 200, 200, 200],
  ['Bulk Carrier', 'Capesize', 0, 200, 200, 200],
  ['Bulk Carrier', 'Capesize Largest', 0, 200, 200, 200],
  ['Chemical Tanker', 'Smallest', 0, 125, 125, 125],
  ['Chemical Tanker', 'Small', 0, 250, 250, 250],
  ['Chemical Tanker', 'Handysize', 0, 250, 250, 250],
  ['Chemical Tanker', 'Handymax', 0, 250, 250, 250],
  ['Container Ship', '1,000 TEU', 0, 120, 120, 120],
  ['Container Ship', '2,000 TEU', 0, 290, 290, 290],
  ['Container Ship', '3,000 TEU', 0, 350, 350, 350],
  ['Container Ship', '5,000 TEU', 0, 450, 450, 450],
  ['Container Ship', '8,000 TEU', 0, 450, 450, 450],
  ['Container Ship', '12,000 TEU', 0, 520, 520, 520],
  ['Container Ship', '14,500 TEU', 0, 630, 630, 630],
  ['Container Ship', 'Largest', 0, 700, 700, 700],
  ['Cruise', '2,000 Ton', 0, 250, 250, 250],
  ['Cruise', '10,000 Ton', 0, 250, 250, 250],
  ['Cruise', '60,000 Ton', 0, 1000, 1000, 1000],
  ['Cruise', '100,000 Ton', 0, 500, 500, 500],
  ['Cruise', 'Largest', 0, 500, 500, 500],
  ['Ferry/Passenger (C3)', '2,000 Ton', 0, 0, 0, 0],
  ['Ferry/Passenger (C3)', 'Largest', 0, 0, 0, 0],
  ['Ferry/Roll-on/Passenger (C3)', '2,000 Ton', 0, 0, 0, 0],
  ['Ferry/Roll-on/Passenger (C3)', 'Largest', 0, 0, 0, 0],
  ['Fishing (C3)', 'All C3 Fishing', 0, 0, 0, 0],
  ['General Cargo', '5,000 DWT', 0, 0, 0, 0],
  ['General Cargo', '10,000 DWT', 0, 75, 75, 75],
  ['General Cargo', 'Largest', 0, 100, 100, 100],
  ['Liquified Gas Tanker', '50,000 DWT', 100, 200, 1000, 200],
  ['Liquified Gas Tanker', '100,000 DWT', 150, 300, 1500, 300],
  ['Liquified Gas Tanker', '200,000 DWT', 300, 600, 3000, 600],
  ['Liquified Gas Tanker', 'Largest', 300, 600, 3000, 600],
  ['Miscellaneous (C3)', 'All C3 Misc.', 0, 0, 0, 0],
  ['Offshore Support/Drillship', 'All Offshore Support/Drillship', 0, 0, 0, 0],
  ['Oil Tanker', 'Smallest', 0, 100, 500, 100],
  ['Oil Tanker', 'Small', 0, 150, 750, 150],
  ['Oil Tanker', 'Handysize', 0, 250, 1250, 250],
  ['Oil Tanker', 'Handymax', 150, 300, 1500, 300],
  ['Oil Tanker', 'Panamax', 150, 300, 1500, 300],
  ['Oil Tanker', 'Aframax', 200, 400, 2000, 400],
  ['Oil Tanker', 'Suezmax', 250, 500, 2500, 500],
  ['Oil Tanker', 'VLCC', 300, 600, 3000, 600],
  ['Other Service', 'All Other Service', 0, 0, 0, 0],
  ['Other Tanker', 'All Other Tanker', 100, 200, 1000, 200],
  ['Reefer', 'All Reefer', 0, 270, 270, 270],
  ['RORO', '5,000 Ton', 0, 200, 200, 200],
  ['RORO', 'Largest', 0, 300, 300, 300],
  ['Vehicle Carrier', '4,000 Vehicles', 0, 268, 268, 268],
  ['Vehicle Carrier', 'Largest', 0, 268, 268, 268],
  ['Yacht (C2/C3)', 'C2/C3 Yacht', 0, 0, 0, 0],
];

const indexLoads = (rows) => {
  const out = {};
  for (const [
    type,
    subtype,
    transit,
    maneuvering,
    hotelling,
    anchorage,
  ] of rows) {
    out[type] ??= {};
    out[type][subtype] = Object.freeze({
      transit,
      maneuvering,
      hotelling,
      anchorage,
    });
  }
  return Object.freeze(out);
};

/** Appendix E Table E.1. Default auxiliary engine loads (kW) by mode. */
export const DEFAULT_AUX_KW = indexLoads(AUX_ROWS);
/** Appendix E Table E.2. Default boiler loads (kW) by mode. */
export const DEFAULT_BOILER_KW = indexLoads(BOILER_ROWS);
