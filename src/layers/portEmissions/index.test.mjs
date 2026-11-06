import assert from 'node:assert/strict';
import test from 'node:test';
import { PORT_OF_HUENEME } from '../../emissions/ports.js';
import { createPortEmissionsLayer } from './index.js';

function fakeViewer() {
  const sources = new Set();
  return {
    dataSources: {
      add: (s) => sources.add(s),
      remove: (s) => sources.delete(s),
      contains: (s) => sources.has(s),
      get size() {
        return sources.size;
      },
      first: () => [...sources][0],
    },
  };
}

test('the layer draws the geofences and models ships at berth from live AIS', async () => {
  let clock = Date.parse('2026-11-01T00:00:00Z');
  let tick = null;
  const rows = [
    {
      mmsi: '563000001',
      name: 'TEST CARRIER',
      lat: 34.151,
      lon: -119.209,
      speedKts: 0,
      shipType: '70',
    },
  ];
  const cards = new Map();
  const layer = createPortEmissionsLayer({
    profile: PORT_OF_HUENEME,
    readVessels: () => rows,
    overlayHost: {
      setEntries: (id, entries) => cards.set(id, entries),
      clearSource: (id) => cards.delete(id),
    },
    now: () => clock,
    setTimer: (fn) => {
      tick = fn;
      return 1;
    },
    clearTimer: () => {
      tick = null;
    },
  });
  const viewer = fakeViewer();
  await layer.init(viewer);
  await layer.enable(viewer);
  assert.equal(viewer.dataSources.size, 1);
  const entities = viewer.dataSources.first().entities;
  assert.ok(entities.getById('port-emissions:harbor'));
  assert.ok(entities.getById('port-emissions:berth-0'));
  assert.ok(entities.getById('port-emissions:vessel:563000001'));

  const published = cards.get('port-emissions-cards');
  assert.equal(published[0].title, 'PORT OF HUENEME');
  assert.equal(published[1].title, 'TEST CARRIER');
  assert.match(published[1].details[0], /kW aux \(range\)/);

  clock += 2 * 3_600_000;
  tick();
  const summary = layer.getSummary();
  assert.equal(summary.hotellingHours, 2);
  assert.equal(layer.getStats().coverage, 'Port of Hueneme · 1 at berth');
  assert.equal(layer.getAnalystRecords()[0].mode, 'hotelling');

  await layer.disable();
  assert.equal(viewer.dataSources.size, 0);
  assert.equal(cards.size, 0);
  assert.equal(tick, null);
  assert.equal(layer.getStats().status, 'idle');
  await layer.destroy();
});
