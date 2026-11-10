/**
 * Delivered energy: power the port takes from somewhere other than the
 * utility meter (a PPA, a microgrid, on-site solar, a fuel cell, energy as a
 * service). It covers a share of the site's yearly load and lowers what the
 * meter sees, so it moves both the energy and the demand lines of the bill.
 *
 * Profiles say when the supply arrives:
 * - share: a fixed fraction of the load in every 15 minutes
 * - baseload: a constant kW around the clock
 * - solar: daylight only, stronger in summer
 * - peak: the 4-9 p.m. window only
 * Supply never exceeds the load in a step (no export); what would have
 * exceeded it is reported as curtailed.
 */
import { STEPS_PER_HOUR } from './touCalendar.js';

const DT = 1 / STEPS_PER_HOUR;

export const DELIVERED_PROFILES = Object.freeze({
  share: 'Same share of load all the time',
  baseload: 'Constant power, around the clock',
  solar: 'Solar, daylight hours',
  peak: 'Evening peak only (4-9 p.m.)',
});

/** Relative supply shape for one step, before scaling. */
function shape(profile, step) {
  const hour = step.hour + step.minute / 60 + DT / 2;
  if (profile === 'baseload') return 1;
  if (profile === 'peak') return hour >= 16 && hour < 21 ? 1 : 0;
  if (profile === 'solar') {
    if (hour <= 6 || hour >= 19) return 0;
    const day = Math.sin((Math.PI * (hour - 6)) / 13);
    // Roughly 40% more midday sun in June than in December (a planning shape).
    const season =
      0.85 + 0.15 * Math.cos((2 * Math.PI * (step.month - 6.5)) / 12);
    return day * season;
  }
  return 0;
}

/**
 * @param {Float64Array} siteKw load before delivered energy
 * @param {object[]} calendar from yearSteps()
 * @param {{ sharePct: number, profile: string, pricePerKwh: number }} options
 * @returns {{ kw: Float64Array, kwh: number, targetKwh: number,
 *   curtailedKwh: number, cost: number }}
 */
export function deliveredSupply(siteKw, calendar, options) {
  const n = siteKw.length;
  const kw = new Float64Array(n);
  const share =
    Math.min(100, Math.max(0, Number(options?.sharePct) || 0)) / 100;
  const price = Math.max(0, Number(options?.pricePerKwh) || 0);
  let loadKwh = 0;
  for (let i = 0; i < n; i += 1) loadKwh += siteKw[i] * DT;
  const targetKwh = loadKwh * share;
  if (!(targetKwh > 0))
    return { kw, kwh: 0, targetKwh: 0, curtailedKwh: 0, cost: 0 };

  if (!options.profile || options.profile === 'share') {
    for (let i = 0; i < n; i += 1) kw[i] = siteKw[i] * share;
    return {
      kw,
      kwh: targetKwh,
      targetKwh,
      curtailedKwh: 0,
      cost: targetKwh * price,
    };
  }

  const raw = new Float64Array(n);
  let rawKwh = 0;
  for (let i = 0; i < n; i += 1) {
    raw[i] = shape(options.profile, calendar[i]);
    rawKwh += raw[i] * DT;
  }
  if (!(rawKwh > 0)) return { kw, kwh: 0, targetKwh, curtailedKwh: 0, cost: 0 };
  // Size the plant so its yearly output is the target share. Output that
  // lands when the load is lower is curtailed, as a real plant without export
  // would be, so the delivered share can come in under the target.
  const scale = targetKwh / rawKwh;
  let kwh = 0;
  let curtailedKwh = 0;
  for (let i = 0; i < n; i += 1) {
    const offered = raw[i] * scale;
    const used = Math.min(offered, siteKw[i]);
    kw[i] = used;
    kwh += used * DT;
    curtailedKwh += (offered - used) * DT;
  }
  return { kw, kwh, targetKwh, curtailedKwh, cost: kwh * price };
}
