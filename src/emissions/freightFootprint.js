// End-to-end emissions footprint for a port's imports: ocean voyage from the
// origin port, the call at the port (ship and tugs), drayage from the gate to
// the off-dock drop site, and onward truck or rail to the market. Pure
// functions; the lane data and every assumption live in freightLanes.js.
//
// Allocation follows the GLEC idea: a ship's or truck's emissions are shared
// across the cargo it carries, by tonnes. A tonne of bananas bears one
// tonne's share of the voyage, the berth call and its truck trips.

import { craftEmissions, DEFAULT_CRAFT } from './callEmissions.js';
import {
  COMMODITIES,
  CIRCUITY,
  DROP_SITES,
  MARKETS,
  NOT_MODELED,
  ORIGINS,
  PORT_BERTH,
  PORT_CALL,
  PORT_GATE,
  RAIL_FACTORS,
  REPRESENTATIVE_SHIPS,
  SEA_WAYPOINTS,
  TRUCK_FACTORS,
  FREIGHT_SOURCES,
} from './freightLanes.js';
import { GWP_SETS, intervalEmissions, summarize } from './ogvMethod.js';
import { DEFAULT_FUEL_SULFUR } from './ogvFactors.js';

const EARTH_RADIUS_KM = 6371.0088;
const KM_PER_NM = 1.852;
const KM_PER_MILE = 1.609344;
const LEGS = Object.freeze(['ocean', 'port', 'drayage', 'onward']);

const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

/** Great-circle distance in km between [lat, lon] points. */
export function greatCircleKm([lat1, lon1], [lat2, lon2]) {
  const p1 = toRad(lat1);
  const p2 = toRad(lat2);
  const dp = p2 - p1;
  const dl = toRad(lon2 - lon1);
  const a =
    Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Sum of great-circle legs along a path of [lat, lon] points, in km. */
export function pathKm(points) {
  let km = 0;
  for (let i = 1; i < points.length; i += 1)
    km += greatCircleKm(points[i - 1], points[i]);
  return km;
}

/** Points along the great circle from a to b, about every `stepKm`. */
export function greatCirclePoints(a, b, stepKm = 250) {
  const d = greatCircleKm(a, b) / EARTH_RADIUS_KM;
  const n = Math.max(1, Math.ceil((d * EARTH_RADIUS_KM) / stepKm));
  if (d === 0) return [a, b];
  const [la1, lo1] = [toRad(a[0]), toRad(a[1])];
  const [la2, lo2] = [toRad(b[0]), toRad(b[1])];
  const out = [];
  for (let i = 0; i <= n; i += 1) {
    const f = i / n;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x =
      A * Math.cos(la1) * Math.cos(lo1) + B * Math.cos(la2) * Math.cos(lo2);
    const y =
      A * Math.cos(la1) * Math.sin(lo1) + B * Math.cos(la2) * Math.sin(lo2);
    const z = A * Math.sin(la1) + B * Math.sin(la2);
    out.push([toDeg(Math.atan2(z, Math.hypot(x, y))), toDeg(Math.atan2(y, x))]);
  }
  return out;
}

/** Sea route from an origin to the port: [lat, lon] points, waypoints included. */
export function seaRoute(originId, origins = ORIGINS) {
  const o = origins[originId];
  if (!o) throw new RangeError(`unknown origin ${originId}`);
  return [
    [o.lat, o.lon],
    ...(o.via ?? []).map((id) => {
      const wp = SEA_WAYPOINTS[id];
      if (!wp) throw new RangeError(`unknown waypoint ${id}`);
      return wp;
    }),
    [PORT_BERTH.lat, PORT_BERTH.lon],
  ];
}

/** The same route, densified along great circles for drawing. */
export function seaRouteLine(originId, stepKm = 250) {
  const pts = seaRoute(originId);
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i += 1)
    out.push(...greatCirclePoints(pts[i - 1], pts[i], stepKm).slice(1));
  return out;
}

const emptyTonnes = () => ({ co2e: 0, co2: 0, nox: 0, pm25: 0 });

function addInto(target, source, scale = 1) {
  for (const k of Object.keys(target)) target[k] += (source[k] ?? 0) * scale;
  return target;
}

