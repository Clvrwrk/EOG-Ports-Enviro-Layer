/**
 * Roll a 15-minute series up to days, weeks, months, quarters and the year.
 * Energy sums, demand takes the max, so a weekly row says both how much was
 * used and how sharp the worst 15 minutes were.
 */
import { STEPS_PER_HOUR } from './touCalendar.js';

const DT = 1 / STEPS_PER_HOUR;

const KEYS = {
  day: (step) => step.dayIndex,
  week: (step) => Math.floor(step.dayIndex / 7),
  month: (step) => step.month - 1,
  quarter: (step) => Math.floor((step.month - 1) / 3),
  year: () => 0,
};

/** Rollup grains the scenario page offers. */
export const GRAINS = Object.freeze(Object.keys(KEYS));

/**
 * @param {object[]} calendar from yearSteps()
 * @param {{ kw: ArrayLike<number>, dieselGallons?: ArrayLike<number> }} series
 * @param {keyof KEYS} grain
 */
export function rollup(calendar, { kw, dieselGallons }, grain) {
  const key = KEYS[grain];
  if (!key) throw new Error(`Unknown rollup grain: ${grain}`);
  const rows = [];
  for (const [i, step] of calendar.entries()) {
    const k = key(step);
    const row = (rows[k] ||= {
      index: k,
      firstStep: i,
      kwh: 0,
      peakKw: 0,
      dieselGallons: 0,
    });
    row.kwh += kw[i] * DT;
    if (kw[i] > row.peakKw) row.peakKw = kw[i];
    if (dieselGallons) row.dieselGallons += dieselGallons[i];
    row.lastStep = i;
  }
  return rows.filter(Boolean);
}
