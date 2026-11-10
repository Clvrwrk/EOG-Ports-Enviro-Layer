import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ASSET_CLASSES,
  ASSET_GROUPS,
  FIELD_TYPES,
  assetPosition,
  assetsByGroup,
  validateRegistry,
} from '../assetClasses.js';
import { HUENEME_REGISTRY } from '../hueneme.js';
import { dieselGphOf, pathLengthM } from '../huenemeAssets.js';
import { assetCard, registryCard } from './card.js';
import { loadAssetRegistry } from './load.js';
import { applyOverlay, mergeOverlay } from './overlay.js';

const byId = (registry, id) => registry.assets.find((a) => a.id === id);

test('every class lists its required fields in `fields`, with known types', () => {
  for (const [cls, definition] of Object.entries(ASSET_CLASSES)) {
    assert.ok(ASSET_GROUPS[definition.group], `${cls} has a known group`);
    const keys = definition.fields.map((field) => field.key);
    assert.equal(new Set(keys).size, keys.length, `${cls} repeats a field`);
    for (const key of definition.required)
      if (key !== 'class') assert.ok(keys.includes(key), `${cls} lists ${key}`);
    for (const field of definition.fields) {
      assert.ok(FIELD_TYPES.includes(field.type), `${cls}.${field.key} type`);
      if (field.type === 'enum') assert.ok(field.options.length > 0);
      if (field.type === 'ref') assert.ok(field.refClass);
    }
  }
});

test('the Hueneme registry covers buildings, yards, gates, rail and tugs', () => {
  const groups = assetsByGroup(HUENEME_REGISTRY);
  for (const group of Object.keys(ASSET_GROUPS))
    assert.ok(groups[group].length > 0, `${group} has assets`);
  const classes = new Set(HUENEME_REGISTRY.assets.map((a) => a.class));
  for (const cls of [
    'building',
    'yard',
    'gate',
    'rail_spur',
    'locomotive',
    'tug',
  ])
    assert.ok(classes.has(cls), `has a ${cls}`);
  // Every port-wide record says where it came from.
  for (const asset of HUENEME_REGISTRY.assets)
    if (
      ![
        'utr',
        'forklift',
        'reach_stacker',
        'mobile_harbor_crane',
        'charger',
        'shore_power',
        'meter',
      ].includes(asset.class)
    )
      assert.ok(asset.source, `${asset.id} has a source`);
});

test('validation checks field types, positions and either-class references', () => {
  const errors = validateRegistry({
    specs: {},
    assets: [
      { id: 'b1', class: 'building', use: 'castle' },
      { id: 'b2', class: 'building', use: 'office', at: [200, 0] },
      { id: 'g1', class: 'gate', lanes: 'two' },
      { id: 'y1', class: 'yard', use: 'laydown', outline: [[34, -119]] },
      {
        id: 'r1',
        class: 'rail_spur',
        path: [
          [34, -119],
          [34.1, -119.1],
        ],
      },
    ],
  });
  assert.ok(errors.some((e) => e.includes('b1: use must be one of')));
  assert.ok(errors.some((e) => e.includes('b2: at must be [lat, lon]')));
  assert.ok(errors.some((e) => e.includes('g1: lanes must be a number')));
  assert.ok(errors.some((e) => e.includes('y1: outline must be 3+')));
  assert.ok(!errors.some((e) => e.includes('r1')));
  // homeId may point at a berth, building or yard; meterId at the meter registry.
  assert.deepEqual(
    validateRegistry(
      {
        specs: { s: {} },
        assets: [
          { id: 'y', class: 'yard', use: 'laydown', meterId: 'reefer-502' },
          {
            id: 't',
            class: 'tug',
            powertrain: 'diesel',
            specId: 's',
            homeId: 'y',
          },
        ],
      },
      { meterIds: ['reefer-502'] },
    ),
    [],
  );
});

test('positions come from a point, else the middle of an outline or path', () => {
  assert.deepEqual(assetPosition({ at: [34, -119] }), { lat: 34, lon: -119 });
  const mid = assetPosition({
    outline: [
      [34, -119],
      [34.002, -119],
      [34.002, -119.002],
      [34, -119.002],
    ],
  });
  assert.ok(
    Math.abs(mid.lat - 34.001) < 1e-9 && Math.abs(mid.lon + 119.001) < 1e-9,
  );
  assert.equal(assetPosition({}), null);
  // Every Hueneme building, yard with a position, and rail spur can be placed.
  const spur = byId(HUENEME_REGISTRY, 'rail-south-spur');
  assert.ok(assetPosition(spur));
  assert.ok(spur.lengthM > 1000 && spur.lengthM < 3000, `${spur.lengthM} m`);
});

test('path length and per-unit diesel use', () => {
  // 0.001 degrees of latitude is about 111 m.
  assert.equal(
    pathLengthM([
      [34, -119],
      [34.001, -119],
    ]),
    111,
  );
  const tug = byId(HUENEME_REGISTRY, 'tug-teresa-brusco');
  // 3,542 kW x 0.31 x 0.0666 gal/kWh, about 73 gal per working hour.
  assert.ok(Math.abs(dieselGphOf(tug) - 73.1) < 0.5);
  assert.equal(dieselGphOf(byId(HUENEME_REGISTRY, 'tug-simone-brusco')), null);
});