/** ogvMethod vessel for a representative ship, cruising at its modeled speed. */
export function representativeVessel(ship) {
  return {
    shipType: ship.shipType,
    subtype: ship.subtype,
    keelYear: ship.keelYear,
    propulsion: {
      engineType: ship.engineType,
      installedKw: ship.installedKw,
      maxSpeedKn: ship.designSpeedKn,
      maxDraftM: ship.maxDraftM,
    },
    auxiliary: { engineType: 'MSD' },
  };
}

const pickTonnes = (summary) => ({
  co2e: summary.tonnes.co2e,
  co2: summary.tonnes.co2,
  nox: summary.tonnes.nox,
  pm25: summary.tonnes.pm25,
});

/**
 * Ocean leg per tonne of cargo: one laden voyage of `nm` at cruise speed,
 * the last `ecaNm` on 0.1% sulfur fuel and the rest on 0.5%, shared across
 * deadweight x utilization tonnes. Returns tonnes of each pollutant per
 * tonne of cargo, plus the voyage figures.
 */
export function oceanIntensity(ship, nm, { gwpSet = GWP_SETS.AR5 } = {}) {
  const vessel = representativeVessel(ship);
  const ecaNm = Math.min(nm, PORT_CALL.ecaNm);
  const openNm = nm - ecaNm;
  const leg = (miles, fuelSulfur) =>
    intervalEmissions(vessel, {
      hours: miles / ship.cruiseSpeedKn,
      mode: 'transit',
      speedKn: ship.cruiseSpeedKn,
      fuelSulfur,
    });
  const voyage = summarize(
    [
      leg(openNm, DEFAULT_FUEL_SULFUR.outsideEcaFrom2020),
      leg(ecaNm, DEFAULT_FUEL_SULFUR.insideEcaFrom2015),
    ],
    gwpSet,
  );
  const payloadT = ship.deadweight * ship.utilization;
  const perVoyage = pickTonnes(voyage);
  const perTonne = addInto(emptyTonnes(), perVoyage, 1 / payloadT);
  return {
    nm,
    days: nm / ship.cruiseSpeedKn / 24,
    payloadT,
    perVoyage,
    perTonne,
    warnings: voyage.warnings,
  };
}

/**
 * Port leg per tonne: one call (maneuvering in and out, hotelling at berth on
 * the ship's own engines, two tug jobs), shared across the cargo worked at
 * this port on that call.
 */
export function portCallIntensity(ship, { gwpSet = GWP_SETS.AR5 } = {}) {
  const vessel = representativeVessel(ship);
  const fuelSulfur = DEFAULT_FUEL_SULFUR.insideEcaFrom2015;
  const maneuver = intervalEmissions(vessel, {
    hours: 2 * PORT_CALL.maneuverHoursEachWay,
    mode: 'maneuvering',
    speedKn: PORT_CALL.maneuverSpeedKn,
    fuelSulfur,
  });
  const hotel = intervalEmissions(vessel, {
    hours: ship.hotelHours,
    mode: 'hotelling',
    fuelSulfur,
  });
  const shipCall = pickTonnes(summarize([maneuver, hotel], gwpSet));
  const tugs = emptyTonnes();
  for (let i = 0; i < PORT_CALL.tugJobsPerCall; i += 1) {
    const g = craftEmissions(DEFAULT_CRAFT.tug, PORT_CALL.tugHoursPerJob).grams;
    addInto(tugs, { co2e: g.co2, co2: g.co2, nox: g.nox, pm25: g.pm25 }, 1e-6);
  }
  const perCall = addInto(addInto(emptyTonnes(), shipCall), tugs);
  const cargoPerCallT = ship.deadweight * ship.utilization * ship.pohShare;
  return {
    perCall,
    shipCall,
    tugs,
    cargoPerCallT,
    perTonne: addInto(emptyTonnes(), perCall, 1 / cargoPerCallT),
  };
}

/** Per-mile truck factors (tonnes of pollutant per vehicle-mile). */
export function truckPerMile(powertrain = 'diesel', factors = TRUCK_FACTORS) {
  if (powertrain === 'electric') {
    const e = factors.electric;
    const co2e = (e.kwhPerMile * e.gridKgCo2ePerKwh) / 1000;
    return {
      id: e.id,
      label: e.label,
      gridKwh: e.kwhPerMile,
      tonnes: { co2e, co2: co2e, nox: 0, pm25: 0 },
    };
  }
  const d = factors.diesel;
  const gallons = 1 / d.mpg;
  const bhpHr = gallons * d.bhpHrPerGallon;
  const co2 = (gallons * d.kgCo2PerGallon) / 1000;
  return {
    id: d.id,
    label: d.label,
    dieselGallons: gallons,
    tonnes: {
      co2e: co2,
      co2,
      nox: (bhpHr * d.noxGPerBhpHr) / 1e6,
      pm25: (bhpHr * d.pmGPerBhpHr * 0.97) / 1e6,
    },
  };
}

