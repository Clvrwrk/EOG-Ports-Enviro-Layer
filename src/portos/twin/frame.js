/**
 * Turns a scenario run into what the 3D twin shows at one moment: which
 * cranes and UTRs are working on grid power or diesel, which UTRs are on
 * chargers, whether a reefer ship is at the berth, and the data card for
 * any clicked model. Also maps the panel's decisions to a scenario and
 * compares a scenario's year against the baseline.
 *
 * Pure: no Cesium, no DOM.
 */
import { DEFAULT_SCENARIO } from '../scenario.js';
import { FACTORS, SPECS } from '../hueneme.js';
import { STEPS_PER_HOUR } from '../touCalendar.js';

const DT = 1 / STEPS_PER_HOUR;
const REEFER_BERTHS = new Set(['berth-1', 'berth-2', 'berth-3']);
const UTR_UNITS = 27;
const CRANE_UNITS = 4;

/** The panel's decisions as first shown: the fleet plan, as today. */
export const DEFAULT_DECISIONS = Object.freeze({
  year: 2026,
  utrs: 'plan', // 'plan' | 'diesel' | 'electric'
  cranes: 'plan', // 'plan' | 'plug-in' | 'diesel'
  charging: 'asap', // key of CHARGING_STRATEGIES
  battery: 'none', // 'none' | '1mwh'
  shorePower: false,
});

/** Scenario input for a set of panel decisions. */
export function scenarioFromDecisions(decisions = {}) {
  const d = { ...DEFAULT_DECISIONS, ...decisions };
  const fleet = {};
  if (d.utrs === 'diesel') fleet.utr = { diesel: UTR_UNITS, electric: 0 };
  if (d.utrs === 'electric')
    fleet.utr = { diesel: 0, electric: UTR_UNITS, chargers: UTR_UNITS };
  if (d.cranes === 'diesel')
    fleet.harbor_crane = { diesel: CRANE_UNITS, electric: 0 };
  if (d.cranes === 'plug-in')
    fleet.harbor_crane = { diesel: 0, electric: CRANE_UNITS };
  return {
    ...DEFAULT_SCENARIO,
    name: 'Twin scenario',
    year: d.year,
    strategy: d.charging,
    fleet,
    shorePower: Boolean(d.shorePower),
    battery:
      d.battery === '1mwh'
        ? { kwh: 1000, kw: 500, roundTripEfficiency: 0.88, thresholdKw: 'auto' }
        : null,
  };
}

/** Steps where a reefer call is at the berth, as [start, end) pairs. */
export function reeferCalls(result) {
  return result.calls
    .filter(
      (call) => REEFER_BERTHS.has(call.berthId) && call.type === 'Refrigerated',
    )
    .sort((a, b) => a.start - b.start);
}

/**
 * Start step of the next reefer call after `step` (or the previous one
 * before it when `direction` is negative); `step` itself when there is none.
 */
export function nextCallStart(result, step, direction = 1) {
  const calls = reeferCalls(result);
  const pick =
    direction > 0
      ? calls.find((call) => call.start > step)
      : [...calls].reverse().find((call) => call.start < step);
  return pick ? pick.start : step;
}

function chargingUnits(series, spec, step, efficiency) {
  if (!spec.chargeKw) return 0;
  return Math.ceil((series.gridKw[step] * efficiency) / spec.chargeKw - 1e-6);
}

/**
 * Every unit's state at one step. Units are listed electric first, then
 * diesel, so unit ids stay stable while the scenario changes the mix.
 */
function fleetUnits(result, specId, step) {
  const fleet = result.fleets[specId];
  if (!fleet) return [];
  const spec = SPECS[specId];
  const s = fleet.series;
  const electricWorking = s.electricWorking[step];
  const dieselWorking = s.dieselWorking[step];
  const charging = Math.min(
    fleet.electric - electricWorking,
    chargingUnits(s, spec, step, result.scenario.chargerEfficiency),
  );
  const units = [];
  for (let i = 0; i < fleet.electric; i += 1) {
    let state = 'parked';
    if (i < electricWorking) state = 'working';
    else if (i < electricWorking + charging) state = 'charging';
    units.push({
      id: `${specId}-e${i + 1}`,
      specId,
      powertrain: spec.gridTethered ? 'plug-in' : 'electric',
      state,
      meanSoc: s.meanSoc[step],
    });
  }
  for (let i = 0; i < fleet.diesel; i += 1)
    units.push({
      id: `${specId}-d${i + 1}`,
      specId,
      powertrain: 'diesel',
      state: i < dieselWorking ? 'working' : 'parked',
    });
  return units;
}

/** What the twin shows at one 15-minute step. */
export function twinFrame(result, step) {
  const at = Math.max(0, Math.min(result.siteKw.length - 1, Math.floor(step)));
  const ship =
    reeferCalls(result).find((call) => call.start <= at && at < call.end) ??
    null;
  const gallonsPerHour = result.dieselGallons[at] / DT;
  return {
    step: at,
    time: result.calendar[at],
    period: result.periods[at],
    ship,
    shorePowerKw: ship && result.shoreKw ? result.shoreKw[at] : 0,
    cranes: fleetUnits(result, 'harbor_crane', at),
    utrs: fleetUnits(result, 'utr', at),
    reachStackers: fleetUnits(result, 'reach_stacker', at),
    siteKw: result.siteKw[at],
    meterKw: result.meterKw[at],
    batteryKw: result.battery ? result.battery.batteryKw[at] : 0,
    dieselGallonsPerHour: gallonsPerHour,
    co2KgPerHour: gallonsPerHour * FACTORS.dieselKgCo2PerGallon,
  };
}

