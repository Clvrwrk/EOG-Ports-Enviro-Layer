/**
 * Fifteen-minute fleet simulation for one equipment spec (e.g. all UTRs).
 *
 * Each step the crew demand says how many units must work. Battery-electric
 * units with enough charge work first (units already on the job keep
 * working; new ones join highest state of charge first), then
 * diesel units cover the rest; anything still uncovered is reported as unmet
 * unit-hours. Idle electric units charge on the available chargers when the
 * charging strategy allows it. A grid-tethered spec (a plug-in harbor crane)
 * has no battery: its electric units draw from the meter while they work.
 */
import { STEPS_PER_HOUR } from './touCalendar.js';

const DT = 1 / STEPS_PER_HOUR;

/**
 * Charging strategies.
 * - asap: charge whenever idle (the workbook's rule: breaks and idle time).
 * - avoid-peak: skip 4-9 p.m. windows unless a unit is below its reserve.
 * - off-peak-only: charge only in off-peak and super-off-peak periods unless
 *   a unit is below its reserve.
 */
export const CHARGING_STRATEGIES = Object.freeze({
  asap: { label: 'Charge whenever idle (workbook rule)', allowed: () => true },
  'avoid-peak': {
    label: 'Avoid the 4-9 p.m. peak',
    allowed: (period) => period !== 'on' && period !== 'mid',
  },
  'off-peak-only': {
    label: 'Off-peak and super-off-peak only',
    allowed: (period) => period === 'off' || period === 'super_off',
  },
});

/**
 * Run the fleet for every step.
 * @param {object} input
 * @param {Uint16Array} input.demand units that must work per step
 * @param {object} input.spec kwhPerHour, batteryKwh, chargeKw, dieselGph
 * @param {number} input.electric battery-electric units
 * @param {number} input.diesel diesel units
 * @param {number} [input.chargers] charger ports (default one per BEV)
 * @param {string[]} input.periods TOU period per step
 * @param {string} [input.strategy] key of CHARGING_STRATEGIES
 * @param {number} [input.reserve] state-of-charge fraction that always charges
 * @param {number} [input.chargerEfficiency] battery kWh per grid kWh
 * @param {number} [input.initialSoc] starting state-of-charge fraction
 */
export function simulateFleet({
  demand,
  spec,
  electric,
  diesel,
  chargers = electric,
  periods,
  strategy = 'asap',
  reserve = 0.3,
  chargerEfficiency = 0.92,
  initialSoc = 1,
}) {
  const rule = CHARGING_STRATEGIES[strategy];
  if (!rule) throw new Error(`Unknown charging strategy: ${strategy}`);
  if (spec.gridTethered)
    return simulateTethered({ demand, spec, electric, diesel });
  const steps = demand.length;
  const workKwh = spec.kwhPerHour * DT;
  const capacity = spec.batteryKwh;
  const soc = new Float64Array(electric).fill(capacity * initialSoc);
  const out = {
    gridKw: new Float64Array(steps),
    dieselGallons: new Float64Array(steps),
    electricWorking: new Uint16Array(steps),
    dieselWorking: new Uint16Array(steps),
    unmet: new Uint16Array(steps),
    meanSoc: new Float64Array(steps),
  };
  const order = Array.from({ length: electric }, (_, i) => i);
  const working = new Uint8Array(electric);
  // A unit that runs flat goes to the charger and stays there until it is
  // back above the reserve, instead of hopping on and off every 15 minutes.
  const recovering = new Uint8Array(electric);
  for (let step = 0; step < steps; step += 1) {
    const need = demand[step];
    // Units stay on the job between steps (a driver keeps the same tractor
    // until the crew stands down); new units join highest charge first.
    order.sort((a, b) => working[b] - working[a] || soc[b] - soc[a]);
    let electricWorking = 0;
    for (const unit of order) {
      if (soc[unit] < workKwh) recovering[unit] = 1;
      else if (recovering[unit] && soc[unit] >= capacity * reserve)
        recovering[unit] = 0;
      if (electricWorking < need && !recovering[unit]) {
        soc[unit] -= workKwh;
        working[unit] = 1;
        electricWorking += 1;
      } else working[unit] = 0;
    }
    const remaining = need - electricWorking;
    const dieselWorking = Math.min(remaining, diesel);
    out.electricWorking[step] = electricWorking;
    out.dieselWorking[step] = dieselWorking;
    out.unmet[step] = remaining - dieselWorking;
    out.dieselGallons[step] = dieselWorking * spec.dieselGph * DT;

    // Charge idle units, lowest state of charge first, on free chargers.
    let ports = chargers;
    let batteryKwh = 0;
    const allowed = rule.allowed(periods[step]);
    const idle = order
      .filter((unit) => !working[unit])
      .sort((a, b) => soc[a] - soc[b]);
    for (const unit of idle) {
      if (ports <= 0) break;
      const headroom = capacity - soc[unit];
      if (headroom <= 1e-9) continue;
      if (!allowed && !recovering[unit] && soc[unit] >= capacity * reserve)
        continue;
      const energy = Math.min(spec.chargeKw * DT, headroom);
      soc[unit] += energy;
      batteryKwh += energy;
      ports -= 1;
    }
    out.gridKw[step] = batteryKwh / chargerEfficiency / DT;
    let total = 0;
    for (let i = 0; i < electric; i += 1) total += soc[i];
    out.meanSoc[step] = electric ? total / (electric * capacity) : 0;
  }
  return out;
}

/** Grid-tethered units: electric units work first and draw power directly. */
function simulateTethered({ demand, spec, electric, diesel }) {
  const steps = demand.length;
  const out = {
    gridKw: new Float64Array(steps),
    dieselGallons: new Float64Array(steps),
    electricWorking: new Uint16Array(steps),
    dieselWorking: new Uint16Array(steps),
    unmet: new Uint16Array(steps),
    meanSoc: new Float64Array(steps),
  };
  for (let step = 0; step < steps; step += 1) {
    const need = demand[step];
    const electricWorking = Math.min(need, electric);
    const dieselWorking = Math.min(need - electricWorking, diesel);
    out.electricWorking[step] = electricWorking;
    out.dieselWorking[step] = dieselWorking;
    out.unmet[step] = need - electricWorking - dieselWorking;
    out.gridKw[step] = electricWorking * spec.kwhPerHour;
    out.dieselGallons[step] = dieselWorking * spec.dieselGph * DT;
  }
  return out;
}
