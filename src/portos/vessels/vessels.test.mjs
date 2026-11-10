import assert from 'node:assert/strict';
import test from 'node:test';
import { createVesselRegistry } from '../../emissions/vesselRegistry.js';
import { loadVesselInventory } from './load.js';
import {
  cargoClassFromType,
  emissionsProfile,
  emissionsProfiles,
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

test('engines and shore power feed the EPA emissions method', () => {
  const vessel = normalizeVessel({
    name: 'reefer one',
    imo: '9000001',
    mmsi: '111000001',
    cargoClass: 'reefer',
    yearBuilt: 2007,
    draftM: 10.1,
    engines: {
      main: {
        make: 'MAN-B&W',
        model: '7S60MC-C',
        kw: 15820,
        engineType: 'SSD',
        source: 'registry page',
      },
      epa: {
        shipType: 'Container Ship',
        subtype: '3,000 TEU',
        basis: 'Table 3.4',
      },
      auxKw: {
        transit: 1230,
        maneuvering: 1800,
        hotelling: 700,
        anchorage: 1230,
      },
      boilerKw: {
        transit: 0,
        maneuvering: 350,
        hotelling: 350,
        anchorage: 350,
      },
      loadsSource: 'Appendix E',
    },
    shorePower: { capable: true, source: 'operator release' },
    estimated: ['engines.auxKw', 'engines.boilerKw'],
    source: 'test',
  });
  assert.deepEqual(validateInventory({ vessels: [vessel] }), []);
  const profile = emissionsProfile(vessel);
  assert.equal(profile.propulsion.installedKw, 15820);
  assert.equal(profile.auxKw.hotelling, 700);
  assert.equal(profile.shorePowerCapable, true);
  assert.ok(profile.estimated.includes('engines.auxKw'));
  // The registry in src/emissions accepts the profile as a row.
  const registry = createVesselRegistry([profile]);
  assert.equal(registry.lookup({ imo: '9000001' }).subtype, '3,000 TEU');
  // A ship without engine data has no profile, and claims need a source.
  assert.equal(emissionsProfile(normalizeVessel(SAMPLE.vessels[1])), null);
  const unsourced = normalizeVessel({
    name: 'X',
    imo: '9000009',
    source: 's',
    shorePower: true,
  });
  assert.ok(
    validateInventory({ vessels: [unsourced] })[0].includes('shore power'),
  );
});

test('every published ship with engine data makes a valid emissions row', async () => {
  const { readFile } = await import('node:fs/promises');
  const raw = JSON.parse(
    await readFile(
      new URL(
        '../../../public/data/vessels/port-of-hueneme.json',
        import.meta.url,
      ),
    ),
  );
  const inventory = normalizeInventory(raw);
  assert.deepEqual(validateInventory(inventory), []);
  const rows = emissionsProfiles(inventory);
  assert.ok(rows.length > 200);
  assert.ok(createVesselRegistry(rows).size > 200);
});
