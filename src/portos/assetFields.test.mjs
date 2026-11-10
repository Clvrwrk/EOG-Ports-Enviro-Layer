// Typed data entry for the asset registry: no free text feeds a formula.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ASSET_CLASSES,
  fieldOf,
  imoValid,
  migrateAsset,
  readValue,
  validateRegistry,
} from './assetClasses.js';
import { HUENEME_REGISTRY } from './hueneme.js';

/** Fields that stay free text: names and notes, which no formula reads. */
const FREE_TEXT = new Set(['label', 'notes']);

test('only names and notes are free text', () => {
  for (const [cls, definition] of Object.entries(ASSET_CLASSES))
    for (const field of definition.fields)
      if (field.type === 'text')
        assert.ok(
          FREE_TEXT.has(field.key),
          `${cls}.${field.key} is a free-text box`,
        );
});

test('every number has limits and counts are whole numbers', () => {
  for (const [cls, definition] of Object.entries(ASSET_CLASSES))
    for (const field of definition.fields) {
      if (['number', 'integer'].includes(field.type))
        assert.equal(typeof field.min, 'number', `${cls}.${field.key} min`);
      if (field.type === 'enum' || field.type === 'multi')
        assert.ok(field.options.length, `${cls}.${field.key} options`);
    }
  assert.equal(fieldOf('gate', 'lanes').type, 'integer');
  assert.equal(fieldOf('reefer_rack', 'plugs').type, 'integer');
  assert.equal(fieldOf('utr', 'annualHours').type, 'integer');
});

test('readValue takes "3" but refuses "three", "3.5" lanes and out-of-range', () => {
  const lanes = fieldOf('gate', 'lanes');
  assert.deepEqual(readValue(lanes, '3'), { value: 3 });
  assert.deepEqual(readValue(lanes, ' 1,200 ').error, 'must be at most 50');
  assert.match(readValue(lanes, 'three').error, /must be a number/);
  assert.match(readValue(lanes, '3.5').error, /whole number/);
  assert.match(readValue(lanes, '0').error, /at least 1/);
  const hours = fieldOf('gate', 'hoursPerDay');
  assert.deepEqual(readValue(hours, '16.5'), { value: 16.5 });
  assert.match(readValue(hours, '25').error, /at most 24/);
  assert.match(readValue(hours, '6am-10pm').error, /must be a number/);
});

test('dropdown values read from labels and older spellings', () => {
  const railroad = fieldOf('locomotive', 'railroad');
  for (const text of [
    'vcrr',
    'VCRR',
    'Ventura County Railroad',
    'ventura county railroad (genesee & wyoming)',
  ])
    assert.deepEqual(readValue(railroad, text), { value: 'vcrr' });
  assert.match(readValue(railroad, 'Vent Co RR').error, /not an option/);
  assert.deepEqual(readValue(fieldOf('meter', 'utility'), 'SCE'), {
    value: 'sce',
  });
  assert.deepEqual(readValue(fieldOf('berth', 'zone'), 'Joint Use'), {
    value: 'navy_terminal',
  });
  const cargo = fieldOf('berth', 'cargoTypes');
  assert.deepEqual(readValue(cargo, 'RoRo; Reefer containers; roro'), {
    value: ['roro', 'reefer_containers'],
  });
  assert.match(readValue(cargo, 'bananas').error, /"bananas" is not an option/);
});

test('codes are checked: MMSI, IMO check digit, reporting mark', () => {
  assert.equal(imoValid('9074729'), true);
  assert.equal(imoValid('9074728'), false);
  assert.match(
    readValue(fieldOf('tug', 'imo'), '9074728').error,
    /check digit/,
  );
  assert.deepEqual(readValue(fieldOf('tug', 'mmsi'), '367123450'), {
    value: '367123450',
  });
  assert.match(
    readValue(fieldOf('tug', 'mmsi'), '36712345').error,
    /look like/,
  );
  assert.deepEqual(
    readValue(fieldOf('locomotive', 'reportingMark'), ' vcrr   101 '),
    { value: 'VCRR 101' },
  );
});

test('choice values are tidied text', () => {
  const operator = fieldOf('berth', 'operator');
  assert.deepEqual(readValue(operator, '  Oxnard   Harbor District '), {
    value: 'Oxnard Harbor District',
  });
});

test('migrateAsset brings records from the old free-text form up to date', () => {
  const berth = migrateAsset({
    id: 'berth-4',
    class: 'berth',
    zone: 'North Terminal',
    shorePower: false,
    wharf: 'Wharf 2',
    cargo: 'RoRo vehicles; reefer containers occasionally',
    lengthM: '213',
  });
  assert.equal(berth.zone, 'north_terminal');
  assert.equal(berth.wharf, 'wharf_2');
  assert.equal(berth.lengthM, 213);
  assert.deepEqual(berth.cargoTypes, ['reefer_containers', 'roro']);
  assert.equal(berth.cargo, undefined);
  assert.match(berth.notes, /RoRo vehicles; reefer containers occasionally/);
  const gate = migrateAsset({
    id: 'gate-x',
    class: 'gate',
    lanes: '2',
    hours: '6 a.m. to 4 p.m. weekdays',
  });
  assert.equal(gate.lanes, 2);
  assert.equal(gate.hours, undefined);
  assert.match(gate.notes, /6 a\.m\. to 4 p\.m\. weekdays/);
  // Unreadable values stay for validation to report, never silently lost.
  const bad = migrateAsset({ id: 'g', class: 'gate', lanes: 'three' });
  assert.equal(bad.lanes, 'three');
  assert.deepEqual(validateRegistry({ assets: [bad] }), [
    'asset g: lanes must be a whole number',
  ]);
});

test('the Hueneme seed is valid and unchanged by migration', () => {
  assert.deepEqual(validateRegistry(HUENEME_REGISTRY), []);
  for (const asset of HUENEME_REGISTRY.assets)
    assert.deepEqual(migrateAsset(asset), asset, asset.id);
});
