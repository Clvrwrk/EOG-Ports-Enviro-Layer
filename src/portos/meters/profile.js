/**
 * The port's modeled load over one day, by end use, for the usage graph.
 *
 * There are no 15-minute meter readings yet, so the day is built from two
 * things: the scenario's own 15-minute loads for the end uses it models
 * (shore power, crane power, equipment charging), and, for every other
 * meter, its billed kWh for that month spread over the month's hours.
 * Lighting is spread over the night hours only. Everything here is an
 * estimate and the graph says so.
 *
 * Pure: no Cesium, no DOM.
 */
import { STEPS_PER_DAY, STEPS_PER_HOUR } from '../touCalendar.js';
import { END_USES } from './registry.js';

const DT = 1 / STEPS_PER_HOUR;
/** Hours (0-23) when yard and wharf lighting is taken to be on. */
const isNight = (hour) => hour >= 18 || hour < 6;
const NIGHT_HOURS = 12;

/** Billed kWh for a month of the year, from the latest year that has it. */
export function billedMonthKwh(meter, month) {
  const suffix = `-${String(month).padStart(2, '0')}`;
  const keys = Object.keys(meter.monthlyKwh ?? {})
    .filter((key) => key.endsWith(suffix))
    .sort();
  return keys.length ? meter.monthlyKwh[keys.at(-1)] : 0;
}

const daysIn = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * One meter's modeled kW at a step, by the same rules as the day graph:
 * the scenario's load where it models the meter, else the month's billed
 * kWh spread evenly (lighting over the night hours only).
 */
export function meterKwAt(meter, allocation, result, step) {
  if (meter.carries.length)
    return allocation?.byMeter.get(meter.id)?.series[step] ?? 0;
  const { month, hour } = result.calendar[step];
  const kwh = billedMonthKwh(meter, month);
  if (!kwh) return 0;
  const lighting = meter.endUse === 'lighting';
  if (lighting && !isNight(hour)) return 0;
  return (
    kwh / (daysIn(result.scenario.year, month) * (lighting ? NIGHT_HOURS : 24))
  );
}

/**
 * @param {object} registry meter registry
 * @param {object} allocation from allocateScenario
 * @param {object} result from runScenario
 * @param {number} step current step of the year
 * @returns {{ dayStart, stepOfDay, modeledOnly, series: {endUse, label,
 *   color, kw: Float64Array, modeled: boolean}[], totalKw: Float64Array,
 *   nowKw, peakKw, kwhSoFar, kwhDay }}
 */
export function dayProfile(registry, allocation, result, step) {
  const dayStart = step - (step % STEPS_PER_DAY);
  const stepOfDay = step - dayStart;
  const { month } = result.calendar[step];
  const days = daysIn(result.scenario.year, month);
  const byUse = new Map();
  const seriesFor = (endUse, modeled) => {
    if (!byUse.has(endUse))
      byUse.set(endUse, { kw: new Float64Array(STEPS_PER_DAY), modeled });
    return byUse.get(endUse);
  };
  for (const meter of registry.meters) {
    const scenario = allocation?.byMeter.get(meter.id);
    if (meter.carries.length) {
      // The scenario models this meter; its bills would count it twice.
      if (!scenario) continue;
      const row = seriesFor(meter.endUse, true);
      for (let i = 0; i < STEPS_PER_DAY; i += 1)
        row.kw[i] += scenario.series[dayStart + i] ?? 0;
      continue;
    }
    const kwh = billedMonthKwh(meter, month);
    if (!kwh) continue;
    const row = seriesFor(meter.endUse, false);
    const lighting = meter.endUse === 'lighting';
    const kw = kwh / (days * (lighting ? NIGHT_HOURS : 24));
    for (let i = 0; i < STEPS_PER_DAY; i += 1)
      if (!lighting || isNight(Math.floor(i / STEPS_PER_HOUR))) row.kw[i] += kw;
  }
  const totalKw = new Float64Array(STEPS_PER_DAY);
  const series = Object.keys(END_USES)
    .filter((id) => byUse.has(id))
    .map((id) => {
      const row = byUse.get(id);
      row.kw.forEach((kw, i) => {
        totalKw[i] += kw;
      });
      return { endUse: id, ...END_USES[id], ...row };
    })
    // Steady loads at the bottom of the stack, changing ones on top.
    .sort((a, b) => Number(a.modeled) - Number(b.modeled));
  let kwhSoFar = 0;
  let kwhDay = 0;
  let peakKw = 0;
  totalKw.forEach((kw, i) => {
    kwhDay += kw * DT;
    if (i <= stepOfDay) kwhSoFar += kw * DT;
    if (kw > peakKw) peakKw = kw;
  });
  return {
    dayStart,
    stepOfDay,
    series,
    totalKw,
    nowKw: totalKw[stepOfDay],
    peakKw,
    kwhSoFar,
    kwhDay,
    sample: registry.sample,
  };
}
