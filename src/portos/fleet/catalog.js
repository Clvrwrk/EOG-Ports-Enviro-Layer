/**
 * Fleet catalog: every vehicle and machine model the port inventory, the EV
 * planner and the freight footprint can point at, with its energy use and
 * emissions, diesel and zero-emission side by side.
 *
 *   - Drayage trucks: FleetVolt's 37 battery-electric Class 8 tractors
 *     (fleetvoltTrucks.js), plus diesel, reefer and auto-carrier baselines.
 *   - Cargo-handling equipment: the POH workbook specs (hueneme.js SPECS)
 *     plus RTG cranes, straddle carriers and empty-container handlers.
 *   - Locomotives: switchers (VCRR) and line haul, per hour and per ton-mile.
 *   - Harbor craft: diesel and battery-electric ship-assist tugs.
 *   - Ships: one model per EPA ship type and subtype found in the POH ship
 *     inventory (ogvModels), with at-berth auxiliary and boiler loads.
 *
 * A model is { id, category, label, make?, model?, powertrain, basis:
 * 'mile'|'hour'|'ton-mile', energy fields, payloadTons?, assetClass?,
 * source, estimated? }. Ids are stable: saved plans, the asset registry
 * (`catalogId`) and the freight footprint key on them.
 *
 * Emissions: emissionsPerUnit(model) gives { co2eKg, noxG, pm25G } per mile,
 * per working hour or per ton-mile. Diesel tailpipe factors are listed in
 * EMISSION_FACTORS with their sources; battery-electric models count grid
 * CO2e only (no tailpipe NOx or PM).
 *
 * Pure: no Cesium, no DOM.
 */
import { FACTORS, SPECS } from '../hueneme.js';
import { CRAFT_SPECS } from '../huenemeAssets.js';
import { FLEETVOLT_TRUCKS } from './fleetvoltTrucks.js';

/** Catalog sections, in display order. */
export const FLEET_CATEGORIES = Object.freeze({
  drayage_truck: 'Drayage trucks',
  che: 'Cargo-handling equipment',
  locomotive: 'Locomotives',
  harbor_craft: 'Harbor craft',
  ogv: 'Ships (ocean-going vessels)',
});

/**
 * Emission and energy factors. Diesel engine output per gallon uses EPA
 * NONROAD's brake-specific fuel use (0.367 lb/hp-hr) and 7.1 lb/gal, the
 * same conversion the crane spec uses.
 */
export const EMISSION_FACTORS = Object.freeze({
  dieselKgCo2PerGallon: FACTORS.dieselKgCo2PerGallon,
  gridKgCo2ePerKwh: 0.24,
  dieselKwhPerGallon: (7.1 / 0.367) * 0.7457,
  truck: Object.freeze({
    dieselMpg: 6.5,
    noxGPerMi: 3.0,
    pm25GPerMi: 0.04,
  }),
  /** EPA Tier 4 final nonroad limits, 56-560 kW (40 CFR 1039.101). */
  cheTier4f: Object.freeze({ noxGPerKwh: 0.4, pm25GPerKwh: 0.02 }),
  /** EPA Tier 3 marine Category 1/2 limits (same table as callEmissions). */
  marineTier3: Object.freeze({ noxGPerKwh: 5.6, pm25GPerKwh: 0.11 }),
  /** Line-haul rail. */
  rail: Object.freeze({
    tonMilesPerGallon: 480,
    bhpHrPerGallon: 20.8,
    noxGPerBhpHr: 4.95,
    pm25GPerBhpHr: 0.1,
  }),
  sources: Object.freeze({
    diesel: FACTORS.source,
    grid: 'FleetVolt planning factor: California grid 0.24 kg CO2e/kWh (placeholder until hourly CAISO factors)',
    truck:
      'FleetVolt planning factors: 6.5 mpg, 3.0 g NOx/mi, 0.04 g PM2.5/mi for a diesel Class 8 tractor (placeholders, not EMFAC)',
    cheTier4f:
      'EPA Tier 4 final nonroad standards (40 CFR 1039.101), 56-560 kW: NOx 0.40, PM 0.02 g/kWh; certification limits used as a floor on in-use emissions',
    marineTier3:
      'EPA marine Category 1/2 Tier 3 standards (40 CFR 1042), as in src/emissions/callEmissions.js',
    rail: 'AAR: about 480 ton-miles per gallon (US Class I average); EPA-420-F-09-025: 20.8 bhp-hr/gal line haul; NOx 4.95 and PM 0.10 g/bhp-hr are approximate fleet averages, not checked against a single table',
  }),
});

