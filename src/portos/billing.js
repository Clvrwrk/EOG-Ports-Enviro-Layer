/**
 * Monthly utility bill from a 15-minute kW series and a tariff (tariffs.js).
 *
 * Demand is the 15-minute average kW, which is how SCE meters it. Lines:
 * energy by TOU period, customer charge, facilities-related demand (FRD,
 * monthly max at any time) and time-related demand (TRD, monthly max inside
 * each window on non-holiday weekdays).
 */
import { STEPS_PER_HOUR, touPeriod } from './touCalendar.js';
import { energyRate } from './tariffs.js';

const DT = 1 / STEPS_PER_HOUR;

/** TOU season and period for every step of a calendar under a tariff. */
export function stepPeriods(tariff, calendar) {
  const seasons = new Array(calendar.length);
  const periods = new Array(calendar.length);
  for (const [i, step] of calendar.entries()) {
    const { season, period } = touPeriod(tariff, step);
    seasons[i] = season;
    periods[i] = period;
  }
  return { seasons, periods };
}

/**
 * Bill every month in the series.
 * @param {Float64Array} kw meter kW per step
 * @param {object} tariff
 * @param {object[]} calendar from yearSteps()
 * @param {{ includeDeferredDemand?: boolean }} [options] bill TOU-EV demand
 *   charges that are defined but not yet authorized, as a sensitivity case
 */
export function billByMonth(kw, tariff, calendar, options = {}) {
  const { seasons, periods } = stepPeriods(tariff, calendar);
  const demand = tariff.demand.billed
    ? tariff.demand
    : options.includeDeferredDemand
      ? tariff.demand.deferred
      : null;
  const months = [];
  for (let m = 1; m <= 12; m += 1) {
    months.push({
      month: m,
      kwh: 0,
      kwhByPeriod: {},
      energyCost: 0,
      maxKw: 0,
      trdKw: {},
      lines: [],
      total: 0,
    });
  }
  for (const [i, step] of calendar.entries()) {
    const bill = months[step.month - 1];
    const value = kw[i];
    const kwh = value * DT;
    const period = periods[i];
    bill.season = seasons[i];
    bill.kwh += kwh;
    bill.kwhByPeriod[period] = (bill.kwhByPeriod[period] || 0) + kwh;
    bill.energyCost += kwh * energyRate(tariff, seasons[i], period);
    if (value > bill.maxKw) bill.maxKw = value;
    if (demand && step.weekday) {
      for (const window of demand.timeRelated || []) {
        if (window.season !== seasons[i] || window.period !== period) continue;
        const key = `${window.season}-${window.period}`;
        if (value > (bill.trdKw[key] || 0)) bill.trdKw[key] = value;
      }
    }
  }
  for (const bill of months) {
    bill.lines.push({ label: 'Energy', amount: bill.energyCost });
    if (tariff.customerChargePerMonth)
      bill.lines.push({
        label: 'Customer charge',
        amount: tariff.customerChargePerMonth,
      });
    if (demand?.facilitiesPerKw)
      bill.lines.push({
        label: 'Facilities-related demand',
        kw: bill.maxKw,
        amount: bill.maxKw * demand.facilitiesPerKw,
      });
    for (const window of demand?.timeRelated || []) {
      if (window.season !== bill.season) continue;
      const peak = bill.trdKw[`${window.season}-${window.period}`] || 0;
      bill.lines.push({
        label: `Time-related demand (${window.season} ${window.period}-peak)`,
        kw: peak,
        amount: peak * window.perKw,
      });
    }
    bill.demandCost = bill.lines
      .filter((line) => line.label.includes('demand'))
      .reduce((sum, line) => sum + line.amount, 0);
    bill.total = bill.lines.reduce((sum, line) => sum + line.amount, 0);
  }
  return months;
}
