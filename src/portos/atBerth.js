/**
 * Ship emissions while at berth, and what shore power or a STAX emissions
 * capture barge does to them.
 *
 * At berth a ship runs auxiliary engines (and sometimes a boiler) for hotel
 * load. Three things can happen to that exhaust on each call:
 *   - shore power: the auxiliary engines shut down and the grid carries the
 *     hotel load (only at a berth whose shore power is in service that year);
 *   - STAX: a barge-mounted capture and control system (CARB's term: an
 *     emission control strategy, ECCS / CAECS) clamps a hood onto the stack
 *     and scrubs the exhaust, while the ship keeps burning fuel;
 *   - nothing: the exhaust goes straight to air.
 * Shore power wins when both are on; STAX covers berths without it.
 *
 * Loads and engine factors come from EPA's port inventory guidance (via
 * src/emissions/ogvMethod.js). STAX capture rates and operating limits come
 * from CARB's executive orders and STAX's published figures, cited in
 * STAX_SOURCES. Pure: no DOM, no Cesium.
 */
import {
  defaultHotelLoads,
  engineEmissionFactors,
} from '../emissions/ogvMethod.js';
import { STEPS_PER_HOUR } from './touCalendar.js';

const DT = 1 / STEPS_PER_HOUR;

/** Pollutants reported at berth, all in grams until totals convert. */
export const BERTH_POLLUTANTS = Object.freeze([
  'nox',
  'pm25',
  'dpm',
  'hc',
  'co',
  'so2',
  'co2',
]);

/**
 * Hotel load (EPA Appendix E hotelling defaults) for each scenario call type.
 * The workbook names cargo, not ship size, so each type maps to one EPA row.
 */
export const CALL_TYPE_VESSELS = Object.freeze({
  Refrigerated: Object.freeze({ shipType: 'Reefer', subtype: 'All Reefer' }),
  'Ro-Ro/Vehicles Carrier': Object.freeze({
    shipType: 'RORO',
    subtype: 'Largest',
  }),
  Tanker: Object.freeze({ shipType: 'Oil Tanker', subtype: 'Handysize' }),
  'Heavy Lift': Object.freeze({
    shipType: 'General Cargo',
    subtype: 'Largest',
  }),
  'General Cargo': Object.freeze({
    shipType: 'General Cargo',
    subtype: 'Largest',
  }),
});

/**
 * Engine assumptions for ships with no registry record: medium-speed
 * auxiliary engines on California's 0.1% sulfur distillate, keel laid 2008
 * (IMO Tier I NOx). Ship records from AIS can replace these per call.
 */
export const DEFAULT_SHIP_ENGINES = Object.freeze({
  fuel: 'MGO/MDO',
  auxEngineType: 'MSD',
  keelYear: 2008,
  fuelSulfur: 0.001,
});

/**
 * When each berth's ship shore power is in service, from the Port of
 * Hueneme Port & Terminal Plan (CARB At Berth, revised June 2025): the South
 * Terminal system (berths 1-2) was destroyed in the December 2023 storm and
 * returns late 2027 to early 2028; berths 4-5 get shore power in Q1 2028.
 * A berth missing here has no shore power. Years are inclusive.
 */
export const SHORE_POWER_IN_SERVICE = Object.freeze({
  'berth-1': Object.freeze({ until: 2023, from: 2028 }),
  'berth-2': Object.freeze({ until: 2023, from: 2028 }),
  'berth-4': Object.freeze({ from: 2028 }),
  'berth-5': Object.freeze({ from: 2028 }),
});

/** True when a berth has working ship shore power in `year`. */
export function shorePowerInService(berthId, year) {
  const window = SHORE_POWER_IN_SERVICE[berthId];
  if (!window) return false;
  if (window.until != null && year <= window.until) return true;
  return window.from != null && year >= window.from;
}

/**
 * STAX barge figures. Capture rates are STAX's third-party-tested figures
 * (also quoted by the Port of Hueneme); CARB's executive orders set the
 * outlet limits, the 2-hour hook-up and 1-hour release windows, and the
 * barge generator's ceiling and fuel.
 */
