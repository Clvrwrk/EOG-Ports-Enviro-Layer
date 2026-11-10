import assert from 'node:assert/strict';
import test from 'node:test';
import { splitCalls } from './aisCalls.js';
import { callEmissions, craftEmissions } from './callEmissions.js';
import {
  berthStay,
  contactWindows,
  craftRoleFor,
  nearestBerth,
  positionAt,
  reconstructCall,
} from './callEvents.js';
import { HUENEME_BERTH_POINTS, HUENEME_BERTH_USE } from './huenemeBerths.js';
import { PORT_OF_HUENEME } from './ports.js';

const T0 = Date.parse('2023-06-12T00:00:00Z');
const MIN = 60_000;

// A straight-line path sampled once a minute from `from` to `to`.
function leg(mmsi, startMin, minutes, from, to, sog) {
  const out = [];
  for (let i = 0; i <= minutes; i++) {
    const f = minutes ? i / minutes : 0;
    out.push({
      mmsi,
      t: T0 + (startMin + i) * MIN,
      lon: from[0] + (to[0] - from[0]) * f,
      lat: from[1] + (to[1] - from[1]) * f,
      sog,
    });
  }
  return out;
}

const SEA = [-119.235, 34.115];
const ENTRANCE = [-119.2141, 34.1434];
const BERTH1 = [HUENEME_BERTH_POINTS[0].lon, HUENEME_BERTH_POINTS[0].lat];
const TUG_HOME = [-119.2035, 34.1478];

// Ship: 40 min in from sea, 40 min to berth 1, 10 h alongside, 60 min out.
const ship = [
  ...leg('S', 0, 40, SEA, ENTRANCE, 8),
  ...leg('S', 41, 40, ENTRANCE, BERTH1, 3),
  ...leg('S', 82, 600, BERTH1, BERTH1, 0),
  ...leg('S', 683, 40, BERTH1, ENTRANCE, 3),
  ...leg('S', 724, 20, ENTRANCE, SEA, 8),
];
// Tug: leaves home, meets the ship at the entrance, rides it to berth, goes
// home; does the same on departure.
const tug = [
  ...leg('T', 20, 20, TUG_HOME, ENTRANCE, 6).map((r, i) =>
    i === 0 ? { ...r, sog: 0 } : r,
  ),
  ...leg('T', 41, 40, ENTRANCE, BERTH1, 3),
  ...leg('T', 82, 10, BERTH1, TUG_HOME, 5),
  ...leg('T', 93, 560, TUG_HOME, TUG_HOME, 0),
  ...leg('T', 660, 20, TUG_HOME, BERTH1, 5),
  ...leg('T', 683, 40, BERTH1, ENTRANCE, 3),
  ...leg('T', 724, 20, ENTRANCE, TUG_HOME, 6),
  ...leg('T', 745, 30, TUG_HOME, TUG_HOME, 0),
];
// Pilot boat: rides 20 m off the ship for 4 minutes in, and 4 minutes out.
const alongside = (fromMin, toMin) =>
  ship
    .filter((r) => r.t >= T0 + fromMin * MIN && r.t <= T0 + toMin * MIN)
    .map((r) => ({ ...r, mmsi: 'P', lat: r.lat + 0.0002 }));
const pilot = [
  ...alongside(20, 24),
  ...leg('P', 26, 30, SEA, TUG_HOME, 10),
  ...alongside(730, 734),
];

test('harbor craft roles come from AIS type codes or the name', () => {
  assert.equal(craftRoleFor({ aisVesselType: 52 }), 'tug');
  assert.equal(craftRoleFor({ aisVesselType: 31 }), 'tug');
  assert.equal(craftRoleFor({ aisVesselType: 50 }), 'pilot');
  assert.equal(
    craftRoleFor({ aisVesselType: 90, name: 'HUENEME PILOT' }),
    'pilot',
  );
  assert.equal(craftRoleFor({ aisVesselType: 70, name: 'DOLE PACIFIC' }), null);
});

test('positions interpolate between fixes and stop at long gaps', () => {
  const track = [
    { t: 0, lon: 0, lat: 0, sog: 1 },
    { t: 2 * MIN, lon: 2, lat: 2, sog: 1 },
    { t: 60 * MIN, lon: 9, lat: 9, sog: 1 },
  ];
  assert.deepEqual(
    [positionAt(track, MIN).lon, positionAt(track, MIN).lat],
    [1, 1],
  );
  assert.equal(positionAt(track, 30 * MIN), null);
  assert.equal(positionAt(track, -1), null);
});

test('contact windows need the craft close for long enough', () => {
  const w = contactWindows(ship, tug, { maxDistanceM: 150, minMinutes: 4 });
  assert.equal(w.length >= 2, true);
  assert.equal(w[0].startMs <= T0 + 41 * MIN, true);
});

