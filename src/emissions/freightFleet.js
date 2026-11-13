// Truck and rail factors for the freight footprint, taken from the shared
// EV Planning fleet catalog (src/portos/fleet/catalog.js), so the footprint
// and the EV planner use the same trucks, payloads and grid factor.

import {
  DEFAULT_BEV_DRAYAGE_ID,
  DEFAULT_DIESEL_DRAYAGE_ID,
  DEFAULT_LINE_HAUL_ID,
  EMISSION_FACTORS,
  emissionsPerUnit,
  energyPerUnit,
  fleetModel,
} from '../portos/fleet/catalog.js';

/** Catalog truck model id per cargo truck kind. */
export const FLEET_TRUCK_IDS = Object.freeze({
  container: DEFAULT_DIESEL_DRAYAGE_ID,
  reefer: 'truck-diesel-reefer',
  auto_carrier: 'truck-diesel-auto-carrier',
});

/** One catalog truck as a freightFootprint per-mile factor entry. */
export function catalogTruck(
  id,
  catalog = { fleetModel, emissionsPerUnit, energyPerUnit },
) {
  const model = catalog.fleetModel(id);
  if (!model) throw new RangeError(`no fleet model ${id}`);
  const e = catalog.emissionsPerUnit(model);
  const energy = catalog.energyPerUnit(model);
  return {
    id: model.id,
    label: model.label,
    payloadTons: model.payloadTons ?? null,
    perMile: { co2eKg: e.co2eKg, noxG: e.noxG, pm25G: e.pm25G },
    dieselGallonsPerMile: energy.dieselGal,
    kwhPerMile: energy.kwh,
  };
}

/**
 * truckFactors for freightFootprint(): the catalog's default diesel and
 * battery-electric drayage trucks, with the reefer and auto-carrier models
 * for those cargoes. The electric truck is the same for every cargo; it
 * keeps the cargo's diesel payload so loads stay comparable.
 */
export function fleetTruckFactors({
  bevId = DEFAULT_BEV_DRAYAGE_ID,
  ids = FLEET_TRUCK_IDS,
} = {}) {
  const bev = catalogTruck(bevId);
  const byKind = {};
  for (const [kind, id] of Object.entries(ids)) {
    const diesel = catalogTruck(id);
    byKind[kind] = {
      diesel,
      electric: { ...bev, payloadTons: diesel.payloadTons },
    };
  }
  return {
    source: EMISSION_FACTORS.sources.truck,
    diesel: catalogTruck(ids.container),
    electric: bev,
    byKind,
  };
}

/** railFactors for freightFootprint(), from the catalog's line-haul model. */
export function fleetRailFactors() {
  const r = EMISSION_FACTORS.rail;
  return {
    id: DEFAULT_LINE_HAUL_ID,
    tonMilesPerGallon: r.tonMilesPerGallon,
    kgCo2PerGallon: EMISSION_FACTORS.dieselKgCo2PerGallon,
    bhpHrPerGallon: r.bhpHrPerGallon,
    noxGPerBhpHr: r.noxGPerBhpHr,
    pmGPerBhpHr: r.pm25GPerBhpHr / 0.97,
    source: EMISSION_FACTORS.sources.rail,
  };
}
