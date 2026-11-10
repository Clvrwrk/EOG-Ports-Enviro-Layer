import assert from 'node:assert/strict';
import test from 'node:test';
import { HUENEME_REGISTRY } from '../hueneme.js';
import { drawsAsset } from './view.js';

test('the twin asset layer draws fixed assets and leaves moving equipment to the scenario', () => {
  const drawn = HUENEME_REGISTRY.assets.filter(drawsAsset);
  const ids = new Set(drawn.map((asset) => asset.id));
  for (const id of ['bldg-del-monte', 'rail-south-spur', 'berth-1', 'berth-4'])
    assert.ok(ids.has(id), `${id} is drawn`);
  assert.ok(!drawn.some((asset) => asset.class === 'mobile_harbor_crane'));
  assert.ok(!drawn.some((asset) => asset.class === 'utr'));
});