test('an overlay patches, adds, clears and removes assets, and bad ones are refused', () => {
  const overlay = {
    source: 'port records',
    assets: [
      {
        id: 'gate-main',
        lanes: 4,
        trucksPerDay: 650,
        notes: null,
        at: [34.145, -119.2],
      },
      { id: 'bldg-del-monte', meterId: 'bldg-1a' },
      { id: 'charger-utr-03', class: 'charger', meterId: 'meter-che', kw: 150 },
    ],
    remove: ['tank-wharf1-1'],
  };
  const { registry, errors } = mergeOverlay(HUENEME_REGISTRY, overlay, {
    meterIds: ['bldg-1a'],
  });
  assert.deepEqual(errors, []);
  assert.equal(registry.overlay, true);
  const gate = byId(registry, 'gate-main');
  assert.equal(gate.lanes, 4);
  assert.equal(gate.trucksPerDay, 650);
  assert.equal('notes' in gate, false);
  assert.equal(byId(registry, 'bldg-del-monte').meterId, 'bldg-1a');
  assert.equal(byId(registry, 'bldg-del-monte').use, 'cold_storage');
  assert.ok(byId(registry, 'charger-utr-03'));
  assert.equal(byId(registry, 'tank-wharf1-1'), undefined);
  // The seed is untouched.
  assert.equal(byId(HUENEME_REGISTRY, 'gate-main').lanes, 2);

  // An unknown meter keeps the seed and reports why.
  const bad = mergeOverlay(HUENEME_REGISTRY, {
    assets: [{ id: 'bldg-del-monte', meterId: 'nope' }],
  });
  assert.equal(bad.registry, HUENEME_REGISTRY);
  assert.ok(bad.errors.some((e) => e.includes('meterId nope')));
  assert.throws(
    () => applyOverlay(HUENEME_REGISTRY, { assets: [{ id: 'x' }] }),
    /needs a class/,
  );
});

test('the loader uses the overlay when served and the seed otherwise', async () => {
  const served =
    (body, ok = true) =>
    async () => ({
      ok,
      headers: { get: () => 'application/json' },
      json: async () => body,
    });
  const merged = await loadAssetRegistry({
    fetchImpl: served({ assets: [{ id: 'gate-main', lanes: 3 }] }),
  });
  assert.equal(byId(merged, 'gate-main').lanes, 3);
  assert.equal(
    await loadAssetRegistry({ fetchImpl: served(null, false) }),
    HUENEME_REGISTRY,
  );
  assert.equal(
    await loadAssetRegistry({
      fetchImpl: async () => {
        throw new Error('offline');
      },
    }),
    HUENEME_REGISTRY,
  );
});

test('cards show readable fields, notes and sources', () => {
  const card = assetCard(
    byId(HUENEME_REGISTRY, 'bldg-del-monte'),
    HUENEME_REGISTRY,
  );
  assert.equal(card.title, 'Del Monte on-dock cold storage');
  const rows = Object.fromEntries(card.rows);
  assert.equal(rows.Use, 'Cold storage warehouse');
  assert.equal(rows['Floor area'], '93,000 sq ft');
  assert.equal(rows.Refrigerated, 'Yes');
  assert.ok(rows.Source.includes('OpenStreetMap'));
  assert.equal(rows.Location, undefined);
  const tugRows = Object.fromEntries(
    assetCard(byId(HUENEME_REGISTRY, 'tug-teresa-brusco'), HUENEME_REGISTRY)
      .rows,
  );
  assert.equal(tugRows['Energy spec'], 'Ship-assist tug');
  assert.equal(tugRows['Engine tier'], 'Tier 3');
  const summary = Object.fromEntries(registryCard(HUENEME_REGISTRY).rows);
  assert.ok(summary['Tugs and harbor craft'].endsWith('records'));
  // Port staff: Hueneme calls need no pilot, so the seed has no pilot boat.
  assert.ok(!HUENEME_REGISTRY.assets.some((a) => a.craftType === 'pilot'));
  assert.equal(byId(HUENEME_REGISTRY, 'berth-4').label, 'Berth 4 (RoRo)');
  // 2025 terminal plan: Berths 1-2 South Terminal, 4-5 North Terminal (POH),
  // the rest on the Navy Terminal.
  assert.equal(byId(HUENEME_REGISTRY, 'berth-5').zone, 'North Terminal');
  assert.equal(byId(HUENEME_REGISTRY, 'berth-5').operator, 'Port of Hueneme');
  assert.equal(byId(HUENEME_REGISTRY, 'berth-8').zone, 'Navy Terminal');
  // Port staff: only Berths 1 and 2 have ship shore power.
  assert.deepEqual(
    HUENEME_REGISTRY.assets
      .filter((a) => a.class === 'berth' && a.shorePower)
      .map((a) => a.id),
    ['berth-1', 'berth-2'],
  );
  assert.deepEqual(
    HUENEME_REGISTRY.assets
      .filter((a) => a.class === 'shore_power')
      .map((a) => a.berthId),
    ['berth-1', 'berth-2'],
  );
  assert.ok(summary.Data.startsWith('Public sources only'));
});
