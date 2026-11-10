import assert from 'node:assert/strict';
import test from 'node:test';
import { createFreightFootprintLayer } from './index.js';
import {
  dropSiteMarkers,
  flowWidth,
  footprintHeadline,
  landLinks,
  oceanLanes,
} from './model.js';
import { freightFootprint } from '../../emissions/freightFootprint.js';

function fakeViewer() {
  const sources = new Set();
  return {
    dataSources: {
      add: (s) => sources.add(s),
      remove: (s) => sources.delete(s),
      contains: (s) => sources.has(s),
      first: () => [...sources][0],
      get size() {
        return sources.size;
      },
    },
  };
}

test('the model merges flows into lanes, links and drop-site markers', () => {
  const f = freightFootprint();
  const lanes = oceanLanes(f);
  const laneT = lanes.reduce((s, l) => s + l.tonnes, 0);
  assert.ok(Math.abs(laneT - f.cargoTonnes) < 1e-6);
  assert.ok(lanes.every((l) => l.points.length > 2));
  const links = landLinks(f);
  assert.ok(links.some((l) => l.leg === 'drayage'));
  assert.ok(links.some((l) => l.mode === 'rail'));
  const sites = dropSiteMarkers(f);
  assert.ok(
    sites.find((s) => s.id === 'chiquita').details[0].includes('3rd St'),
  );
  assert.equal(flowWidth(0, 10), 1);
  assert.equal(flowWidth(10, 10), 8);
  const head = footprintHeadline(f, {
    bevDrayage: freightFootprint({ scenario: { drayage: 'electric' } }),
  });
  assert.match(head.details[0], /t CO2e end to end \(modeled\)/);
  assert.match(head.details.at(-1), /Battery-electric drayage/);
});

test('the layer draws the footprint and publishes cards while on', async () => {
  const cards = new Map();
  const layer = createFreightFootprintLayer({
    overlayHost: {
      setEntries: (id, entries) => cards.set(id, entries),
      clearSource: (id) => cards.delete(id),
    },
  });
  const viewer = fakeViewer();
  await layer.init(viewer);
  assert.equal(layer.getStats().status, 'idle');
  await layer.enable(viewer);
  assert.equal(viewer.dataSources.size, 1);
  const entities = viewer.dataSources.first().entities.values;
  assert.ok(entities.some((e) => e.id === 'freight-footprint:gate'));
  assert.ok(entities.some((e) => e.id.startsWith('freight-footprint:ocean:')));
  const entries = cards.get('freight-footprint-cards');
  assert.equal(entries[0].title, 'POH FREIGHT FOOTPRINT');
  assert.equal(layer.getStats().status, 'nominal');
  assert.ok(layer.getAnalystRecords(5).length === 5);
  await layer.disable();
  assert.equal(viewer.dataSources.size, 0);
  assert.equal(cards.has('freight-footprint-cards'), false);
  await layer.destroy();
});
