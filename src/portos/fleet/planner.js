/**
 * EV Planning for Port of Hueneme drayage: one truck's round trip from the
 * port to a drop site and back (loaded out, empty back, optional charge at
 * the drop site), then what a fleet of them doing it every day means for
 * charging at the port and for emissions against diesel.
 *
 * Drop sites are example destinations at city level, marked approximate,
 * until the freight flow work supplies the real ones.
 *
 * Pure: no Cesium, no DOM, no network (routes and elevations come in).
 */
import {
  DEFAULT_DIESEL_DRAYAGE_ID,
  compareAnnual,
  emissionsPerUnit,
  fleetModel,
  physicsTruckOf,
} from './catalog.js';
import {
  US_MILE_M,
  edgeSpeedsFromRoute,
  integrateChargeCurve,
  simulateTrip,
} from './physics.js';

/** Where POH trips start: the South Terminal yard (approximate). */
export const POH_ORIGIN = Object.freeze({
  id: 'poh-terminal',
  label: 'Port of Hueneme terminal',
  lat: 34.1497,
  lon: -119.2055,
  approximate: true,
});

/** Example drop sites. Coordinates are city or district level. */
export const DROP_SITES = Object.freeze(
  [
    {
      id: 'oxnard-coolers',
      label: 'Oxnard produce coolers',
      lat: 34.197,
      lon: -119.177,
      cargo: 'reefer',
    },
    {
      id: 'santa-clarita-dc',
      label: 'Santa Clarita distribution centers',
      lat: 34.43,
      lon: -118.56,
      cargo: 'container',
    },
    {
      id: 'la-produce-market',
      label: 'Los Angeles Wholesale Produce Market',
      lat: 34.0335,
      lon: -118.248,
      cargo: 'reefer',
    },
    {
      id: 'port-of-long-beach',
      label: 'Port of Long Beach (transload)',
      lat: 33.7542,
      lon: -118.2165,
      cargo: 'container',
    },
    {
      id: 'inland-empire-dc',
      label: 'Inland Empire distribution centers (Mira Loma)',
      lat: 34.03,
      lon: -117.55,
      cargo: 'container',
    },
    {
      id: 'santa-maria',
      label: 'Santa Maria',
      lat: 34.953,
      lon: -120.4357,
      cargo: 'reefer',
    },
    {
      id: 'bakersfield',
      label: 'Bakersfield (over the Grapevine)',
      lat: 35.3733,
      lon: -119.0187,
      cargo: 'container',
    },
    {
      id: 'fresno',
      label: 'Fresno',
      lat: 36.7378,
      lon: -119.7871,
      cargo: 'reefer',
    },
  ].map((site) => Object.freeze({ ...site, approximate: true })),
);

/** Loaded payloads (lb of truck + box + cargo above the tractor's curb weight). */
export const PAYLOAD_PRESETS = Object.freeze({
  empty_chassis: { label: 'Empty chassis', lbs: 7000 },
  empty_box: { label: 'Empty 40 ft box on chassis', lbs: 15_000 },
  loaded_box: { label: 'Loaded 40 ft box (72,000 lb GCW)', lbs: 46_000 },
  heavy_box: { label: 'Heavy box (80,000 lb GCW)', lbs: 54_000 },
});

/** Defaults for a round trip. */
export const TRIP_DEFAULTS = Object.freeze({
  outboundPayload: 'loaded_box',
  returnPayload: 'empty_box',
  weather: 'ideal',
  chargeAtDropKw: 0, // 0 = no charging at the drop site
  chargeAtDropMinutes: 60,
  startSocPct: 100,
});

/**
 * Simulate the round trip on a fetched route (out and back).
 *
 * @param {object} args
 * @param {object} args.model fleet catalog truck model (with physicsId)
 * @param {{coordinates:number[][],distanceM:number,durationS:number}} args.out
 * @param {Array<{dist_m:number,elev_m:number}>} args.outProfile
 * @param {object} args.back same shape, reversed (see route.reverseRoute)
 * @param {Array<{dist_m:number,elev_m:number}>} args.backProfile
 * @param {object} [args.options] see TRIP_DEFAULTS
 * @param {Array} [args.chargers] public heavy-duty chargers
 */
