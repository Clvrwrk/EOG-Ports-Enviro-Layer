/**
 * Turns a scenario run into what the 3D twin shows at one moment: which
 * cranes and UTRs are working on grid power or diesel, which UTRs are on
 * chargers, whether a reefer ship is at the berth, and the data card for
 * any clicked model. Also maps the panel's decisions to a scenario and
 * compares a scenario's year against the baseline.
 *
 * Pure: no Cesium, no DOM.
 */
import { STAX, berthStateAt } from '../atBerth.js';
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
  stax: true,
});

const BATTERY_1MWH = Object.freeze({
  kwh: 1000,
  kw: 500,
  roundTripEfficiency: 0.88,
  thresholdKw: 'auto',
});

/**
 * A scenario with some panel decisions applied on top. Anything the panel
 * has no control for (other equipment, the rate, call volume...) is kept,
 * so a scenario made in the builder survives a toggle in the twin.
 */
export function applyDecisions(scenario, patch = {}) {
  const next = { ...scenario, fleet: { ...scenario.fleet } };
  if ('year' in patch) next.year = patch.year;
  if ('charging' in patch) next.strategy = patch.charging;
  if ('shorePower' in patch) next.shorePower = Boolean(patch.shorePower);
  if ('stax' in patch) next.stax = Boolean(patch.stax);
  if (patch.utrs === 'plan') delete next.fleet.utr;
  if (patch.utrs === 'diesel')
    next.fleet.utr = { diesel: UTR_UNITS, electric: 0, chargers: 0 };
  if (patch.utrs === 'electric')
    next.fleet.utr = { diesel: 0, electric: UTR_UNITS, chargers: UTR_UNITS };
  if (patch.cranes === 'plan') delete next.fleet.harbor_crane;
  if (patch.cranes === 'diesel')
    next.fleet.harbor_crane = { diesel: CRANE_UNITS, electric: 0, chargers: 0 };
  if (patch.cranes === 'plug-in')
    next.fleet.harbor_crane = {
      diesel: 0,
      electric: CRANE_UNITS,
      chargers: CRANE_UNITS,
    };
  if (patch.battery === 'none') next.battery = null;
  if (patch.battery === '1mwh') next.battery = { ...BATTERY_1MWH };
  return next;
}

/** Scenario input for a set of panel decisions. */
export function scenarioFromDecisions(decisions = {}) {
  return applyDecisions(
    { ...DEFAULT_SCENARIO, name: 'Twin scenario', fleet: {}, battery: null },
    { ...DEFAULT_DECISIONS, ...decisions },
  );
}

/**
 * What the panel's controls should show for a scenario; 'custom' where the
 * scenario holds something the control has no option for.
 */
