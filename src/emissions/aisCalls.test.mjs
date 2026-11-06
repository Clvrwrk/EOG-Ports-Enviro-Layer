import assert from 'node:assert/strict';
import test from 'node:test';
import {
  callIntervals,
  groupByVessel,
  parseMarineCadastreRow,
  splitCalls,
} from './aisCalls.js';
import { PORT_OF_HUENEME } from './ports.js';

const T0 = Date.parse('2024-03-01T00:00:00Z');
const rec = (minutes, lon, lat, sog, mmsi = '111') => ({
  mmsi,
  t: T0 + minutes * 60_000,
  lon,
  lat,
  sog,
});

test('MarineCadastre rows parse into records and reject unusable rows', () => {
  const r = parseMarineCadastreRow({
    MMSI: '367000001',
    BaseDateTime: '2024-03-01T00:00:00',
    LAT: '34.15',
    LON: '-119.207',
    SOG: '0.1',
    Draft: '9.5',
    IMO: 'IMO9000001',
    VesselType: '70',
  });
  assert.equal(r.t, T0);
  assert.equal(r.imo, '9000001');
  assert.equal(r.draft, 9.5);
  assert.equal(r.aisVesselType, 70);
  assert.equal(parseMarineCadastreRow({ MMSI: '', BaseDateTime: 'x' }), null);
  assert.equal(
    parseMarineCadastreRow({
      MMSI: '1',
      BaseDateTime: '2024-03-01T00:00:00',
      LAT: 'a',
      LON: '1',
    }),
    null,
  );
  // 102.3 kn is the AIS "not available" value.
  assert.equal(
    parseMarineCadastreRow({
      MMSI: '1',
      BaseDateTime: '2024-03-01T00:00:00',
      LAT: '1',
      LON: '1',
      SOG: '102.3',
    }).sog,
    null,
  );
});

const arrival = [
  rec(0, -119.2095, 33.95, 14), // ~11.6 nm out: approach
  rec(60, -119.2095, 34.1, 8), // approach
  rec(90, -119.209, 34.144, 4), // harbor entrance
  rec(100, -119.207, 34.152, 0.3), // berth
  rec(400, -119.207, 34.152, 0.2), // berth
  rec(700, -119.207, 34.152, 0.2), // berth, 10 h after arrival
  rec(720, -119.209, 34.144, 5), // leaving
  rec(780, -119.2095, 33.4, 14), // outside the domain
];

test('a run that reaches a berth is a port call; one that does not is passage', () => {
  const calls = splitCalls(arrival, PORT_OF_HUENEME);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].kind, 'port-call');
  assert.equal(calls[0].records.length, 7);

  const passing = splitCalls(
    [rec(0, -119.4, 34.0, 12), rec(30, -119.3, 34.0, 12)],
    PORT_OF_HUENEME,
  );
  assert.equal(passing[0].kind, 'passage');
});

test('long gaps split calls and are not filled', () => {
  const gappy = [
    rec(0, -119.207, 34.152, 0.2),
    rec(60 * 10, -119.207, 34.152, 0.2),
  ];
  assert.equal(splitCalls(gappy, PORT_OF_HUENEME).length, 2);
});

test('intervals take the mode of their starting record', () => {
  const [call] = splitCalls(arrival, PORT_OF_HUENEME);
  const vessel = { propulsion: { installedKw: 14_000, maxSpeedKn: 21 } };
  const intervals = callIntervals(call, vessel);
  assert.deepEqual(
    intervals.map((i) => i.mode),
    // 8 kn outside the entrance is under 20% load, so Table 3.11 calls it maneuvering.
    [
      'transit',
      'maneuvering',
      'maneuvering',
      'hotelling',
      'hotelling',
      'hotelling',
    ],
  );
  const hotelHours = intervals
    .filter((i) => i.mode === 'hotelling')
    .reduce((s, i) => s + i.hours, 0);
  assert.equal(hotelHours, 620 / 60);
});

test('records group by MMSI and skip nulls', () => {
  const groups = groupByVessel([
    rec(0, 0, 0, 0, 'a'),
    null,
    rec(1, 0, 0, 0, 'b'),
    rec(2, 0, 0, 0, 'a'),
  ]);
  assert.equal(groups.get('a').length, 2);
  assert.equal(groups.size, 2);
});