/**
 * Truck leg: `tonnes` of cargo over `miles` one way, in loads of `payloadT`,
 * with `emptyReturn` of the loaded miles driven back empty.
 */
export function truckLeg({
  tonnes,
  miles,
  payloadT,
  emptyReturn = 1,
  powertrain = 'diesel',
  factors = TRUCK_FACTORS,
}) {
  const trips = tonnes / payloadT;
  const vehicleMiles = trips * miles * (1 + emptyReturn);
  const perMile = truckPerMile(powertrain, factors);
  return {
    mode: 'truck',
    powertrain,
    trips,
    vehicleMiles,
    tonMiles: tonnes * miles,
    gridKwh: (perMile.gridKwh ?? 0) * vehicleMiles,
    dieselGallons: (perMile.dieselGallons ?? 0) * vehicleMiles,
    tonnes: addInto(emptyTonnes(), perMile.tonnes, vehicleMiles),
  };
}

/** Rail leg: fuel from ton-miles (AAR average), Tier 3 line-haul limits. */
export function railLeg({ tonnes, miles, factors = RAIL_FACTORS }) {
  const tonMiles = tonnes * miles;
  const gallons = tonMiles / factors.tonMilesPerGallon;
  const bhpHr = gallons * factors.bhpHrPerGallon;
  const co2 = (gallons * factors.kgCo2PerGallon) / 1000;
  return {
    mode: 'rail',
    tonMiles,
    dieselGallons: gallons,
    gridKwh: 0,
    tonnes: {
      co2e: co2,
      co2,
      nox: (bhpHr * factors.noxGPerBhpHr) / 1e6,
      pm25: (bhpHr * factors.pmGPerBhpHr * 0.97) / 1e6,
    },
  };
}

const share = (weights) => {
  const entries = Object.entries(weights).map(([k, v]) =>
    Array.isArray(v) ? [k, v[0], v[1]] : [k, v, null],
  );
  const total = entries.reduce((s, [, w]) => s + w, 0);
  return entries.map(([id, w, extra]) => ({ id, share: w / total, extra }));
};

const at = (p) => [p.lat, p.lon];
const roadMiles = (a, b, circuity) =>
  (greatCircleKm(at(a), at(b)) * circuity) / KM_PER_MILE;

/** Published tonnes for a commodity (autos: units x tonnes per unit). */
export const commodityTonnes = (c) => c.tonnes ?? c.units * c.tonnesPerUnit;

/**
 * The whole footprint.
 * scenario: { drayage: 'diesel' | 'electric', onwardTruck: 'diesel' | 'electric' }
 * truckFactors: replaces TRUCK_FACTORS (the EV Planning catalog plugs in here).
 *
 * Returns { totals, byLeg, byCommodity, flows, sites, sources, notModeled }.
 * flows are map-ready: { id, leg, commodity, from, to, points?, tonnes,
 * emissions } with tonnes of cargo per year and emissions in tonnes per year.
 */
