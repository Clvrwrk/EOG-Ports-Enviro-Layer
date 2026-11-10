/**
 * Put a scenario's loads on the meters that would carry them.
 *
 * runScenario bills the whole site on one tariff. Here each load is sent to
 * the meter whose `carries` list names it (shore power, crane power,
 * equipment charging) and billed on that meter's own rate schedule when the
 * app has it as tariff data. Loads no meter carries are reported, not lost.
 *
 * Scenario load is modeled; a meter's billed history is measured. They are
 * shown side by side and never added together, because the history may
 * already contain the same activity.
 *
 * Pure: no Cesium, no DOM.
 */
import { billByMonth } from '../billing.js';
import { TARIFFS } from '../tariffs.js';
import { STEPS_PER_HOUR } from '../touCalendar.js';
import { headroomKw } from './registry.js';

const DT = 1 / STEPS_PER_HOUR;

/** Tariff data id for a rate schedule as printed on a bill. */
export function tariffIdFor(rateSchedule = '') {
  const rate = rateSchedule.toUpperCase();
  if (rate.includes('EV-9')) return 'SCE-TOU-EV-9';
  if (/TOU-8-?D/.test(rate)) return 'SCE-TOU-8-D';
  return null;
}

/** Which scenario load a fleet's grid draw counts as. */
function loadIdFor(spec) {
  return spec?.gridTethered ? 'crane' : 'equipment_charging';
}

/** The scenario's grid draw per load id, as kW series over the year. */
export function scenarioLoads(result, specs) {
  const steps = result.siteKw.length;
  const loads = {};
  const add = (id, series) => {
    loads[id] ??= new Float64Array(steps);
    for (let i = 0; i < steps; i += 1) loads[id][i] += series[i];
  };
  for (const [specId, fleet] of Object.entries(result.fleets))
    add(loadIdFor(specs[specId]), fleet.series.gridKw);
  if (result.shoreKw) add('shore_power', result.shoreKw);
  return loads;
}

/**
 * @returns {{ byMeter: Map<string, object>, unassigned: object[] }}
 *   byMeter entries: { loads, series, kwh, peakKw, peakStep, bill,
 *   tariffName, headroomKw }
 */
export function allocateScenario(result, registry, specs) {
  const loads = scenarioLoads(result, specs);
  const byMeter = new Map();
  const unassigned = [];
  for (const [loadId, series] of Object.entries(loads)) {
    let peakKw = 0;
    let kwh = 0;
    for (const kw of series) {
      if (kw > peakKw) peakKw = kw;
      kwh += kw * DT;
    }
    if (!kwh) continue;
    const meter = registry.meters.find((m) => m.carries.includes(loadId));
    if (!meter) {
      unassigned.push({ loadId, kwh, peakKw });
      continue;
    }
    const entry = byMeter.get(meter.id) ?? {
      loads: [],
      series: new Float64Array(series.length),
    };
    entry.loads.push(loadId);
    for (let i = 0; i < series.length; i += 1) entry.series[i] += series[i];
    byMeter.set(meter.id, entry);
  }
  for (const [meterId, entry] of byMeter) {
    const meter = registry.meters.find((m) => m.id === meterId);
    entry.kwh = 0;
    entry.peakKw = 0;
    entry.peakStep = 0;
    entry.series.forEach((kw, i) => {
      entry.kwh += kw * DT;
      if (kw > entry.peakKw) {
        entry.peakKw = kw;
        entry.peakStep = i;
      }
    });
    const tariff = TARIFFS[tariffIdFor(meter.tariff)];
    entry.bill = tariff
      ? billByMonth(entry.series, tariff, result.calendar, {
          includeDeferredDemand: result.scenario.includeDeferredDemand,
        }).reduce((acc, month) => acc + month.total, 0)
      : null;
    entry.tariffName = tariff ? meter.tariff : null;
    entry.headroomKw = headroomKw(meter, entry.peakKw);
  }
  return { byMeter, unassigned };
}

/** A meter's scenario entry at one step, for its data card. */
export function meterScenarioAt(allocation, meterId, step) {
  const entry = allocation?.byMeter.get(meterId);
  if (!entry) return null;
  return { ...entry, nowKw: entry.series[step] ?? 0 };
}