export function planRoundTrip({
  model,
  out,
  outProfile,
  back,
  backProfile,
  options = {},
  chargers = [],
}) {
  const o = { ...TRIP_DEFAULTS, ...options };
  const truck = physicsTruckOf(model);
  if (!truck) throw new Error(`${model?.label ?? 'Model'} has no physics data`);
  const leg = (route, profile, payloadKey, startSoc) =>
    simulateTrip({
      physics: truck.physics,
      coordinates: route.coordinates,
      profile,
      distanceM: route.distanceM,
      edgeSpeeds: edgeSpeedsFromRoute(route.distanceM, route.durationS),
      conditions: {
        weather_preset: o.weather,
        payload_lbs: PAYLOAD_PRESETS[payloadKey]?.lbs ?? 0,
        initial_soc_pct: startSoc,
      },
      chargers,
    });
  const outbound = leg(out, outProfile, o.outboundPayload, o.startSocPct);
  let arriveSoc = outbound.final_soc_pct;
  let dropCharge = null;
  if (o.chargeAtDropKw > 0 && arriveSoc < 100) {
    // Charge for the dwell time at the drop site, capped by the curve.
    const usable = truck.physics.usable_kwh;
    let target = arriveSoc;
    let result = { dwellS: 0, energyKwh: 0, departureSoc: arriveSoc };
    for (let t = arriveSoc + 1; t <= 100; t += 1) {
      const r = integrateChargeCurve(
        truck.physics.charge_curve,
        Math.max(arriveSoc, 0),
        t,
        o.chargeAtDropKw,
        usable,
      );
      if (r.dwellS > o.chargeAtDropMinutes * 60) break;
      target = t;
      result = r;
    }
    dropCharge = {
      kw: o.chargeAtDropKw,
      minutes: Math.round(result.dwellS / 60),
      energyKwh: result.energyKwh,
      fromSoc: arriveSoc,
      toSoc: target,
    };
    arriveSoc = result.departureSoc;
  }
  const inbound = leg(back, backProfile, o.returnPayload, arriveSoc);
  const kwh = outbound.kpis.total_kwh + inbound.kpis.total_kwh;
  const miles = outbound.kpis.distance_mi + inbound.kpis.distance_mi;
  const worst = [outbound.feasibility, inbound.feasibility].find(
    (f) => f && f.verdict !== 'feasible',
  );
  // Energy to put back at the port depot: what the trip used, less any
  // charging on the way, to return to the starting charge.
  const enRoute =
    (dropCharge?.energyKwh ?? 0) +
    [...outbound.charging_stops, ...inbound.charging_stops].reduce(
      (n, s) => n + s.energy_added_kwh,
      0,
    );
  return {
    model,
    truck,
    outbound,
    inbound,
    dropCharge,
    miles,
    kwh,
    kwhPerMile: miles > 0 ? kwh / miles : 0,
    hours: (outbound.kpis.total_time_s + inbound.kpis.total_time_s) / 3600,
    finalSocPct: inbound.final_soc_pct,
    minSocPct: Math.min(
      ...outbound.segments.map((s) => s.soc_pct),
      ...inbound.segments.map((s) => s.soc_pct),
    ),
    depotKwh: Math.max(0, kwh - enRoute),
    feasibility: worst ??
      outbound.feasibility ?? {
        verdict: 'feasible',
        tier: 'public_hd',
        stop_count: 0,
      },
  };
}

/** Defaults for the fleet day. */
export const FLEET_DEFAULTS = Object.freeze({
  trucks: 20,
  tripsPerTruckPerDay: 1,
  workDaysPerYear: 300,
  chargeWindowHours: 10,
  chargerKw: 150,
  usdPerKwh: 0.18,
  dieselUsdPerGallon: 3.48,
});

/**
 * A fleet doing this round trip every work day: depot energy and charger
 * power at the port, cost, and emissions against the diesel baseline.
 */
export function fleetDay(trip, options = {}) {
  const o = { ...FLEET_DEFAULTS, ...options };
  const trips = o.trucks * o.tripsPerTruckPerDay;
  const depotKwhPerDay = trip.depotKwh * trips;
  const perTruckKw =
    (trip.depotKwh * o.tripsPerTruckPerDay) / o.chargeWindowHours;
  const chargersNeeded = Math.ceil(
    (o.trucks * Math.min(perTruckKw, o.chargerKw)) / o.chargerKw,
  );
  const milesPerYear = trip.miles * trips * o.workDaysPerYear;
  const diesel = fleetModel(DEFAULT_DIESEL_DRAYAGE_ID);
  // Grid side uses the simulated kWh/mi, not the catalog's typical figure.
  const ze = { ...trip.model, kwhPerMi: trip.kwhPerMile };
  const annual = compareAnnual(ze, diesel, {
    units: 1,
    perUnitYear: milesPerYear,
  });
  const dieselPerMile = emissionsPerUnit(diesel);
  return {
    trips,
    depotKwhPerDay,
    depotMwhPerYear: (depotKwhPerDay * o.workDaysPerYear) / 1000,
    peakKw: o.trucks * Math.min(perTruckKw, o.chargerKw),
    perTruckKw,
    chargersNeeded,
    chargerKw: o.chargerKw,
    fitsWindow: perTruckKw <= o.chargerKw,
    milesPerYear,
    energyCostPerYear: depotKwhPerDay * o.workDaysPerYear * o.usdPerKwh,
    dieselCostPerYear: annual.dieselGal * o.dieselUsdPerGallon,
    annual,
    dieselCo2ePerMileKg: dieselPerMile.co2eKg,
    options: o,
  };
}

/** Plain-language verdict for a trip. */
export function verdictText(trip) {
  const f = trip.feasibility;
  if (!f) return 'No verdict';
  if (f.verdict === 'feasible')
    return f.stop_count
      ? `Feasible with ${f.stop_count} charging stop${f.stop_count > 1 ? 's' : ''}`
      : 'Feasible on one charge';
  if (f.verdict === 'critical')
    return 'Tight: arrives with little charge to spare';
  if (f.tier === 'depot_required')
    return 'Needs a full depot charge before leaving';
  return 'Not feasible: needs public heavy-duty chargers on this route (none in the model yet)';
}

export const milesOf = (m) => m / US_MILE_M;