export const STAX = Object.freeze({
  capture: Object.freeze({ pm: 0.99, nox: 0.95 }),
  // CARB CAECS limit for auxiliary engines; captured ROG is capped at it.
  rogLimitGPerKwh: 0.1,
  // EO: control starts within 2 h of "Ready to Work" and runs until at
  // least 1 h before "Pilot on Board". The same windows apply to shore power.
  hookupHours: 2,
  releaseHours: 1,
  // EO G-24-054 Attachment 1: CAECS auxiliary generator max 320 kW on
  // renewable diesel at or under 19.16 g CO2e/MJ. Taken at the maximum, so
  // the barge's own fuel is an upper bound.
  bargeGeneratorKw: 320,
  renewableDieselGCo2ePerMj: 19.16,
  // Generator fuel: 213 g/kWh, renewable diesel 44 MJ/kg, 2.95 kg/gal.
  generatorGPerKwh: 213,
  renewableDieselMjPerKg: 44,
  renewableDieselKgPerGallon: 2.95,
  // Generator exhaust at EPA Tier 4 final limits for 130-560 kW nonroad
  // engines (40 CFR 1039.101); a floor, labelled as such.
  generatorGPerKwhLimits: Object.freeze({
    nox: 0.4,
    pm25: 0.02,
    dpm: 0.02,
    hc: 0.19,
    co: 3.5,
  }),
  // Two barges at Hueneme, one per commercial terminal (STAX 6 arrived July
  // 2025). One barge treats one ship at a time.
  barges: 2,
  // Vessel types with a STAX executive order (container, ro-ro, tanker) plus
  // reefers, which the 2025 terminal plan says the South Terminal barge
  // serves. Heavy lift and general cargo have no order.
  vesselTypes: Object.freeze([
    'Refrigerated',
    'Ro-Ro/Vehicles Carrier',
    'Tanker',
  ]),
  // Commercial berths a barge can reach (South and North terminals).
  berths: Object.freeze([
    'berth-1',
    'berth-2',
    'berth-3',
    'berth-4',
    'berth-5',
  ]),
});

export const STAX_SOURCES = Object.freeze([
  Object.freeze({
    title:
      'CARB Executive Order G-24-054, STAXbox.A-1 for ro-ro vessels (March 21, 2024), Attachment 1',
    url: 'https://ww2.arb.ca.gov/sites/default/files/2024-03/Executive%20Order%20G-24-054%20ADA.pdf',
    used: 'Outlet limits, hook-up and release windows, one auxiliary engine, 320 kW renewable-diesel generator',
  }),
  Object.freeze({
    title:
      'CARB At Berth Regulation Executive Orders (STAX: container, ro-ro, tanker)',
    url: 'https://ww2.arb.ca.gov/berth-regulation-executive-orders',
    used: 'Vessel classes STAX may treat',
  }),
  Object.freeze({
    title:
      'Port of Hueneme, "Port of Hueneme Unveils Second STAX Emissions Capture & Control Barge" (July 16, 2025)',
    url: 'https://www.portofhueneme.org/charging-forward-to-zero-emissions-port-of-hueneme-unveils-second-stax-emissions-capture-control-barge/',
    used: 'Two barges at Hueneme, one per terminal; 99% PM and 95% NOx captured',
  }),
  Object.freeze({
    title: 'STAX Engineering, "How STAX Works"',
    url: 'https://www.staxengineering.com/how-it-works/',
    used: 'Particulate filter plus SCR on a 40 x 160 ft barge; CO2 is not captured',
  }),
]);

const zero = () => Object.fromEntries(BERTH_POLLUTANTS.map((p) => [p, 0]));

function addInto(target, source, scale = 1) {
  for (const p of BERTH_POLLUTANTS) target[p] += (source[p] ?? 0) * scale;
}

/** g/kWh for the auxiliary engines and the boiler of one call type. */
function callFactors(engines) {
  const aux = engineEmissionFactors({
    group: 'auxiliary',
    fuel: engines.fuel,
    engineType: engines.auxEngineType,
    keelYear: engines.keelYear,
    fuelSulfur: engines.fuelSulfur,
  }).factors;
  const boiler = engineEmissionFactors({
    group: 'boiler',
    fuel: engines.fuel,
    engineType: 'Boiler',
    keelYear: engines.keelYear,
    fuelSulfur: engines.fuelSulfur,
  }).factors;
  return { aux, boiler };
}

