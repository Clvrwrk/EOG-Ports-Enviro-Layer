import assert from 'node:assert/strict';
import test from 'node:test';
import { runScenario } from '../scenario.js';
import { normalizeScenario } from '../scenarioStore.js';
import {
  DEFAULT_DECISIONS,
  applyDecisions,
  chargerCard,
  decisionsFromScenario,
  nextCallStart,
  reeferCalls,
  scenarioFromDecisions,
  scoreboard,
  shipCard,
  twinFrame,
  unitCard,
} from './frame.js';
import {
  SURVEYED,
  TWIN_LAYOUT,
  berthPoint,
  lonLatToOffset,
  loopLength,
  offsetToLonLat,
  pointOnLoop,
  rowSlot,
  utrLoopFor,
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

test('layout helpers place surveyed points in metres and walk the UTR loop', () => {
  const [lon, lat] = offsetToLonLat(TWIN_LAYOUT.origin, {
    east: 0,
    north: 111.32,
  });
  assert.ok(Math.abs(lat - TWIN_LAYOUT.origin.lat - 0.001) < 1e-9);
  assert.equal(lon, TWIN_LAYOUT.origin.lon);
  // A surveyed point round-trips through metres.
  const offset = lonLatToOffset(TWIN_LAYOUT.origin, SURVEYED.berth2);
  const [lon2, lat2] = offsetToLonLat(TWIN_LAYOUT.origin, offset);
  assert.ok(Math.abs(lon2 - SURVEYED.berth2[1]) < 1e-9);
  assert.ok(Math.abs(lat2 - SURVEYED.berth2[0]) < 1e-9);
  // Berth 2 is about 230 m east of berth 1; the cranes' apron is south of both.
  assert.ok(offset.east > 200 && offset.east < 260);
  assert.ok(TWIN_LAYOUT.apronNorth < 0);
  assert.equal(
    berthPoint(TWIN_LAYOUT, 'berth-3'),
    TWIN_LAYOUT.berths['berth-2'],
  );
  const loop = utrLoopFor(TWIN_LAYOUT, TWIN_LAYOUT.berths['berth-1']);
  assert.equal(loopLength(loop), 2 * 110 + 2 * 70);
  assert.equal(pointOnLoop(loop, 0).bearing, 90);
  assert.deepEqual(
    rowSlot({ east: 0, north: 0 }, 9, { spacing: 3.5, perRow: 8, rowGap: 9 }),
    { east: 3.5, north: -9 },
  );
});

test('twin toggles keep the rest of a builder scenario', () => {
  const built = normalizeScenario({
    name: 'From the builder',
    year: 2030,
    tariffId: 'SCE-TOU-EV-9',
    callScale: 1.2,
    fleet: {
      utr: { electric: 15, diesel: 12, chargers: 10 },
      reach_stacker: { electric: 3, diesel: 0, chargers: 3 },
    },
    battery: { kwh: 2000, kw: 750 },
  });
  assert.deepEqual(decisionsFromScenario(built), {
    year: 2030,
    utrs: 'custom',
    cranes: 'plan',
    charging: 'asap',
    battery: 'custom',
    shorePower: false,
  });
  const next = applyDecisions(built, { utrs: 'electric', shorePower: true });
  assert.equal(next.tariffId, 'SCE-TOU-EV-9');
  assert.equal(next.callScale, 1.2);
  assert.deepEqual(next.fleet.reach_stacker, built.fleet.reach_stacker);
  assert.equal(next.battery.kwh, 2000);
  assert.equal(decisionsFromScenario(next).utrs, 'electric');
  assert.equal(built.fleet.utr.electric, 15); // the input is not changed
  assert.equal(
    decisionsFromScenario(applyDecisions(next, { utrs: 'plan' })).utrs,
    'plan',
  );
  assert.deepEqual(
    decisionsFromScenario(scenarioFromDecisions(DEFAULT_DECISIONS)),
    DEFAULT_DECISIONS,
  );
});
