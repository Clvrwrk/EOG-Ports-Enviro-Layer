/**
 * Port of Hueneme seed registry for the Port Environmental OS.
 *
 * Starting point only. Equipment specs, crew templates, the 2023 fleet, the
 * fleet plan and capex come from the POH Utilization Model workbook (V23MFE),
 * which its author calls back-of-napkin data. The vessel-call profile is an
 * aggregate of that workbook's 2021-2023 schedule (counts and mean hours by
 * vessel type only, no vessel, agent or stevedore names). Port staff replace
 * all of it through the admin portal as real records arrive.
 */

const WORKBOOK = 'POH Utilization Model V23MFE';

/** Per-unit equipment specs (CHE_Equipment_List). Energy per working hour. */
export const SPECS = Object.freeze({
  utr: {
    label: 'UTR',
    dieselGph: 2.5,
    kwhPerHour: 12.5,
    batteryKwh: 180,
    chargeKw: 50,
    source: WORKBOOK,
  },
  harbor_crane: {
    label: 'Mobile harbor crane (Liebherr LHM 420 Litronic)',
    model: 'Liebherr LHM 420 Litronic',
    // Liebherr rates the LHM 420 power unit at 750 kW and up to 38 boxes an
    // hour. Working draw = rated power x the 0.43 crane load factor used in
    // EPA NONROAD and port emissions inventories: 750 x 0.43 = 322.5 kWh/hr.
    ratedKw: 750,
    loadFactor: 0.43,
    kwhPerHour: 750 * 0.43,
    boxesPerHour: 38,
    // Diesel burn for the same working load, from EPA NONROAD's fuel rate
    // for engines over 100 hp (0.367 lb per hp-hr) and 7.1 lb per gallon:
    // 322.5 kW / 0.7457 x 0.367 / 7.1 = 22.4 gal/hr. The workbook's 10.57
    // was sized for its 156 kWh/hr crane.
    dieselGph: ((750 * 0.43) / 0.7457) * (0.367 / 7.1),
    // Liebherr hybrids drive on diesel and plug into the grid to work, so
    // the electric units draw from the meter while working, with no battery.
    gridTethered: true,
    batteryKwh: 0,
    chargeKw: 0,
    source:
      'Liebherr LHM 420 product page and 2017 LHM deck (750 kW, 38 boxes/hr); load factor 0.43 and diesel fuel rate (0.367 lb/hp-hr) per USACE/EPA NONROAD',
  },
  reach_stacker: {
    label: 'Reach stacker',
    dieselGph: 5.5,
    kwhPerHour: 58.8,
    batteryKwh: 985,
    chargeKw: 50,
    source: WORKBOOK,
  },
  forklift_class_v: {
    label: 'Forklift Class V',
    dieselGph: 2.7,
    kwhPerHour: 18,
    batteryKwh: 245,
    chargeKw: 50,
    source: WORKBOOK,
  },
  forklift_class_iv: {
    label: 'Forklift Class IV',
    dieselGph: 0.95,
    kwhPerHour: 9,
    batteryKwh: 40,
    chargeKw: 50,
    source: WORKBOOK,
  },
  light_duty: {
    label: 'Light-duty van or pickup',
    dieselGph: 0.8,
    kwhPerHour: 2,
    batteryKwh: 64,
    chargeKw: 50,
    source: WORKBOOK,
  },
});

/**
 * Emission and fuel factors. CO2 per gallon is EPA's diesel factor; the
 * workbook's unlabeled "CO2e/Hr" values are kept for reference only.
 */
export const FACTORS = Object.freeze({
  dieselKgCo2PerGallon: 10.21,
  dieselDollarsPerGallon: 3.48,
  source:
    'EPA GHG Emission Factors Hub (diesel, 10.21 kg CO2/gal); fuel price from the workbook Feedstock_Table',
});

/**
 * Hour-of-day slots (Vessel Shift Table). Work happens in NS and DS slots;
 * Hoot and BREAK slots are idle, which is when equipment can charge.
 */
export const SHIFT_SLOTS = Object.freeze([
  'NS',
  'NS',
  'NS',
  'HOOT',
  'HOOT',
  'HOOT',
  'HOOT',
  'HOOT',
  'DS',
  'DS',
  'DS',
  'DS',
  'BREAK',
  'DS',
  'DS',
  'DS',
  'DS',
  'BREAK',
  'NS',
  'NS',
  'NS',
  'NS',
  'BREAK',
  'NS',
]);

/**
 * Crew templates (POH_CHE_Assignments): units of each spec a work
 * assignment puts to work. Standard and heavy UTRs share the UTR spec.
 */
