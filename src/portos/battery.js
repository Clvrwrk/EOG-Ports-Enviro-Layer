/**
 * Onsite (mobile) battery dispatch for demand-charge mitigation.
 *
 * Peak shaving with a kW threshold: whenever site load exceeds the threshold
 * the battery discharges to hold the meter at the threshold (within its kW
 * and energy limits). It recharges below the threshold, only in the periods
 * listed in `chargePeriods`, without pushing the meter above the threshold.
 */
import { STEPS_PER_HOUR } from './touCalendar.js';

const DT = 1 / STEPS_PER_HOUR;

/**
 * @param {Float64Array} load site load in kW per step
 * @param {object} battery { kwh, kw, roundTripEfficiency, thresholdKw, chargePeriods }
 * @param {string[]} periods TOU period per step
 * @returns {{ netKw: Float64Array, batteryKw: Float64Array, soc: Float64Array, shavedKwh: number }}
 *   batteryKw is positive when discharging to the site, negative when charging.
 */
export function dispatchBattery(load, battery, periods) {
  const steps = load.length;
  const netKw = new Float64Array(load);
  const batteryKw = new Float64Array(steps);
  const soc = new Float64Array(steps);
  if (!battery || !(battery.kwh > 0) || !(battery.kw > 0))
    return { netKw, batteryKw, soc, shavedKwh: 0 };
  const efficiency = Math.sqrt(battery.roundTripEfficiency ?? 0.88);
  const chargePeriods = new Set(battery.chargePeriods ?? ['off', 'super_off']);
  const threshold = battery.thresholdKw ?? 0;
  let stored = battery.kwh * (battery.initialSoc ?? 1);
  let shavedKwh = 0;
  for (let step = 0; step < steps; step += 1) {
    const excess = load[step] - threshold;
    if (excess > 0) {
      const kw = Math.min(excess, battery.kw, (stored * efficiency) / DT);
      stored -= (kw * DT) / efficiency;
      batteryKw[step] = kw;
      shavedKwh += kw * DT;
    } else if (chargePeriods.has(periods[step]) && stored < battery.kwh) {
      const kw = Math.min(
        -excess,
        battery.kw,
        (battery.kwh - stored) / efficiency / DT,
      );
      stored += kw * DT * efficiency;
      batteryKw[step] = -kw;
    }
    netKw[step] = load[step] - batteryKw[step];
    soc[step] = stored / battery.kwh;
  }
  return { netKw, batteryKw, soc, shavedKwh };
}
