import assert from 'node:assert/strict';
import test from 'node:test';
import { runScenario } from './scenario.js';
import {
  LIBRARY_KEY,
  baselineScenario,
  billsCsv,
  compareRuns,
  decodeScenario,
  encodeScenario,
  exportScenarioJson,
  importScenarioJson,
  loadCsv,
  normalizeScenario,
  paybackYears,
  planMix,
  readLibrary,
  removeFromLibrary,
  saveToLibrary,
  scenarioFromSearch,
  scenarioLink,
  uniqueName,
  writeLibrary,
  zeroEmissionCapex,
} from './scenarioStore.js';

const memoryStorage = () => {
  const map = new Map();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, value),
  };
};

const allElectric = normalizeScenario({
  name: 'All-electric UTRs + battery',
  fleet: { utr: { electric: 27, diesel: 0 } },
  battery: { kwh: 1000, kw: 500 },
});

test('a default scenario runs the same as the engine default', () => {
  const plain = runScenario({});
  const cleaned = runScenario(normalizeScenario({}));
  assert.equal(cleaned.totals.electricityCost, plain.totals.electricityCost);
  assert.equal(cleaned.totals.dieselGallons, plain.totals.dieselGallons);
});

test('normalizing drops junk and clamps numbers', () => {
  const s = normalizeScenario({
    name: 'x'.repeat(200),
    year: 1900,
    tariffId: 'NOPE',
    strategy: 'nope',
    callScale: 99,
    reserve: -1,
    fleet: { utr: { electric: -4, diesel: 'abc' }, submarine: { electric: 9 } },
    battery: { kwh: 500, kw: 0 },
    shorePowerTypes: ['Refrigerated', 'Spaceship'],
    evil: '<script>',
  });
  assert.equal(s.name.length, 80);
  assert.equal(s.year, 2023);
  assert.equal(s.tariffId, 'SCE-TOU-8-D');
  assert.equal(s.strategy, 'asap');
  assert.equal(s.callScale, 3);
  assert.equal(s.reserve, 0);
  assert.deepEqual(s.fleet, { utr: { electric: 0, diesel: 0, chargers: 0 } });
  assert.equal(s.battery, null);
  assert.deepEqual(s.shorePowerTypes, ['Refrigerated']);
  assert.equal('evil' in s, false);
  assert.doesNotThrow(() => runScenario(s));
});

test('a scenario survives a round trip through a link and a file', () => {
  const token = encodeScenario(allElectric);
  assert.match(token, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeScenario(token), allElectric);
  const link = scenarioLink(allElectric, '/scenarios', 'https://example.test');
  assert.deepEqual(scenarioFromSearch(new URL(link).search), allElectric);
  assert.deepEqual(
    importScenarioJson(exportScenarioJson(allElectric)),
    allElectric,
  );
  const accented = normalizeScenario({ name: 'Año 2030 · café ⚡' });
  assert.equal(decodeScenario(encodeScenario(accented)).name, accented.name);
});

test('broken links and files give null, not an error', () => {
  assert.equal(decodeScenario('not base64 !!'), null);
  assert.equal(decodeScenario(''), null);
  assert.equal(decodeScenario('WzEsMl0'), null); // an array
  assert.equal(scenarioFromSearch('?other=1'), null);
  assert.equal(importScenarioJson('{oops'), null);
});

test('the library saves, updates, renames around clashes and deletes', () => {
  const storage = memoryStorage();
  let library = readLibrary(storage);
  assert.deepEqual(library.items, []);
  assert.equal(baselineScenario(library).name, 'Fleet plan, as today');

  const first = saveToLibrary(library, allElectric, undefined, 1000);
  library = { ...first.library, baselineId: first.id };
  assert.equal(uniqueName(library, allElectric.name), `${allElectric.name} 2`);
  const second = saveToLibrary(
    library,
    { ...allElectric, name: 'Other', year: 2030 },
    undefined,
    2000,
  );
  library = second.library;
  assert.notEqual(first.id, second.id);
  library = saveToLibrary(
    library,
    { ...allElectric, shorePower: true },
    first.id,
    3000,
  ).library;
  assert.equal(library.items.length, 2);
  assert.equal(writeLibrary(storage, library), true);

  const back = readLibrary(storage);
  assert.equal(back.items.length, 2);
  assert.equal(back.items[0].scenario.shorePower, true);
  assert.equal(baselineScenario(back).name, allElectric.name);

  const after = removeFromLibrary(back, first.id);
  assert.equal(after.items.length, 1);
  assert.equal(after.baselineId, null);

  storage.setItem(LIBRARY_KEY, '{"items":"nope"}');
  assert.deepEqual(readLibrary(storage).items, []);
  assert.equal(
    writeLibrary(
      {
        setItem: () => {
          throw new Error('full');
        },
      },
      library,
    ),
    false,
  );
});

test('comparison marks what got better and worse against the baseline', () => {
  const base = runScenario(baselineScenario({ items: [], baselineId: null }));
  const run = runScenario(allElectric);
  const rows = compareRuns(base, [base, run]);
  const row = (id) => rows.find((r) => r.id === id);
  for (const r of rows) assert.equal(r.cells[0].tone, 'flat');
  assert.equal(row('gallons').cells[1].tone, 'good');
  assert.equal(row('co2').cells[1].tone, 'good');
  assert.equal(row('electricity').cells[1].tone, 'bad');
  assert.ok(row('spend').cells[1].delta < 0);
  // 27 electric UTRs against 2 in 2023, at 370k - 120k voucher + 100k infra.
  assert.equal(
    zeroEmissionCapex(run) - zeroEmissionCapex(base),
    (27 - base.fleets.utr.electric) * 350_000,
  );
  assert.ok(paybackYears(base, run) > 0);
  assert.equal(paybackYears(base, base), null);
});

test('planMix follows the fleet plan and is null outside it', () => {
  assert.deepEqual(planMix(2026, 'utr'), {
    diesel: 20,
    electric: 7,
    chargers: 7,
  });
  assert.deepEqual(planMix(2039, 'utr'), {
    diesel: 0,
    electric: 27,
    chargers: 27,
  });
  assert.equal(planMix(2026, 'light_duty'), null);
});

test('CSV exports have one row per month and per 15 minutes', () => {
  const run = runScenario(allElectric);
  const bills = billsCsv(run).split('\n');
  assert.equal(bills.length, 13);
  assert.equal(bills[0], 'month,kwh,max_kw,energy_usd,demand_usd,total_usd');
  const load = loadCsv(run).split('\n');
  assert.equal(load.length, run.meterKw.length + 1);
  assert.match(load[1], /^2026-01-01 00:00,/);
});