export const CREW_TEMPLATES = Object.freeze({
  Idle: {},
  '1G': { harbor_crane: 1, utr: 6, forklift_class_iv: 2, reach_stacker: 1 },
  '2G': { harbor_crane: 2, utr: 12, forklift_class_iv: 4, reach_stacker: 2 },
  '3G': { harbor_crane: 3, utr: 20, forklift_class_iv: 6, reach_stacker: 3 },
  '1H': { forklift_class_v: 2 },
  '1G + 1H': {
    harbor_crane: 1,
    utr: 6,
    forklift_class_iv: 2,
    forklift_class_v: 2,
    reach_stacker: 1,
  },
  '2G + 1H': {
    harbor_crane: 2,
    utr: 12,
    forklift_class_iv: 4,
    forklift_class_v: 2,
    reach_stacker: 2,
  },
  '3G + 1H': {
    harbor_crane: 3,
    utr: 20,
    forklift_class_iv: 6,
    forklift_class_v: 2,
    reach_stacker: 3,
  },
  DV: {},
  '1G + 1H + DV': {
    harbor_crane: 1,
    utr: 6,
    forklift_class_iv: 2,
    forklift_class_v: 2,
    reach_stacker: 1,
  },
  '2G + 1H + DV': {
    harbor_crane: 2,
    utr: 12,
    forklift_class_iv: 4,
    forklift_class_v: 2,
    reach_stacker: 2,
  },
  '3G + 1H + DV': {
    harbor_crane: 3,
    utr: 20,
    forklift_class_iv: 4,
    forklift_class_v: 2,
    reach_stacker: 3,
  },
  '3G + 1H + 2DV': {
    harbor_crane: 3,
    utr: 20,
    forklift_class_iv: 6,
    forklift_class_v: 2,
    reach_stacker: 3,
  },
  '2G + 2H + DV': {
    harbor_crane: 2,
    utr: 12,
    forklift_class_iv: 4,
    forklift_class_v: 4,
    reach_stacker: 2,
  },
  '3G + 3H + DV': {
    harbor_crane: 3,
    utr: 20,
    forklift_class_iv: 6,
    forklift_class_v: 6,
    reach_stacker: 3,
  },
  '3G + 3H + 2DV': {
    harbor_crane: 3,
    utr: 20,
    forklift_class_iv: 6,
    forklift_class_v: 6,
    reach_stacker: 3,
  },
  'RORO Idle': {},
  'RORO MS': { light_duty: 17 },
  'RORO FS': { light_duty: 13 },
  'RORO HH': { utr: 2, forklift_class_v: 6, light_duty: 10 },
});

/**
 * Vessel-call profile: calls per year and mean hours at berth by vessel
 * type (workbook 2021-2023 schedule, 713 calls), plus the crew template the
 * workbook assigns to working slots and the berths each type uses.
 * maxConcurrent caps reefer calls worked at once (one reefer crew at a time,
 * as in the workbook); a 2-gang crew uses two of the four harbor cranes.
 */
export const CALL_PROFILE = Object.freeze([
  {
    type: 'Refrigerated',
    callsPerYear: 126.7,
    meanHours: 39.7,
    template: '2G + 1H + DV',
    maxConcurrent: 1,
    berths: ['berth-1', 'berth-2', 'berth-3'],
    cargo: 'break-bulk reefer',
  },
  {
    type: 'Ro-Ro/Vehicles Carrier',
    callsPerYear: 99.7,
    meanHours: 14.3,
    template: 'RORO MS',
    finishTemplate: 'RORO FS',
    berths: ['berth-4'],
    cargo: 'ro-ro',
  },
  {
    type: 'Heavy Lift',
    callsPerYear: 4.7,
    meanHours: 69,
    template: 'RORO HH',
    berths: ['berth-6'],
    cargo: 'project cargo',
  },
  {
    type: 'Tanker',
    callsPerYear: 4.3,
    meanHours: 20.8,
    template: 'Idle',
    berths: ['berth-1', 'berth-2'],
    cargo: 'liquid bulk',
  },
  {
    type: 'General Cargo',
    callsPerYear: 1.7,
    meanHours: 136,
    template: 'RORO HH',
    berths: ['berth-6'],
    cargo: 'general cargo',
  },
]);