const MILES = 'mile';
const HOURS = 'hour';
const TON_MILES = 'ton-mile';

/** Typical drayage loads, tons of cargo (not truck weight). */
export const PAYLOAD_TONS = Object.freeze({
  container: 16,
  reefer: 18,
  auto_carrier: 12,
  source:
    'Assumed: 16 t for a loaded 40 ft box, 18 t for a reefer box of fruit, 12 t for 8 to 9 new cars; check against POH gate and cargo data',
});

// ── Trucks ─────────────────────────────────────────────────────────────────

/** Catalog model for one FleetVolt battery-electric tractor. */
function fleetvoltModel(truck) {
  const make = truck.name.split(' ')[0];
  const typical = truck.street?.kwhPerMi?.typical ?? null;
  const fuelCell = /fuel cell|fcev/i.test(`${truck.name} ${truck.id}`);
  return Object.freeze({
    id: `truck-${truck.id.replaceAll('_', '-')}`,
    category: 'drayage_truck',
    label: truck.name,
    make,
    model: truck.name.slice(make.length + 1),
    powertrain: fuelCell ? 'hydrogen' : 'electric',
    basis: MILES,
    kwhPerMi: typical,
    kwhPerMiRange: truck.street?.kwhPerMi ?? null,
    batteryKwh: truck.physics.nameplate_kwh,
    usableKwh: truck.physics.usable_kwh,
    chargeKw: Math.max(...truck.physics.charge_curve.map((p) => p.max_kw), 0),
    rangeMi: truck.street?.rangeMi?.typical ?? null,
    payloadTons: PAYLOAD_TONS.container,
    physicsId: truck.id,
    hvip: truck.hvip,
    confidence: truck.street?.confidence ?? 'low',
    assetClass: 'drayage_truck',
    source: `FleetVolt truck library (data/trucks/${truck.id}.json): ${truck.notes}`,
  });
}

const DIESEL_TRUCKS = [
  {
    id: 'truck-diesel-drayage',
    label: 'Diesel Class 8 drayage tractor (fleet average)',
    payloadTons: PAYLOAD_TONS.container,
  },
  {
    id: 'truck-diesel-reefer',
    label: 'Diesel Class 8 tractor with reefer container',
    payloadTons: PAYLOAD_TONS.reefer,
    // A container genset runs the reefer box on the road.
    gensetGph: 0.6,
  },
  {
    id: 'truck-diesel-auto-carrier',
    label: 'Diesel auto-carrier (car hauler)',
    payloadTons: PAYLOAD_TONS.auto_carrier,
  },
].map((x) =>
  Object.freeze({
    category: 'drayage_truck',
    powertrain: 'diesel',
    basis: MILES,
    dieselMpg: EMISSION_FACTORS.truck.dieselMpg,
    assetClass: 'drayage_truck',
    estimated: true,
    source: `${EMISSION_FACTORS.sources.truck}; payload: ${PAYLOAD_TONS.source}${x.gensetGph ? '; reefer genset 0.6 gal/hr assumed' : ''}`,
    ...x,
  }),
);

// ── Cargo-handling equipment ───────────────────────────────────────────────

