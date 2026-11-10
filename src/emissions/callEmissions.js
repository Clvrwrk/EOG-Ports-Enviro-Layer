// Emissions for one reconstructed ship call, from first tug or pilot contact
// to the last release: the ship itself (EPA-420-B-22-011 Section 3.8) plus the
// harbor craft that worked it, each switched by the scenario.
//
// Harbor craft factors: when an engine's in-use factors are unknown, its EPA
// marine certification limit stands in (40 CFR 1042, as tabulated by
// DieselNet, "Emission Standards: USA: Marine Diesel Engines"). In-use rates at
// low load are usually higher, so these read as a floor and are labeled so.
// CO2 is fuel-based: 213 g/kWh brake-specific fuel use x 3.206 g CO2 per g of
// diesel (the carbon content factor used for OGV distillate).

import { callIntervals } from './aisCalls.js';
import { GWP_SETS, intervalEmissions, summarize } from './ogvMethod.js';

const HOUR_MS = 3_600_000;
const BSFC_DIESEL_G_PER_KWH = 213;
const CO2_PER_G_FUEL = 3.206;
const DIESEL_G_PER_GALLON = 3200;
/** Grid kWh per kWh at the shaft for battery-electric craft (charger + battery + drive). */
export const ELECTRIC_CRAFT_GRID_PER_SHAFT = 1 / 0.85;
/** California at-berth and within-24-nm distillate sulfur limit (fraction). */
export const CA_OGV_FUEL_SULFUR = 0.001;

export const CRAFT_FACTOR_SOURCE = Object.freeze({
  title:
    // i18n-ignore: source citation, kept as published
    'EPA marine diesel Category 1/2 standards (40 CFR 1042), via DieselNet "Emission Standards: USA: Marine Diesel Engines"',
  basis:
    'Certification limits used as emission factors (NOx+HC counted as NOx); a floor on in-use emissions.',
});

/** g/kWh by engine tier. */
export const CRAFT_FACTORS_G_PER_KWH = Object.freeze({
  tier2: Object.freeze({ nox: 7.2, pm10: 0.2, co: 5.0 }),
  tier3: Object.freeze({ nox: 5.6, pm10: 0.11, co: 5.0 }),
  tier4: Object.freeze({ nox: 1.8, pm10: 0.04, co: 5.0 }),
});

/**
 * Default craft when the registry has no rating. Load factors match the asset
 * registry's harbor craft specs (tug assist 0.31, pilot boat 0.5).
 */
export const DEFAULT_CRAFT = Object.freeze({
  tug: Object.freeze({
    ratedKw: 3542,
    loadFactor: 0.31,
    tier: 'tier3',
    powertrain: 'diesel',
    assumed: true,
  }),
  pilot: Object.freeze({
    ratedKw: 900,
    loadFactor: 0.5,
    tier: 'tier3',
    powertrain: 'diesel',
    assumed: true,
  }),
});

/**
 * One craft working `hours`. spec: { ratedKw, loadFactor, tier, powertrain:
 * 'diesel' | 'electric' }. Returns grams, diesel gallons and grid kWh.
 */
export function craftEmissions(spec, hours) {
  const shaftKwh =
    (spec.ratedKw ?? 0) * (spec.loadFactor ?? 0) * Math.max(0, hours ?? 0);
  if (spec.powertrain === 'electric') {
    return {
      shaftKwh,
      gridKwh: shaftKwh * ELECTRIC_CRAFT_GRID_PER_SHAFT,
      dieselGallons: 0,
      grams: { nox: 0, pm10: 0, pm25: 0, co: 0, co2: 0 },
    };
  }
  const f = CRAFT_FACTORS_G_PER_KWH[spec.tier] ?? CRAFT_FACTORS_G_PER_KWH.tier3;
  const fuelG = shaftKwh * BSFC_DIESEL_G_PER_KWH;
  return {
    shaftKwh,
    gridKwh: 0,
    dieselGallons: fuelG / DIESEL_G_PER_GALLON,
    grams: {
      nox: f.nox * shaftKwh,
      pm10: f.pm10 * shaftKwh,
      pm25: f.pm10 * 0.97 * shaftKwh,
      co: f.co * shaftKwh,
      co2: fuelG * CO2_PER_G_FUEL,
    },
  };
}

/** Clip a call's records to [startMs, endMs]. */
function clipRecords(records, startMs, endMs) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return records;
  return records.filter((r) => r.t >= startMs && r.t <= endMs);
}

/**
 * Scenario switches (all optional):
 *   shorePower: true puts the ship's hotelling on shore power;
 *   tugPowertrain / pilotPowertrain: 'diesel' | 'electric' override every craft;
 *   tugTier / pilotTier: replace the engine tier (e.g. 'tier4' repower).
 * craftSpecs: { [mmsi]: spec } from the asset registry; others use DEFAULT_CRAFT.
 * vessel: ogvMethod vessel characteristics for the ship.
 */
export function callEmissions(
  call,
  rebuilt,
  { vessel = {}, craftSpecs = {}, scenario = {}, gwpSet = GWP_SETS.AR5 } = {},
) {
  const { startMs, endMs } = rebuilt.window;
  const clipped = {
    ...call,
    records: clipRecords(call.records, startMs, endMs),
  };
  const intervals = callIntervals(clipped, vessel);
  const shipResults = intervals.map((iv) =>
    intervalEmissions(vessel, {
      ...iv,
      fuelSulfur: CA_OGV_FUEL_SULFUR,
      onShorePower: !!scenario.shorePower && iv.mode === 'hotelling',
    }),
  );
  const ship = summarize(shipResults, gwpSet);

  const craft = rebuilt.craftJobs.map((job) => {
    const base =
      craftSpecs[job.mmsi] ?? DEFAULT_CRAFT[job.role] ?? DEFAULT_CRAFT.tug;
    const spec = { ...base };
    const prefix = job.role === 'pilot' ? 'pilot' : 'tug';
    if (scenario[`${prefix}Powertrain`])
      spec.powertrain = scenario[`${prefix}Powertrain`];
    if (scenario[`${prefix}Tier`]) spec.tier = scenario[`${prefix}Tier`];
    const e = craftEmissions(spec, job.jobHours);
    return { ...job, spec, ...e };
  });

  const craftTonnes = { nox: 0, pm10: 0, pm25: 0, co: 0, co2: 0 };
  let craftGridKwh = 0;
  let craftDieselGallons = 0;
  for (const c of craft) {
    for (const p of Object.keys(craftTonnes))
      craftTonnes[p] += c.grams[p] / 1e6;
    craftGridKwh += c.gridKwh;
    craftDieselGallons += c.dieselGallons;
  }

  const total = {
    nox: ship.tonnes.nox + craftTonnes.nox,
    pm25: ship.tonnes.pm25 + craftTonnes.pm25,
    co2: ship.tonnes.co2 + craftTonnes.co2,
    co2e: ship.tonnes.co2e + craftTonnes.co2,
  };
  return {
    windowHours:
      Number.isFinite(startMs) && Number.isFinite(endMs)
        ? (endMs - startMs) / HOUR_MS
        : null,
    scenario,
    ship,
    craft,
    craftTonnes,
    gridKwh: ship.energyKwh.shorePower + craftGridKwh,
    craftDieselGallons,
    total,
    craftFactorSource: CRAFT_FACTOR_SOURCE,
  };
}
