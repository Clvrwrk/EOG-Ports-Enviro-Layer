import assert from 'node:assert/strict';
import test from 'node:test';
import { loadVesselInventory } from './load.js';
import {
  cargoClassFromType,
  inventorySummary,
  mergeCallHistory,
  normalizeInventory,
  normalizeVessel,
  validateInventory,
  vesselLine,
  vesselsAtBerth,
} from './registry.js';

const SAMPLE = {
  port: 'test-port',
  vessels: [
    {
      name: 'reefer one',
      mmsi: '111000001',
      imo: '9000001',
      cargoClass: 'Refrigerated',
      grossTonnage: 22801,
      lengthM: 204.4,
      yearBuilt: 2007,
      deadweight: 0,
      source: 'test',
    },
    {
      name: 'REEFER TWO',
      mmsi: '111000002',
      imo: '9000002',
      cargoClass: 'reefer',
      source: 'test',
    },
    {
      name: 'CAR CARRIER',
      mmsi: '111000003',
      cargoClass: 'Ro-Ro/Vehicles Carrier',
      source: 'test',
    },
  ],
};

const CALLS = {
  source: 'test schedule',
  vessels: {
    'imo-9000001': { count: 5, berths: { 'berth-2': 4, 'berth-1': 1 } },
    'imo-9000002': { count: 9, berths: { 'berth-2': 9 } },
    111000003: { count: 2, berths: { 'berth-4': 2 } },
  },
};

test('cargo classes map from the port schedule labels', () => {
  assert.equal(cargoClassFromType('Refrigerated'), 'reefer');
  assert.equal(cargoClassFromType('Ro-Ro/Vehicles Carrier'), 'roro');
  assert.equal(cargoClassFromType('Oil/Chemical Tanker'), 'tanker');
  assert.equal(cargoClassFromType('Heavy Lift'), 'heavy_lift');
  assert.equal(cargoClassFromType('General Cargo'), 'general_cargo');
  assert.equal(cargoClassFromType('Other Cargo'), 'other');
});

test('normalizing keys a vessel by IMO and drops zero sizes', () => {
  const v = normalizeVessel(SAMPLE.vessels[0]);
  assert.equal(v.id, 'imo-9000001');
  assert.equal(v.name, 'REEFER ONE');
  assert.equal(v.cargoClass, 'reefer');
  assert.equal(v.particulars.grossTonnage, 22801);
  assert.equal(v.particulars.deadweight, null);
  assert.equal(normalizeVessel(SAMPLE.vessels[2]).id, 'mmsi-111000003');
});

test('validation catches missing source, bad IMO and duplicates', () => {
  const inv = normalizeInventory(SAMPLE);
  assert.deepEqual(validateInventory(inv), []);
  const bad = normalizeInventory({
    vessels: [
      { name: 'A', imo: '123', source: 's' },
      { name: 'B', imo: '123' },
    ],
  });
  const problems = validateInventory(bad);
  assert.ok(problems.some((p) => p.includes('not 7 digits')));
  assert.ok(problems.some((p) => p.includes('duplicate id')));
  assert.ok(problems.some((p) => p.includes('missing source')));
});

test('call history joins by id or MMSI and ranks ships at a berth', () => {
  const inv = mergeCallHistory(normalizeInventory(SAMPLE), CALLS);
  const at2 = vesselsAtBerth(inv, 'berth-2');
  assert.deepEqual(
    at2.map((v) => v.name),
    ['REEFER TWO', 'REEFER ONE'],
  );
  assert.equal(
    vesselsAtBerth(inv, 'berth-4', { cargoClass: 'reefer' }).length,
    0,
  );
  assert.deepEqual(inventorySummary(inv), {
    reefer: { ships: 2, calls: 14 },
    roro: { ships: 1, calls: 2 },
  });
  assert.equal(
    vesselLine(inv.vessels[0]),
    'REEFER ONE (204 m, 22,801 GT, built 2007)',
  );
});

test('the loader prefers the private file and survives missing files', async () => {
  const served = {
    '/data/vessels/p.json': { vessels: [{ name: 'PUBLIC', source: 's' }] },
    '/private/vessels/calls.json': { vessels: { 'imo-9000001': { count: 1 } } },
  };
  const fetchImpl = async (url) => ({
    ok: url in served,
    headers: { get: () => 'application/json' },
    json: async () => served[url],
  });
  const urls = {
    particulars: ['/private/vessels/p.json', '/data/vessels/p.json'],
    calls: '/private/vessels/calls.json',
  };
  const inv = await loadVesselInventory({ urls, fetchImpl });
  assert.equal(inv.vessels[0].name, 'PUBLIC');
  const empty = await loadVesselInventory({
    urls,
    fetchImpl: async () => {
      throw new Error('offline');
    },
  });
  assert.deepEqual(empty.vessels, []);
});