export function freightFootprint({
  commodities = COMMODITIES,
  scenario = {},
  truckFactors = TRUCK_FACTORS,
  gwpSet = GWP_SETS.AR5,
} = {}) {
  const drayagePowertrain = scenario.drayage ?? 'diesel';
  const onwardPowertrain = scenario.onwardTruck ?? 'diesel';
  const byLeg = Object.fromEntries(LEGS.map((l) => [l, emptyTonnes()]));
  const byCommodity = {};
  const flows = [];
  const oceanCache = new Map();
  const energy = { dieselGallons: 0, gridKwh: 0 };
  const activity = {
    calls: 0,
    drayageTrips: 0,
    truckMiles: 0,
    railTonMiles: 0,
  };

  for (const [cid, c] of Object.entries(commodities)) {
    const ship = REPRESENTATIVE_SHIPS[c.shipClass];
    if (!ship)
      throw new RangeError(`no representative ship for ${c.shipClass}`);
    const tonnes = commodityTonnes(c);
    const row = {
      id: cid,
      label: c.label,
      tonnes,
      units: c.units ?? null,
      ship: ship.name,
      legs: Object.fromEntries(LEGS.map((l) => [l, emptyTonnes()])),
      total: emptyTonnes(),
    };

    for (const o of share(c.origins)) {
      const key = `${o.id}:${c.shipClass}`;
      if (!oceanCache.has(key)) {
        const nm = pathKm(seaRoute(o.id)) / KM_PER_NM;
        oceanCache.set(key, oceanIntensity(ship, nm, { gwpSet }));
      }
      const ocean = oceanCache.get(key);
      const laneT = tonnes * o.share;
      const e = addInto(emptyTonnes(), ocean.perTonne, laneT);
      addInto(row.legs.ocean, e);
      flows.push({
        id: `ocean:${cid}:${o.id}`,
        leg: 'ocean',
        commodity: cid,
        color: c.color,
        from: o.id,
        to: 'port',
        nm: ocean.nm,
        days: ocean.days,
        tonnes: laneT,
        emissions: e,
      });
    }

    const call = portCallIntensity(ship, { gwpSet });
    addInto(row.legs.port, call.perTonne, tonnes);
    activity.calls += tonnes / call.cargoPerCallT;

    for (const d of share(c.dropSites)) {
      const site = DROP_SITES[d.id];
      if (!site) throw new RangeError(`unknown drop site ${d.id}`);
      const siteT = tonnes * d.share;
      const miles = roadMiles(PORT_GATE, site, CIRCUITY.drayage);
      const dray = truckLeg({
        tonnes: siteT,
        miles,
        payloadT: c.truckPayloadT,
        emptyReturn: 1,
        powertrain: drayagePowertrain,
        factors: truckFactors,
      });
      addInto(row.legs.drayage, dray.tonnes);
      energy.dieselGallons += dray.dieselGallons;
      energy.gridKwh += dray.gridKwh;
      activity.drayageTrips += dray.trips;
      activity.truckMiles += dray.vehicleMiles;
      flows.push({
        id: `drayage:${cid}:${d.id}`,
        leg: 'drayage',
        commodity: cid,
        color: c.color,
        from: 'gate',
        to: d.id,
        miles,
        trips: dray.trips,
        tonnes: siteT,
        emissions: dray.tonnes,
      });

      for (const m of share(c.markets)) {
        const market = MARKETS[m.id];
        if (!market) throw new RangeError(`unknown market ${m.id}`);
        const mode = m.extra ?? 'truck';
        const flowT = siteT * m.share;
        const onMiles = roadMiles(
          site,
          market,
          mode === 'rail' ? CIRCUITY.rail : CIRCUITY.road,
        );
        const leg =
          mode === 'rail'
            ? railLeg({ tonnes: flowT, miles: onMiles })
            : truckLeg({
                tonnes: flowT,
                miles: onMiles,
                payloadT: c.truckPayloadT,
                emptyReturn: c.onwardEmptyReturn ?? 0.5,
                powertrain: onwardPowertrain,
                factors: truckFactors,
              });
        addInto(row.legs.onward, leg.tonnes);
        energy.dieselGallons += leg.dieselGallons;
        energy.gridKwh += leg.gridKwh;
        if (mode === 'rail') activity.railTonMiles += leg.tonMiles;
        else activity.truckMiles += leg.vehicleMiles;
        flows.push({
          id: `onward:${cid}:${d.id}:${m.id}`,
          leg: 'onward',
          mode,
          commodity: cid,
          color: c.color,
          from: d.id,
          to: m.id,
          miles: onMiles,
          tonnes: flowT,
          emissions: leg.tonnes,
        });
      }
    }

    for (const l of LEGS) {
      addInto(row.total, row.legs[l]);
      addInto(byLeg[l], row.legs[l]);
    }
    row.co2ePerTonne = row.total.co2e / tonnes;
    byCommodity[cid] = row;
  }

  const totals = emptyTonnes();
  for (const l of LEGS) addInto(totals, byLeg[l]);
  const cargoTonnes = Object.values(byCommodity).reduce(
    (s, r) => s + r.tonnes,
    0,
  );
  return {
    totals,
    byLeg,
    byCommodity,
    cargoTonnes,
    flows,
    energy,
    activity,
    scenario: { drayage: drayagePowertrain, onwardTruck: onwardPowertrain },
    gwp: gwpSet,
    sources: FREIGHT_SOURCES,
    notModeled: NOT_MODELED,
  };
}

export { LEGS as FREIGHT_LEGS };
