import assert from 'node:assert/strict';
import test from 'node:test';
import { inventorySummary, validateRegistry } from './assetClasses.js';
import { dispatchBattery } from './battery.js';
import { billByMonth } from './billing.js';
import { capexPlan } from './capex.js';
import { simulateFleet } from './fleetSim.js';
import {
  CALL_PROFILE,
  CREW_TEMPLATES,
  HUENEME_REGISTRY,
  PURCHASES,
  SHIFT_SLOTS,
  SPECS,
  UNIT_COSTS,
} from './hueneme.js';
import { rollup } from './rollups.js';
import { runScenario } from './scenario.js';
import { equipmentDemand, synthesizeCalls } from './schedule.js';
import { TARIFFS } from './tariffs.js';
import { sceHolidays, touPeriod, yearSteps } from './touCalendar.js';

const STEPS = 96;

test('the Hueneme seed registry validates and matches the 2023 workbook fleet', () => {
  assert.deepEqual(validateRegistry(HUENEME_REGISTRY), []);
  const summary = inventorySummary(HUENEME_REGISTRY);
  assert.deepEqual(summary.utr, { diesel: 25, electric: 2 });
  assert.equal(summary.berth.none, 9);
  assert.deepEqual(summary.mobile_harbor_crane, { diesel: 1, hybrid: 3 });
});

test('registry validation reports bad classes, references and duplicates', () => {
  const errors = validateRegistry({
    specs: {},
    assets: [
      { id: 'a', class: 'spaceship' },
      { id: 'c1', class: 'charger', meterId: 'nope', kw: 50 },
      { id: 'c1', class: 'charger', meterId: 'nope', kw: 50 },
    ],
  });
  assert.ok(errors.some((e) => e.includes('unknown class spaceship')));
  assert.ok(errors.some((e) => e.includes('duplicate id')));
  assert.ok(errors.some((e) => e.includes('meterId nope is not a meter')));
});

test('SCE TOU periods follow the 4-9 p.m. structure and observed holidays', () => {
  const tariff = TARIFFS['SCE-TOU-8-D'];
  assert.equal(
    touPeriod(tariff, { month: 7, hour: 17, weekday: true }).period,
    'on',
  );
  assert.equal(
    touPeriod(tariff, { month: 7, hour: 17, weekday: false }).period,
    'mid',
  );
  assert.equal(
    touPeriod(tariff, { month: 1, hour: 17, weekday: true }).period,
    'mid',
  );
  assert.equal(
    touPeriod(tariff, { month: 1, hour: 10, weekday: true }).period,
    'super_off',
  );
  assert.equal(
    touPeriod(tariff, { month: 7, hour: 10, weekday: true }).period,
    'off',
  );
  // July 4, 2027 is a Sunday, so Monday July 5 is the observed holiday.
  assert.ok(sceHolidays(2027).has('7-5'));
  assert.ok(sceHolidays(2026).has('11-26')); // Thanksgiving 2026
  assert.equal(yearSteps(2028).length, 366 * STEPS);
});

test('a BEV UTR draws 12.5 kWh per working hour and recharges 50 kWh at break (workbook rule)', () => {
  // One unit works the 8-11 a.m. day-shift slots, then stands down at noon.
  const demand = new Uint16Array(STEPS);
  for (let s = 8 * 4; s < 12 * 4; s += 1) demand[s] = 1;
  const result = simulateFleet({
    demand,
    spec: SPECS.utr,
    electric: 1,
    diesel: 0,
    periods: new Array(STEPS).fill('off'),
    chargerEfficiency: 1,
  });
  assert.equal(result.meanSoc[12 * 4 - 1], (180 - 4 * 12.5) / 180);
  // Charging at 50 kW for the noon hour returns exactly the 50 kWh used.
  const noonKwh = [0, 1, 2, 3].reduce(
    (sum, i) => sum + result.gridKw[48 + i] / 4,
    0,
  );
  assert.equal(noonKwh, 50);
  assert.equal(result.meanSoc[13 * 4 - 1], 1);
});

test('diesel covers what the batteries cannot, and gallons follow 2.5 GPH', () => {
  const demand = new Uint16Array(STEPS).fill(3);
  const result = simulateFleet({
    demand,
    spec: SPECS.utr,
    electric: 1,
    diesel: 1,
    periods: new Array(STEPS).fill('off'),
  });
  const gallons = result.dieselGallons.reduce((a, b) => a + b, 0);
  assert.equal(gallons, 24 * 2.5);
  assert.equal(result.unmet[0], 1);
  // 180 kWh lasts 14.25 hours (57 steps) at 12.5 kWh/hr; the flat unit then
  // charges at 50 kW until it is back above the 30% reserve (5 steps).
  assert.equal(result.electricWorking[56], 1);
  assert.equal(result.electricWorking[57], 0);
  assert.equal(result.electricWorking[61], 0);
  assert.equal(result.electricWorking[62], 1);
});