test('the berth stay and berth id come from the still run in the berth zone', () => {
  const [call] = splitCalls(ship, PORT_OF_HUENEME).filter(
    (c) => c.kind === 'port-call',
  );
  const stay = berthStay(call.records);
  assert.equal(stay.letGoMs - stay.allFastMs >= 599 * MIN, true);
  assert.equal(
    nearestBerth(stay.lon, stay.lat, HUENEME_BERTH_POINTS).id,
    'berth-1',
  );
});

test('a call is rebuilt from pilot boarding to the last tug release', () => {
  const [call] = splitCalls(ship, PORT_OF_HUENEME).filter(
    (c) => c.kind === 'port-call',
  );
  const craft = [
    { mmsi: 'T', name: 'TUG', role: 'tug', records: tug },
    { mmsi: 'P', name: 'PILOT', role: 'pilot', records: pilot },
  ];
  const r = reconstructCall(call, craft, {
    berthPoints: HUENEME_BERTH_POINTS,
    shipLengthM: 180,
  });
  assert.equal(r.berthId, 'berth-1');
  const m = r.milestones;
  assert.ok(m.pilotOnMs, 'pilot boarding found');
  assert.ok(
    m.tugFirstFastMs >= T0 + 35 * MIN && m.tugFirstFastMs <= T0 + 45 * MIN,
  );
  assert.ok(m.pilotOnMs < m.tugFirstFastMs && m.tugFirstFastMs < m.allFastMs);
  assert.ok(m.letGoMs < m.tugLastReleaseMs);
  assert.equal(r.window.startMs, m.pilotOnMs);
  assert.ok(r.phases.atBerth.hours > 9.9);
  const tugJobs = r.craftJobs.filter((j) => j.role === 'tug');
  assert.deepEqual(
    tugJobs.map((j) => j.leg),
    ['inbound', 'outbound'],
  );
  // The tug job runs from leaving its own berth, before it reached the ship.
  assert.ok(tugJobs[0].jobStartMs <= T0 + 21 * MIN);
  assert.deepEqual(r.flags, []);
});

test('without craft the window falls back to the harbor geofence, flagged', () => {
  const [call] = splitCalls(ship, PORT_OF_HUENEME).filter(
    (c) => c.kind === 'port-call',
  );
  const r = reconstructCall(call, [], { berthPoints: HUENEME_BERTH_POINTS });
  assert.ok(r.window.startMs);
  assert.match(r.sources.inboundStartMs, /assumed/);
  assert.equal(r.flags.length, 2);
});

test('craft emissions: diesel by tier, electric moves energy to the grid', () => {
  const spec = {
    ratedKw: 1000,
    loadFactor: 0.5,
    tier: 'tier3',
    powertrain: 'diesel',
  };
  const d = craftEmissions(spec, 2);
  assert.equal(d.shaftKwh, 1000);
  assert.equal(d.grams.nox, 5600);
  assert.ok(Math.abs(d.grams.co2 - 1000 * 213 * 3.206) < 1e-6);
  const t4 = craftEmissions({ ...spec, tier: 'tier4' }, 2);
  assert.ok(t4.grams.nox < d.grams.nox);
  const e = craftEmissions({ ...spec, powertrain: 'electric' }, 2);
  assert.equal(e.grams.nox, 0);
  assert.ok(e.gridKwh > e.shaftKwh);
});

test('scenario: shore power and electric tugs cut the call total', () => {
  const [call] = splitCalls(ship, PORT_OF_HUENEME).filter(
    (c) => c.kind === 'port-call',
  );
  const craft = [{ mmsi: 'T', name: 'TUG', role: 'tug', records: tug }];
  const rebuilt = reconstructCall(call, craft, {
    berthPoints: HUENEME_BERTH_POINTS,
    shipLengthM: 180,
  });
  // Hueneme needs no pilot: a tug alone never stands in for one.
  assert.equal(rebuilt.milestones.pilotOnMs, null);
  assert.equal(rebuilt.milestones.pilotOffMs, null);
  assert.equal(
    rebuilt.craftJobs.some((j) => j.role === 'pilot'),
    false,
  );
  const vessel = { shipType: 'Reefer', subtype: 'All Reefer', keelYear: 2010 };
  const base = callEmissions(call, rebuilt, { vessel });
  const scen = callEmissions(call, rebuilt, {
    vessel,
    scenario: { shorePower: true, tugPowertrain: 'electric' },
  });
  assert.ok(base.ship.tonnes.co2 > 0 && base.craftTonnes.co2 > 0);
  assert.ok(scen.total.co2e < base.total.co2e);
  assert.equal(scen.craftTonnes.nox, 0);
  assert.ok(scen.gridKwh > 0);
  assert.equal(base.gridKwh, 0);
});

test('berth use notes cover berths 1-9 and mark the Navy berths', () => {
  for (let n = 1; n <= 9; n++) assert.ok(HUENEME_BERTH_USE[`berth-${n}`]);
  assert.equal(HUENEME_BERTH_USE['berth-4'].mainUse, 'ro-ro');
  assert.equal(HUENEME_BERTH_USE['berth-5'].operator, 'shared');
  assert.equal(HUENEME_BERTH_USE['berth-7'].operator, 'navy');
});