export function decisionsFromScenario(scenario) {
  const mix = (entry, units, allElectric) => {
    if (!entry) return 'plan';
    if (entry.electric === 0 && entry.diesel === units) return 'diesel';
    if (entry.diesel === 0 && entry.electric === units) return allElectric;
    return 'custom';
  };
  const b = scenario.battery;
  return {
    year: scenario.year,
    utrs: mix(scenario.fleet?.utr, UTR_UNITS, 'electric'),
    cranes: mix(scenario.fleet?.harbor_crane, CRANE_UNITS, 'plug-in'),
    charging: scenario.strategy,
    battery: !b
      ? 'none'
      : b.kwh === BATTERY_1MWH.kwh && b.kw === BATTERY_1MWH.kw
        ? '1mwh'
        : 'custom',
    shorePower: Boolean(scenario.shorePower),
    stax: scenario.stax !== false,
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
  const berth =
    ship && result.atBerth
      ? berthStateAt(result.atBerth.current, ship.berthId, at)
      : null;
  return {
    step: at,
    time: result.calendar[at],
    period: result.periods[at],
    ship,
    shorePowerKw: ship && result.shoreKw ? result.shoreKw[at] : 0,
    // How the ship's exhaust is handled now: 'shore-power', 'stax' or
    // 'none' (engines to air, including hook-up and release hours).
    exhaust: berth?.controlled ? berth.call.method : ship ? 'none' : null,
    berthCall: berth?.call ?? null,
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

const EXHAUST_TEXT = {
  'shore-power': 'Engines off, on shore power',
  stax: 'Captured by the STAX barge',
  none: 'Engines exhausting to air',
};

/** At-berth exhaust and emission rows for the ship card. */
function atBerthRows(frame, result) {
  const call = frame.berthCall;
  if (!call) return [];
  const hours = (call.end - call.start) * DT;
  const auxNoxKgHr =
    (result.atBerth.current.factors.aux.nox * call.auxKw) / 1000;
  const staxNoxKgHr =
    (result.atBerth.current.factors.auxStax.nox * call.auxKw) / 1000;
  const nowKgHr =
    frame.exhaust === 'shore-power'
      ? 0
      : frame.exhaust === 'stax'
        ? staxNoxKgHr
        : auxNoxKgHr;
  const rows = [
    ['Exhaust now', EXHAUST_TEXT[frame.exhaust] ?? 'Engines exhausting to air'],
    [
      'Hotel load',
      `${n0(call.auxKw)} kW engines + ${n0(call.boilerKw)} kW boiler`,
    ],
    ['Engine NOx now', `${n1(nowKgHr)} kg/hr`],
    [
      'This call',
      `${n1(call.grams.nox / 1000)} kg NOx, ${n1(call.grams.dpm)} g diesel PM over ${n0(hours)} h`,
    ],
  ];
  if (call.method === 'stax')
    rows.push([
      'STAX',
      `${call.bargeId}, ${n0((call.controlEnd - call.controlStart) * DT)} h treated; ${Math.round(STAX.capture.nox * 100)}% NOx and ${Math.round(STAX.capture.pm * 100)}% PM captured`,
    ]);
  else if (result.scenario.stax && call.method === 'none')
    rows.push(['STAX', 'No barge free, or not a STAX berth or ship type']);
  return rows;
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
        frame.exhaust === 'shore-power'
          ? `${n0(frame.shorePowerKw)} kW now`
          : result.scenario.shorePower
            ? 'Not working at this berth this year'
            : 'Off',
      ],
      ...atBerthRows(frame, result),
      ['Schedule', 'Synthetic, from the workbook call profile'],
    ],
  };
}

/** Data card for the STAX barge alongside the ship. */
export function staxCard(frame, result) {
  const a = result.atBerth;
  const t = a.current.totals;
  const call = frame.berthCall;
  return {
    title: `STAX emissions capture barge${call?.bargeId ? ` · ${call.bargeId}` : ''}`,
    rows: [
      [
        'Treating',
        call ? `${call.type} call ${call.id} at ${call.berthId}` : 'No ship',
      ],
      [
        'Captures',
        `${Math.round(STAX.capture.pm * 100)}% of PM, ${Math.round(STAX.capture.nox * 100)}% of NOx from the auxiliary engines (CO2 is not captured)`,
      ],
      [
        'Own power',
        `Up to ${n0(STAX.bargeGeneratorKw)} kW generator on renewable diesel`,
      ],
      [
        'This year',
        `${t.calls.stax} calls, ${n0(t.controlledHours.stax)} h treated, ${n0(t.bargeGallons)} gal renewable diesel`,
      ],
      [
        'Saves this year',
        `${n1(a.staxSavedTonnes.nox)} t NOx, ${n0(a.staxSavedTonnes.dpm * 1000)} kg diesel PM`,
      ],
      [
        'Barges',
        `${result.scenario.staxBarges} (one per terminal at Hueneme today)`,
      ],
      ['Source', 'CARB EO G-24-054; Port of Hueneme, July 2025'],
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
    {
      id: 'shipNox',
      label: 'Ship NOx at berth / yr',
      value: t.shipNoxTonnes ?? 0,
      base: b.shipNoxTonnes ?? 0,
      unit: 't',
    },
  ];
}