test('plug-in harbor cranes draw 322.5 kW from the grid while working, diesel covers the rest', () => {
  const demand = new Uint16Array(STEPS).fill(3);
  const result = simulateFleet({
    demand,
    spec: SPECS.harbor_crane,
    electric: 2,
    diesel: 2,
    periods: new Array(STEPS).fill('off'),
  });
  assert.equal(SPECS.harbor_crane.kwhPerHour, 322.5);
  assert.equal(result.gridKw[0], 2 * 322.5);
  assert.equal(result.electricWorking[50], 2);
  assert.equal(result.dieselWorking[50], 1);
  const gallons = result.dieselGallons.reduce((a, b) => a + b, 0);
  // 322.5 kW at EPA NONROAD's 0.367 lb/hp-hr and 7.1 lb/gal is 22.4 gal/hr.
  assert.ok(Math.abs(SPECS.harbor_crane.dieselGph - 22.35) < 0.01);
  assert.ok(Math.abs(gallons - 24 * SPECS.harbor_crane.dieselGph) < 1e-9);
});

test('avoid-peak charging defers charging out of 4-9 p.m. above the reserve', () => {
  const demand = new Uint16Array(STEPS);
  for (let s = 13 * 4; s < 16 * 4; s += 1) demand[s] = 1;
  const periods = Array.from({ length: STEPS }, (_, s) =>
    s >= 16 * 4 && s < 21 * 4 ? 'on' : 'off',
  );
  const run = (strategy) =>
    simulateFleet({
      demand,
      spec: SPECS.utr,
      electric: 1,
      diesel: 0,
      periods,
      strategy,
    });
  assert.ok(run('asap').gridKw[16 * 4] > 0);
  assert.equal(run('avoid-peak').gridKw[16 * 4], 0);
  assert.ok(run('avoid-peak').gridKw[21 * 4] > 0);
});

test('crew templates put workbook unit counts to work only in NS/DS slots', () => {
  const calls = [
    {
      id: 'c',
      type: 'Refrigerated',
      berthId: 'berth-1',
      start: 0,
      end: STEPS,
      template: '2G + 1H + DV',
    },
  ];
  const demand = equipmentDemand(calls, {
    totalSteps: STEPS,
    slots: SHIFT_SLOTS,
    templates: CREW_TEMPLATES,
  });
  assert.equal(demand.utr[9 * 4], 12);
  assert.equal(demand.utr[12 * 4], 0); // noon break
  assert.equal(demand.utr[4 * 4], 0); // hoot
  assert.equal(demand.harbor_crane[9 * 4], 2);
  // 16 working hours a day: NS 0-2, DS 8-11, DS 13-16, NS 18-21, NS 23.
  assert.equal(demand.utr.reduce((a, b) => a + b, 0) / 4, 12 * 16);
});

test('the synthetic schedule is reproducible and honors berths and crew limits', () => {
  const a = synthesizeCalls(CALL_PROFILE, { seed: 7 });
  const b = synthesizeCalls(CALL_PROFILE, { seed: 7 });
  assert.deepEqual(a, b);
  assert.ok(a.length > 200 && a.length < 260);
  const byBerth = new Map();
  for (const call of a)
    (
      byBerth.get(call.berthId) ??
      byBerth.set(call.berthId, []).get(call.berthId)
    ).push(call);
  for (const calls of byBerth.values()) {
    calls.sort((x, y) => x.start - y.start);
    for (let i = 1; i < calls.length; i += 1)
      assert.ok(calls[i].start >= calls[i - 1].end);
  }
  const reefers = a
    .filter((call) => call.type === 'Refrigerated')
    .sort((x, y) => x.start - y.start);
  for (let i = 1; i < reefers.length; i += 1)
    assert.ok(reefers[i].start >= reefers[i - 1].end);
});

