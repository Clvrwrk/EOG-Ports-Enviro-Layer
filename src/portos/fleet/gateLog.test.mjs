// Gate log: VIN checks and decoding, reading gate and registration
// spreadsheets, the fleet summary and the EV swap scenario. VINs below are
// made up (valid check digits), not real trucks.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  NOT_REGISTERED,
  evSwapScenario,
  gateRowsFromCsv,
  readDate,
  readGateRow,
  readTime,
  registrationsFromCsv,
  summarizeGateLog,
} from './gateLog.js';
import {
  decodeVin,
  engineBand,
  lookupVins,
  vinModelYear,
  vinProblem,
} from './vin.js';

const NOW = new Date('2026-11-10T12:00:00Z');
const V2012 = '1FUJGLDR2CLBK1234'; // Freightliner 2012
const V2014 = '1XKYD49X3EJ123456'; // Kenworth 2014
const V2007 = '1FUJA6CK57LX12345'; // Freightliner 2007
const V2024 = '4V4NC9EH5RN654321'; // Volvo 2024

test('VIN check digit, letters and length', () => {
  assert.equal(vinProblem('1M8GDM9AXKP042788'), null); // textbook example
  assert.equal(vinProblem(V2012), null);
  assert.equal(vinProblem(' 1fujgldr2-clbk1234 '), null);
  assert.match(vinProblem('1FUJGLDR3CLBK1234'), /check digit.*should be 2/);
  assert.match(vinProblem('1FUJGLDR2CLBK123'), /17 characters/);
  assert.match(vinProblem('1FUJGLDR2CLBK12O4'), /I, O or Q/);
  assert.match(vinProblem(''), /missing/);
});

test('model year, make and engine band from the VIN', () => {
  assert.equal(vinModelYear(V2012, { now: NOW }), 2012);
  assert.equal(vinModelYear(V2007, { now: NOW }), 2007);
  // 'Y' is 2000 or 2030; 2030 is after next year, so 2000.
  assert.equal(vinModelYear('1FUYDSEB0YPA12345', { now: NOW }), 2000);
  const d = decodeVin(V2024, { now: NOW });
  assert.equal(d.make, 'Volvo');
  assert.equal(d.modelYear, 2024);
  assert.equal(d.ageYears, 2);
  assert.equal(d.band.id, 'y2024_on');
  assert.equal(engineBand(2009).californiaOk, false);
  assert.equal(engineBand(2010).californiaOk, true);
  assert.equal(engineBand(1995).id, 'pre_1998');
  assert.equal(decodeVin('NOTAVIN').valid, false);
});

test('dates and times in the forms staff write them', () => {
  assert.equal(readDate('2026-11-10'), '2026-11-10');
  assert.equal(readDate('11/10/2026'), '2026-11-10');
  assert.equal(readDate('1/2/26'), '2026-01-02');
  assert.equal(readDate('2/30/2026'), null);
  assert.equal(readTime('6:05'), '06:05');
  assert.equal(readTime('6:05 pm'), '18:05');
  assert.equal(readTime('12:10 a.m.'), '00:10');
  assert.equal(readTime('1805'), '18:05');
  assert.equal(readTime('6 PM'), '18:00');
  assert.equal(readTime('6'), null);
  assert.equal(readTime('25:00'), null);
  assert.equal(readTime('three'), null);
});