/** Workbook spec id -> asset class, label and the electric twin's id. */
const WORKBOOK_CHE = Object.freeze({
  utr: { assetClass: 'utr', label: 'Yard tractor (UTR)' },
  harbor_crane: {
    assetClass: 'mobile_harbor_crane',
    label: 'Liebherr LHM 420 mobile harbor crane',
  },
  reach_stacker: { assetClass: 'reach_stacker', label: 'Reach stacker' },
  forklift_class_v: { assetClass: 'forklift', label: 'Forklift, Class V' },
  forklift_class_iv: { assetClass: 'forklift', label: 'Forklift, Class IV' },
  light_duty: { assetClass: 'light_duty', label: 'Light-duty van or pickup' },
});

function workbookPair(specId, spec) {
  const { assetClass, label } = WORKBOOK_CHE[specId];
  const slug = specId.replaceAll('_', '-');
  const common = {
    category: 'che',
    basis: HOURS,
    assetClass,
    specId,
    kwhPerHour: spec.kwhPerHour,
    dieselGph: spec.dieselGph,
    source: spec.source,
  };
  if (spec.gridTethered)
    return [
      Object.freeze({
        ...common,
        id: `che-${slug}`,
        label: `${label} (grid plug-in, diesel to travel)`,
        powertrain: 'hybrid',
        batteryKwh: 0,
        model: spec.model,
      }),
    ];
  return [
    Object.freeze({
      ...common,
      id: `che-${slug}-diesel`,
      label: `${label}, diesel`,
      powertrain: 'diesel',
    }),
    Object.freeze({
      ...common,
      id: `che-${slug}-electric`,
      label: `${label}, battery-electric`,
      powertrain: 'electric',
      batteryKwh: spec.batteryKwh,
      chargeKw: spec.chargeKw,
    }),
  ];
}

/**
 * Equipment the POH workbook does not list. Diesel burn is rated kW x load
 * factor converted to gallons; electric draw is the same work over a 90%
 * efficient drive. Ratings and load factors are typical of port CHE
 * inventories, not checked against one table, so they carry `estimated`.
 */
const EXTRA_CHE = [
  {
    key: 'rtg-crane',
    assetClass: 'rtg_crane',
    label: 'Rubber-tired gantry (RTG) crane',
    ratedKw: 450,
    loadFactor: 0.2,
    batteryKwh: 0,
    chargeKw: 0,
    electricNote: 'cable reel or busbar, grid-powered',
  },
  {
    key: 'straddle-carrier',
    assetClass: 'straddle_carrier',
    label: 'Straddle carrier',
    ratedKw: 300,
    loadFactor: 0.25,
    batteryKwh: 220,
    chargeKw: 150,
  },
  {
    key: 'top-handler',
    assetClass: 'top_handler',
    label: 'Top handler (laden container handler)',
    ratedKw: 250,
    loadFactor: 0.4,
    batteryKwh: 600,
    chargeKw: 150,
  },
  {
    key: 'empty-handler',
    assetClass: 'empty_handler',
    label: 'Empty container handler',
    ratedKw: 170,
    loadFactor: 0.4,
    batteryKwh: 400,
    chargeKw: 100,
  },
].flatMap((x) => {
  const workKwh = x.ratedKw * x.loadFactor;
  const common = {
    category: 'che',
    basis: HOURS,
    assetClass: x.assetClass,
    ratedKw: x.ratedKw,
    loadFactor: x.loadFactor,
    estimated: true,
    source:
      'Assumed rating and load factor, typical of port cargo-handling equipment inventories; diesel by EPA NONROAD fuel rate (0.367 lb/hp-hr)',
  };
  return [
    Object.freeze({
      ...common,
      id: `che-${x.key}-diesel`,
      label: `${x.label}, diesel`,
      powertrain: 'diesel',
      dieselGph: workKwh / EMISSION_FACTORS.dieselKwhPerGallon,
    }),
    Object.freeze({
      ...common,
      id: `che-${x.key}-electric`,
      label: `${x.label}, electric${x.electricNote ? ` (${x.electricNote})` : ''}`,
      powertrain: 'electric',
      kwhPerHour: Math.round((workKwh / 0.9) * 10) / 10,
      batteryKwh: x.batteryKwh,
      chargeKw: x.chargeKw,
    }),
  ];
});

