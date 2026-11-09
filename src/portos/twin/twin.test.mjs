import assert from 'node:assert/strict';
import test from 'node:test';
import { runScenario } from '../scenario.js';
import {
  DEFAULT_DECISIONS,
  chargerCard,
  nextCallStart,
  reeferCalls,
  scenarioFromDecisions,
  scoreboard,
  shipCard,
  twinFrame,
  unitCard,
} from './frame.js';
import {
  TWIN_LAYOUT,
  loopLength,
  offsetToLonLat,
  pointOnLoop,
} from './layout.js';

const baseline = runScenario(scenarioFromDecisions(DEFAULT_DECISIONS));

test('default decisions reproduce the default scenario', () => {
  const plain = runScenario({});
  assert.equal(baseline.totals.electricityCost, plain.totals.electricityCost);
  assert.equal(baseline.totals.co2Tonnes, plain.totals.co2Tonnes);
});

test('all-electric UTRs cut diesel and add grid load', () => {
  const ev = runScenario(scenarioFromDecisions({ utrs: 'electric' }));
  assert.equal(ev.fleets.utr.electric, 27);
  assert.ok(ev.fleets.utr.dieselGallons < baseline.fleets.utr.dieselGallons);
  assert.ok(ev.fleets.utr.kwh > baseline.fleets.utr.kwh);
  const rows = scoreboard(ev, baseline);
  const co2 = rows.find((row) => row.id === 'co2');
  assert.ok(co2.value < co2.base);
});

test('a battery lowers the peak at the meter', () => {
  const run = runScenario(
    scenarioFromDecisions({ utrs: 'electric', battery: '1mwh' }),
  );
  assert.ok(run.totals.peakKw < run.totals.peakKwWithoutBattery);
});

test('a frame during a reefer call shows the ship and working equipment', () => {
  const call = reeferCalls(baseline)[0];
  const step = call.start + 4 * 10;
  const frame = twinFrame(baseline, step);
  assert.equal(frame.ship.id, call.id);
  assert.equal(frame.cranes.length, 4);
  assert.equal(
    frame.utrs.length,
    baseline.fleets.utr.electric + baseline.fleets.utr.diesel,
  );
  const working = frame.utrs.filter((u) => u.state === 'working').length;
  const s = baseline.fleets.utr.series;
  assert.equal(working, s.electricWorking[step] + s.dieselWorking[step]);
  assert.ok(frame.co2KgPerHour >= 0);
});

test('unit, charger and ship cards carry the scenario data', () => {
  const call = reeferCalls(baseline)[0];
  const frame = twinFrame(baseline, call.start + 8);
  const utr = frame.utrs.find((u) => u.powertrain === 'electric');
  const card = unitCard(frame, utr, baseline);
  assert.match(card.title, /UTR/);
  assert.ok(card.rows.some(([label]) => label === 'Charge rate'));
  const diesel = frame.utrs.find((u) => u.powertrain === 'diesel');
  assert.ok(
    unitCard(frame, diesel, baseline).rows.some(
      ([l]) => l === 'Fuel when working',
    ),
  );
  assert.equal(chargerCard(frame, 0, baseline).rows[0][1], '50 kW');
  assert.match(shipCard(frame, baseline).title, /Refrigerated/);
});

test('ship navigation steps between reefer call starts', () => {
  const calls = reeferCalls(baseline);
  const first = nextCallStart(baseline, -1, 1);
  assert.equal(first, calls[0].start);
  const second = nextCallStart(baseline, first, 1);
  assert.equal(second, calls[1].start);
  assert.equal(nextCallStart(baseline, second, -1), first);
});

test('layout helpers place points in metres and walk the UTR loop', () => {
  const [lon, lat] = offsetToLonLat(TWIN_LAYOUT.origin, {
    east: 0,
    north: 111.32,
  });
  assert.ok(Math.abs(lat - TWIN_LAYOUT.origin.lat - 0.001) < 1e-9);
  assert.equal(lon, TWIN_LAYOUT.origin.lon);
  assert.equal(loopLength(TWIN_LAYOUT.utrLoop), 2 * 140 + 2 * 86);
  const start = pointOnLoop(TWIN_LAYOUT.utrLoop, 0);
  assert.equal(start.bearing, 90);
  const quarter = pointOnLoop(TWIN_LAYOUT.utrLoop, 0.5);
  assert.ok(quarter.north < -24);
});