const n0 = (value) => Math.round(value).toLocaleString('en-US');
const n1 = (value) =>
  value.toLocaleString('en-US', {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  });
const pct = (value) => `${Math.round(value * 100)}%`;
const STATE_TEXT = {
  working: 'Working',
  charging: 'Charging',
  parked: 'Parked',
};

/** Title and rows for the data card of one clicked unit. */
export function unitCard(frame, unit, result) {
  const spec = SPECS[unit.specId];
  const kgPerGallon = FACTORS.dieselKgCo2PerGallon;
  const rows = [
    ['Status', STATE_TEXT[unit.state] ?? unit.state],
    ['Powertrain', unit.powertrain],
  ];
  if (unit.powertrain === 'diesel') {
    rows.push(['Fuel when working', `${n1(spec.dieselGph)} gal/hr`]);
    rows.push([
      'CO2 when working',
      `${n0(spec.dieselGph * kgPerGallon)} kg/hr`,
    ]);
    if (unit.state === 'working')
      rows.push([
        'Now',
        `${n1(spec.dieselGph)} gal/hr, ${n0(spec.dieselGph * kgPerGallon)} kg CO2/hr`,
      ]);
  } else {
    rows.push(['Energy when working', `${n1(spec.kwhPerHour)} kWh/hr`]);
    if (spec.gridTethered) {
      rows.push([
        'Now drawing',
        unit.state === 'working'
          ? `${n1(spec.kwhPerHour)} kW from the grid`
          : '0 kW',
      ]);
    } else {
      rows.push(['Battery', `${n0(spec.batteryKwh)} kWh`]);
      rows.push(['Charge rate', `${n0(spec.chargeKw)} kW`]);
      rows.push([
        'Fleet state of charge',
        `${pct(unit.meanSoc ?? 0)} (fleet average)`,
      ]);
      rows.push([
        'Now drawing',
        unit.state === 'charging'
          ? `${n0(spec.chargeKw / result.scenario.chargerEfficiency)} kW at the charger`
          : '0 kW',
      ]);
    }
  }
  const fleet = result.fleets[unit.specId];
  if (fleet)
    rows.push([
      'Fleet this year',
      `${fleet.electric} electric, ${fleet.diesel} diesel · ${n0(fleet.kwh)} kWh · ${n0(fleet.dieselGallons)} gal`,
    ]);
  rows.push(['Source', spec.model ?? 'POH utilization workbook']);
  return { title: `${spec.label} · ${unit.id}`, rows };
}

/** Data card for a charger stall. */
export function chargerCard(frame, index, result) {
  const spec = SPECS.utr;
  const charging = frame.utrs.filter((u) => u.state === 'charging');
  const unit = charging[index] ?? null;
  return {
    title: `UTR charger ${index + 1}`,
    rows: [
      ['Rating', `${n0(spec.chargeKw)} kW`],
      ['Now', unit ? `Charging ${unit.id}` : 'Free'],
      [
        'Drawing',
        unit
          ? `${n0(spec.chargeKw / result.scenario.chargerEfficiency)} kW`
          : '0 kW',
      ],
      ['Rate period', frame.period],
      ['Meter', 'meter-che (placeholder until real meters are entered)'],
    ],
  };
}

/** Data card for the ship at the berth. */
export function shipCard(frame, result) {
  const call = frame.ship;
  if (!call) return { title: 'No ship at the berth', rows: [] };
  const when = (step) => {
    const t = result.calendar[step];
    if (!t) return 'after year end';
    return `${t.month}/${t.day} ${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`;
  };
  return {
    title: `${call.type} call ${call.id}`,
    rows: [
      ['Cargo', call.cargo],
      ['Berth', call.berthId],
      ['Arrives', when(call.start)],
      ['Departs', when(call.end)],
      ['Crew', call.template],
      [
        'Shore power',
        result.scenario.shorePower
          ? `${n0(frame.shorePowerKw)} kW now`
          : 'Off (ship runs its engines)',
      ],
      ['Schedule', 'Synthetic, from the workbook call profile'],
    ],
  };
}

/** One scenario year against the baseline, as scoreboard rows. */
export function scoreboard(result, baseline) {
  const t = result.totals;
  const b = baseline.totals;
  const spend = (x) => x.electricityCost + x.dieselCost;
  return [
    {
      id: 'spend',
      label: 'Energy spend / yr',
      value: spend(t),
      base: spend(b),
      unit: '$',
    },
    {
      id: 'electric',
      label: 'Electricity bill / yr',
      value: t.electricityCost,
      base: b.electricityCost,
      unit: '$',
    },
    {
      id: 'diesel',
      label: 'Diesel / yr',
      value: t.dieselCost,
      base: b.dieselCost,
      unit: '$',
    },
    {
      id: 'peak',
      label: 'Peak demand',
      value: t.peakKw,
      base: b.peakKw,
      unit: 'kW',
    },
    {
      id: 'co2',
      label: 'Equipment CO2 / yr',
      value: t.co2Tonnes,
      base: b.co2Tonnes,
      unit: 't',
    },
  ];
}
