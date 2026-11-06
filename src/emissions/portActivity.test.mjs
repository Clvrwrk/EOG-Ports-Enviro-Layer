import assert from 'node:assert/strict';
import test from 'node:test';
import { PORT_OF_HUENEME } from './ports.js';
import { createPortActivity, factorRange } from './portActivity.js';
import {
  aisFamily,
  characteristicsFor,
  createVesselRegistry,
  hotelLoadRange,
} from './vesselRegistry.js';

const HOUR = 3_600_000;
const T0 = Date.parse('2026-11-01T00:00:00Z');
const BERTH = { lon: -119.209, lat: 34.151 };
const APPROACH = { lon: -119.2095, lat: 34.05 };

const car = (at, extra = {}) => ({
  mmsi: '563000001',
  name: 'TEST CARRIER',
  shipType: '70',
  ...at,
  ...extra,
});

test('AIS type codes and labels map to families', () => {
  assert.equal(aisFamily('70'), 7);
  assert.equal(aisFamily('84'), 8);
  assert.equal(aisFamily('CARGO'), 7);
  assert.equal(aisFamily('52'), 5); // tug: harbor craft, not an OGV
  assert.equal(aisFamily(''), null);
  assert.equal(aisFamily('0'), null);
});

test('an unidentified cargo ship is narrowed to the port trades, not guessed', () => {
  const info = characteristicsFor(
    { mmsi: '1', type: '71' },
    { profile: PORT_OF_HUENEME },
  );
  assert.equal(info.known, false);
  const types = new Set(info.candidates.map((c) => c.shipType));
  assert.deepEqual(
    [...types].sort(),
    ['Container Ship', 'General Cargo', 'Reefer', 'Vehicle Carrier'].sort(),
  );
  const range = hotelLoadRange(info.candidates, 'hotelling');
  assert.ok(range.auxKw[0] < range.auxKw[1]);
  // A tanker is outside Hueneme's trades but still gets its family's range.
  const tanker = characteristicsFor(
    { type: '80' },
    { profile: PORT_OF_HUENEME },
  );
  assert.ok(tanker.candidates.length > 0);
  assert.ok(tanker.candidates.every((c) => c.shipType.includes('Tanker')));
});

test('registry rows need a source and a valid EPA subtype', () => {
  assert.throws(
    () =>
      createVesselRegistry([
        { mmsi: '1', shipType: 'Reefer', subtype: 'All Reefer' },
      ]),
    /needs a source/,
  );
  assert.throws(
    () =>
      createVesselRegistry([
        { mmsi: '1', shipType: 'Reefer', subtype: 'Huge', source: 'x' },
      ]),
    /Unknown EPA type/,
  );
  const registry = createVesselRegistry([
    {
      imo: 'IMO9000001',
      shipType: 'Reefer',
      subtype: 'All Reefer',
      keelYear: 2012,
      auxiliary: { engineType: 'MSD' },
      source: 'test fixture',
    },
  ]);
  const info = characteristicsFor({ imo: '9000001', type: '70' }, { registry });
  assert.equal(info.known, true);
  assert.deepEqual(hotelLoadRange(info.candidates, 'hotelling'), {
    auxKw: [1080, 1080],
    boilerKw: [270, 270],
  });
});

test('factor ranges span the NOx tiers when keel year is unknown', () => {
  const any = factorRange('auxiliary');
  assert.deepEqual(any.nox, [2.0, 13.8]);
  const known = factorRange('auxiliary', { keelYear: 2012, engineType: 'MSD' });
  assert.deepEqual(known.nox, [10.5, 10.5]);
});

test('time at berth is credited to hotelling and becomes an energy range', () => {
  const activity = createPortActivity(PORT_OF_HUENEME);
  activity.observe([car(APPROACH, { speedKts: 14 })], T0);
  activity.observe([car(BERTH, { speedKts: 0.2 })], T0 + HOUR);
  for (let h = 3; h <= 11; h += 2)
    activity.observe([car(BERTH, { speedKts: 0.1 })], T0 + h * HOUR);
  const s = activity.summary();
  assert.equal(s.vessels.length, 1);
  assert.equal(s.vessels[0].mode, 'hotelling');
  assert.equal(s.byMode.hotelling, 1);
  assert.equal(s.hotellingHours, 10);
  assert.ok(Math.abs(s.vessels[0].hoursByMode.transit - 1) < 1e-9);
  const [lo, hi] = s.atBerthAuxKwNow;
  assert.ok(lo > 0 && hi >= lo);
  assert.deepEqual(s.energyKwh.auxiliary, [lo * 10, hi * 10]);
  assert.ok(s.tonnes.nox[0] > 0 && s.tonnes.nox[1] > s.tonnes.nox[0]);
  assert.ok(s.warnings.some((w) => /Propulsion left out/.test(w)));
  assert.ok(s.warnings.some((w) => /ranges over the candidates/.test(w)));
});

test('gaps over six hours are not filled, and tugs are not counted', () => {
  const activity = createPortActivity(PORT_OF_HUENEME);
  activity.observe(
    [
      car(BERTH, { speedKts: 0 }),
      { mmsi: '2', shipType: '52', ...BERTH, speedKts: 0 },
    ],
    T0,
  );
  activity.observe([car(BERTH, { speedKts: 0 })], T0 + 7 * HOUR);
  const s = activity.summary();
  assert.equal(s.hotellingHours, 0);
  assert.equal(s.vessels.length, 1);
});

test('a ship that leaves the domain stops accruing', () => {
  const activity = createPortActivity(PORT_OF_HUENEME);
  activity.observe([car(BERTH, { speedKts: 0 })], T0);
  activity.observe(
    [car({ lon: -119.2, lat: 33.4 }, { speedKts: 14 })],
    T0 + 2 * HOUR,
  );
  activity.observe(
    [car({ lon: -119.2, lat: 33.3 }, { speedKts: 14 })],
    T0 + 4 * HOUR,
  );
  const s = activity.summary();
  assert.equal(s.vessels.length, 0);
  assert.equal(s.hotellingHours, 2);
});