// ── Locomotives and harbor craft ───────────────────────────────────────────

const SWITCHER_KW = 1119; // 1,500 hp, an EMD SW1500 / GP-class switcher
const switcher = CRAFT_SPECS.switcher_locomotive;
const RAIL_MODELS = [
  Object.freeze({
    id: 'loco-switcher-diesel',
    category: 'locomotive',
    label: 'Diesel switcher locomotive (1,500 hp)',
    powertrain: 'diesel',
    basis: HOURS,
    assetClass: 'locomotive',
    specId: 'switcher_locomotive',
    ratedKw: SWITCHER_KW,
    loadFactor: switcher.loadFactor,
    dieselGph: SWITCHER_KW * switcher.loadFactor * switcher.dieselGallonsPerKwh,
    estimated: true,
    source: `${switcher.source}; 1,500 hp rating assumed for the VCRR switchers`,
  }),
  Object.freeze({
    id: 'loco-switcher-battery',
    category: 'locomotive',
    label: 'Battery-electric switcher locomotive',
    powertrain: 'electric',
    basis: HOURS,
    assetClass: 'locomotive',
    ratedKw: SWITCHER_KW,
    loadFactor: switcher.loadFactor,
    kwhPerHour:
      Math.round(((SWITCHER_KW * switcher.loadFactor) / 0.85) * 10) / 10,
    batteryKwh: 2000,
    estimated: true,
    source:
      'Same switch duty as the diesel switcher over an 85% efficient battery drive; 2 MWh pack assumed (battery switchers on the market range about 1 to 3 MWh)',
  }),
  Object.freeze({
    id: 'loco-line-haul-diesel',
    category: 'locomotive',
    label: 'Diesel line-haul freight train (per ton-mile)',
    powertrain: 'diesel',
    basis: TON_MILES,
    assetClass: 'locomotive',
    dieselGallonsPerTonMile: 1 / EMISSION_FACTORS.rail.tonMilesPerGallon,
    estimated: true,
    source: EMISSION_FACTORS.sources.rail,
  }),
];

const tug = CRAFT_SPECS.tug_assist;
const TUG_KW = 3542; // DEFAULT_CRAFT.tug in callEmissions.js
const CRAFT_MODELS = [
  Object.freeze({
    id: 'craft-tug-diesel',
    category: 'harbor_craft',
    label: 'Ship-assist tug, diesel (Tier 3)',
    powertrain: 'diesel',
    basis: HOURS,
    assetClass: 'tug',
    specId: 'tug_assist',
    ratedKw: TUG_KW,
    loadFactor: tug.loadFactor,
    dieselGph: TUG_KW * tug.loadFactor * tug.dieselGallonsPerKwh,
    engineTier: 'tier3',
    estimated: true,
    source: tug.source,
  }),
  Object.freeze({
    id: 'craft-tug-electric',
    category: 'harbor_craft',
    label: 'Ship-assist tug, battery-electric (eWolf class)',
    powertrain: 'electric',
    basis: HOURS,
    assetClass: 'tug',
    ratedKw: TUG_KW,
    loadFactor: tug.loadFactor,
    kwhPerHour: Math.round(((TUG_KW * tug.loadFactor) / 0.85) * 10) / 10,
    batteryKwh: 6200,
    estimated: true,
    source:
      'Same assist duty as the diesel tug over an 85% efficient drive (ELECTRIC_CRAFT_GRID_PER_SHAFT); 6.2 MWh battery as on Crowley eWolf (San Diego, 2023)',
  }),
];

// ── Ships ──────────────────────────────────────────────────────────────────

const slug = (text) =>
  String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/**
 * One catalog model per EPA ship type and subtype in a ship inventory
 * (public/data/vessels/port-of-hueneme.json), with mean at-berth auxiliary
 * and boiler loads and the ships that belong to it.
 */
