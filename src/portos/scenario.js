/**
 * Run one scenario end to end: schedule -> equipment demand -> fleet
 * simulation -> site load -> battery -> bill -> rollups and totals.
 *
 * A scenario is plain data, so the scenario builder can save it, the GEV
 * clock can replay it, and the FP&A report generator can cite it.
 */
import { billByMonth, stepPeriods } from './billing.js';
import { dispatchBattery } from './battery.js';
import { capexPlan } from './capex.js';
import {
  STAX,
  atBerthWithAndWithoutStax,
  shorePowerInService,
} from './atBerth.js';
import { simulateFleet } from './fleetSim.js';
import {
  CALL_PROFILE,
  CREW_TEMPLATES,
  FACTORS,
  FLEET_PLAN,
  HUENEME_REGISTRY,
  PURCHASES,
  SHIFT_SLOTS,
  UNIT_COSTS,
} from './hueneme.js';
import {
  equipmentDemand,
  shorePowerLoad,
  synthesizeCalls,
} from './schedule.js';
import { TARIFFS } from './tariffs.js';
import { STEPS_PER_HOUR, yearSteps } from './touCalendar.js';

const DT = 1 / STEPS_PER_HOUR;

/** Defaults for a Hueneme scenario; any field can be overridden. */
export const DEFAULT_SCENARIO = Object.freeze({
  name: 'Hueneme UTR baseline',
  year: 2026,
  seed: 1,
  callScale: 1,
  tariffId: 'SCE-TOU-8-D',
  includeDeferredDemand: false,
  strategy: 'asap',
  reserve: 0.3,
  chargerEfficiency: 0.92,
  // Electric/diesel split per spec; unset specs follow the fleet plan year.
  fleet: {},
  shorePower: false,
  shorePowerTypes: ['Refrigerated'],
  // STAX emissions capture barges for ships at berths without shore power
  // (on by default: Hueneme runs two today). See atBerth.js.
  stax: true,
  staxBerths: STAX.berths,
  staxBarges: STAX.barges,
  baseLoadKw: 0,
  battery: null,
  capexMethod: 'per-unit',
  // The workbook fleet is smaller than its crew templates need when calls
  // overlap (e.g. Class V forklifts for Ro-Ro high-and-heavy work). When true,
  // extra diesel units cover the gap and are reported as gapUnits.
  fillGapWithDiesel: true,
});

/** Electric/diesel counts for a spec in a fleet-plan year. */
function planFleet(year, specId) {
  const years = Object.keys(FLEET_PLAN)
    .map(Number)
    .sort((a, b) => a - b);
  const pick = years.filter((y) => y <= year).pop() ?? years[0];
  const row = FLEET_PLAN[pick][specId];
  if (!row) return null;
  return { diesel: row[0], electric: row[1] };
}

/** Lowest battery threshold that keeps the meter at or under it all year. */
export function bestThreshold(load, battery, periods) {
  let peak = 0;
  for (const value of load) if (value > peak) peak = value;
  let low = Math.max(0, peak - battery.kw);
  let high = peak;
  for (let i = 0; i < 24; i += 1) {
    const mid = (low + high) / 2;
    const { netKw } = dispatchBattery(
      load,
      { ...battery, thresholdKw: mid },
      periods,
    );
    let max = 0;
    for (const value of netKw) if (value > max) max = value;
    if (max <= mid + 0.5) high = mid;
    else low = mid;
  }
  return high;
}