/** Fleet plan by year (VST sheet): diesel vs zero-emission units on hand. */
export const FLEET_PLAN = Object.freeze({
  2023: {
    utr: [25, 2],
    forklift_class_v: [3, 0],
    harbor_crane: [1, 3],
    reach_stacker: [3, 0],
  },
  2024: {
    utr: [25, 2],
    forklift_class_v: [3, 0],
    harbor_crane: [0, 4],
    reach_stacker: [3, 0],
  },
  2025: {
    utr: [25, 2],
    forklift_class_v: [3, 0],
    harbor_crane: [0, 4],
    reach_stacker: [3, 0],
  },
  2026: {
    utr: [20, 7],
    forklift_class_v: [3, 0],
    harbor_crane: [0, 4],
    reach_stacker: [3, 0],
  },
  2027: {
    utr: [15, 12],
    forklift_class_v: [3, 0],
    harbor_crane: [0, 4],
    reach_stacker: [3, 0],
  },
  2028: {
    utr: [10, 17],
    forklift_class_v: [3, 0],
    harbor_crane: [0, 4],
    reach_stacker: [3, 0],
  },
  2029: {
    utr: [5, 22],
    forklift_class_v: [3, 0],
    harbor_crane: [0, 4],
    reach_stacker: [3, 0],
  },
  2030: {
    utr: [0, 27],
    forklift_class_v: [2, 1],
    harbor_crane: [0, 4],
    reach_stacker: [2, 1],
  },
  2031: {
    utr: [0, 27],
    forklift_class_v: [1, 2],
    harbor_crane: [0, 4],
    reach_stacker: [1, 2],
  },
  2032: {
    utr: [0, 27],
    forklift_class_v: [0, 3],
    harbor_crane: [0, 4],
    reach_stacker: [0, 3],
  },
});

/** Zero-emission purchases by year (VST sheet), driving the capex schedule. */
export const PURCHASES = Object.freeze({
  2024: { utr: 9, harbor_crane: 1 },
  2025: { harbor_crane: 1 },
  2026: { utr: 5 },
  2027: { utr: 5 },
  2028: { utr: 4, forklift_class_v: 1, reach_stacker: 1 },
  2029: { utr: 2, forklift_class_v: 1, reach_stacker: 1 },
  2030: { forklift_class_v: 1, reach_stacker: 1 },
});

/** Unit costs (VST sheet): capital, CORE voucher, charging infrastructure. */
export const UNIT_COSTS = Object.freeze({
  utr: { capital: 370_000, voucher: 120_000, infrastructure: 100_000 },
  forklift_class_v: {
    capital: 720_000,
    voucher: 380_000,
    infrastructure: 100_000,
  },
  harbor_crane: { capital: 3_800_000, voucher: 0, infrastructure: 0 },
  reach_stacker: {
    capital: 1_500_000,
    voucher: 500_000,
    infrastructure: 100_000,
  },
});

const SPEC_CLASS = {
  utr: 'utr',
  harbor_crane: 'mobile_harbor_crane',
  reach_stacker: 'reach_stacker',
  forklift_class_v: 'forklift',
  forklift_class_iv: 'forklift',
  light_duty: 'light_duty',
};

function fleetAssets(
  specId,
  diesel,
  electric,
  electricPowertrain = 'electric',
) {
  const out = [];
  const add = (count, powertrain) => {
    for (let i = 0; i < count; i += 1)
      out.push({
        id: `${specId}-${String(out.length + 1).padStart(2, '0')}`,
        class: SPEC_CLASS[specId],
        powertrain,
        specId,
      });
  };
  add(diesel, 'diesel');
  add(electric, electricPowertrain);
  return out;
}

const BERTHS = [
  ['berth-1', 'South', true],
  ['berth-2', 'South', true],
  ['berth-3', 'South', true],
  ['berth-4', 'North', false],
  ['berth-5', 'North', false],
  ['berth-6', 'North', false],
  ['berth-7', 'Joint Use', false],
  ['berth-8', 'Joint Use', false],
  ['berth-9', 'Joint Use', false],
].map(([id, zone, shorePower]) => ({ id, class: 'berth', zone, shorePower }));

/** The Hueneme seed registry: 2023 fleet, berths, meter and chargers. */
export const HUENEME_REGISTRY = Object.freeze({
  portId: 'port-of-hueneme',
  source: WORKBOOK,
  specs: SPECS,
  assets: [
    ...BERTHS,
    {
      id: 'meter-che',
      class: 'meter',
      utility: 'SCE',
      tariffId: 'SCE-TOU-8-D',
      note: 'placeholder: one service for CHE charging until real meters are entered',
    },
    { id: 'charger-utr-01', class: 'charger', meterId: 'meter-che', kw: 50 },
    { id: 'charger-utr-02', class: 'charger', meterId: 'meter-che', kw: 50 },
    ...['berth-1', 'berth-2', 'berth-3'].map((berthId, i) => ({
      id: `shore-power-${i + 1}`,
      class: 'shore_power',
      meterId: 'meter-che',
      berthId,
      kw: 1500,
      note: 'workbook Shore Power row (1,500); confirm whether this is kW per vault',
    })),
    ...fleetAssets('utr', 25, 2),
    ...fleetAssets('forklift_class_v', 3, 0),
    // Four Liebherr mobile harbor cranes (Ports America). Press releases name
    // the 2013 LHM 420 and plug-in hybrids delivered in 2019 and 2022; port
    // staff confirmed the fourth is also a hybrid.
    ...fleetAssets('harbor_crane', 1, 3, 'hybrid'),
    ...fleetAssets('reach_stacker', 3, 0),
  ],
});