test('a gate row: dates, overnight visits and checks', () => {
  assert.deepEqual(
    readGateRow({
      vin: V2012,
      date: '11/10/2026',
      timeIn: '7:15',
      timeOut: '8:02',
    }),
    {
      row: {
        vin: V2012,
        timeIn: '2026-11-10T07:15',
        timeOut: '2026-11-10T08:02',
      },
    },
  );
  assert.equal(
    readGateRow({
      vin: V2012,
      date: '2026-11-10',
      timeIn: '23:30',
      timeOut: '0:20',
    }).row.timeOut,
    '2026-11-11T00:20',
  );
  assert.equal(
    readGateRow({ vin: V2012, timeIn: '2026-11-10 07:00' }).row.timeOut,
    null,
  );
  assert.match(readGateRow({ vin: 'x', timeIn: '7:00' }).error, /17/);
  assert.match(readGateRow({ vin: V2012, timeIn: '7:00' }).error, /no date/);
  assert.match(
    readGateRow({ vin: V2012, date: '2026-11-10', timeIn: 'noonish' }).error,
    /not a time/,
  );
  assert.match(
    readGateRow({
      vin: V2012,
      timeIn: '2026-11-10 07:00',
      timeOut: '2026-11-12 07:00',
    }).error,
    /24 hours/,
  );
});

const GATE_CSV = `Date,VIN,Time In,Time Out,Guard
11/10/2026,${V2012},6:10,6:55,AB
11/10/2026,${V2012},9:40,10:30,AB
11/10/2026,${V2014},6:20,7:50,AB
11/10/2026,${V2007},14:05,14:35,CD
11/11/2026,${V2012},6:15,7:00,AB
11/11/2026,${V2024},6:40,7:20,AB
11/11/2026,1FUJGLDR3CLBK1234,7:00,7:30,AB
`;

test('gate rows from a spreadsheet, with bad rows reported', () => {
  const { rows, errors, unknownColumns } = gateRowsFromCsv(GATE_CSV);
  assert.equal(rows.length, 6);
  assert.deepEqual(unknownColumns, ['Guard']);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].line, 8);
  assert.match(errors[0].problem, /check digit/);
  const alt = gateRowsFromCsv(
    `VIN Number,Entry,Exit\n${V2014},2026-11-10 06:00,2026-11-10 06:40\n`,
  );
  assert.equal(alt.rows[0].timeOut, '2026-11-10T06:40');
  assert.match(gateRowsFromCsv('Plate,Time\nX,1\n').errors[0].problem, /VIN/);
});

const REG_CSV = `Dispatching Carrier/Broker,Contact Name,Phone,VIN,Entry Date and Time,Driver Name
Coastal Dray LLC,Pat,555,${V2007},11/03/2026 06:00,Sam
Harbor Haul Inc,Lee,555,${V2007},11/09/2026 06:00,Kim
Coastal Dray LLC,Pat,555,${V2012},11/04/2026 07:00,Sam
`;

test('registrations link each VIN to the carrier that registered it first', () => {
  const { byVin, changed, errors } = registrationsFromCsv(REG_CSV);
  assert.deepEqual(errors, []);
  assert.deepEqual(byVin.get(V2007), {
    carrier: 'Coastal Dray LLC',
    since: '2026-11-03',
  });
  assert.equal(byVin.get(V2012).carrier, 'Coastal Dray LLC');
  assert.deepEqual(changed, [
    { vin: V2007, carrier: 'Coastal Dray LLC', later: 'Harbor Haul Inc' },
  ]);
  // Only VIN, carrier and date are kept: no names or phone numbers.
  assert.deepEqual(Object.keys(byVin.get(V2012)), ['carrier', 'since']);
});

test('summary: visits, time on terminal, diesel age and carriers', () => {
  const { rows } = gateRowsFromCsv(GATE_CSV);
  const { byVin } = registrationsFromCsv(REG_CSV);
  const s = summarizeGateLog(rows, { registrations: byVin, now: NOW });
  assert.equal(s.visits, 6);
  assert.equal(s.trucks, 4);
  assert.equal(s.days, 2);
  assert.equal(s.visitsPerDay, 3);
  assert.deepEqual(s.byDay, [
    { date: '2026-11-10', visits: 4, trucks: 3 },
    { date: '2026-11-11', visits: 2, trucks: 2 },
  ]);
  assert.equal(s.byHour[6], 4);
  assert.equal(s.dwellMinutes.median, 45);
  const band = (id) => s.bands.find((b) => b.band.id === id);
  assert.deepEqual(
    [band('y2010_2023').trucks, band('y2010_2023').visits],
    [2, 4],
  );
  assert.equal(band('y2007_2009').visits, 1);
  assert.deepEqual(s.californiaNotOk, { trucks: 1, visits: 1 });
  assert.deepEqual(s.byCarrier[0], {
    key: 'Coastal Dray LLC',
    trucks: 2,
    visits: 4,
  });
  assert.equal(s.byCarrier[1].key, NOT_REGISTERED);
  assert.equal(s.medianAgeYears, 13);
});

