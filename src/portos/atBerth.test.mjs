import assert from 'node:assert/strict';
import test from 'node:test';

import {
  STAX,
  atBerthEmissions,
  atBerthWithAndWithoutStax,
  bargeGenerator,
  shorePowerInService,
  staxOutletFactors,
} from './atBerth.js';
import { runScenario } from './scenario.js';
import { normalizeScenario } from './scenarioStore.js';
import { STEPS_PER_HOUR } from './touCalendar.js';

const H = STEPS_PER_HOUR;
const call = (id, berthId, startH, hours, type = 'Refrigerated') => ({
  id,
  type,
  berthId,
  start: startH * H,
  end: (startH + hours) * H,
});

test('shore power follows the 2025 terminal plan by year', () => {
  assert.equal(shorePowerInService('berth-1', 2023), true);
  assert.equal(shorePowerInService('berth-1', 2026), false);
  assert.equal(shorePowerInService('berth-1', 2028), true);
  assert.equal(shorePowerInService('berth-4', 2027), false);
  assert.equal(shorePowerInService('berth-4', 2028), true);
  assert.equal(shorePowerInService('berth-3', 2030), false);
});

test('STAX takes 95% of NOx and 99% of PM off the auxiliary engines', () => {
  const aux = {
    nox: 10,
    pm25: 0.2,
    dpm: 0.2,
    hc: 0.4,
    co: 1,
    so2: 0.4,
    co2: 690,
  };
  const out = staxOutletFactors(aux);
  assert.ok(Math.abs(out.nox - 0.5) < 1e-9);
  assert.ok(Math.abs(out.dpm - 0.002) < 1e-9);
  assert.equal(out.hc, STAX.rogLimitGPerKwh);
  assert.equal(out.co2, aux.co2);
  assert.equal(out.so2, aux.so2);
});

test('a STAX call is uncontrolled only for hook-up and release hours', () => {
  const calls = [call('a', 'berth-1', 10, 20)];
  const off = atBerthEmissions(calls, { year: 2026, stax: false });
  const on = atBerthEmissions(calls, { year: 2026, stax: true });
  const c = on.calls[0];
  assert.equal(c.method, 'stax');
  assert.equal(c.bargeId, 'stax-1');
  assert.equal(c.controlStart, calls[0].start + STAX.hookupHours * H);
  assert.equal(c.controlEnd, calls[0].end - STAX.releaseHours * H);
  assert.equal(on.totals.controlledHours.stax, 17);
  // Ship CO2 is not captured.
  assert.ok(
    Math.abs(on.totals.shipTonnes.co2 - off.totals.shipTonnes.co2) < 1e-9,
  );
  assert.ok(on.totals.tonnes.nox < off.totals.tonnes.nox * 0.25);
  // The barge burns renewable diesel for the treated hours.
  assert.equal(on.totals.bargeKwh, STAX.bargeGeneratorKw * 17);
});

test('shore power wins over STAX where it works', () => {
  const calls = [call('a', 'berth-1', 0, 24)];
  const r = atBerthEmissions(calls, {
    year: 2028,
    stax: true,
    shorePower: true,
    shorePowerTypes: ['Refrigerated'],
  });
  assert.equal(r.calls[0].method, 'shore-power');
  assert.ok(r.calls[0].shoreKwh > 0);
  // Same call in 2026: shore power is broken, so STAX treats it.
  const r26 = atBerthEmissions(calls, {
    year: 2026,
    stax: true,
    shorePower: true,
    shorePowerTypes: ['Refrigerated'],
  });
  assert.equal(r26.calls[0].method, 'stax');
});

test('per-berth choice, vessel types and barge count limit STAX', () => {
  const calls = [
    call('a', 'berth-1', 0, 30),
    call('b', 'berth-4', 1, 10, 'Ro-Ro/Vehicles Carrier'),
    call('c', 'berth-2', 2, 30),
    call('d', 'berth-6', 0, 30, 'Heavy Lift'),
  ];
  const r = atBerthEmissions(calls, { year: 2026, stax: true, staxBarges: 2 });
  const by = Object.fromEntries(r.calls.map((c) => [c.id, c]));
  assert.equal(by.a.method, 'stax');
  assert.equal(by.b.method, 'stax');
  // Both barges busy when c is ready; it waits for b's barge to free up.
  assert.equal(by.c.method, 'stax');
  assert.equal(by.c.controlStart, by.b.end);
  assert.equal(by.d.method, 'none');

  const noNorth = atBerthEmissions(calls, {
    year: 2026,
    stax: true,
    staxBerths: ['berth-1', 'berth-2'],
  });
  assert.equal(noNorth.calls.find((c) => c.id === 'b').method, 'none');

  const oneBarge = atBerthEmissions(calls, {
    year: 2026,
    stax: true,
    staxBarges: 1,
  });
  // One barge: a holds it until hour 30, so b (sails at 11) is missed and
  // c gets the barge for its last hour.
  assert.equal(oneBarge.calls.find((c) => c.id === 'b').method, 'none');
  assert.equal(oneBarge.totals.staxMissed, 1);
});

test('barge generator fuel and lifecycle CO2e scale with hours', () => {
  const g = bargeGenerator(10);
  assert.equal(g.kwh, 3200);
  assert.ok(Math.abs(g.gallons - (3200 * 0.213) / 2.95) < 1e-6);
  assert.ok(g.lifecycleCo2eKg > 0);
  assert.equal(g.grams.co2, 0);
});

test('a scenario run reports ship emissions with and without STAX', () => {
  const on = runScenario({ year: 2026 });
  assert.equal(on.scenario.stax, true);
  const off = runScenario({ year: 2026, stax: false });
  assert.ok(on.totals.shipNoxTonnes < off.totals.shipNoxTonnes);
  assert.ok(on.totals.staxNoxSavedTonnes > 0);
  assert.equal(off.totals.staxNoxSavedTonnes, 0);
  const pair = atBerthWithAndWithoutStax(on.calls, on.scenario);
  assert.ok(
    Math.abs(
      pair.staxSavedTonnes.nox -
        (off.totals.shipNoxTonnes - on.totals.shipNoxTonnes),
    ) < 1e-9,
  );
  // No berth has working shore power in 2026, so the reefer toggle adds no load.
  const shore26 = runScenario({ year: 2026, shorePower: true });
  assert.equal(
    shore26.shoreKw.reduce((a, b) => a + b, 0),
    0,
  );
});

test('saved scenarios keep STAX on unless it was turned off', () => {
  assert.equal(normalizeScenario({}).stax, true);
  assert.equal(normalizeScenario({ stax: false }).stax, false);
  const s = normalizeScenario({
    staxBerths: ['berth-4', 'berth-9'],
    staxBarges: 3,
  });
  assert.deepEqual(s.staxBerths, ['berth-4']);
  assert.equal(s.staxBarges, 3);
});
