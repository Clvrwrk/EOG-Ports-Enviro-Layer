import assert from 'node:assert/strict';
import test from 'node:test';
import { HUENEME_REGISTRY } from '../hueneme.js';
import { runScenario } from '../scenario.js';
import {
  allocateScenario,
  meterScenarioAt,
  scenarioLoads,
  tariffIdFor,
} from './allocate.js';
import { loadMeterRegistry } from './load.js';
import {
  END_USES,
  SAMPLE_REGISTRY,
  annualKwh,
  headroomKw,
  meterCard,
  normalizeRegistry,
  portCard,
  portKwh,
  recentMonths,
  rollupByEndUse,
} from './registry.js';

const specs = HUENEME_REGISTRY.specs;
const meter = (extra = {}) => ({
  id: 'm1',
  endUse: 'buildings',
  at: [34.1, -119.2],
  ...extra,
});

test('the sample registry is valid and marked as sample', () => {
  assert.equal(SAMPLE_REGISTRY.sample, true);
  assert.ok(SAMPLE_REGISTRY.meters.length >= 5);
  for (const m of SAMPLE_REGISTRY.meters) assert.ok(END_USES[m.endUse]);
});

test('a registry rejects bad meters', () => {
  assert.throws(() => normalizeRegistry({}), /meters array/);
  assert.throws(
    () => normalizeRegistry({ meters: [meter({ endUse: 'nope' })] }),
    /unknown end use/,
  );
  assert.throws(
    () => normalizeRegistry({ meters: [meter({ at: [200, 0] })] }),
    /lat, lon/,
  );
  assert.throws(
    () => normalizeRegistry({ meters: [meter(), meter()] }),
    /duplicate/,
  );
  assert.throws(
    () =>
      normalizeRegistry({ meters: [meter({ monthlyKwh: { 'Aug 22': 5 } })] }),
    /monthlyKwh/,
  );
  assert.throws(
    () => normalizeRegistry({ meters: [meter({ carries: ['reefer'] })] }),
    /cannot carry/,
  );
});

test('annual kWh is the latest 12 months on record', () => {
  const monthlyKwh = {};
  for (let i = 1; i <= 12; i += 1)
    monthlyKwh[`2022-${String(i).padStart(2, '0')}`] = 100;
  monthlyKwh['2021-12'] = 9999;
  const m = normalizeRegistry({ meters: [meter({ monthlyKwh })] }).meters[0];
  assert.equal(recentMonths(m).length, 12);
  assert.equal(recentMonths(m)[0][0], '2022-01');
  assert.equal(annualKwh(m), 1200);
});

test('end-use roll-up shares add to the port total', () => {
  const rows = rollupByEndUse(SAMPLE_REGISTRY);
  const total = rows.reduce((acc, row) => acc + row.kwh, 0);
  assert.equal(total, portKwh(SAMPLE_REGISTRY));
  assert.ok(Math.abs(rows.reduce((a, r) => a + r.share, 0) - 1) < 1e-9);
  assert.equal(rows[0].endUse, 'shore_power');
  assert.ok(portCard(SAMPLE_REGISTRY).rows.length > rows.length);
});

test('headroom uses the larger of billed and scenario peak', () => {
  const m = meter({ serviceKva: 1000, peakKw: 300 });
  assert.equal(headroomKw(m), 600);
  assert.equal(headroomKw(m, 1000), -100);
  assert.equal(headroomKw(meter()), null);
});

test('rate schedules map to the tariffs the app can bill', () => {
  assert.equal(tariffIdFor('TOU-EV-9'), 'SCE-TOU-EV-9');
  assert.equal(tariffIdFor('TOU-8-D'), 'SCE-TOU-8-D');
  assert.equal(tariffIdFor('TOU-GS-2-D CPP'), null);
});

test('scenario loads land on the meters that carry them', () => {
  const run = runScenario({ year: 2028, shorePower: true });
  const loads = scenarioLoads(run, specs);
  const { byMeter, unassigned } = allocateScenario(run, SAMPLE_REGISTRY, specs);
  assert.deepEqual(unassigned, []);
  const shore = byMeter.get('sample-shore-power');
  assert.ok(shore.kwh > 0);
  assert.ok(shore.bill > 0);
  assert.equal(byMeter.has('sample-reefers'), false);
  // Every modeled kWh is on some meter; the base load stays off them.
  const sum = (series) => series.reduce((a, b) => a + b, 0) / 4;
  const modeled = Object.values(loads).reduce((a, s) => a + sum(s), 0);
  const placed = [...byMeter.values()].reduce((a, e) => a + e.kwh, 0);
  assert.ok(Math.abs(modeled - placed) < 1e-6 * Math.max(1, modeled));
  const at = meterScenarioAt({ byMeter }, 'sample-shore-power', shore.peakStep);
  assert.equal(at.nowKw, shore.peakKw);
  assert.equal(meterScenarioAt({ byMeter }, 'nope', 0), null);
});