test('NHTSA lookup overrides make and model year', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(init.body.get('data'));
    return {
      ok: true,
      json: async () => ({
        Results: [
          {
            VIN: V2014,
            Make: 'KENWORTH',
            Model: 'T680',
            ModelYear: '2015',
            FuelTypePrimary: 'Diesel',
          },
        ],
      }),
    };
  };
  const lookups = await lookupVins([V2014, V2014, 'bad'], { fetchImpl });
  assert.deepEqual(calls, [V2014]);
  const s = summarizeGateLog(
    [{ vin: V2014, timeIn: '2026-11-10T06:00', timeOut: null }],
    { lookups, now: NOW },
  );
  assert.equal(s.truckList[0].model, 'T680');
  assert.equal(s.truckList[0].modelYear, 2015);
  assert.equal(s.truckList[0].fuel, 'Diesel');
});

test('EV swap replaces the oldest diesel visits first', () => {
  const { rows } = gateRowsFromCsv(GATE_CSV);
  const s = summarizeGateLog(rows, { now: NOW });
  const none = evSwapScenario(s, { evTrucks: 0 });
  assert.equal(none.perDay.saved.noxKg, 0);
  assert.ok(none.perDay.baseline.noxKg > 0);
  // One EV, one trip a day: replaces the 2007 truck's half visit per day
  // first, then half a visit from the 2010-2023 band.
  const one = evSwapScenario(s, { evTrucks: 1, tripsPerTruck: 1 });
  assert.equal(one.evVisitsPerDay, 1);
  assert.deepEqual(
    one.displaced.map((d) => [d.band.id, d.visitsPerDay]),
    [
      ['y2007_2009', 0.5],
      ['y2010_2023', 0.5],
    ],
  );
  assert.ok(one.perDay.saved.noxKg > 0);
  assert.ok(one.perDay.saved.co2Kg > 0);
  assert.ok(one.evEnergyKwhPerDay > 0);
  // Can't replace more visits than the port has.
  const many = evSwapScenario(s, { evTrucks: 50, tripsPerTruck: 4 });
  assert.equal(many.evVisitsPerDay, 3);
  assert.ok(Math.abs(many.perDay.scenario.noxKg) < 1e-9);
  assert.equal(many.perYear.saved.noxKg, many.perDay.saved.noxKg * 260);
});

test('carrier and charging-site asset types use the planner charge sites', async () => {
  const { ASSET_CLASSES, CHARGE_SITE_KINDS, fieldOf, readValue } =
    await import('../assetClasses.js');
  const { CHARGE_LOCATIONS } = await import('./planner.js');
  assert.deepEqual(
    CHARGE_SITE_KINDS.map((o) => o.value),
    Object.keys(CHARGE_LOCATIONS),
  );
  assert.equal(ASSET_CLASSES.charging_site.group, 'landside');
  assert.deepEqual(readValue(fieldOf('charging_site', 'kind'), 'WattEV'), {
    value: 'third_party',
  });
  assert.equal(
    fieldOf('drayage_truck', 'carrierId').refClass,
    'drayage_carrier',
  );
  assert.match(
    readValue(fieldOf('drayage_carrier', 'usdot'), 'abc').error,
    /look like/,
  );
});