export function ogvModels(inventory) {
  const groups = new Map();
  for (const ship of inventory?.vessels ?? []) {
    const epa = ship.engines?.epa;
    if (!epa?.shipType) continue;
    const key = `${epa.shipType}|${epa.subtype ?? ''}`;
    if (!groups.has(key)) groups.set(key, { epa, ships: [] });
    groups.get(key).ships.push(ship);
  }
  const mean = (values) => {
    const xs = values.filter(Number.isFinite);
    return xs.length
      ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length)
      : null;
  };
  return [...groups.values()]
    .map(({ epa, ships }) =>
      Object.freeze({
        id: `ogv-${slug(epa.shipType)}${epa.subtype ? `-${slug(epa.subtype)}` : ''}`,
        category: 'ogv',
        label: `${epa.shipType}${epa.subtype ? `, ${epa.subtype}` : ''}`,
        powertrain: 'diesel',
        basis: HOURS,
        hotellingAuxKw: mean(ships.map((s) => s.engines?.auxKw?.hotelling)),
        hotellingBoilerKw: mean(
          ships.map((s) => s.engines?.boilerKw?.hotelling),
        ),
        shorePowerShips: ships.filter((s) => s.shorePower?.capable).length,
        ships: ships.map((s) => s.id),
        estimated: true,
        source:
          'POH ship inventory; loads are EPA-420-B-22-011 Appendix E fleet-average defaults',
      }),
    )
    .sort((a, b) => b.ships.length - a.ships.length);
}

// ── The catalog ────────────────────────────────────────────────────────────

/** Default ids the freight footprint and planner start from. */
export const DEFAULT_DIESEL_DRAYAGE_ID = 'truck-diesel-drayage';
export const DEFAULT_BEV_DRAYAGE_ID = 'truck-ecascadia-438';
export const DEFAULT_LINE_HAUL_ID = 'loco-line-haul-diesel';

/** Every fixed model (ships come from ogvModels with the inventory). */
export const FLEET_MODELS = Object.freeze([
  ...DIESEL_TRUCKS,
  ...FLEETVOLT_TRUCKS.map(fleetvoltModel),
  ...Object.entries(SPECS)
    .filter(([id]) => WORKBOOK_CHE[id])
    .flatMap(([id, spec]) => workbookPair(id, spec)),
  ...EXTRA_CHE,
  ...RAIL_MODELS,
  ...CRAFT_MODELS,
]);

/**
 * The catalog: fixed models plus ship models when an inventory is given.
 * @returns {{ models: object[], byId: Map<string, object> }}
 */
export function buildFleetCatalog({ vesselInventory = null } = {}) {
  const models = [...FLEET_MODELS, ...ogvModels(vesselInventory)];
  return { models, byId: new Map(models.map((m) => [m.id, m])) };
}

const BY_ID = new Map(FLEET_MODELS.map((m) => [m.id, m]));

/** A fixed model by id, or undefined. */
export function fleetModel(id) {
  return BY_ID.get(id);
}

/** Models an asset of `assetClass` can point at. */
export function modelsForAssetClass(assetClass) {
  return FLEET_MODELS.filter((m) => m.assetClass === assetClass);
}

/** FleetVolt physics truck behind a catalog model, or null. */
export function physicsTruckOf(model) {
  return model?.physicsId
    ? (FLEETVOLT_TRUCKS.find((t) => t.id === model.physicsId) ?? null)
    : null;
}

// ── Energy and emissions ───────────────────────────────────────────────────

/**
 * Energy per unit of `model.basis`: grid kWh for electric models, diesel
 * gallons for diesel ones, both for hybrids (grid while working).
 */