test('billing applies FRD to the monthly max and TRD to weekday peak windows only', () => {
  const calendar = yearSteps(2026);
  const kw = new Float64Array(calendar.length).fill(100);
  // A 900 kW spike on Saturday July 4 at 5 p.m. (a holiday and a weekend).
  const holidaySpike = calendar.findIndex(
    (s) => s.month === 7 && s.day === 4 && s.hour === 17,
  );
  kw[holidaySpike] = 900;
  // A 500 kW spike on Wednesday July 8 at 5 p.m. (summer on-peak weekday).
  const peakSpike = calendar.findIndex(
    (s) => s.month === 7 && s.day === 8 && s.hour === 17,
  );
  kw[peakSpike] = 500;
  const tariff = TARIFFS['SCE-TOU-8-D'];
  const july = billByMonth(kw, tariff, calendar)[6];
  const frd = july.lines.find(
    (line) => line.label === 'Facilities-related demand',
  );
  const trd = july.lines.find((line) =>
    line.label.startsWith('Time-related demand'),
  );
  assert.equal(frd.kw, 900);
  assert.equal(trd.kw, 500);
  assert.equal(trd.amount, 500 * 25.68);
  assert.ok(Math.abs(july.kwh - (31 * 24 * 100 + 800 / 4 + 400 / 4)) < 1e-6);
});

test('TOU-EV-9 bills no demand until authorized, with a sensitivity switch', () => {
  const calendar = yearSteps(2026);
  const kw = new Float64Array(calendar.length).fill(400);
  const tariff = TARIFFS['SCE-TOU-EV-9'];
  assert.equal(billByMonth(kw, tariff, calendar)[0].demandCost, 0);
  assert.ok(
    billByMonth(kw, tariff, calendar, { includeDeferredDemand: true })[0]
      .demandCost > 0,
  );
});

test('a peak-shaving battery holds the meter at its threshold and recharges off-peak', () => {
  const load = Float64Array.from([100, 100, 600, 600, 100, 100]);
  const periods = ['off', 'off', 'on', 'on', 'off', 'off'];
  const { netKw, soc } = dispatchBattery(
    load,
    {
      kwh: 200,
      kw: 400,
      thresholdKw: 300,
      roundTripEfficiency: 1,
      chargePeriods: ['off'],
    },
    periods,
  );
  assert.deepEqual(Array.from(netKw.slice(2, 4)), [300, 300]);
  assert.equal(soc[3], (200 - 150) / 200);
  assert.ok(netKw[4] > 100 && netKw[4] <= 300);
});

test('capex reproduces the workbook totals and the per-unit correction', () => {
  const workbook = capexPlan(PURCHASES, UNIT_COSTS, { method: 'workbook' });
  assert.equal(workbook.byClass.utr, 8_650_000);
  assert.equal(workbook.byClass.forklift_class_v, 1_020_000);
  assert.equal(workbook.byClass.harbor_crane, 7_600_000);
  assert.equal(workbook.byClass.reach_stacker, 3_000_000);
  assert.equal(workbook.byYear[2024].utr, 3_210_000);
  const perUnit = capexPlan(PURCHASES, UNIT_COSTS);
  // 25 UTRs x ($370k - $120k voucher + $100k infrastructure)
  assert.equal(perUnit.byClass.utr, 25 * 350_000);
});

test('rollups sum energy and keep the peak at every grain', () => {
  const calendar = yearSteps(2026);
  const kw = new Float64Array(calendar.length).fill(10);
  kw[100] = 80;
  const months = rollup(calendar, { kw }, 'month');
  assert.equal(months.length, 12);
  assert.equal(months[0].peakKw, 80);
  assert.equal(rollup(calendar, { kw }, 'year')[0].kwh, 365 * 24 * 10 + 70 / 4);
  assert.equal(rollup(calendar, { kw }, 'quarter').length, 4);
  assert.equal(rollup(calendar, { kw }, 'day').length, 365);
});

test('an all-electric UTR scenario removes UTR diesel and a battery cuts demand charges', () => {
  const base = runScenario({ fleet: { utr: { electric: 0, diesel: 27 } } });
  const electric = runScenario({ fleet: { utr: { electric: 27, diesel: 0 } } });
  const battery = runScenario({
    fleet: { utr: { electric: 27, diesel: 0 } },
    battery: { kwh: 1000, kw: 500 },
  });
  assert.equal(electric.fleets.utr.dieselGallons, 0);
  assert.ok(base.fleets.utr.dieselGallons > 0);
  assert.ok(electric.totals.co2Tonnes < base.totals.co2Tonnes);
  assert.equal(electric.fleets.utr.unmetHours, 0);
  // UTR energy equals worked hours x 12.5 kWh, grossed up for charger losses
  // (net of the small amount left uncharged at year end).
  const worked = electric.fleets.utr.electricHours * 12.5;
  assert.ok(Math.abs(electric.fleets.utr.kwh * 0.92 - worked) < 27 * 180);
  assert.ok(battery.totals.peakKw < electric.totals.peakKw);
  assert.ok(battery.totals.batterySavings > 0);
  assert.ok(battery.totals.demandCost < electric.totals.demandCost);
});