/** Auxiliary-engine g/kWh after STAX. CO, SO2 and CO2 are not credited. */
export function staxOutletFactors(aux) {
  const { capture, rogLimitGPerKwh } = STAX;
  return {
    ...aux,
    nox: aux.nox * (1 - capture.nox),
    pm25: aux.pm25 * (1 - capture.pm),
    dpm: aux.dpm * (1 - capture.pm),
    hc: Math.min(aux.hc, rogLimitGPerKwh),
  };
}

/** Grams, renewable-diesel gallons and lifecycle CO2e for barge hours. */
export function bargeGenerator(hours) {
  const kwh = STAX.bargeGeneratorKw * Math.max(0, hours);
  const fuelKg = (kwh * STAX.generatorGPerKwh) / 1000;
  const limits = STAX.generatorGPerKwhLimits;
  return {
    kwh,
    gallons: fuelKg / STAX.renewableDieselKgPerGallon,
    lifecycleCo2eKg:
      (fuelKg * STAX.renewableDieselMjPerKg * STAX.renewableDieselGCo2ePerMj) /
      1000,
    grams: {
      nox: limits.nox * kwh,
      pm25: limits.pm25 * kwh,
      dpm: limits.dpm * kwh,
      hc: limits.hc * kwh,
      co: limits.co * kwh,
      so2: 0,
      // Renewable diesel CO2 at the stack is biogenic; its lifecycle CO2e
      // is reported separately.
      co2: 0,
    },
  };
}

/** Scenario switches with defaults. */
function switches(scenario) {
  return {
    year: scenario.year,
    shorePower: Boolean(scenario.shorePower),
    shorePowerTypes: scenario.shorePowerTypes ?? [],
    stax: Boolean(scenario.stax),
    staxBerths: new Set(scenario.staxBerths ?? STAX.berths),
    staxBarges: Math.max(0, Math.floor(scenario.staxBarges ?? STAX.barges)),
  };
}

/**
 * Every call's at-berth emissions under a scenario.
 *
 * Each call gets `method`: 'shore-power', 'stax' or 'none', the steps that
 * method covered ([controlStart, controlEnd)), and `bargeId` for STAX. Calls
 * are handed a barge in arrival order; a call that finds every barge busy
 * waits for the next one free, and is uncontrolled meanwhile.
 *
 * @param {object[]} calls scenario calls ({ id, type, berthId, start, end })
 * @param {object} scenario runScenario input (year, shorePower,
 *   shorePowerTypes, stax, staxBerths, staxBarges)
 * @param {{ engines?: object, shorePowerBerths?: (berthId, year) => boolean }} [options]
 */