function sum(values) {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

function max(values) {
  let top = 0;
  for (const value of values) if (value > top) top = value;
  return top;
}

/**
 * @param {Partial<typeof DEFAULT_SCENARIO>} input
 * @param {{ registry?: object, calls?: object[] }} [context] pass recorded
 *   calls (the event log) to replace the synthetic schedule
 */
export function runScenario(input = {}, context = {}) {
  const scenario = { ...DEFAULT_SCENARIO, ...input };
  const registry = context.registry ?? HUENEME_REGISTRY;
  const tariff = TARIFFS[scenario.tariffId];
  if (!tariff) throw new Error(`Unknown tariff: ${scenario.tariffId}`);
  const calendar = yearSteps(scenario.year);
  const totalSteps = calendar.length;
  const { periods } = stepPeriods(tariff, calendar);
  const calls =
    context.calls ??
    synthesizeCalls(CALL_PROFILE, {
      seed: scenario.seed,
      scale: scenario.callScale,
    });
  const demand = equipmentDemand(calls, {
    totalSteps,
    slots: SHIFT_SLOTS,
    templates: CREW_TEMPLATES,
  });

  const fleets = {};
  const siteKw = new Float64Array(totalSteps).fill(scenario.baseLoadKw);
  const dieselGallons = new Float64Array(totalSteps);
  for (const [specId, series] of Object.entries(demand)) {
    const spec = registry.specs[specId];
    if (!spec) continue;
    const peakDemand = max(series);
    const mix = {
      ...(scenario.fleet[specId] ??
        planFleet(scenario.year, specId) ?? {
          electric: 0,
          diesel: peakDemand,
        }),
    };
    const gapUnits = scenario.fillGapWithDiesel
      ? Math.max(0, peakDemand - mix.electric - mix.diesel)
      : 0;
    mix.diesel += gapUnits;
    const result = simulateFleet({
      demand: series,
      spec,
      electric: mix.electric,
      diesel: mix.diesel,
      chargers: mix.chargers ?? mix.electric,
      periods,
      strategy: scenario.strategy,
      reserve: scenario.reserve,
      chargerEfficiency: scenario.chargerEfficiency,
    });
    for (let i = 0; i < totalSteps; i += 1) {
      siteKw[i] += result.gridKw[i];
      dieselGallons[i] += result.dieselGallons[i];
    }
    const gallons = sum(result.dieselGallons);
    fleets[specId] = {
      label: spec.label,
      electric: mix.electric,
      diesel: mix.diesel,
      gapUnits,
      chargers: mix.chargers ?? mix.electric,
      peakDemand,
      kwh: sum(result.gridKw) * DT,
      peakKw: max(result.gridKw),
      dieselGallons: gallons,
      co2Tonnes: (gallons * FACTORS.dieselKgCo2PerGallon) / 1000,
      electricHours: sum(result.electricWorking) * DT,
      dieselHours: sum(result.dieselWorking) * DT,
      unmetHours: sum(result.unmet) * DT,
      series: result,
    };
  }

  const shoreKw = scenario.shorePower
    ? shorePowerLoad(calls, {
        totalSteps,
        // Only vaults whose berth has shore power in service that year.
        vaults: registry.assets.filter(
          (asset) =>
            asset.class === 'shore_power' &&
            shorePowerInService(asset.berthId, scenario.year),
        ),
        types: scenario.shorePowerTypes,
      })
    : null;
  if (shoreKw) for (let i = 0; i < totalSteps; i += 1) siteKw[i] += shoreKw[i];

  const atBerth = atBerthWithAndWithoutStax(calls, scenario);

  let battery = null;
  let meterKw = siteKw;
  if (scenario.battery?.kwh > 0 && scenario.battery?.kw > 0) {
    const thresholdKw =
      scenario.battery.thresholdKw === 'auto' ||
      scenario.battery.thresholdKw == null
        ? bestThreshold(siteKw, scenario.battery, periods)
        : scenario.battery.thresholdKw;
    const dispatch = dispatchBattery(
      siteKw,
      { ...scenario.battery, thresholdKw },
      periods,
    );
    meterKw = dispatch.netKw;
    battery = { ...scenario.battery, thresholdKw, ...dispatch };
  }

  const billOptions = { includeDeferredDemand: scenario.includeDeferredDemand };
  const bills = billByMonth(meterKw, tariff, calendar, billOptions);
  const billsWithoutBattery = battery
    ? billByMonth(siteKw, tariff, calendar, billOptions)
    : bills;
  const totalOf = (rows, field) =>
    rows.reduce((acc, row) => acc + row[field], 0);
  const gallons = sum(dieselGallons);
  const unmetHours = Object.values(fleets).reduce(
    (acc, f) => acc + f.unmetHours,
    0,
  );

  return {
    scenario,
    tariff,
    calendar,
    periods,
    calls,
    fleets,
    siteKw,
    shoreKw,
    meterKw,
    dieselGallons,
    atBerth,
    battery,
    bills,
    capex: capexPlan(PURCHASES, UNIT_COSTS, { method: scenario.capexMethod }),
    totals: {
      calls: calls.length,
      kwh: sum(meterKw) * DT,
      peakKw: max(meterKw),
      peakKwWithoutBattery: max(siteKw),
      energyCost: totalOf(bills, 'energyCost'),
      demandCost: totalOf(bills, 'demandCost'),
      electricityCost: totalOf(bills, 'total'),
      batterySavings: battery
        ? totalOf(billsWithoutBattery, 'total') - totalOf(bills, 'total')
        : 0,
      dieselGallons: gallons,
      dieselCost: gallons * FACTORS.dieselDollarsPerGallon,
      co2Tonnes: (gallons * FACTORS.dieselKgCo2PerGallon) / 1000,
      unmetHours,
      shipNoxTonnes: atBerth.current.totals.tonnes.nox,
      shipPm25Tonnes: atBerth.current.totals.tonnes.pm25,
      shipDpmTonnes: atBerth.current.totals.tonnes.dpm,
      shipCo2Tonnes: atBerth.current.totals.tonnes.co2,
      staxNoxSavedTonnes: scenario.stax ? atBerth.staxSavedTonnes.nox : 0,
      staxDpmSavedTonnes: scenario.stax ? atBerth.staxSavedTonnes.dpm : 0,
    },
  };
}