export function energyPerUnit(model) {
  if (model.basis === MILES) {
    if (model.powertrain === 'diesel')
      return { dieselGal: 1 / model.dieselMpg, kwh: 0 };
    return { dieselGal: 0, kwh: model.kwhPerMi ?? 0 };
  }
  if (model.basis === TON_MILES)
    return { dieselGal: model.dieselGallonsPerTonMile ?? 0, kwh: 0 };
  if (model.category === 'ogv') {
    const kw = (model.hotellingAuxKw ?? 0) + (model.hotellingBoilerKw ?? 0);
    return { dieselGal: kw / EMISSION_FACTORS.dieselKwhPerGallon, kwh: 0 };
  }
  if (model.powertrain === 'diesel')
    return { dieselGal: model.dieselGph ?? 0, kwh: 0 };
  return { dieselGal: 0, kwh: model.kwhPerHour ?? 0 };
}

/**
 * Emissions per unit of `model.basis` (mile, working hour, ton-mile, or
 * at-berth hour for ships): { co2eKg, noxG, pm25G }.
 */
export function emissionsPerUnit(model, factors = EMISSION_FACTORS) {
  const { dieselGal, kwh } = energyPerUnit(model);
  let gal = dieselGal;
  if (model.gensetGph && model.basis === MILES)
    // Genset hours per mile at the 55 mph planning speed.
    gal += model.gensetGph / 55;
  const co2eKg =
    gal * factors.dieselKgCo2PerGallon + kwh * factors.gridKgCo2ePerKwh;
  if (gal === 0) return { co2eKg, noxG: 0, pm25G: 0 };
  if (model.basis === MILES)
    return {
      co2eKg,
      noxG: factors.truck.noxGPerMi,
      pm25G: factors.truck.pm25GPerMi,
    };
  const engineKwh = gal * factors.dieselKwhPerGallon;
  if (model.basis === TON_MILES) {
    const bhpHr = gal * factors.rail.bhpHrPerGallon;
    return {
      co2eKg,
      noxG: bhpHr * factors.rail.noxGPerBhpHr,
      pm25G: bhpHr * factors.rail.pm25GPerBhpHr,
    };
  }
  const marine = model.category === 'harbor_craft' || model.category === 'ogv';
  const f = marine ? factors.marineTier3 : factors.cheTier4f;
  return {
    co2eKg,
    noxG: engineKwh * f.noxGPerKwh,
    pm25G: engineKwh * f.pm25GPerKwh,
  };
}

/** Emissions per ton-mile for a truck model with a payload, or null. */
export function emissionsPerTonMile(model) {
  if (model.basis === TON_MILES) return emissionsPerUnit(model);
  if (model.basis !== MILES || !(model.payloadTons > 0)) return null;
  const e = emissionsPerUnit(model);
  return {
    co2eKg: e.co2eKg / model.payloadTons,
    noxG: e.noxG / model.payloadTons,
    pm25G: e.pm25G / model.payloadTons,
  };
}

/**
 * Annual comparison for `units` of a zero-emission model against a diesel
 * one doing the same work (miles or hours per year each).
 */
export function compareAnnual(
  zeModel,
  dieselModel,
  { units = 1, perUnitYear },
) {
  const scale = (e) => ({
    co2eT: (e.co2eKg * perUnitYear * units) / 1000,
    noxKg: (e.noxG * perUnitYear * units) / 1000,
    pm25Kg: (e.pm25G * perUnitYear * units) / 1000,
  });
  const ze = scale(emissionsPerUnit(zeModel));
  const diesel = scale(emissionsPerUnit(dieselModel));
  const zeEnergy = energyPerUnit(zeModel);
  const dieselEnergy = energyPerUnit(dieselModel);
  return {
    ze,
    diesel,
    avoided: {
      co2eT: diesel.co2eT - ze.co2eT,
      noxKg: diesel.noxKg - ze.noxKg,
      pm25Kg: diesel.pm25Kg - ze.pm25Kg,
      pctCo2e: diesel.co2eT > 0 ? 1 - ze.co2eT / diesel.co2eT : 0,
    },
    gridKwh: zeEnergy.kwh * perUnitYear * units,
    dieselGal: dieselEnergy.dieselGal * perUnitYear * units,
  };
}