export function atBerthEmissions(calls, scenario, options = {}) {
  const s = switches(scenario);
  const engines = { ...DEFAULT_SHIP_ENGINES, ...options.engines };
  const shoreOk = options.shorePowerBerths ?? shorePowerInService;
  const { aux, boiler } = callFactors(engines);
  const auxStax = staxOutletFactors(aux);
  const hookup = STAX.hookupHours * STEPS_PER_HOUR;
  const release = STAX.releaseHours * STEPS_PER_HOUR;
  const bargeFree = Array.from({ length: s.staxBarges }, () => 0);

  const out = [];
  const totals = {
    grams: zero(),
    shipGrams: zero(),
    bargeGrams: zero(),
    shoreKwh: 0,
    bargeKwh: 0,
    bargeGallons: 0,
    bargeLifecycleCo2eKg: 0,
    hotelHours: 0,
    controlledHours: { 'shore-power': 0, stax: 0 },
    calls: { 'shore-power': 0, stax: 0, none: 0 },
    // STAX-eligible calls that found no barge free for the whole stay.
    staxMissed: 0,
  };

  const ordered = [...calls].sort((a, b) => a.start - b.start);
  for (const call of ordered) {
    const vessel = CALL_TYPE_VESSELS[call.type];
    const loads = vessel
      ? defaultHotelLoads(vessel.shipType, vessel.subtype, 'hotelling')
      : null;
    const auxKw = loads?.auxKw ?? 0;
    const boilerKw = loads?.boilerKw ?? 0;
    const steps = Math.max(0, call.end - call.start);
    const hours = steps * DT;
    const windowStart = Math.min(call.end, call.start + hookup);
    const windowEnd = Math.max(windowStart, call.end - release);

    let method = 'none';
    let controlStart = call.start;
    let controlEnd = call.start;
    let bargeId = null;
    if (
      s.shorePower &&
      s.shorePowerTypes.includes(call.type) &&
      shoreOk(call.berthId, s.year)
    ) {
      method = 'shore-power';
      controlStart = windowStart;
      controlEnd = windowEnd;
    } else if (
      s.stax &&
      s.staxBarges > 0 &&
      s.staxBerths.has(call.berthId) &&
      STAX.vesselTypes.includes(call.type)
    ) {
      let pick = 0;
      for (let i = 1; i < bargeFree.length; i += 1)
        if (bargeFree[i] < bargeFree[pick]) pick = i;
      const start = Math.max(windowStart, bargeFree[pick]);
      if (start < windowEnd) {
        method = 'stax';
        controlStart = start;
        controlEnd = windowEnd;
        bargeId = `stax-${pick + 1}`;
        // The barge stays alongside until the ship sails.
        bargeFree[pick] = call.end;
      } else totals.staxMissed += 1;
    }
    const controlledHours = (controlEnd - controlStart) * DT;
    const openHours = hours - controlledHours;

    const ship = zero();
    addInto(ship, aux, auxKw * openHours);
    addInto(ship, boiler, boilerKw * hours);
    const barge =
      method === 'stax' ? bargeGenerator(controlledHours) : bargeGenerator(0);
    if (method === 'stax') addInto(ship, auxStax, auxKw * controlledHours);
    const shoreKwh = method === 'shore-power' ? auxKw * controlledHours : 0;
    const grams = zero();
    addInto(grams, ship);
    addInto(grams, barge.grams);

    addInto(totals.grams, grams);
    addInto(totals.shipGrams, ship);
    addInto(totals.bargeGrams, barge.grams);
    totals.shoreKwh += shoreKwh;
    totals.bargeKwh += barge.kwh;
    totals.bargeGallons += barge.gallons;
    totals.bargeLifecycleCo2eKg += barge.lifecycleCo2eKg;
    totals.hotelHours += hours;
    totals.calls[method] += 1;
    if (method !== 'none') totals.controlledHours[method] += controlledHours;

    out.push({
      id: call.id,
      type: call.type,
      berthId: call.berthId,
      start: call.start,
      end: call.end,
      auxKw,
      boilerKw,
      method,
      controlStart,
      controlEnd,
      bargeId,
      shoreKwh,
      grams,
    });
  }

  const tonnes = (g) =>
    Object.fromEntries(BERTH_POLLUTANTS.map((p) => [p, g[p] / 1e6]));
  return {
    calls: out,
    engines,
    factors: { aux, auxStax, boiler },
    totals: {
      ...totals,
      tonnes: tonnes(totals.grams),
      shipTonnes: tonnes(totals.shipGrams),
      bargeTonnes: tonnes(totals.bargeGrams),
    },
  };
}

/**
 * At-berth emissions with the scenario's STAX setting and with STAX off,
 * so every run reports what the barges save (or would save).
 */
export function atBerthWithAndWithoutStax(calls, scenario, options = {}) {
  const withStax = atBerthEmissions(
    calls,
    { ...scenario, stax: true },
    options,
  );
  const withoutStax = atBerthEmissions(
    calls,
    { ...scenario, stax: false },
    options,
  );
  const saved = Object.fromEntries(
    BERTH_POLLUTANTS.map((p) => [
      p,
      withoutStax.totals.tonnes[p] - withStax.totals.tonnes[p],
    ]),
  );
  return {
    current: scenario.stax ? withStax : withoutStax,
    withStax,
    withoutStax,
    // Tonnes avoided by STAX (positive = cleaner with STAX). CO2 is negative
    // only by the barge's fossil share, which is zero for renewable diesel.
    staxSavedTonnes: saved,
    bargeLifecycleCo2eTonnes: withStax.totals.bargeLifecycleCo2eKg / 1000,
  };
}

/** Which call (if any) is at a berth at `step`, with its control state. */
export function berthStateAt(atBerth, berthId, step) {
  const call = atBerth.calls.find(
    (c) => c.berthId === berthId && c.start <= step && step < c.end,
  );
  if (!call) return null;
  const controlled =
    call.method !== 'none' &&
    call.controlStart <= step &&
    step < call.controlEnd;
  return { call, controlled };
}