test('a load with no meter is reported, and overloads show on the card', () => {
  const run = runScenario({ year: 2028, shorePower: true });
  const small = normalizeRegistry({
    meters: [
      meter({
        id: 'tiny',
        endUse: 'shore_power',
        serviceKva: 100,
        carries: ['shore_power'],
        tariff: 'TOU-EV-9',
      }),
    ],
  });
  const { byMeter, unassigned } = allocateScenario(run, small, specs);
  assert.ok(unassigned.some((row) => row.loadId === 'equipment_charging'));
  assert.ok(byMeter.get('tiny').headroomKw < 0);
  const card = meterCard(small.meters[0], {
    scenario: meterScenarioAt({ byMeter }, 'tiny', 0),
  });
  assert.equal(card.over, true);
  assert.ok(card.rows.some(([, value]) => /over the service/.test(value)));
});

test('the loader falls back to the sample registry', async () => {
  const missing = await loadMeterRegistry({
    fetchImpl: async () => ({ ok: false, headers: new Map() }),
  });
  assert.equal(missing, SAMPLE_REGISTRY);
  // A dev server answers unknown paths with the app's HTML page.
  const html = await loadMeterRegistry({
    fetchImpl: async () => ({
      ok: true,
      headers: new Map([['content-type', 'text/html']]),
    }),
  });
  assert.equal(html, SAMPLE_REGISTRY);
  const real = await loadMeterRegistry({
    fetchImpl: async () => ({
      ok: true,
      headers: new Map([['content-type', 'application/json']]),
      json: async () => ({ port: 'X', meters: [meter()] }),
    }),
  });
  assert.equal(real.sample, false);
  assert.equal(real.meters[0].id, 'm1');
});

test('the day profile stacks scenario loads on billed averages', async () => {
  const { billedMonthKwh, dayProfile } = await import('./profile.js');
  const run = runScenario({ year: 2028, shorePower: true });
  const allocation = allocateScenario(run, SAMPLE_REGISTRY, specs);
  const reefers = SAMPLE_REGISTRY.meters.find((m) => m.id === 'sample-reefers');
  assert.equal(billedMonthKwh(reefers, 1), 180000);
  const step = 10 * 96 + 50; // 11 January, 12:30
  const day = dayProfile(SAMPLE_REGISTRY, allocation, run, step);
  assert.equal(day.stepOfDay, 50);
  assert.equal(day.totalKw.length, 96);
  // Reefers are billed, so flat: January kWh over the month's hours.
  const reefer = day.series.find((row) => row.endUse === 'reefer');
  assert.equal(reefer.modeled, false);
  assert.ok(Math.abs(reefer.kw[0] - 180000 / (31 * 24)) < 1e-9);
  // Lighting only draws at night.
  const lights = day.series.find((row) => row.endUse === 'lighting');
  assert.equal(lights.kw[12 * 4], 0);
  assert.ok(lights.kw[0] > 0);
  // Scenario-carried meters use the scenario series, not their bills.
  const shore = day.series.find((row) => row.endUse === 'shore_power');
  assert.equal(shore.modeled, true);
  const entry = allocation.byMeter.get('sample-shore-power');
  assert.equal(shore.kw[50], entry.series[step]);
  const stacked = day.series.reduce((acc, row) => acc + row.kw[50], 0);
  assert.ok(Math.abs(stacked - day.nowKw) < 1e-9);
  assert.ok(day.kwhSoFar > 0 && day.kwhSoFar < day.kwhDay);
});

test('band paths close and stay inside the chart', async () => {
  const { bandPath } = await import('./usageChart.js');
  const path = bandPath([0, 0, 0], [5, 10, 5], 10, 100, 50);
  assert.ok(path.startsWith('M0.0 25.0'));
  assert.ok(path.includes('L50.0 0.0'));
  assert.ok(path.endsWith('Z'));
});
